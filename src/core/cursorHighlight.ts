/**
 * 点击/光标高亮（Round 5 #32）——纯几何与节流层。
 *
 * 覆盖层画在被录页面上，因此「整屏录制」与「标签页录制」都能录到；
 * 录其他应用窗口时录不到（与页面画笔同一边界，面板需说明）。
 *
 * 节流的必要性：pointerdown 在拖动/连点时每秒可触发几十次，
 * 每次都建一个动画节点会让页面掉帧——而掉帧会直接录进成片。
 */

/** 两次涟漪的最小间隔（毫秒） */
export const RIPPLE_MIN_INTERVAL_MS = 90;
/** 同屏存活涟漪上限：超出就不再新建，等旧的动画结束 */
export const MAX_LIVE_RIPPLES = 12;
/** 涟漪动画时长（毫秒），与 CSS 保持一致 */
export const RIPPLE_DURATION_MS = 600;
/** 涟漪直径（像素） */
export const RIPPLE_BASE_PX = 44;
/** 光标光晕直径（像素） */
export const HALO_BASE_PX = 34;

/**
 * 是否生成新涟漪：间隔足够且未超同屏上限。
 * @param nowMs 当前时刻
 * @param lastSpawnMs 上次生成时刻（0 = 尚未生成过）
 * @param liveCount 当前存活的涟漪数
 */
export function shouldSpawnRipple(nowMs: number, lastSpawnMs: number, liveCount: number): boolean {
  if (liveCount >= MAX_LIVE_RIPPLES) return false;
  if (lastSpawnMs > 0 && nowMs - lastSpawnMs < RIPPLE_MIN_INTERVAL_MS) return false;
  return true;
}

export interface HighlightGeometry {
  /** 圆心横坐标（已收敛到视口内） */
  cx: number;
  /** 圆心纵坐标 */
  cy: number;
  /** 直径 */
  size: number;
}

/**
 * 把圆心收敛进视口：贴着边缘点击时，圆环仍完整可见而不是被裁掉一半。
 * 视口比圆还小时退化为居中（极端窄窗口）。
 */
export function clampCenter(x: number, y: number, viewportW: number, viewportH: number, size: number): { cx: number; cy: number } {
  const half = size / 2;
  const cx = viewportW <= size ? viewportW / 2 : Math.min(Math.max(x, half), viewportW - half);
  const cy = viewportH <= size ? viewportH / 2 : Math.min(Math.max(y, half), viewportH - half);
  return {
    cx: Number.isFinite(cx) ? cx : 0,
    cy: Number.isFinite(cy) ? cy : 0
  };
}

/** 涟漪落位 */
export function rippleGeometry(x: number, y: number, viewportW: number, viewportH: number): HighlightGeometry {
  return { ...clampCenter(x, y, viewportW, viewportH, RIPPLE_BASE_PX), size: RIPPLE_BASE_PX };
}

/** 光标光晕落位 */
export function haloGeometry(x: number, y: number, viewportW: number, viewportH: number): HighlightGeometry {
  return { ...clampCenter(x, y, viewportW, viewportH, HALO_BASE_PX), size: HALO_BASE_PX };
}