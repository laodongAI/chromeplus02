/**
 * WebCodecs 真 MP4 导出引擎（VideoEncoder(H.264) + AudioEncoder(AAC) + vendored mp4-muxer）。
 * 相比 Canvas+MediaRecorder：硬件加速、真 MP4/H.264/AAC、体积更小、播放器兼容性最好。
 * 任何环境不支持（VideoEncoder 缺失/配置失败）时由调用方回退 MediaRecorder 旧路径。
 */

// vendored ESM（附官方 d.ts 供人工查阅），allowJs=false 场景用 expect-error 引入
// @ts-expect-error vendored mp4-muxer 无可解析的本地类型入口
import { Muxer, ArrayBufferTarget } from '@/vendor/mp4-muxer.mjs';

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

export async function exportMp4(job: Mp4ExportJob): Promise<Blob> {
  const { width, height, fps, durationSec } = job;
  let encError: unknown = null;

  // 先混音：mp4-muxer 要求音频轨在构造时声明
  let audioBuf: AudioBuffer | null = null;
  try {
    audioBuf = job.mixAudio ? await job.mixAudio() : null;
    if (audioBuf && audioBuf.length === 0) audioBuf = null;
    // AAC 编码支持预检：不支持时静默降级为无声导出（避免声明音轨后中途失败）
    if (audioBuf && typeof (globalThis as any).AudioEncoder?.isConfigSupported === 'function') {
      const support = await AudioEncoder.isConfigSupported({
        codec: 'mp4a.40.2',
        sampleRate: audioBuf.sampleRate,
        numberOfChannels: Math.min(2, audioBuf.numberOfChannels),
        bitrate: 128_000
      } as AudioEncoderConfig).catch(() => null);
      if (!support?.supported) audioBuf = null;
    }
  } catch (e) {
    console.warn('[mp4export] 混音失败，回退无声视频:', e);
    audioBuf = null;
  }

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
  const bitrate = job.bitrate ?? Math.min(16_000_000, Math.max(1_200_000, Math.round(width * height * fps * 0.12)));
  videoEncoder.configure({
    codec: 'avc1.640028', // High 4.0，覆盖 1080p30
    width, height, bitrate, framerate: fps,
    avc: { format: 'avc' } // mp4-muxer 需要 avc 描述格式
  } as VideoEncoderConfig);

  // ── 音频：混音结果按 f32-planar 分块编码（音频轨已声明，编码失败只能整体失败） ──
  let audioEncoder: AudioEncoder | undefined;
  if (audioBuf) {
    try {
        const channels = Math.min(2, audioBuf.numberOfChannels);
        const sampleRate = audioBuf.sampleRate;
        audioEncoder = new AudioEncoder({
        output: (chunk, meta) => (muxer as any).addAudioChunk(chunk, meta),
        error: (e: unknown) => { encError = e; }
      });
      audioEncoder.configure({
        codec: 'mp4a.40.2', sampleRate, numberOfChannels: channels, bitrate: 128_000
      } as AudioEncoderConfig);
      const total = audioBuf.length;
      for (let off = 0; off < total; off += AUDIO_CHUNK_FRAMES) {
        const n = Math.min(AUDIO_CHUNK_FRAMES, total - off);
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
        if (encError) throw encError;
      }
    } catch (e) {
      console.error('[mp4export] 音频编码失败:', e);
      try { audioEncoder?.close(); } catch { /* noop */ }
      throw e instanceof Error ? e : new Error(String(e));
    }
  }

  // ── 视频：逐帧渲染 → 编码 ──
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  const totalFrames = Math.max(1, Math.round(durationSec * fps));
  const frameDurUs = Math.round(1e6 / fps);
  const keyEvery = Math.max(1, Math.round(fps * 2));

  for (let i = 0; i < totalFrames; i++) {
    if (encError) throw encError;
    await job.drawFrame(canvas, i / fps);
    const frame = new VideoFrame(canvas, { timestamp: i * frameDurUs, duration: frameDurUs });
    videoEncoder.encode(frame, { keyFrame: i % keyEvery === 0 });
    frame.close();
    job.onProgress?.((i + 1) / totalFrames);
    // 背压：编码队列过深时稍等
    while (videoEncoder.encodeQueueSize > 6) {
      await new Promise(r => setTimeout(r, 4));
      if (encError) throw encError;
    }
  }
  await videoEncoder.flush();
  if (audioEncoder) await audioEncoder.flush();
  if (encError) throw encError;
  (muxer as any).finalize();
  const buffer = (target as any).buffer as ArrayBuffer;
  return new Blob([buffer], { type: 'video/mp4' });
}
