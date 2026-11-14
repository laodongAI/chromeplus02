/**
 * 录制产物转码核心：WebM → MP4(H.264/AAC) / WebM(Opus) → M4A(AAC)。
 *
 * 背景（用户反馈「录制的视频下载后播放不了 / 录制音频打不开」）：
 *  - MediaRecorder 产物一律是 WebM 容器（VP9/Opus），Windows 默认播放器
 *    （电影和电视 / Windows Media Player）不带对应解码器，双击即报"无法播放"；
 *  - 且 MediaRecorder 写出的 webm 普遍缺 Duration 头，进一步降低播放器兼容性。
 *  解法：下载/导出前统一转码为 H.264+AAC 的 MP4（音频为 M4A），全播放器兼容。
 *
 * 实现路线（不引入新依赖，复用项目既有 WebCodecs 引擎）：
 *  - 视频：隐藏 <video> 解码 webm → 逐帧 seek+drawImage → exportMp4（VideoEncoder H.264）；
 *    音频轨经 decodeAudioData 还原为 PCM 后编码 AAC（无声/解码失败自动降级无声）。
 *  - 音频：decodeAudioData → encodeAudioBufferToMuxer（与 mp4Export 共用同一 AAC 编码循环）
 *    → mp4-muxer 纯音频封装 → M4A。
 *  - 环境不支持 WebCodecs 时（canConvertMedia()=false）由调用方回退原样下载。
 */

// vendored ESM（与 mp4Export 同一来源；类型缺失用 expect-error 压制）
// @ts-expect-error vendored mp4-muxer 无可解析的本地类型入口
import { Muxer, ArrayBufferTarget } from '@/vendor/mp4-muxer.mjs';
import { canUseWebCodecsExport, exportMp4, encodeAudioBufferToMuxer } from './mp4Export';
// 分级日志（运行于扩展页面上下文：侧栏/编辑器，默认 info 级）
import { createLogger } from '@/utils/logger';

/** 本模块 logger：统一 `[mediaConvert]` 前缀，记录转码里程碑与降级原因 */
const log = createLogger('mediaConvert');

/** 单帧 seek 等待上限（毫秒）：个别帧 seek 卡死不能拖死整次转码，超时按当前画面继续 */
const SEEK_TIMEOUT_MS = 4000;
/** 元数据加载等待上限（毫秒） */
const METADATA_TIMEOUT_MS = 15000;

/**
 * 环境是否具备转码能力（WebCodecs 三件套齐备）。
 * 调用方在转码前预检：false 时应回退"原样下载 webm"，而不是直接报错。
 */
export function canConvertMedia(): boolean {
  return canUseWebCodecsExport();
}

/**
 * 视频探测结果：隐藏 <video> 元素 + 关键元数据。
 * 调用方负责在转码结束后调用 cleanup() 释放 object URL。
 */
export interface VideoProbe {
  /** 隐藏 video 元素（逐帧 seek 取帧用；已挂到 document.body，勿移动） */
  el: HTMLVideoElement;
  /** 产物的 object URL（cleanup 时统一 revoke） */
  url: string;
  /** 视频宽（px；纯音频产物为 0） */
  width: number;
  /** 视频高（px；纯音频产物为 0） */
  height: number;
  /** 时长（秒；已做 Infinity 修复与兜底） */
  durationSec: number;
  /** 释放 object URL（幂等由 URL.revokeObjectURL 自身保证） */
  cleanup: () => void;
}

/**
 * 等待元素指定事件一次（带超时）：超时 reject，由调用方决定降级。
 * @param el 目标媒体元素
 * @param event 事件名（loadedmetadata / seeked 等）
 * @param timeoutMs 超时毫秒
 */
function onceEvent(el: HTMLMediaElement, event: string, timeoutMs: number): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    /** 超时定时器：到期清理监听并 reject */
    const timer = window.setTimeout(() => {
      el.removeEventListener(event, onOk);
      reject(new Error(`等待 ${event} 超时（${timeoutMs}ms）`));
    }, timeoutMs);
    /** 事件命中：清定时器并 resolve */
    const onOk = () => {
      window.clearTimeout(timer);
      el.removeEventListener(event, onOk);
      resolve();
    };
    el.addEventListener(event, onOk);
  });
}

/**
 * 探测视频 Blob 元数据（宽高/时长），并修复 MediaRecorder webm 的时长缺失问题。
 *
 * 已知 Chrome 行为：MediaRecorder 产出的 webm 缺 Duration 头，
 * 播放元素读到的 duration 为 Infinity；把 currentTime seek 到极大值可迫使
 * 浏览器扫描至文件尾并回填真实时长（社区通用 workaround，两步都做了兜底）。
 *
 * @param blob 视频产物
 * @param fallbackDurationSec 调用方已知的真实时长（秒）：seek 修复仍失败时采用
 * @returns 探测结果（含 cleanup）
 * @throws 元数据加载失败且无兜底时长时抛出
 */
export async function probeVideoBlob(blob: Blob, fallbackDurationSec?: number): Promise<VideoProbe> {
  const url = URL.createObjectURL(blob);
  /** cleanup：释放 object URL（异常路径与正常路径共用） */
  const cleanup = () => { try { URL.revokeObjectURL(url); } catch { /* noop */ } };
  const el = document.createElement('video');
  el.preload = 'auto';
  el.muted = true; // 静音：避免自动播放策略干扰；音轨另行经 decodeAudioData 解码
  el.src = url;
  document.body.appendChild(el);
  try {
    await onceEvent(el, 'loadedmetadata', METADATA_TIMEOUT_MS);
  } catch (e) {
    el.remove();
    cleanup();
    log.error('视频元数据加载失败', e);
    throw e instanceof Error ? e : new Error(String(e));
  }

  let durationSec = el.duration;
  // ── Duration=Infinity 修复：seek 到极大时间迫使浏览器回填真实时长 ──
  if (!isFinite(durationSec) || durationSec <= 0) {
    log.info('检测到 webm 缺 Duration 头（Infinity），尝试 seek 修复');
    try {
      el.currentTime = 1e7;
      await onceEvent(el, 'seeked', SEEK_TIMEOUT_MS + 4000);
      if (isFinite(el.duration) && el.duration > 0 && el.duration < 1e6) {
        durationSec = el.duration;
        log.info(`seek 修复成功，真实时长 ${durationSec.toFixed(2)}s`);
      }
    } catch (e) {
      log.warn('seek 修复时长失败，改用调用方提供的兜底时长', e);
    }
    // seek 后把播放头归零，后续逐帧渲染从 0 开始
    try { el.currentTime = 0; } catch { /* noop */ }
  }
  if (!isFinite(durationSec) || durationSec <= 0) {
    if (fallbackDurationSec && fallbackDurationSec > 0) {
      durationSec = fallbackDurationSec;
      log.warn(`采用调用方兜底时长 ${durationSec}s`);
    } else {
      el.remove();
      cleanup();
      throw new Error('无法读取视频时长（录制文件可能损坏）');
    }
  }

  const probe: VideoProbe = {
    el,
    url,
    width: el.videoWidth || 0,
    height: el.videoHeight || 0,
    durationSec,
    cleanup: () => { el.remove(); cleanup(); },
  };
  log.debug(`视频探测完成：${probe.width}x${probe.height} / ${durationSec.toFixed(2)}s`);
  return probe;
}

/**
 * 把隐藏 video 元素 seek 到指定时刻并等待就绪（带超时与"已就位"短路）。
 * @param el 目标 video 元素
 * @param timeSec 目标时刻（秒）
 */
async function seekVideo(el: HTMLVideoElement, timeSec: number): Promise<void> {
  // 目标时刻与当前播放头几乎重合：seeked 不会再触发，直接返回
  if (Math.abs(el.currentTime - timeSec) < 1 / 60) return;
  el.currentTime = timeSec;
  try {
    await onceEvent(el, 'seeked', SEEK_TIMEOUT_MS);
  } catch {
    // 单帧 seek 超时不中断整次转码：按当前画面继续（个别帧重复优于整体失败）
    log.warn(`seek ${timeSec.toFixed(2)}s 超时，按当前帧继续`);
  }
}

/**
 * 解码媒体 Blob 的音轨为 PCM（AudioBuffer）。
 * @param blob 媒体产物（webm 等）
 * @param strict true=解码失败抛错（纯音频转码场景）；false=失败返回 null（视频伴音降级无声）
 */
async function decodeBlobAudio(blob: Blob, strict: boolean): Promise<AudioBuffer | null> {
  try {
    const ab = await blob.arrayBuffer();
    const ac = new AudioContext();
    try {
      const buf = await ac.decodeAudioData(ab);
      return buf && buf.length > 0 ? buf : null;
    } finally {
      // AudioContext 用完即关，避免占用音频硬件句柄
      void ac.close().catch(() => { /* noop */ });
    }
  } catch (e) {
    if (strict) {
      log.error('音频解码失败（无法转码）', e);
      throw e instanceof Error ? e : new Error(String(e));
    }
    log.warn('音轨解码失败，按无声视频继续', e);
    return null;
  }
}

/** 视频转 MP4 的可选项 */
export interface ConvertVideoOptions {
  /** 调用方已知的真实时长（秒）：webm 缺 Duration 头且 seek 修复失败时兜底 */
  durationSec?: number;
  /** 输出帧率（默认 30；录制源帧率未知时的稳妥值） */
  fps?: number;
  /** 输出码率（bps；缺省由 exportMp4 按分辨率自适应） */
  bitrate?: number;
  /** 进度回调 0~1（逐帧渲染口径） */
  onProgress?: (ratio: number) => void;
}

/**
 * 视频 Blob（webm）→ MP4(H.264/AAC)。
 * 逐帧 seek 渲染 + WebCodecs 编码，速度慢于实时但全播放器兼容；
 * 失败时抛错，由调用方决定回退（原样下载 webm）。
 * @param blob 录制产物
 * @param opts 可选项（时长兜底/帧率/进度）
 * @returns MP4 Blob（type=video/mp4）
 */
export async function convertVideoBlobToMp4(blob: Blob, opts: ConvertVideoOptions = {}): Promise<Blob> {
  if (!canConvertMedia()) throw new Error('当前环境不支持 WebCodecs，无法转换 MP4');
  const probe = await probeVideoBlob(blob, opts.durationSec);
  if (!probe.width || !probe.height) {
    probe.cleanup();
    throw new Error('产物不含视频轨道，请改用音频转码（M4A）');
  }
  try {
    const fps = opts.fps ?? 30;
    log.info(`开始转码 MP4：${probe.width}x${probe.height} / ${probe.durationSec.toFixed(2)}s / ${fps}fps`);
    const mp4 = await exportMp4({
      width: probe.width,
      height: probe.height,
      fps,
      durationSec: probe.durationSec,
      bitrate: opts.bitrate,
      // 逐帧渲染：seek 共享探测元素 → 画到导出画布
      drawFrame: async (canvas, timeSec) => {
        await seekVideo(probe.el, Math.min(timeSec, Math.max(0, probe.durationSec - 0.01)));
        const ctx = canvas.getContext('2d');
        if (ctx) ctx.drawImage(probe.el, 0, 0, canvas.width, canvas.height);
      },
      // 伴音：解码失败自动降级无声（exportMp4 内部还有 AAC 支持预检）
      mixAudio: () => decodeBlobAudio(blob, false),
      onProgress: opts.onProgress,
    });
    log.info(`转码 MP4 完成：${(mp4.size / 1048576).toFixed(2)}MB`);
    return mp4;
  } finally {
    probe.cleanup();
  }
}

/**
 * 音频 Blob（webm/opus）→ M4A(AAC)。
 * 纯音频录制（mode='audio'）的下载兼容格式：Windows/手机默认播放器均可直接打开。
 * @param blob 录音产物
 * @param onProgress 进度回调 0~1（解码 20% + 编码 70% + 封装 10%）
 * @returns M4A Blob（type=audio/mp4）
 */
export async function convertAudioBlobToM4a(blob: Blob, onProgress?: (ratio: number) => void): Promise<Blob> {
  if (!canConvertMedia()) throw new Error('当前环境不支持 WebCodecs，无法转换 M4A');
  onProgress?.(0.05);
  log.info(`开始转码 M4A：${(blob.size / 1048576).toFixed(2)}MB`);
  // 纯音频场景解码失败必须抛错（没有"无声"降级可言）
  const audioBuf = await decodeBlobAudio(blob, true);
  if (!audioBuf) throw new Error('录音内容为空，无法转码');
  onProgress?.(0.2);

  const target = new ArrayBufferTarget();
  // 纯音频封装：只声明音轨（mp4-muxer 支持 audio-only，产出即 .m4a 兼容文件）
  const muxer = new Muxer({
    target,
    fastStart: 'in-memory',
    audio: {
      codec: 'aac' as const,
      sampleRate: audioBuf.sampleRate,
      numberOfChannels: Math.min(2, audioBuf.numberOfChannels),
    },
  } as any);

  await encodeAudioBufferToMuxer(
    audioBuf,
    (chunk, meta) => (muxer as any).addAudioChunk(chunk, meta),
    // 编码进度映射到总进度 20%~90% 区间
    (r) => onProgress?.(0.2 + r * 0.7)
  );
  onProgress?.(0.95);
  (muxer as any).finalize();
  const buffer = (target as any).buffer as ArrayBuffer;
  onProgress?.(1);
  log.info(`转码 M4A 完成：${(buffer.byteLength / 1048576).toFixed(2)}MB`);
  return new Blob([buffer], { type: 'audio/mp4' });
}

/**
 * 触发浏览器下载 Blob（临时 <a download>，5 秒后回收 object URL）。
 * 侧栏/编辑器等扩展页面上下文共用的唯一实现（内容脚本因构建产物隔离保留同款本地实现）。
 * @param blob 待下载数据
 * @param fileName 目标文件名（含扩展名）
 */
export function triggerBlobDownload(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  log.info(`触发下载：${fileName}（${(blob.size / 1048576).toFixed(2)}MB）`);
  window.setTimeout(() => {
    try { document.body.removeChild(a); } catch { /* noop */ }
    URL.revokeObjectURL(url);
  }, 5000);
}
