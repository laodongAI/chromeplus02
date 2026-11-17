/**
 * 侧栏下载队列 applySnapshot 单测（收口轮 P1-9）。
 * 覆盖：快照驱动的"非终态 → 终态"跃迁写历史、error 任务重复快照不重复写、
 * 新任务直接终态入快照即写历史、后台清理后队列移除、
 * 进度事件只更新数值不写历史（跃迁统一由快照驱动，P1-2 设计）。
 * 手法：chrome/window 最小桩 + vi.mock 隔离 IndexedDB 交接与历史记录模块，
 * 通过捕获的 onMessage 处理器派发真实消息形态，不重构主逻辑。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MessageType } from '@/messaging';

// ===== 模块隔离：HLS 交接（依赖 IndexedDB）与历史记录（断言目标）打桩 =====
vi.mock('@/sidepanel/services/hlsBlobDownload', () => ({
  ensureHlsBlobDownloadListener: vi.fn()
}));
const addHistoryRecord = vi.fn();
vi.mock('@/sidepanel/services/downloadHistory', () => ({
  addHistoryRecord: (rec: unknown) => addHistoryRecord(rec)
}));

/** 捕获的 runtime.onMessage 处理器（downloadQueue 内部注册） */
let runtimeHandler: ((msg: any, sender: any, sendResponse: (r: any) => void) => unknown) | null;
/** 订阅回调收到的最新队列快照 */
let latestTasks: any[] = [];

/** 装载 downloadQueue 模块并订阅（chrome/window 桩必须先就位） */
async function boot() {
  const mod = await import('@/sidepanel/services/downloadQueue');
  mod.subscribe((tasks) => { latestTasks = tasks; });
  return mod;
}

/** 向 downloadQueue 的 onMessage 处理器派发一条消息 */
function deliver(msg: any) {
  runtimeHandler!(msg, {}, () => { /* 广播消息无需应答 */ });
}

beforeEach(async () => {
  vi.resetModules();
  runtimeHandler = null;
  latestTasks = [];
  addHistoryRecord.mockClear();
  vi.stubGlobal('chrome', {
    runtime: {
      lastError: undefined,
      onMessage: { addListener: vi.fn((fn: any) => { runtimeHandler = fn; }) },
      sendMessage: vi.fn(() => Promise.resolve())
    }
  });
  // downloadQueue 的 emitUpdate 依赖 window 事件总线：给可分发的最小实现
  const listeners = new Map<string, Set<(e: any) => void>>();
  vi.stubGlobal('CustomEvent', class {
    type: string;
    detail: unknown;
    constructor(type: string, init?: { detail?: unknown }) { this.type = type; this.detail = init?.detail; }
  });
  vi.stubGlobal('window', {
    dispatchEvent: (e: any) => { (listeners.get(e.type) || new Set()).forEach(fn => fn(e)); return true; },
    addEventListener: (type: string, fn: (e: any) => void) => {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(fn);
    },
    removeEventListener: (type: string, fn: (e: any) => void) => { listeners.get(type)?.delete(fn); },
    setTimeout: (fn: any, ms: number) => setTimeout(fn, ms)
  });
  await boot();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('applySnapshot：状态跃迁与历史写入判定', () => {
  it('新任务直接以 completed 入快照：立即写一条 success 历史', async () => {
    deliver({
      type: MessageType.DOWNLOAD_QUEUE_SNAPSHOT,
      tasks: [{ id: 'a1', url: 'https://e.com/a1.mp4', status: 'completed', kind: 'video', totalBytes: 123 }]
    });
    expect(latestTasks.find(t => t.id === 'a1')?.status).toBe('completed');
    expect(addHistoryRecord).toHaveBeenCalledTimes(1);
    // 台账修正：新任务首次入快照即携带的 totalBytes 要落到历史 size 上。
    // 旧实现漏拷该字段，侧栏未打开期间跑完的任务在历史里永远没有体积，
    // 登记类本地产物（录制/zip）更是只有这一次快照机会。
    expect(addHistoryRecord.mock.calls[0][0]).toMatchObject({ id: 'a1', status: 'success', size: 123 });
  });

  it('running → completed 跃迁写一次 success；重复 completed 快照不再写', async () => {
    deliver({ type: MessageType.DOWNLOAD_QUEUE_SNAPSHOT, tasks: [{ id: 'b1', url: 'https://e.com/b1.mp4', status: 'running', kind: 'video' }] });
    expect(addHistoryRecord).toHaveBeenCalledTimes(0);
    deliver({ type: MessageType.DOWNLOAD_QUEUE_SNAPSHOT, tasks: [{ id: 'b1', url: 'https://e.com/b1.mp4', status: 'completed', kind: 'video', totalBytes: 50 }] });
    expect(addHistoryRecord).toHaveBeenCalledTimes(1);
    // 同一终态在后续快照中反复出现：prevStatus 已是 completed，不重复写（旧缺陷回归点）
    deliver({ type: MessageType.DOWNLOAD_QUEUE_SNAPSHOT, tasks: [{ id: 'b1', url: 'https://e.com/b1.mp4', status: 'completed', kind: 'video', totalBytes: 50 }] });
    expect(addHistoryRecord).toHaveBeenCalledTimes(1);
  });

  it('running → error 带错误信息写一次 failed；error 持续存在不重复写', async () => {
    deliver({ type: MessageType.DOWNLOAD_QUEUE_SNAPSHOT, tasks: [{ id: 'c1', url: 'https://e.com/c1.mp4', status: 'running', kind: 'audio' }] });
    deliver({ type: MessageType.DOWNLOAD_QUEUE_SNAPSHOT, tasks: [{ id: 'c1', url: 'https://e.com/c1.mp4', status: 'error', kind: 'audio', error: 'DRM 受限', errorCode: 'DRM' }] });
    expect(addHistoryRecord).toHaveBeenCalledTimes(1);
    expect(addHistoryRecord.mock.calls[0][0]).toMatchObject({ id: 'c1', status: 'failed', error: 'DRM 受限' });
    deliver({ type: MessageType.DOWNLOAD_QUEUE_SNAPSHOT, tasks: [{ id: 'c1', url: 'https://e.com/c1.mp4', status: 'error', kind: 'audio', error: 'DRM 受限', errorCode: 'DRM' }] });
    expect(addHistoryRecord).toHaveBeenCalledTimes(1);
  });

  it('error 跃迁但无错误信息：不写历史（避免空错误记录）', async () => {
    deliver({ type: MessageType.DOWNLOAD_QUEUE_SNAPSHOT, tasks: [{ id: 'd1', url: 'https://e.com/d1.mp4', status: 'running', kind: 'image' }] });
    deliver({ type: MessageType.DOWNLOAD_QUEUE_SNAPSHOT, tasks: [{ id: 'd1', url: 'https://e.com/d1.mp4', status: 'error', kind: 'image' }] });
    expect(addHistoryRecord).toHaveBeenCalledTimes(0);
  });

  it('running → canceled 写一条 canceled：取消的任务不再凭空消失', async () => {
    deliver({ type: MessageType.DOWNLOAD_QUEUE_SNAPSHOT, tasks: [{ id: 'g1', url: 'https://e.com/g1.mp4', status: 'running', kind: 'video' }] });
    expect(addHistoryRecord).toHaveBeenCalledTimes(0);
    deliver({ type: MessageType.DOWNLOAD_QUEUE_SNAPSHOT, tasks: [{ id: 'g1', url: 'https://e.com/g1.mp4', status: 'canceled', kind: 'video' }] });
    expect(addHistoryRecord).toHaveBeenCalledTimes(1);
    expect(addHistoryRecord.mock.calls[0][0]).toMatchObject({ id: 'g1', status: 'canceled' });
    // 同一 canceled 终态重复出现不再二次入档
    deliver({ type: MessageType.DOWNLOAD_QUEUE_SNAPSHOT, tasks: [{ id: 'g1', url: 'https://e.com/g1.mp4', status: 'canceled', kind: 'video' }] });
    expect(addHistoryRecord).toHaveBeenCalledTimes(1);
  });

  it('error 跃迁无错误信息但有错误码：仍入档并以错误码作为原因', async () => {
    deliver({ type: MessageType.DOWNLOAD_QUEUE_SNAPSHOT, tasks: [{ id: 'h1', url: 'https://e.com/h1.mp4', status: 'running', kind: 'video' }] });
    deliver({ type: MessageType.DOWNLOAD_QUEUE_SNAPSHOT, tasks: [{ id: 'h1', url: 'https://e.com/h1.mp4', status: 'error', kind: 'video', errorCode: 'INTERRUPTED' }] });
    expect(addHistoryRecord).toHaveBeenCalledTimes(1);
    expect(addHistoryRecord.mock.calls[0][0]).toMatchObject({ id: 'h1', status: 'failed', error: 'INTERRUPTED' });
  });

  it('登记类本地产物：首次入快照即写历史，并携带来源页与产物键', async () => {
    deliver({
      type: MessageType.DOWNLOAD_QUEUE_SNAPSHOT,
      tasks: [{
        id: 'r1', url: '页面正文.md', fileName: '页面正文.md', kind: 'text', engine: 'local',
        status: 'completed', idbKey: 'dlart:r1', totalBytes: 4096,
        sourceUrl: 'https://example.com/a?x=1', sourceTitle: '示例页', sourceTabId: 7,
      }],
    });
    expect(addHistoryRecord).toHaveBeenCalledTimes(1);
    expect(addHistoryRecord.mock.calls[0][0]).toMatchObject({
      id: 'r1', kind: 'text', status: 'success', size: 4096,
      engine: 'local', idbKey: 'dlart:r1',
      sourceUrl: 'https://example.com/a?x=1', sourceTitle: '示例页', sourceTabId: 7,
    });
    const t = latestTasks.find(x => x.id === 'r1');
    expect(t.sourceUrl).toBe('https://example.com/a?x=1');
    expect(t.engine).toBe('local');
  });

  it('快照中消失的任务从队列移除（后台已清理）', async () => {
    deliver({ type: MessageType.DOWNLOAD_QUEUE_SNAPSHOT, tasks: [{ id: 'e1', url: 'https://e.com/e1.mp4', status: 'running', kind: 'video' }] });
    expect(latestTasks.length).toBe(1);
    deliver({ type: MessageType.DOWNLOAD_QUEUE_SNAPSHOT, tasks: [] });
    expect(latestTasks.length).toBe(0);
  });

  it('进度事件只更新数值：即使携带终态也不写历史（跃迁统一由快照驱动）', async () => {
    deliver({ type: MessageType.DOWNLOAD_QUEUE_SNAPSHOT, tasks: [{ id: 'f1', url: 'https://e.com/f1.mp4', status: 'running', kind: 'video' }] });
    deliver({
      type: MessageType.DOWNLOAD_PROGRESS_EVENT,
      id: 'f1', state: 'completed', finished: true, progress: 1, bytesReceived: 999, totalBytes: 999, speedBps: 123
    });
    expect(addHistoryRecord).toHaveBeenCalledTimes(0);
    const t = latestTasks.find(x => x.id === 'f1');
    expect(t.state).toBe('completed'); // 局部数值/状态字段被更新
    expect(t.status).toBe('running');  // 结构性状态仍由快照驱动
    expect(t.speedBps).toBe(123);
  });
});
