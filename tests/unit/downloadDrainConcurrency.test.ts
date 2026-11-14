/**
 * 后台下载队列 drain 并发填充单测（P0-5 回归）。
 * 手法：以最小 chrome 桩驱动真实的 bus + downloads 模块，
 * 通过 DOWNLOAD_QUEUE_ACTION/DOWNLOAD_QUEUE_SNAPSHOT 消息观察队列调度结果。
 * chrome.downloads.download 故意不回调，模拟"下载进行中"，任务保持 running。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MessageType } from '@/messaging';

/** 当前测试的 chrome 桩实例（每个用例重建，保证模块级队列状态隔离） */
let chromeStub: any;
/** bus 注册的 onMessage 监听器（由 initMessageBus 注入） */
let messageListener: ((msg: any, sender: any, sendResponse: (r: any) => void) => boolean | void) | null;

/** 通过 bus 监听器同步派发一条消息并取回响应 */
function dispatch(msg: any): any {
  let resp: any;
  messageListener!(msg, {}, (r: any) => { resp = r; });
  return resp;
}

beforeEach(async () => {
  vi.resetModules();
  messageListener = null;
  chromeStub = {
    runtime: {
      lastError: undefined,
      onMessage: { addListener: vi.fn((fn: any) => { messageListener = fn; }) },
      // 广播型消息：MV3 下返回 Promise，桩直接 resolve
      sendMessage: vi.fn(() => Promise.resolve()),
      connectNative: vi.fn()
    },
    storage: {
      local: {
        // 回调风格（downloads.ts 用法）：一律回空对象 → 无持久化队列/无自定义并发设置
        get: vi.fn((_keys: any, cb?: any) => { if (cb) cb({}); return Promise.resolve({}); }),
        set: vi.fn(() => Promise.resolve()),
        remove: vi.fn(() => Promise.resolve())
      }
    },
    downloads: {
      onChanged: { addListener: vi.fn() },
      search: vi.fn((_q: any, cb: any) => cb([])),
      // 关键桩：不回调 = 浏览器下载一直进行中，用于观察并发槽位占用
      download: vi.fn(),
      cancel: vi.fn(),
      pause: vi.fn(),
      resume: vi.fn()
    },
    alarms: {
      onAlarm: { addListener: vi.fn() },
      create: vi.fn(),
      clear: vi.fn()
    }
  };
  vi.stubGlobal('chrome', chromeStub);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

/** 装载真实的 bus + downloads 模块（chrome 桩必须先就位） */
async function boot() {
  const { initMessageBus } = await import('@/background/bus');
  const { initDownloadsMessageHandler } = await import('@/background/downloads');
  initMessageBus();
  initDownloadsMessageHandler();
}

describe('drain：并发额度填满（P0-5）', () => {
  it('一次入队 5 个任务时，默认并发 3 应同时启动 3 个而非 1 个', async () => {
    await boot();
    for (let i = 0; i < 5; i++) {
      const resp = dispatch({
        type: MessageType.DOWNLOAD_QUEUE_ACTION,
        action: 'add',
        task: { url: `https://example.com/f${i}.bin` }
      });
      expect(resp.success).toBe(true);
    }
    // 结构性断言：3 个 running + 2 个 pending（旧实现只有 1 个 running）
    const snap = dispatch({ type: MessageType.DOWNLOAD_QUEUE_SNAPSHOT });
    const running = snap.tasks.filter((t: any) => t.status === 'running').length;
    const pending = snap.tasks.filter((t: any) => t.status === 'pending').length;
    expect(running).toBe(3);
    expect(pending).toBe(2);
    // 行为断言：chrome.downloads.download 恰好被调用 3 次
    expect(chromeStub.downloads.download).toHaveBeenCalledTimes(3);
  });

  it('全局暂停期间不启动新任务；resume_all 后一次性填满空闲槽位', async () => {
    await boot();
    dispatch({ type: MessageType.DOWNLOAD_QUEUE_ACTION, action: 'pause_all' });
    for (let i = 0; i < 4; i++) {
      dispatch({ type: MessageType.DOWNLOAD_QUEUE_ACTION, action: 'add', task: { url: `https://example.com/p${i}.bin` } });
    }
    // 暂停中：0 个下载被启动，全部 pending
    expect(chromeStub.downloads.download).toHaveBeenCalledTimes(0);
    let snap = dispatch({ type: MessageType.DOWNLOAD_QUEUE_SNAPSHOT });
    expect(snap.tasks.every((t: any) => t.status === 'pending')).toBe(true);
    // 恢复：drain 循环应把 3 个槽位一次填满（旧实现只启动 1 个）
    dispatch({ type: MessageType.DOWNLOAD_QUEUE_ACTION, action: 'resume_all' });
    expect(chromeStub.downloads.download).toHaveBeenCalledTimes(3);
    snap = dispatch({ type: MessageType.DOWNLOAD_QUEUE_SNAPSHOT });
    expect(snap.tasks.filter((t: any) => t.status === 'running').length).toBe(3);
    expect(snap.tasks.filter((t: any) => t.status === 'pending').length).toBe(1);
  });

  it('SETTINGS_UPDATE 提高并发后，剩余 pending 立即补满', async () => {
    await boot();
    for (let i = 0; i < 5; i++) {
      dispatch({ type: MessageType.DOWNLOAD_QUEUE_ACTION, action: 'add', task: { url: `https://example.com/s${i}.bin` } });
    }
    expect(chromeStub.downloads.download).toHaveBeenCalledTimes(3);
    // 并发调到 5：applySettings 内部会再 drain，把剩余 2 个补满
    dispatch({ type: MessageType.SETTINGS_UPDATE, payload: { maxConcurrent: 5 } });
    expect(chromeStub.downloads.download).toHaveBeenCalledTimes(5);
    const snap = dispatch({ type: MessageType.DOWNLOAD_QUEUE_SNAPSHOT });
    expect(snap.tasks.every((t: any) => t.status === 'running')).toBe(true);
  });
});
