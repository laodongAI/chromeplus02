/**
 * 录屏 store 与下载条收尾逻辑单测（UI 第一批改进）。
 * 覆盖：
 *  1. recordingStore.computeElapsedMs —— 计时与暂停累计的纯计算
 *     （含 P1-10 修复语义：扣除累计暂停、暂停中冻结、非负兜底）；
 *  2. recordingStore.formatTimerDisplay —— 全局角标/面板共用计时文本（mm:ss 与 hh:mm:ss）；
 *  3. downloadQueue.isQueueSettled —— 全局下载条"可关闭/可跳转"的判定条件
 *     （评审 P1：仅当无 pending/running/paused 时才算落定）。
 * 手法：downloadQueue 仅测纯函数，其依赖模块（IndexedDB 交接/历史记录）按
 * 既有测试惯例 vi.mock 隔离，避免 node 环境触碰浏览器 API。
 */
import { describe, it, expect, vi } from 'vitest';

// ===== 模块隔离：downloadQueue 的副作用依赖打桩（与 downloadQueueSnapshot.test.ts 同法） =====
vi.mock('@/sidepanel/services/hlsBlobDownload', () => ({
  ensureHlsBlobDownloadListener: vi.fn()
}));
vi.mock('@/sidepanel/services/downloadHistory', () => ({
  addHistoryRecord: vi.fn()
}));

// 录屏 store 的纯计算函数（导入不触发浏览器 API：模块级仅声明状态与函数）
import { computeElapsedMs, formatTimerDisplay } from '@/sidepanel/services/recordingStore';
import { isQueueSettled, type DownloadTask } from '@/sidepanel/services/downloadQueue';

/** 构造一条最小可用的下载任务（仅 status 参与被测逻辑） */
function makeTask(status: DownloadTask['status']): DownloadTask {
  return { id: `t_${status}_${Math.random().toString(36).slice(2, 6)}`, url: 'https://example.com/a.bin', kind: 'video', status };
}

describe('recordingStore.computeElapsedMs（计时与暂停累计）', () => {
  it('未暂停时 = 当前时刻 - 开始时刻', () => {
    // 开始于 1000ms，当前 61000ms → 已录 60000ms
    expect(computeElapsedMs(61_000, 1_000, 0, 0)).toBe(60_000);
  });

  it('扣除历次暂停的累计时长（P1-10 修复语义）', () => {
    // 总经过 60s，其中累计暂停 15s → 实际录像 45s
    expect(computeElapsedMs(61_000, 1_000, 15_000, 0)).toBe(45_000);
  });

  it('处于暂停中：冻结在暂停起点，当前这段暂停不计入', () => {
    // 开始 1000ms，暂停起点 30000ms，当前 61000ms → 显示冻结在 29000ms
    expect(computeElapsedMs(61_000, 1_000, 0, 30_000)).toBe(29_000);
    // 同时存在历史累计与当前暂停段：先扣历史累计，再冻结到暂停起点
    expect(computeElapsedMs(61_000, 1_000, 5_000, 30_000)).toBe(24_000);
  });

  it('时钟异常回拨等边界：结果非负', () => {
    // now < start（如系统时间回拨）→ 兜底 0，不出现负数计时
    expect(computeElapsedMs(1_000, 5_000, 0, 0)).toBe(0);
    // 累计暂停超过总时长 → 兜底 0
    expect(computeElapsedMs(61_000, 1_000, 99_999, 0)).toBe(0);
  });
});

describe('recordingStore.formatTimerDisplay（角标计时文本）', () => {
  it('不足一小时显示 mm:ss 并补零', () => {
    expect(formatTimerDisplay(0)).toBe('00:00');
    expect(formatTimerDisplay(9)).toBe('00:09');
    expect(formatTimerDisplay(65)).toBe('01:05');
    expect(formatTimerDisplay(3_599)).toBe('59:59');
  });

  it('超过一小时显示 hh:mm:ss', () => {
    expect(formatTimerDisplay(3_600)).toBe('01:00:00');
    expect(formatTimerDisplay(3_661)).toBe('01:01:01');
  });

  it('负数与小数秒：向下取整且非负', () => {
    expect(formatTimerDisplay(-5)).toBe('00:00');
    expect(formatTimerDisplay(59.7)).toBe('00:59');
  });
});

describe('downloadQueue.isQueueSettled（下载条收尾判定）', () => {
  it('空队列视为未落定（下载条隐藏，不显示关闭/跳转入口）', () => {
    expect(isQueueSettled([])).toBe(false);
  });

  it('全部 completed → 落定', () => {
    expect(isQueueSettled([makeTask('completed'), makeTask('completed')])).toBe(true);
  });

  it('completed + error + canceled 混合终态 → 落定（失败任务不阻止收起，✕ 与重试并存）', () => {
    expect(isQueueSettled([makeTask('completed'), makeTask('error'), makeTask('canceled')])).toBe(true);
  });

  it('存在 pending / running / paused 任一进行中状态 → 未落定', () => {
    expect(isQueueSettled([makeTask('completed'), makeTask('pending')])).toBe(false);
    expect(isQueueSettled([makeTask('completed'), makeTask('running')])).toBe(false);
    expect(isQueueSettled([makeTask('completed'), makeTask('paused')])).toBe(false);
  });
});
