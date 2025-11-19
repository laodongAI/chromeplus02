/**
 * 网络媒体捕获（基于 chrome.webRequest）。
 * 目标：捕获视频直链候选（mp4/webm/mkv/mov/ts/m3u8/mpd/m4s/flv），
 * 并提供按 tabId/frameId 查询的消息接口：GET_CAPTURED_VIDEO_SOURCES。
 */

 type CapturedSource = {
  url: string;
  mimeType?: string;
  extension?: string;
  size?: number;
  via: 'network';
  tabId: number;
  frameId?: number;
  time: number;
};

 const MEDIA_EXT = /\.(mp4|webm|mkv|mov|m3u8|flv|ts|m4s|mpd)(?:$|[?#])/i;
 const HLS_CT = /application\/(vnd\.apple\.mpegurl|x-mpegURL)/i;
 const DASH_CT = /application\/dash\+xml/i;
 const VIDEO_CT = /^video\//i;
 const AUDIO_CT = /^audio\//i;

 // tabId -> frameId -> list
 const store = new Map<number, Map<number | 'top', CapturedSource[]>>();
 let installed = false;

 export function initCaptureHandlers() {
  if (installed) return; installed = true;
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
    try { console.warn('[bg.capture] 注册 onCompleted 失败:', e); } catch { /* noop */ }
  }

  try {
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (!message || !message.type) return;
      if (message.type === 'GET_CAPTURED_VIDEO_SOURCES') {
        const tabId: number | undefined = typeof message.tabId === 'number' ? message.tabId : undefined;
        const frameId: number | undefined = typeof message.frameId === 'number' ? message.frameId : undefined;
        const sources = queryCaptured(tabId, frameId);
        sendResponse({ success: true, sources });
        return true;
      }
      return undefined;
    });
  } catch (e) {
    try { console.warn('[bg.capture] 注册 runtime 消息失败:', e); } catch { /* noop */ }
  }
 }

 function handleCompleted(details: chrome.webRequest.WebResponseCacheDetails) {
  const { url, tabId, frameId, responseHeaders } = details as any;
  if (typeof tabId !== 'number' || !url) return;

  const ct = getHeader(responseHeaders, 'content-type');
  const lenStr = getHeader(responseHeaders, 'content-length');
  const size = typeof lenStr === 'string' ? Number(lenStr) : undefined;

  // 判断是否为可能的视频/音频/流媒体
  const isMediaByExt = MEDIA_EXT.test(url);
  const isMediaByCT = !!(ct && (VIDEO_CT.test(ct) || AUDIO_CT.test(ct) || HLS_CT.test(ct) || DASH_CT.test(ct)));
  if (!isMediaByExt && !isMediaByCT) return;

  const ext = inferExtension(url, ct);
  const entry: CapturedSource = {
    url,
    mimeType: ct,
    extension: ext,
    size: Number.isFinite(size!) ? size : undefined,
    via: 'network',
    tabId,
    frameId: typeof frameId === 'number' ? frameId : undefined,
    time: Date.now()
  };
  record(entry);
 }

 function record(item: CapturedSource) {
  const frameKey: number | 'top' = typeof item.frameId === 'number' ? item.frameId : 'top';
  if (!store.has(item.tabId)) store.set(item.tabId, new Map());
  const perTab = store.get(item.tabId)!;
  if (!perTab.has(frameKey)) perTab.set(frameKey, []);
  const list = perTab.get(frameKey)!;
  // 去重依据：去掉 hash 的 URL
  const key = stripHash(item.url);
  if (list.some((s) => stripHash(s.url) === key)) return;
  list.push(item);
  // 限制每帧存量，防止无限增长
  if (list.length > 300) list.splice(0, list.length - 300);
 }

 function queryCaptured(tabId?: number, frameId?: number) {
  const out: { url: string; mimeType?: string; extension?: string; size?: number; via: string }[] = [];
  const add = (s: CapturedSource) => out.push({ url: s.url, mimeType: s.mimeType, extension: s.extension, size: s.size, via: 'network' });
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

 function dedupe(arr: { url: string }[]) {
  const seen = new Set<string>();
  return arr.filter((s) => {
    const key = stripHash(s.url);
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

 function inferExtension(url: string, ct?: string): string | undefined {
  try {
    const m = url.split('?')[0].split('#')[0].match(/\.([a-z0-9]{2,5})$/i);
    if (m) return m[1].toLowerCase();
  } catch { /* noop */ }
  if (!ct) return undefined;
  if (/mp4/i.test(ct)) return 'mp4';
  if (/webm/i.test(ct)) return 'webm';
  if (/matroska|mkv/i.test(ct)) return 'mkv';
  if (/quicktime|mov/i.test(ct)) return 'mov';
  if (HLS_CT.test(ct)) return 'm3u8';
  if (DASH_CT.test(ct)) return 'mpd';
  if (/mpegurl/i.test(ct)) return 'm3u8';
  return undefined;
 }

 function stripHash(u: string) {
  try { return u.split('#')[0]; } catch { return u; }
 }
