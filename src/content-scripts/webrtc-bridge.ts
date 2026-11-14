/**
 * WebRTC 录流 —— ISOLATED 世界桥接脚本（Round 5 #30）。
 *
 * 职责只有两件：
 *  1. 把 MAIN 世界经 window.postMessage 发来的上行事件转成 chrome 消息交给后台；
 *  2. 把后台下发的录制命令转成 window.postMessage 交给 MAIN 世界。
 *
 * 为什么需要它：MAIN 世界没有 chrome.* API，ISOLATED 世界拿不到 MediaStream，
 * 两个世界之间只有 window.postMessage 这一条通道，且它不是信任边界——
 * 页面自己也能读写。所以这里只做结构校验（parseRtcUpEvent），
 * "这条产物能不能进成果库"由后台按 recordId 归属裁定。
 *
 * 与 MAIN 脚本一样由后台按设置动态注册，关闭时不注入。
 */

import { MessageType } from '@/messaging';
import { RTC_BRIDGE_SOURCE, parseRtcUpEvent } from '@/core/webrtcCapture';

const INSTALL_FLAG = '__mediaplusRtcBridge';

function send(type: MessageType, payload: Record<string, unknown>): void {
  try {
    chrome.runtime.sendMessage({ type, ...payload }, () => { void chrome.runtime.lastError; });
  } catch { /* 后台不可用（SW 正在重启）：丢弃本次事件，下一次上报会补上 */ }
}

function install(): void {
  window.addEventListener('message', (ev: MessageEvent) => {
    if (ev.source !== window) return;
    const event = parseRtcUpEvent(ev.data);
    if (!event) return;
    send(MessageType.WEBRTC_BRIDGE_EVENT, { event });
  });

  chrome.runtime.onMessage.addListener((msg: any) => {
    if (msg?.type !== MessageType.WEBRTC_COMMAND || !msg.command) return;
    try { window.postMessage({ source: RTC_BRIDGE_SOURCE, dir: 'down', ...msg.command }, '*'); } catch { /* noop */ }
  });

  // MAIN 脚本可能先于本脚本装好，主动要一次清单，避免面板空白
  try { window.postMessage({ source: RTC_BRIDGE_SOURCE, dir: 'down', kind: 'list' }, '*'); } catch { /* noop */ }
}

const g = window as unknown as Record<string, any>;
if (!g[INSTALL_FLAG]) {
  g[INSTALL_FLAG] = true;
  try { install(); } catch { /* 桥接失败不能影响页面本身 */ }
}