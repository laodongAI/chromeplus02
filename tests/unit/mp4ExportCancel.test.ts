/**
 * WebCodecs 导出引擎的取消与降级告警单测。
 *
 * 被测不变量：
 *  - 取消必须真的中断（不再跑完剩余帧），且无论在哪一步中断都要关闭编码器，
 *    否则用户连续取消几次后硬件会话泄漏，再也开不了新导出；
 *  - 混音期间的取消不能被 catch 当成"降级无声"吞掉后继续编码整条视频；
 *  - 成片无声的每一条降级路径都要经 onWarning 告知调用方，不能只写日志。
 * 手法：VideoEncoder/VideoFrame/AudioEncoder/document 与 vendored muxer 全部打桩。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { exportMp4, encodeAudioBufferToMuxer, type Mp4ExportJob } from '@/core/mp4Export';

const muxerState = vi.hoisted(() => ({ constructed: 0, finalized: 0 }));

vi.mock('@/vendor/mp4-muxer.mjs', () => ({
  Muxer: class {
    constructor() { muxerState.constructed++; }
    addVideoChunk() { /* noop */ }
    addAudioChunk() { /* noop */ }
    finalize() { muxerState.finalized++; }
  },
  ArrayBufferTarget: class { buffer = new ArrayBuffer(16); },
}));

/** 视频编码器替身：记录构造/关闭次数，用于断言无泄漏 */
class FakeVideoEncoder {
  static all: FakeVideoEncoder[] = [];
  static reset() { FakeVideoEncoder.all = []; }
  state = 'unconfigured';
  encodeQueueSize = 0;
  closeCount = 0;
  encoded = 0;
  constructor() { FakeVideoEncoder.all.push(this); }
  configure() { this.state = 'configured'; }
  encode() { this.encoded++; }
  async flush() { /* noop */ }
  close() { this.closeCount++; this.state = 'closed'; }
}

class FakeVideoFrame {
  closed = 0;
  constructor() { /* noop */ }
  close() { this.closed++; }
}

class FakeAudioEncoder {
  static all: FakeAudioEncoder[] = [];
  static reset() { FakeAudioEncoder.all = []; }
  closeCount = 0;
  encoded = 0;
  constructor() { FakeAudioEncoder.all.push(this); }
  configure() { /* noop */ }
  encode() { this.encoded++; }
  async flush() { /* noop */ }
  close() { this.closeCount++; }
}

class FakeAudioData {
  closed = 0;
  constructor() { /* noop */ }
  close() { this.closed++; }
}

/** 造一个最小可用的 AudioBuffer 替身（单声道 48kHz） */
function makeAudioBuffer(length = 9600): AudioBuffer {
  const data = new Float32Array(length);
  return {
    length,
    sampleRate: 48000,
    numberOfChannels: 1,
    duration: length / 48000,
    getChannelData: () => data,
  } as unknown as AudioBuffer;
}

/** 造一个最小导出任务；drawFrame 记录被调用的时间点 */
function makeJob(overrides: Partial<Mp4ExportJob> = {}): Mp4ExportJob {
  return {
    width: 64, height: 64, fps: 10, durationSec: 0.5,
    drawFrame: () => { /* noop */ },
    ...overrides,
  };
}

beforeEach(() => {
  FakeVideoEncoder.reset();
  FakeAudioEncoder.reset();
  muxerState.constructed = 0;
  muxerState.finalized = 0;
  vi.stubGlobal('VideoEncoder', FakeVideoEncoder);
  vi.stubGlobal('VideoFrame', FakeVideoFrame);
  vi.stubGlobal('document', { createElement: () => ({ width: 0, height: 0 }) });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('exportMp4：正常路径', () => {
  it('无取消信号时跑完全部帧并关闭编码器', async () => {
    const drawn: number[] = [];
    const blob = await exportMp4(makeJob({ drawFrame: (_c, t) => { drawn.push(t); } }));
    expect(blob.type).toBe('video/mp4');
    expect(blob.size).toBe(16);
    // durationSec 0.5 × fps 10 = 5 帧
    expect(drawn).toHaveLength(5);
    expect(muxerState.finalized).toBe(1);
    expect(FakeVideoEncoder.all).toHaveLength(1);
    expect(FakeVideoEncoder.all[0].closeCount).toBe(1);
    expect(FakeVideoEncoder.all[0].encoded).toBe(5);
  });
});

describe('exportMp4：取消', () => {
  it('信号已 abort 时立即中断，连混音都不开始', async () => {
    const ac = new AbortController();
    ac.abort();
    const mixAudio = vi.fn(async () => null);
    const err = await exportMp4(makeJob({ signal: ac.signal, mixAudio })).catch((e: unknown) => e);
    expect((err as Error).name).toBe('AbortError');
    expect(mixAudio).not.toHaveBeenCalled();
    expect(FakeVideoEncoder.all).toHaveLength(0);
    expect(muxerState.constructed).toBe(0);
  });

  it('渲染中途取消：不再跑剩余帧，且编码器仍被关闭', async () => {
    const ac = new AbortController();
    let calls = 0;
    const err = await exportMp4(makeJob({
      signal: ac.signal,
      durationSec: 10, // 100 帧，取消后绝不该跑完
      drawFrame: () => { calls++; if (calls === 3) ac.abort(); },
    })).catch((e: unknown) => e);

    expect((err as Error).name).toBe('AbortError');
    expect(calls).toBe(3);
    expect(FakeVideoEncoder.all).toHaveLength(1);
    expect(FakeVideoEncoder.all[0].closeCount).toBe(1);
    // 已取消的导出不得产出文件
    expect(muxerState.finalized).toBe(0);
  });

  it('混音期间取消：不能被当成"降级无声"吞掉后继续编码', async () => {
    const ac = new AbortController();
    const warnings: string[] = [];
    const err = await exportMp4(makeJob({
      signal: ac.signal,
      onWarning: (t) => warnings.push(t),
      mixAudio: async () => { ac.abort(); return makeAudioBuffer(); },
    })).catch((e: unknown) => e);

    expect((err as Error).name).toBe('AbortError');
    expect(FakeVideoEncoder.all).toHaveLength(0);
    expect(warnings).toEqual([]);
  });

  it('连续取消多次不泄漏编码器（每次构造都对应一次关闭）', async () => {
    for (let i = 0; i < 3; i++) {
      const ac = new AbortController();
      let calls = 0;
      await exportMp4(makeJob({
        signal: ac.signal,
        drawFrame: () => { if (++calls === 2) ac.abort(); },
      })).catch(() => { /* 预期的 AbortError */ });
    }
    expect(FakeVideoEncoder.all).toHaveLength(3);
    expect(FakeVideoEncoder.all.map(e => e.closeCount)).toEqual([1, 1, 1]);
  });
});

describe('exportMp4：无声降级必须告警', () => {
  it('混音抛错时经 onWarning 告知，并仍产出无声视频', async () => {
    const warnings: string[] = [];
    const blob = await exportMp4(makeJob({
      onWarning: (t) => warnings.push(t),
      mixAudio: async () => { throw new Error('混音上下文创建失败'); },
    }));
    expect(blob.size).toBeGreaterThan(0);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('无声视频');
    expect(warnings[0]).toContain('混音上下文创建失败');
  });

  it('环境缺少 AudioEncoder 时告知用户本次无声，而不是静默丢弃音轨', async () => {
    const warnings: string[] = [];
    // node 环境本就无 AudioEncoder 全局，走的正是旧 Chrome 的降级分支
    const blob = await exportMp4(makeJob({
      onWarning: (t) => warnings.push(t),
      mixAudio: async () => makeAudioBuffer(),
    }));
    expect(blob.size).toBeGreaterThan(0);
    expect(warnings.some(w => w.includes('AudioEncoder'))).toBe(true);
    expect(FakeAudioEncoder.all).toHaveLength(0);
  });
});

describe('encodeAudioBufferToMuxer：取消', () => {
  it('信号已 abort 时不编码任何块，但仍关闭音频编码器', async () => {
    vi.stubGlobal('AudioEncoder', FakeAudioEncoder);
    vi.stubGlobal('AudioData', FakeAudioData);
    const ac = new AbortController();
    ac.abort();
    const addChunk = vi.fn();
    const err = await encodeAudioBufferToMuxer(makeAudioBuffer(), addChunk, undefined, ac.signal)
      .catch((e: unknown) => e);
    expect((err as Error).name).toBe('AbortError');
    expect(addChunk).not.toHaveBeenCalled();
    expect(FakeAudioEncoder.all).toHaveLength(1);
    expect(FakeAudioEncoder.all[0].encoded).toBe(0);
    expect(FakeAudioEncoder.all[0].closeCount).toBe(1);
  });

  it('无信号时按 100ms 分块编码并逐块上报进度', async () => {
    vi.stubGlobal('AudioEncoder', FakeAudioEncoder);
    vi.stubGlobal('AudioData', FakeAudioData);
    const progress: number[] = [];
    // 9600 采样帧 = 2 个 4800 帧块
    await encodeAudioBufferToMuxer(makeAudioBuffer(9600), () => { /* noop */ }, (r) => progress.push(r));
    expect(FakeAudioEncoder.all[0].encoded).toBe(2);
    expect(progress).toEqual([0.5, 1]);
    expect(FakeAudioEncoder.all[0].closeCount).toBe(1);
  });
});