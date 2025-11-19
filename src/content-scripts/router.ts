/**
 * 内容脚本适配器路由：根据页面 URL 选择合适的站点适配器。
 */
import type { SiteAdapter } from './types';
import { bilibiliAdapter } from './adapters/bilibili';
import { youtubeAdapter } from './adapters/youtube';
import { douyinAdapter } from './adapters/douyin';
import { scanAudioUrls } from './audio';
import type { AudioItem } from './audio';
import { scanImages } from './images';
import type { ImageScanItem } from './images';
import { MessageType, type VideoItemDTO, type VideoSourceCandidate, type VideoControlAction, type PongMessage } from '@/messaging';

// 全局自动扫描开关缓存（来自存储），供增量观察函数使用
let autoScanEnabledGlobal = false;

// 录制状态缓存
interface ActiveRecording { recorder: MediaRecorder; mode: 'video'|'audio'; startedAt: number; chunks: BlobPart[]; }
const activeRecordings: Record<number, ActiveRecording> = {};

// ============== 稳定视频索引支持 ==============
// 通过 WeakMap 记录已见过的视频元素与其稳定 ID，避免 DOM 重排导致索引漂移。
const stableVideoIdMap = new WeakMap<HTMLVideoElement, number>();
const reverseVideoMap: Record<number, HTMLVideoElement> = {};
let nextStableVideoId = 0;
function getStableVideoId(el: HTMLVideoElement): number {
  let id = stableVideoIdMap.get(el);
  if (typeof id === 'number') return id;
  id = nextStableVideoId++;
  stableVideoIdMap.set(el, id);
  reverseVideoMap[id] = el;
  return id;
}

const ADAPTERS: SiteAdapter[] = [bilibiliAdapter, youtubeAdapter, douyinAdapter];

export function pickAdapter(loc: Location = window.location): SiteAdapter | null {
  for (const a of ADAPTERS) {
    try {
      if (a.isMatch(loc)) return a;
    } catch (e) { /* noop */ }
  }
  return null;
}

export function initContentScript() {
  const features = {
    video: false,
    image: false,
    audio: false,
    playbackEvents: false,
    spaWatchers: false
  } as Record<string, boolean>;
  loadAutoScanSetting().then(v => { autoScanEnabledGlobal = v; tryInstallDynamicWatchers(features); });

  const adapter = pickAdapter();
  if (!adapter) {
    console.log('[content/router] 未匹配任何站点适配器，启用通用模式');
  } else {
    const info = adapter.getPageInfo();
    console.log('[content/router] 适配器:', adapter.id, info);
  }
  // 延迟扫描：音频列表按请求时再扫描
  let audioList: ReturnType<typeof scanAudioUrls> = [];

  // 监听来自扩展页面的请求
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || !message.type) return;
    switch (message.type) {
      case MessageType.ENABLE_FEATURES: {
        try {
          const p = (message?.payload || {}) as { video?: boolean; image?: boolean; audio?: boolean; playbackEvents?: boolean; spaWatchers?: boolean };
          if (typeof p.video === 'boolean') features.video = p.video;
          if (typeof p.image === 'boolean') features.image = p.image;
          if (typeof p.audio === 'boolean') features.audio = p.audio;
          if (typeof p.playbackEvents === 'boolean') features.playbackEvents = p.playbackEvents;
          if (typeof p.spaWatchers === 'boolean') features.spaWatchers = p.spaWatchers;
          // 根据开关安装/初始化
          if (features.playbackEvents || features.video) {
            try { attachVideoPlaybackListeners(); } catch { /* noop */ }
          }
          tryInstallDynamicWatchers(features);
          sendResponse({ success: true, enabled: { ...features } });
        } catch (e: unknown) {
          sendResponse({ success: false, error: (e as Error)?.message || '启用功能失败' });
        }
        break;
      }
      case MessageType.PING: {
        try {
          const sender = _sender as chrome.runtime.MessageSender;
          const frameId = (typeof sender?.frameId === 'number') ? sender.frameId : undefined;
          const adapter = pickAdapter();
          const resp: PongMessage = {
            type: MessageType.PONG,
            ok: true,
            version: '1.0.0',
            capabilities: ['video:list','video:control','image:list','audio:list','playback:status'],
            adapterId: adapter ? adapter.id : null,
            frameId
          };
          sendResponse(resp);
        } catch (e: unknown) {
          sendResponse({ ok: false, error: (e as Error)?.message || 'PING 失败' });
        }
        break;
      }
      case MessageType.REQUEST_IMAGE_LIST: {
        try {
          const list = scanImages();
          sendResponse({ success: true, items: list });
        } catch (e: unknown) {
          sendResponse({ success: false, error: (e as Error)?.message || '获取图片失败' });
        }
        break;
      }
      case MessageType.REQUEST_AUDIO_LIST: {
        // 每次请求时重新扫描，保证结果最新
        audioList = scanAudioUrls();
        sendResponse({ success: true, items: audioList });
        break;
      }
      case MessageType.GET_VIDEO_LIST: {
        try {
          const videos = scanVideoElements();
          sendResponse({ success: true, videos });
        } catch (e: unknown) {
          sendResponse({ success: false, error: (e as Error)?.message || '获取视频列表失败' });
        }
        break;
      }
      case MessageType.CONTROL_VIDEO: {
        try {
          const idx: number = typeof message?.index === 'number' ? message.index : 0;
          const action: VideoControlAction = message?.action || 'toggle';
          const ok = controlVideoByIndex(idx, action);
          sendResponse({ success: ok });
        } catch (e: unknown) {
          sendResponse({ success: false, error: (e as Error)?.message || '控制视频失败' });
        }
        break;
      }
      case MessageType.START_RECORD_VIDEO: {
          try {
            const idx: number = typeof message?.index === 'number' ? message.index : 0;
            const mode: 'video' | 'audio' = message?.mode === 'audio' ? 'audio' : 'video';
            if (activeRecordings[idx]) {
              sendResponse({ success: false, error: '该索引已在录制中' });
              break;
            }
            const video = getVideoElementByIndex(idx);
              if (!video) {
                sendResponse({ success: false, error: '未找到视频元素' });
                break;
              }
            let stream: MediaStream | null = null;
            try {
              const vExt = video as HTMLVideoElement & { captureStream?: () => MediaStream; mozCaptureStream?: () => MediaStream };
              if (typeof vExt.captureStream === 'function') {
                stream = vExt.captureStream();
              } else if (typeof vExt.mozCaptureStream === 'function') {
                stream = vExt.mozCaptureStream();
              }
            } catch (e) { /* ignore capture errors */ }
            if (!stream) {
              sendResponse({ success: false, error: '浏览器不支持 captureStream' });
              break;
            }
            // 音频模式：仅保留音轨
            if (mode === 'audio') {
              const audioTracks = stream.getAudioTracks();
              if (audioTracks.length === 0) {
                sendResponse({ success: false, error: '无可用音频轨道' });
                break;
              }
              const audioStream = new MediaStream();
              audioTracks.forEach(t => audioStream.addTrack(t));
              stream = audioStream;
            }
            const mimeCandidate = mode === 'audio' ? 'audio/webm;codecs=opus' : 'video/webm;codecs=vp9,opus';
            let recorder: MediaRecorder;
            try {
              recorder = new MediaRecorder(stream, { mimeType: mimeCandidate });
            } catch {
              recorder = new MediaRecorder(stream);
            }
            const chunks: BlobPart[] = [];
            recorder.ondataavailable = (e) => { if (e.data && e.data.size > 0) chunks.push(e.data); };
            recorder.onstart = () => {
              chrome.runtime.sendMessage({ type: MessageType.VIDEO_RECORDING_STATUS, status: 'started', index: idx, startedAt: Date.now(), mode });
            };
            recorder.onstop = () => {
              const blob = new Blob(chunks, { type: recorder.mimeType || (mode === 'audio' ? 'audio/webm' : 'video/webm') });
              const fileName = `record_${mode}_${Date.now()}_${idx}.webm`;
              // 触发下载：使用临时链接
              try {
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url; a.download = fileName; a.style.display = 'none';
                document.body.appendChild(a); a.click(); setTimeout(()=>{ document.body.removeChild(a); URL.revokeObjectURL(url); }, 4000);
              } catch (e) { /* ignore download trigger errors */ }
              chrome.runtime.sendMessage({ type: MessageType.VIDEO_RECORDING_STATUS, status: 'completed', index: idx, fileName, mode });
              delete activeRecordings[idx];
            };
            recorder.onerror = (e: Event) => {
              const errObj = e as unknown as { error?: { message?: string }; message?: string };
              chrome.runtime.sendMessage({ type: MessageType.VIDEO_RECORDING_STATUS, status: 'error', index: idx, error: (errObj?.error?.message || errObj?.message || '录制错误'), mode });
              delete activeRecordings[idx];
            };
            activeRecordings[idx] = { recorder, mode, startedAt: Date.now(), chunks };
            recorder.start();
            sendResponse({ success: true });
          } catch (e: unknown) {
            sendResponse({ success: false, error: (e as Error)?.message || '启动录制失败' });
          }
          break;
      }
      case MessageType.STOP_RECORD_VIDEO: {
          try {
            const idx: number = typeof message?.index === 'number' ? message.index : 0;
            const rec = activeRecordings[idx];
            if (!rec) { sendResponse({ success: false, error: '未在录制' }); break; }
            rec.recorder.stop();
            sendResponse({ success: true });
          } catch (e: unknown) {
            sendResponse({ success: false, error: (e as Error)?.message || '停止录制失败' });
          }
          break;
      }
      // 侧边栏旧版使用的直链请求（枚举中暂未收录，保持兼容）
      case 'REQUEST_VIDEO_SOURCES': {
        try {
          const idx: number = typeof message?.index === 'number' ? message.index : 0;
          const list = getVideoSourceCandidatesByIndex(idx);
          sendResponse({ success: true, sources: list });
        } catch (e: unknown) {
          sendResponse({ success: false, error: (e as Error)?.message || '获取直链失败' });
        }
        break;
      }
      // 便捷控制（兼容旧消息）
      case 'PLAY_VIDEO': {
        const v = getVideoElementByIndex(0);
        v?.play?.();
        sendResponse({ success: !!v });
        break;
      }
      case 'PAUSE_VIDEO': {
        const v = getVideoElementByIndex(0);
        v?.pause?.();
        sendResponse({ success: !!v });
        break;
      }
      default:
        break;
    }
    // 仅在需要异步 sendResponse 时返回 true；当前所有分支均同步响应
    return false;
  });

  // 默认不安装重型监听；由 ENABLE_FEATURES 决定是否启用
}

function tryInstallDynamicWatchers(features: Record<string, boolean>) {
  if (!(features.spaWatchers || autoScanEnabledGlobal)) return;
  try {
    installResiliencyWatchers(() => {
      // 使用抽象的聚合与差异检测，避免重复发送完全相同的快照
      try {
        const gathered = gatherResources(features);
        if (gathered.changed) {
          const { images, audio, videos } = gathered;
          const payload: { images?: ImageScanItem[]; audio?: AudioItem[]; videos?: VideoItemDTO[] } = {};
          if (images) payload.images = images;
          if (audio) payload.audio = audio;
          if (videos) payload.videos = videos;
          if (payload.images || payload.audio || payload.videos) {
            try { chrome.runtime.sendMessage({ type: MessageType.RESOURCE_UPDATE, payload }); } catch { /* noop */ }
          }
        }
      } catch { /* noop */ }
      try { if (features.playbackEvents || features.video) attachVideoPlaybackListeners(); } catch { /* noop */ }
    });
  } catch { /* noop */ }
}

async function loadAutoScanSetting(): Promise<boolean> {
  return new Promise(resolve => {
    try { chrome.storage.local.get('global_settings_v1', res => { resolve(!!res?.global_settings_v1?.autoScan); }); } catch { resolve(false); }
  });
}

// ============== 基础视频扫描与控制 ==============
function scanVideoElements(): VideoItemDTO[] {
  const list: VideoItemDTO[] = [];
  try {
    const videos = deepQuerySelectorAll<HTMLVideoElement>('video');
    videos.forEach((v) => {
      const rect = v.getBoundingClientRect?.();
      const visible = !!rect && rect.width > 1 && rect.height > 1;
      const directSources = collectVideoSourceCandidates(v);
      const stableId = getStableVideoId(v);
      const item: VideoItemDTO = {
        index: stableId,
        src: v.currentSrc || v.src || '',
        width: v.videoWidth || v.clientWidth || undefined,
        height: v.videoHeight || v.clientHeight || undefined,
        duration: Number.isFinite(v.duration) ? v.duration : undefined,
        muted: !!v.muted,
        visible,
        directSources,
        directSourceCount: directSources.length
      };
      list.push(item);
      ensurePlaybackListener(v, stableId);
    });
  } catch (e) {
    console.warn('[content/router] 扫描视频失败:', e);
  }
  return list;
}

// ============== 播放状态事件派发 ==============
const ATTACHED_SET = new WeakSet<HTMLVideoElement>();
function ensurePlaybackListener(video: HTMLVideoElement, index: number) {
  if (ATTACHED_SET.has(video)) return;
  const sendStatus = () => {
    try {
      chrome.runtime.sendMessage({ type: MessageType.VIDEO_PLAYBACK_STATUS, index, playing: !video.paused });
    } catch (e) { /* noop */ }
  };
  video.addEventListener('play', sendStatus);
  video.addEventListener('pause', sendStatus);
  video.addEventListener('ended', sendStatus);
  ATTACHED_SET.add(video);
  // 初始状态上报
  sendStatus();
}

function attachVideoPlaybackListeners() {
  deepQuerySelectorAll<HTMLVideoElement>('video').forEach((v) => {
    const id = getStableVideoId(v);
    ensurePlaybackListener(v, id);
  });
}

function getVideoElementByIndex(index?: number): HTMLVideoElement | null {
  if (typeof index === 'number') {
    const direct = reverseVideoMap[index];
    if (direct) return direct;
  }
  // 回退：返回当前页面第一个视频
  const videos = deepQuerySelectorAll<HTMLVideoElement>('video');
  return videos.length ? videos[0] : null;
}

function controlVideoByIndex(index: number, action: VideoControlAction): boolean {
  const v = getVideoElementByIndex(index);
  if (!v) return false;
  try {
    if (action === 'play') v.play();
    else if (action === 'pause') v.pause();
    else if (action === 'toggle') { v.paused ? v.play() : v.pause(); }
    return true;
  } catch (_) { return false; }
}

function collectVideoSourceCandidates(video: HTMLVideoElement | null): VideoSourceCandidate[] {
  if (!video) return [];
  const results: VideoSourceCandidate[] = [];
  const seen = new Set<string>();
  const push = (raw?: string | null, label?: string) => {
    if (!raw || typeof raw !== 'string') return;
    const normalized = normalizeHttpUrl(raw);
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    results.push({ url: normalized, label: label || 'source' });
  };

  try {
    push(video.currentSrc, 'currentSrc');
    push(video.src, 'src');
    push(video.getAttribute('src'), 'attr:src');
    video.querySelectorAll('source').forEach((s) => push((s as HTMLSourceElement).src, 'source'));
  } catch (e) { /* noop */ }
  return results;
}

function getVideoSourceCandidatesByIndex(index?: number): VideoSourceCandidate[] {
  return collectVideoSourceCandidates(getVideoElementByIndex(index));
}

function normalizeHttpUrl(u: string): string | '' {
  const trimmed = (u || '').trim();
  if (!trimmed) return '';
  if (/^(blob:|data:|mediasource:|javascript:|chrome-extension:)/i.test(trimmed)) return '';
  try {
    const absolute = new URL(trimmed, document.baseURI).href;
    if (!/^https?:/i.test(absolute)) return '';
    return absolute;
  } catch (_) {
    return '';
  }
}

// ============== 深度查询（包含 Shadow DOM） ==============
function deepQuerySelectorAll<T extends Element>(selector: string, root: Document | ShadowRoot = document): T[] {
  const out: T[] = [];
  const queue: (Document | ShadowRoot)[] = [root];
  while (queue.length) {
    const current = queue.shift()!;
    current.querySelectorAll<T>(selector).forEach((el) => out.push(el));
    current.querySelectorAll<Element>('*').forEach((el) => {
      const typed = el as Element & { shadowRoot?: ShadowRoot | null };
      if (typed.shadowRoot) queue.push(typed.shadowRoot);
    });
  }
  return out;
}

// ============== SPA 导航与动态内容监听（带去抖） ==============
const NAV_FLAG = '__ext_nav_watchers_installed__';
let debouncedTimer: number | null = null;
function installResiliencyWatchers(onChange: () => void) {
  const g = globalThis as unknown as Record<string, unknown>;
  if (g[NAV_FLAG]) return; // 避免重复安装
  g[NAV_FLAG] = true;

  const schedule = (reason: string) => {
    try { if (debouncedTimer) clearTimeout(debouncedTimer); } catch (e) { void 0; }
    try { console.debug('[content/router] 计划重扫:', reason); } catch (e) { void 0; }
    debouncedTimer = (setTimeout(() => {
      debouncedTimer = null;
      try { onChange(); } catch (e) { void 0; }
    }, 500) as unknown) as number;
  };

  // History API 包装（pushState/replaceState）
  try {
    const rawPush = history.pushState;
    const rawReplace = history.replaceState;
    type PushState = typeof history.pushState;
    type ReplaceState = typeof history.replaceState;
    history.pushState = function (this: History, ...args: Parameters<PushState>) {
      const ret = rawPush.apply(this, args);
      schedule('pushState');
      return ret;
    } as PushState;
    history.replaceState = function (this: History, ...args: Parameters<ReplaceState>) {
      const ret = rawReplace.apply(this, args);
      schedule('replaceState');
      return ret;
    } as ReplaceState;
  } catch (e) { void 0; }

  // 浏览器导航事件
  try { window.addEventListener('popstate', () => schedule('popstate')); } catch (e) { void 0; }
  try { window.addEventListener('hashchange', () => schedule('hashchange')); } catch (e) { void 0; }

  // DOM 动态变更：关注子树新增/移除
  try {
    const mo = new MutationObserver((mutations) => {
      for (const m of mutations) {
        if (m.addedNodes && m.addedNodes.length) { schedule('dom-added'); break; }
        if (m.removedNodes && m.removedNodes.length) { schedule('dom-removed'); break; }
      }
    });
    mo.observe(document.documentElement || document.body, { childList: true, subtree: true });
  } catch (e) { void 0; }
}

// ============== 资源聚合与差异检测 ==============
/**
 * 聚合当前页面的启用类别资源并进行差异检测。
 * 仅当与上一次发送相比检测到新增/移除资源时返回 changed=true。
 * 差异依据：
 *  - 图片：url + 尺寸 + kind 组成的复合 key
 *  - 音频：绝对 url
 *  - 视频：稳定 index (WeakMap 分配)
 */
interface GatherResult {
  images?: ImageScanItem[];
  audio?: AudioItem[];
  videos?: VideoItemDTO[];
  changed: boolean;
}

let prevImageKeys = new Set<string>();
let prevAudioUrls = new Set<string>();
let prevVideoIds = new Set<number>();

function buildImageKey(i: ImageScanItem): string { return `${i.url}#${i.width}x${i.height}#${i.kind}`; }

function gatherResources(features: Record<string, boolean>): GatherResult {
  const result: GatherResult = { changed: false };
  let currentImageKeys: Set<string> | null = null;
  let currentAudioUrls: Set<string> | null = null;
  let currentVideoIds: Set<number> | null = null;

  try {
    if (features.image) {
      const images = scanImages();
      result.images = images;
      currentImageKeys = new Set(images.map(buildImageKey));
    }
  } catch { /* noop */ }
  try {
    if (features.audio) {
      const audio = scanAudioUrls();
      result.audio = audio;
      currentAudioUrls = new Set(audio.map(a => a.url));
    }
  } catch { /* noop */ }
  try {
    if (features.video) {
      const videos = scanVideoElements();
      result.videos = videos;
      currentVideoIds = new Set(videos.map(v => v.index));
    }
  } catch { /* noop */ }

  // 计算差异：任一类别有变动即视为 changed
  let changed = false;
  if (currentImageKeys) {
    if (currentImageKeys.size !== prevImageKeys.size) changed = true;
    else for (const k of currentImageKeys) { if (!prevImageKeys.has(k)) { changed = true; break; } }
  }
  if (!changed && currentAudioUrls) {
    if (currentAudioUrls.size !== prevAudioUrls.size) changed = true;
    else for (const k of currentAudioUrls) { if (!prevAudioUrls.has(k)) { changed = true; break; } }
  }
  if (!changed && currentVideoIds) {
    if (currentVideoIds.size !== prevVideoIds.size) changed = true;
    else for (const k of currentVideoIds) { if (!prevVideoIds.has(k)) { changed = true; break; } }
  }

  // 更新快照集
  if (currentImageKeys) prevImageKeys = currentImageKeys;
  if (currentAudioUrls) prevAudioUrls = currentAudioUrls;
  if (currentVideoIds) prevVideoIds = currentVideoIds;

  result.changed = changed;
  return result;
}
