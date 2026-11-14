/**
 * 导出会话控制的纯逻辑单测。
 * 重点覆盖两类真实故障：
 *  1. 收尾挂死 —— stop() 之后才挂 onstop / 录制器已 inactive / stop() 抛错 / 事件永不到来；
 *  2. 画面截尾 —— 逐帧墙钟对齐的等待时长计算（含落后、fps 非法边界）。
 * 外加音轨失败归因文案（静默丢音轨改为可见告警后的用户可读性）。
 */
import { describe, expect, it, vi } from 'vitest';
import {
  EXPORT_STOP_TIMEOUT_MS,
  stopMediaRecorder,
  computeFrameDelay,
  describeAudioTrackFailure,
} from '@/editor/exportControl';

/**
 * 造一个可控的 MediaRecorder 替身。
 * @param state 初始状态
 * @param behaviour stop() 的行为：派发 stop 事件 / 同步抛错 / 什么都不做（模拟挂死）
 */
function makeRecorder(
  state: 'inactive' | 'recording' | 'paused' = 'recording',
  behaviour: 'emit' | 'throw' | 'silent' | 'error' = 'emit'
) {
  const calls: string[] = [];
  const rec = {
    state,
    onstop: null as null | (() => void),
    onerror: null as null | (() => void),
    requestData() { calls.push('requestData'); },
    stop() {
      calls.push('stop');
      if (behaviour === 'throw') throw new Error('InvalidStateError');
      // 真实 stop() 可能同步派发事件：替身照做，才能验出"先挂监听再 stop"的顺序
      if (behaviour === 'emit') { this.state = 'inactive'; this.onstop?.(); }
      if (behaviour === 'error') { this.state = 'inactive'; this.onerror?.(); }
    },
  };
  return { rec: rec as unknown as MediaRecorder, calls, raw: rec };
}

describe('stopMediaRecorder：收尾不再挂死', () => {
  it('正常路径：先 requestData 再 stop，同步派发 onstop 也能收到', async () => {
    const { rec, calls } = makeRecorder('recording', 'emit');
    await stopMediaRecorder(rec);
    // 顺序关键：requestData 必须在 stop 之前，且监听必须在 stop 之前挂好
    expect(calls).toEqual(['requestData', 'stop']);
  });

  it('已 inactive 时直接返回，不调 stop（否则抛 InvalidStateError）', async () => {
    const { rec, calls } = makeRecorder('inactive');
    await expect(stopMediaRecorder(rec)).resolves.toBeUndefined();
    expect(calls).toEqual([]);
  });

  it('paused 状态也要收尾', async () => {
    const { rec, calls } = makeRecorder('paused', 'emit');
    await stopMediaRecorder(rec);
    expect(calls).toEqual(['requestData', 'stop']);
  });

  it('onerror 同样结束等待，不无限挂着', async () => {
    const { rec } = makeRecorder('recording', 'error');
    await expect(stopMediaRecorder(rec)).resolves.toBeUndefined();
  });

  it('stop() 抛错时向上抛出，不吞掉', async () => {
    const { rec } = makeRecorder('recording', 'throw');
    await expect(stopMediaRecorder(rec)).rejects.toThrow('InvalidStateError');
  });

  it('事件永不到来时按超时判失败，绝不静默交出截断文件', async () => {
    vi.useFakeTimers();
    try {
      const { rec } = makeRecorder('recording', 'silent');
      const p = stopMediaRecorder(rec, 1000);
      const assertion = expect(p).rejects.toThrow('封装超时');
      await vi.advanceTimersByTimeAsync(1001);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });

  it('默认超时为 8 秒', () => {
    expect(EXPORT_STOP_TIMEOUT_MS).toBe(8000);
  });

  it('收尾后摘掉监听，避免重复触发与持有引用', async () => {
    const { rec, raw } = makeRecorder('recording', 'emit');
    await stopMediaRecorder(rec);
    expect(raw.onstop).toBeNull();
    expect(raw.onerror).toBeNull();
  });

  it('异步派发 onstop 也能收到', async () => {
    const { rec, raw } = makeRecorder('recording', 'silent');
    const p = stopMediaRecorder(rec);
    raw.onstop?.();
    await expect(p).resolves.toBeUndefined();
  });
});

describe('computeFrameDelay：逐帧墙钟对齐', () => {
  it('渲染快于实时：补足到该帧应在的真实时刻', () => {
    // 30fps，第 0 帧应在 33.33ms 处；当前才 10ms → 还需等 23.33ms
    expect(computeFrameDelay(1000, 0, 30, 1010)).toBeCloseTo(1000 + 1000 / 30 - 1010, 6);
  });

  it('正好到点：不等待', () => {
    expect(computeFrameDelay(0, 29, 30, 1000)).toBe(0);
  });

  it('渲染落后于实时：返回 0，不出现负数 setTimeout', () => {
    expect(computeFrameDelay(0, 0, 30, 5000)).toBe(0);
  });

  it('帧序号递增对应线性时刻', () => {
    expect(computeFrameDelay(0, 0, 10, 0)).toBe(100);
    expect(computeFrameDelay(0, 9, 10, 0)).toBe(1000);
  });

  it('fps 非法（0/负数/NaN/Infinity）时返回 0，不产生 NaN 等待', () => {
    expect(computeFrameDelay(0, 0, 0, 0)).toBe(0);
    expect(computeFrameDelay(0, 0, -30, 0)).toBe(0);
    expect(computeFrameDelay(0, 0, NaN, 0)).toBe(0);
    expect(computeFrameDelay(0, 0, Infinity, 0)).toBe(0);
  });
});

describe('describeAudioTrackFailure：音轨失败归因', () => {
  it('三类来源各有可读名词，并带上素材名与原因', () => {
    const err = new Error('解码失败');
    expect(describeAudioTrackFailure('clip', '片段一', err)).toBe('片段原声「片段一」未能加入导出音轨：解码失败');
    expect(describeAudioTrackFailure('bgm', 'music.mp3', err)).toBe('背景音乐「music.mp3」未能加入导出音轨：解码失败');
    expect(describeAudioTrackFailure('dub', '配音 2', err)).toBe('配音「配音 2」未能加入导出音轨：解码失败');
  });

  it('非 Error 抛出物也能归因，不显示 [object Object]', () => {
    expect(describeAudioTrackFailure('clip', 'a', '网络中断')).toContain('网络中断');
    expect(describeAudioTrackFailure('clip', 'a', undefined)).toContain('undefined');
  });

  it('素材名为空时兜底，不出现空引号', () => {
    expect(describeAudioTrackFailure('clip', '', new Error('x'))).toContain('「未命名」');
  });
});