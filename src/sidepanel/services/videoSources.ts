import { MessageType, type VideoSourcesResponse } from '@/messaging';
import { sendMessageToTab, sendRuntimeMessage, getActiveTabId } from '../utils/chromeMessaging';
// P1-8：分级日志（扩展页面上下文默认 info 级）
import { createLogger } from '@/utils/logger';

/** 本模块 logger：保留原 `[videoSources]` 前缀语义 */
const log = createLogger('videoSources');

// 定义VideoSourceItem类型
export interface VideoSourceItem {
  url: string;
  mimeType?: string;
  extension?: string;
  size?: number;
  via?: string;
  kind?: 'video' | 'audio' | 'hls' | 'dash';
  /** 只能录制、无法直链取回的流（YouTube SABR/UMP） */
  streamOnly?: boolean;
}

// 优先级扩展名顺序
const PRIORITY_EXT = ['mp4','webm','mkv','mov','m3u8','flv','ts'];

export interface DownloadResult { success: boolean; fileName?: string; error?: string; }

/** REQUEST_VIDEO_SOURCES 的应答：失败形态只有 success/error，没有 sources */
type VideoSourcesReply = {
  success?: boolean;
  error?: string;
  sources?: VideoSourcesResponse['sources'];
  meta?: Record<string, any>;
};

export async function fetchVideoSources(index: number, frameId?: number): Promise<VideoSourcesResponse> {
  const tabId = await getActiveTabId();
  if(!tabId) return { sources: [], meta: { error: 'No active tab' } };
  try {
    const resp = await sendMessageToTab<VideoSourcesReply>(tabId, { type: MessageType.REQUEST_VIDEO_SOURCES, index }, { frameId });
    // 目标元素已不在 DOM（SPA 导航/懒卸载）：明确失败。
    // 此时若继续用网络嗅探结果顶上，等于拿同 frame 里别的视频冒充用户选中的这一个。
    if (resp?.success === false) {
      return { sources: [], meta: { error: resp.error || '未找到该视频元素，请重新扫描后再试' } };
    }
    const domSources: VideoSourceItem[] = Array.isArray(resp?.sources) ? resp.sources.map(s=>({ ...s, via: s.via || 'dom'})) : [];
    // 网络嗅探按 frame 收窄：别的 frame 里的媒体属于别的视频，不能混进当前候选
    const networkResp: any = await sendRuntimeMessage({ type: MessageType.GET_CAPTURED_VIDEO_SOURCES, tabId, frameId });
    const networkSources: VideoSourceItem[] = Array.isArray(networkResp?.sources) ? networkResp.sources.map((s:any)=>({ url:s.url, mimeType:s.mimeType, extension:s.extension, size:s.size, via: s.via||'network', kind: s.kind, streamOnly: s.streamOnly })) : [];
    // 同 frame 内仍无法按元素区分（信息流页面所有视频共用 frameId 0），
    // 故网络候选按新近优先排列，作为 DOM 只有 blob:/MSE 句柄时的补充池
    networkSources.reverse();
    return { sources: mergeVideoSources(domSources, networkSources), meta: resp?.meta || {} };
  } catch(e){
    log.warn('fetch error', e);
    return { sources: [], meta: { error: String(e) } };
  }
}

/**
 * 合并 DOM 与网络两路候选，DOM 优先。
 *
 * DOM 候选来自用户选中的那个 video 元素（currentSrc / src / <source>），是唯一能确定归属的证据；
 * 网络嗅探是整个 frame 的，只能作为 DOM 仅有 blob:/MSE 句柄时的补充。
 * 旧实现把网络候选排在前面，信息流页面点第 3 个视频会下到最后嗅探到的那一条（往往是别的视频），
 * 当时用 reverse() 缓解"下到老视频"只是治症状，没解决归属问题。
 *
 * 同 URL 重复时保留首次出现的位置，但补齐后到候选的元数据：
 * DOM 侧拿不到 kind，若直接丢弃网络那条的 'hls'/'dash' 标记，分段流会被当成直链下载而失败。
 */
export function mergeVideoSources(dom: VideoSourceItem[], network: VideoSourceItem[]): VideoSourceItem[] {
  const byUrl = new Map<string, VideoSourceItem>();
  for (const s of [...dom, ...network]) {
    if (!s?.url) continue;
    const key = s.url.split('#')[0];
    const prev = byUrl.get(key);
    if (!prev) { byUrl.set(key, { ...s }); continue; }
    if (prev.kind === undefined) prev.kind = s.kind;
    if (prev.mimeType === undefined) prev.mimeType = s.mimeType;
    if (prev.extension === undefined) prev.extension = s.extension;
    if (prev.size === undefined) prev.size = s.size;
    if (prev.streamOnly === undefined) prev.streamOnly = s.streamOnly;
  }
  return Array.from(byUrl.values());
}

/**
 * 该候选能否作为独立文件取回。
 * blob:/mediasource: 是 MSE 内存句柄，streamOnly 是 YouTube SABR 这类专有推送流，
 * 两者都只能靠录制保存，直链下载必然失败。
 */
export function isDownloadableSource(source: VideoSourceItem): boolean {
  if (source.streamOnly) return false;
  return !/^(blob|mediasource):/i.test(source.url || '');
}

export function pickBestCandidate(sources: VideoSourceItem[]): VideoSourceItem | null {
  if(!sources.length) return null;
  const weighted = sources.map(s=>({ s, w: weightForSource(s) }));
  weighted.sort((a,b)=> a.w - b.w);
  return weighted[0].s;
}

function weightForSource(source: VideoSourceItem){
  // 不可直链的候选排到最后：有可下载直链时绝不选中 blob/SABR 流
  if (!isDownloadableSource(source)) return PRIORITY_EXT.length + 1;
  const ext = (source.extension || guessExtensionFromUrl(source.url)).toLowerCase();
  const idx = PRIORITY_EXT.indexOf(ext);
  return idx === -1 ? PRIORITY_EXT.length : idx;
}

export async function triggerDirectVideoDownload(index: number, candidate: VideoSourceItem, meta: Record<string,any> = {}): Promise<DownloadResult> {
  const fileName = buildVideoDownloadFileName(index, candidate, meta);
  try {
    const resp: any = await sendRuntimeMessage({ type: MessageType.DIRECT_VIDEO_DOWNLOAD, payload: { url: candidate.url, fileName } });
    if(!resp?.success) return { success:false, error: resp?.error || '下载触发失败' };
    return { success:true, fileName };
  } catch(e){
    return { success:false, error: String(e) };
  }
}

export function buildVideoDownloadFileName(index: number, candidate: VideoSourceItem, meta: Record<string, any>): string {
  const now = new Date();
  const date = now.toISOString().split('T')[0];
  const time = now.toTimeString().split(' ')[0].replace(/:/g,'');
  const site = meta.siteName || 'site';
  const titleRaw = meta.title || `video_${index}`;
  const safeTitle = titleRaw.replace(/[\\/:*?"<>|]/g,'_');
  const ext = (candidate.extension || guessExtensionFromUrl(candidate.url) || 'mp4').replace(/\./g,'').toLowerCase();
  return `${site}_${safeTitle}_${date}_${time}_${index}.${ext}`;
}

function guessExtensionFromUrl(url: string): string {
  try {
    const clean = url.split('?')[0].split('#')[0];
    const m = clean.match(/\.([a-z0-9]{2,5})$/i);
    return m ? m[1].toLowerCase() : '';
  } catch { return ''; }
}