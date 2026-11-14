/**
 * 增量资源更新（RESOURCE_UPDATE）的来源守卫。
 *
 * 内容脚本用 chrome.runtime.sendMessage 直接广播增量，侧栏里所有已挂载的面板都会收到，
 * 而 payload 只带 frameId、不带 tabId。仅按 frameId 过滤时，后台标签页（同样是顶层 frame 0）
 * 的增量会覆盖当前标签页的列表——用户看到的是另一个页面的资源。
 * tabId 只能从 runtime.onMessage 回调的 sender.tab.id 取，与面板当前绑定的来源比对。
 *
 * 本模块为纯函数，不依赖 chrome / Vue / DOM，可直接被 tests/unit 覆盖。
 */

/** 面板列表当前绑定的来源 */
export interface ResourceBinding {
  /** 绑定的标签页 id；null 表示尚未成功扫描过任何页面 */
  tabId: number | null;
  /** 绑定的 frame id；null 视为顶层 0 */
  frameId: number | null;
}

/**
 * 判断一条增量更新是否来自面板当前绑定的 tab + frame。
 * @param sender   runtime.onMessage 的发送方（内容脚本消息才有 tab）
 * @param payload  消息 payload（帧号缺省按顶层 0 处理，与内容脚本旧客户端兼容）
 * @param binding  面板当前绑定来源
 * @returns 是否应采纳这条增量
 */
export function isResourceUpdateFromBoundSource(
  sender: { tab?: { id?: number } } | undefined,
  payload: { frameId?: unknown } | undefined,
  binding: ResourceBinding
): boolean {
  const senderTabId = sender?.tab?.id;
  // 尚未绑定任何标签页时不接受增量：列表应由面板自己的显式扫描填充，
  // 否则后台标签页的广播会凭空造出一份不属于当前页面的列表
  if (binding.tabId === null || typeof senderTabId !== 'number') return false;
  if (senderTabId !== binding.tabId) return false;
  const frameId = typeof payload?.frameId === 'number' ? payload.frameId : 0;
  return frameId === (binding.frameId ?? 0);
}