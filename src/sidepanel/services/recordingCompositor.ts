/**
 * 录制画面合成器（Round 5 #31 画中画 / #33 推近与遮挡）——浏览器侧实现。
 *
 * 把屏幕采集流逐帧画到 canvas，叠加摄像头画中画、推近裁剪与敏感区模糊，
 * 再用 canvas.captureStream() 产出视频轨交给 MediaRecorder。
 * 几何/缓动全在 @/core/cameraOverlay 与 @/core/zoomFocus（可单测），这里只管媒体管线。
 *
 * 为什么必须走 canvas 而不是 DOM 浮层：录制目标由系统选择器决定（整屏/应用窗口/标签页），
 * DOM 浮层只在「恰好录到它」时才进画面。canvas 把效果画进视频轨，与采集来源无关。
 *
 * 为什么输出尺寸恒定：推近用 drawImage 的源裁剪实现，画布尺寸始终等于源尺寸，
 * MediaRecorder 的分辨率与码率全程不变，不会因推近而突变或触发重协商。
 *
 * 已知边界：绘制由 requestVideoFrameCallback（无则 rAF）驱动，浏览器窗口最小化时
 * 帧回调被节流，画面停在最后一帧而不是报错——captureStream 按固定帧率重复上一帧，
 * 产物仍是可播放的完整视频。
 */
import { computePipRect, type CameraPipOptions } from '@/core/cameraOverlay';
import {
  approachZoom,
  blurRadiusPx,
  computeSourceRect,
  expandRect,
  intersectRect,
  mapSourceToOutput,
  regionToSourcePixels,
  type BlurRegion,
  type ZoomAnchor
} from '@/core/zoomFocus';
import { createLogger } from '@/utils/logger';

const log = createLogger('RecordingCompositor');

/** 合成器的全部画面参数（录制中可热更新） */
export interface RecordingVisualOptions {
  camera: CameraPipOptions;
  /** 目标推近倍率（实际倍率按指数缓动趋近，见 approachZoom） */
  zoom: number;
  anchor: ZoomAnchor;
  blurRegions: BlurRegion[];
  blurStrength: number;
}

export interface RecordingCompositor {
  /** 合成后的视频轨（交给 MediaRecorder） */
  track: MediaStreamTrack;
  /** 录制中调整画中画/推近/遮挡 */
  update(options: RecordingVisualOptions): void;
  /** 停止绘制并释放合成轨；不触碰传入的源流（由调用方释放） */
  stop(): void;
}

/** 建一个自动播放的静音 video 元素并等到有画面尺寸 */
async function attachVideo(stream: MediaStream): Promise<HTMLVideoElement> {
  const el = document.createElement('video');
  el.muted = true;
  el.playsInline = true;
  el.autoplay = true;
  el.srcObject = stream;
  await el.play();
  if (!el.videoWidth || !el.videoHeight) {
    await new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(() => reject(new Error('等待画面尺寸超时')), 8000);
      el.addEventListener('loadedmetadata', () => { window.clearTimeout(timer); resolve(); }, { once: true });
    });
  }
  return el;
}

/** 圆角矩形裁剪路径（circle 档走正圆） */
function clipPip(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, radius: number, circle: boolean): void {
  ctx.beginPath();
  if (circle) {
    ctx.arc(x + w / 2, y + h / 2, Math.min(w, h) / 2, 0, Math.PI * 2);
  } else {
    ctx.roundRect(x, y, w, h, radius);
  }
  ctx.closePath();
  ctx.clip();
}

/**
 * 创建合成器。失败时抛错，调用方降级为「不加效果」而不是中断录制。
 * @param displayStream 屏幕采集流（含视频轨）
 * @param cameraStream 摄像头流；不用画中画时传 null
 * @param options 画面参数
 * @param frameRate 合成输出帧率（与画质档一致）
 */
export async function createRecordingCompositor(
  displayStream: MediaStream,
  cameraStream: MediaStream | null,
  options: RecordingVisualOptions,
  frameRate: number
): Promise<RecordingCompositor> {
  const screenVideo = await attachVideo(displayStream);
  const cameraVideo = cameraStream ? await attachVideo(cameraStream) : null;

  const canvas = document.createElement('canvas');
  canvas.width = screenVideo.videoWidth;
  canvas.height = screenVideo.videoHeight;
  const context = canvas.getContext('2d', { alpha: false });
  if (!context) throw new Error('无法创建 2D 画布上下文');
  const ctx: CanvasRenderingContext2D = context;

  let opts: RecordingVisualOptions = { ...options, camera: { ...options.camera }, blurRegions: [...options.blurRegions] };
  let currentZoom = opts.zoom;
  let lastFrameAt = 0;
  let stopped = false;
  let rafId = 0;
  let vfcId = 0;

  /** 敏感区模糊：源坐标 → 当前推近下的输出坐标，多取一圈像素避免边缘硬边 */
  function drawBlurRegions(videoW: number, videoH: number, visible: ReturnType<typeof computeSourceRect>): void {
    if (!opts.blurRegions.length) return;
    const radius = blurRadiusPx(opts.blurStrength, canvas.width, canvas.height);
    const bounds = { x: 0, y: 0, w: videoW, h: videoH };
    const visibleRect = { x: visible.sx, y: visible.sy, w: visible.sw, h: visible.sh };
    for (const region of opts.blurRegions) {
      const src = intersectRect(regionToSourcePixels(region, videoW, videoH), visibleRect);
      if (!src || src.w <= 0 || src.h <= 0) continue;
      const dst = mapSourceToOutput(src, visible, canvas.width, canvas.height);
      // 扩张量按源/输出比例换算：输出上的 radius 像素对应源上多少像素
      const padSrc = radius * Math.max(visible.sw / canvas.width, visible.sh / canvas.height);
      const srcWide = expandRect(src, padSrc, bounds);
      const dstWide = mapSourceToOutput(srcWide, visible, canvas.width, canvas.height);
      ctx.save();
      ctx.beginPath();
      ctx.rect(dst.x, dst.y, dst.w, dst.h);
      ctx.clip();
      ctx.filter = `blur(${radius}px)`;
      ctx.drawImage(screenVideo, srcWide.x, srcWide.y, srcWide.w, srcWide.h, dstWide.x, dstWide.y, dstWide.w, dstWide.h);
      ctx.restore();
    }
  }

  function draw(): void {
    if (stopped) return;
    const now = performance.now();
    const dt = lastFrameAt > 0 ? now - lastFrameAt : 0;
    lastFrameAt = now;

    // 采集源可能中途改尺寸（窗口拖动/分辨率切换），画布跟着改，否则画面被拉伸
    const w = screenVideo.videoWidth;
    const h = screenVideo.videoHeight;
    if (w > 0 && h > 0 && (canvas.width !== w || canvas.height !== h)) {
      canvas.width = w;
      canvas.height = h;
    }

    currentZoom = approachZoom(currentZoom, opts.zoom, dt);
    const visible = computeSourceRect(canvas.width, canvas.height, currentZoom, opts.anchor);
    if (visible.sw > 0 && visible.sh > 0) {
      ctx.drawImage(screenVideo, visible.sx, visible.sy, visible.sw, visible.sh, 0, 0, canvas.width, canvas.height);
    } else {
      ctx.drawImage(screenVideo, 0, 0, canvas.width, canvas.height);
    }

    drawBlurRegions(canvas.width, canvas.height, visible);

    // 画中画最后画：主讲人画面不该被遮挡区或推近影响
    if (cameraVideo && opts.camera.enabled && cameraVideo.videoWidth > 0) {
      const camAspect = cameraVideo.videoWidth / Math.max(1, cameraVideo.videoHeight);
      const rect = computePipRect(canvas.width, canvas.height, opts.camera, camAspect);
      if (rect.width > 0 && rect.height > 0) {
        ctx.save();
        clipPip(ctx, rect.x, rect.y, rect.width, rect.height, rect.radius, opts.camera.shape === 'circle');
        if (opts.camera.mirror) {
          ctx.translate(rect.x + rect.width / 2, rect.y + rect.height / 2);
          ctx.scale(-1, 1);
          ctx.drawImage(cameraVideo, -rect.width / 2, -rect.height / 2, rect.width, rect.height);
        } else {
          ctx.drawImage(cameraVideo, rect.x, rect.y, rect.width, rect.height);
        }
        ctx.restore();
        ctx.save();
        clipPip(ctx, rect.x, rect.y, rect.width, rect.height, rect.radius, opts.camera.shape === 'circle');
        ctx.lineWidth = Math.max(2, Math.round(rect.width * 0.012));
        ctx.strokeStyle = 'rgba(255,255,255,0.85)';
        ctx.stroke();
        ctx.restore();
      }
    }
  }

  // 先画一帧再 captureStream：否则轨道首帧是空白
  draw();
  const outStream = canvas.captureStream(frameRate);
  const track = outStream.getVideoTracks()[0];
  if (!track) throw new Error('画布采集未产出视频轨');

  const useVfc = typeof screenVideo.requestVideoFrameCallback === 'function';
  function schedule(): void {
    if (stopped) return;
    if (useVfc) {
      vfcId = screenVideo.requestVideoFrameCallback(() => { draw(); schedule(); });
    } else {
      rafId = window.requestAnimationFrame(() => { draw(); schedule(); });
    }
  }
  schedule();
  log.info(`画面合成已启动：${canvas.width}×${canvas.height}@${frameRate}fps，驱动=${useVfc ? 'rVFC' : 'rAF'}，画中画=${opts.camera.enabled}，推近=${opts.zoom}，遮挡区=${opts.blurRegions.length}`);

  return {
    track,
    update(next: RecordingVisualOptions) {
      opts = { ...next, camera: { ...next.camera }, blurRegions: [...next.blurRegions] };
    },
    stop() {
      if (stopped) return;
      stopped = true;
      if (useVfc && vfcId) screenVideo.cancelVideoFrameCallback(vfcId);
      if (rafId) window.cancelAnimationFrame(rafId);
      try { track.stop(); } catch { /* noop */ }
      for (const el of [screenVideo, cameraVideo]) {
        if (!el) continue;
        el.pause();
        el.srcObject = null;
      }
      log.info('画面合成已停止');
    }
  };
}