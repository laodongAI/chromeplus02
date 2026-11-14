/**
 * 延迟媒体地址回收（Round 5 #29，纯逻辑层）。
 *
 * 两条互补路径，都只依赖「页面已经付过费的信息」，不做任何平台绕过：
 *  1. 资源账本（缓存捕捉）：performance 的资源计时 + Cache Storage 条目。
 *     嗅探（webRequest）只能在扩展活着的那一刻起看见请求，
 *     而 SPA 换页、侧栏晚开、后台 SW 休眠都会让「播过的媒体」彻底消失在列表里；
 *     资源账本记录的是页面自己加载过的全部 URL 与字节数，能把这些条目找回来。
 *  2. 脚本正文（深度搜索）：懒加载页面的真实媒体地址常常写死在已下载的 JS 里
 *     （播放器初始化参数、接口路径拼接的前半段），抓下来做字符串扫描即可拿到候选。
 *
 * 本模块只做「文本/条目 → 候选」的纯函数，网络与注入都在 background/mediaSweep.ts。
 */
import { classifyNetworkMedia, extFromUrl, type NetworkMediaKind } from '@/utils/mediaType';
import { isBlockedHost } from '@/utils/domains';

/** 扫描来源：用于列表标注与优先级（network 实测 > cache 账本 > deep 脚本推断） */
export type MediaSweepVia = 'network' | 'cache' | 'deep';

/** 一条候选媒体 */
export interface SweepCandidate {
  url: string;
  kind: NetworkMediaKind;
  via: MediaSweepVia;
  extension?: string;
  /** 已知字节数（账本的 encodedBodySize / 脚本候选验证后的 content-length） */
  size?: number;
  mimeType?: string;
}

/** performance.getEntriesByType('resource') 里我们关心的字段 */
export interface ResourceTimingLike {
  name: string;
  /** 压缩后的响应体字节数；缓存命中时同样有值（transferSize 才是 0） */
  encodedBodySize?: number;
  initiatorType?: string;
}

/** 字符串字面量：单引号 / 双引号 / 反引号，允许内部转义 */
const STRING_LITERAL = /(['"`])((?:\\.|(?!\1)[^\\])*)\1/g;

/** JS 源码里出现过的媒体扩展名（脚本正文没有 Content-Type，只能认扩展名） */
const SCRIPT_MEDIA_EXT = /\.(m3u8|mpd|mp4|webm|mkv|mov|flv|ts|m4s|m4v|m3u|mp3|m4a|aac|ogg|oga|opus|wav|flac|weba|f4v|3gp)\b/i;

/** 反斜杠转义还原：站点常把 URL 写成 `https:\/\/cdn.x\/a.m3u8` 或 `\u002f` */
function unescapeJsString(raw: string): string {
  return raw
    .replace(/\\u002f/gi, '/')
    .replace(/\\u005c/gi, '\\')
    .replace(/\\x2f/gi, '/')
    .replace(/\\\//g, '/')
    .replace(/\\'/g, "'")
    .replace(/\\"/g, '"');
}

/**
 * URL 是否值得进候选：http(s) 且媒体分类命中，且不在域名黑名单。
 * 黑名单必须自己判：这里进来的 URL 大多在 CDN 域，走分类器碰不到它。
 */
function acceptableMediaUrl(url: string, contentType?: string): boolean {
  if (!/^https?:/i.test(url)) return false;
  try {
    if (isBlockedHost(new URL(url).hostname)) return false;
  } catch {
    return false;
  }
  return classifyNetworkMedia(url, contentType).kind !== null;
}

/** 相对地址按脚本所在 URL 解析；解析失败返回 null（模板残片、`{{host}}/x.m3u8` 之类） */
export function resolveAgainstBase(raw: string, baseUrl: string): string | null {
  try {
    const abs = new URL(unescapeJsString(raw), baseUrl);
    if (abs.protocol !== 'http:' && abs.protocol !== 'https:') return null;
    return abs.href;
  } catch {
    return null;
  }
}

/**
 * 从一段 JS 源码里提取媒体地址候选。
 *
 * 只认「带媒体扩展名的字符串字面量」：宁可漏（后续靠验证补）也不猜，
 * 否则 `videoUrl` 这类键名会把一堆接口路径伪装成媒体塞进列表。
 * 拼接式地址（`base + '/x.m3u8?tag=' + token`）会带上未闭合的查询串，
 * 这类候选必须由 verifyMediaCandidates() 实测后才进列表。
 */
export function extractMediaUrlsFromScript(
  text: string,
  baseUrl: string,
  limit = 200
): SweepCandidate[] {
  if (!text || text.length > 8 * 1024 * 1024) return [];
  const out: SweepCandidate[] = [];
  const seen = new Set<string>();
  let m: RegExpExecArray | null;
  STRING_LITERAL.lastIndex = 0;
  while ((m = STRING_LITERAL.exec(text)) !== null) {
    const raw = m[2] || '';
    // 先按扩展名粗筛：绝大多数字符串字面量是文案、选择器、类名
    if (!SCRIPT_MEDIA_EXT.test(raw)) continue;
    const url = resolveAgainstBase(raw, baseUrl);
    if (!url || seen.has(url)) continue;
    const cls = classifyNetworkMedia(url);
    if (!cls.kind) continue;
    if (!acceptableMediaUrl(url)) continue;
    seen.add(url);
    out.push({ url, kind: cls.kind, via: 'deep', extension: cls.extension || extFromUrl(url) });
    if (out.length >= limit) break;
  }
  return out;
}

/** 资源账本条目 → 候选（含 Cache Storage 里只给了 URL 的情况：size 缺省即可） */
export function mediaUrlsFromResourceEntries(entries: ResourceTimingLike[], limit = 500): SweepCandidate[] {
  const out: SweepCandidate[] = [];
  const seen = new Set<string>();
  for (const e of entries || []) {
    const url = e && typeof e.name === 'string' ? e.name : '';
    if (!url || seen.has(url)) continue;
    const cls = classifyNetworkMedia(url);
    if (!cls.kind) continue;
    if (!acceptableMediaUrl(url)) continue;
    seen.add(url);
    const size = typeof e.encodedBodySize === 'number' && e.encodedBodySize > 0 ? e.encodedBodySize : undefined;
    out.push({ url, kind: cls.kind, via: 'cache', extension: cls.extension || extFromUrl(url), size });
    if (out.length >= limit) break;
  }
  return out;
}

/** 候选去重键：与 capture.ts 的 sourceKey 同口径（完整 URL 去 hash） */
export function candidateKey(url: string): string {
  return (url || '').split('#')[0];
}

/**
 * 过滤出真正新增的候选：URL 已在存量里的不再入库（交给 backfillSweepRecords 补字段）。
 * 纯函数，不改任何入参。
 */
export function filterNewCandidates(found: SweepCandidate[], existingUrls: Iterable<string>): SweepCandidate[] {
  const known = new Set<string>();
  for (const url of existingUrls) known.add(candidateKey(url));
  const out: SweepCandidate[] = [];
  const batch = new Set<string>();
  for (const c of found) {
    const key = candidateKey(c.url);
    if (known.has(key) || batch.has(key)) continue;
    batch.add(key);
    out.push(c);
  }
  return out;
}

/** 存量条目可被补齐的字段形状 */
export interface SweepRecordLike {
  url: string;
  size?: number;
  mimeType?: string;
  extension?: string;
}

/**
 * 已有同 URL 条目时只补缺失字段（就地修改，返回被补条数）。
 * 嗅探实测的 MIME/体积优先于账本推断，所以只写 undefined 的位置、绝不覆盖已有值。
 */
export function backfillSweepRecords<T extends SweepRecordLike>(existing: T[], found: SweepCandidate[]): number {
  const byKey = new Map(existing.map((s) => [candidateKey(s.url), s]));
  let filled = 0;
  for (const c of found) {
    const hit = byKey.get(candidateKey(c.url));
    if (!hit) continue;
    let changed = false;
    if (hit.size === undefined && c.size !== undefined) { hit.size = c.size; changed = true; }
    if (!hit.mimeType && c.mimeType) { hit.mimeType = c.mimeType; changed = true; }
    if (!hit.extension && c.extension) { hit.extension = c.extension; changed = true; }
    if (changed) filled++;
  }
  return filled;
}

/**
 * 深度搜索的抓取清单。
 * initiatorType==='script' 只覆盖经典 `<script src>`：现代打包器用 import()/fetch 装载 chunk，
 * 计时类型是 'other'/'fetch'，只认 script 会漏掉最该扫的那批代码。
 * 故以「路径形态像 JS」为主判据，script 类型兜底（打包 chunk 常无后缀）。
 */
export function scriptUrlsFromResourceEntries(entries: ResourceTimingLike[], limit = 40): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const e of entries || []) {
    const url = e && typeof e.name === 'string' ? e.name : '';
    if (!url || seen.has(url)) continue;
    if (!/^https?:/i.test(url)) continue;
    if (!isJavaScriptResource(url, e.initiatorType)) continue;
    try {
      if (isBlockedHost(new URL(url).hostname)) continue;
    } catch {
      continue;
    }
    seen.add(url);
    out.push(url);
    if (out.length >= limit) break;
  }
  return out;
}

/** 去掉 query/hash 后看路径形态是否像 JS（.js/.mjs/.esm/无后缀的 *.chunk） */
function isJsPath(url: string): boolean {
  try {
    const p = new URL(url).pathname;
    return /\.(m?js|esm)$/i.test(p) || /\.chunk$/i.test(p);
  } catch {
    return false;
  }
}

/** 资源是否值得当作脚本抓取 */
function isJavaScriptResource(url: string, initiatorType?: string): boolean {
  if (initiatorType === 'script') return !/\.json$/i.test(url.split('?')[0]);
  return isJsPath(url);
}
