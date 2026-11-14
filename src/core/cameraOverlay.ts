/**
 * 摄像头画中画（Round 5 #31）——纯几何层。
 *
 * 为什么必须走 canvas 合成而不是「页面上浮一个摄像头小窗」：
 * 录制目标由系统选择器决定，可能是整屏、某个应用窗口或某个标签页。
 * DOM 浮窗只在「恰好录到它」时才进画面——录应用窗口/其他标签页时完全录不到，
 * 侧栏自身也不属于被录页面。canvas 把摄像头画进视频轨，与采集来源无关，
 * 是唯一在所有来源下都成立的方案（代价：开启时多一次逐帧绘制）。
 *
 * 本模块只做矩形/圆角计算，不碰 DOM 与 MediaStream，便于 node 环境单测。
 */

/** 画中画停靠角 */
export type PipPosition = 'bottom-left' | 'bottom-right' | 'top-left' | 'top-right';
/** 画中画尺寸档（相对画面高度的比例） */
export type PipSize = 'small' | 'medium' | 'large';
/** 画中画外形：圆形是头像常见形态，圆角矩形保留更多画面 */
export type PipShape = 'circle' | 'rounded';

export interface CameraPipOptions {
  /** 总开关：关闭时视频轨直通，不做任何合成 */
  enabled: boolean;
  position: PipPosition;
  size: PipSize;
  shape: PipShape;
  /** 镜像：自拍视角更自然，录制画面同样镜像（所见即所得） */
  mirror: boolean;
}

export const DEFAULT_CAMERA_PIP: CameraPipOptions = {
  enabled: false,
  position: 'bottom-right',
  size: 'medium',
  shape: 'circle',
  mirror: true
};

/** 各档位占画面高度的比例 */
export const PIP_HEIGHT_RATIO: Record<PipSize, number> = {
  small: 0.18,
  medium: 0.26,
  large: 0.36
};

/** 边距取画面短边的 2%，避免小窗贴边被播放器控件挡住 */
export const PIP_MARGIN_RATIO = 0.02;

/** 画中画宽度上限占画面宽度的比例：再大就喧宾夺主了 */
export const PIP_MAX_WIDTH_RATIO = 0.5;

/** 圆角矩形的圆角半径系数 */
export const PIP_ROUNDED_RADIUS_RATIO = 0.12;

export interface PipRect {
  x: number;
  y: number;
  width: number;
  height: number;
  /** 裁剪圆角半径；圆形时等于 width/2 */
  radius: number;
}

const ZERO_RECT: PipRect = { x: 0, y: 0, width: 0, height: 0, radius: 0 };

/**
 * 计算画中画在画布上的落位。
 *
 * 圆形档强制正方形（否则圆会变成椭圆，且摄像头画面被拉伸）；
 * 圆角矩形档按摄像头真实宽高比展开，超出画面宽度上限时等比缩小。
 *
 * @param canvasW 画布宽（像素）
 * @param canvasH 画布高（像素）
 * @param options 画中画配置
 * @param cameraAspect 摄像头画面宽高比（宽/高），非法值按 16:9 兜底
 */
export function computePipRect(
  canvasW: number,
  canvasH: number,
  options: CameraPipOptions,
  cameraAspect = 16 / 9
): PipRect {
  if (!Number.isFinite(canvasW) || !Number.isFinite(canvasH) || canvasW <= 0 || canvasH <= 0) return { ...ZERO_RECT };

  const ratio = PIP_HEIGHT_RATIO[options.size] ?? PIP_HEIGHT_RATIO.medium;
  let height = Math.max(1, Math.round(canvasH * ratio));
  const aspect = options.shape === 'circle'
    ? 1
    : (Number.isFinite(cameraAspect) && cameraAspect > 0 ? cameraAspect : 16 / 9);
  let width = Math.max(1, Math.round(height * aspect));

  const maxWidth = Math.max(1, Math.floor(canvasW * PIP_MAX_WIDTH_RATIO));
  if (width > maxWidth) {
    const scale = maxWidth / width;
    width = maxWidth;
    height = Math.max(1, Math.round(height * scale));
  }
  // 画面本身极小时（例如录一个很窄的窗口）不能画出界
  height = Math.min(height, canvasH);
  width = Math.min(width, canvasW);

  const margin = Math.round(Math.min(canvasW, canvasH) * PIP_MARGIN_RATIO);
  const right = options.position === 'bottom-right' || options.position === 'top-right';
  const top = options.position === 'top-left' || options.position === 'top-right';
  const x = right ? Math.max(0, canvasW - width - margin) : Math.min(margin, Math.max(0, canvasW - width));
  const y = top ? Math.min(margin, Math.max(0, canvasH - height)) : Math.max(0, canvasH - height - margin);

  const radius = options.shape === 'circle'
    ? width / 2
    : Math.round(Math.min(width, height) * PIP_ROUNDED_RADIUS_RATIO);

  return { x, y, width, height, radius };
}

/** 尺寸档的中文标签（面板与提示共用，避免两处文案漂移） */
export const PIP_SIZE_LABELS: Record<PipSize, string> = {
  small: '小',
  medium: '中',
  large: '大'
};

/** 停靠角的中文标签 */
export const PIP_POSITION_LABELS: Record<PipPosition, string> = {
  'bottom-left': '左下',
  'bottom-right': '右下',
  'top-left': '左上',
  'top-right': '右上'
};

/**
 * 摄像头采集约束：画中画只需要小画面，按档位给理想分辨率即可，
 * 要 1080p 摄像头只会白白吃 CPU 与带宽（最终还要缩到几百像素）。
 */
export function cameraConstraints(size: PipSize): MediaTrackConstraints {
  const height = size === 'large' ? 720 : size === 'medium' ? 480 : 360;
  return {
    width: { ideal: Math.round(height * 16 / 9) },
    height: { ideal: height },
    frameRate: { ideal: 30, max: 30 },
    facingMode: 'user'
  };
}