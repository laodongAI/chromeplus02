/**
 * WebRTC 录流 —— 后台协调层（Round 5 #30）。
 *
 * 职责：
 *  1. 按设置动态注册/注销 MAIN + ISOLATED 两个内容脚本（关闭时零注入，不给所有页面
 *     凭空加一层 RTCPeerConnection 包装）；
 *  2. 汇总各 tab / 各 frame 上报的远端流清单，供面板展示；
 *  3. 裁定产物归属：recordId 由本模块生成，只有"本模块发起过、且发送方 tab 匹配"的
 *     分块才会被转交给录制成果库。window.postMessage 不是信任边界，页面能伪造上行事件，
 *     但伪造不出后台发起的 recordId，因此污染不了用户的成果列表。
 *
 * 产物落库复用 captureRecording 的 CAPTURE_RECORDING_CHUNK/DONE 链路，不另建一套存储。
 *
 * SW 休眠：清单与录制归属都是内存态。录制期间每 3s 就有一块分块上送，足以让 SW 保持活跃；
 * 空闲后 SW 被回收，清单靠面板查询时向页面重新索要（见 WEBRTC_CAPTURE_STATUS），
 * 不需要为它单独建持久化层。
 */

import { registerBgHandler } from './bus';
import {
  MessageType,
  type WebRtcBridgeEventMessage,
  type WebRtcCaptureStartMessage,
  type WebRtcCaptureStatusMessage,
  type WebRtcCaptureStopMessage,
  type WebRtcCaptureToggleMessage
} from '@/messaging';
import { makeRtcRecordId, mergeRtcStreams, type RtcStreamInfo } from '@/core/webrtcCapture';
import { acceptRecordingChunk, acceptRecordingDone } from './captureRecording';
import { createLogger } from '@/utils/logger';

const log = createLogger('bg.webrtc');

const SETTINGS_KEY = 'global_settings_v2';
const MAIN_SCRIPT_ID = 'mediaplus-webrtc-main';
const BRIDGE_SCRIPT_ID = 'mediaplus-webrtc-bridge';

/** 开关缓存（SW 冷启动时从 storage 读） */
let enabled = false;
/** tabId → frameId → 流清单 */
const inventory = new Map<number, Map<number, RtcStreamInfo[]>>();
/** recordId → 归属与状态 */
const records = new Map<string, { tabId: number; frameId: number; streamId: string; state: 'recording' | 'stopped' | 'error' }>();

function flatten(tabId: number): RtcStreamInfo[] {
  const frames = inventory.get(tabId);
  if (!frames) return [];
  let out: RtcStreamInfo[] = [];
  for (const list of frames.values()) out = mergeRtcStreams(out, list);
  return out;
}

function recordingFor(tabId: number): Record<string, 'recording' | 'stopped' | 'error'> {
  const out: Record<string, 'recording' | 'stopped' | 'error'> = {};
  for (const [id, r] of records) if (r.tabId === tabId) out[id] = r.state;
  return out;
}

function broadcast(tabId: number, error?: string): void {
  try {
    chrome.runtime.sendMessage({
      type: MessageType.WEBRTC_CAPTURE_UPDATE,
      tabId,
      streams: flatten(tabId),
      recording: recordingFor(tabId),
      error
    }, () => { void chrome.runtime.lastError; });
  } catch { /* 侧栏未开：清单仍在内存，下次打开会主动拉 */ }
}

/** 找到某路流所在的 frame，命令才能定向下发（广播到所有 frame 会产生虚假的"流不存在"错误） */
function findFrame(tabId: number, streamId: string): number | null {
  const frames = inventory.get(tabId);
  if (!frames) return null;
  for (const [frameId, list] of frames) if (list.some((s) => s.id === streamId)) return frameId;
  return null;
}

async function sendCommand(tabId: number, frameId: number, command: Record<string, unknown>): Promise<boolean> {
  try {
    await chrome.tabs.sendMessage(tabId, { type: MessageType.WEBRTC_COMMAND, command }, { frameId });
    return true;
  } catch (e) {
    log.warn('下发 WebRTC 命令失败', tabId, frameId, e);
    return false;
  }
}

/**
 * 向整个 tab 的所有 frame 广播命令（不带 frameId）。
 * 用途：SW 重启后内存清单为空，此时不知道流在哪个 frame，只能全问一遍；
 * 没装 MAIN 脚本的 frame 收到 list 也不会有任何副作用。
 */
async function broadcastCommand(tabId: number, command: Record<string, unknown>): Promise<void> {
  try {
    await chrome.tabs.sendMessage(tabId, { type: MessageType.WEBRTC_COMMAND, command });
  } catch { /* 页面未注入桥接脚本（未开启/未刷新）：无接收端属正常 */ }
}

/**
 * 同步动态注册状态。
 * MAIN 世界脚本要能被页面世界执行，必须列进 web_accessible_resources（见 manifest）。
 */
async function syncRegistration(next: boolean): Promise<{ ok: boolean; error?: string }> {
  if (!chrome?.scripting?.registerContentScripts) return { ok: false, error: '当前浏览器不支持动态内容脚本（需 Chrome 96+）' };
  try {
    const existing = await chrome.scripting.getRegisteredContentScripts();
    const ids = existing.filter((s) => s.id === MAIN_SCRIPT_ID || s.id === BRIDGE_SCRIPT_ID).map((s) => s.id);
    if (ids.length) await chrome.scripting.unregisterContentScripts({ ids });
    if (!next) return { ok: true };
    await chrome.scripting.registerContentScripts([
      {
        id: MAIN_SCRIPT_ID,
        matches: ['<all_urls>'],
        js: ['js/webrtc-main.js'],
        runAt: 'document_start',
        allFrames: true,
        world: 'MAIN',
        persistAcrossSessions: true
      },
      {
        id: BRIDGE_SCRIPT_ID,
        matches: ['<all_urls>'],
        js: ['js/webrtc-bridge.js'],
        runAt: 'document_start',
        allFrames: true,
        world: 'ISOLATED',
        persistAcrossSessions: true
      }
    ]);
    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log.error('同步 WebRTC 内容脚本注册失败', msg);
    return { ok: false, error: msg };
  }
}

async function setEnabled(next: boolean): Promise<{ ok: boolean; error?: string }> {
  const r = await syncRegistration(next);
  if (!r.ok) return r;
  enabled = next;
  try {
    const obj = await chrome.storage.local.get(SETTINGS_KEY) as Record<string, any>;
    const settings = obj[SETTINGS_KEY] && typeof obj[SETTINGS_KEY] === 'object' ? obj[SETTINGS_KEY] : {};
    await chrome.storage.local.set({ [SETTINGS_KEY]: { ...settings, webrtcCapture: next } });
  } catch (e) {
    log.warn('写入 WebRTC 开关失败', e);
  }
  if (!next) {
    // 关闭即清场：停止进行中的录制，清空清单（脚本已注销，不会再有上报）
    for (const [id, rec] of [...records]) {
      if (rec.state === 'recording') void sendCommand(rec.tabId, rec.frameId, { kind: 'stop', recordId: id });
      records.delete(id);
    }
    inventory.clear();
  }
  return { ok: true };
}

function initSettings(): void {
  try {
    chrome.storage.local.get(SETTINGS_KEY, (res) => {
      enabled = res?.[SETTINGS_KEY]?.webrtcCapture === true;
      // 注册状态可能在别处被清掉（浏览器重装/清理），冷启动时对齐一次
      void syncRegistration(enabled);
    });
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local' || !changes[SETTINGS_KEY]) return;
      const next = changes[SETTINGS_KEY].newValue?.webrtcCapture === true;
      if (next === enabled) return;
      enabled = next;
      void syncRegistration(next);
    });
  } catch { /* noop：读不到设置即保持关闭 */ }
}

export function initWebRtcCaptureHandlers(): void {
  // ── 桥接脚本上行：流清单 / 分块 / 完成 / 状态 ──
  registerBgHandler<WebRtcBridgeEventMessage>(MessageType.WEBRTC_BRIDGE_EVENT, (message, sender) => {
    const tabId = sender.tab?.id;
    if (typeof tabId !== 'number') return { success: false, error: '缺少 tab 归属' };
    const frameId = typeof sender.frameId === 'number' ? sender.frameId : 0;
    const ev = message?.event;
    if (!ev) return { success: false, error: '缺少事件' };

    if (ev.kind === 'hello' || ev.kind === 'streams') {
      let frames = inventory.get(tabId);
      if (!frames) { frames = new Map(); inventory.set(tabId, frames); }
      frames.set(frameId, mergeRtcStreams([], ev.streams));
      broadcast(tabId);
      return { success: true };
    }

    // 分块/完成/状态都必须对应一个后台发起过的录制，且 tab 一致
    const rec = records.get(ev.recordId);
    if (!rec || rec.tabId !== tabId) return { success: false, error: '未知的录制 id' };

    if (ev.kind === 'chunk') {
      // 转交既有链路：total 传 0 表示"边录边送，总数未知"，由 DONE 补齐
      acceptRecordingChunk({ recordId: ev.recordId, seq: ev.seq, total: 0, data: ev.data, meta: ev.meta });
      return { success: true };
    }
    if (ev.kind === 'done') {
      rec.state = 'stopped';
      void acceptRecordingDone({
        recordId: ev.recordId,
        total: ev.total,
        durationMs: ev.durationMs,
        sizeBytes: ev.sizeBytes
      });
      broadcast(tabId);
      return { success: true };
    }
    rec.state = ev.state;
    broadcast(tabId, ev.state === 'error' ? ev.error : undefined);
    return { success: true };
  });

  // ── 面板：查询开关与清单 ──
  registerBgHandler<WebRtcCaptureStatusMessage>(MessageType.WEBRTC_CAPTURE_STATUS, async (message) => {
    let tabId = message?.tabId;
    if (typeof tabId !== 'number') {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      tabId = tab?.id;
    }
    if (typeof tabId !== 'number') return { success: true, enabled, streams: [], recording: {} };
    // 主动要一次清单：SW 重启后内存态会丢，页面里的流其实还在。
    // 已知 frame 就定向问；一个都不知道（刚重启）则全 tab 广播，否则面板会一直空白。
    const frames = inventory.get(tabId);
    if (frames && frames.size) for (const frameId of frames.keys()) void sendCommand(tabId, frameId, { kind: 'list' });
    else if (enabled) void broadcastCommand(tabId, { kind: 'list' });
    return { success: true, enabled, streams: flatten(tabId), recording: recordingFor(tabId) };
  });

  // ── 面板：开/关 ──
  registerBgHandler<WebRtcCaptureToggleMessage>(MessageType.WEBRTC_CAPTURE_TOGGLE, async (message) => {
    const r = await setEnabled(message?.enabled === true);
    return r.ok ? { success: true, enabled } : { success: false, error: r.error };
  });

  // ── 面板：开始录制 ──
  registerBgHandler<WebRtcCaptureStartMessage>(MessageType.WEBRTC_CAPTURE_START, async (message) => {
    if (!enabled) return { success: false, error: '请先开启 WebRTC 捕获并刷新页面' };
    const tabId = message?.tabId;
    const streamId = message?.streamId;
    if (typeof tabId !== 'number' || !streamId) return { success: false, error: '缺少 tabId 或 streamId' };
    const frameId = findFrame(tabId, streamId);
    if (frameId === null) return { success: false, error: '该流已不存在，请刷新列表' };
    const mode = message?.mode === 'audio' ? 'audio' : 'video';
    const recordId = makeRtcRecordId(Date.now(), Math.random());
    records.set(recordId, { tabId, frameId, streamId, state: 'recording' });
    const ok = await sendCommand(tabId, frameId, { kind: 'start', recordId, streamId, mode, fileName: '' });
    if (!ok) { records.delete(recordId); return { success: false, error: '页面未响应（可能已刷新或关闭），请重新扫描' }; }
    broadcast(tabId);
    return { success: true, recordId };
  });

  // ── 面板：停止录制 ──
  registerBgHandler<WebRtcCaptureStopMessage>(MessageType.WEBRTC_CAPTURE_STOP, async (message) => {
    const rec = records.get(message?.recordId || '');
    if (!rec) return { success: false, error: '该录制已结束或不存在' };
    const ok = await sendCommand(rec.tabId, rec.frameId, { kind: 'stop', recordId: message.recordId });
    return ok ? { success: true } : { success: false, error: '页面未响应，录制可能已随页面关闭而中断' };
  });

  // tab 关闭：清清单与归属（分块缓冲由 captureRecording 的孤儿超时兜底）
  try {
    chrome.tabs.onRemoved.addListener((tabId) => {
      inventory.delete(tabId);
      for (const [id, r] of [...records]) if (r.tabId === tabId) records.delete(id);
    });
  } catch { /* noop */ }

  initSettings();
  log.info('WebRTC 录流处理器已注册');
}