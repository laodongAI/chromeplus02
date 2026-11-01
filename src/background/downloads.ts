/**
 * 后台下载模块（基于 chrome.downloads API）。
 * 说明：需在 manifest.json 中声明权限："downloads"、"alarms"。
 * MV3 生命周期：队列状态防抖持久化到 chrome.storage.local，
 * Service Worker 被杀后重启时可恢复队列并与浏览器下载状态重新对齐；
 * 自动重试使用 chrome.alarms（setTimeout 在 SW 挂起后会丢失）。
 */

import { MessageType, type StartDownloadPayload } from '@/messaging';
import { formatFilename } from '@/utils/format';
import { registerBgHandler } from './bus';
import { prepareHlsTask, runHlsDownload, hlsAbort, isAbortError, type HlsTaskMeta } from './hls';

// 内部任务结构（后台统一管理队列）
interface BgDownloadTask {
  id: string;
  url: string;
  fileName?: string;
  kind?: string;
  /** direct: chrome.downloads 直链；hls: m3u8 分片下载+合并 */
  engine?: 'direct' | 'hls';
  /** HLS 任务元数据（分片清单等，持久化用于断点续传） */
  hls?: HlsTaskMeta;
  status: 'pending' | 'running' | 'paused' | 'completed' | 'error' | 'canceled';
  error?: string;
  errorCode?: string; // DRM | CORS | PERMISSION | NO_RESOURCE | NETWORK | INTERRUPTED | UNKNOWN
  progress?: number;
  downloadId?: number;
  bytesReceived?: number;
  totalBytes?: number;
  speedBps?: number;
  etaSeconds?: number;
  startedAt?: number;
  finishedAt?: number;
  retries?: number;
  templated?: boolean;
  autoRetrying?: boolean;
}

const queue: BgDownloadTask[] = [];
let concurrency = 3;
let namingTemplate: string | undefined;
let running = 0;
let progressAttached = false;
let queuePaused = false; // 全局暂停标记：阻止新任务启动

// ===== 队列持久化（MV3 SW 重启恢复） =====
const PERSIST_KEY = 'bg_download_queue_v1';
const PERSIST_DEBOUNCE_MS = 400;
const PERSIST_MAX_TASKS = 200;
const PERSIST_FINISHED_TTL_MS = 30 * 60 * 1000; // 已结束任务保留 30 分钟
let persistTimer: number | null = null;

function schedulePersist() {
  if (persistTimer !== null) return;
  persistTimer = setTimeout(() => { persistTimer = null; persistNow(); }, PERSIST_DEBOUNCE_MS) as unknown as number;
}

function persistNow() {
  try {
    const now = Date.now();
    // 丢那些结束超过 TTL 的任务，限制总量
    const tasks = queue
      .filter(t => !['completed', 'canceled', 'error'].includes(t.status) || (t.finishedAt && now - t.finishedAt < PERSIST_FINISHED_TTL_MS))
      .slice(-PERSIST_MAX_TASKS)
      .map(t => ({ ...t }));
    chrome.storage.local.set({ [PERSIST_KEY]: { tasks, paused: queuePaused, savedAt: now } });
  } catch { /* noop */ }
}

function searchDownload(id: number): Promise<{ state?: string; paused?: boolean } | null> {
  return new Promise((resolve) => {
    try {
      chrome.downloads.search({ id }, (results) => {
        void chrome.runtime.lastError;
        resolve(results && results.length ? { state: results[0].state, paused: !!results[0].paused } : null);
      });
    } catch { resolve(null); }
  });
}

function restorePersistedQueue() {
  try {
    chrome.storage.local.get(PERSIST_KEY, async (res) => {
      const saved = res?.[PERSIST_KEY] as { tasks?: any[]; paused?: boolean } | undefined;
      if (!saved || !Array.isArray(saved.tasks)) return;
      queuePaused = !!saved.paused;
      for (const raw of saved.tasks) {
        if (!raw || typeof raw.id !== 'string' || typeof raw.url !== 'string') continue;
        const t = { ...raw, autoRetrying: false } as BgDownloadTask;
        // SW 重启前的活跃任务：用 downloadId 与浏览器下载状态重新对齐
        if ((t.status === 'running' || t.status === 'paused') && typeof t.downloadId === 'number') {
          const live = await searchDownload(t.downloadId);
          if (!live) {
            t.status = 'error';
            t.error = '后台休眠导致下载中断';
            t.errorCode = 'INTERRUPTED';
          } else if (live.state === 'complete') {
            t.status = 'completed'; t.progress = 1;
          } else if (live.state === 'interrupted') {
            t.status = 'error'; t.error = '下载中断'; t.errorCode = 'INTERRUPTED';
          } else {
            t.status = live.paused ? 'paused' : 'running';
          }
        } else if (t.status === 'running') {
          // 尚未拿到 downloadId 就被杀：重新入队
          t.status = 'pending';
          t.downloadId = undefined;
        }
        queue.push(t);
      }
      // 中断的任务进入自动重试通道
      queue.forEach(t => { if (t.status === 'error' && t.errorCode === 'INTERRUPTED') handleAutoRetry(t); });
      broadcastSnapshot();
      schedulePersist();
      drain();
    });
  } catch { /* noop */ }
}

export function initDownloadsMessageHandler() {
  if (!chrome?.runtime?.onMessage) return;
  try { attachProgressEvents(); } catch { /* noop */ }
  loadInitialSettings();
  restorePersistedQueue();
  installRetryAlarmHandler();

  // 直链下载消息（兼容三种类型）
  const enqueueHandler = (kind?: string) => (message: any) => {
    const payload = message.payload as StartDownloadPayload;
    const id = enqueue(payload.url, payload.filename, kind);
    return { success: true, id };
  };
  registerBgHandler(MessageType.START_DOWNLOAD, enqueueHandler('audio'));
  registerBgHandler(MessageType.DIRECT_VIDEO_DOWNLOAD, enqueueHandler('video'));
  registerBgHandler('DIRECT_DOWNLOAD_GENERIC', enqueueHandler('image'));

  // 队列动作
  registerBgHandler(MessageType.DOWNLOAD_QUEUE_ACTION, (message) => {
    const action = message.action as string;
    switch (action) {
      case 'add': {
        const t = message.task || {};
        const id = enqueue(t.url, t.filename, t.kind);
        return { success: true, id };
      }
      case 'cancel':
        cancelTask(message.id as string);
        return { success: true };
      case 'retry':
        retryTask(message.id as string);
        return { success: true };
      case 'pause_all':
        pauseAll();
        return { success: true };
      case 'resume_all':
        resumeAll();
        return { success: true };
      case 'retry_failed_all':
        retryFailedAll();
        return { success: true };
      default:
        return { success: false, error: '未知动作' };
    }
  });

  registerBgHandler(MessageType.DOWNLOAD_QUEUE_SNAPSHOT, () => ({ success: true, tasks: serializeQueue(), paused: queuePaused }));

  registerBgHandler(MessageType.START_HLS_DOWNLOAD, (message) => {
    const payload = message?.payload as { url: string; fileName?: string } | undefined;
    if (!payload?.url) return { success: false, error: '缺少播放清单地址' };
    const id = enqueueHls(payload.url, payload.fileName);
    return { success: true, id };
  });

  registerBgHandler(MessageType.SETTINGS_UPDATE, (message) => {
    applySettings(message?.payload || {});
    return { success: true };
  });
}

function enqueue(url: string, fileName?: string, kind?: string) {
  const task: BgDownloadTask = { id: genTaskId(), url, fileName, kind, engine: 'direct', status: 'pending', progress: 0, retries: 0 };
  // 如果未指定文件名并存在命名模板，尝试根据模板生成
  if (!task.fileName) {
    try {
      const base = safeBaseName(url);
      const ext = extractExt(base);
      const siteHost = safeSiteHost(url);
      const index = queue.length; // 入队前的长度作为 index
      if (namingTemplate) {
        const templated = formatFilename(namingTemplate, { site: siteHost, title: stripExt(base), index });
        task.fileName = ext ? `${templated}.${ext}` : templated;
        task.templated = true;
      } else {
        task.fileName = base;
      }
    } catch { task.fileName = fileName || 'file'; }
  }
  queue.push(task); broadcastSnapshot(); schedulePersist(); drain(); return task.id;
}

function genTaskId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/** 创建 HLS（m3u8）下载任务：分片下载+合并，进度走同一队列 */
function enqueueHls(url: string, fileName?: string) {
  const task: BgDownloadTask = { id: genTaskId(), url, kind: 'video', engine: 'hls', status: 'pending', progress: 0, retries: 0 };
  try {
    const base = safeBaseName(url).replace(/\.m3u8$/i, '').replace(/^(playlist|index|manifest)$/i, 'video');
    const siteHost = safeSiteHost(url);
    const index = queue.length;
    if (namingTemplate) {
      task.fileName = formatFilename(namingTemplate, { site: siteHost, title: stripExt(base) || base, index });
      task.templated = true;
    } else {
      task.fileName = base || 'video';
    }
  } catch { task.fileName = fileName || 'video'; }
  queue.push(task); broadcastSnapshot(); schedulePersist(); drain(); return task.id;
}

function cancelTask(id: string) {
  const t = queue.find(q => q.id === id); if (!t) return;
  t.status = 'canceled'; t.finishedAt = Date.now();
  if (t.engine === 'hls') {
    // 中止分片抓取并清理分片缓存
    hlsAbort(t.id, 'cancel');
    broadcastProgress(t);
    return;
  }
  // 直链：已发起的浏览器下载调用 chrome.downloads.cancel 终止
  if (typeof t.downloadId === 'number') {
    try { chrome.downloads.cancel(t.downloadId); } catch { /* noop */ }
  }
  broadcastProgress(t);
}

/** 统一的重试前置清理（重试 / 批量重试 / 自动重试共用） */
function resetTaskForRetry(t: BgDownloadTask) {
  t.status = 'pending';
  t.error = undefined;
  t.errorCode = undefined;
  t.progress = 0;
  t.downloadId = undefined;
  t.bytesReceived = undefined;
  t.totalBytes = undefined;
  t.speedBps = undefined;
  t.etaSeconds = undefined;
  t.startedAt = undefined;
  t.finishedAt = undefined;
  t.retries = (t.retries || 0) + 1;
}

function retryTask(id: string) {
  const t = queue.find(q => q.id === id); if (!t) return;
  if (t.status !== 'error' && t.status !== 'canceled') return;
  resetTaskForRetry(t);
  broadcastProgress(t); drain();
}

function drain() {
  if (queuePaused) return;
  if (running >= concurrency) return;
  const next = queue.find(q => q.status === 'pending');
  if (!next) return;
  runTask(next).finally(() => { drain(); });
}

async function runTask(task: BgDownloadTask) {
  running++; task.status = 'running'; task.startedAt = Date.now(); broadcastProgress(task);
  try {
    if (task.engine === 'hls') {
      // HLS：解析清单 → 分片并发下载 → 合并 → Blob 交接侧边栏保存
      const meta = (task.hls && task.hls.segTotal) ? task.hls : await prepareHlsTask(task.url);
      task.hls = meta;
      broadcastProgress(task);
      const base = stripExt(task.fileName || 'video') || 'video';
      const finalName = await runHlsDownload(task.id, meta, base, (done, total, bytes) => {
        task.progress = total > 0 ? Math.min(1, done / total) : 0;
        if (bytes > 0) task.bytesReceived = bytes;
        broadcastProgress(task);
      });
      task.fileName = finalName;
      task.progress = 1; task.status = 'completed'; task.finishedAt = Date.now(); broadcastProgress(task);
      return;
    }
    try {
      const id = await startDownload({ url: task.url, filename: task.fileName || task.url.split('/').pop() || 'file' });
      task.downloadId = id;
      // 启动期间任务被取消：立即终止刚创建的浏览器下载
      if ((task.status as string) === 'canceled') {
        try { chrome.downloads.cancel(id); } catch { /* noop */ }
      }
    } catch (e) {
      console.error('Download Task Failed:', task.url, e);
      task.error = e instanceof Error ? e.message : String(e);
      task.errorCode = classifyError(task.error) || 'UNKNOWN';
      task.status = 'error'; task.finishedAt = Date.now(); broadcastProgress(task);
      handleAutoRetry(task);
      return;
    }
  } catch (e) {
    if (isAbortError(e)) {
      // 状态已由 cancelTask/pauseAll 设置；若仍为 running（异常路径）则回退 pending 等待重跑
      if (task.status === 'running') { task.status = 'pending'; }
      broadcastProgress(task);
      return;
    }
    console.error('Download Task Failed:', task.url, e);
    task.error = e instanceof Error ? e.message : String(e);
    task.errorCode = task.engine === 'hls' ? 'HLS' : (classifyError(task.error) || 'UNKNOWN');
    task.status = 'error'; task.finishedAt = Date.now(); broadcastProgress(task);
    handleAutoRetry(task);
  } finally { running--; }
}

function serializeQueue() {
  return queue.map(t => ({
    id: t.id,
    url: t.url,
    fileName: t.fileName,
    kind: t.kind,
    engine: t.engine,
    status: t.status,
    progress: t.progress,
    error: t.error,
    errorCode: t.errorCode,
    downloadId: t.downloadId,
    bytesReceived: t.bytesReceived,
    totalBytes: t.totalBytes,
    speedBps: t.speedBps,
    etaSeconds: t.etaSeconds,
    retries: t.retries
  }));
}

function broadcastSnapshot() {
  try { chrome.runtime.sendMessage({ type: MessageType.DOWNLOAD_QUEUE_SNAPSHOT, tasks: serializeQueue(), paused: queuePaused }); } catch { /* noop */ }
}
function broadcastProgress(t: BgDownloadTask) {
  try { chrome.runtime.sendMessage({ type: MessageType.DOWNLOAD_PROGRESS_EVENT, id: t.id, downloadId: t.downloadId, progress: t.progress, bytesReceived: t.bytesReceived, totalBytes: t.totalBytes, state: t.status, speedBps: t.speedBps, etaSeconds: t.etaSeconds, error: t.error, errorCode: t.errorCode, finished: t.status==='completed' || t.status==='error' || t.status==='canceled' }); } catch { /* noop */ }
  broadcastSnapshot();
  schedulePersist();
}

async function startDownload(payload: StartDownloadPayload): Promise<number> {
  return new Promise((resolve, reject) => {
    try {
      chrome.downloads.download(
        {
          url: payload.url,
          filename: payload.filename,
          saveAs: false, // 禁用另存为对话框，确保批量下载顺畅
          conflictAction: 'uniquify',
        },
        (downloadId) => {
          if (chrome.runtime.lastError) {
            console.error('Chrome Download API Error:', chrome.runtime.lastError.message, payload);
            reject(chrome.runtime.lastError.message);
            return;
          }
          if (typeof downloadId !== 'number') {
            console.error('Invalid Download ID:', downloadId, payload);
            reject('下载 ID 无效');
            return;
          }
          resolve(downloadId);
        }
      );
    } catch (e) {
      reject(e);
    }
  });
}

function attachProgressEvents() {
  if (progressAttached) return;
  if (!chrome?.downloads?.onChanged) return;
  chrome.downloads.onChanged.addListener((delta) => {
    try {
      const idNum = (delta as any)?.id as number | undefined;
      if (typeof idNum !== 'number') return;
      const task = queue.find(q => q.downloadId === idNum);
      const d: any = delta;
      if (!task) return; // 仅跟踪队列内任务
      if (task.status === 'canceled') return; // 已取消的任务忽略后续状态变化（cancel 会触发 interrupted 事件）
      const state = d?.state?.current;
      const pausedFlag = d?.paused?.current;
      const bytesReceived = d?.bytesReceived?.current;
      const totalBytes = d?.totalBytes?.current;
      if (typeof bytesReceived === 'number') task.bytesReceived = bytesReceived;
      if (typeof totalBytes === 'number') task.totalBytes = totalBytes;
      if (typeof task.bytesReceived === 'number' && typeof task.totalBytes === 'number' && task.totalBytes > 0) {
        task.progress = Math.min(1, Math.max(0, task.bytesReceived / task.totalBytes));
      }
      if (task.startedAt && typeof task.bytesReceived === 'number') {
        const elapsed = Math.max(0.001, (Date.now() - task.startedAt) / 1000);
        task.speedBps = task.bytesReceived / elapsed;
        if (task.totalBytes && task.totalBytes > task.bytesReceived) {
          const remain = task.totalBytes - task.bytesReceived;
          task.etaSeconds = task.speedBps ? Math.round(remain / task.speedBps) : undefined;
        } else { task.etaSeconds = undefined; }
      }
      if (pausedFlag === true) {
        task.status = 'paused';
      } else if (state === 'complete') {
        task.status = 'completed'; task.progress = 1; task.finishedAt = Date.now();
      } else if (state === 'interrupted') {
        task.status = 'error';
        // 尝试从 delta.error 中获取原因
        const rawReason: string | undefined = (d?.error?.current) || (d?.error?.previous);
        task.error = rawReason ? `下载中断: ${rawReason}` : '下载中断';
        task.errorCode = classifyError(task.error) || 'INTERRUPTED';
        task.finishedAt = Date.now();
        handleAutoRetry(task);
      } else if (task.status === 'paused' && pausedFlag === false && state === 'in_progress') {
        task.status = 'running';
      }
      broadcastProgress(task);
    } catch { /* noop */ }
  });
  progressAttached = true;
}

// ===== 设置处理 =====
function applySettings(s: { namingTemplate?: string; maxConcurrent?: number; autoScan?: boolean }) {
  if (typeof s.maxConcurrent === 'number' && s.maxConcurrent > 0) {
    concurrency = Math.max(1, Math.min(10, Math.floor(s.maxConcurrent)));
    // 并发调整后尝试继续 drain
    drain();
  }
  let templateChanged = false;
  if (typeof s.namingTemplate === 'string') {
    const next = s.namingTemplate.trim() || undefined;
    if (next !== namingTemplate) { namingTemplate = next; templateChanged = true; }
  }
  if (typeof s.autoScan === 'boolean') { /* autoScan 由内容脚本消费（SETTINGS_UPDATE），后台仅接收不使用 */ }
  if (templateChanged) retemplatePending();
  // 注意：v2 (global_settings_v2) 是全量设置唯一真源，由 sidepanel saveSettings 持久化；
  // 后台只保留内存值，避免用部分字段覆盖 v2 中的其他配置（如 ai 配置）。
}

function loadInitialSettings() {
  try {
    // 优先读 v2（唯一真源）；v2 缺失时回退迁移 v1 的三个字段（旧版本兼容）
    chrome.storage.local.get(['global_settings_v2', 'global_settings_v1'], (res) => {
      const v2 = res?.global_settings_v2 as Record<string, unknown> | undefined;
      const v1 = res?.global_settings_v1 as Record<string, unknown> | undefined;
      const s = v2 && Object.keys(v2).length
        ? v2
        : (v1 ? { namingTemplate: v1.namingTemplate, maxConcurrent: v1.maxConcurrent, autoScan: v1.autoScan } : {});
      if (s && Object.keys(s).length) applySettings(s as { namingTemplate?: string; maxConcurrent?: number; autoScan?: boolean });
    });
  } catch { /* noop */ }
}

// ===== 辅助函数 =====
function safeBaseName(url: string) {
  try { const part = url.split('?')[0].split('#')[0]; return part.split('/').pop() || 'file'; } catch { return 'file'; }
}
function extractExt(name: string){ const idx = name.lastIndexOf('.'); return idx>0 && idx < name.length-1 ? name.slice(idx+1) : ''; }
function stripExt(name: string){ const idx = name.lastIndexOf('.'); return idx>0 ? name.slice(0, idx) : name; }
function safeSiteHost(u: string){ try { const h = new URL(u).hostname.replace(/^www\./,''); return h; } catch { return 'site'; } }

function retemplatePending() {
  if (!namingTemplate) return;
  let changed = false;
  queue.forEach((t, i) => {
    if (t.status === 'pending' && t.templated) {
      try {
        const base = safeBaseName(t.url);
        const ext = extractExt(base);
        const siteHost = safeSiteHost(t.url);
        const templated = formatFilename(namingTemplate, { site: siteHost, title: stripExt(base), index: i });
        t.fileName = ext ? `${templated}.${ext}` : templated;
        changed = true;
      } catch { /* noop */ }
    }
  });
  if (changed) broadcastSnapshot();
}

// ===== 自动重试策略（chrome.alarms 驱动，SW 挂起后依然有效） =====
const RETRY_ALARM_PREFIX = 'bg-retry:';
function shouldAutoRetry(code?: string){
  if (!code) return false;
  return code === 'NETWORK' || code === 'INTERRUPTED';
}
const MAX_AUTO_RETRIES: Record<string, number> = { NETWORK: 2, INTERRUPTED: 2 };
function handleAutoRetry(task: BgDownloadTask){
  if (!shouldAutoRetry(task.errorCode)) return;
  const max = MAX_AUTO_RETRIES[task.errorCode!] ?? 0;
  const current = task.retries || 0;
  if (current >= max) return;
  task.autoRetrying = true;
  const delay = 1200 + Math.round(Math.random()*800);
  try {
    chrome.alarms.create(`${RETRY_ALARM_PREFIX}${task.id}`, { when: Date.now() + delay });
  } catch { /* noop：alarms 不可用时放弃自动重试 */ }
}

function installRetryAlarmHandler() {
  try {
    chrome.alarms.onAlarm.addListener((alarm) => {
      if (!alarm?.name?.startsWith(RETRY_ALARM_PREFIX)) return;
      const id = alarm.name.slice(RETRY_ALARM_PREFIX.length);
      const t = queue.find(q => q.id === id);
      if (!t || t.status !== 'error' || !t.autoRetrying) return;
      t.autoRetrying = false;
      resetTaskForRetry(t);
      broadcastProgress(t);
      drain();
    });
  } catch { /* noop */ }
}

// 统一错误分类（基于错误消息简单匹配，可后续扩展为更精细的规则或状态码映射）
function classifyError(msg?: string): string | undefined {
  if (!msg) return undefined;
  const m = msg.toLowerCase();
  if (/(drm)/.test(m)) return 'DRM';
  if (/(cors|cross-origin)/.test(m)) return 'CORS';
  if (/(403|forbidden|unauthorized|permission)/.test(m)) return 'PERMISSION';
  if (/(404|not found|no resource)/.test(m)) return 'NO_RESOURCE';
  if (/(network|timeout|connection|net::err)/.test(m)) return 'NETWORK';
  if (/(interrupt|cancel)/.test(m)) return 'INTERRUPTED';
  return 'UNKNOWN';
}

// ===== 全局暂停/恢复与批量重试 =====
function pauseAll(){
  queuePaused = true;
  queue.forEach(t => {
    if (t.status !== 'running') return;
    if (t.engine === 'hls') {
      // HLS：中止分片抓取（保留已下分片，恢复后续传）
      t.status = 'paused';
      hlsAbort(t.id, 'pause');
      return;
    }
    if (typeof t.downloadId === 'number') {
      try { chrome.downloads.pause(t.downloadId); } catch { /* noop */ }
      t.status = 'paused';
    }
  });
  broadcastSnapshot();
  schedulePersist();
}
function resumeAll(){
  queuePaused = false;
  queue.forEach(t => {
    if (t.status !== 'paused') return;
    if (t.engine === 'hls') {
      // HLS：回到 pending 重新调度，已下分片自动跳过
      t.status = 'pending';
      return;
    }
    if (typeof t.downloadId === 'number') {
      try { chrome.downloads.resume(t.downloadId); } catch { /* noop */ }
      t.status = 'running';
    }
  });
  broadcastSnapshot();
  schedulePersist();
  drain();
}
function retryFailedAll(){
  queue.forEach(t => {
    if (t.status === 'error') resetTaskForRetry(t);
  });
  broadcastSnapshot();
  schedulePersist();
  drain();
}
