/**
 * WebRTC 录流（Round 5 #30）——纯逻辑层。
 *
 * 可行性结论（决定了这里的建模方式）：
 *  - RTCPeerConnection 是页面世界（MAIN）的 API，ISOLATED 内容脚本看不见页面创建的实例，
 *    所以必须在 document_start 注入 MAIN 世界脚本挂钩构造函数；
 *  - MediaStream 不能跨世界传递，因此 MediaRecorder 只能活在 MAIN 世界，产物转 base64 后
 *    经 window.postMessage 交给 ISOLATED 桥接脚本，再走已有的 CAPTURE_RECORDING_CHUNK/DONE
 *    链路落 IndexedDB；
 *  - window.postMessage 不是信任边界：页面自己也能读写这条总线。所以"谁能往录制成果库里
 *    写东西"由后台裁定——只接受后台自己发起的 recordId，且发送方 tab 必须匹配。
 *    页面伪造的 start/chunk 最多浪费一点 CPU，不会污染用户的成果列表。
 *
 * 本模块不做任何 IO，只负责消息校验、流清单归一化与封装格式选择，便于 node 环境单测。
 */

/** window.postMessage 总线上的来源标记（双向共用，便于双方过滤无关消息） */
export const RTC_BRIDGE_SOURCE = 'mediaplus-webrtc';

/** 一路轨道的摘要（只取展示与录制需要的字段，不传 MediaStreamTrack 本体） */
export interface RtcTrackInfo {
  kind: 'audio' | 'video';
  id: string;
  /** 轨道标签，通常为空（隐私限制），仅作展示兜底 */
  label: string;
  enabled: boolean;
  muted: boolean;
  readyState: string;
}

/** 一路可录制的 WebRTC 流 */
export interface RtcStreamInfo {
  /** MediaStream.id */
  id: string;
  /** 所属 RTCPeerConnection 序号（页面内自增，便于用户辨认第几路通话） */
  connectionId: number;
  /** 远端（对端推来的）才是录制目标；本地采集流不录 */
  direction: 'remote' | 'local';
  kind: 'video' | 'audio' | 'mixed';
  tracks: RtcTrackInfo[];
  discoveredAt: number;
}

/** 随首块上送的产物元数据（与后台 CaptureRecordingMeta 同形） */
export interface RtcRecordMeta {
  id: string;
  mode: 'video' | 'audio';
  mimeType: string;
  fileName: string;
  sizeBytes: number;
  durationMs: number;
  createdAt: number;
  sourceTitle?: string;
  sourceUrl?: string;
}

/** MAIN → ISOLATED 的上行事件 */
export type RtcUpEvent =
  | { kind: 'hello'; streams: RtcStreamInfo[] }
  | { kind: 'streams'; streams: RtcStreamInfo[] }
  | { kind: 'chunk'; recordId: string; seq: number; data: string; meta?: RtcRecordMeta }
  | { kind: 'done'; recordId: string; total: number; durationMs: number; sizeBytes: number }
  | { kind: 'status'; recordId: string; state: 'recording' | 'stopped' | 'error'; error?: string };

/** ISOLATED → MAIN 的下行命令 */
export type RtcDownCommand =
  | { kind: 'list' }
  | { kind: 'start'; recordId: string; streamId: string; mode: 'video' | 'audio'; fileName: string }
  | { kind: 'stop'; recordId: string };

/** 上行事件校验：页面也能往总线发消息，结构不对的一律丢弃 */
export function parseRtcUpEvent(raw: unknown): RtcUpEvent | null {
  if (!raw || typeof raw !== 'object') return null;
  const m = raw as Record<string, unknown>;
  if (m.source !== RTC_BRIDGE_SOURCE || m.dir !== 'up') return null;
  switch (m.kind) {
    case 'hello':
    case 'streams': {
      const list = Array.isArray(m.streams)
        ? m.streams.map(normalizeRtcStream).filter((x): x is RtcStreamInfo => !!x)
        : [];
      return { kind: m.kind, streams: list };
    }
    case 'chunk': {
      if (typeof m.recordId !== 'string' || !m.recordId) return null;
      if (typeof m.seq !== 'number' || !Number.isInteger(m.seq) || m.seq < 0) return null;
      if (typeof m.data !== 'string') return null;
      const meta = normalizeRtcMeta(m.meta);
      return { kind: 'chunk', recordId: m.recordId, seq: m.seq, data: m.data, meta: meta || undefined };
    }
    case 'done': {
      if (typeof m.recordId !== 'string' || !m.recordId) return null;
      const total = Number(m.total);
      if (!Number.isInteger(total) || total < 0) return null;
      return {
        kind: 'done',
        recordId: m.recordId,
        total,
        durationMs: Number(m.durationMs) || 0,
        sizeBytes: Number(m.sizeBytes) || 0
      };
    }
    case 'status': {
      if (typeof m.recordId !== 'string' || !m.recordId) return null;
      if (m.state !== 'recording' && m.state !== 'stopped' && m.state !== 'error') return null;
      return { kind: 'status', recordId: m.recordId, state: m.state, error: typeof m.error === 'string' ? m.error : undefined };
    }
    default:
      return null;
  }
}

/** 下行命令校验（MAIN 世界侧用；同样不信任总线） */
export function parseRtcDownCommand(raw: unknown): RtcDownCommand | null {
  if (!raw || typeof raw !== 'object') return null;
  const m = raw as Record<string, unknown>;
  if (m.source !== RTC_BRIDGE_SOURCE || m.dir !== 'down') return null;
  if (m.kind === 'list') return { kind: 'list' };
  if (m.kind === 'start') {
    if (typeof m.recordId !== 'string' || !m.recordId) return null;
    if (typeof m.streamId !== 'string' || !m.streamId) return null;
    if (m.mode !== 'video' && m.mode !== 'audio') return null;
    return {
      kind: 'start',
      recordId: m.recordId,
      streamId: m.streamId,
      mode: m.mode,
      fileName: typeof m.fileName === 'string' && m.fileName ? m.fileName : 'webrtc'
    };
  }
  if (m.kind === 'stop') {
    if (typeof m.recordId !== 'string' || !m.recordId) return null;
    return { kind: 'stop', recordId: m.recordId };
  }
  return null;
}

/** 把任意对象归一化为流摘要；缺 id / 无有效轨道的丢弃 */
export function normalizeRtcStream(raw: unknown): RtcStreamInfo | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== 'string' || !r.id) return null;
  const tracks = Array.isArray(r.tracks)
    ? r.tracks.map(normalizeRtcTrack).filter((x): x is RtcTrackInfo => !!x)
    : [];
  if (!tracks.length) return null;
  return {
    id: r.id,
    connectionId: Number.isFinite(Number(r.connectionId)) ? Number(r.connectionId) : 0,
    direction: r.direction === 'local' ? 'local' : 'remote',
    kind: classifyStreamKind(tracks),
    tracks,
    discoveredAt: Number(r.discoveredAt) || 0
  };
}

function normalizeRtcTrack(raw: unknown): RtcTrackInfo | null {
  if (!raw || typeof raw !== 'object') return null;
  const t = raw as Record<string, unknown>;
  if (t.kind !== 'audio' && t.kind !== 'video') return null;
  if (typeof t.id !== 'string' || !t.id) return null;
  return {
    kind: t.kind,
    id: t.id,
    label: typeof t.label === 'string' ? t.label : '',
    enabled: t.enabled !== false,
    muted: t.muted === true,
    readyState: typeof t.readyState === 'string' ? t.readyState : 'live'
  };
}

function normalizeRtcMeta(raw: unknown): RtcRecordMeta | null {
  if (!raw || typeof raw !== 'object') return null;
  const m = raw as Record<string, unknown>;
  if (typeof m.id !== 'string' || !m.id) return null;
  if (m.mode !== 'video' && m.mode !== 'audio') return null;
  return {
    id: m.id,
    mode: m.mode,
    mimeType: typeof m.mimeType === 'string' ? m.mimeType : 'video/webm',
    fileName: typeof m.fileName === 'string' ? m.fileName : 'webrtc.webm',
    sizeBytes: Number(m.sizeBytes) || 0,
    durationMs: Number(m.durationMs) || 0,
    createdAt: Number(m.createdAt) || 0,
    sourceTitle: typeof m.sourceTitle === 'string' ? m.sourceTitle : undefined,
    sourceUrl: typeof m.sourceUrl === 'string' ? m.sourceUrl : undefined
  };
}

/** 只有音频轨 → audio；只有视频轨 → video；两者都有 → mixed */
export function classifyStreamKind(tracks: RtcTrackInfo[]): 'video' | 'audio' | 'mixed' {
  const hasVideo = tracks.some((t) => t.kind === 'video');
  const hasAudio = tracks.some((t) => t.kind === 'audio');
  if (hasVideo && hasAudio) return 'mixed';
  return hasVideo ? 'video' : 'audio';
}

/**
 * 合并流清单：按 id 去重（同一路流会因多个 track 事件重复上报），
 * 只保留远端且仍有 live 轨道的流。
 */
export function mergeRtcStreams(existing: RtcStreamInfo[], incoming: RtcStreamInfo[]): RtcStreamInfo[] {
  const byId = new Map<string, RtcStreamInfo>();
  for (const s of existing) byId.set(s.id, s);
  for (const s of incoming) byId.set(s.id, s);
  return [...byId.values()].filter((s) => s.direction === 'remote' && s.tracks.some((t) => t.readyState === 'live'));
}

/** 封装格式候选：按兼容性/体积排序，第一个被支持的即用 */
export const RTC_VIDEO_MIMES = [
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm;codecs=h264,opus',
  'video/webm',
  'video/mp4'
];
export const RTC_AUDIO_MIMES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/mp4',
  'audio/ogg;codecs=opus'
];

/**
 * 选一个浏览器支持的封装格式。
 * isTypeSupported 由调用方注入（MAIN 世界传 MediaRecorder.isTypeSupported，单测传假实现）。
 * 全不支持时返回空串——调用方据此报错，而不是硬写一个浏览器不认的 mime 让录制静默失败。
 */
export function pickRtcMime(mode: 'video' | 'audio', isTypeSupported: (mime: string) => boolean): string {
  const list = mode === 'audio' ? RTC_AUDIO_MIMES : RTC_VIDEO_MIMES;
  for (const mime of list) {
    try { if (isTypeSupported(mime)) return mime; } catch { /* 某些实现对未知 mime 抛错，继续试下一个 */ }
  }
  return '';
}

/** 产物文件名：标题 + 模式 + 时间戳，扩展名跟随实际封装 */
export function buildRtcFileName(title: string, mode: 'video' | 'audio', mime: string, now: number): string {
  // eslint-disable-next-line no-control-regex -- 控制字符在 Windows 文件名里非法，且会污染下载名
  const base = (title || 'webrtc').replace(/[<>:"/\\|?*\x00-\x1f]/g, '').trim().slice(0, 60) || 'webrtc';
  const d = new Date(now);
  const pad = (n: number) => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  const ext = mime.startsWith('audio/') ? (mime.includes('ogg') ? 'ogg' : 'webm') : (mime.startsWith('video/mp4') ? 'mp4' : 'webm');
  return `${base}_${mode === 'audio' ? 'audio' : 'video'}_${stamp}.${ext}`;
}

/** 面板一行摘要：第几路连接 / 类型 / 轨道数 */
export function describeRtcStream(s: RtcStreamInfo): string {
  const kindText = s.kind === 'mixed' ? '音视频' : s.kind === 'video' ? '视频' : '音频';
  const muted = s.tracks.every((t) => t.muted) ? '（静音中）' : '';
  return `连接 #${s.connectionId} · ${kindText} · ${s.tracks.length} 轨${muted}`;
}

/** 录制 id：后台生成，页面无法预先知道，因此伪造的分块进不了成果库 */
export function makeRtcRecordId(now: number, rand: number): string {
  return `rtc_${now.toString(36)}_${Math.floor(rand * 1e6).toString(36)}`;
}

/** 上送分块大小：与既有录制交接链路一致（512KB），避免单条消息过大 */
export const RTC_CHUNK_BYTES = 512 * 1024;

/**
 * ArrayBuffer → base64（分片 btoa）。
 * 一次性 String.fromCharCode(...bytes) 在几百 KB 上就会栈溢出，必须切片。
 */
export function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = '';
  const SLICE = 0x8000;
  for (let i = 0; i < bytes.length; i += SLICE) {
    binary += String.fromCharCode(...bytes.subarray(i, i + SLICE));
  }
  return btoa(binary);
}