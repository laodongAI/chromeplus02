/**
 * 调试会话跨模块集成回归（Tier 2 #16）。
 *
 * 真实缺陷链路：用户在接口抓取面板点「开始捕获」（networkCapture 附加 Network 域），
 * 随后去资源目录面板点「扫描」（messageRouter 无条件 detach + sourcesTree 自行 attach/detach）
 * → 网络捕获的 CDP 会话被掐断，但面板仍显示「捕获中」。
 *
 * 本文件不 mock 仲裁器，用真实 debuggerSession + 真实 networkCapture + 真实 sourcesTree 跑通链路，
 * 只把 chrome.debugger / chrome.runtime 换成可控假件，断言 attach/detach 次数与状态广播。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MessageType } from '@/messaging';

const { handlers } = vi.hoisted(() => ({ handlers: new Map<string, (msg: any) => any>() }));
vi.mock('@/background/bus', () => ({
  registerBgHandler: (type: string, handler: (msg: any) => any) => { handlers.set(type, handler); }
}));

/** Page.getResourceTree 的最小可用假件：一个主 frame + 一个同域脚本资源 */
const FAKE_RESOURCE_TREE = {
  frameTree: {
    frame: { id: 'FRAME-TOP', url: 'https://example.com/index.html' },
    resources: [
      { url: 'https://example.com/static/app.js', type: 'Script', mimeType: 'text/javascript', contentSize: 2048 }
    ]
  }
};

function makeChromeStub() {
  const stub = {
    attached: new Set<number>(),
    attachCalls: [] as number[],
    detachCalls: [] as number[],
    commands: [] as string[],
    broadcasts: [] as Array<Record<string, unknown>>,
    attachError: null as string | null,
    detachListeners: [] as Array<(source: { tabId?: number }, reason: string) => void>,
    runtime: {
      lastError: undefined as { message: string } | undefined,
      sendMessage(msg: Record<string, unknown>) {
        stub.broadcasts.push(msg);
        return Promise.resolve(undefined);
      }
    },
    tabs: {
      query: vi.fn(async () => [{ id: 7 }]),
      onRemoved: { addListener: vi.fn() }
    },
    debugger: {
      attach(target: { tabId: number }, _v: string, cb: () => void): void {
        stub.attachCalls.push(target.tabId);
        if (stub.attachError) stub.runtime.lastError = { message: stub.attachError };
        else { stub.attached.add(target.tabId); stub.runtime.lastError = undefined; }
        cb();
        stub.runtime.lastError = undefined;
      },
      detach(target: { tabId: number }, cb: () => void): void {
        stub.detachCalls.push(target.tabId);
        stub.attached.delete(target.tabId);
        stub.runtime.lastError = undefined;
        cb();
      },
      sendCommand(_target: { tabId: number }, method: string, _params: unknown, cb: (r: any) => void): void {
        stub.commands.push(method);
        stub.runtime.lastError = undefined;
        if (method === 'Page.getResourceTree') cb(FAKE_RESOURCE_TREE);
        else if (method === 'Page.getResourceContent') cb({ content: 'console.log(1)', base64Encoded: false });
        else cb({});
      },
      onEvent: { addListener: vi.fn() },
      onDetach: {
        addListener(fn: (source: { tabId?: number }, reason: string) => void): void {
          stub.detachListeners.push(fn);
        }
      }
    },
    /** 测试用：模拟 Chrome 侧真的断开了会话（用户点掉提示条 / 标签页关闭） */
    fireDetach(tabId: number, reason: string): void {
      stub.attached.delete(tabId);
      stub.detachListeners.forEach(fn => fn({ tabId }, reason));
    }
  };
  return stub;
}

let chromeStub: ReturnType<typeof makeChromeStub>;
let arbiter: typeof import('@/background/debuggerSession');
let sources: typeof import('@/content-scripts/sourcesTree');

/** 走真实消息处理器，等价于侧栏点按钮 */
async function send(type: MessageType, msg: Record<string, unknown> = {}): Promise<any> {
  const h = handlers.get(type);
  if (!h) throw new Error(`处理器未注册: ${type}`);
  return h({ type, ...msg });
}

beforeEach(async () => {
  vi.resetModules();
  handlers.clear();
  chromeStub = makeChromeStub();
  vi.stubGlobal('chrome', chromeStub);

  const capture = await import('@/background/networkCapture');
  capture.initNetworkCaptureHandlers();
  arbiter = await import('@/background/debuggerSession');
  sources = await import('@/content-scripts/sourcesTree');
});

afterEach(() => { vi.unstubAllGlobals(); });

describe('捕获与资源扫描共用一次附加', () => {
  it('捕获进行中扫描资源目录，不会 detach 掉网络捕获', async () => {
    const started = await send(MessageType.NET_CAPTURE_START, { tabId: 7 });
    expect(started.success).toBe(true);
    expect(chromeStub.attachCalls).toEqual([7]);

    const scan = await sources.getSourcesTree(7);
    expect(scan.files.length).toBe(1);

    // 核心回归断言：旧实现此处会 detach，网络捕获被静默掐断
    expect(chromeStub.detachCalls).toEqual([]);
    expect(chromeStub.attached.has(7)).toBe(true);
    // 扫描已正常结束并释放自己的租约，只剩捕获持有 → 会话必须留着
    expect(arbiter.debuggerPurposes(7)).toEqual(['network-capture']);

    const status = await send(MessageType.NET_CAPTURE_STATUS, { tabId: 7 });
    expect(status.active).toBe(true);
  });

  it('捕获进行中按需取资源内容，同样不 detach', async () => {
    await send(MessageType.NET_CAPTURE_START, { tabId: 7 });
    const result = await sources.fetchSourceContents(7, ['https://example.com/static/app.js']);

    expect(result.contents.size).toBe(1);
    expect(result.failures).toEqual([]);
    expect(chromeStub.detachCalls).toEqual([]);
    expect((await send(MessageType.NET_CAPTURE_STATUS, { tabId: 7 })).active).toBe(true);
  });

  it('扫描失败也释放自己的租约，且不波及网络捕获', async () => {
    await send(MessageType.NET_CAPTURE_START, { tabId: 7 });
    // 让 Page.getResourceTree 之后的命令失败：直接把 frameTree 掏空触发 frameId 缺失分支
    const original = chromeStub.debugger.sendCommand;
    chromeStub.debugger.sendCommand = (_t: any, method: string, _p: unknown, cb: (r: any) => void) => {
      if (method === 'Page.getResourceTree') cb({});
      else original(_t, method, _p, cb);
    };

    const result = await sources.fetchSourceContents(7, ['https://example.com/static/app.js']);
    expect(result.contents.size).toBe(0); // 失败仍返回已取回部分，不抛
    // 帧信息缺失时每个 URL 都要有失败记录，不能静默少文件
    expect(result.failures.length).toBe(1);
    expect(result.failures[0].reason).toBe('unavailable');
    expect(chromeStub.detachCalls).toEqual([]);
    expect(arbiter.debuggerPurposes(7)).toEqual(['network-capture']);
  });

  it('停止捕获时资源扫描仍持有租约 → 保留会话', async () => {
    await send(MessageType.NET_CAPTURE_START, { tabId: 7 });
    await arbiter.acquireDebugger(7, 'sources-tree'); // 模拟扫描正在进行

    const stopped = await send(MessageType.NET_CAPTURE_STOP, { tabId: 7 });
    expect(stopped.success).toBe(true);
    expect(stopped.active).toBe(false);
    expect(chromeStub.detachCalls).toEqual([]);
    expect(chromeStub.attached.has(7)).toBe(true);

    await arbiter.releaseDebugger(7, 'sources-tree');
    expect(chromeStub.detachCalls).toEqual([7]);
  });

  it('没有捕获时资源扫描独立往返，正常 attach 一次 detach 一次', async () => {
    await sources.getSourcesTree(7);
    expect(chromeStub.attachCalls).toEqual([7]);
    expect(chromeStub.detachCalls).toEqual([7]);
    expect(arbiter.isDebuggerHeld(7)).toBe(false);
  });

  it('扫描与捕获先后启动只 attach 一次，全部结束后才 detach', async () => {
    await sources.getSourcesTree(7); // 扫描已结束并释放
    await send(MessageType.NET_CAPTURE_START, { tabId: 7 });
    await send(MessageType.NET_CAPTURE_STOP, { tabId: 7 });

    expect(chromeStub.attachCalls).toEqual([7, 7]);
    expect(chromeStub.detachCalls).toEqual([7, 7]);
  });
});

describe('被动 detach 的状态广播', () => {
  it('捕获中被外部断开 → 广播 active:false，面板不再显示「捕获中」', async () => {
    await send(MessageType.NET_CAPTURE_START, { tabId: 7 });
    chromeStub.broadcasts.length = 0;

    chromeStub.fireDetach(7, 'canceled_by_user');

    const state = chromeStub.broadcasts.find(b => b.type === MessageType.NET_CAPTURE_STATE);
    expect(state).toBeDefined();
    expect(state!.tabId).toBe(7);
    expect(state!.active).toBe(false);
    expect(String(state!.reason)).toContain('外部断开');
    // 后台状态也必须同步落到已停止，否则下次查询仍报 active
    expect((await send(MessageType.NET_CAPTURE_STATUS, { tabId: 7 })).active).toBe(false);
    expect(arbiter.isDebuggerHeld(7)).toBe(false);
  });

  it('标签页关闭时广播的原因文案是「标签页已关闭」', async () => {
    await send(MessageType.NET_CAPTURE_START, { tabId: 7 });
    chromeStub.broadcasts.length = 0;
    chromeStub.fireDetach(7, 'target_closed');

    const state = chromeStub.broadcasts.find(b => b.type === MessageType.NET_CAPTURE_STATE);
    expect(state!.reason).toBe('标签页已关闭');
  });

  it('本来就没在捕获时不广播状态（避免资源扫描释放租约产生噪声）', async () => {
    await arbiter.acquireDebugger(7, 'sources-tree');
    chromeStub.broadcasts.length = 0;
    chromeStub.fireDetach(7, 'canceled_by_user');

    expect(chromeStub.broadcasts.some(b => b.type === MessageType.NET_CAPTURE_STATE)).toBe(false);
  });

  it('主动停止捕获不产生「被外部断开」广播', async () => {
    await send(MessageType.NET_CAPTURE_START, { tabId: 7 });
    chromeStub.broadcasts.length = 0;
    await send(MessageType.NET_CAPTURE_STOP, { tabId: 7 });

    // Chrome 对自发起的 detach 不派发 onDetach；即便派发，active 已为 false 也不该再播
    chromeStub.fireDetach(7, 'canceled_by_user');
    expect(chromeStub.broadcasts.some(b => b.type === MessageType.NET_CAPTURE_STATE)).toBe(false);
  });
});

describe('attach 失败的用户提示', () => {
  it('DevTools 占用时返回中文引导而不是裸 CDP 错误', async () => {
    chromeStub.attachError = 'Another debugger is already attached to the tab with this id.';
    const r = await send(MessageType.NET_CAPTURE_START, { tabId: 7 });

    expect(r.success).toBe(false);
    expect(r.error).toContain('请先关闭 DevTools');
    expect(arbiter.isDebuggerHeld(7)).toBe(false);
  });

  it('attach 失败后资源扫描仍可独立取得会话', async () => {
    chromeStub.attachError = 'Another debugger is already attached';
    await send(MessageType.NET_CAPTURE_START, { tabId: 7 });
    chromeStub.attachError = null;

    const scan = await sources.getSourcesTree(7);
    expect(scan.files.length).toBe(1);
    expect(arbiter.isDebuggerHeld(7)).toBe(false); // 扫描结束已释放
  });
});