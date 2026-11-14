/**
 * Background 消息总线：唯一的 chrome.runtime.onMessage 监听器 + 处理器注册表。
 * 各后台模块通过 registerBgHandler 注册处理函数；
 * 未注册的消息同步返回错误响应，避免调用方 Promise 永久挂起。
 *
 * P1-1 协议收敛：处理器签名从 `(message: any) => any` 收紧为判别联合 AnyMessage；
 * registerBgHandler 泛型参数 M 让各 handler 在注册处直接拿到具体消息类型，
 * 无需在函数体内做 `as any` 收窄。
 */

import type { AnyMessage, MessageType } from '@/messaging';
// P1-8：分级日志（SW 上下文默认 info 级）
import { createLogger } from '@/utils/logger';

/** 本模块 logger：保留原 `[bg.bus]` 前缀语义 */
const log = createLogger('bg.bus');

/**
 * 后台处理器基础签名：入参为全量消息判别联合，返回值为应答负载
 * （形态契约见 messaging/index.ts 文件头：本族统一 { success } 形态）。
 */
export type BgHandler = (message: AnyMessage, sender: chrome.runtime.MessageSender) => unknown;

/** 注册表：type 字符串 -> 处理器（同一 type 后注册覆盖先注册，注册时告警） */
const registry = new Map<string, BgHandler>();
/** 监听器安装标记：防止 initMessageBus 被重复调用导致双重分发 */
let installed = false;

/**
 * 注册后台消息处理器。
 * @param type 消息类型（收敛后统一传 MessageType 枚举成员；保留 string 以兼容测试桩注册任意键）
 * @param handler 处理器；泛型 M 指定该 type 对应的具体消息接口，实现注册处收窄
 */
export function registerBgHandler<M extends AnyMessage = AnyMessage>(
  type: MessageType | string,
  handler: (message: M, sender: chrome.runtime.MessageSender) => unknown
): void {
  if (registry.has(type)) {
    log.warn(`消息类型重复注册（后者覆盖）: ${type}`);
  }
  // 注册表内部按 AnyMessage 存储；M 由调用处显式/推断指定，与 type 一致性由泛型约束保证
  registry.set(type, handler as BgHandler);
}

/** 安装唯一 onMessage 监听器并启动分发（幂等） */
export function initMessageBus(): void {
  if (installed) return;
  installed = true;
  if (!chrome?.runtime?.onMessage) return;
  chrome.runtime.onMessage.addListener((message: AnyMessage, sender, sendResponse) => {
    const type = message?.type;
    if (!type) return false;
    const handler = registry.get(type);
    if (!handler) {
      // 未注册：立即同步失败响应（发送方若无回调则此调用为无害 no-op）
      sendResponse({ success: false, error: `未注册的后台消息类型: ${String(type)}` });
      return false;
    }
    try {
      const result = handler(message, sender);
      if (result && typeof (result as Promise<unknown>).then === 'function') {
        (result as Promise<unknown>).then(
          (resp) => sendResponse(resp ?? { success: true }),
          (e: unknown) => sendResponse({ success: false, error: e instanceof Error ? e.message : String(e) })
        );
        return true; // 异步响应：保持通道开放
      }
      if (result !== undefined) sendResponse(result);
      return false;
    } catch (e) {
      sendResponse({ success: false, error: e instanceof Error ? e.message : String(e) });
      return false;
    }
  });
}
