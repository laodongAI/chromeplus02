import { describe, it, expect } from 'vitest';
import {
  AUTO_STOP_MAX_SECONDS,
  AUTO_STOP_PRESETS,
  formatCountdown,
  normalizeAutoStopSeconds,
  remainingSeconds,
  shouldAutoStop
} from '@/core/recordingLimits';

describe('normalizeAutoStopSeconds：输入收敛', () => {
  it('0 与负数表示不限', () => {
    expect(normalizeAutoStopSeconds(0)).toBe(0);
    expect(normalizeAutoStopSeconds(-30)).toBe(0);
  });

  it('非法输入一律归 0，绝不能变成「立刻停止」', () => {
    for (const v of [NaN, Infinity, -Infinity, '', 'abc', null, undefined, {}]) {
      expect(normalizeAutoStopSeconds(v)).toBe(0);
    }
  });

  it('字符串数字可用（下拉框 value 是字符串）', () => {
    expect(normalizeAutoStopSeconds('300')).toBe(300);
  });

  it('小数向下取整，超限截到上限', () => {
    expect(normalizeAutoStopSeconds(90.9)).toBe(90);
    expect(normalizeAutoStopSeconds(AUTO_STOP_MAX_SECONDS + 1000)).toBe(AUTO_STOP_MAX_SECONDS);
  });
});

describe('shouldAutoStop：到点判定', () => {
  it('不限时永不触发', () => {
    expect(shouldAutoStop(999999, 0)).toBe(false);
  });

  it('到达或超过上限触发，之前不触发', () => {
    expect(shouldAutoStop(299, 300)).toBe(false);
    expect(shouldAutoStop(300, 300)).toBe(true);
    expect(shouldAutoStop(301, 300)).toBe(true);
  });

  it('负数上限按不限处理（防御非法配置）', () => {
    expect(shouldAutoStop(100, -5)).toBe(false);
  });
});

describe('remainingSeconds：倒计时', () => {
  it('不限时返回 0（面板据此隐藏倒计时）', () => {
    expect(remainingSeconds(10, 0)).toBe(0);
  });

  it('正常倒数且不为负', () => {
    expect(remainingSeconds(0, 300)).toBe(300);
    expect(remainingSeconds(120, 300)).toBe(180);
    expect(remainingSeconds(400, 300)).toBe(0);
  });

  it('小数秒向下取整，与显示的整秒计时一致', () => {
    expect(remainingSeconds(10.9, 300)).toBe(290);
  });
});

describe('formatCountdown：文本格式', () => {
  it('不足 1 小时为 mm:ss', () => {
    expect(formatCountdown(0)).toBe('00:00');
    expect(formatCountdown(65)).toBe('01:05');
    expect(formatCountdown(300)).toBe('05:00');
  });

  it('超过 1 小时补 hh', () => {
    expect(formatCountdown(3661)).toBe('01:01:01');
  });

  it('负数与非法值收敛到 00:00', () => {
    expect(formatCountdown(-5)).toBe('00:00');
    expect(formatCountdown(NaN)).toBe('00:00');
  });
});

describe('AUTO_STOP_PRESETS', () => {
  it('首项为不限，其余递增且都在上限内', () => {
    expect(AUTO_STOP_PRESETS[0].seconds).toBe(0);
    for (let i = 1; i < AUTO_STOP_PRESETS.length; i++) {
      expect(AUTO_STOP_PRESETS[i].seconds).toBeGreaterThan(AUTO_STOP_PRESETS[i - 1].seconds);
      expect(AUTO_STOP_PRESETS[i].seconds).toBeLessThanOrEqual(AUTO_STOP_MAX_SECONDS);
    }
  });
});