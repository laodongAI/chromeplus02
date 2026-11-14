/**
 * chrome.debugger 会话仲裁（租约引用计数）。
 *
 * Chrome 每个 tab 只允许一个调试器附加，而本项目有两个独立消费者：
 *  - networkCapture：长时间附加跑 Network 域，由用户点「开始/停止捕获」控制；
 *  - sourcesTree：短暂附加跑 Page 域，扫描目录树 / 按需取资源内容。
 * 各自 attach/detach 会互相掐断：资源扫描一跑，网络捕获就被 detach 掉，
 * 而面板仍显示「捕获中」，用户以为在录其实早已停。
 *
 * 本模块让多个消费者共享同一次附加：按用途登记租约，最后一个租约释放时才真正 detach。
 * Network 域与 Page 域可在同一会话上并存，故 acquire 之后各自 enable 自己需要的域即可。
 * 外部 detach（用户点 Chrome 提示条的「取消」、DevTools 抢占）经 handleDebuggerDetach 清空租约并通知订阅者。
 */
import { createLogger } from '@/utils/logger';

const log = createLogger('debuggerSession');

/** 调试会话用途（租约粒度） */
export type DebuggerPurpose = 'network-capture' | 'sources-tree';

/** CDP 协议版本，两个消费者必须一致，否则共享会话时命令会被拒 */
export const DEBUGGER_PROTOCOL_VERSION = '1.3';

/** tabId -> 持有该 tab 调试会话的用途集合 */
const leases = new Map<number, Set<DebuggerPurpose>>();
/** tabId -> 进行中的 attach，避免并发 acquire 触发两次 attach（第二次必然失败） */
const attaching = new Map<number, Promise<void>>();

/** 外部 detach 订阅者 */
export type DebuggerDetachHandler = (tabId: number, reason: string) => void;
const detachHandlers = new Set<DebuggerDetachHandler>();

function attachOnce(tabId: number): Promise<void> {
  return new Promise((resolve, reject) => {
    try {
      chrome.debugger.attach({ tabId }, DEBUGGER_PROTOCOL_VERSION, () => {
        const err = chrome.runtime.lastError;
        if (err) reject(new Error(err.message || String(err)));
        else resolve();
      });
    } catch (e) {
      reject(e instanceof Error ? e : new Error(String(e)));
    }
  });
}

function detachOnce(tabId: number): Promise<void> {
  return new Promise((resolve) => {
    try {
      chrome.debugger.detach({ tabId }, () => {
        const err = chrome.runtime.lastError;
        // 本来就没附加不算失败：外部 detach 与主动释放可能竞态
        if (err) log.debug(`detach tab=${tabId} 未生效：${err.message}`);
        resolve();
      });
    } catch (e) {
      log.debug(`detach tab=${tabId} 抛异常`, e);
      resolve();
    }
  });
}

/**
 * 取得调试会话租约；已有附加时直接复用，不重复 attach。
 * @throws attach 失败（DevTools 占用、受限页面等）时抛错，调用方决定如何提示
 */
export async function acquireDebugger(tabId: number, purpose: DebuggerPurpose): Promise<void> {
  const held = leases.get(tabId);
  if (held && held.size > 0) {
    held.add(purpose);
    log.debug(`复用调试会话 tab=${tabId} purpose=${purpose} 租约=${held.size}`);
    return;
  }
  const inflight = attaching.get(tabId);
  if (inflight) {
    await inflight;
  } else {
    const p = attachOnce(tabId);
    attaching.set(tabId, p);
    try {
      await p;
    } finally {
      attaching.delete(tabId);
    }
  }
  let set = leases.get(tabId);
  if (!set) { set = new Set(); leases.set(tabId, set); }
  set.add(purpose);
  log.info(`调试会话已附加 tab=${tabId} purpose=${purpose}`);
}

/**
 * 释放租约；仍有其他消费者持有时不 detach，避免掐断对方。
 * 未持有租约时调用是幂等空操作。
 */
export async function releaseDebugger(tabId: number, purpose: DebuggerPurpose): Promise<void> {
  const held = leases.get(tabId);
  if (!held) return;
  held.delete(purpose);
  if (held.size > 0) {
    log.debug(`释放租约但保留会话 tab=${tabId} purpose=${purpose} 剩余=${held.size}`);
    return;
  }
  leases.delete(tabId);
  await detachOnce(tabId);
  log.info(`调试会话已释放 tab=${tabId} purpose=${purpose}`);
}

/** 该 tab 当前是否有本扩展持有的调试会话 */
export function isDebuggerHeld(tabId: number): boolean {
  const held = leases.get(tabId);
  return !!held && held.size > 0;
}

/** 该 tab 当前的租约用途快照（诊断/日志用） */
export function debuggerPurposes(tabId: number): DebuggerPurpose[] {
  return Array.from(leases.get(tabId) ?? []);
}

/**
 * 处理 chrome.debugger.onDetach：清空租约并通知订阅者。
 * 必须由后台的 onDetach 监听器调用——被动断开时订阅者要把自己的状态落到「已停止」，
 * 否则面板会一直显示「捕获中」。
 */
export function handleDebuggerDetach(tabId: number, reason: string): void {
  const had = leases.has(tabId);
  leases.delete(tabId);
  attaching.delete(tabId);
  if (had) log.info(`调试会话被外部断开 tab=${tabId} reason=${reason}`);
  detachHandlers.forEach(h => {
    try { h(tabId, reason); } catch (e) { log.warn('detach 订阅者异常', e); }
  });
}

/** 订阅外部 detach；返回取消订阅函数 */
export function onDebuggerDetached(handler: DebuggerDetachHandler): () => void {
  detachHandlers.add(handler);
  return () => { detachHandlers.delete(handler); };
}