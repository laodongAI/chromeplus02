/**
 * 极速下载伴生程序（Native Messaging ↔ 本地 yt-dlp）。
 * 状态机：未安装（connect 失败）/ 在线（ping 通）。开启「极速下载」后，
 * 直链类任务优先派发给伴生程序，失败自动回退内置 chrome.downloads 链路。
 */

import { registerBgHandler } from './bus';

const HOST_NAME = 'com.chromeplus02.media';
const STATUS_TTL_MS = 15_000;

let port: any = null; // chrome.runtime.Port（@types/chrome 0.0.246 未导出 NativePort 类型）
let cachedOnline = false;
let checkedAt = 0;
let enabled = false; // 设置开关（SETTINGS_UPDATE 同步）
let reqSeq = 0;

interface PendingReq {
  resolve: (r: { ok: boolean; error?: string; file?: string }) => void;
  onProgress?: (pct: number) => void;
}

const pending = new Map<number, PendingReq>();

export function setCompanionEnabled(v: boolean): void {
  enabled = v;
  if (!v) { disconnect(); }
}

export function isCompanionEnabled(): boolean {
  return enabled;
}

function connect(): Promise<boolean> {
  if (port) return Promise.resolve(onlineNow());
  return new Promise((resolve) => {
    try {
      const p = chrome.runtime.connectNative(HOST_NAME);
      let settled = false;
      const finish = (ok: boolean) => {
        if (settled) return;
        settled = true;
        cachedOnline = ok;
        checkedAt = Date.now();
        resolve(ok);
      };
      // host 未安装：connect 立即或数秒内报 disconnect
      p.onDisconnect.addListener(() => {
        port = null;
        cachedOnline = false;
        checkedAt = Date.now();
        // 结算所有未完成请求
        pending.forEach(pr => pr.resolve({ ok: false, error: '伴生程序连接断开' }));
        pending.clear();
        finish(false);
      });
      p.onMessage.addListener((msg: any) => {
        if (msg?.type === 'pong') {
          finish(true);
          return;
        }
        if (typeof msg?.reqId === 'number') {
          const pr = pending.get(msg.reqId);
          if (!pr) return;
          if (msg.type === 'progress') { pr.onProgress?.(Number(msg.pct) || 0); return; }
          if (msg.type === 'done') { pending.delete(msg.reqId); pr.resolve({ ok: true, file: msg.file }); return; }
          if (msg.type === 'error') { pending.delete(msg.reqId); pr.resolve({ ok: false, error: String(msg.message || '伴生下载失败') }); return; }
        }
      });
      port = p;
      try { p.postMessage({ type: 'ping' }); } catch { finish(false); }
      setTimeout(() => finish(onlineNow()), 2500);
    } catch {
      port = null;
      cachedOnline = false;
      checkedAt = Date.now();
      resolve(false);
    }
  });
}

function onlineNow(): boolean {
  return !!port && cachedOnline;
}

/** 探测伴生程序是否在线（带 TTL 缓存） */
export async function ensureCompanion(force = false): Promise<boolean> {
  if (!force && onlineNow() && Date.now() - checkedAt < STATUS_TTL_MS) return true;
  if (force) { disconnect(); }
  return connect();
}

/** 缓存查询（不触发连接） */
export function companionLikelyOnline(): boolean {
  return onlineNow() && Date.now() - checkedAt < STATUS_TTL_MS;
}

function disconnect(): void {
  try { port?.disconnect(); } catch { /* noop */ }
  port = null;
  cachedOnline = false;
}

/**
 * 经伴生程序下载。返回 ok=false 时调用方回退内置链路。
 * onProgress 百分比 0-1。
 */
export async function downloadWithCompanion(
  url: string,
  onProgress?: (pct: number) => void
): Promise<{ ok: boolean; error?: string; file?: string }> {
  const online = await ensureCompanion();
  if (!online || !port) return { ok: false, error: '伴生程序未安装或未响应' };
  const reqId = ++reqSeq;
  return new Promise((resolve) => {
    pending.set(reqId, { resolve, onProgress });
    try {
      port!.postMessage({ type: 'download', reqId, url });
    } catch (e) {
      pending.delete(reqId);
      resolve({ ok: false, error: String(e) });
    }
    // 兜底超时：30 分钟（大视频）
    setTimeout(() => {
      if (pending.has(reqId)) {
        pending.delete(reqId);
        resolve({ ok: false, error: '伴生下载超时' });
      }
    }, 30 * 60 * 1000);
  });
}

export function initCompanionSettings(): void {
  try {
    chrome.storage.local.get('global_settings_v2', res => {
      const v = res?.global_settings_v2;
      if (v && typeof v.companion === 'boolean') setCompanionEnabled(v.companion);
    });
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes.global_settings_v2) {
        const v = changes.global_settings_v2.newValue;
        if (v && typeof v.companion === 'boolean') setCompanionEnabled(v.companion);
      }
    });
  } catch { /* noop */ }
}

// ===== 消息处理 =====
export function initCompanionHandlers(): void {
  registerBgHandler('COMPANION_STATUS', async () => {
    const online = await ensureCompanion();
    return { success: true, online, enabled };
  });
  registerBgHandler('COMPANION_RECHECK', async () => {
    const online = await ensureCompanion(true);
    return { success: true, online, enabled };
  });
  initCompanionSettings();
}
