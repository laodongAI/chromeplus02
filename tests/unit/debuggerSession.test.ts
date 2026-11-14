/**
 * chrome.debugger 会话仲裁单测（Tier 2 #16）。
 *
 * 回归的真实缺陷：messageRouter 在资源扫描/打包下载前无条件 chrome.debugger.detach({tabId})，
 * 把同 tab 上 networkCapture 正在跑的 CDP 会话掐断；而 networkCapture 的 onDetach 只把
 * s.active=false、不广播 → 网络面板仍显示「捕获中」，用户以为在录其实早已停。
 *
 * Chrome 每个 tab 只允许一个调试器附加，但 Network 域与 Page 域可在同一会话上并存，
 * 故正确修法是租约引用计数：多个消费者共享一次 attach，最后一个释放时才 detach。
 * 本文件用可控假件观察 attach/detach 的真实调用次数与时机。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

type Arbiter = typeof import('@/background/debuggerSession');

/** 假 chrome.debugger：记录调用次数，支持注入失败与延迟回调 */
function makeChromeStub() {
  const stub = {
    attached: new Set<number>(),
    attachCalls: [] as number[],
    detachCalls: [] as number[],
    /** 非空时 attach 失败并写入 lastError（模拟 DevTools 抢占） */
    attachError: null as string | null,
    /** 非空时 detach 报错（模拟外部已断开的竞态） */
    detachError: null as string | null,
    /** 开启后 attach 回调挂起，由 flushAttach() 手动冲刷，用于观察并发 acquire */
    deferAttach: false,
    pending: [] as Array<() => void>,
    runtime: { lastError: undefined as { message: string } | undefined },
    debugger: {
      attach(target: { tabId: number }, _version: string, cb: () => void): void {
        stub.attachCalls.push(target.tabId);
        const run = () => {
          if (stub.attachError) stub.runtime.lastError = { message: stub.attachError };
          else { stub.attached.add(target.tabId); stub.runtime.lastError = undefined; }
          cb();
          stub.runtime.lastError = undefined;
        };
        if (stub.deferAttach) stub.pending.push(run);
        else run();
      },
      detach(target: { tabId: number }, cb: () => void): void {
        stub.detachCalls.push(target.tabId);
        if (stub.detachError) stub.runtime.lastError = { message: stub.detachError };
        else { stub.attached.delete(target.tabId); stub.runtime.lastError = undefined; }
        cb();
        stub.runtime.lastError = undefined;
      }
    }
  };
  return stub;
}

let chromeStub: ReturnType<typeof makeChromeStub>;
let mod: Arbiter;

beforeEach(async () => {
  // 仲裁器持有模块级租约表：每个用例重新导入，避免跨用例串状态
  vi.resetModules();
  chromeStub = makeChromeStub();
  vi.stubGlobal('chrome', chromeStub);
  mod = await import('@/background/debuggerSession');
});

afterEach(() => { vi.unstubAllGlobals(); });

describe('租约共享：两个消费者只用一次 attach', () => {
  it('network-capture 与 sources-tree 先后 acquire，只 attach 一次', async () => {
    await mod.acquireDebugger(7, 'network-capture');
    await mod.acquireDebugger(7, 'sources-tree');

    expect(chromeStub.attachCalls).toEqual([7]);
    expect(chromeStub.attached.has(7)).toBe(true);
    expect(mod.debuggerPurposes(7).sort()).toEqual(['network-capture', 'sources-tree']);
  });

  it('资源扫描结束释放租约时，网络捕获仍在 → 绝不 detach', async () => {
    await mod.acquireDebugger(7, 'network-capture');
    await mod.acquireDebugger(7, 'sources-tree');
    await mod.releaseDebugger(7, 'sources-tree');

    // 这一条就是原缺陷的回归断言：旧实现此处会 detach，掐断网络捕获
    expect(chromeStub.detachCalls).toEqual([]);
    expect(chromeStub.attached.has(7)).toBe(true);
    expect(mod.isDebuggerHeld(7)).toBe(true);
    expect(mod.debuggerPurposes(7)).toEqual(['network-capture']);
  });

  it('最后一个租约释放时才真正 detach', async () => {
    await mod.acquireDebugger(7, 'network-capture');
    await mod.acquireDebugger(7, 'sources-tree');
    await mod.releaseDebugger(7, 'sources-tree');
    await mod.releaseDebugger(7, 'network-capture');

    expect(chromeStub.detachCalls).toEqual([7]);
    expect(chromeStub.attached.has(7)).toBe(false);
    expect(mod.isDebuggerHeld(7)).toBe(false);
    expect(mod.debuggerPurposes(7)).toEqual([]);
  });

  it('单一消费者 acquire/release 往返后状态干净，可再次附加', async () => {
    await mod.acquireDebugger(7, 'sources-tree');
    await mod.releaseDebugger(7, 'sources-tree');
    await mod.acquireDebugger(7, 'sources-tree');

    expect(chromeStub.attachCalls).toEqual([7, 7]);
    expect(chromeStub.detachCalls).toEqual([7]);
    expect(mod.debuggerPurposes(7)).toEqual(['sources-tree']);
  });

  it('同一用途重复 acquire 是幂等的，不会多算租约', async () => {
    await mod.acquireDebugger(7, 'sources-tree');
    await mod.acquireDebugger(7, 'sources-tree');
    expect(mod.debuggerPurposes(7)).toEqual(['sources-tree']);

    await mod.releaseDebugger(7, 'sources-tree');
    expect(chromeStub.detachCalls).toEqual([7]);
  });
});

describe('并发 acquire', () => {
  it('两个消费者同时 acquire 只触发一次 attach（第二次必然失败）', async () => {
    chromeStub.deferAttach = true;
    const p1 = mod.acquireDebugger(7, 'network-capture');
    const p2 = mod.acquireDebugger(7, 'sources-tree');

    // 回调尚未冲刷：此时只应有一次 attach 在途
    expect(chromeStub.attachCalls).toEqual([7]);
    chromeStub.pending.forEach(fn => fn());
    chromeStub.pending.length = 0;
    await Promise.all([p1, p2]);

    expect(chromeStub.attachCalls).toEqual([7]);
    expect(mod.debuggerPurposes(7).sort()).toEqual(['network-capture', 'sources-tree']);
  });
});

describe('attach 失败', () => {
  it('DevTools 抢占时抛错且不留下租约', async () => {
    chromeStub.attachError = 'Another debugger is already attached to the tab with this id.';
    await expect(mod.acquireDebugger(7, 'network-capture')).rejects.toThrow(/Another debugger/);

    expect(mod.isDebuggerHeld(7)).toBe(false);
    expect(chromeStub.detachCalls).toEqual([]);
  });

  it('失败后清空在途标记，下一次 acquire 会重新尝试 attach', async () => {
    chromeStub.attachError = 'Another debugger is already attached';
    await expect(mod.acquireDebugger(7, 'network-capture')).rejects.toThrow();

    chromeStub.attachError = null;
    await mod.acquireDebugger(7, 'network-capture');
    expect(chromeStub.attachCalls).toEqual([7, 7]);
    expect(mod.isDebuggerHeld(7)).toBe(true);
  });

  it('一个 tab 失败不影响另一个 tab', async () => {
    chromeStub.attachError = 'Cannot attach to this target';
    await expect(mod.acquireDebugger(7, 'sources-tree')).rejects.toThrow();
    chromeStub.attachError = null;
    await mod.acquireDebugger(9, 'network-capture');

    expect(mod.isDebuggerHeld(7)).toBe(false);
    expect(mod.isDebuggerHeld(9)).toBe(true);
  });
});

describe('release 的边界与竞态', () => {
  it('从未 acquire 就 release 是幂等空操作，不会误 detach 别人的会话', async () => {
    await mod.releaseDebugger(7, 'sources-tree');
    expect(chromeStub.detachCalls).toEqual([]);
  });

  it('外部已断开导致 detach 报错时不抛（主动释放与被动 detach 竞态）', async () => {
    await mod.acquireDebugger(7, 'network-capture');
    chromeStub.detachError = 'Debugger is not attached to the tab with this id.';
    await expect(mod.releaseDebugger(7, 'network-capture')).resolves.toBeUndefined();
    expect(mod.isDebuggerHeld(7)).toBe(false);
  });

  it('不同 tab 的租约互不影响', async () => {
    await mod.acquireDebugger(7, 'network-capture');
    await mod.acquireDebugger(9, 'sources-tree');
    await mod.releaseDebugger(7, 'network-capture');

    expect(chromeStub.detachCalls).toEqual([7]);
    expect(mod.isDebuggerHeld(9)).toBe(true);
    expect(chromeStub.attached.has(9)).toBe(true);
  });
});

describe('外部 detach：清空租约并通知订阅者', () => {
  it('被动断开后所有用途的租约一并清空（会话真的没了）', async () => {
    await mod.acquireDebugger(7, 'network-capture');
    await mod.acquireDebugger(7, 'sources-tree');
    chromeStub.attached.delete(7); // 模拟 Chrome 侧真的断开了

    mod.handleDebuggerDetach(7, 'canceled_by_user');

    expect(mod.isDebuggerHeld(7)).toBe(false);
    expect(mod.debuggerPurposes(7)).toEqual([]);
    // 清空后消费者补做的 release 必须是空操作，不能再去 detach 一次
    await mod.releaseDebugger(7, 'network-capture');
    expect(chromeStub.detachCalls).toEqual([]);
  });

  it('订阅者收到 tabId 与 reason，可据此把面板落到「已停止」', async () => {
    const seen: Array<[number, string]> = [];
    mod.onDebuggerDetached((tabId, reason) => seen.push([tabId, reason]));

    mod.handleDebuggerDetach(7, 'target_closed');
    expect(seen).toEqual([[7, 'target_closed']]);
  });

  it('一个订阅者抛异常不影响其他订阅者', async () => {
    const ok = vi.fn();
    mod.onDebuggerDetached(() => { throw new Error('订阅者内部错误'); });
    mod.onDebuggerDetached(ok);

    expect(() => mod.handleDebuggerDetach(7, 'canceled_by_user')).not.toThrow();
    expect(ok).toHaveBeenCalledWith(7, 'canceled_by_user');
  });

  it('取消订阅后不再收到通知', async () => {
    const handler = vi.fn();
    const off = mod.onDebuggerDetached(handler);
    off();

    mod.handleDebuggerDetach(7, 'target_closed');
    expect(handler).not.toHaveBeenCalled();
  });

  it('外部断开后可重新 acquire，重新走一次真实 attach', async () => {
    await mod.acquireDebugger(7, 'network-capture');
    mod.handleDebuggerDetach(7, 'canceled_by_user');
    chromeStub.attached.delete(7);

    await mod.acquireDebugger(7, 'sources-tree');

    expect(chromeStub.attachCalls).toEqual([7, 7]);
    expect(chromeStub.attached.has(7)).toBe(true);
    expect(mod.debuggerPurposes(7)).toEqual(['sources-tree']);
  });
});