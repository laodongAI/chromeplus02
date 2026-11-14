import { describe, it, expect } from 'vitest';
import {
  DEFAULT_EXPORT_SETTINGS,
  EXPORT_FPS_OPTIONS,
  aspectRatioOf,
  composeFrameLayout,
  describeExportSettings,
  estimateBitrateBps,
  isFullFrame,
  layoutTargetInCanvas,
  layoutVideo,
  normalizeExportSettings,
  resolveExportSize,
  type ExportSettings,
} from '@/core/exportPresets';

/** 便于逐条改单个字段的设置构造 */
function settings(over: Partial<ExportSettings> = {}): ExportSettings {
  return { ...DEFAULT_EXPORT_SETTINGS, ...over };
}

describe('aspectRatioOf：画幅比例', () => {
  it('named 比例直接换算', () => {
    expect(aspectRatioOf('16:9', 1920, 1080)).toBeCloseTo(16 / 9);
    expect(aspectRatioOf('9:16', 1920, 1080)).toBeCloseTo(9 / 16);
    expect(aspectRatioOf('1:1', 1920, 1080)).toBe(1);
  });

  it('source 跟随源视频，源尺寸缺失时退回 16:9 而不是 NaN', () => {
    expect(aspectRatioOf('source', 400, 300)).toBeCloseTo(4 / 3);
    expect(aspectRatioOf('source', 0, 0)).toBeCloseTo(16 / 9);
    expect(aspectRatioOf('source', NaN, 1080)).toBeCloseTo(16 / 9);
  });
});

describe('resolveExportSize：目标宽高', () => {
  it('跟随源 + 源分辨率 = 原尺寸取偶', () => {
    expect(resolveExportSize(1920, 1080, settings())).toEqual({ width: 1920, height: 1080 });
    // 奇数源尺寸必须取偶，否则 H.264 编码器直接拒绝配置
    expect(resolveExportSize(1919, 1079, settings())).toEqual({ width: 1920, height: 1080 });
  });

  it('短边档位决定尺寸，横屏 1080 = 1920×1080', () => {
    expect(resolveExportSize(3840, 2160, settings({ shortSide: 1080 }))).toEqual({ width: 1920, height: 1080 });
    expect(resolveExportSize(3840, 2160, settings({ shortSide: 720 }))).toEqual({ width: 1280, height: 720 });
  });

  it('横转竖：短边 1080 的 9:16 得到 1080×1920（不是 608×1080）', () => {
    expect(resolveExportSize(1920, 1080, settings({ aspect: '9:16', shortSide: 1080 })))
      .toEqual({ width: 1080, height: 1920 });
  });

  it('竖转横：3:4 源出 16:9 目标，短边按档位', () => {
    expect(resolveExportSize(1080, 1920, settings({ aspect: '16:9', shortSide: 720 })))
      .toEqual({ width: 1280, height: 720 });
  });

  it('方形画幅两边相等', () => {
    expect(resolveExportSize(1920, 1080, settings({ aspect: '1:1', shortSide: 1080 })))
      .toEqual({ width: 1080, height: 1080 });
  });

  it('超长边被夹到 4096，避免不可编码的尺寸', () => {
    const s = resolveExportSize(7680, 4320, settings({ shortSide: 2160 }));
    expect(s.width).toBeLessThanOrEqual(4096);
    expect(s.height).toBe(2160);
  });

  it('源尺寸非法时仍能出可用画布（不产生 0×0）', () => {
    const s = resolveExportSize(0, 0, settings({ shortSide: 720 }));
    expect(s.width).toBeGreaterThan(0);
    expect(s.height).toBeGreaterThan(0);
  });
});

describe('estimateBitrateBps：码率', () => {
  it('手动码率优先并夹在安全区间', () => {
    expect(estimateBitrateBps(1920, 1080, 30, settings({ bitrateMbps: 6 }))).toBe(6_000_000);
    expect(estimateBitrateBps(1920, 1080, 30, settings({ bitrateMbps: 999 }))).toBe(40_000_000);
  });

  it('自动码率随分辨率与帧率上升，且不低于下限', () => {
    const p = settings({ shortSide: 1080, quality: 'standard' });
    const s = settings({ shortSide: 720, quality: 'standard' });
    const sd = settings({ shortSide: 720, quality: 'draft' });
    const big = estimateBitrateBps(1920, 1080, 30, p);
    const mid = estimateBitrateBps(1280, 720, 30, s);
    const low = estimateBitrateBps(1280, 720, 30, sd);
    expect(big).toBeGreaterThan(mid);
    expect(mid).toBeGreaterThan(low);
    // 极小画布也要有可用码率，否则成片全是马赛克
    expect(estimateBitrateBps(64, 36, 1, settings())).toBeGreaterThanOrEqual(500_000);
  });

  it('非法帧率退回 30fps 而不是算出 NaN', () => {
    const bps = estimateBitrateBps(1280, 720, NaN, settings());
    expect(Number.isFinite(bps)).toBe(true);
    expect(bps).toBe(estimateBitrateBps(1280, 720, 30, settings()));
  });
});

describe('layoutVideo：适配方式', () => {
  it('同比例画幅三种方式都铺满', () => {
    for (const fit of ['stretch', 'contain', 'cover'] as const) {
      expect(layoutVideo(1920, 1080, 1920, 1080, fit)).toEqual({ x: 0, y: 0, w: 1920, h: 1080 });
    }
  });

  it('contain 等比内含并居中，绝不变形', () => {
    const r = layoutVideo(1920, 1080, 1080, 1920, 'contain');
    expect(r.w / r.h).toBeCloseTo(16 / 9, 2);
    expect(r.w).toBe(1080);
    expect(r.h).toBe(608);
    expect(r.x).toBe(0);
    expect(r.y).toBeCloseTo((1920 - 608) / 2, 0);
  });

  it('cover 等比外扩（超出画幅的部分交给调用方裁掉）', () => {
    const r = layoutVideo(1920, 1080, 1080, 1920, 'cover');
    expect(r.h).toBe(1920);
    expect(r.w).toBeGreaterThan(1080);
    expect(r.x).toBeLessThan(0);
    expect(r.w / r.h).toBeCloseTo(16 / 9, 2);
  });

  it('stretch 永远铺满（比例不符即变形，由用户显式选择）', () => {
    expect(layoutVideo(1920, 1080, 1080, 1920, 'stretch')).toEqual({ x: 0, y: 0, w: 1080, h: 1920 });
  });

  it('尺寸非法时原样铺满目标框（目标本身为 0 时不额外造矩形）', () => {
    expect(layoutVideo(0, 0, 1280, 720, 'contain')).toEqual({ x: 0, y: 0, w: 1280, h: 720 });
    expect(layoutVideo(1920, 1080, 0, 0, 'cover')).toEqual({ x: 0, y: 0, w: 0, h: 0 });
  });

  it('isFullFrame 用来省掉黑底填充', () => {
    expect(isFullFrame({ x: 0, y: 0, w: 1280, h: 720 }, 1280, 720)).toBe(true);
    expect(isFullFrame({ x: 0, y: 10, w: 1280, h: 700 }, 1280, 720)).toBe(false);
  });
});

describe('layoutTargetInCanvas：预览画框', () => {
  it('竖屏目标在横画布里等比内含', () => {
    const r = layoutTargetInCanvas(1080, 1920, 1280, 720);
    expect(r.h).toBe(720);
    expect(r.w).toBe(Math.round(720 * 1080 / 1920));
    expect(r.x).toBe(Math.round((1280 - r.w) / 2));
  });

  it('目标比例与画布一致时铺满（无黑边）', () => {
    expect(layoutTargetInCanvas(1600, 900, 1280, 720)).toEqual({ x: 0, y: 0, w: 1280, h: 720 });
  });
});

describe('composeFrameLayout：两层取景', () => {
  it('导出场景（画布=目标）时 target 即整幅，content 由适配方式决定', () => {
    const l = composeFrameLayout(1920, 1080, 1080, 1920, 1080, 1920, 'contain');
    expect(l.target).toEqual({ x: 0, y: 0, w: 1080, h: 1920 });
    expect(l.content.w).toBe(1080);
    expect(l.content.x).toBe(0);
  });

  it('预览场景：横屏源 + 竖屏目标，在横画布里得到居中的竖幅', () => {
    const l = composeFrameLayout(1920, 1080, 1280, 720, 1080, 1920, 'contain');
    expect(l.target.h).toBe(720);
    expect(l.target.w).toBeLessThan(1280);
    // contain 且目标短边正好等于视频高的场景：content 落在 target 内
    expect(l.content.x).toBeGreaterThanOrEqual(l.target.x);
    expect(l.content.x + l.content.w).toBeLessThanOrEqual(l.target.x + l.target.w + 1);
    expect(l.content.y + l.content.h).toBeLessThanOrEqual(l.target.y + l.target.h + 1);
  });

  it('cover 下 content 溢出 target，裁剪仍必须按 target 走（溢出部分不能漏进黑边）', () => {
    const l = composeFrameLayout(1920, 1080, 1080, 1920, 1080, 1920, 'cover');
    expect(l.content.w).toBeGreaterThan(l.target.w);
    expect(l.content.x).toBeLessThan(0);
    expect(l.content.x + l.content.w).toBeGreaterThan(l.target.w);
  });

  it('framing=false 时两层都铺满画布（几何选框浮层打开时不错位）', () => {
    const l = composeFrameLayout(1920, 1080, 1280, 720, 1080, 1920, 'contain', false);
    expect(l.target).toEqual({ x: 0, y: 0, w: 1280, h: 720 });
    expect(l.content).toEqual({ x: 0, y: 0, w: 1280, h: 720 });
  });
});

describe('normalizeExportSettings：存储回读兜底', () => {
  it('非对象输入回到默认值', () => {
    for (const v of [null, undefined, 'x', 42]) {
      expect(normalizeExportSettings(v)).toEqual(DEFAULT_EXPORT_SETTINGS);
    }
  });

  it('非法枚举逐项回默认，合法项保留', () => {
    const fixed = normalizeExportSettings({ aspect: '21:9', shortSide: 1000, fps: 144, fit: 'zoom', quality: 'ultra', bitrateMbps: -5 });
    expect(fixed.aspect).toBe('source');
    expect(fixed.shortSide).toBe(0);
    expect(fixed.fps).toBe(30);
    expect(fixed.fit).toBe('contain');
    expect(fixed.quality).toBe('standard');
    expect(fixed.bitrateMbps).toBe(0);
    const ok = normalizeExportSettings({ aspect: '9:16', shortSide: 1080, fps: 60, fit: 'cover', quality: 'high', bitrateMbps: 12 });
    expect(ok).toEqual({ aspect: '9:16', shortSide: 1080, fps: 60, fit: 'cover', quality: 'high', bitrateMbps: 12 });
  });

  it('手动码率上限 40Mbps', () => {
    expect(normalizeExportSettings({ bitrateMbps: 500 }).bitrateMbps).toBe(40);
  });
});

describe('describeExportSettings 与选项常量', () => {
  it('摘要包含尺寸/帧率/画幅/画质/适配/码率', () => {
    const s = settings({ aspect: '9:16', shortSide: 1080, fps: 60, quality: 'high', fit: 'cover' });
    const size = resolveExportSize(1920, 1080, s);
    const text = describeExportSettings(size, s, estimateBitrateBps(size.width, size.height, s.fps, s));
    for (const part of ['1080', '1920', '60fps', '竖屏 9:16', '高质量', '裁切填满', 'Mbps']) {
      expect(text).toContain(part);
    }
  });

  it('帧率与短边档位是白名单内的值', () => {
    expect(EXPORT_FPS_OPTIONS).toEqual([24, 30, 60]);
  });
});
