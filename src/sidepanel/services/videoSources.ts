import { MessageType, type VideoSourcesResponse } from '@/messaging';
import { sendMessageToTab, sendRuntimeMessage, getActiveTabId } from '../utils/chromeMessaging';

// 定义VideoSourceItem类型
interface VideoSourceItem {
  url: string;
  mimeType?: string;
  extension?: string;
  size?: number;
  via?: string;
  kind?: 'video' | 'audio' | 'hls' | 'dash';
}

// 优先级扩展名顺序
const PRIORITY_EXT = ['mp4','webm','mkv','mov','m3u8','flv','ts'];

export interface DownloadResult { success: boolean; fileName?: string; error?: string; }

export async function fetchVideoSources(index: number, frameId?: number): Promise<VideoSourcesResponse> {
  const tabId = await getActiveTabId();
  if(!tabId) return { sources: [], meta: { error: 'No active tab' } };
  try {
    const resp = await sendMessageToTab<VideoSourcesResponse & { meta?: any }>(tabId, { type: MessageType.REQUEST_VIDEO_SOURCES, index }, { frameId });
    const networkResp: any = await sendRuntimeMessage({ type: 'GET_CAPTURED_VIDEO_SOURCES', tabId });
    const networkSources: VideoSourceItem[] = Array.isArray(networkResp?.sources) ? networkResp.sources.map((s:any)=>({ url:s.url, mimeType:s.mimeType, extension:s.extension, size:s.size, via: s.via||'network', kind: s.kind })) : [];
    // Reverse network sources to prioritize the most recently captured ones (fixes issue where scrolling on feeds downloads old video)
    networkSources.reverse();
    const domSources: VideoSourceItem[] = Array.isArray(resp?.sources) ? resp.sources.map(s=>({ ...s, via: s.via || 'dom'})) : [];
    const merged = dedupeVideoSources([...networkSources, ...domSources]);
    return { sources: merged, meta: resp?.meta || {} };
  } catch(e){
    console.warn('[videoSources] fetch error', e);
    return { sources: [], meta: { error: String(e) } };
  }
}

export function pickBestCandidate(sources: VideoSourceItem[]): VideoSourceItem | null {
  if(!sources.length) return null;
  const weighted = sources.map(s=>({ s, w: weightForSource(s) }));
  weighted.sort((a,b)=> a.w - b.w);
  return weighted[0].s;
}

function weightForSource(source: VideoSourceItem){
  const ext = (source.extension || guessExtensionFromUrl(source.url)).toLowerCase();
  const idx = PRIORITY_EXT.indexOf(ext);
  return idx === -1 ? PRIORITY_EXT.length : idx;
}

function dedupeVideoSources(sources: VideoSourceItem[]): VideoSourceItem[] {
  const seen = new Set<string>();
  return sources.filter(s=>{
    const key = s.url.split('#')[0];
    if(seen.has(key)) return false;
    seen.add(key);
    return true;
  });
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