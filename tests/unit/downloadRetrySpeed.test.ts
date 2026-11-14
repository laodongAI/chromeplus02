/**
 * 后台下载模块重试与测速单测（收口轮 P1-9，补齐 P0-5 之外的两块）：
 *  - speedBps 滑动窗口计算：冷启动回退累计平均 → 窗口斜率 → ETA 推导；
 *  - resetTaskForRetry：error 任务重试后字段复位、retries 递增、测速窗口清空。
 * 手法：最小 chrome 桩 + fake timers 控制采样时刻；通过 DOWNLOAD_PROGRESS_EVENT
 * 广播（chrome.runtime.sendMessage 桩捕获）观察后台计算结果，不改主逻辑。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MessageType } from '@/messaging';

/** bus 注册的 onMessage 监听器 */
let messageListener: ((msg: any, sender: any, sendResponse: (r: any) => void) => boolean | void) | null;
/** chrome.downloads.onChanged 监听器（attachProgressEvents 注入） */
let downloadsChangedListener: ((delta: any) => void) | null;
/** 捕获 runtime.sendMessage 广播（进度事件/快照都走这里） */
let broadcasts: any[];

/** 同步派发 bus 消息并取回应答 */
function dispatch(msg: any): any {
  let resp: any;
  messageListener!(msg, {}, (r: any) => { resp = r; });
  return resp;
}

/** 取最近一条指定类型的广播负载 */
function lastBroadcast(type: string): any {
  for (let i = broadcasts.length - 1; i >= 0; i--) {
    if (broadcasts[i]?.type === type) return broadcasts[i];
  }
  return undefined;
}

const T0 = 1_000_000; // 基准系统时间（毫秒，任意固定值）

beforeEach(async () => {
  vi.resetModules();
  vi.useFakeTimers();
  vi.setSystemTime(T0);
  messageListener = null;
  downloadsChangedListener = null;
  broadcasts = [];
  vi.stubGlobal('chrome', {
    runtime: {
      lastError: undefined,
      onMessage: { addListener: vi.fn((fn: any) => { messageListener = fn; }) },
      sendMessage: vi.fn((msg: any) => { broadcasts.push(msg); return Promise.resolve(); }),
      connectNative: vi.fn()
    },
    storage: {
      local: {
        get: vi.fn((_keys: any, cb?: any) => { if (cb) cb({}); return Promise.resolve({}); }),
        set: vi.fn(() => Promise.resolve()),
        remove: vi.fn(() => Promise.resolve())
      }
    },
    downloads: {
      onChanged: { addListener: vi.fn((fn: any) => { downloadsChangedListener = fn; }) },
      search: vi.fn((_q: any, cb: any) => cb([])),
      // 立即回调固定 downloadId=7：任务进入"已发起浏览器下载"状态
      download: vi.fn((_opts: any, cb: any) => { if (cb) cb(7); }),
      cancel: vi.fn(),
      pause: vi.fn(),
      resume: vi.fn()
    },
    alarms: {
      onAlarm: { addListener: vi.fn() },
      create: vi.fn(),
      clear: vi.fn()
    }
  });
  const { initMessageBus } = await import('@/background/bus');
  const { initDownloadsMessageHandler } = await import('@/background/downloads');
  initMessageBus();
  initDownloadsMessageHandler();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('speedBps：滑动窗口测速（P1-2 收口补测）', () => {
  it('冷启动首样本回退累计平均；窗口成形后按斜率计算并推导 ETA', async () => {
    const add = dispatch({ type: MessageType.DOWNLOAD_QUEUE_ACTION, action: 'add', task: { url: 'https://example.com/speed.bin' } });
    expect(add.success).toBe(true);
    // 冲刷 runTask 的微任务（startDownload 回调置 downloadId）
    await vi.advanceTimersByTimeAsync(0);

    // t=+1s：首个字节样本 → 窗口只有 1 点，回退累计平均 = 1000B / 1s
    await vi.advanceTimersByTimeAsync(1000);
    downloadsChangedListener!({ id: 7, bytesReceived: { current: 1000 }, totalBytes: { current: 10000 } });
    let evt = lastBroadcast(MessageType.DOWNLOAD_PROGRESS_EVENT);
    expect(evt.speedBps).toBeCloseTo(1000, 0);
    expect(evt.etaSeconds).toBe(9); // (10000-1000)/1000
    expect(evt.progress).toBeCloseTo(0.1, 5);

    // t=+2s：第二样本 → 窗口 2 点，斜率 = (4000-1000)/1s = 3000B/s
    await vi.advanceTimersByTimeAsync(1000);
    downloadsChangedListener!({ id: 7, bytesReceived: { current: 4000 } });
    evt = lastBroadcast(MessageType.DOWNLOAD_PROGRESS_EVENT);
    expect(evt.speedBps).toBeCloseTo(3000, 0);
    expect(evt.etaSeconds).toBe(2); // (10000-4000)/3000
  });

  it('未知总长（无 totalBytes）时不上报 ETA', async () => {
    dispatch({ type: MessageType.DOWNLOAD_QUEUE_ACTION, action: 'add', task: { url: 'https://example.com/nolen.bin' } });
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(1000);
    downloadsChangedListener!({ id: 7, bytesReceived: { current: 2000 } });
    const evt = lastBroadcast(MessageType.DOWNLOAD_PROGRESS_EVENT);
    expect(evt.etaSeconds).toBeUndefined();
  });
});

describe('resetTaskForRetry：重试前字段复位（P1-9 收口补测）', () => {
  it('error 任务 retry 后回到 pending、retries+1、测速/错误字段清空并重新发起下载', async () => {
    const add = dispatch({ type: MessageType.DOWNLOAD_QUEUE_ACTION, action: 'add', task: { url: 'https://example.com/fail.bin' } });
    await vi.advanceTimersByTimeAsync(0);
    expect(chrome.downloads.download).toHaveBeenCalledTimes(1);

    // 模拟浏览器下载中断 → 任务进入 error（NETWORK 分类，触发自动重试调度）
    await vi.advanceTimersByTimeAsync(1000);
    downloadsChangedListener!({ id: 7, bytesReceived: { current: 500 }, state: { current: 'interrupted' }, error: { current: 'net::ERR_NETWORK_CHANGED' } });
    let snap = dispatch({ type: MessageType.DOWNLOAD_QUEUE_SNAPSHOT });
    let task = snap.tasks.find((t: any) => t.id === add.id);
    expect(task.status).toBe('error');
    expect(task.errorCode).toBe('NETWORK');
    expect(task.speedBps).toBeGreaterThan(0); // 中断前已有测速样本

    // 手动重试：resetTaskForRetry 应清空错误/进度/测速字段并递增 retries
    dispatch({ type: MessageType.DOWNLOAD_QUEUE_ACTION, action: 'retry', id: add.id });
    snap = dispatch({ type: MessageType.DOWNLOAD_QUEUE_SNAPSHOT });
    task = snap.tasks.find((t: any) => t.id === add.id);
    expect(task.retries).toBe(1);
    expect(task.error).toBeUndefined();
    expect(task.errorCode).toBeUndefined();
    expect(task.progress).toBe(0);
    expect(task.downloadId).toBeUndefined();
    // retry 后 drain 立即重跑：任务回到 running 并再次发起浏览器下载
    expect(task.status === 'pending' || task.status === 'running').toBe(true);
    expect(chrome.downloads.download).toHaveBeenCalledTimes(2);
  });

  it('非 error/canceled 状态的任务 retry 不生效（防误重置在途下载）', async () => {
    const add = dispatch({ type: MessageType.DOWNLOAD_QUEUE_ACTION, action: 'add', task: { url: 'https://example.com/keep.bin' } });
    await vi.advanceTimersByTimeAsync(0);
    dispatch({ type: MessageType.DOWNLOAD_QUEUE_ACTION, action: 'retry', id: add.id });
    const snap = dispatch({ type: MessageType.DOWNLOAD_QUEUE_SNAPSHOT });
    const task = snap.tasks.find((t: any) => t.id === add.id);
    expect(task.status).toBe('running'); // 仍在途，未被重置
    expect(task.retries).toBe(0);
  });
});

describe('浏览器侧取消：不得进入自动重试', () => {
  it('USER_CANCELED 归入 canceled，不安排重试闹钟也不重新发起下载', async () => {
    const add = dispatch({ type: MessageType.DOWNLOAD_QUEUE_ACTION, action: 'add', task: { url: 'https://example.com/cancel.bin' } });
    await vi.advanceTimersByTimeAsync(0);
    expect(chrome.downloads.download).toHaveBeenCalledTimes(1);

    // 用户在 Chrome 下载界面取消：任务此时仍是 running，走不到 canceled 前置守卫
    downloadsChangedListener!({ id: 7, state: { current: 'interrupted' }, error: { current: 'USER_CANCELED' } });
    const snap = dispatch({ type: MessageType.DOWNLOAD_QUEUE_SNAPSHOT });
    const task = snap.tasks.find((t: any) => t.id === add.id);
    expect(task.status).toBe('canceled');
    expect(task.error).toBeUndefined();
    expect(task.errorCode).toBeUndefined();
    expect(chrome.alarms.create).not.toHaveBeenCalled();

    // 越过自动重试延迟窗口（1200~2000ms）后仍不应被重新拉起
    await vi.advanceTimersByTimeAsync(5000);
    expect(chrome.downloads.download).toHaveBeenCalledTimes(1);
  });

  it('对照：网络类中断仍分类为 NETWORK 并安排自动重试', async () => {
    dispatch({ type: MessageType.DOWNLOAD_QUEUE_ACTION, action: 'add', task: { url: 'https://example.com/failed.bin' } });
    await vi.advanceTimersByTimeAsync(0);
    downloadsChangedListener!({ id: 7, state: { current: 'interrupted' }, error: { current: 'NETWORK_FAILED' } });
    const snap = dispatch({ type: MessageType.DOWNLOAD_QUEUE_SNAPSHOT });
    expect(snap.tasks[0].status).toBe('error');
    expect(snap.tasks[0].errorCode).toBe('NETWORK');
    expect(chrome.alarms.create).toHaveBeenCalledTimes(1);
  });
});
