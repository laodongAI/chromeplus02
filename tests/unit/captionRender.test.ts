import { describe, it, expect } from 'vitest';
import {
  CAPTION_HEIGHT_RATIO,
  CAPTION_MIN_PX,
  captionBaseline,
  captionEdge,
  captionFontSize,
  captionOverlayCenterX,
  captionOverlayTop,
  fullBox,
  type FrameBox,
} from '@/core/captionRender';

const BOX: FrameBox = { x: 100, y: 50, w: 1080, h: 1920 };

describe('captionFontSize：字号随内容框高缩放', () => {
  it('720p 下与历史观感对齐（sm/md/lg ≈ 18/26/36）', () => {
    const h = 720;
    expect(captionFontSize(h, 'sm')).toBe(Math.round(h * CAPTION_HEIGHT_RATIO.sm));
    expect(captionFontSize(h, 'md')).toBe(Math.round(h * CAPTION_HEIGHT_RATIO.md));
    expect(captionFontSize(h, 'lg')).toBe(Math.round(h * CAPTION_HEIGHT_RATIO.lg));
  });

  it('竖屏成片字号自然放大，小画幅不低于可读下限', () => {
    expect(captionFontSize(1920, 'md')).toBe(69);
    expect(captionFontSize(240, 'sm')).toBe(CAPTION_MIN_PX);
  });

  it('高度非法（0/负数/NaN）回退基准而不是算出 0 号字', () => {
    for (const bad of [0, -100, NaN, Infinity]) {
      expect(captionFontSize(bad, 'md')).toBe(captionFontSize(720, 'md'));
    }
  });

  it('未知 size 回退到 md', () => {
    expect(captionFontSize(720, 'huge' as never)).toBe(captionFontSize(720, 'md'));
  });
});

describe('captionEdge：留白', () => {
  it('与内容框高成正比', () => {
    expect(captionEdge(1000)).toBe(30);
    expect(captionEdge(500)).toBe(15);
  });
});

describe('预览覆盖层与导出烧字的落点一致性', () => {
  it('三个位置自上而下严格递增', () => {
    const fs = captionFontSize(BOX.h, 'md');
    const tops = (['top', 'center', 'bottom'] as const).map((p) => captionOverlayTop(BOX, fs, p));
    expect(tops[0]).toBeLessThan(tops[1]);
    expect(tops[1]).toBeLessThan(tops[2]);
    const bases = (['top', 'center', 'bottom'] as const).map((p) => captionBaseline(BOX, fs, p));
    expect(bases[0]).toBeLessThan(bases[1]);
    expect(bases[1]).toBeLessThan(bases[2]);
  });

  it('top 贴内容框上沿留白，bottom 贴下沿留白（黑边区域绝不落字）', () => {
    const fs = captionFontSize(BOX.h, 'md');
    expect(captionOverlayTop(BOX, fs, 'top')).toBe(BOX.y + captionEdge(BOX.h));
    expect(captionBaseline(BOX, fs, 'bottom')).toBe(BOX.y + BOX.h - captionEdge(BOX.h));
    expect(captionBaseline(BOX, fs, 'top')).toBe(BOX.y + captionEdge(BOX.h) + fs);
  });

  it('center 落在内容框正中', () => {
    const fs = captionFontSize(BOX.h, 'md');
    expect(captionOverlayTop(BOX, fs, 'center')).toBe(BOX.y + BOX.h / 2 - fs / 2);
    expect(captionBaseline(BOX, fs, 'center')).toBe(BOX.y + BOX.h / 2 + fs / 2);
  });

  it('水平中心随内容框（画幅加黑边后字幕仍居中于画面而非画布）', () => {
    expect(captionOverlayCenterX(BOX)).toBe(100 + 540);
    expect(captionOverlayCenterX(fullBox(1280, 720))).toBe(640);
  });

  it('覆盖层顶部不会低于自身基线（同一位置两套口径的相对次序必须一致）', () => {
    const fs = captionFontSize(BOX.h, 'lg');
    for (const p of ['top', 'center', 'bottom'] as const) {
      expect(captionOverlayTop(BOX, fs, p)).toBeLessThan(captionBaseline(BOX, fs, p));
    }
  });
});
