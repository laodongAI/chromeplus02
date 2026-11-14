/**
 * 外挂下载器（Round 5 #30）——后台效果层。
 *
 * 通道分工（可行性结论）：
 *  - aria2c：JSON-RPC over HTTP，扩展直接 fetch 本地端点即可，无需装 Native Host。
 *    前提是本机已跑 `aria2c --enable-rpc --rpc-origin-whitelist-required=false`；
 *    Origin 校验是这条通道唯一的硬门槛，探测失败时把提示原样带给用户。
 *  - m3u8DL-RE / ffmpeg：必须在用户本机起进程 → 走已有伴生程序（Native Messaging）。
 *    伴生程序未安装时不报错打断下载，而是直接回退内置链路。
 *
 * 失败一律回退内置引擎：外挂工具是"加速器"，不能成为新的单点故障。
 */

import { registerBgHandler } from './bus';
import { MessageType, type ExternalToolsMessage } from '@/messaging';
import { createLogger } from '@/utils/logger';
import { downloadWithCompanionExt, probeCompanionTools } from './companion';
import {
  DEFAULT_EXTERNAL_TOOLS,
  buildAria2AddUriPayload,
  buildAria2TellStatusPayload,
  buildNativeDownloadRequest,
  isSafeRemoteUrl,
  parseAria2Response,
  pickExternalTool,
  type Aria2Status,
  type ExternalJob,
  type ExternalTool,
  type ExternalToolConfig
} from '@/core/externalTools';

const log = createLogger('bg.externalTools');

/** 设置里 externalTools 字段的缓存值（SW 冷启动时从 storage 读取） */
let config: ExternalToolConfig = { ...DEFAULT_EXTERNAL_TOOLS };
const SETTINGS_KEY = 'global_settings_v2';
/** aria2 轮询间隔与总超时：分段大文件用秒级轮询足够，超时后按失败处理并回退 */
const POLL_INTERVAL_MS = 1500;
const POLL_TIMEOUT_MS = 30 * 60_000;

/** 归一化 storage 里的任意形态配置（缺字段/类型漂移都要能用默认值兜底） */
function normalizeConfig(raw: any): ExternalToolConfig {
  const d = DEFAULT_EXTERNAL_TOOLS;
  if (!raw || typeof raw !== 'object') return { ...d };
  return {
    enabled: typeof raw.enabled === 'boolean' ? raw.enabled : d.enabled,
    aria2Rpc: typeof raw.aria2Rpc === 'string' && raw.aria2Rpc.trim() ? raw.aria2Rpc.trim() : d.aria2Rpc,
    aria2Secret: typeof raw.aria2Secret === 'string' ? raw.aria2Secret : d.aria2Secret,
    nativeTool: raw.nativeTool === 'm3u8dl' || raw.nativeTool === 'ffmpeg' ? raw.nativeTool : d.nativeTool,
    preferForStreams: typeof raw.preferForStreams === 'boolean' ? raw.preferForStreams : d.preferForStreams
  };
}

export function initExternalToolsSettings(): void {
  try {
    chrome.storage.local.get(SETTINGS_KEY, (res) => {
      config = normalizeConfig(res?.[SETTINGS_KEY]?.externalTools);
    });
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local' || !changes[SETTINGS_KEY]) return;
      config = normalizeConfig(changes[SETTINGS_KEY].newValue?.externalTools);
    });
  } catch { /* noop：读不到设置即保持默认关闭 */ }
}

/** 供 downloads.ts 判断是否启用（不触发探测） */
export function externalToolsEnabled(): boolean {
  return config.enabled;
}

/**
 * 某类任务当前会走哪个外挂工具；返回 null 表示直接走内置链路。
 * 队列侧用它做前置判断，避免每次任务都调用一次带网络探测的下载入口。
 */
export function externalToolFor(kind: 'stream' | 'file'): ExternalTool | null {
  return pickExternalTool(config, kind);
}

/** 向 aria2 端点发一次 JSON-RPC；网络层错误与协议层错误分别归因 */
async function callAria2(payload: Record<string, unknown>, endpoint: string): Promise<{ ok: boolean; json?: any; error?: string }> {
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!res.ok) {
      // 403 是 Origin 白名单，401/404 多为路径写错，分开提示才能让用户一步修好
      if (res.status === 403) return { ok: false, error: 'aria2 返回 403：请为 aria2c 加 --rpc-origin-whitelist-required=false（或把扩展来源加入 --rpc-origin-whitelist）' };
      return { ok: false, error: `aria2 端点返回 HTTP ${res.status}` };
    }
    return { ok: true, json: await res.json() };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/Failed to fetch|NetworkError|ERR_CONNECTION/i.test(msg)) {
      return { ok: false, error: `连不上 aria2 端点（${endpoint}）：请确认本机已运行 aria2c 并带 --enable-rpc` };
    }
    return { ok: false, error: msg };
  }
}

/** 探测 aria2 是否可用（返回版本串） */
export async function probeAria2(cfg = config): Promise<{ ok: boolean; version?: string; error?: string }> {
  const payload = { jsonrpc: '2.0', id: 'probe', method: 'aria2.getVersion', params: cfg.aria2Secret ? [`token:${cfg.aria2Secret}`] : [] };
  const r = await callAria2(payload, cfg.aria2Rpc);
  if (!r.ok) return { ok: false, error: r.error };
  const parsed = parseAria2Response(r.json);
  if (!parsed.ok) return { ok: false, error: parsed.error };
  const version = (parsed.data as any)?.version;
  return { ok: true, version: typeof version === 'string' ? version : '未知版本' };
}

/** 提交任务给 aria2，拿到 gid */
async function aria2Add(cfg: ExternalToolConfig, job: ExternalJob): Promise<{ ok: boolean; gid?: string; error?: string }> {
  const r = await callAria2(buildAria2AddUriPayload(cfg, job), cfg.aria2Rpc);
  if (!r.ok) return { ok: false, error: r.error };
  const parsed = parseAria2Response(r.json);
  if (!parsed.ok) return { ok: false, error: parsed.error };
  const gid = parsed.data;
  return typeof gid === 'string' && gid ? { ok: true, gid } : { ok: false, error: 'aria2 未返回任务 ID' };
}

/** 查询 aria2 任务状态 */
async function aria2TellStatus(cfg: ExternalToolConfig, gid: string): Promise<{ ok: boolean; status?: Aria2Status; error?: string }> {
  const r = await callAria2(buildAria2TellStatusPayload(cfg, gid), cfg.aria2Rpc);
  if (!r.ok) return { ok: false, error: r.error };
  const parsed = parseAria2Response(r.json);
  if (!parsed.ok) return { ok: false, error: parsed.error };
  return { ok: true, status: parsed.data as Aria2Status };
}

/** 轮询 aria2 直到完成/失败/超时 */
async function aria2Wait(cfg: ExternalToolConfig, gid: string, onProgress?: (pct: number) => void): Promise<{ ok: boolean; error?: string }> {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const st = await aria2TellStatus(cfg, gid);
    if (!st.ok) return { ok: false, error: st.error };
    const s = st.status!;
    onProgress?.(s.progress);
    if (s.status === 'complete') return { ok: true };
    if (s.status === 'error' || s.status === 'removed') return { ok: false, error: s.error || `aria2 任务 ${s.status}` };
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
  return { ok: false, error: 'aria2 任务等待超时' };
}

/** 派发一次外挂下载（按配置选通道）；调用方负责回退内置链路 */
export async function downloadWithExternalTool(
  job: ExternalJob,
  kind: 'stream' | 'file',
  onProgress?: (pct: number) => void
): Promise<{ ok: boolean; tool?: ExternalTool; file?: string; error?: string }> {
  const tool = pickExternalTool(config, kind);
  if (!tool) return { ok: false, error: '未启用外挂下载器' };
  if (!isSafeRemoteUrl(job.url)) return { ok: false, error: '外挂工具只接受 http/https 资源地址' };

  if (tool === 'aria2') {
    const online = await probeAria2();
    if (!online.ok) return { ok: false, tool, error: online.error };
    const add = await aria2Add(config, job);
    if (!add.ok) return { ok: false, tool, error: add.error };
    const wait = await aria2Wait(config, add.gid!, onProgress);
    return wait.ok
      ? { ok: true, tool, file: `aria2 任务 ${add.gid}` }
      : { ok: false, tool, error: wait.error };
  }

  const built = buildNativeDownloadRequest(0, tool, job);
  if (!built.ok || !built.data) return { ok: false, tool, error: built.error };
  const r = await downloadWithCompanionExt(tool, built.data.url, built.data.args, built.data.fileName, onProgress);
  return r.ok ? { ok: true, tool, file: r.file } : { ok: false, tool, error: r.error };
}

/** 状态探测应答形态（面板展示用） */
export interface ExternalToolsStatus {
  success: boolean;
  enabled: boolean;
  config: ExternalToolConfig;
  aria2: { ok: boolean; version?: string; error?: string };
  native: { ok: boolean; tools?: Record<string, boolean>; error?: string };
  error?: string;
}

/**
 * 面板入口：拉取配置 + 探测两条通道。
 * 探测失败不抛错：面板需要"红色原因文案"而不是异常栈。
 */
export async function queryExternalToolsStatus(forceProbe = true): Promise<ExternalToolsStatus> {
  const base: ExternalToolsStatus = {
    success: true,
    enabled: config.enabled,
    config: { ...config },
    aria2: { ok: false, error: '未探测' },
    native: { ok: false, error: '未探测' }
  };
  if (!forceProbe || !config.enabled) return base;
  const [aria2, native] = await Promise.all([
    probeAria2(),
    probeCompanionTools().then((r) => ({
      ok: r.ok,
      tools: r.ok ? (r.data?.available as Record<string, boolean>) : undefined,
      error: r.ok ? undefined : r.error
    }))
  ]);
  return { ...base, aria2, native };
}

export function initExternalToolsHandlers(): void {
  registerBgHandler<ExternalToolsMessage>(MessageType.EXTERNAL_TOOLS_STATUS, async (message) => {
    return queryExternalToolsStatus(message?.force !== false);
  });
  registerBgHandler<ExternalToolsMessage>(MessageType.EXTERNAL_TOOLS_DOWNLOAD, async (message) => {
    const p = message?.payload || {};
    if (!p.url) return { success: false, error: '缺少资源地址' };
    const r = await downloadWithExternalTool(
      { url: p.url, fileName: p.fileName, referer: p.referer, userAgent: p.userAgent },
      p.kind === 'stream' ? 'stream' : 'file',
    );
    return { success: r.ok, tool: r.tool, file: r.file, error: r.error };
  });
  initExternalToolsSettings();
  log.debug('外挂下载器处理器已注册');
}
