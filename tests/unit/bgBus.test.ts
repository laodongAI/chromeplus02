/**
 * 后台消息总线（background/bus.ts）单测（收口轮 P1-9）。
 * 覆盖：注册/分发、同步应答、异步应答（保持通道）、未注册兜底、
 * 无 type 消息忽略、处理器异常兜底、重复注册覆盖、监听器幂等安装。
 * 手法：最小 chrome 桩捕获 onMessage 监听器，直接派发消息观察 sendResponse。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MessageType } from '@/messaging';

/** bus 注册的 onMessage 监听器（由 initMessageBus 注入） */
let messageListener: ((msg: unknown, sender: unknown, sendResponse: (r: unknown) => void) => boolean | void) | null;

/** 派发结果的可变状态：异步应答在 Promise 送达后才写入 */
interface DispatchState { keepOpen: boolean; response: unknown; responded: boolean }

/** 通过监听器派发一条消息；keepOpen 表示通道被保持（异步应答） */
function dispatch(msg: unknown): DispatchState {
  const state: DispatchState = { keepOpen: false, response: undefined, responded: false };
  state.keepOpen = messageListener!(msg, {}, (r: unknown) => { state.response = r; state.responded = true; }) === true;
  return state;
}

/** 冲刷宏/微任务队列，确保 Promise 应答已送达 */
const flush = () => new Promise<void>((r) => setTimeout(r, 0));

beforeEach(() => {
  vi.resetModules();
  messageListener = null;
  vi.stubGlobal('chrome', {
    runtime: {
      lastError: undefined,
      onMessage: { addListener: vi.fn((fn: typeof messageListener) => { messageListener = fn; }) },
      sendMessage: vi.fn(() => Promise.resolve())
    }
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** 装载 bus 并安装监听器 */
async function boot() {
  const mod = await import('@/background/bus');
  mod.initMessageBus();
  return mod;
}

describe('bus：注册与分发', () => {
  it('同步处理器：返回值原样作为应答，通道不保持', async () => {
    const { registerBgHandler } = await boot();
    registerBgHandler(MessageType.WHO_AM_I, (_m, sender) => ({ success: true, tabId: (sender as { tab?: { id?: number } })?.tab?.id }));
    const r = dispatch({ type: MessageType.WHO_AM_I });
    expect(r.keepOpen).toBe(false);
    expect(r.response).toEqual({ success: true, tabId: undefined });
  });

  it('异步处理器：返回 true 保持通道，resolve 值经 sendResponse 送达', async () => {
    const { registerBgHandler } = await boot();
    registerBgHandler(MessageType.COMPANION_STATUS, async () => ({ success: true, online: true }));
    const r = dispatch({ type: MessageType.COMPANION_STATUS });
    expect(r.keepOpen).toBe(true);
    await flush();
    expect(r.response).toEqual({ success: true, online: true });
  });

  it('异步处理器 resolve undefined：兜底为 { success: true }', async () => {
    const { registerBgHandler } = await boot();
    registerBgHandler(MessageType.COMPANION_RECHECK, async () => undefined);
    const r = dispatch({ type: MessageType.COMPANION_RECHECK });
    await flush();
    expect(r.response).toEqual({ success: true });
  });

  it('异步处理器 reject：应答 { success: false, error }', async () => {
    const { registerBgHandler } = await boot();
    registerBgHandler(MessageType.SOURCES_TREE_SCAN, async () => { throw new Error('扫描失败'); });
    const r = dispatch({ type: MessageType.SOURCES_TREE_SCAN });
    await flush();
    expect(r.response).toEqual({ success: false, error: '扫描失败' });
  });

  it('同步处理器抛异常：立即应答 { success: false, error }，通道不保持', async () => {
    const { registerBgHandler } = await boot();
    registerBgHandler(MessageType.SOURCES_TREE_DOWNLOAD, () => { throw new Error('boom'); });
    const r = dispatch({ type: MessageType.SOURCES_TREE_DOWNLOAD, files: [] });
    expect(r.keepOpen).toBe(false);
    expect(r.response).toEqual({ success: false, error: 'boom' });
  });

  it('处理器返回 undefined：不应答（留给后续广播型处理）', async () => {
    const { registerBgHandler } = await boot();
    registerBgHandler(MessageType.VIDEO_RECORDING_STATUS, () => undefined);
    const r = dispatch({ type: MessageType.VIDEO_RECORDING_STATUS, status: 'started' });
    expect(r.keepOpen).toBe(false);
    expect(r.responded).toBe(false);
  });
});

describe('bus：兜底行为', () => {
  it('未注册类型：同步失败应答且明确说明类型', async () => {
    await boot();
    const r = dispatch({ type: MessageType.GET_TEXT_CONTENT });
    expect(r.keepOpen).toBe(false);
    expect((r.response as { success: boolean }).success).toBe(false);
    expect(String((r.response as { error: string }).error)).toContain('GET_TEXT_CONTENT');
  });

  it('无 type 消息：忽略（不应答、不保持通道）', async () => {
    await boot();
    const r = dispatch({ payload: {} });
    expect(r.keepOpen).toBe(false);
    expect(r.responded).toBe(false);
  });

  it('重复注册：后者覆盖前者并告警', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => { /* 断言调用即可，无需输出 */ });
    const { registerBgHandler } = await boot();
    registerBgHandler(MessageType.WHO_AM_I, () => ({ success: true, v: 1 }));
    registerBgHandler(MessageType.WHO_AM_I, () => ({ success: true, v: 2 }));
    const r = dispatch({ type: MessageType.WHO_AM_I });
    expect(r.response).toEqual({ success: true, v: 2 });
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('initMessageBus 幂等：重复调用不叠加监听器', async () => {
    const { initMessageBus } = await boot();
    initMessageBus();
    initMessageBus();
    expect((chrome.runtime.onMessage.addListener as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);
  });
});
