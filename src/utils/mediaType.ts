/**
 * 网络媒体资源分类（纯函数，无 chrome API 依赖，可单测）。
 * 依据 URL 扩展名与 Content-Type 判定媒体类型：video / audio / hls / dash。
 */

export type NetworkMediaKind = 'video' | 'audio' | 'hls' | 'dash';

export interface NetworkMediaClass {
  kind: NetworkMediaKind | null;
  /** 从 URL 路径或 Content-Type 推断的扩展名 */
  extension?: string;
}

/** 视频类扩展名（含 HLS/DASH 分片 ts、m4s） */
const VIDEO_EXTS = new Set(['mp4', 'webm', 'mkv', 'mov', 'flv', 'ts', 'm4s']);
const AUDIO_EXTS = new Set(['mp3', 'm4a', 'aac', 'flac', 'wav', 'ogg', 'opus']);
const HLS_EXT = 'm3u8';
const DASH_EXT = 'mpd';

/** 从 URL 路径提取扩展名（忽略 query/hash） */
export function extFromUrl(url: string): string | undefined {
  try {
    const clean = (url || '').split('?')[0].split('#')[0];
    const m = clean.match(/\.([a-z0-9]{2,5})$/i);
    return m ? m[1].toLowerCase() : undefined;
  } catch {
    return undefined;
  }
}

function extFromContentType(ct?: string): string | undefined {
  if (!ct) return undefined;
  const c = ct.toLowerCase();
  if (/vnd\.apple\.mpegurl|x-mpegurl|mpegurl/.test(c)) return HLS_EXT;
  if (/dash\+xml/.test(c)) return DASH_EXT;
  if (/mp4/.test(c)) return 'mp4';
  if (/webm/.test(c)) return 'webm';
  if (/matroska|mkv/.test(c)) return 'mkv';
  if (/quicktime|mov/.test(c)) return 'mov';
  return undefined;
}

/**
 * 分类网络媒体资源。
 * 规则：扩展名优先（可识别 .m3u8/.mpd/常见音视频），其次 Content-Type。
 * 返回 kind=null 表示非媒体资源。
 */
export function classifyNetworkMedia(url: string, contentType?: string): NetworkMediaClass {
  const ext = extFromUrl(url);
  let kind: NetworkMediaKind | null = null;
  if (ext === HLS_EXT) kind = 'hls';
  else if (ext === DASH_EXT) kind = 'dash';
  else if (ext && VIDEO_EXTS.has(ext)) kind = 'video';
  else if (ext && AUDIO_EXTS.has(ext)) kind = 'audio';

  if (!kind && contentType) {
    const c = contentType.toLowerCase();
    if (/vnd\.apple\.mpegurl|x-mpegurl|mpegurl/.test(c)) kind = 'hls';
    else if (/dash\+xml/.test(c)) kind = 'dash';
    else if (/^video\//.test(c)) kind = 'video';
    else if (/^audio\//.test(c)) kind = 'audio';
  }

  return { kind, extension: ext || extFromContentType(contentType) };
}
