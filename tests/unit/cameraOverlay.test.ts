import { describe, it, expect } from 'vitest';
import {
  computePipRect,
  cameraConstraints,
  DEFAULT_CAMERA_PIP,
  PIP_HEIGHT_RATIO,
  PIP_MAX_WIDTH_RATIO,
  type CameraPipOptions
} from '@/core/cameraOverlay';

const base: CameraPipOptions = { ...DEFAULT_CAMERA_PIP, enabled: true };

describe('computePipRect：落位与尺寸', () => {
  it('右下角：留出边距且不越界', () => {
    const r = computePipRect(1920, 1080, { ...base, position: 'bottom-right' });
    expect(r.x + r.width).toBeLessThanOrEqual(1920);
    expect(r.y + r.height).toBeLessThanOrEqual(1080);
    expect(r.x).toBeGreaterThan(1920 / 2);
    expect(r.y).toBeGreaterThan(1080 / 2);
  });

  it('四个角各自落在对应象限', () => {
    const cases: Array<[CameraPipOptions['position'], (r: ReturnType<typeof computePipRect>) => boolean]> = [
      ['top-left', (r) => r.x < 960 && r.y < 540],
      ['top-right', (r) => r.x > 960 && r.y < 540],
      ['bottom-left', (r) => r.x < 960 && r.y > 540],
      ['bottom-right', (r) => r.x > 960 && r.y > 540]
    ];
    for (const [position, check] of cases) {
      expect(check(computePipRect(1920, 1080, { ...base, position })), position).toBe(true);
    }
  });

  it('尺寸档按比例放大，且不超过画面', () => {
    const small = computePipRect(1920, 1080, { ...base, size: 'small', shape: 'rounded' });
    const large = computePipRect(1920, 1080, { ...base, size: 'large', shape: 'rounded' });
    expect(large.height).toBeGreaterThan(small.height);
    expect(small.height).toBe(Math.round(1080 * PIP_HEIGHT_RATIO.small));
    expect(large.height).toBeLessThanOrEqual(1080);
  });

  it('圆形档强制正方形（否则圆会画成椭圆）', () => {
    const r = computePipRect(1920, 1080, { ...base, shape: 'circle' }, 16 / 9);
    expect(r.width).toBe(r.height);
    expect(r.radius).toBe(r.width / 2);
  });

  it('圆角档按摄像头真实宽高比展开', () => {
    const r = computePipRect(1920, 1080, { ...base, shape: 'rounded', size: 'small' }, 4 / 3);
    expect(r.width / r.height).toBeCloseTo(4 / 3, 1);
    expect(r.radius).toBeGreaterThan(0);
    expect(r.radius).toBeLessThan(r.height / 2);
  });

  it('竖屏画面：宽度上限生效，等比缩小而不是裁切', () => {
    const r = computePipRect(400, 1000, { ...base, shape: 'rounded', size: 'large' }, 16 / 9);
    expect(r.width).toBeLessThanOrEqual(Math.floor(400 * PIP_MAX_WIDTH_RATIO));
    expect(r.width / r.height).toBeCloseTo(16 / 9, 1);
    expect(r.x + r.width).toBeLessThanOrEqual(400);
    expect(r.y + r.height).toBeLessThanOrEqual(1000);
  });

  it('极小画面也不越界（录一个很窄的窗口）', () => {
    const r = computePipRect(20, 12, { ...base, shape: 'rounded', size: 'large' }, 16 / 9);
    expect(r.x).toBeGreaterThanOrEqual(0);
    expect(r.y).toBeGreaterThanOrEqual(0);
    expect(r.x + r.width).toBeLessThanOrEqual(20);
    expect(r.y + r.height).toBeLessThanOrEqual(12);
  });

  it('非法画布尺寸返回零矩形，不抛错', () => {
    for (const [w, h] of [[0, 1080], [1920, 0], [-1, 100], [NaN, 100], [100, Infinity]]) {
      const r = computePipRect(w as number, h as number, base);
      expect(r.width).toBe(0);
      expect(r.height).toBe(0);
    }
  });

  it('非法摄像头宽高比按 16:9 兜底', () => {
    const bad = computePipRect(1920, 1080, { ...base, shape: 'rounded', size: 'small' }, 0);
    const good = computePipRect(1920, 1080, { ...base, shape: 'rounded', size: 'small' }, 16 / 9);
    expect(bad).toEqual(good);
  });

  it('返回的零矩形是副本，调用方改动不污染下一次结果', () => {
    const a = computePipRect(0, 0, base);
    a.width = 999;
    expect(computePipRect(0, 0, base).width).toBe(0);
  });
});

describe('cameraConstraints：按档位要分辨率', () => {
  it('大档高于小档，且都不超过 720p（画中画不需要更大）', () => {
    const small = cameraConstraints('small');
    const large = cameraConstraints('large');
    const h = (c: MediaTrackConstraints) => (c.height as { ideal: number }).ideal;
    expect(h(large)).toBeGreaterThan(h(small));
    expect(h(large)).toBeLessThanOrEqual(720);
  });

  it('只要摄像头画面，帧率封顶 30', () => {
    const c = cameraConstraints('medium');
    expect((c.frameRate as { max: number }).max).toBe(30);
    expect(c.facingMode).toBe('user');
  });
});

describe('DEFAULT_CAMERA_PIP', () => {
  it('默认关闭：不开画中画时视频轨必须直通', () => {
    expect(DEFAULT_CAMERA_PIP.enabled).toBe(false);
  });
});