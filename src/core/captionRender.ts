/**
 * 字幕取景几何（预览覆盖层与导出烧录用同一套算式）。
 *
 * 此前预览用 HTML 覆盖层（13/17/24px 固定），导出用 canvas 烧字（18/26/36px 固定），
 * 两边各写一套：用户在预览里看到的字幕大小和成片不一致，而且加黑边（竖屏导出）后
 * 字幕会掉进黑边里。这里把字号与落点统一成「相对内容框高度」的比例，
 * 谁算都行，结果一样。纯数学，便于 node 单测。
 */

/** 与编辑器字幕模型的 size 字段同形 */
export type CaptionSizeKey = 'sm' | 'md' | 'lg';
export type CaptionPositionKey = 'top' | 'center' | 'bottom';

/** 内容框内的矩形（像素） */
export interface FrameBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * 字号 = 内容框高 × 系数。
 * 系数按 720p 下的历史观感标定：sm≈18、md≈26、lg≈36，
 * 这样竖屏（1920 高）自然放大、480p 自然缩小，而不是沿用固定像素。
 */
export const CAPTION_HEIGHT_RATIO: Record<CaptionSizeKey, number> = { sm: 0.025, md: 0.036, lg: 0.05 };

/** 字号下限：480p 以下再缩就读不出来了 */
export const CAPTION_MIN_PX = 12;

/** 上下留白（相对内容框高） */
export const CAPTION_EDGE_RATIO = 0.03;

function finitePositive(n: number, fallback: number): number {
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** 字幕字号（px，取整） */
export function captionFontSize(boxH: number, size: CaptionSizeKey, base = 720): number {
  const h = finitePositive(boxH, base);
  const ratio = CAPTION_HEIGHT_RATIO[size] ?? CAPTION_HEIGHT_RATIO.md;
  return Math.max(CAPTION_MIN_PX, Math.round(h * ratio));
}

/** 上下留白（px） */
export function captionEdge(boxH: number): number {
  return Math.round(finitePositive(boxH, 720) * CAPTION_EDGE_RATIO);
}

/**
 * 预览覆盖层的顶边位置（px，相对画布原点）。
 * 水平居中由覆盖层自身的 translateX(-50%) 负责，这里只给纵向落点。
 * bottom 用「基线 - 字号」近似文字盒顶部，保证与导出不低于同一条线。
 */
export function captionOverlayTop(box: FrameBox, fontSize: number, position: CaptionPositionKey): number {
  const edge = captionEdge(box.h);
  if (position === 'top') return box.y + edge;
  if (position === 'center') return box.y + box.h / 2 - fontSize / 2;
  return box.y + box.h - edge - fontSize * 1.35;
}

/** 覆盖层水平中心（px） */
export function captionOverlayCenterX(box: FrameBox): number {
  return box.x + box.w / 2;
}

/**
 * canvas 烧字的基线 y（配合 textBaseline='bottom'）。
 * 与 captionOverlayTop 的差别只在测量口径：canvas 按底部对齐，覆盖层按盒顶对齐。
 */
export function captionBaseline(box: FrameBox, fontSize: number, position: CaptionPositionKey): number {
  const edge = captionEdge(box.h);
  if (position === 'top') return box.y + edge + fontSize;
  if (position === 'center') return box.y + box.h / 2 + fontSize / 2;
  return box.y + box.h - edge;
}

/** 整帧（无黑边）时内容框就是画布本身 */
export function fullBox(w: number, h: number): FrameBox {
  return { x: 0, y: 0, w, h };
}
