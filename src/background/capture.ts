/**
 * 网络媒体捕获（基于 chrome.webRequest）。
 * 目标：捕获视频/音频直链与 HLS/DASH 流候选，并标记类型（kind）；
 * 提供按 tabId/frameId 查询的消息接口：GET_CAPTURED_VIDEO_SOURCES。
 * 分类逻辑见 utils/mediaType.ts（纯函数，含单测）。
 */

import { classifyNetworkMedia, extFromUrl } from '@/utils/mediaType';
import { registerBgHandler } from './bus';

export type CapturedKind = 'video' | 'audio' | 'hls' | 'dash';

type CapturedSource = {
  url: string;
  kind: CapturedKind;
  mimeType?: string;
  extension?: string;
  size?: number;
  via: 'network';
  tabId: number;
  frameId?: number;
  time: number;
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
    const key = stripHash(s.url);
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
    try { console.warn('[bg.capture] 注册 onCompleted 失败:', e); } catch { /* noop */ }
  }

  // 标签页关闭时清理嗅探缓存，防止内存累积
  try {
    chrome.tabs.onRemoved.addListener((tabId) => { store.delete(tabId); });
  } catch { /* noop */ }

  registerBgHandler('GET_CAPTURED_VIDEO_SOURCES', (message) => {
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
    time: Date.now()
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
  // 去重依据：去掉 hash 的 URL
  const key = stripHash(item.url);
  if (list.some((s) => stripHash(s.url) === key)) return;
  list.push(item);
  // 限制每帧存量，防止无限增长
  if (list.length > 300) list.splice(0, list.length - 300);
}

function queryCaptured(tabId?: number, frameId?: number) {
  const out: { url: string; kind: CapturedKind; mimeType?: string; extension?: string; size?: number; via: string }[] = [];
  const add = (s: CapturedSource) => out.push({ url: s.url, kind: s.kind, mimeType: s.mimeType, extension: s.extension, size: s.size, via: 'network' });
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

function stripHash(u: string) {
  try { return u.split('#')[0]; } catch { return u; }
}
