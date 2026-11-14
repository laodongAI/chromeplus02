/**
 * 媒体候选回收（Round 5 #29，副作用层）。
 *
 * 两条路径共用同一份候选入库出口（capture.ingestSweepCandidates），所以结果直接出现在
 * 音视频面板与徽标计数里，不需要新的列表 UI：
 *  - MEDIA_LEDGER_SCAN（缓存捕捉）：读页面自己的资源账本 ——
 *    performance 资源计时 + Cache Storage 条目。能捞回「扩展没看见的那些请求」
 *    （SPA 换页、侧栏晚开、后台 SW 休眠期间的加载），字节数取 encodedBodySize。
 *  - MEDIA_DEEP_SCAN（深度搜索）：抓已加载的 JS 正文，扫字符串字面量里的媒体地址，
 *    覆盖懒加载播放器「点播放才发请求」的情况。候选先用 Range 请求实测可取回才入库。
 *
 * 平台边界（见项目记忆 media-capture-platform-constraints）：
 *  Chrome 没有向扩展暴露 HTTP 缓存枚举接口（CDP 的 Network.getCachedResources 已移除），
 *  因此这里做的是「页面视角的已加载清单」而不是「磁盘缓存文件导出」；
 *  DRM/SABR 这类取不回独立文件的地址不会被本模块变成可下载项。
 */
import { MessageType, type MediaSweepMessage, type MediaSweepResult } from '@/messaging';
import { registerBgHandler } from './bus';
import { ingestSweepCandidates } from './capture';
import {
  extractMediaUrlsFromScript,
  mediaUrlsFromResourceEntries,
  scriptUrlsFromResourceEntries,
  type ResourceTimingLike,
  type SweepCandidate
} from '@/core/mediaSweep';
import { classifyNetworkMedia } from '@/utils/mediaType';
// P1-8：分级日志（SW 上下文默认 info 级）
import { createLogger } from '@/utils/logger';

/** 本模块 logger */
const log = createLogger('bg.mediaSweep');

/** 深度搜索一次最多抓几个脚本（再多就是拿用户的带宽换命中率） */
const MAX_SCRIPTS = 40;
/** 单个脚本正文读取上限：播放器代码通常几十到几百 KB，超过即截断 */
const MAX_SCRIPT_BYTES = 2 * 1024 * 1024;
/** 脚本抓取并发 */
const SCRIPT_CONCURRENCY = 4;
/** 脚本候选实测验证条数上限 */
const MAX_VERIFY = 30;
/** 单次网络操作超时 */
const FETCH_TIMEOUT_MS = 8000;
/** 整轮深度搜索的时间预算：超了先返回部分结果，UI 明示「部分」而不是永久转圈 */
const DEEP_DEADLINE_MS = 20000;

/** 注入页面后取回的资源账本 */
interface PageLedger {
  /** 文档 URL，脚本相对地址的兜底基准 */
  pageUrl: string;
  /** performance 资源计时（截断到 MAX_ENTRIES 条） */
  entries: ResourceTimingLike[];
  /** Cache Storage 缓存名；受限上下文或抛错时为空数组 */
  cacheNames: string[];
  /** Cache Storage 里的条目 URL 与体积 */
  cacheEntries: { url: string; size?: number; contentType?: string }[];
  /** Cache Storage 单独失败的原因（不影响 performance 那部分结果） */
  cacheError?: string;
}

const MAX_ENTRIES = 2000;

/**
 * 在页面上下文读取资源账本。
 * 必须是可序列化的自包含函数（executeScript 会把它转成源码注入），因此不引用模块作用域变量。
 */
async function collectLedgerInPage(): Promise<PageLedger> {
  const out: PageLedger = { pageUrl: location.href, entries: [], cacheNames: [], cacheEntries: [] };
  try {
    const list = performance.getEntriesByType('resource') as PerformanceResourceTiming[];
    out.entries = list.slice(0, MAX_ENTRIES).map((e) => ({
      name: e.name,
      encodedBodySize: e.encodedBodySize || 0,
      initiatorType: e.initiatorType || ''
    }));
  } catch { /* 取不到就只剩 Cache Storage 一路 */ }
  try {
    const names = await caches.keys();
    out.cacheNames = names;
    for (const n of names) {
      const cache = await caches.open(n);
      const keys = await cache.keys();
      for (const req of keys) {
        const res = await cache.match(req);
        const len = Number(res?.headers.get('content-length') || 0);
        out.cacheEntries.push({
          url: req.url,
          size: len > 0 ? len : undefined,
          contentType: res?.headers.get('content-type') || undefined
        });
        if (out.cacheEntries.length >= MAX_ENTRIES) break;
      }
      if (out.cacheEntries.length >= MAX_ENTRIES) break;
    }
  } catch (e) {
    out.cacheError = e instanceof Error ? e.message : String(e);
  }
  return out;
}

/** 取活动标签页（面板未显式指定 tabId 时） */
async function resolveTabId(tabId?: number): Promise<number | null> {
  if (typeof tabId === 'number') return tabId;
  const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  const first = tabs[0] || (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
  return typeof first?.id === 'number' ? first.id : null;
}

/** 一个 frame 的资源账本；候选必须按 frame 入库，否则面板按帧筛选时看不到 */
interface LedgerBucket {
  frameId?: number;
  ledger: PageLedger;
}

/** 注入并读取各 frame 的账本；失败时给出可读原因而不是原始 lastError */
async function readLedger(tabId: number, frameId?: number): Promise<{ ok: boolean; error?: string; buckets: LedgerBucket[] }> {
  const target: chrome.scripting.InjectionTarget = typeof frameId === 'number'
    ? { tabId, frameIds: [frameId] }
    : { tabId, allFrames: true };
  try {
    // 注入函数只需要文档上下文（performance / caches），MAIN world 无隔离世界差异且序列化开销最小
    const results = await chrome.scripting.executeScript<[], PageLedger>({
      target,
      world: 'MAIN',
      func: collectLedgerInPage as unknown as () => PageLedger
    });
    const buckets: LedgerBucket[] = [];
    for (const r of results || []) {
      const part = r?.result;
      if (!part) continue;
      buckets.push({
        frameId: typeof r.frameId === 'number' ? r.frameId : undefined,
        ledger: {
          pageUrl: part.pageUrl || '',
          entries: part.entries || [],
          cacheNames: part.cacheNames || [],
          cacheEntries: part.cacheEntries || [],
          cacheError: part.cacheError
        }
      });
    }
    if (!buckets.length) {
      return { ok: false, error: '页面未返回资源账本（可能为受限页面或框架已卸载）', buckets: [] };
    }
    return { ok: true, buckets };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      error: /Cannot access a chrome|cannot be scripted|Cannot access/i.test(msg)
        ? '当前页面不允许注入（浏览器内置页 / 应用商店 / 扩展自身页面），无法读取资源账本'
        : msg,
      buckets: []
    };
  }
}

/** 简单并发池：固定数量 worker 消费队列 */
async function mapPool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let cursor = 0;
  const workers = new Array(Math.min(limit, items.length || 1)).fill(0).map(async () => {
    while (cursor < items.length) {
      const i = cursor++;
      out[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return out;
}

/** 带超时的 fetch（AbortController，避免挂死整轮扫描） */
async function fetchWithTimeout(url: string, init: RequestInit = {}): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    // credentials:'include'：站点的媒体地址普遍校验 Cookie/签名，
    // 匿名请求会把「用户确实能播」的资源误判成不可用（扩展带 host 权限，与页面同主体）
    return await fetch(url, { ...init, credentials: 'include', signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** 读取响应文本，最多 maxBytes（超出直接 cancel，不给后台堆内存） */
async function readTextCapped(res: Response, maxBytes: number): Promise<string> {
  if (!res.body) {
    const t = await res.text();
    return t.length > maxBytes ? t.slice(0, maxBytes) : t;
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: false });
  const chunks: string[] = [];
  let total = 0;
  while (total < maxBytes) {
    const { done, value } = await reader.read();
    if (done || !value) break;
    total += value.byteLength;
    chunks.push(decoder.decode(value, { stream: total < maxBytes }));
  }
  if (total >= maxBytes) {
    try { await reader.cancel(); } catch { /* 已结束的流忽略 */ }
  }
  return chunks.join('');
}

/**
 * 实测一条候选是否真能取回，并顺带拿到 MIME 与总字节数。
 * 用 Range 请求只取 1 字节：既证明地址活着，又不下载整个文件。
 * 失败/超时/非媒体响应 → null（丢弃，不进列表）。
 */
async function verifyCandidate(c: SweepCandidate): Promise<SweepCandidate | null> {
  try {
    const res = await fetchWithTimeout(c.url, { headers: { Range: 'bytes=0-0' } });
    if (!res.ok) return null;
    const ct = res.headers.get('content-type') || undefined;
    const cls = classifyNetworkMedia(c.url, ct);
    if (!cls.kind) return null;
    // Content-Range: bytes 0-0/1234567 → 总字节；退化用 Content-Length（未分段返回时即全长）
    const range = res.headers.get('content-range');
    const totalFromRange = range ? Number((range.split('/')[1] || '').trim()) : NaN;
    const lenHeader = Number(res.headers.get('content-length') || '');
    const size = Number.isFinite(totalFromRange) && totalFromRange > 0
      ? totalFromRange
      : (res.status === 206 || lenHeader <= 0 ? undefined : lenHeader);
    return { ...c, kind: cls.kind, mimeType: ct || c.mimeType, extension: cls.extension || c.extension, size: size ?? c.size };
  } catch {
    return null;
  }
}

/** 缓存捕捉：各 frame 的资源账本 → 候选入库 */
async function runLedgerScan(message: MediaSweepMessage): Promise<MediaSweepResult> {
  const tabId = await resolveTabId(message?.tabId);
  if (tabId === null) return { success: false, added: 0, error: '没有可用标签页' };
  const read = await readLedger(tabId, message?.frameId);
  if (!read.ok) return { success: false, added: 0, error: read.error };

  let added = 0;
  let scanned = 0;
  let cacheNames = 0;
  let cacheError = '';
  for (const bucket of read.buckets) {
    const ledger = bucket.ledger;
    const fromTiming = mediaUrlsFromResourceEntries(ledger.entries);
    const fromCache: SweepCandidate[] = [];
    for (const item of ledger.cacheEntries) {
      if (!/^https?:/i.test(item.url)) continue;
      const cls = classifyNetworkMedia(item.url, item.contentType);
      if (!cls.kind) continue;
      fromCache.push({
        url: item.url,
        kind: cls.kind,
        via: 'cache',
        extension: cls.extension,
        mimeType: item.contentType,
        size: item.size
      });
    }
    const found: SweepCandidate[] = [];
    const seen = new Set<string>();
    for (const c of [...fromTiming, ...fromCache]) {
      const key = c.url.split('#')[0];
      if (seen.has(key)) continue;
      seen.add(key);
      found.push(c);
    }
    scanned += found.length;
    added += ingestSweepCandidates(tabId, bucket.frameId, found);
    cacheNames += ledger.cacheNames.length;
    if (!cacheError && ledger.cacheError) cacheError = ledger.cacheError;
  }
  const note = cacheError
    ? `Cache Storage 读取失败（${cacheError}），本轮仅使用页面资源记录`
    : (cacheNames ? `已读取 ${cacheNames} 个 Cache Storage 缓存` : '站点未使用 Cache Storage');
  log.info(`缓存捕捉 tab=${tabId} frame=${read.buckets.length} 候选=${scanned} 新增=${added}`);
  return { success: true, added, scanned, note };
}

/** 深度搜索：抓已加载脚本正文 → 扫媒体地址 → 实测验证 → 入库 */
async function runDeepScan(message: MediaSweepMessage): Promise<MediaSweepResult> {
  const tabId = await resolveTabId(message?.tabId);
  if (tabId === null) return { success: false, added: 0, error: '没有可用标签页' };
  const read = await readLedger(tabId, message?.frameId);
  if (!read.ok) return { success: false, added: 0, error: read.error };

  const deadline = Date.now() + DEEP_DEADLINE_MS;
  let added = 0;
  let fetched = 0;
  let verifiedTotal = 0;
  let candidateTotal = 0;
  let partial = false;
  let noScripts = true;

  for (const bucket of read.buckets) {
    const scriptUrls = scriptUrlsFromResourceEntries(bucket.ledger.entries, MAX_SCRIPTS);
    if (scriptUrls.length) noScripts = false;
    const candidates: SweepCandidate[] = [];
    const seen = new Set<string>();

    await mapPool(scriptUrls, SCRIPT_CONCURRENCY, async (url) => {
      if (Date.now() > deadline) { partial = true; return; }
      try {
        // cache:'default' 让脚本尽量命中浏览器缓存，重复抓取不打网络
        const res = await fetchWithTimeout(url, { cache: 'default' });
        if (!res.ok) return;
        const ct = res.headers.get('content-type') || '';
        if (!/javascript|ecmascript|\/js\b/i.test(ct) && !/\.m?js(\?|$)/i.test(url.split('?')[0])) return;
        const text = await readTextCapped(res, MAX_SCRIPT_BYTES);
        fetched++;
        for (const c of extractMediaUrlsFromScript(text, url)) {
          const key = c.url.split('#')[0];
          if (seen.has(key)) continue;
          seen.add(key);
          candidates.push(c);
        }
      } catch {
        /* 单个脚本失败不影响整轮：超时/403/跨源屏蔽都归入「未取到」 */
      }
    });
    candidateTotal += candidates.length;

    // 脚本里扒出来的地址有一半是模板残片或已过期签名，实测后才进列表
    const verified: SweepCandidate[] = [];
    await mapPool(candidates.slice(0, MAX_VERIFY), SCRIPT_CONCURRENCY, async (c) => {
      const v = await verifyCandidate(c);
      if (v) verified.push(v);
    });
    verifiedTotal += verified.length;
    added += ingestSweepCandidates(tabId, bucket.frameId, verified);
  }
  if (Date.now() > deadline) partial = true;

  if (noScripts && !added) {
    return { success: true, added: 0, scanned: 0, note: '页面没有可读取的外部脚本（内容可能为内联或被跨源策略屏蔽）' };
  }
  log.info(`深度搜索 tab=${tabId} 脚本=${fetched} 候选=${candidateTotal} 验证通过=${verifiedTotal} 新增=${added}`);
  return {
    success: true,
    added,
    scanned: fetched,
    verified: verifiedTotal,
    partial,
    note: partial
      ? `时间预算用尽，仅扫描了部分脚本；未验证的候选已丢弃`
      : `扫描 ${fetched} 个脚本，发现 ${candidateTotal} 个候选，${verifiedTotal} 个实测可取回`
  };
}

/** 注册回收类消息（侧栏按钮触发，同步返回统计） */
export function initMediaSweepHandlers(): void {
  registerBgHandler<MediaSweepMessage>(MessageType.MEDIA_LEDGER_SCAN, (message) => runLedgerScan(message));
  registerBgHandler<MediaSweepMessage>(MessageType.MEDIA_DEEP_SCAN, (message) => runDeepScan(message));
}
