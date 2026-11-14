/**
 * 下载历史写入去抖/去重单测（P1-2 回归）。
 * 覆盖：同 ID 同内容不触发 storage 写入、内容变化才写、
 * 窗口内多次变更合并为一次全量写、flushHistorySave 立即冲刷。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/** 模拟 chrome.storage.local 的底层数据 */
let store: Record<string, unknown>;
/** storage.local.set 调用桩（用于计数写入次数） */
let setMock: ReturnType<typeof vi.fn>;

beforeEach(async () => {
  vi.resetModules();
  vi.useFakeTimers();
  store = {};
  setMock = vi.fn(async (obj: Record<string, unknown>) => { Object.assign(store, obj); });
  vi.stubGlobal('chrome', {
    storage: {
      local: {
        // Promise 风格（downloadHistory.ts 用法）：回空对象 → 无历史、无旧版数据
        get: vi.fn(async () => ({})),
        set: setMock,
        remove: vi.fn(async () => {})
      }
    }
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** 装载历史模块并完成初始化加载 */
async function boot() {
  const mod = await import('@/sidepanel/services/downloadHistory');
  await mod.loadHistory();
  return mod;
}

/** 一条失败记录的基础负载（同 ID 复用） */
function failedRecord(error: string, size = 100) {
  return { id: 'task-1', url: 'https://example.com/a.bin', filename: 'a.bin', kind: 'video' as const, status: 'failed' as const, error, size };
}

describe('downloadHistory：去抖 + 同内容去重（P1-2）', () => {
  it('新记录进入防抖窗口，窗口内多次变更只触发一次全量写入', async () => {
    const mod = await boot();
    await mod.addHistoryRecord(failedRecord('err-1'));
    await mod.addHistoryRecord({ ...failedRecord('err-1'), id: 'task-2', url: 'https://example.com/b.bin' });
    // 防抖窗口未到期：尚未写 storage
    expect(setMock).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(700);
    // 两条变更合并为一次 set
    expect(setMock).toHaveBeenCalledTimes(1);
    expect(mod.getHistoryCount()).toBe(2);
  });

  it('同 ID 且内容等价的重复记录直接跳过，不产生任何写入', async () => {
    const mod = await boot();
    await mod.addHistoryRecord(failedRecord('err-1'));
    await vi.advanceTimersByTimeAsync(700);
    expect(setMock).toHaveBeenCalledTimes(1);
    // 快照重复推送同一终态（同 id 同内容）→ 应完全跳过
    await mod.addHistoryRecord(failedRecord('err-1'));
    await vi.advanceTimersByTimeAsync(700);
    expect(setMock).toHaveBeenCalledTimes(1);
  });

  it('同 ID 内容变化（重试后再次失败）→ 更新字段并保留首次时间戳、触发新写入', async () => {
    const mod = await boot();
    await mod.addHistoryRecord(failedRecord('err-1'));
    await vi.advanceTimersByTimeAsync(700);
    const first = (store['global_download_history_v2'] as any[])[0];
    await mod.addHistoryRecord(failedRecord('err-2', 200));
    await vi.advanceTimersByTimeAsync(700);
    expect(setMock).toHaveBeenCalledTimes(2);
    const list = store['global_download_history_v2'] as any[];
    expect(list).toHaveLength(1); // 同 ID 不重复插入
    expect(list[0].error).toBe('err-2');
    expect(list[0].size).toBe(200);
    expect(list[0].timestamp).toBe(first.timestamp); // 首次落定时间保留
  });

  it('flushHistorySave 取消在途防抖并立即落盘', async () => {
    const mod = await boot();
    await mod.addHistoryRecord(failedRecord('err-1'));
    // 未到期先冲刷：立即写一次，且原防抖不会二次写入
    await mod.flushHistorySave();
    expect(setMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(setMock).toHaveBeenCalledTimes(1);
  });
});
