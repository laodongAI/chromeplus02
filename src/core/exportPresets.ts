/**
 * 导出预设（分辨率 / 画幅 / 帧率 / 码率 / 适配方式）——纯逻辑层。
 *
 * 此前导出尺寸直接取 videoEl 的宽高、帧率写死 30、码率由编码器系数决定，
 * 用户既得不到「竖屏成片」也没法压体积。本模块把这些决策收敛成可单测的纯函数：
 *  - 画幅与档位分离：档位定「短边像素」，画幅定比例，两者组合出目标宽高；
 *  - 宽高强制取偶：H.264 编码器对奇数尺寸会直接拒绝配置（或静默裁掉一列像素），
 *    MediaRecorder 的画布流虽然容忍，但两条通道口径必须一致；
 *  - 适配方式（拉伸/留黑边/裁满）只算矩形，不碰绘制，绘制仍由编辑器的共享帧渲染负责，
 *    这样预览与导出天然同一套几何，不需要各写一遍。
 */

/** 目标画幅；source 表示跟随源视频比例 */
export type ExportAspect = 'source' | '16:9' | '9:16' | '4:3' | '3:4' | '1:1';

/** 画面在非源比例画幅中的适配方式 */
export type ExportFit = 'stretch' | 'contain' | 'cover';

/** 画质档位（决定码率系数，不是分辨率） */
export type ExportQuality = 'draft' | 'standard' | 'high';

export interface ExportSettings {
  /** 目标画幅 */
  aspect: ExportAspect;
  /** 短边像素档位；0 = 跟随源视频短边 */
  shortSide: number;
  /** 帧率 */
  fps: number;
  /** 画质档位 */
  quality: ExportQuality;
  /** 适配方式 */
  fit: ExportFit;
  /** 手动码率（Mbps）；0 = 按画质档位自动估算 */
  bitrateMbps: number;
}

export const DEFAULT_EXPORT_SETTINGS: ExportSettings = {
  aspect: 'source',
  shortSide: 0,
  fps: 30,
  quality: 'standard',
  fit: 'contain',
  bitrateMbps: 0,
};

/** 导出用的画布尺寸（已取偶、已夹到安全区间） */
export interface ExportSize {
  width: number;
  height: number;
}

/** 可选帧率：60fps 只对高刷录屏有意义，24fps 适合课件/访谈类口播 */
export const EXPORT_FPS_OPTIONS = [24, 30, 60];

/** 短边档位；0 为「源分辨率」 */
export const EXPORT_SHORT_SIDES = [0, 480, 720, 1080, 1440, 2160];

export const ASPECT_LABELS: Record<ExportAspect, string> = {
  source: '跟随源',
  '16:9': '横屏 16:9',
  '9:16': '竖屏 9:16',
  '4:3': '标准 4:3',
  '3:4': '竖版 3:4',
  '1:1': '方形 1:1',
};

export const FIT_LABELS: Record<ExportFit, string> = {
  stretch: '拉伸铺满',
  contain: '留黑边',
  cover: '裁切填满',
};

export const QUALITY_LABELS: Record<ExportQuality, string> = {
  draft: '省流',
  standard: '标准',
  high: '高质量',
};

export const SHORT_SIDE_LABELS: Record<number, string> = {
  0: '源分辨率',
  480: '480p',
  720: '720p',
  1080: '1080p',
  1440: '2K',
  2160: '4K',
};

/** 码率系数（每像素每帧 bits）：0.10 与编码器历史默认值同量级，避免升级后体积突变 */
const QUALITY_BPP: Record<ExportQuality, number> = { draft: 0.05, standard: 0.1, high: 0.18 };

/** 码率下限/上限：低于下限的成片糊到不可用，高于上限只会撑爆磁盘 */
const BITRATE_MIN = 500_000;
const BITRATE_MAX = 40_000_000;

/** 单边像素上限：超过这个尺寸编码器/内存都不可靠 */
const DIMENSION_MAX = 4096;

/** 画幅 → 宽高比（宽/高，可能 <1） */
export function aspectRatioOf(aspect: ExportAspect, sourceW: number, sourceH: number): number {
  if (aspect === 'source') {
    if (!Number.isFinite(sourceW) || !Number.isFinite(sourceH) || sourceW <= 0 || sourceH <= 0) return 16 / 9;
    return sourceW / sourceH;
  }
  const [w, h] = aspect.split(':').map(Number);
  return w / h;
}

/** 取偶：H.264 要求宽高为偶数，奇数会被编码器拒绝或静默裁边 */
function even(n: number): number {
  const v = Math.round(n);
  return v % 2 === 0 ? v : v + 1;
}

/**
 * 解析目标宽高：短边取档位值（0 = 源短边），长边按画幅比例推。
 * 不按源尺寸缩小短边——竖屏成片本来就要比横屏源更高，画面由适配方式决定如何摆放。
 */
export function resolveExportSize(sourceW: number, sourceH: number, settings: ExportSettings): ExportSize {
  const srcValid = Number.isFinite(sourceW) && Number.isFinite(sourceH) && sourceW > 0 && sourceH > 0;
  const srcShort = srcValid ? Math.min(sourceW, sourceH) : 720;
  const short = settings.shortSide > 0 ? settings.shortSide : srcShort;
  const ratio = aspectRatioOf(settings.aspect, srcValid ? sourceW : 16, srcValid ? sourceH : 9);
  const safeRatio = Number.isFinite(ratio) && ratio > 0 ? ratio : 1;
  const long = Math.max(short, short * safeRatio, short / safeRatio);
  const width = ratio >= 1 ? long : short;
  const height = ratio >= 1 ? short : long;
  return {
    width: Math.min(DIMENSION_MAX, even(width)),
    height: Math.min(DIMENSION_MAX, even(height)),
  };
}

/**
 * 估算视频码率（bps）。
 * 手动值优先，便于用户按目标体积反推；自动值按「像素 × 帧率 × 系数」，
 * 保证同档位下 4K 与 720p 的每像素质量一致，而不是所有分辨率共用一个写死值。
 */
export function estimateBitrateBps(width: number, height: number, fps: number, settings: ExportSettings): number {
  if (settings.bitrateMbps > 0) {
    return Math.round(Math.min(BITRATE_MAX, Math.max(BITRATE_MIN, settings.bitrateMbps * 1_000_000)));
  }
  const bpp = QUALITY_BPP[settings.quality] ?? QUALITY_BPP.standard;
  const frames = Number.isFinite(fps) && fps > 0 ? fps : 30;
  const raw = Math.max(0, width) * Math.max(0, height) * frames * bpp;
  return Math.round(Math.min(BITRATE_MAX, Math.max(BITRATE_MIN, raw)));
}

/** 画布内的一个矩形（像素） */
export interface FrameRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * 源画面在目标画幅中的摆放矩形。
 * contain 等比内含（多余部分留黑边，信息全保留）；cover 等比外扩（超出画幅的部分由
 * 调用方裁剪，无黑边但会切掉边缘）；stretch 直接铺满（比例不符会变形，只给确定同比例的场景）。
 * 尺寸非法时返回整幅，宁可变形也不要画出一个零尺寸矩形把画面弄没。
 */
export function layoutVideo(videoW: number, videoH: number, targetW: number, targetH: number, fit: ExportFit): FrameRect {
  const full = { x: 0, y: 0, w: targetW, h: targetH };
  if (![videoW, videoH, targetW, targetH].every((n) => Number.isFinite(n) && n > 0)) return full;
  if (fit === 'stretch') return full;
  const s = fit === 'cover' ? Math.max(targetW / videoW, targetH / videoH) : Math.min(targetW / videoW, targetH / videoH);
  const w = videoW * s;
  const h = videoH * s;
  return { x: Math.round((targetW - w) / 2), y: Math.round((targetH - h) / 2), w: Math.round(w), h: Math.round(h) };
}

/**
 * 目标画幅在预览画布中的摆放：预览画布的元素尺寸由面板决定，
 * 与导出画幅不一定同比例，故先把「目标画幅」等比内含进画布，视频再摆进这个框。
 * 导出路径不需要这一层（画布尺寸就是目标尺寸），所以只在预览调用。
 */
export function layoutTargetInCanvas(targetW: number, targetH: number, canvasW: number, canvasH: number): FrameRect {
  return layoutVideo(targetW, targetH, canvasW, canvasH, 'contain');
}

/** 两层取景：target=目标画幅在画布里的位置，content=视频在目标画幅里的位置 */
export interface FrameLayout {
  target: FrameRect;
  content: FrameRect;
}

/**
 * 组合「目标画幅 → 画布」与「视频 → 目标画幅」两层摆放。
 * 必须分两层：cover 适配下视频会溢出目标画幅，裁剪要按 target 走，
 * 绘制尺寸要按 content 走，合成一个矩形就把溢出漏出来了。
 * @param framing 取景是否生效；false 时两层都退回整幅画布（几何选框浮层打开时用）
 */
export function composeFrameLayout(
  videoW: number,
  videoH: number,
  canvasW: number,
  canvasH: number,
  targetW: number,
  targetH: number,
  fit: ExportFit,
  framing = true
): FrameLayout {
  if (!framing) {
    const full = { x: 0, y: 0, w: canvasW, h: canvasH };
    return { target: full, content: layoutVideo(videoW, videoH, canvasW, canvasH, 'stretch') };
  }
  const target = layoutTargetInCanvas(targetW, targetH, canvasW, canvasH);
  const inner = layoutVideo(videoW, videoH, target.w, target.h, fit);
  return { target, content: { x: target.x + inner.x, y: target.y + inner.y, w: inner.w, h: inner.h } };
}

/** 矩形是否覆盖整个画布（覆盖了就不必填黑底，省一次全屏填充） */
export function isFullFrame(r: FrameRect, w: number, h: number): boolean {
  return r.x === 0 && r.y === 0 && r.w === w && r.h === h;
}

/** 设置摘要（导出面板与日志共用一句话口径） */
export function describeExportSettings(size: ExportSize, settings: ExportSettings, bitrateBps: number): string {
  const mbps = (bitrateBps / 1_000_000).toFixed(1);
  return `${size.width}×${size.height} · ${settings.fps}fps · ${ASPECT_LABELS[settings.aspect]} · ${QUALITY_LABELS[settings.quality]} · ${FIT_LABELS[settings.fit]} · ${mbps} Mbps`;
}

/**
 * 兜底清洗：从存储读回的设置可能来自旧版本或被手改，逐项校验而不是直接用。
 * 非法值一律回到默认，不做「猜测修正」——猜错的码率会把用户成片压烂。
 */
export function normalizeExportSettings(raw: unknown): ExportSettings {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_EXPORT_SETTINGS };
  const r = raw as Record<string, unknown>;
  const aspects: ExportAspect[] = ['source', '16:9', '9:16', '4:3', '3:4', '1:1'];
  const fits: ExportFit[] = ['stretch', 'contain', 'cover'];
  const qualities: ExportQuality[] = ['draft', 'standard', 'high'];
  const aspect = aspects.includes(r.aspect as ExportAspect) ? (r.aspect as ExportAspect) : DEFAULT_EXPORT_SETTINGS.aspect;
  const fit = fits.includes(r.fit as ExportFit) ? (r.fit as ExportFit) : DEFAULT_EXPORT_SETTINGS.fit;
  const quality = qualities.includes(r.quality as ExportQuality) ? (r.quality as ExportQuality) : DEFAULT_EXPORT_SETTINGS.quality;
  const shortSide = EXPORT_SHORT_SIDES.includes(Number(r.shortSide)) ? Number(r.shortSide) : 0;
  const fps = EXPORT_FPS_OPTIONS.includes(Number(r.fps)) ? Number(r.fps) : 30;
  const bitrateMbps = Number.isFinite(Number(r.bitrateMbps)) && Number(r.bitrateMbps) >= 0 ? Math.min(40, Number(r.bitrateMbps)) : 0;
  return { aspect, shortSide, fps, quality, fit, bitrateMbps };
}
