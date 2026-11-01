/**
 * Background 消息总线：唯一的 chrome.runtime.onMessage 监听器 + 处理器注册表。
 * 各后台模块通过 registerBgHandler 注册处理函数；
 * 未注册的消息同步返回错误响应，避免调用方 Promise 永久挂起。
 */

export type BgHandler = (message: any, sender: chrome.runtime.MessageSender) => any;

const registry = new Map<string, BgHandler>();
let installed = false;

export function registerBgHandler(type: string, handler: BgHandler): void {
  if (registry.has(type)) {
    console.warn(`[bg.bus] 消息类型重复注册（后者覆盖）: ${type}`);
  }
  registry.set(type, handler);
}

export function initMessageBus(): void {
  if (installed) return;
  installed = true;
  if (!chrome?.runtime?.onMessage) return;
  chrome.runtime.onMessage.addListener((message: any, sender, sendResponse) => {
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
      if (result && typeof (result as Promise<any>).then === 'function') {
        (result as Promise<any>).then(
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
