/**
 * 极速下载伴生程序（Native Messaging ↔ 本地 yt-dlp）。
 * 状态机：未安装（connect 失败）/ 在线（ping 通）。开启「极速下载」后，
 * 直链类任务优先派发给伴生程序，失败自动回退内置 chrome.downloads 链路。
 */

import { registerBgHandler } from './bus';
import { MessageType } from '@/messaging';
import { createLogger } from '@/utils/logger';
import { isSafeRemoteUrl } from '@/core/externalTools';

/** 本模块 logger：记录伴生程序连接状态、下载派发与桌面标注控制等里程碑 */
const log = createLogger('bg.companion');

const HOST_NAME = 'com.chromeplus02.media';
const STATUS_TTL_MS = 15_000;
/**
 * ping 探测超时（毫秒）。
 * 原值 2500 对 PowerShell 冷启动偏紧（Defender 实时扫描等场景可到 3-4 秒），
 * 放宽到 6 秒；即便超时也不拆端口，迟到的 pong 仍能把状态翻转为在线（见 pong 处理）。
 */
const PING_TIMEOUT_MS = 6_000;

let port: any = null; // chrome.runtime.Port（@types/chrome 0.0.246 未导出 NativePort 类型）
let cachedOnline = false;
let checkedAt = 0;
let enabled = false; // 设置开关（SETTINGS_UPDATE 同步）
let reqSeq = 0;

interface PendingReq {
  resolve: (r: { ok: boolean; error?: string; file?: string }) => void;
  onProgress?: (pct: number) => void;
}

/** 桌面标注层操作结果（由伴生程序回传） */
export interface OverlayResult {
  ok: boolean;
  running?: boolean;
  pid?: number;
  error?: string;
}

const pending = new Map<number, PendingReq>();

/** 桌面标注层控制请求的待应答回调（reqId → resolve） */
const pendingOverlay = new Map<number, (r: OverlayResult) => void>();

/**
 * 外挂下载器请求（tools_probe / download_ext）的待应答回调。
 * 与 pending（yt-dlp 极速下载）分开：应答形态不同（后者带 data/available 字段），
 * 混在一张表里会让 progress/done 的判定互相污染。
 */
const pendingExt = new Map<number, {
  resolve: (r: ExtResult) => void;
  onProgress?: (pct: number) => void;
}>();

/** 外挂工具请求的应答（data 为 host 侧原样回传的工具输出摘要） */
export interface ExtResult {
  ok: boolean;
  data?: any;
  file?: string;
  error?: string;
}

export function setCompanionEnabled(v: boolean): void {
  enabled = v;
  if (!v) { disconnect(); }
}

export function isCompanionEnabled(): boolean {
  return enabled;
}

/** pong 等待者队列：补发探测时挂起本次调用的 settle 回调，pong 到达时统一结算 */
let pingWaiters: Array<(ok: boolean) => void> = [];

/**
 * 等待一次 pong：把本次调用的结算回调挂入等待队列，超时按当前在线状态结算。
 * 用于"端口已建但未确认在线"的补探场景，避免调用方无限挂起。
 */
function waitPong(): Promise<boolean> {
  return new Promise((resolve) => {
    let done = false; // 结算幂等标记：超时与 pong 只生效一次
    const settle = (ok: boolean) => { if (!done) { done = true; resolve(ok); } };
    pingWaiters.push(settle);
    setTimeout(() => settle(onlineNow()), PING_TIMEOUT_MS);
  });
}

/** 结算全部 pong 等待者（pong 到达传 true；探测超时传 false） */
function settlePingWaiters(ok: boolean): void {
  const ws = pingWaiters;
  pingWaiters = [];
  ws.forEach(w => w(ok));
}

function connect(): Promise<boolean> {
  // 端口已建立：在线直接返回；未确认在线（如上次首探超时）则补发一次 ping 并等待，
  // 修复旧实现"首探超时后 if (port) return onlineNow() 恒为 false"的卡死问题
  if (port) {
    if (onlineNow()) return Promise.resolve(true);
    log.debug('伴生程序端口已存在但未确认在线，补发 ping 探测');
    try { port.postMessage({ type: 'ping' }); } catch { /* 发送失败由下方超时兜底 */ }
    return waitPong();
  }
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
        log.warn('伴生程序连接断开（未安装、被终止或通信异常）');
        port = null;
        cachedOnline = false;
        checkedAt = Date.now();
        // 结算所有未完成请求
        pending.forEach(pr => pr.resolve({ ok: false, error: '伴生程序连接断开' }));
        pending.clear();
        // 桌面标注控制请求同样按失败结算，避免侧栏按钮一直转圈
        pendingOverlay.forEach(cb => cb({ ok: false, error: '伴生程序连接断开' }));
        pendingOverlay.clear();
        // 外挂工具请求同上
        pendingExt.forEach(pr => pr.resolve({ ok: false, error: '伴生程序连接断开' }));
        pendingExt.clear();
        // 补探等待者一并结算，避免挂起
        settlePingWaiters(false);
        finish(false);
      });
      p.onMessage.addListener((msg: any) => {
        if (msg?.type === 'pong') {
          // 迟到 pong 也翻转在线状态并刷新时间戳：
          // 首探超时判离线后 host 才就绪时，下一次调用即可自愈，不再永久误报"未响应"
          cachedOnline = true;
          checkedAt = Date.now();
          settlePingWaiters(true);
          finish(true);
          return;
        }
        // 桌面标注控制应答（overlay_started / overlay_stopped / overlay_state / error）
        if (typeof msg?.reqId === 'number' && pendingOverlay.has(msg.reqId)) {
          const cb = pendingOverlay.get(msg.reqId)!;
          pendingOverlay.delete(msg.reqId);
          if (msg.type === 'error') {
            cb({ ok: false, error: String(msg.message || '桌面标注操作失败') });
            return;
          }
          cb({
            ok: msg.ok !== false,
            running: msg.type === 'overlay_started' ? true
              : msg.type === 'overlay_stopped' ? false
                : !!msg.running,
            pid: Number(msg.pid) || undefined
          });
          return;
        }
        // 外挂下载器应答（tools_probe / download_ext 的 progress、ext_result、done、error）
        if (typeof msg?.reqId === 'number' && pendingExt.has(msg.reqId)) {
          const pr = pendingExt.get(msg.reqId)!;
          if (msg.type === 'progress') { pr.onProgress?.(Number(msg.pct) || 0); return; }
          pendingExt.delete(msg.reqId);
          if (msg.type === 'error') { pr.resolve({ ok: false, error: String(msg.message || '外挂工具执行失败') }); return; }
          if (msg.type === 'done') { pr.resolve({ ok: true, file: msg.file, data: msg }); return; }
          pr.resolve({ ok: msg.ok !== false, data: msg, error: msg.ok === false ? String(msg.message || '外挂工具请求失败') : undefined });
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
      log.debug('正在连接伴生程序并发送 ping 探测');
      try { p.postMessage({ type: 'ping' }); } catch { finish(false); }
      // 首探超时：判离线但不拆端口——host 可能只是启动慢，迟到 pong 会自愈（见 pong 处理）
      setTimeout(() => { settlePingWaiters(false); finish(false); }, PING_TIMEOUT_MS);
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
  const ok = await connect();
  log[ok ? 'info' : 'warn'](`伴生程序探测结果：${ok ? '在线' : '离线/未安装'}`);
  return ok;
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
  // 与 download_ext 同一道闸门：URL 来自网页，含双引号即可闭合 host 侧的引号注入额外 yt-dlp 参数
  if (!isSafeRemoteUrl(url)) return { ok: false, error: '极速下载只接受 http/https 资源地址' };
  const online = await ensureCompanion();
  if (!online || !port) return { ok: false, error: '伴生程序未安装或未响应' };
  const reqId = ++reqSeq;
  log.info(`派发极速下载任务 #${reqId}：${url.slice(0, 120)}`);
  return new Promise((resolve) => {
    // 包装一层结算日志：成功/失败都留痕，便于排查回退内置链路的原因
    pending.set(reqId, {
      resolve: (r) => {
        if (r.ok) log.info(`极速下载任务 #${reqId} 完成：${r.file || '(未回传路径)'}`);
        else log.error(`极速下载任务 #${reqId} 失败：${r.error || '未知错误'}（调用方将回退内置下载）`);
        resolve(r);
      },
      onProgress
    });
    try {
      port!.postMessage({ type: 'download', reqId, url });
    } catch (e) {
      pending.delete(reqId);
      log.error(`极速下载任务 #${reqId} 消息发送异常：${e}`);
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

/**
 * 向伴生程序发送外挂工具请求（tools_probe / download_ext）并等待应答。
 * 与 downloadWithCompanion 分开：后者的协议固定是 yt-dlp 极速下载，
 * 前者承载"argv 由扩展侧构造、host 只负责启动"的通用命令派发。
 * @param payload 请求体（type 之外的字段原样透传）
 * @param onProgress host 侧 progress 帧回调（0-1）
 * @param timeoutMs 超时；探测类请求短，下载类请求长
 */
export async function requestCompanionExt(
  payload: Record<string, unknown>,
  onProgress?: (pct: number) => void,
  timeoutMs = 20_000
): Promise<ExtResult> {
  const online = await ensureCompanion();
  if (!online || !port) return { ok: false, error: '伴生程序未安装或未响应（外挂本机工具需要 companion/host.ps1）' };
  const reqId = ++reqSeq;
  return new Promise((resolve) => {
    pendingExt.set(reqId, {
      resolve: (r) => {
        log[r.ok ? 'info' : 'error'](`外挂工具请求 #${reqId}（${String(payload.type)}）${r.ok ? '完成' : `失败：${r.error || '未知错误'}`}`);
        resolve(r);
      },
      onProgress
    });
    try {
      port!.postMessage({ ...payload, reqId });
    } catch (e) {
      pendingExt.delete(reqId);
      resolve({ ok: false, error: String(e) });
      return;
    }
    setTimeout(() => {
      if (pendingExt.has(reqId)) {
        pendingExt.delete(reqId);
        resolve({ ok: false, error: '外挂工具响应超时' });
      }
    }, timeoutMs);
  });
}

/** 探测本机可用的外挂工具（m3u8DL-RE / ffmpeg 是否放在 companion\bin） */
export function probeCompanionTools(): Promise<ExtResult> {
  return requestCompanionExt({ type: 'tools_probe' }, undefined, 12_000);
}

/**
 * 经伴生程序调用本机外挂工具下载。
 * args 由扩展侧的纯模块构造（argv 数组），host 不再拼 shell 字符串。
 */
export function downloadWithCompanionExt(
  tool: 'm3u8dl' | 'ffmpeg',
  url: string,
  args: string[],
  fileName: string,
  onProgress?: (pct: number) => void
): Promise<ExtResult> {
  return requestCompanionExt({ type: 'download_ext', tool, url, args, fileName }, onProgress, 30 * 60_000);
}

/**
 * 向伴生程序发送桌面标注控制请求并等待应答。
 * 伴生程序未在线时直接返回失败（由侧栏提示用户安装/开启）。
 * @param kind 请求类型：overlay_start / overlay_stop / overlay_status
 */
function requestOverlay(kind: 'overlay_start' | 'overlay_stop' | 'overlay_status'): Promise<OverlayResult> {
  return new Promise((resolve) => {
    void (async () => {
      const online = await ensureCompanion();
      if (!online || !port) {
        resolve({ ok: false, error: '伴生程序未安装或未响应，无法控制桌面标注（请先安装 companion）' });
        return;
      }
      const reqId = ++reqSeq;
      log.info(`桌面标注控制请求 #${reqId}：${kind}`);
      // 超时兜底：正常启动只需数百毫秒，8 秒仍无应答视为失败
      const timer = setTimeout(() => {
        pendingOverlay.delete(reqId);
        log.error(`桌面标注控制请求 #${reqId} 超时（8s 无应答）：${kind}`);
        resolve({ ok: false, error: '桌面标注响应超时' });
      }, 8000);
      pendingOverlay.set(reqId, (r) => {
        clearTimeout(timer);
        resolve(r);
      });
      try {
        port!.postMessage({ type: kind, reqId });
      } catch (e) {
        clearTimeout(timer);
        pendingOverlay.delete(reqId);
        resolve({ ok: false, error: String(e) });
      }
    })();
  });
}

/** 启动桌面标注层（覆盖整个桌面的透明画布） */
export function startDesktopOverlay(): Promise<OverlayResult> {
  return requestOverlay('overlay_start');
}

/** 停止桌面标注层 */
export function stopDesktopOverlay(): Promise<OverlayResult> {
  return requestOverlay('overlay_stop');
}

/** 查询桌面标注层运行状态 */
export function queryDesktopOverlay(): Promise<OverlayResult> {
  return requestOverlay('overlay_status');
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
  registerBgHandler(MessageType.COMPANION_STATUS, async () => {
    const online = await ensureCompanion();
    return { success: true, online, enabled };
  });
  registerBgHandler(MessageType.COMPANION_RECHECK, async () => {
    const online = await ensureCompanion(true);
    return { success: true, online, enabled };
  });
  // 桌面标注层：启动 / 停止 / 状态查询（应答统一为 { success, running, pid?, error? }）
  registerBgHandler(MessageType.DESKTOP_OVERLAY_START, async () => {
    const r = await startDesktopOverlay();
    return { success: r.ok, running: r.running ?? r.ok, pid: r.pid, error: r.error };
  });
  registerBgHandler(MessageType.DESKTOP_OVERLAY_STOP, async () => {
    const r = await stopDesktopOverlay();
    return { success: r.ok, running: r.running ?? false, error: r.error };
  });
  registerBgHandler(MessageType.DESKTOP_OVERLAY_STATUS, async () => {
    const r = await queryDesktopOverlay();
    return { success: r.ok, running: !!r.running, error: r.error };
  });
  initCompanionSettings();
}
