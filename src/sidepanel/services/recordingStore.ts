/**
 * 录屏全局状态存储（UI 第一批改进 · 评审 P0）。
 *
 * 背景：
 *  - 此前录屏的 MediaRecorder、分片、计时与产物列表全部存在 ScreenRecordPanel
 *    组件内存中；SidePanelApp 用 <component :is> 异步挂载且无 keep-alive，
 *    切走 Tab 即卸载组件，onBeforeUnmount 会强制 stopRecording()，录制被打断。
 *  - 本模块把"录制运行时状态"提升为模块级单例：面板组件只做视图绑定与操作入口，
 *    卸载不影响录制；切回面板时从本 store 恢复完整状态（计时连续、录制中标记、暂停态）。
 *  - 计时与暂停累计逻辑（P1-10 修复）原样迁移：显示时长 = 当前时刻 - 开始时刻
 *    - 累计暂停时长，保证"显示时长 ≤ 实际录像时长"的语义不回退。
 *
 * 已知边界（本轮明确不做，避免半成品）：
 *  - 侧栏整体关闭时页面 JS 上下文销毁，进行中的录制与已生成的 blob URL 仍会丢失。
 *    Blob 落 IndexedDB 持久化需要先扩展 src/shared/blobStore.ts 的库版本与
 *    Service Worker 共享连接的 onversionchange 协调，链路过长，单列下一轮处理。
 */
import { ref, computed, shallowRef } from 'vue';
import { MessageType } from '@/messaging';
// 体积格式化复用全局工具（避免与 utils/format 重复实现；下载管理面板同款口径）
import { formatBytes } from '@/utils/format';
import { sendMessageToTab } from '../utils/chromeMessaging';
import { toast } from '../composables/useToast';
// 下载转码：webm→MP4（WebCodecs；不支持时回退原样下载），统一触发下载实现
import { canConvertMedia, convertVideoBlobToMp4, triggerBlobDownload } from '@/core/mediaConvert';
// P1-8：分级日志（扩展页面上下文默认 info 级），统一走全局 logger，不新增裸 console
import { createLogger } from '@/utils/logger';
// Round 5 #31：摄像头画中画（canvas 合成）与按住说话（麦克风增益门）
import { cameraConstraints, DEFAULT_CAMERA_PIP, type CameraPipOptions } from '@/core/cameraOverlay';
import { isEditableTarget, isPttActivation, planAudioGraph, pttTargetGain, pttTimeConstant, PTT_KEY_CODE } from '@/core/recordingAudio';
import { createRecordingCompositor, type RecordingCompositor, type RecordingVisualOptions } from './recordingCompositor';
// Round 5 #32：定时自动停止与点击/光标高亮
import { formatCountdown, normalizeAutoStopSeconds, remainingSeconds, shouldAutoStop } from '@/core/recordingLimits';
// Round 5 #33：推近聚焦与敏感区遮挡
import { BLUR_STRENGTH_DEFAULT, ZOOM_MAX, ZOOM_MIN, ZOOM_STEP, clampZoom, type BlurRegion, type NormRect, type ZoomAnchor } from '@/core/zoomFocus';

/** 本模块 logger：保留原 `[ScreenRecord]` 前缀语义，便于既有日志检索习惯延续 */
const log = createLogger('ScreenRecord');

/** 一次录制的启动参数（由面板组件在用户点击"开始录制"时传入） */
export interface RecordingStartParams {
  /** 录制选项：系统音频 / 麦克风 / 画质 / 摄像头画中画 / 按住说话 */
  options: {
    systemAudio: boolean;
    microphone: boolean;
    cursor: boolean;
    quality: 'low' | 'medium' | 'high';
    camera: CameraPipOptions;
    pushToTalk: boolean;
    /** 定时自动停止秒数（0 = 不限；口径为不含暂停的录像时长） */
    autoStopSeconds: number;
    /** 点击/光标高亮（画在被录页面上，整屏与标签页录制可见） */
    cursorHighlight: boolean;
    /** 画面增强（推近聚焦/敏感遮挡）：开启即预建合成器，录制中才能用这些效果 */
    visualFx: boolean;
  };
}

/** 一条已完成的录制产物 */
export interface RecordingFile {
  /** 唯一 id（时间戳派生） */
  id: string;
  /** 文件名（含时间戳，下载/编辑器标题共用） */
  name: string;
  /** 格式化后的时长文本 mm:ss */
  duration: string;
  /** 格式化后的体积文本 */
  size: string;
  /** 录制产物 Blob（页面上下文内有效） */
  blob: Blob;
  /** 供 <a download>/编辑器使用的 object URL */
  url: string;
  /** 创建时间戳 */
  createdAt: number;
}

/* ────────────── 模块级响应式状态（面板卸载不销毁） ────────────── */

/** 是否正在录制（含暂停态；全局角标与面板共用此标记） */
export const recording = ref(false);
/** 是否处于暂停中 */
export const paused = ref(false);
/** 当前显示的用录像秒数（不含暂停段；由 store 内部定时器驱动） */
export const elapsedSeconds = ref(0);
/** 录制相关错误提示（启动失败等；面板与后续视图共用） */
export const error = ref<string | null>(null);
/** 已完成的录制产物列表（最新在前） */
export const recordings = ref<RecordingFile[]>([]);
/** 已开启画笔覆盖层的目标 tabId（停止录制时用于关闭） */
export const annotTabId = ref<number | undefined>(undefined);
/** 正在转码下载的产物 id 集合（按钮 loading 与防连点共用） */
export const downloadingIds = ref<Set<string>>(new Set());
/** 按住说话当前是否处于「按住」态（面板按钮高亮与麦克风指示共用） */
export const pttHolding = ref(false);
/** 本轮是否启用了按住说话（面板据此决定是否显示按住按钮） */
export const pttEnabled = ref(false);
/** 摄像头画中画是否真的在画（获取失败/中途失效时为 false，面板据此提示） */
export const cameraActive = ref(false);
/** 当前画中画配置（录制中可改，面板双向绑定） */
export const cameraPip = ref<CameraPipOptions | null>(null);
/** 本轮自动停止上限秒数（0 = 不限） */
export const autoStopLimit = ref(0);
/** 点击/光标高亮是否已开启（面板录制中开关的显示态） */
export const highlightOn = ref(false);
/** 高亮覆盖层所在 tabId（停止录制时用于关闭；广播到所有 frame） */
export const highlightTabId = ref<number | undefined>(undefined);
/** 画面合成器是否在运行（决定录制中能否推近/遮挡；MediaRecorder 不能中途换轨） */
export const compositorActive = ref(false);
/** 当前画面参数（推近/锚点/遮挡区/画中画），面板双向绑定 */
export const visual = ref<RecordingVisualOptions>({
  camera: { ...DEFAULT_CAMERA_PIP },
  zoom: ZOOM_MIN,
  anchor: 'center',
  blurRegions: [],
  blurStrength: BLUR_STRENGTH_DEFAULT
});
/** 供面板预览的原始采集流（框选遮挡区用；shallowRef 避免 Vue 深度代理 MediaStream） */
export const previewStream = shallowRef<MediaStream | null>(null);
/**
 * 摄像头原始流，供录制中的画中画自view。
 * 画中画是画进视频轨的，页面上没有任何可见浮窗——不给自view的话，
 * 用户开了开关也看不到自己，只能回放成片才知道到底有没有生效。
 */
export const cameraPreviewStream = shallowRef<MediaStream | null>(null);

/* ────────────── 模块级运行时对象（非响应式，仅 store 内部持有） ────────────── */

/** 当前 MediaRecorder 实例（未录制时为 null） */
let mediaRecorder: MediaRecorder | null = null;
/** 录制分片缓冲 */
let chunks: Blob[] = [];
/** 当前采集流（停止时统一释放轨道） */
let stream: MediaStream | null = null;
/** 麦克风原始流（与屏幕流分开持有，停止时一并释放） */
let micStream: MediaStream | null = null;
/** 交给 MediaRecorder 的合成流（混音后音轨 + 原始视频轨） */
let recordStream: MediaStream | null = null;
/** 混音上下文：系统声与麦克风同时存在时必建，停止时关闭以免泄漏 */
let audioCtx: AudioContext | null = null;
/** 摄像头原始流（画中画用，停止时一并释放） */
let cameraStream: MediaStream | null = null;
/** 画面合成器（画中画/推近/遮挡；未开启画面增强时为 null，视频轨直通） */
let compositor: RecordingCompositor | null = null;
/** 麦克风增益门（按住说话用；未启用时为 null） */
let micGain: GainNode | null = null;
/** 按住说话的键盘监听是否已挂载（避免重复注册） */
let pttKeysBound = false;
/** 本轮录制开始时刻（ms） */
let recordingStartTime = 0;
/** 历次暂停区间的累计毫秒数（P1-10 修复语义原样迁移） */
let pausedAccumulatedMs = 0;
/** 本次暂停开始的时刻（0 表示当前不处于暂停中） */
let pausedAtMs = 0;
/** 显示计时器 interval id（store 持有，保证切走 Tab 后角标计时连续） */
let timerInterval: number | null = null;

/* ────────────── 纯计算函数（可单测，不触碰浏览器 API） ────────────── */

/**
 * 计算实际录像毫秒数（纯函数，供单测）。
 * @param nowMs 当前时刻
 * @param startMs 录制开始时刻
 * @param pausedAccumulated 历次暂停的累计毫秒
 * @param activePausedAtMs 本次暂停开始时刻（0=未处于暂停；暂停中按"冻结到暂停起点"处理）
 * @returns 实际录像是毫秒（>=0）
 */
export function computeElapsedMs(
  nowMs: number,
  startMs: number,
  pausedAccumulated: number,
  activePausedAtMs: number
): number {
  // 暂停中：以暂停起点冻结，当前这段暂停不计入
  const effectiveNow = activePausedAtMs > 0 ? Math.min(nowMs, activePausedAtMs) : nowMs;
  return Math.max(0, effectiveNow - startMs - pausedAccumulated);
}

/**
 * 秒数 → 计时文本：不足 1 小时显示 mm:ss，超过则 hh:mm:ss（纯函数，供单测与全局角标共用）。
 * @param totalSeconds 总秒数
 */
export function formatTimerDisplay(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${pad(h)}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
}

/** 计时显示文本（面板大字号与全局角标共用） */
export const timerDisplay = computed(() => formatTimerDisplay(elapsedSeconds.value));

/** 自动停止倒计时文本（不限时为空串，面板据此隐藏） */
export const autoStopCountdown = computed(() => {
  const left = remainingSeconds(elapsedSeconds.value, autoStopLimit.value);
  return autoStopLimit.value > 0 ? formatCountdown(left) : '';
});

/** 录制时长文本 mm:ss（产物列表展示用，沿用面板原格式；无全局同功能实现，模块私有） */
function formatDuration(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60), sec = totalSeconds % 60;
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

/* ────────────── 录制生命周期 ────────────── */

/** 画质 → 采集约束与码率映射（自面板原样迁移） */
const qualityConstraints: Record<string, { width: number; height: number; frameRate: number; videoBitsPerSecond: number }> = {
  low: { width: 1280, height: 720, frameRate: 24, videoBitsPerSecond: 2_000_000 },
  medium: { width: 1920, height: 1080, frameRate: 30, videoBitsPerSecond: 5_000_000 },
  high: { width: 2560, height: 1440, frameRate: 60, videoBitsPerSecond: 10_000_000 },
};

/**
 * 计算并刷新当前显示秒数：当前时刻 - 开始时刻 - 累计暂停时长。
 * 仅在非暂停态调用（暂停态显示由 interval 冻结）。
 */
function refreshElapsedSeconds(): void {
  elapsedSeconds.value = Math.floor(computeElapsedMs(Date.now(), recordingStartTime, pausedAccumulatedMs, 0) / 1000);
}

/**
 * 每秒计时回调：刷新显示秒数，并判定是否到达自动停止点。
 * 判定只放在这里而不是 refreshElapsedSeconds 内部——后者也被 stopRecording 调用，
 * 放进去会形成「停止 → 刷新 → 又判定到点 → 再停止」的递归。
 */
function tick(): void {
  refreshElapsedSeconds();
  if (recording.value && shouldAutoStop(elapsedSeconds.value, autoStopLimit.value)) {
    toast.info(`已录满 ${formatCountdown(autoStopLimit.value)}，自动停止录制`);
    log.info(`定时自动停止触发：上限 ${autoStopLimit.value}s`);
    stopRecording();
  }
}

/** 启动/重启显示计时器（开始录制与暂停恢复共用，避免重复的 interval 回调实现） */
function startElapsedTimer(): void {
  if (timerInterval) clearInterval(timerInterval);
  timerInterval = window.setInterval(tick, 1000);
}

/**
 * 开始录制：调 getDisplayMedia 弹系统选择器取得媒体流（选择器内可直接选
 * 整个屏幕 / 应用窗口 / 浏览器标签页，因此不再单设"标签页"定向采集模式），
 * 混音麦克风、开启画笔覆盖层，并创建 MediaRecorder 开始切片。
 * 状态全部写入本 store；失败时写入 error 并保持可重试。
 * @param params 启动参数（录制选项）
 */
export async function startRecording(params: RecordingStartParams): Promise<void> {
  // 重入守卫：两次启动会共写模块级 chunks，产出互相混损的录像
  if (recording.value || (mediaRecorder && mediaRecorder.state !== 'inactive')) {
    log.warn('已有录制进行中，忽略重复启动');
    toast.info('正在录制中，请先停止当前录制');
    return;
  }
  error.value = null;
  try {
    const q = qualityConstraints[params.options.quality];
    // DisplayMediaStreamOptions 是 TS 全局 DOM 类型，no-undef 不识别；
    // 沿用面板既有写法：结构化的 Parameters 派生类型
    const displayConstraints: Parameters<typeof navigator.mediaDevices.getDisplayMedia>[0] = {
      video: { width: { ideal: q.width }, height: { ideal: q.height }, frameRate: { ideal: q.frameRate } } as any,
      audio: params.options.systemAudio,
    };

    // 统一走系统选择器：用户可在弹窗内选择屏幕 / 窗口 / 标签页
    stream = await navigator.mediaDevices.getDisplayMedia(displayConstraints);

    const videoTracks = stream.getVideoTracks();
    if (videoTracks.length === 0) {
      throw new Error('采集流不含画面，请重新选择要录制的屏幕 / 窗口 / 标签页');
    }
    const systemAudioTracks = stream.getAudioTracks();
    if (params.options.systemAudio && systemAudioTracks.length === 0) {
      // Chrome 的「应用窗口」采集不给音轨；不提示的话用户会拿到一部无声成片
      toast.info('所选来源不提供系统声音，本次将无声录制；需要声音请改选「整个屏幕」或「浏览器标签页」');
    }

    // 麦克风失败降级为不录人声，不中断主流程
    if (params.options.microphone) {
      try {
        micStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      } catch (e) {
        log.warn('麦克风获取失败，已忽略', e);
        toast.info('麦克风不可用，本次不录制人声');
      }
    }

    // 摄像头画中画：失败同样降级（不录摄像头），不能让主录制跟着失败
    let pipOptions: CameraPipOptions = { ...params.options.camera };
    if (pipOptions.enabled) {
      try {
        cameraStream = await navigator.mediaDevices.getUserMedia({
          video: cameraConstraints(pipOptions.size),
          audio: false
        });
      } catch (e) {
        log.warn('摄像头获取失败，已忽略', e);
        toast.info('摄像头不可用，本次不录画中画');
        pipOptions = { ...pipOptions, enabled: false };
      }
    }

    // 视频轨：需要画面效果时走 canvas 合成，否则直通（零额外开销、无画质损失）。
    // 合成器必须在开始前建好——MediaRecorder 不能中途换视频轨，
    // 所以「推近/遮挡」由启动前的 visualFx 开关决定是否可用。
    const tracks: MediaStreamTrack[] = [];
    const wantFx = params.options.visualFx || pipOptions.enabled;
    if (wantFx) {
      const initialVisual: RecordingVisualOptions = {
        camera: pipOptions,
        zoom: ZOOM_MIN,
        anchor: 'center',
        blurRegions: [],
        blurStrength: BLUR_STRENGTH_DEFAULT
      };
      try {
        compositor = await createRecordingCompositor(stream, cameraStream, initialVisual, q.frameRate);
        tracks.push(compositor.track);
        visual.value = initialVisual;
        compositorActive.value = true;
        previewStream.value = stream;
        cameraActive.value = !!(cameraStream && pipOptions.enabled);
        cameraPip.value = cameraActive.value ? pipOptions : null;
        cameraPreviewStream.value = cameraActive.value ? cameraStream : null;
        // 摄像头中途失效（拔设备/撤权限）：合成轨不能换，只停止画摄像头
        cameraStream?.getVideoTracks()[0]?.addEventListener('ended', () => {
          cameraActive.value = false;
          cameraPip.value = null;
          cameraPreviewStream.value = null;
          visual.value = { ...visual.value, camera: { ...visual.value.camera, enabled: false } };
          compositor?.update(visual.value);
          toast.info('摄像头已断开，画面继续录制（不再含画中画）');
        });
      } catch (e) {
        log.warn('画面合成失败，回退为纯屏幕画面', e);
        toast.info('画面增强不可用，本次只录原始屏幕画面');
        compositor = null;
        compositorActive.value = false;
        previewStream.value = null;
        cameraActive.value = false;
        cameraPip.value = null;
        cameraPreviewStream.value = null;
        cameraStream?.getTracks().forEach(t => { try { t.stop(); } catch { /* noop */ } });
        cameraStream = null;
      }
    }
    if (tracks.length === 0) tracks.push(...videoTracks);

    // MediaRecorder 只采集第一条音轨：两路音频必须先混音，否则其中一路被静默丢弃。
    // 按住说话要给麦克风插增益节点，所以「只有麦克风」时也必须建混音图（判定见 planAudioGraph）
    const micTracks = micStream?.getAudioTracks() ?? [];
    const plan = planAudioGraph({
      hasSystemAudio: systemAudioTracks.length > 0,
      hasMicrophone: micTracks.length > 0,
      pushToTalk: params.options.pushToTalk
    });
    if (plan.needsMixer) {
      audioCtx = new AudioContext();
      // 用户手势可能已在上面的 await 中失效，上下文会停在 suspended
      if (audioCtx.state === 'suspended') void audioCtx.resume();
      const dest = audioCtx.createMediaStreamDestination();
      if (systemAudioTracks.length > 0) {
        audioCtx.createMediaStreamSource(new MediaStream(systemAudioTracks)).connect(dest);
      }
      if (micTracks.length > 0) {
        const micSource = audioCtx.createMediaStreamSource(new MediaStream(micTracks));
        if (plan.micThroughGain) {
          micGain = audioCtx.createGain();
          micGain.gain.value = 0; // 默认静音，按住才出声
          micSource.connect(micGain).connect(dest);
        } else {
          micSource.connect(dest);
        }
      }
      tracks.push(...dest.stream.getAudioTracks());
    } else {
      if (systemAudioTracks.length > 0) tracks.push(...systemAudioTracks);
      if (micTracks.length > 0) tracks.push(...micTracks);
    }
    recordStream = new MediaStream(tracks);

    chunks = [];
    const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9,opus')
      ? 'video/webm;codecs=vp9,opus'
      : 'video/webm';

    mediaRecorder = new MediaRecorder(recordStream, {
      mimeType,
      videoBitsPerSecond: q.videoBitsPerSecond,
    });

    mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };

    // 开启页面画笔覆盖层（走自动注入通道：页面在扩展重载前打开也能出现工具栏）
    try {
      // 画笔覆盖在当前活动标签页（录制目标由系统选择器决定，覆盖层始终画在用户操作的页面上）
      const t = await chrome.tabs.query({ active: true, currentWindow: true });
      const overlayTabId = t[0]?.id;
      if (overlayTabId != null && Number.isFinite(overlayTabId)) {
        annotTabId.value = overlayTabId;
        // frameId: 0 → 只在顶层 frame 创建覆盖层（避免 iframe 重复弹工具栏）
        await sendMessageToTab(overlayTabId, { type: MessageType.ANNOTATE_TOGGLE, payload: { active: true } }, { frameId: 0 });
      }
    } catch {
      toast.info('该页面不支持画笔工具（浏览器内部页，或页面需刷新后重试）');
    }
    mediaRecorder.onstop = () => finalizeRecording();
    mediaRecorder.start(1000); // 每秒切片

    // 用户在系统弹窗点「停止共享」：以 recorder 状态判定而非 recording.value——
    // 后者到本函数末尾才置位，注册与置位之间的窗口期会漏掉 ended 事件
    videoTracks[0].addEventListener('ended', () => {
      if (mediaRecorder && mediaRecorder.state !== 'inactive') stopRecording();
    });

    // 进入录制态：状态写入 store，面板与全局角标同时可见
    recording.value = true;
    paused.value = false;
    recordingStartTime = Date.now();
    // 新一轮录制：重置暂停累计，保证计时从 0 开始
    pausedAccumulatedMs = 0;
    pausedAtMs = 0;
    elapsedSeconds.value = 0;
    autoStopLimit.value = normalizeAutoStopSeconds(params.options.autoStopSeconds);
    startElapsedTimer();
    // 点击/光标高亮：与画笔同一目标页，但广播到所有 frame（iframe 内的点击也要有高亮）
    if (params.options.cursorHighlight) void setCursorHighlight(true);
    // 按住说话：只有真拿到麦克风增益门才启用（麦克风失败时按钮不该出现）
    pttEnabled.value = !!micGain;
    pttHolding.value = false;
    if (pttEnabled.value) bindPttKeys();
    log.info(`开始录制（系统选择器，画质 ${params.options.quality}，画中画 ${cameraActive.value ? '开' : '关'}，按住说话 ${pttEnabled.value ? '开' : '关'}，音轨 ${plan.silent ? '无' : '有'}）`);

  } catch (e: any) {
    if (e?.name === 'NotAllowedError') {
      error.value = '已取消或权限被拒绝，请允许屏幕录制权限';
    } else {
      error.value = e?.message || '启动录制失败';
    }
    // 启动失败：清理可能已部分建立的流与混音上下文，避免轨道泄漏
    releaseStream();
    mediaRecorder = null;
  }
}

/**
 * 暂停 / 恢复录制（原面板逻辑迁移到 store）：
 *  - 暂停：MediaRecorder.pause()，记录暂停起点并冻结显示计时；
 *  - 恢复：把刚结束的这段暂停时长并入累计值，计时器从"扣除暂停后的真实录像秒数"继续。
 */
export function togglePause(): void {
  if (!mediaRecorder) return;
  if (paused.value) {
    mediaRecorder.resume();
    pausedAccumulatedMs += Date.now() - pausedAtMs;
    pausedAtMs = 0;
    refreshElapsedSeconds();
    startElapsedTimer();
    log.info(`恢复录制，累计暂停 ${(pausedAccumulatedMs / 1000).toFixed(1)}s，当前录像时长 ${elapsedSeconds.value}s`);
  } else {
    mediaRecorder.pause();
    pausedAtMs = Date.now();
    if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
    log.info('暂停录制，计时冻结于 ' + elapsedSeconds.value + 's');
  }
  paused.value = !paused.value;
}

/* ────────────── 全局快捷键命令（chrome.commands → 背景 → 侧栏） ────────────── */

/** 命令监听是否已安装（幂等；安装后不摘除——切走 Tab 录制仍在继续，快捷键必须一直可用） */
let commandListenerInstalled = false;

/**
 * 安装录制控制命令监听。由录制面板挂载时调用一次。
 * 侧栏整体关闭时本上下文销毁，录制也随之结束，所以不存在「命令到了但没人处理」的中间态。
 */
export function installRecordingCommandListener(): void {
  if (commandListenerInstalled) return;
  commandListenerInstalled = true;
  if (!chrome?.runtime?.onMessage?.addListener) {
    log.debug('非扩展运行环境（chrome.runtime 不可用），跳过录制命令监听安装');
    return;
  }
  chrome.runtime.onMessage.addListener((msg: unknown) => {
    const m = msg as { type?: string; action?: string };
    if (m?.type !== MessageType.RECORDING_COMMAND) return;
    if (!recording.value) {
      log.debug('收到录制命令但当前无进行中的录制，忽略');
      return;
    }
    if (m.action === 'toggle-pause') {
      togglePause();
      toast.info(paused.value ? '已暂停录制（Alt+Shift+P 继续）' : '已继续录制');
    } else if (m.action === 'stop') {
      stopRecording();
    }
  });
}

/* ────────────── 按住说话 / 画中画（Round 5 #31） ────────────── */

/**
 * 设置「按住」态：用 setTargetAtTime 平滑过渡，硬切 gain 会产生可闻的爆音。
 * 未启用按住说话（micGain 为 null）时只更新 UI 态，不动音频图。
 */
export function setPttHolding(holding: boolean): void {
  if (pttHolding.value === holding) return;
  pttHolding.value = holding;
  if (!micGain || !audioCtx) return;
  micGain.gain.setTargetAtTime(pttTargetGain(holding), audioCtx.currentTime, pttTimeConstant(holding));
}

/** 键盘监听：只在侧栏文档内生效，不注入页面抢按键（页面里按 V 可能正在输入） */
function bindPttKeys(): void {
  if (pttKeysBound) return;
  pttKeysBound = true;
  window.addEventListener('keydown', onPttKeyDown);
  window.addEventListener('keyup', onPttKeyUp);
  // 失焦时 keyup 可能永远收不到（切到别的应用），必须主动松手，否则麦克风一直开着
  window.addEventListener('blur', onPttBlur);
}

function unbindPttKeys(): void {
  if (!pttKeysBound) return;
  pttKeysBound = false;
  window.removeEventListener('keydown', onPttKeyDown);
  window.removeEventListener('keyup', onPttKeyUp);
  window.removeEventListener('blur', onPttBlur);
}

function onPttKeyDown(e: KeyboardEvent): void {
  if (e.repeat) return;
  const target = e.target as HTMLElement | null;
  const editable = isEditableTarget(target?.tagName, !!target?.isContentEditable);
  if (!isPttActivation(e.code, { ctrlKey: e.ctrlKey, altKey: e.altKey, metaKey: e.metaKey }, editable)) return;
  e.preventDefault();
  setPttHolding(true);
}

function onPttKeyUp(e: KeyboardEvent): void {
  if (e.code !== PTT_KEY_CODE) return;
  setPttHolding(false);
}

function onPttBlur(): void {
  setPttHolding(false);
}

/** 把当前画面参数推给合成器（所有 setter 的唯一出口，避免漏更新） */
function pushVisual(): void {
  compositor?.update(visual.value);
}

/** 录制中调整画中画（位置/尺寸/外形/镜像）；未开启画中画时忽略 */
export function updateCameraPip(next: CameraPipOptions): void {
  cameraPip.value = { ...next };
  visual.value = { ...visual.value, camera: { ...next, enabled: cameraActive.value && next.enabled } };
  pushVisual();
}

/* ────────────── 推近聚焦 / 敏感区遮挡（Round 5 #33） ────────────── */

/** 设定目标推近倍率（实际倍率由合成器按指数缓动趋近，观感是平滑推近而非跳变） */
export function setZoom(value: number): void {
  visual.value = { ...visual.value, zoom: clampZoom(value) };
  pushVisual();
}

/** 推近一档 */
export function zoomIn(): void { setZoom(visual.value.zoom + ZOOM_STEP); }
/** 拉远一档 */
export function zoomOut(): void { setZoom(visual.value.zoom - ZOOM_STEP); }
/** 回到原画 */
export function resetZoom(): void { setZoom(ZOOM_MIN); }

/** 设定推近锚点（画面以哪个角为中心推近） */
export function setZoomAnchor(anchor: ZoomAnchor): void {
  visual.value = { ...visual.value, anchor };
  pushVisual();
}

/**
 * 新增一个遮挡区（归一化源坐标）。
 * 用源坐标而不是输出坐标：推近/拉远时遮挡区要跟着内容走，不能钉在屏幕某个像素上。
 */
export function addBlurRegion(region: NormRect): void {
  const item: BlurRegion = { ...region, id: `blur_${Date.now()}_${Math.random().toString(36).slice(2, 7)}` };
  visual.value = { ...visual.value, blurRegions: [...visual.value.blurRegions, item] };
  pushVisual();
}

/** 删除一个遮挡区 */
export function removeBlurRegion(id: string): void {
  visual.value = { ...visual.value, blurRegions: visual.value.blurRegions.filter(r => r.id !== id) };
  pushVisual();
}

/** 清空全部遮挡区 */
export function clearBlurRegions(): void {
  visual.value = { ...visual.value, blurRegions: [] };
  pushVisual();
}

/** 设定模糊强度 */
export function setBlurStrength(value: number): void {
  visual.value = { ...visual.value, blurStrength: value };
  pushVisual();
}

/** 推近倍率上下限（面板按钮禁用态用） */
export const zoomBounds = { min: ZOOM_MIN, max: ZOOM_MAX, step: ZOOM_STEP };

/**
 * 开关点击/光标高亮覆盖层（Round 5 #32）。
 * 不指定 frameId → 广播到该 tab 的所有 frame；页面不支持注入时静默降级，
 * 高亮只是增强项，不能让它影响录制本身。
 */
export async function setCursorHighlight(active: boolean): Promise<void> {
  try {
    if (active) {
      const t = await chrome.tabs.query({ active: true, currentWindow: true });
      const tabId = t[0]?.id;
      if (tabId == null || !Number.isFinite(tabId)) return;
      highlightTabId.value = tabId;
      await sendMessageToTab(tabId, { type: MessageType.CURSOR_HIGHLIGHT_TOGGLE, payload: { active: true } });
      highlightOn.value = true;
    } else {
      const tabId = highlightTabId.value;
      highlightTabId.value = undefined;
      highlightOn.value = false;
      if (tabId != null) {
        await sendMessageToTab(tabId, { type: MessageType.CURSOR_HIGHLIGHT_TOGGLE, payload: { active: false } });
      }
    }
  } catch (e) {
    log.warn('点击高亮切换失败（页面可能不支持注入）', e);
    highlightOn.value = false;
    if (active) toast.info('该页面不支持点击高亮（浏览器内部页，或页面需刷新后重试）');
  }
}

/** 关闭页面画笔覆盖层（停止录制时调用；失败静默——目标页可能已关闭） */
async function closeAnnotate(): Promise<void> {
  const tabId = annotTabId.value;
  annotTabId.value = undefined;
  if (tabId == null) return;
  try {
    await sendMessageToTab(tabId, { type: MessageType.ANNOTATE_TOGGLE, payload: { active: false } }, { frameId: 0 });
  } catch { /* noop */ }
}

/**
 * 停止录制：关闭覆盖层、冻结最终时长、结束 MediaRecorder。
 * 轨道释放推迟到 onstop（finalizeRecording）：stop() 后同步停轨会截掉末尾约 1s 的画面与声音。
 */
export function stopRecording(): void {
  void closeAnnotate();
  void setCursorHighlight(false);
  autoStopLimit.value = 0;
  // 按住说话：先松手再摘监听，避免麦克风增益停在打开态
  setPttHolding(false);
  unbindPttKeys();
  pttEnabled.value = false;
  if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
  // 非暂停态停止：刷新一次到精确值（interval 每秒一跳，最多差 1s），
  // 暂停态停止：elapsedSeconds 已冻结在暂停起点的真实录像时长，不要加上暂停段
  if (!paused.value && recordingStartTime) {
    refreshElapsedSeconds();
  }
  recording.value = false;
  paused.value = false;
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    mediaRecorder.stop();
  } else {
    releaseStream();
  }
  log.info('已停止录制，等待分片汇总产出文件');
}

/** 释放本轮录制占用的全部轨道与混音上下文（汇总完成后或启动失败时调用） */
function releaseStream(): void {
  // 合成器先停：它持有 canvas 轨与两个 video 元素，晚停会多画几帧无用功
  compositor?.stop();
  compositor = null;
  compositorActive.value = false;
  previewStream.value = null;
  cameraActive.value = false;
  cameraPip.value = null;
  cameraPreviewStream.value = null;
  visual.value = { camera: { ...DEFAULT_CAMERA_PIP }, zoom: ZOOM_MIN, anchor: 'center', blurRegions: [], blurStrength: BLUR_STRENGTH_DEFAULT };
  // 合成流与原始流共享同一批轨道对象，去重后每条只停一次
  const tracks = new Set<MediaStreamTrack>();
  for (const s of [recordStream, stream, micStream, cameraStream]) {
    s?.getTracks().forEach(t => tracks.add(t));
  }
  tracks.forEach(t => { try { t.stop(); } catch { /* noop */ } });
  recordStream = null;
  stream = null;
  micStream = null;
  cameraStream = null;
  micGain = null;
  if (audioCtx) {
    void audioCtx.close().catch(() => { /* 已关闭时 close 会拒绝，忽略 */ });
    audioCtx = null;
  }
}

/** MediaRecorder onstop 回调：把分片组装为 Blob、生成 object URL 并入产物列表（最新在前） */
function finalizeRecording(): void {
  const blob = new Blob(chunks, { type: 'video/webm' });
  const url = URL.createObjectURL(blob);
  const duration = formatDuration(elapsedSeconds.value);
  const size = formatBytes(blob.size);
  // 文件名含本地时间戳（字符类内 `/` 无需转义，沿用面板 lint 修复后的写法）
  const name = `录制_${new Date().toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).replace(/[/:]/g, '-')}.webm`;
  recordings.value.unshift({ id: `rec_${Date.now()}`, name, duration, size, blob, url, createdAt: Date.now() });
  chunks = [];
  mediaRecorder = null;
  releaseStream();
  log.info(`录制完成：${name}（${duration} / ${size}）`);
}

/* ────────────── 产物操作（面板仅做视图绑定，统一经 store 修改状态） ────────────── */

/**
 * 删除一条录制产物：释放 object URL 并从列表移除。
 * 调用方（面板）必须先经确认对话框，避免误删不可恢复的文件。
 * @param rec 目标产物
 */
export function deleteRecording(rec: RecordingFile): void {
  URL.revokeObjectURL(rec.url);
  recordings.value = recordings.value.filter(r => r.id !== rec.id);
  log.info(`已删除录制产物：${rec.name}`);
}

/**
 * 下载一条录制产物（自动转码 MP4，修复「下载后播放不了」的反馈）。
 *
 * 背景：录屏产物为 MediaRecorder 的 webm（VP9/Opus 且缺 Duration 头），
 * Windows 默认播放器无法打开；下载前经 WebCodecs 转为 H.264/AAC 的 MP4
 * （全播放器兼容）。环境不支持或转码失败时回退原样 webm 下载，保证产物不丢。
 * 转码为逐帧重编码，耗时与片长正相关，按钮经 downloadingIds 展示 loading 防连点。
 * @param rec 目标产物
 */
export async function downloadRecording(rec: RecordingFile): Promise<void> {
  // 防重复点击：同一条目转码进行中直接忽略
  if (downloadingIds.value.has(rec.id)) return;
  downloadingIds.value.add(rec.id);
  log.info(`开始转码下载录屏产物：${rec.name}`);
  try {
    if (!canConvertMedia()) {
      // 环境不支持 WebCodecs：原样下载并提示兼容性风险
      log.warn('环境不支持 WebCodecs，原样下载 webm');
      triggerBlobDownload(rec.blob, rec.name);
      toast.info('当前环境不支持转码，已按原始格式下载（webm 需 Chrome/VLC 播放）');
      return;
    }
    toast.info('正在转换视频格式，请稍候…');
    // 时长兜底：webm 缺 Duration 头且 seek 修复失败时，用 store 记录的时长
    const knownSec = parseDurationTextToSeconds(rec.duration);
    const mp4 = await convertVideoBlobToMp4(rec.blob, {
      durationSec: knownSec > 0 ? knownSec : undefined,
    });
    triggerBlobDownload(mp4, rec.name.replace(/\.webm$/i, '.mp4'));
    toast.success('已开始下载（通用格式，任意播放器可打开）');
    log.info(`录屏转码下载完成：${rec.name}`);
  } catch (e) {
    // 转码失败兜底：原样下载 webm
    log.error('录屏转码失败，回退原样下载', e);
    triggerBlobDownload(rec.blob, rec.name);
    toast.error('转码失败，已按原始格式下载（webm 需 Chrome/VLC 播放）');
  } finally {
    downloadingIds.value.delete(rec.id);
  }
}

/**
 * 时长文本 → 秒数（mm:ss 或 hh:mm:ss；转码时作为 webm 缺 Duration 头的兜底）。
 * @param text 时长文本（formatDuration / formatTimerDisplay 产物）
 * @returns 秒数（解析失败返回 0）
 */
export function parseDurationTextToSeconds(text: string): number {
  const parts = String(text || '').split(':').map((p) => Number(p));
  if (parts.some((n) => !Number.isFinite(n))) return 0;
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return 0;
}
