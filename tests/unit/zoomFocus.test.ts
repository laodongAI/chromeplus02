import { describe, it, expect } from 'vitest';
import {
  BLUR_MIN_NORM,
  BLUR_STRENGTH_MAX,
  ZOOM_ANCHOR_POINTS,
  ZOOM_MAX,
  ZOOM_MIN,
  ZOOM_STEP,
  approachZoom,
  blurRadiusPx,
  clampZoom,
  computeSourceRect,
  expandRect,
  intersectRect,
  mapSourceToOutput,
  normalizeBlurRegion,
  regionToSourcePixels
} from '@/core/zoomFocus';

describe('clampZoom：倍率收敛', () => {
  it('夹到 [1,3] 并量化到最近的步进', () => {
    expect(clampZoom(0.5)).toBe(ZOOM_MIN);
    expect(clampZoom(99)).toBe(ZOOM_MAX);
    expect(clampZoom(1.3)).toBe(1.25);
    expect(clampZoom(1.4)).toBe(1.5);
    // 1.37/0.25=5.48 → 就近取 5 档，不是 6 档
    expect(clampZoom(1.37)).toBe(1.25);
  });

  it('非法值回到原画，绝不产出 NaN 倍率', () => {
    expect(clampZoom(NaN)).toBe(ZOOM_MIN);
    expect(clampZoom(Infinity)).toBe(ZOOM_MIN);
  });
});

describe('approachZoom：指数缓动', () => {
  it('单调趋近目标且不超过目标', () => {
    let z = 1;
    for (let i = 0; i < 200; i++) z = approachZoom(z, 2, 16);
    expect(z).toBe(2);
  });

  it('掉帧时步长自动变大，总时长不变（线性插值做不到）', () => {
    const smooth = approachZoom(1, 2, 16);
    const dropped = approachZoom(1, 2, 64);
    expect(dropped - 1).toBeGreaterThan(smooth - 1);
    // 4 个 16ms 与 1 个 64ms 的结果一致
    let z = 1;
    for (let i = 0; i < 4; i++) z = approachZoom(z, 2, 16);
    expect(z).toBeCloseTo(dropped, 6);
  });

  it('dt<=0 或 tau<=0 直接吸附，不产生除零', () => {
    expect(approachZoom(1, 2, 0)).toBe(2);
    expect(approachZoom(1, 2, 16, 0)).toBe(2);
  });

  it('足够接近时吸附到目标，避免每帧重绘', () => {
    expect(approachZoom(1.9995, 2, 16)).toBe(2);
  });

  it('current 非法时直接取目标', () => {
    expect(approachZoom(NaN, 2, 16)).toBe(2);
  });
});

describe('computeSourceRect：推近裁剪', () => {
  it('1× 时取满画面', () => {
    expect(computeSourceRect(1920, 1080, 1, 'center')).toEqual({ sx: 0, sy: 0, sw: 1920, sh: 1080 });
  });

  it('2× 居中：源矩形为画面一半且居中', () => {
    const r = computeSourceRect(1920, 1080, 2, 'center');
    expect(r.sw).toBe(960);
    expect(r.sh).toBe(540);
    expect(r.sx).toBe(480);
    expect(r.sy).toBe(270);
  });

  it('锚点决定贴哪一边，且永不越界', () => {
    for (const anchor of Object.keys(ZOOM_ANCHOR_POINTS) as Array<keyof typeof ZOOM_ANCHOR_POINTS>) {
      const r = computeSourceRect(1920, 1080, 3, anchor);
      expect(r.sx).toBeGreaterThanOrEqual(0);
      expect(r.sy).toBeGreaterThanOrEqual(0);
      expect(r.sx + r.sw).toBeLessThanOrEqual(1920);
      expect(r.sy + r.sh).toBeLessThanOrEqual(1080);
    }
    expect(computeSourceRect(1920, 1080, 2, 'top-left').sx).toBe(0);
    expect(computeSourceRect(1920, 1080, 2, 'bottom-right').sx).toBe(960);
  });

  it('输出尺寸与倍率无关（推近不改分辨率，码率才稳定）', () => {
    const a = computeSourceRect(1920, 1080, 1, 'center');
    const b = computeSourceRect(1920, 1080, 3, 'center');
    expect(a.sw / a.sh).toBeCloseTo(b.sw / b.sh, 6);
  });

  it('非法尺寸返回零矩形', () => {
    expect(computeSourceRect(0, 1080, 2, 'center').sw).toBe(0);
    expect(computeSourceRect(NaN, 1080, 2, 'center').sh).toBe(0);
  });

  it('非法倍率按 1× 处理', () => {
    expect(computeSourceRect(1920, 1080, NaN, 'center').sw).toBe(1920);
  });
});

describe('normalizeBlurRegion：拖拽框归一化', () => {
  it('正向与反向拖拽得到同一个矩形', () => {
    const a = normalizeBlurRegion(10, 20, 110, 120, 200, 200);
    const b = normalizeBlurRegion(110, 120, 10, 20, 200, 200);
    expect(a).toEqual(b);
    expect(a).toEqual({ x: 0.05, y: 0.1, w: 0.5, h: 0.5 });
  });

  it('超出舞台的拖拽被夹到 [0,1]', () => {
    const r = normalizeBlurRegion(-50, -50, 500, 500, 200, 200);
    expect(r).toEqual({ x: 0, y: 0, w: 1, h: 1 });
  });

  it('过小的框判为误点，返回 null', () => {
    expect(normalizeBlurRegion(10, 10, 11, 11, 200, 200)).toBeNull();
    const tiny = BLUR_MIN_NORM * 200 / 2;
    expect(normalizeBlurRegion(0, 0, tiny, tiny, 200, 200)).toBeNull();
  });

  it('非法输入返回 null，不产出 NaN 坐标', () => {
    expect(normalizeBlurRegion(NaN, 0, 10, 10, 200, 200)).toBeNull();
    expect(normalizeBlurRegion(0, 0, 10, 10, 0, 200)).toBeNull();
  });
});

describe('blurRadiusPx：强度按分辨率缩放', () => {
  it('同一强度在 2K 上的半径大于 720p（观感力度一致）', () => {
    expect(blurRadiusPx(6, 2560, 1440)).toBeGreaterThan(blurRadiusPx(6, 1280, 720));
  });

  it('强度夹到合法区间，半径至少 2px', () => {
    expect(blurRadiusPx(0, 100, 100)).toBeGreaterThanOrEqual(2);
    expect(blurRadiusPx(999, 1920, 1080)).toBe(blurRadiusPx(BLUR_STRENGTH_MAX, 1920, 1080));
    expect(blurRadiusPx(NaN, 1920, 1080)).toBeGreaterThan(0);
  });
});

describe('矩形运算：交集 / 映射 / 扩张', () => {
  it('交集正确，无交集返回 null', () => {
    expect(intersectRect({ x: 0, y: 0, w: 10, h: 10 }, { x: 5, y: 5, w: 10, h: 10 })).toEqual({ x: 5, y: 5, w: 5, h: 5 });
    expect(intersectRect({ x: 0, y: 0, w: 10, h: 10 }, { x: 20, y: 20, w: 5, h: 5 })).toBeNull();
    // 仅边相接不算交集（面积为 0）
    expect(intersectRect({ x: 0, y: 0, w: 10, h: 10 }, { x: 10, y: 0, w: 5, h: 5 })).toBeNull();
  });

  it('源→输出映射：2× 居中推近时，源中心区映射到整个输出', () => {
    const visible = computeSourceRect(1920, 1080, 2, 'center');
    const dst = mapSourceToOutput({ x: 480, y: 270, w: 960, h: 540 }, visible, 1920, 1080);
    expect(dst).toEqual({ x: 0, y: 0, w: 1920, h: 1080 });
  });

  it('1× 时映射是恒等变换', () => {
    const visible = computeSourceRect(1920, 1080, 1, 'center');
    const src = { x: 100, y: 200, w: 300, h: 400 };
    expect(mapSourceToOutput(src, visible, 1920, 1080)).toEqual(src);
  });

  it('零尺寸裁剪不产生除零', () => {
    expect(mapSourceToOutput({ x: 0, y: 0, w: 10, h: 10 }, { sx: 0, sy: 0, sw: 0, sh: 0 }, 100, 100).w).toBe(0);
  });

  it('归一化区域 → 源像素', () => {
    expect(regionToSourcePixels({ x: 0.25, y: 0.5, w: 0.5, h: 0.25 }, 1920, 1080)).toEqual({ x: 480, y: 540, w: 960, h: 270 });
  });

  it('扩张被夹在源画面内（模糊多取一圈但不能取到画面外）', () => {
    const bounds = { x: 0, y: 0, w: 100, h: 100 };
    expect(expandRect({ x: 0, y: 0, w: 10, h: 10 }, 5, bounds)).toEqual({ x: 0, y: 0, w: 15, h: 15 });
    expect(expandRect({ x: 90, y: 90, w: 10, h: 10 }, 5, bounds)).toEqual({ x: 85, y: 85, w: 15, h: 15 });
  });
});

describe('常量自洽', () => {
  it('步进能整除量程，按钮不会卡在非整数倍率', () => {
    expect((ZOOM_MAX - ZOOM_MIN) / ZOOM_STEP).toBe(Math.round((ZOOM_MAX - ZOOM_MIN) / ZOOM_STEP));
  });
});