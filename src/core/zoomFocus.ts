/**
 * 平滑推近聚焦 + 敏感内容遮挡（Round 5 #33）——纯几何层。
 *
 * 为什么选「录制时实时处理」而不是「编辑器后期打码」：
 * 后期打码的原始帧仍然写进了 webm，敏感内容（密码、身份证、聊天记录）一旦落盘
 * 就已经泄露，打码只是遮住了回放。实时遮挡让这些像素根本不进编码器。
 * 推近同理：实时推近是「导播」，后期推近是「剪辑」，两者不冲突，本轮先做实时。
 *
 * 坐标系约定（很容易搞错，故写死在这里）：
 *  - 遮挡区用「源画面归一化坐标」（0..1，相对被采集的原始画面），
 *    这样推近/拉远时遮挡区跟着内容走，而不是钉在输出画面的某个像素上；
 *  - 推近用 source rect 裁剪实现（drawImage 九参重载），输出画布尺寸不变，
 *    因此 MediaRecorder 的分辨率与码率全程稳定，不会因推近而突变。
 */

/** 推近倍率下限（1 = 原画） */
export const ZOOM_MIN = 1;
/** 推近倍率上限：再大就是像素马赛克，没有信息量 */
export const ZOOM_MAX = 3;
/** 每次推近/拉远的步进 */
export const ZOOM_STEP = 0.25;
/** 平滑时间常数（毫秒）：指数趋近，约 3τ 到位，与帧率无关 */
export const ZOOM_TAU_MS = 180;

/** 推近锚点（归一化坐标） */
export type ZoomAnchor = 'center' | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

export const ZOOM_ANCHOR_POINTS: Record<ZoomAnchor, { ax: number; ay: number }> = {
  center: { ax: 0.5, ay: 0.5 },
  'top-left': { ax: 0, ay: 0 },
  'top-right': { ax: 1, ay: 0 },
  'bottom-left': { ax: 0, ay: 1 },
  'bottom-right': { ax: 1, ay: 1 }
};

export const ZOOM_ANCHOR_LABELS: Record<ZoomAnchor, string> = {
  center: '居中',
  'top-left': '左上',
  'top-right': '右上',
  'bottom-left': '左下',
  'bottom-right': '右下'
};

/** 倍率收敛：非法值回到 1，超限截断，并量化到步进避免浮点尾数 */
export function clampZoom(value: number): number {
  if (!Number.isFinite(value)) return ZOOM_MIN;
  const bounded = Math.min(Math.max(value, ZOOM_MIN), ZOOM_MAX);
  return Math.round(bounded / ZOOM_STEP) * ZOOM_STEP;
}

/**
 * 指数趋近一步：current 向 target 靠拢，dt 为距上一帧的毫秒数。
 * 用指数而不是线性插值，是为了让「每帧走剩余距离的固定比例」——
 * 掉帧时步长自动变大，动画总时长不变（线性插值在掉帧时会变慢）。
 */
export function approachZoom(current: number, target: number, dtMs: number, tauMs = ZOOM_TAU_MS): number {
  if (!Number.isFinite(current)) return target;
  if (tauMs <= 0 || dtMs <= 0) return target;
  const k = 1 - Math.exp(-dtMs / tauMs);
  const next = current + (target - current) * k;
  // 足够接近就吸附到目标，避免永远差一个浮点尾数导致每帧都在重绘
  return Math.abs(target - next) < 0.001 ? target : next;
}

export interface SourceRect { sx: number; sy: number; sw: number; sh: number }

/**
 * 推近后的源裁剪矩形：以锚点为中心取 1/zoom 的画面，并夹在源画面内。
 * 输出尺寸不变，所以「推近」= 少取一些源像素放大到同样大的画布。
 */
export function computeSourceRect(videoW: number, videoH: number, zoom: number, anchor: ZoomAnchor): SourceRect {
  if (!(videoW > 0) || !(videoH > 0)) return { sx: 0, sy: 0, sw: 0, sh: 0 };
  const z = Math.min(Math.max(Number.isFinite(zoom) ? zoom : ZOOM_MIN, ZOOM_MIN), ZOOM_MAX);
  const sw = videoW / z;
  const sh = videoH / z;
  const p = ZOOM_ANCHOR_POINTS[anchor] ?? ZOOM_ANCHOR_POINTS.center;
  const cx = p.ax * videoW;
  const cy = p.ay * videoH;
  return {
    sx: Math.min(Math.max(cx - sw / 2, 0), videoW - sw),
    sy: Math.min(Math.max(cy - sh / 2, 0), videoH - sh),
    sw,
    sh
  };
}

/** 归一化矩形（源画面坐标，0..1） */
export interface NormRect { x: number; y: number; w: number; h: number }

/** 一个遮挡区 */
export interface BlurRegion extends NormRect {
  id: string;
}

/** 默认模糊强度（像素半径，按输出画面短边的比例换算，见 blurRadiusPx） */
export const BLUR_STRENGTH_DEFAULT = 6;
export const BLUR_STRENGTH_MIN = 2;
export const BLUR_STRENGTH_MAX = 20;

/** 遮挡区最小边长（归一化）：小于这个尺寸的框没有遮挡意义，多半是误点 */
export const BLUR_MIN_NORM = 0.01;

/**
 * 把拖拽出的两个角点归一化为合法矩形：
 * 支持反向拖拽（从右下往左上），并夹到 [0,1]，过小的框返回 null。
 */
export function normalizeBlurRegion(
  x1: number, y1: number, x2: number, y2: number,
  viewW: number, viewH: number
): NormRect | null {
  if (!(viewW > 0) || !(viewH > 0)) return null;
  if (![x1, y1, x2, y2].every(Number.isFinite)) return null;
  const left = Math.min(x1, x2) / viewW;
  const top = Math.min(y1, y2) / viewH;
  const right = Math.max(x1, x2) / viewW;
  const bottom = Math.max(y1, y2) / viewH;
  const x = Math.min(Math.max(left, 0), 1);
  const y = Math.min(Math.max(top, 0), 1);
  const w = Math.min(Math.max(right, 0), 1) - x;
  const h = Math.min(Math.max(bottom, 0), 1) - y;
  if (w < BLUR_MIN_NORM || h < BLUR_MIN_NORM) return null;
  return { x, y, w, h };
}

/** 模糊半径（像素）：按输出画面短边缩放，保证不同分辨率下遮挡力度一致 */
export function blurRadiusPx(strength: number, outW: number, outH: number): number {
  const s = Number.isFinite(strength) ? Math.min(Math.max(strength, BLUR_STRENGTH_MIN), BLUR_STRENGTH_MAX) : BLUR_STRENGTH_DEFAULT;
  const base = Math.min(outW, outH);
  return Math.max(2, Math.round(base * (s / 100)));
}

export interface PixelRect { x: number; y: number; w: number; h: number }

/** 两矩形交集（无交集返回 null） */
export function intersectRect(a: PixelRect, b: PixelRect): PixelRect | null {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.w, b.x + b.w);
  const bottom = Math.min(a.y + a.h, b.y + b.h);
  if (right <= x || bottom <= y) return null;
  return { x, y, w: right - x, h: bottom - y };
}

/**
 * 源像素矩形 → 输出像素矩形（按当前推近裁剪 rect 线性映射）。
 * 调用前应先与 visible 求交，否则会画出负坐标。
 */
export function mapSourceToOutput(
  src: PixelRect, visible: SourceRect, outW: number, outH: number
): PixelRect {
  if (!(visible.sw > 0) || !(visible.sh > 0)) return { x: 0, y: 0, w: 0, h: 0 };
  const kx = outW / visible.sw;
  const ky = outH / visible.sh;
  return {
    x: (src.x - visible.sx) * kx,
    y: (src.y - visible.sy) * ky,
    w: src.w * kx,
    h: src.h * ky
  };
}

/** 归一化遮挡区 → 源像素矩形 */
export function regionToSourcePixels(region: NormRect, videoW: number, videoH: number): PixelRect {
  return { x: region.x * videoW, y: region.y * videoH, w: region.w * videoW, h: region.h * videoH };
}

/** 向外扩张矩形（模糊需要多取一圈像素，否则边缘会出现未模糊的硬边），并夹在 bounds 内 */
export function expandRect(r: PixelRect, pad: number, bounds: PixelRect): PixelRect {
  const x = Math.max(bounds.x, r.x - pad);
  const y = Math.max(bounds.y, r.y - pad);
  const right = Math.min(bounds.x + bounds.w, r.x + r.w + pad);
  const bottom = Math.min(bounds.y + bounds.h, r.y + r.h + pad);
  return { x, y, w: Math.max(0, right - x), h: Math.max(0, bottom - y) };
}