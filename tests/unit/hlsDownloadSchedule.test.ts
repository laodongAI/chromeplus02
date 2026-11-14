/**
 * HLS 下载调度纯逻辑单测（P0-1 回归）。
 * 覆盖：初始化段参与下载顺序、断点续传跳过判定、进度下标口径。
 */
import { describe, it, expect } from 'vitest';
import {
  computeHaveIndices,
  buildPendingIndices,
  HLS_INIT_INDEX,
  type HlsTaskMeta
} from '@/background/hls';

/** 构造最小可用的任务元数据（默认 2 个分片、无初始化段） */
function makeMeta(overrides: Partial<HlsTaskMeta> = {}): HlsTaskMeta {
  return {
    playlistUrl: 'https://example.com/index.m3u8',
    segments: ['https://example.com/a.m4s', 'https://example.com/b.m4s'],
    sequences: [0, 1],
    byteranges: [undefined, undefined],
    mergeType: 'fmp4',
    segTotal: 2,
    ...overrides
  };
}

describe('computeHaveIndices：断点续传已存在下标解析', () => {
  it('识别数字分片键与 init 键（init 映射为哨兵下标 -1）', () => {
    const keys = ['t1:0', 't1:1', 't1:init', 't2:0', 't1:abc'];
    const have = computeHaveIndices('t1', keys);
    expect(have.has(0)).toBe(true);
    expect(have.has(1)).toBe(true);
    expect(have.has(HLS_INIT_INDEX)).toBe(true);
    // 其他任务的键与非法后缀不应混入
    expect(have.has(2)).toBe(false);
    expect(have.size).toBe(3);
  });

  it('空集合：全新任务没有任何已下载数据', () => {
    expect(computeHaveIndices('t1', []).size).toBe(0);
  });

  // ===== 收口轮补充：前缀隔离与非法后缀边界 =====
  it('任务前缀隔离：t1 不误收 t10 的键（数字前缀重叠场景）', () => {
    const have = computeHaveIndices('t1', ['t10:0', 't10:1', 't10:init']);
    expect(have.size).toBe(0);
  });

  it('init 键大小写敏感：INIT 后缀不视为初始化段', () => {
    // 键空间由本模块自写自读（小写 init），大写变体按非法后缀忽略
    const have = computeHaveIndices('t1', ['t1:INIT']);
    expect(have.has(HLS_INIT_INDEX)).toBe(false);
    expect(have.size).toBe(0);
  });

  it('乱码后缀不产生下标', () => {
    const have = computeHaveIndices('t1', ['t1:x1', 't1:1_5']);
    expect(have.size).toBe(0);
  });
});

describe('buildPendingIndices：边界补充（收口轮）', () => {
  it('无分片但有初始化段：仅产出 init 一项', () => {
    const meta = makeMeta({ segments: [], sequences: [], byteranges: [], segTotal: 0, initSegment: 'https://example.com/init.mp4' });
    expect(buildPendingIndices(meta, new Set<number>())).toEqual([HLS_INIT_INDEX]);
  });

  it('have 含越界历史下标（清单变短）不影响待下载顺序', () => {
    const meta = makeMeta({ initSegment: 'https://example.com/init.mp4' });
    const have = new Set<number>([HLS_INIT_INDEX, 5, 9]);
    expect(buildPendingIndices(meta, have)).toEqual([0, 1]);
  });
});

describe('buildPendingIndices：初始化段参与下载顺序（P0-1 核心）', () => {
  it('有初始化段且未下载时，init 恒排在待下载队首', () => {
    const meta = makeMeta({ initSegment: 'https://example.com/init.mp4' });
    const pending = buildPendingIndices(meta, new Set<number>());
    expect(pending[0]).toBe(HLS_INIT_INDEX);
    expect(pending).toEqual([HLS_INIT_INDEX, 0, 1]);
  });

  it('初始化段已下载（断点续传）时跳过 init，只补缺失分片', () => {
    const meta = makeMeta({ initSegment: 'https://example.com/init.mp4' });
    const have = new Set<number>([HLS_INIT_INDEX, 0]);
    const pending = buildPendingIndices(meta, have);
    expect(pending).toEqual([1]);
  });

  it('无初始化段（TS 流）时不产生 init 下载项', () => {
    const meta = makeMeta();
    const pending = buildPendingIndices(meta, new Set<number>());
    expect(pending).toEqual([0, 1]);
    expect(pending).not.toContain(HLS_INIT_INDEX);
  });

  it('全部已下载时待下载列表为空（合并直接走缓存）', () => {
    const meta = makeMeta({ initSegment: 'https://example.com/init.mp4' });
    const have = new Set<number>([HLS_INIT_INDEX, 0, 1]);
    expect(buildPendingIndices(meta, have)).toEqual([]);
  });
});
