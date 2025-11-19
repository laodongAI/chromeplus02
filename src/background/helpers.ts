/**
 * 背景辅助函数集合（TypeScript 版）。
 * 职责：站点识别、URL/标签页获取等与 UI 无关的纯逻辑或 Chrome API 简单封装。
 */

export function isBilibiliUrl(url?: string | null): boolean {
  return !!(url && url.includes('bilibili.com'));
}

/**
 * 获取指定标签页（或当前活动标签页）的 URL。
 * @param tabId 可选，若提供则优先获取该标签页 URL
 */
export async function getCurrentTabUrl(tabId?: number): Promise<string | null> {
  try {
    if (typeof tabId === 'number') {
      const tab = await chrome.tabs.get(tabId);
      if (tab?.url) return tab.url;
    }
  } catch {}
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tabs && tabs[0]?.url) return tabs[0].url!;
  } catch {}
  return null;
}

/**
 * 查找一个活动或可用的 B 站标签页 ID。
 */
export async function getActiveBilibiliTabId(): Promise<number | null> {
  try {
    const tabs = await chrome.tabs.query({});
    for (const t of tabs) {
      if (isBilibiliUrl(t.url) && t.active) return t.id ?? null;
    }
    for (const t of tabs) {
      if (isBilibiliUrl(t.url)) return t.id ?? null;
    }
  } catch {}
  return null;
}
