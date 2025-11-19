/**
 * 背景事件集中注册（占位）。
 * 注意：当前不在 index.ts 中主动注册，避免与现有 root/background.js 重复监听。
 * 迁移完成后可在 index.ts 中调用 registerAllEvents() 启用。
 */

export function registerTabLifecycleEvents() {
  // 示例：标签页关闭日志（迁移后启用）
  // chrome.tabs.onRemoved.addListener((tabId) => {
  //   console.log(`[events] 标签页 ${tabId} 已关闭`);
  // });
}

export function registerInstallEvents() {
  // 示例：安装/更新事件（迁移后启用）
  // chrome.runtime.onInstalled.addListener((details) => {
  //   console.log('[events] 插件安装/更新:', details.reason);
  // });
}

export function registerAllEvents() {
  registerTabLifecycleEvents();
  registerInstallEvents();
}
