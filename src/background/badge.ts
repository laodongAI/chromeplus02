/**
 * 工具栏图标角标：
 *  - 嗅探到媒体资源 → 蓝色数字（排除 ts/m4s 分片，每 tab 独立）
 *  - 录制中 → 红色 REC（防误关页面）
 * 录制优先级高于计数；标签页关闭/刷新时状态复位。
 */

import { MessageType } from '@/messaging';
import { registerBgHandler } from './bus';
import { countTabSources, setCaptureChangedHandler } from './capture';

const COUNT_COLOR = '#6366f1';
const REC_COLOR = '#ef4444';
const THROTTLE_MS = 500;

const recordingTabs = new Set<number>();
const throttleAt = new Map<number, number>();

function setBadge(tabId: number, text: string, color: string) {
  try {
    chrome.action.setBadgeBackgroundColor({ color, tabId });
    chrome.action.setBadgeText({ text, tabId });
  } catch { /* noop：标签页可能已关闭 */ }
}

function refreshCountBadge(tabId: number) {
  if (recordingTabs.has(tabId)) {
    setBadge(tabId, 'REC', REC_COLOR);
    return;
  }
  const n = countTabSources(tabId);
  setBadge(tabId, n > 0 ? (n > 99 ? '99+' : String(n)) : '', COUNT_COLOR);
}

function refreshThrottled(tabId: number) {
  const now = Date.now();
  const last = throttleAt.get(tabId) || 0;
  if (now - last < THROTTLE_MS) return;
  throttleAt.set(tabId, now);
  refreshCountBadge(tabId);
}

export function initBadge(): void {
  try {
    // 捕获变更（经 capture 钩子，带节流）
    setCaptureChangedHandler(refreshThrottled);

    // 录制状态广播（内容脚本 → 后台，无响应）
    registerBgHandler(MessageType.VIDEO_RECORDING_STATUS, (message, sender) => {
      const tabId = sender?.tab?.id;
      if (typeof tabId !== 'number') return undefined;
      if (message?.status === 'started') recordingTabs.add(tabId);
      else recordingTabs.delete(tabId);
      refreshCountBadge(tabId);
      return undefined;
    });

    // 标签页事件
    chrome.tabs.onActivated.addListener(({ tabId }) => refreshCountBadge(tabId));
    chrome.tabs.onUpdated.addListener((tabId, info) => {
      if (info.status === 'loading') recordingTabs.delete(tabId); // 刷新复位录制态
      refreshCountBadge(tabId);
    });
    chrome.tabs.onRemoved.addListener((tabId) => {
      recordingTabs.delete(tabId);
      throttleAt.delete(tabId);
    });

    // 初始：为当前活动标签页刷一次
    chrome.tabs.query({ active: true, currentWindow: true }).then((tabs) => {
      if (tabs[0]?.id != null) refreshCountBadge(tabs[0].id);
    }).catch(() => { /* noop */ });
  } catch (e) {
    try { console.warn('[bg.badge] 初始化失败:', e); } catch { /* noop */ }
  }
}
