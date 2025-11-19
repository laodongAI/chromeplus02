/**
 * 后台下载模块（基于 chrome.downloads API）。
 * 说明：需在 manifest.json 中声明权限："downloads"。
 */

import { MessageType, type StartDownloadPayload } from '@/messaging';
import { formatFilename } from '@/utils/format';

// 内部任务结构（后台统一管理队列）
interface BgDownloadTask {
  id: string;
  url: string;
  fileName?: string;
  kind?: string;
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
let autoScan: boolean | undefined; // 预留：内容脚本增量扫描开关
let running = 0;
let progressAttached = false;
let queuePaused = false; // 全局暂停标记：阻止新任务启动

export function initDownloadsMessageHandler() {
  if (!chrome?.runtime?.onMessage) return;
  try { attachProgressEvents(); } catch { /* noop */ }
  loadInitialSettings();
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || !message.type) return;
    // 旧直链下载消息兼容：直接入队
    if (
      message.type === MessageType.START_DOWNLOAD ||
      message.type === MessageType.DIRECT_VIDEO_DOWNLOAD ||
      message.type === 'DIRECT_DOWNLOAD_GENERIC'
    ) {
      const payload = message.payload as StartDownloadPayload;
      const id = enqueue(payload.url, payload.filename, inferKind(message.type));
      sendResponse({ success: true, id });
      return true;
    }
    // 新队列动作
    if (message.type === MessageType.DOWNLOAD_QUEUE_ACTION) {
      try {
        const action = message.action as string;
        if (action === 'add') {
          const t = message.task || {};
          const id = enqueue(t.url, t.filename, t.kind);
          sendResponse({ success: true, id });
        } else if (action === 'cancel') {
          cancelTask(message.id as string); sendResponse({ success: true });
        } else if (action === 'retry') {
          retryTask(message.id as string); sendResponse({ success: true });
        } else if (action === 'pause_all') {
          pauseAll(); sendResponse({ success: true });
        } else if (action === 'resume_all') {
          resumeAll(); sendResponse({ success: true });
        } else if (action === 'retry_failed_all') {
          retryFailedAll(); sendResponse({ success: true });
        } else {
          sendResponse({ success: false, error: '未知动作' });
        }
      } catch (e) { sendResponse({ success: false, error: String(e) }); }
      return true;
    }
    if (message.type === MessageType.DOWNLOAD_QUEUE_SNAPSHOT) {
      sendResponse({ success: true, tasks: serializeQueue() });
      return true;
    }
    if (message.type === MessageType.SETTINGS_UPDATE) {
      try {
        const payload = message.payload || {};
        applySettings(payload);
        sendResponse({ success: true });
      } catch (e) { sendResponse({ success: false, error: String(e) }); }
      return true;
    }
  });
}

function inferKind(mt: MessageType | string): string | undefined {
  if (mt === MessageType.DIRECT_VIDEO_DOWNLOAD) return 'video';
  if (mt === MessageType.START_DOWNLOAD) return 'audio';
  if (mt === 'DIRECT_DOWNLOAD_GENERIC') return 'image';
  return undefined;
}

function enqueue(url: string, fileName?: string, kind?: string) {
  const task: BgDownloadTask = { id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, url, fileName, kind, status: 'pending', progress: 0, retries: 0 };
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
  queue.push(task); broadcastSnapshot(); drain(); return task.id;
}

function cancelTask(id: string) {
  const t = queue.find(q => q.id === id); if (!t) return;
  if (t.status === 'running') { /* chrome.downloads 没有直接取消：模拟标记 */ }
  t.status = 'canceled'; t.finishedAt = Date.now(); broadcastProgress(t);
}

function retryTask(id: string) {
  const t = queue.find(q => q.id === id); if (!t) return;
  if (t.status !== 'error' && t.status !== 'canceled') return;
  t.status = 'pending'; t.error = undefined; t.progress = 0; t.retries = (t.retries || 0) + 1; broadcastProgress(t); drain();
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
    const id = await startDownload({ url: task.url, filename: task.fileName || task.url.split('/').pop() || 'file' });
    task.downloadId = id;
  } catch (e) {
    task.error = e instanceof Error ? e.message : String(e);
    task.errorCode = classifyError(task.error) || 'UNKNOWN';
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
}

async function startDownload(payload: StartDownloadPayload): Promise<number> {
  return new Promise((resolve, reject) => {
    try {
      chrome.downloads.download(
        {
          url: payload.url,
          filename: payload.filename,
          saveAs: true,
          conflictAction: 'uniquify',
        },
        (downloadId) => {
          if (chrome.runtime.lastError) {
            reject(chrome.runtime.lastError.message);
            return;
          }
          if (typeof downloadId !== 'number') {
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
        let rawReason: string | undefined = (d?.error?.current) || (d?.error?.previous);
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
  if (typeof s.autoScan === 'boolean') autoScan = s.autoScan;
  // 持久化
  try { chrome.storage.local.set({ global_settings_v1: { namingTemplate, maxConcurrent: concurrency, autoScan } }); } catch { /* noop */ }
  if (templateChanged) retemplatePending();
}

function loadInitialSettings() {
  try {
    chrome.storage.local.get('global_settings_v1', (res) => {
      const s = res?.global_settings_v1 || {};
      if (s) applySettings(s);
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

// ===== 自动重试策略 =====
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
  setTimeout(()=>{
    if (task.status !== 'error') { task.autoRetrying = false; return; }
    task.retries = current + 1;
    task.error = undefined;
    task.errorCode = undefined;
    task.status = 'pending';
    task.progress = 0;
    task.downloadId = undefined;
    task.bytesReceived = undefined;
    task.totalBytes = undefined;
    task.speedBps = undefined;
    task.etaSeconds = undefined;
    task.startedAt = undefined;
    task.finishedAt = undefined;
    task.autoRetrying = false;
    broadcastProgress(task);
    drain();
  }, delay);
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
    if (t.status === 'running' && typeof t.downloadId === 'number') {
      try { chrome.downloads.pause(t.downloadId); } catch { /* noop */ }
      t.status = 'paused';
    }
  });
  broadcastSnapshot();
}
function resumeAll(){
  queuePaused = false;
  queue.forEach(t => {
    if (t.status === 'paused' && typeof t.downloadId === 'number') {
      try { chrome.downloads.resume(t.downloadId); } catch { /* noop */ }
      t.status = 'running';
    }
  });
  broadcastSnapshot();
  drain();
}
function retryFailedAll(){
  queue.forEach(t => {
    if (t.status === 'error') {
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
      t.retries = (t.retries||0)+1;
    }
  });
  broadcastSnapshot();
  drain();
}
