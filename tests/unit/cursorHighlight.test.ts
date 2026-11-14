import { describe, it, expect } from 'vitest';
import {
  HALO_BASE_PX,
  MAX_LIVE_RIPPLES,
  RIPPLE_BASE_PX,
  RIPPLE_MIN_INTERVAL_MS,
  clampCenter,
  haloGeometry,
  rippleGeometry,
  shouldSpawnRipple
} from '@/core/cursorHighlight';

describe('shouldSpawnRipple：节流与同屏上限', () => {
  it('首次点击必生成', () => {
    expect(shouldSpawnRipple(1000, 0, 0)).toBe(true);
  });

  it('间隔不足不生成（拖动/连点会刷屏，掉帧会录进成片）', () => {
    expect(shouldSpawnRipple(1000 + RIPPLE_MIN_INTERVAL_MS - 1, 1000, 0)).toBe(false);
    expect(shouldSpawnRipple(1000 + RIPPLE_MIN_INTERVAL_MS, 1000, 0)).toBe(true);
  });

  it('达到同屏上限不生成，旧的结束后恢复', () => {
    expect(shouldSpawnRipple(5000, 1000, MAX_LIVE_RIPPLES)).toBe(false);
    expect(shouldSpawnRipple(5000, 1000, MAX_LIVE_RIPPLES - 1)).toBe(true);
  });

  it('上限优先于间隔：即使间隔足够也不超量建节点', () => {
    expect(shouldSpawnRipple(99999, 1, MAX_LIVE_RIPPLES + 3)).toBe(false);
  });
});

describe('clampCenter：边缘点击不被裁掉', () => {
  it('视口内的点原样返回', () => {
    expect(clampCenter(500, 400, 1920, 1080, 44)).toEqual({ cx: 500, cy: 400 });
  });

  it('贴边点击把圆心收进视口，圆环完整可见', () => {
    const r = clampCenter(0, 0, 1920, 1080, 44);
    expect(r.cx).toBe(22);
    expect(r.cy).toBe(22);
    const r2 = clampCenter(1920, 1080, 1920, 1080, 44);
    expect(r2.cx).toBe(1898);
    expect(r2.cy).toBe(1058);
  });

  it('视口比圆还小时退化为居中', () => {
    expect(clampCenter(10, 5, 20, 10, 44)).toEqual({ cx: 10, cy: 5 });
  });

  it('非法坐标收敛为 0，不产出 NaN 样式', () => {
    const r = clampCenter(NaN, Infinity, 1920, 1080, 44);
    expect(Number.isFinite(r.cx)).toBe(true);
    expect(Number.isFinite(r.cy)).toBe(true);
  });
});

describe('rippleGeometry / haloGeometry', () => {
  it('各自使用自己的直径', () => {
    expect(rippleGeometry(100, 100, 1920, 1080).size).toBe(RIPPLE_BASE_PX);
    expect(haloGeometry(100, 100, 1920, 1080).size).toBe(HALO_BASE_PX);
  });

  it('圆心与直径自洽：左上角坐标非负且整体在视口内', () => {
    for (const g of [rippleGeometry(0, 0, 800, 600), haloGeometry(800, 600, 800, 600)]) {
      expect(g.cx - g.size / 2).toBeGreaterThanOrEqual(0);
      expect(g.cy - g.size / 2).toBeGreaterThanOrEqual(0);
      expect(g.cx + g.size / 2).toBeLessThanOrEqual(800);
      expect(g.cy + g.size / 2).toBeLessThanOrEqual(600);
    }
  });
});