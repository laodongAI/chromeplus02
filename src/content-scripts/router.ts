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
import { scanPageSources } from './sources';
import { MessageType, type VideoItemDTO, type VideoSourceCandidate, type VideoControlAction, type PongMessage } from '@/messaging';
import { initTextExtractor } from './text';
import { toggleAnnotate } from './annotate';

// 全局自动扫描开关缓存（来自存储），供增量观察函数使用
let autoScanEnabledGlobal = false;

// 录制状态缓存
interface ActiveRecording { 
  recorder: MediaRecorder; 
  mode: 'video'|'audio'; 
  startedAt: number; 
  chunks: BlobPart[]; 
  element: HTMLVideoElement;
  listeners: Record<string, EventListener>;
}
const activeRecordings: Record<number, ActiveRecording> = {};

// 本内容脚本所在的 frameId（0 = 顶层窗口）；初始化时通过 WHO_AM_I 向后台查询一次
let selfFrameId = 0;
function detectSelfFrameId() {
  try {
    chrome.runtime.sendMessage({ type: MessageType.WHO_AM_I }, (resp: unknown) => {
      void chrome.runtime.lastError;
      const r = resp as { frameId?: number } | undefined;
      if (r && typeof r.frameId === 'number') selfFrameId = r.frameId;
    });
  } catch { /* noop */ }
}

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
  // 初始化文本抽取
  initTextExtractor();
  // 查询自身 frameId，用于 RESOURCE_UPDATE 等增量消息标记来源
  detectSelfFrameId();
  
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
      case MessageType.ANNOTATE_TOGGLE: {
        // 录屏页面画笔覆盖层开关
        try {
          toggleAnnotate(!!message?.payload?.active);
          sendResponse({ success: true });
        } catch (e: unknown) {
          sendResponse({ success: false, error: (e as Error)?.message || '画笔工具切换失败' });
        }
        break;
      }
      case MessageType.SETTINGS_UPDATE: {
        // 设置变更（如 autoScan 开关）实时同步到内容脚本，无需刷新页面
        try {
          const p = (message?.payload || {}) as { autoScan?: boolean };
          if (typeof p.autoScan === 'boolean') {
            autoScanEnabledGlobal = p.autoScan;
            if (autoScanEnabledGlobal) tryInstallDynamicWatchers(features);
          }
        } catch { /* noop */ }
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
          sendResponse({ success: true, items: list, frameId: selfFrameId });
        } catch (e: unknown) {
          sendResponse({ success: false, error: (e as Error)?.message || '获取图片失败' });
        }
        break;
      }
      case MessageType.REQUEST_AUDIO_LIST: {
        // 每次请求时重新扫描，保证结果最新
        audioList = scanAudioUrls();
        sendResponse({ success: true, items: audioList, frameId: selfFrameId });
        break;
      }
      case MessageType.GET_VIDEO_LIST: {
        try {
          const videos = scanVideoElements();
          sendResponse({ success: true, videos, frameId: selfFrameId });
        } catch (e: unknown) {
          sendResponse({ success: false, error: (e as Error)?.message || '获取视频列表失败' });
        }
        break;
      }
      case MessageType.CONTROL_VIDEO: {
        const idx: number = typeof message?.index === 'number' ? message.index : 0;
        const action: VideoControlAction = message?.action === 'pause' ? 'pause' : 'play';
        controlVideoByIndex(idx, action).then(ok => sendResponse({ success: ok })).catch(() => sendResponse({ success: false }));
        return true; // 异步应答（play 可能被策略拒绝后重试）
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
            const startedAt = Date.now();
            recorder.ondataavailable = (e) => { if (e.data && e.data.size > 0) chunks.push(e.data); };
            recorder.onstart = () => {
              const statusMsg = { type: MessageType.VIDEO_RECORDING_STATUS, status: 'started' as const, index: idx, startedAt, mode };
              chrome.runtime.sendMessage(statusMsg);
            };
            recorder.onstop = () => {
              console.log('[content/router] Recorder stopped. Chunks:', chunks.length);
              // Clean up listeners
              const rec = activeRecordings[idx];
              if (rec && rec.listeners) {
                Object.entries(rec.listeners).forEach(([evt, fn]) => rec.element.removeEventListener(evt, fn));
              }

              const blob = new Blob(chunks, { type: recorder.mimeType || (mode === 'audio' ? 'audio/webm' : 'video/webm') });
              console.log('[content/router] Blob size:', blob.size);
              
              if (blob.size === 0) {
                const errorMsg = { type: MessageType.VIDEO_RECORDING_STATUS, status: 'error' as const, index: idx, error: '录制数据为空 (Blob size 0)', mode };
                chrome.runtime.sendMessage(errorMsg);
                delete activeRecordings[idx];
                return;
              }

              const fileName = `record_${mode}_${Date.now()}_${idx}.webm`;
              // 触发下载：使用临时链接
              try {
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url; a.download = fileName; a.style.display = 'none';
                document.body.appendChild(a); 
                a.click(); 
                console.log('[content/router] Download triggered for', fileName);
                setTimeout(()=>{ document.body.removeChild(a); URL.revokeObjectURL(url); }, 4000);
              } catch (e) { 
                console.error('[content/router] Download trigger failed', e);
              }
              const completedMsg = { type: MessageType.VIDEO_RECORDING_STATUS, status: 'completed' as const, index: idx, fileName, mode };
              chrome.runtime.sendMessage(completedMsg);
              delete activeRecordings[idx];
            };
            recorder.onerror = (e: Event) => {
              const errObj = e as unknown as { error?: { message?: string }; message?: string };
              const errorMsg = { type: MessageType.VIDEO_RECORDING_STATUS, status: 'error' as const, index: idx, error: (errObj?.error?.message || errObj?.message || '录制错误'), mode };
              chrome.runtime.sendMessage(errorMsg);
              delete activeRecordings[idx];
            };

            // Attach listeners for robustness
            const listeners: Record<string, EventListener> = {
              pause: () => {
                if (recorder.state === 'recording') {
                  console.log('[content/router] Video paused, pausing recorder');
                  recorder.pause();
                }
              },
              play: () => {
                if (recorder.state === 'paused') {
                  console.log('[content/router] Video resumed, resuming recorder');
                  recorder.resume();
                }
              },
              ended: () => { console.log('[content/router] Video ended, stopping recorder'); recorder.stop(); },
              emptied: () => { console.log('[content/router] Video emptied, stopping recorder'); recorder.stop(); },
              loadstart: () => { console.log('[content/router] Video loadstart (src change), stopping recorder'); recorder.stop(); }
            };
            Object.entries(listeners).forEach(([evt, fn]) => video.addEventListener(evt, fn));

            activeRecordings[idx] = { recorder, mode, startedAt, chunks, element: video, listeners };
            recorder.start();
            sendResponse({ success: true, startedAt });
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
      // 侧边栏视频直链请求
      case MessageType.REQUEST_VIDEO_SOURCES: {
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
      case 'SCAN_PAGE_SOURCES': {
        try {
          const files = scanPageSources();
          sendResponse({ success: true, files });
        } catch (e: unknown) {
          sendResponse({ success: false, error: (e as Error)?.message || '扫描资源失败' });
        }
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

// ===== 节流与批处理增强 =====
let aggTimer: number | null = null;
const aggImagesAdded = new Map<string, ImageScanItem>();
const aggImagesRemoved = new Set<string>();
const aggAudioAdded = new Map<string, AudioItem>();
const aggAudioRemoved = new Set<string>();
const aggVideoAdded = new Map<number, VideoItemDTO>();
const aggVideoRemoved = new Set<number>();
let baseImageKeys = new Set<string>();
let baseAudioUrls = new Set<string>();
// Map<index, src> to detect content changes even if element ID is reused
const baseVideoState = new Map<number, string>();

function flushAggregated(features: Record<string, boolean>) {
  aggTimer = null;
  // 最终一次重新扫描用于最新完整列表（降低 UI 不一致风险）
  const finalImages = features.image ? scanImages() : undefined;
  const finalAudio = features.audio ? scanAudioUrls() : undefined;
  const finalVideos = features.video ? scanVideoElements() : undefined;
  // 更新基准集合
  if (finalImages) baseImageKeys = new Set(finalImages.map(i => buildImageKeyDiff(i)));
  if (finalAudio) baseAudioUrls = new Set(finalAudio.map(a => a.url));
  if (finalVideos) {
    baseVideoState.clear();
    finalVideos.forEach(v => baseVideoState.set(v.index, v.src || ''));
    // 同步修剪反向索引，避免已销毁的视频元素因强引用而无法 GC（内存泄漏）
    const liveIds = new Set(finalVideos.map(v => v.index));
    for (const key of Object.keys(reverseVideoMap)) {
      const id = Number(key);
      if (!liveIds.has(id)) delete reverseVideoMap[id];
    }
  }
  const diff: ResourceDiff = {};
  if (aggImagesAdded.size || aggImagesRemoved.size) diff.images = { added: Array.from(aggImagesAdded.values()), removed: Array.from(aggImagesRemoved) };
  if (aggAudioAdded.size || aggAudioRemoved.size) diff.audio = { added: Array.from(aggAudioAdded.values()), removed: Array.from(aggAudioRemoved) };
  if (aggVideoAdded.size || aggVideoRemoved.size) diff.videos = { added: Array.from(aggVideoAdded.values()), removed: Array.from(aggVideoRemoved) };
  if (diff.images || diff.audio || diff.videos) {
    const payload: { images?: ImageScanItem[]; audio?: AudioItem[]; videos?: VideoItemDTO[]; diff?: ResourceDiff; frameId?: number } = {};
    if (finalImages) payload.images = finalImages;
    if (finalAudio) payload.audio = finalAudio;
    if (finalVideos) payload.videos = finalVideos;
    payload.diff = diff;
    payload.frameId = selfFrameId;
    try { chrome.runtime.sendMessage({ type: MessageType.RESOURCE_UPDATE, payload }); } catch { /* noop */ }
  }
  // 清空聚合状态
  aggImagesAdded.clear(); aggImagesRemoved.clear();
  aggAudioAdded.clear(); aggAudioRemoved.clear();
  aggVideoAdded.clear(); aggVideoRemoved.clear();
}

function aggregateDiff(features: Record<string, boolean>) {
  try {
    if (features.image) {
      const imgs = scanImages();
      const currentKeys = new Set(imgs.map(i => buildImageKeyDiff(i)));
      // 新增
      imgs.forEach(i => { const k = buildImageKeyDiff(i); if (!baseImageKeys.has(k)) aggImagesAdded.set(k, i); });
      // 移除
      baseImageKeys.forEach(k => { if (!currentKeys.has(k)) aggImagesRemoved.add(k); });
    }
    if (features.audio) {
      const aud = scanAudioUrls();
      const currentUrls = new Set(aud.map(a => a.url));
      aud.forEach(a => { if (!baseAudioUrls.has(a.url)) aggAudioAdded.set(a.url, a); });
      baseAudioUrls.forEach(u => { if (!currentUrls.has(u)) aggAudioRemoved.add(u); });
    }
    if (features.video) {
      const vids = scanVideoElements();
      const currentIds = new Set(vids.map(v => v.index));
      vids.forEach(v => { 
        const oldSrc = baseVideoState.get(v.index);
        // Detect new ID OR reused ID with changed src
        if (!baseVideoState.has(v.index) || oldSrc !== v.src) {
          aggVideoAdded.set(v.index, v); 
        }
      });
      baseVideoState.forEach((_, id) => { if (!currentIds.has(id)) aggVideoRemoved.add(id); });
    }
  } catch { /* noop */ }
  if (!aggTimer) {
    aggTimer = (setTimeout(() => flushAggregated(features), 350) as unknown) as number; // 350ms 节流窗口
  }
}

// 幂等保护标记：ENABLE_FEATURES 会被侧边栏 main + 各面板 mount 重复发送，
// watcher 只允许安装一次，避免 MutationObserver / history 钩子 / play 监听无限叠加
let resiliencyWatchersInstalled = false;
let playCaptureListenerInstalled = false;
let networkObserverInstalled = false;

// 网络资源加载监听：懒加载媒体（src 属性切换不触发 MutationObserver 的 childList 监听）
// 通过 PerformanceObserver 的 resource 条目捕获。仅关注媒体扩展名，
// 排除 ts/m4s 分片，避免长视频 HLS 拉流时的高频触发。
const NETWORK_MEDIA_RE = /\.(mp4|webm|mkv|mov|flv|m3u8|mpd|mp3|m4a|aac|flac|wav|ogg|opus|jpg|jpeg|png|webp|gif|avif|svg)(?:$|[?#])/i;

function installNetworkObserver(features: Record<string, boolean>) {
  if (networkObserverInstalled || typeof PerformanceObserver === 'undefined') return;
  try {
    const po = new PerformanceObserver((list) => {
      let hit = false;
      try {
        for (const entry of list.getEntries()) {
          const u = (entry as PerformanceResourceTiming).name || '';
          if (NETWORK_MEDIA_RE.test(u)) { hit = true; break; }
        }
      } catch { /* noop */ }
      if (hit) aggregateDiff(features);
    });
    po.observe({ entryTypes: ['resource'] });
    networkObserverInstalled = true;
  } catch { /* noop */ }
}

function tryInstallDynamicWatchers(features: Record<string, boolean>) {
  if (!(features.spaWatchers || autoScanEnabledGlobal)) return;
  try {
    if (!resiliencyWatchersInstalled) {
      resiliencyWatchersInstalled = true;
      installResiliencyWatchers(() => {
        aggregateDiff(features); // 聚合增量并节流发送
        try { if (features.playbackEvents || features.video) attachVideoPlaybackListeners(); } catch { /* noop */ }
      });
    }
    // 网络资源增量监听（懒加载媒体），同样只装一次
    installNetworkObserver(features);

    // Global capture listener for 'play' to detect untracked videos immediately
    if (features.video && !playCaptureListenerInstalled) {
      playCaptureListenerInstalled = true;
      document.addEventListener('play', (e) => {        const target = e.target as HTMLVideoElement;
        if (target && target.tagName === 'VIDEO') {
          // 1. Stop recordings of OTHER videos (Video Switch logic)
          Object.keys(activeRecordings).forEach(k => {
            const idx = Number(k);
            const rec = activeRecordings[idx];
            if (rec && rec.element !== target) {
              console.log('[content/router] New video playing, stopping other recording:', idx);
              rec.recorder.stop();
            }
          });

          const id = stableVideoIdMap.get(target);
          // If unknown video OR known video with changed src
          if (id === undefined || (baseVideoState.has(id) && baseVideoState.get(id) !== (target.currentSrc || target.src || ''))) {
            console.debug('[content/router] Detected untracked video playing, triggering scan');
            aggregateDiff(features);
          }
        }
      }, true); // Capture phase
    }
  } catch { /* noop */ }
}

// Global navigation/unload handler to stop all recordings
function stopAllRecordings(reason: string) {
  Object.keys(activeRecordings).forEach(k => {
    const idx = Number(k);
    const rec = activeRecordings[idx];
    if (rec && rec.recorder.state !== 'inactive') {
      console.log(`[content/router] Stopping recording ${idx} due to ${reason}`);
      rec.recorder.stop();
    }
  });
}
window.addEventListener('beforeunload', () => stopAllRecordings('unload'));
window.addEventListener('popstate', () => stopAllRecordings('navigation'));
window.addEventListener('hashchange', () => stopAllRecordings('navigation'));
// Hook into history API via installResiliencyWatchers is already done for scanning, 
// but we might want immediate stop. 
// Since installResiliencyWatchers uses a debounce, we should add immediate listeners here if possible.
// But history.pushState/replaceState are patched in installResiliencyWatchers.
// We can add a global listener for the custom event if we dispatched one, but we didn't.
// Let's just rely on the fact that usually navigation stops the video or unloads the page.
// If it's a SPA navigation, the video might stay or be removed.
// If removed -> 'emptied'/'ended' listener on video will trigger stop.
// If reused -> 'loadstart' listener on video will trigger stop.
// So we are mostly covered for SPA video switch/reuse.
// The explicit 'popstate'/'hashchange' is good for extra safety.

async function loadAutoScanSetting(): Promise<boolean> {
  // v2 为唯一真源；仅存在旧版 v1 时回退读取，保持升级兼容
  return new Promise(resolve => {
    try {
      chrome.storage.local.get(['global_settings_v2', 'global_settings_v1'], res => {
        const v2 = res?.global_settings_v2 as { autoScan?: boolean } | undefined;
        const v1 = res?.global_settings_v1 as { autoScan?: boolean } | undefined;
        resolve(typeof v2?.autoScan === 'boolean' ? v2.autoScan : !!v1?.autoScan);
      });
    } catch { resolve(false); }
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
        directSourceCount: directSources.length,
        paused: !!v.paused
      } as VideoItemDTO;
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

async function controlVideoByIndex(index: number, action: VideoControlAction): Promise<boolean> {
  const v = getVideoElementByIndex(index);
  if (!v) return false;
  try {
    if (action === 'pause') {
      v.pause();
      return true;
    }
    if (action === 'play') {
      try {
        await v.play();
        return true;
      } catch {
        // 自动播放策略拒绝：静音重试，成功后延迟恢复声音
        v.muted = true;
        try { await v.play(); } catch { return false; }
        setTimeout(() => { try { v.muted = false; } catch { /* noop */ } }, 400);
        return true;
      }
    }
    return false;
  } catch {
    return false;
  }
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
  // 允许 blob: 协议，以便上层能识别当前视频为流式资源
  if (/^(data:|mediasource:|javascript:|chrome-extension:)/i.test(trimmed)) return '';
  try {
    const urlObj = new URL(trimmed, document.baseURI);
    if (urlObj.protocol === 'blob:') return trimmed;
    if (!/^https?:/i.test(urlObj.href)) return '';
    return urlObj.href;
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
// 移除全局 flag 检查，允许重载后重新挂载监听器（History API 钩子会叠加，但这是开发模式下的妥协）
let debouncedTimer: number | null = null;
function installResiliencyWatchers(onChange: () => void) {
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
// 旧 gatherResources 与增量 diff 逻辑已被批处理聚合取代，仅保留差异 key 构造与类型供聚合使用
interface ResourceDiff { images?: { added: ImageScanItem[]; removed: string[] }; audio?: { added: AudioItem[]; removed: string[] }; videos?: { added: VideoItemDTO[]; removed: number[] }; }
function buildImageKeyDiff(i: ImageScanItem): string { return `${i.url}#${i.width}x${i.height}#${i.kind}`; }
