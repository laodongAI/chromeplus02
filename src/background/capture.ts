/**
 * 网络媒体捕获（基于 chrome.webRequest）。
 * 目标：捕获视频/音频直链与 HLS/DASH 流候选，并标记类型（kind）；
 * 提供按 tabId/frameId 查询的消息接口：GET_CAPTURED_VIDEO_SOURCES。
 * 分类逻辑见 utils/mediaType.ts（纯函数，含单测）。
 */

import { classifyNetworkMedia, extFromUrl } from '@/utils/mediaType';
import { registerBgHandler } from './bus';
import { MessageType, type GetCapturedVideoSourcesMessage } from '@/messaging';
// Round 5 #29：缓存捕捉 / 深度搜索的候选合并（纯函数，含单测）
import { backfillSweepRecords, filterNewCandidates, type MediaSweepVia, type SweepCandidate } from '@/core/mediaSweep';
// P1-8：分级日志（SW 上下文默认 info 级）
import { createLogger } from '@/utils/logger';

/** 本模块 logger：保留原 `[bg.capture]` 前缀语义 */
const log = createLogger('bg.capture');

export type CapturedKind = 'video' | 'audio' | 'hls' | 'dash';

type CapturedSource = {
  url: string;
  kind: CapturedKind;
  mimeType?: string;
  extension?: string;
  size?: number;
  /** network=请求实测；cache=页面资源账本回收；deep=脚本正文扫描 */
  via: MediaSweepVia;
  tabId: number;
  frameId?: number;
  time: number;
  /** 只能录制、无法直链取回的流（YouTube SABR/UMP），见 utils/mediaType.ts */
  streamOnly?: boolean;
};

// tabId -> frameId -> list
const store = new Map<number, Map<number | 'top', CapturedSource[]>>();
let installed = false;

// 嗅探变更钩子（工具栏 badge 等消费者注册）
let captureChangedHandler: ((tabId: number) => void) | null = null;
export function setCaptureChangedHandler(fn: (tabId: number) => void): void {
  captureChangedHandler = fn;
}

/** 统计某标签页嗅探到的媒体条数（排除 ts/m4s 分片与重复 URL） */
export function countTabSources(tabId: number): number {
  const perTab = store.get(tabId);
  if (!perTab) return 0;
  const SEGMENT_EXT = new Set(['ts', 'm4s']);
  const seen = new Set<string>();
  let n = 0;
  perTab.forEach((list) => list.forEach((s) => {
    const ext = (s.extension || '').toLowerCase();
    if (SEGMENT_EXT.has(ext)) return;
    const key = sourceKey(s);
    if (seen.has(key)) return;
    seen.add(key); n++;
  }));
  return n;
}

export function initCaptureHandlers() {
  if (installed) return;
  installed = true;
  try {
    // 捕获响应完成以读取 headers（需要 extraInfoSpec: 'responseHeaders'）
    chrome.webRequest.onCompleted.addListener(
      (details) => {
        try { handleCompleted(details); } catch (e) { /* noop */ }
      },
      { urls: ['<all_urls>'] },
      ['responseHeaders']
    );
  } catch (e) {
    try { log.warn('注册 onCompleted 失败:', e); } catch { /* noop */ }
  }

  // 标签页关闭时清理嗅探缓存，防止内存累积
  try {
    chrome.tabs.onRemoved.addListener((tabId) => { store.delete(tabId); });
  } catch { /* noop */ }

  // 嗅探结果查询：泛型收窄到具体消息接口（P1-1）
  registerBgHandler<GetCapturedVideoSourcesMessage>(MessageType.GET_CAPTURED_VIDEO_SOURCES, (message) => {
    const tabId: number | undefined = typeof message?.tabId === 'number' ? message.tabId : undefined;
    const frameId: number | undefined = typeof message?.frameId === 'number' ? message.frameId : undefined;
    const sources = queryCaptured(tabId, frameId);
    return { success: true, sources };
  });
}

function handleCompleted(details: chrome.webRequest.WebResponseCacheDetails) {
  const { url, tabId, frameId, responseHeaders } = details as any;
  if (typeof tabId !== 'number' || !url) return;

  const ct = getHeader(responseHeaders, 'content-type');
  const lenStr = getHeader(responseHeaders, 'content-length');
  const size = typeof lenStr === 'string' ? Number(lenStr) : undefined;

  const cls = classifyNetworkMedia(url, ct);
  if (!cls.kind) return;

  const entry: CapturedSource = {
    url,
    kind: cls.kind,
    mimeType: ct,
    extension: cls.extension || extFromUrl(url),
    size: Number.isFinite(size!) ? size : undefined,
    via: 'network',
    tabId,
    frameId: typeof frameId === 'number' ? frameId : undefined,
    time: Date.now(),
    streamOnly: cls.streamOnly
  };
  record(entry);
  try { captureChangedHandler?.(tabId); } catch { /* noop */ }
}

function record(item: CapturedSource) {
  const frameKey: number | 'top' = typeof item.frameId === 'number' ? item.frameId : 'top';
  if (!store.has(item.tabId)) store.set(item.tabId, new Map());
  const perTab = store.get(item.tabId)!;
  if (!perTab.has(frameKey)) perTab.set(frameKey, []);
  const list = perTab.get(frameKey)!;
  // 去重依据：去掉 hash 的 URL（SABR 流按端点收敛，见 sourceKey）
  const key = sourceKey(item);
  if (list.some((s) => sourceKey(s) === key)) return;
  list.push(item);
  // 限制每帧存量，防止无限增长
  if (list.length > 300) list.splice(0, list.length - 300);
}

/**
 * 回收候选入库（Round 5 #29，供 mediaSweep 调用）。
 * 与嗅探条目共用同一份存量，因此列表、徽标计数、下载链路全部无需改动即可看到结果；
 * 命中已有 URL 时只补缺失的体积/格式，不会用推断值覆盖嗅探实测值。
 * @returns 新增条数
 */
export function ingestSweepCandidates(tabId: number, frameId: number | undefined, found: SweepCandidate[]): number {
  if (!found.length) return 0;
  const frameKey: number | 'top' = typeof frameId === 'number' ? frameId : 'top';
  if (!store.has(tabId)) store.set(tabId, new Map());
  const perTab = store.get(tabId)!;
  if (!perTab.has(frameKey)) perTab.set(frameKey, []);
  const list = perTab.get(frameKey)!;
  const now = Date.now();
  // 先补已有条目的缺失字段，再入库新候选（新候选按完整 URL 去 hash 判重，与 record() 同口径）
  const filled = backfillSweepRecords(list, found);
  const fresh = filterNewCandidates(found, list.map((s) => s.url));
  for (const c of fresh) {
    list.push({
      url: c.url,
      kind: c.kind,
      mimeType: c.mimeType,
      extension: c.extension,
      size: c.size,
      via: c.via,
      tabId,
      frameId: typeof frameId === 'number' ? frameId : undefined,
      time: now
    });
  }
  if (list.length > 300) list.splice(0, list.length - 300);
  log.debug(`回收候选 tab=${tabId} frame=${String(frameKey)} 新增=${fresh.length} 补齐=${filled}`);
  try { captureChangedHandler?.(tabId); } catch { /* noop */ }
  return fresh.length;
}

function queryCaptured(tabId?: number, frameId?: number) {
  const out: { url: string; kind: CapturedKind; mimeType?: string; extension?: string; size?: number; via: string; streamOnly?: boolean }[] = [];
  const add = (s: CapturedSource) => out.push({ url: s.url, kind: s.kind, mimeType: s.mimeType, extension: s.extension, size: s.size, via: s.via, streamOnly: s.streamOnly });
  if (typeof tabId === 'number') {
    const perTab = store.get(tabId);
    if (!perTab) return out;
    if (typeof frameId === 'number') {
      const list = perTab.get(frameId) || [];
      list.forEach(add);
      return dedupe(out);
    }
    // 未指定 frameId：聚合顶层和所有子帧
    perTab.forEach((list) => list.forEach(add));
    return dedupe(out);
  }
  // 未指定 tabId：聚合所有（通常不需要）
  store.forEach((frames) => frames.forEach((list) => list.forEach(add)));
  return dedupe(out);
}

function dedupe(arr: { url: string; streamOnly?: boolean }[]) {
  const seen = new Set<string>();
  return arr.filter((s) => {
    const key = sourceKey(s);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function getHeader(headers: chrome.webRequest.HttpHeader[] | undefined, name: string): string | undefined {
  if (!headers) return undefined;
  const h = headers.find((x) => (x.name || '').toLowerCase() === name.toLowerCase());
  return (h?.value || (Array.isArray(h?.binaryValue) ? new TextDecoder().decode(new Uint8Array(h!.binaryValue!)) : undefined)) as string | undefined;
}

function stripHash(u: string) {
  try { return u.split('#')[0]; } catch { return u; }
}

/**
 * 去重键。YouTube SABR 每隔几秒向同一 /videoplayback 端点 POST 一次，
 * URL 仅 rn/cpn 等易变参数不同；按完整 URL 去重会迅速灌满每帧 300 条上限，
 * 把真正有用的条目挤掉，故这类流按 origin+pathname 收敛为一条。
 */
function sourceKey(s: { url: string; streamOnly?: boolean }): string {
  if (s.streamOnly) {
    try { const u = new URL(s.url); return `${u.origin}${u.pathname}`; } catch { /* 落回完整 URL */ }
  }
  return stripHash(s.url);
}
