/**
 * WebCodecs 真 MP4 导出引擎（VideoEncoder(H.264) + AudioEncoder(AAC) + vendored mp4-muxer）。
 * 相比 Canvas+MediaRecorder：硬件加速、真 MP4/H.264/AAC、体积更小、播放器兼容性最好。
 * 任何环境不支持（VideoEncoder 缺失/配置失败）时由调用方回退 MediaRecorder 旧路径。
 */

// vendored ESM（附官方 d.ts 供人工查阅），allowJs=false 场景用 expect-error 引入
// @ts-expect-error vendored mp4-muxer 无可解析的本地类型入口
import { Muxer, ArrayBufferTarget } from '@/vendor/mp4-muxer.mjs';
// P1-8：分级日志（模块运行于编辑器页面上下文，默认 info 级）
import { createLogger } from '@/utils/logger';

/** 本模块 logger：保留原 `[mp4export]` 前缀语义 */
const log = createLogger('mp4export');

export interface Mp4ExportJob {
  width: number;
  height: number;
  fps: number;
  /** 时间线总时长（秒） */
  durationSec: number;
  bitrate?: number;
  /** 渲染时间线 timeSec 处的一帧到 canvas */
  drawFrame: (canvas: HTMLCanvasElement, timeSec: number) => Promise<void> | void;
  /** 可选：混音（返回 OfflineAudioContext 渲染结果），失败/为空则导出无声视频 */
  mixAudio?: () => Promise<AudioBuffer | null>;
  onProgress?: (ratio: number) => void;
  /** 可选：用户取消。每个耗时步骤前检查，abort 后抛 AbortError 并关闭编码器 */
  signal?: AbortSignal;
  /**
   * 可选：降级告警。成片无声/缺音轨此前只写日志，用户拿到文件才发现没声音；
   * 经此回调交给调用方展示（编辑器进可见告警清单）。
   */
  onWarning?: (text: string) => void;
}

export function canUseWebCodecsExport(): boolean {
  try {
    return typeof (globalThis as any).VideoEncoder === 'function'
      && typeof (globalThis as any).VideoFrame === 'function'
      && typeof (globalThis as any).AudioEncoder === 'function';
  } catch {
    return false;
  }
}

const AUDIO_CHUNK_FRAMES = 4800; // 每块 100ms@48kHz

/**
 * 将混音 AudioBuffer 编码为 AAC（mp4a.40.2）并逐块写入封装器。
 * 从 exportMp4 内部抽取，供纯音频 M4A 转换（mediaConvert.convertAudioBlobToM4a）复用，
 * 避免两处维护同一段"分块 → AudioData → encode"循环（用户规则：重复功能必须收敛）。
 *
 * 约束：
 *  - 超过 2 声道自动按前 2 声道截取（消费级播放器立体声足够）；
 *  - 内部完成 configure → encode×N → flush → close 全生命周期；
 *  - 编码器 error 回调触发时以 Error 抛出，调用方决定降级策略。
 *
 * @param audioBuf 混音结果（任意采样率/声道数）
 * @param addChunk 封装器写块回调（mp4-muxer 的 addAudioChunk 原样透传）
 * @param onProgress 可选进度回调 0~1（按已提交采样帧占比；供 M4A 转码展示进度）
 * @param signal     可选取消信号：长音频编码逐块检查，abort 后抛 AbortError（finally 仍关闭编码器）
 */
export async function encodeAudioBufferToMuxer(
  audioBuf: AudioBuffer,
  addChunk: (chunk: unknown, meta?: unknown) => void,
  onProgress?: (ratio: number) => void,
  signal?: AbortSignal
): Promise<void> {
  const channels = Math.min(2, audioBuf.numberOfChannels);
  const sampleRate = audioBuf.sampleRate;
  /** 编码器内部错误暂存（error 回调异步触发，编码循环每步检查） */
  let encError: unknown = null;

  const audioEncoder = new AudioEncoder({
    output: (chunk, meta) => addChunk(chunk, meta),
    error: (e: unknown) => { encError = e; }
  });
  try {
    audioEncoder.configure({
      codec: 'mp4a.40.2', sampleRate, numberOfChannels: channels, bitrate: 128_000
    } as AudioEncoderConfig);
    const total = audioBuf.length;
    for (let off = 0; off < total; off += AUDIO_CHUNK_FRAMES) {
      signal?.throwIfAborted();
      // 本块采样帧数（尾块不足一整个 AUDIO_CHUNK_FRAMES 时取剩余）
      const n = Math.min(AUDIO_CHUNK_FRAMES, total - off);
      // f32-planar 布局：按声道平面依次排布
      const data = new Float32Array(n * channels);
      for (let c = 0; c < channels; c++) {
        data.set(audioBuf.getChannelData(c).subarray(off, off + n), c * n);
      }
      const ad = new AudioData({
        format: 'f32-planar',
        sampleRate,
        numberOfFrames: n,
        numberOfChannels: channels,
        timestamp: Math.round((off / sampleRate) * 1e6),
        data
      });
      audioEncoder.encode(ad);
      ad.close();
      // 进度回调：按已提交采样帧占总帧数的比例上报
      onProgress?.(Math.min(1, (off + n) / total));
      if (encError) throw encError;
    }
    await audioEncoder.flush();
    if (encError) throw encError;
  } catch (e) {
    // 用户取消不是故障，不污染错误日志
    if (!signal?.aborted) log.error('音频编码失败:', e);
    throw e instanceof Error ? e : new Error(String(e));
  } finally {
    // 无论成败都关闭编码器，避免底层资源泄漏
    try { audioEncoder.close(); } catch { /* noop */ }
  }
}

export async function exportMp4(job: Mp4ExportJob): Promise<Blob> {
  const { width, height, fps, durationSec } = job;
  let encError: unknown = null;
  job.signal?.throwIfAborted();

  // 先混音：mp4-muxer 要求音频轨在构造时声明
  let audioBuf: AudioBuffer | null = null;
  try {
    audioBuf = job.mixAudio ? await job.mixAudio() : null;
    // 混音可能耗时数秒：期间被取消就立刻退出，不再走降级告警与后续编码
    job.signal?.throwIfAborted();
    if (audioBuf && audioBuf.length === 0) audioBuf = null;
    // AAC 编码支持预检：不支持时降级为无声导出（避免声明音轨后中途失败），并告知用户
    if (audioBuf) {
      if (typeof (globalThis as any).AudioEncoder?.isConfigSupported === 'function') {
        // 环境有 AudioEncoder：走规范预检，配置不被支持则弃用音轨
        const support = await AudioEncoder.isConfigSupported({
          codec: 'mp4a.40.2',
          sampleRate: audioBuf.sampleRate,
          numberOfChannels: Math.min(2, audioBuf.numberOfChannels),
          bitrate: 128_000
        } as AudioEncoderConfig).catch(() => null);
        if (!support?.supported) {
          audioBuf = null;
          job.onWarning?.('当前环境不支持 AAC 编码，本次导出为无声视频');
        }
      } else {
        // 收口修复：旧 Chrome（无 AudioEncoder）时此前会跳过预检、照常声明音轨，
        // 随后 new AudioEncoder 抛 ReferenceError 导致整个导出失败；
        // 现明确降级为无声视频（与"配置不支持"同一路径），并告知用户
        log.warn('环境无 AudioEncoder，导出降级为无声视频');
        audioBuf = null;
        job.onWarning?.('当前浏览器缺少 AudioEncoder，本次导出为无声视频');
      }
    }
  } catch (e) {
    // 混音期间被取消：不能当成"降级无声"继续跑完整条视频编码
    job.signal?.throwIfAborted();
    log.warn('混音失败，回退无声视频:', e);
    audioBuf = null;
    job.onWarning?.(`混音失败，本次导出为无声视频：${e instanceof Error ? e.message : String(e)}`);
  }
  job.signal?.throwIfAborted();

  const target = new ArrayBufferTarget();
  const muxer = new Muxer({
    target,
    fastStart: 'in-memory',
    video: { codec: 'avc', width, height, frameRate: fps },
    ...(audioBuf ? {
      audio: {
        codec: 'aac' as const,
        sampleRate: audioBuf.sampleRate,
        numberOfChannels: Math.min(2, audioBuf.numberOfChannels)
      }
    } : {})
  } as any);

  const videoEncoder = new VideoEncoder({
    output: (chunk, meta) => (muxer as any).addVideoChunk(chunk, meta),
    error: (e: unknown) => { encError = e; }
  });
  // 取消/编码失败/渲染抛错都必须关闭编码器，否则底层硬件会话泄漏，
  // 用户连续取消几次后可能再也无法开始新的导出
  try {
    const bitrate = job.bitrate ?? Math.min(16_000_000, Math.max(1_200_000, Math.round(width * height * fps * 0.12)));
    videoEncoder.configure({
      codec: 'avc1.640028', // High 4.0，覆盖 1080p30
      width, height, bitrate, framerate: fps,
      avc: { format: 'avc' } // mp4-muxer 需要 avc 描述格式
    } as VideoEncoderConfig);

    // ── 音频：混音结果编码 AAC 写入封装器（音频轨已在 Muxer 构造时声明，编码失败只能整体失败） ──
    // 编码循环抽到 encodeAudioBufferToMuxer（与 mediaConvert 的 M4A 转换共用同一实现）
    if (audioBuf) {
      await encodeAudioBufferToMuxer(
        audioBuf,
        (chunk, meta) => (muxer as any).addAudioChunk(chunk, meta),
        undefined,
        job.signal
      );
    }

    // ── 视频：逐帧渲染 → 编码 ──
    const canvas = document.createElement('canvas');
    canvas.width = width; canvas.height = height;
    const totalFrames = Math.max(1, Math.round(durationSec * fps));
    const frameDurUs = Math.round(1e6 / fps);
    const keyEvery = Math.max(1, Math.round(fps * 2));

    for (let i = 0; i < totalFrames; i++) {
      job.signal?.throwIfAborted();
      if (encError) throw encError;
      await job.drawFrame(canvas, i / fps);
      // drawFrame 内部要 seek + 等解码，可能耗时数百毫秒，回来再查一次取消
      job.signal?.throwIfAborted();
      const frame = new VideoFrame(canvas, { timestamp: i * frameDurUs, duration: frameDurUs });
      videoEncoder.encode(frame, { keyFrame: i % keyEvery === 0 });
      frame.close();
      job.onProgress?.((i + 1) / totalFrames);
      // 背压：编码队列过深时稍等
      while (videoEncoder.encodeQueueSize > 6) {
        await new Promise(r => setTimeout(r, 4));
        job.signal?.throwIfAborted();
        if (encError) throw encError;
      }
    }
    await videoEncoder.flush();
    // 音频编码已在 encodeAudioBufferToMuxer 内部 flush 完毕，此处只需收尾视频编码器
    job.signal?.throwIfAborted();
    if (encError) throw encError;
    (muxer as any).finalize();
    const buffer = (target as any).buffer as ArrayBuffer;
    return new Blob([buffer], { type: 'video/mp4' });
  } finally {
    try { videoEncoder.close(); } catch { /* noop：已关闭时 close 抛 InvalidStateError */ }
  }
}
