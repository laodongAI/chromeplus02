/**
 * 后台下载模块（基于 chrome.downloads API）。
 * 说明：需在 manifest.json 中声明权限："downloads"、"alarms"。
 * MV3 生命周期：队列状态防抖持久化到 chrome.storage.local，
 * Service Worker 被杀后重启时可恢复队列并与浏览器下载状态重新对齐；
 * 自动重试使用 chrome.alarms（setTimeout 在 SW 挂起后会丢失）。
 */

import {
  MessageType,
  type StartDownloadPayload,
  type DirectDownloadMessage,
  type DownloadQueueActionMessage,
  type SettingsUpdateMessage,
  type StartHlsDownloadMessage
} from '@/messaging';
import { inferKind, type DownloadKind } from '@/core/downloadTaxonomy';
import { STORE_HLS_BLOBS, STORE_HLS_SEGMENTS, idbDelete, idbDeleteByPrefix } from '@/shared/blobStore';
import { formatFilename } from '@/utils/format';
// P1-8：分级日志（SW 上下文默认 info 级）
import { createLogger } from '@/utils/logger';
import { registerBgHandler } from './bus';
import { prepareMediaTask, runHlsDownload, hlsAbort, isAbortError, type HlsTaskMeta } from './hls';
import { downloadWithCompanion, isCompanionEnabled, ensureCompanion } from './companion';
// Round 5 #30：外挂下载器（aria2 RPC / 伴生程序调用 m3u8DL-RE、ffmpeg），失败一律回退内置链路
import { downloadWithExternalTool, externalToolFor } from './externalTools';

/** 本模块 logger：保留原 `[downloads]` 前缀语义 */
const log = createLogger('downloads');

// 内部任务结构（后台统一管理队列）
interface BgDownloadTask {
  id: string;
  url: string;
  fileName?: string;
  kind?: DownloadKind;
  /** 来源页地址：外挂工具需要它做 Referer（内置 chrome.downloads 用不上） */
  referer?: string;
  /**
   * 发起下载的页面地址/标题/tab id（下载台账 · 需求4）。
   * 与 referer 独立：referer 参与网络请求，sourceUrl 只供侧栏做「本页任务」筛选，
   * 页面关掉后字段仍在（历史里能看到「这条是哪个页面下的」）。
   */
  sourceUrl?: string;
  sourceTitle?: string;
  sourceTabId?: number;
  /**
   * 本地产物在 IndexedDB blobStore 中的键（登记类任务专用，见 register 动作）。
   * 这类任务没有远程 URL、也没经过下载器，idbKey 是它唯一的可再保存凭据。
   */
  idbKey?: string;
  /** direct: chrome.downloads 直链；hls: m3u8 分片下载+合并；local: 侧栏已产出的本地产物 */
  engine?: 'direct' | 'hls' | 'local';
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

  // 直链下载消息（兼容三种类型：audio/video/image 共用 payload 形态，P1-1 泛型收窄）
  const enqueueHandler = (kind: DownloadKind) => (message: DirectDownloadMessage, sender: chrome.runtime.MessageSender) => {
    const payload = message.payload as StartDownloadPayload;
    const id = enqueue(payload.url, payload.filename, kind, payload.referer, sourceOf(payload, sender));
    return { success: true, id };
  };
  registerBgHandler<DirectDownloadMessage>(MessageType.START_DOWNLOAD, enqueueHandler('audio'));
  registerBgHandler<DirectDownloadMessage>(MessageType.DIRECT_VIDEO_DOWNLOAD, enqueueHandler('video'));
  registerBgHandler<DirectDownloadMessage>(MessageType.DIRECT_DOWNLOAD_GENERIC, enqueueHandler('image'));

  // 队列动作
  registerBgHandler<DownloadQueueActionMessage>(MessageType.DOWNLOAD_QUEUE_ACTION, (message, sender) => {
    const action = message.action as string;
    switch (action) {
      case 'add': {
        // 缺省 task 保持旧行为（url=undefined 入队，由后续下载流程报错处理）
        const t = message.task || ({} as StartDownloadPayload);
        const id = enqueue(t.url, t.filename, t.kind, t.referer, sourceOf(t, sender));
        return { success: true, id };
      }
      case 'register': {
        // 本地产物登记（文本导出 / 资源包 zip / 录制产物）：不进下载器、不占并发
        const t = message.task;
        if (!t?.url) return { success: false, error: '缺少登记条目地址' };
        const id = registerLocalArtifact(t, sender);
        return { success: true, id };
      }
      case 'remove': {
        const removed = removeTask(message.id as string);
        return { success: removed, id: message.id };
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

  registerBgHandler<StartHlsDownloadMessage>(MessageType.START_HLS_DOWNLOAD, (message, sender) => {
    const payload = message?.payload;
    if (!payload?.url) return { success: false, error: '缺少播放清单地址' };
    const id = enqueueHls(payload.url, payload.filename, payload.referer, sourceOf(payload, sender));
    return { success: true, id };
  });

  registerBgHandler<SettingsUpdateMessage>(MessageType.SETTINGS_UPDATE, (message) => {
    applySettings(message?.payload || {});
    return { success: true };
  });
}

/**
 * 来源页元信息（下载台账 · 需求4）。
 * 侧栏与内容脚本都能填，填不上时后台回落到 sender.tab（见 sourceOf）。
 */
interface TaskSourceMeta {
  sourceUrl?: string;
  sourceTitle?: string;
  sourceTabId?: number;
}

/**
 * 归一化来源页：显式字段优先，缺失时回落到消息发送方的 tab。
 * 为什么要双路：内容脚本直接发起的下载（页面上的下载按钮）不会带 sourceUrl，
 * 但 sender.tab 就是那个页面；侧栏发起的下载 sender.tab 是 undefined（侧栏不是 tab），
 * 只能靠侧栏显式传当前活动页。两路合并后所有抓取入口都能被「只看本页」命中。
 * @param payload 消息里携带的字段（可能全空）
 * @param sender  chrome 运行时给出的发送方
 */
function sourceOf(payload: TaskSourceMeta | undefined, sender: chrome.runtime.MessageSender): TaskSourceMeta {
  const tab = sender?.tab;
  return {
    sourceUrl: payload?.sourceUrl || tab?.url || undefined,
    sourceTitle: payload?.sourceTitle || tab?.title || undefined,
    sourceTabId: payload?.sourceTabId ?? tab?.id,
  };
}

function enqueue(url: string, fileName?: string, kind?: DownloadKind, referer?: string, meta?: TaskSourceMeta) {
  const task: BgDownloadTask = {
    id: genTaskId(), url, fileName,
    // 未显式给类型的入口（如兼容旧调用）按文件名/URL 扩展名归类，
    // 台账里就不会出现「未分类」这种查不到的记录
    kind: kind ?? inferKind({ fileName, url }),
    referer, engine: 'direct', status: 'pending', progress: 0, retries: 0,
    sourceUrl: meta?.sourceUrl, sourceTitle: meta?.sourceTitle, sourceTabId: meta?.sourceTabId,
  };
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
function enqueueHls(url: string, fileName?: string, referer?: string, meta?: TaskSourceMeta) {
  const task: BgDownloadTask = {
    id: genTaskId(), url, kind: 'video', referer, engine: 'hls', status: 'pending', progress: 0, retries: 0,
    sourceUrl: meta?.sourceUrl, sourceTitle: meta?.sourceTitle, sourceTabId: meta?.sourceTabId,
  };
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

/**
 * 登记「已经产出的本地产物」为一条已完成任务（下载台账 · 需求1）。
 *
 * 为什么需要这条路：文本导出、资源包 zip、录制产物的下载动作在侧栏就完成了
 * （blob → chrome.downloads.download 或 IDB 交接），从未经过后台队列。
 * 此前它们不进台账，导致「每种抓取都要在下载里有一条记录」做不到。
 * 登记出来的任务直接是 completed：不入待执行队列、不占并发、不会被 drain 拾起，
 * 也不会有后续快照把它改状态。
 *
 * 按 idbKey 幂等：同一产物重复登记（例如快照竞态下的二次提交）只刷新字段，不产生第二条记录。
 * @param payload url=产物展示名/来源地址，idbKey=IDB 中 blob 的键，totalBytes=体积
 * @param sender  消息发送方，用于回落来源页
 */
function registerLocalArtifact(payload: StartDownloadPayload, sender: chrome.runtime.MessageSender) {
  const meta = sourceOf(payload, sender);
  const fileName = payload.filename || safeBaseNameQuiet(payload.url);
  const kind = payload.kind ?? inferKind({ fileName, url: payload.url });
  const existing = payload.idbKey
    ? queue.find(t => t.idbKey === payload.idbKey)
    : undefined;
  if (existing) {
    existing.fileName = fileName;
    existing.kind = kind;
    existing.totalBytes = payload.totalBytes ?? existing.totalBytes;
    existing.sourceUrl = meta.sourceUrl ?? existing.sourceUrl;
    existing.sourceTitle = meta.sourceTitle ?? existing.sourceTitle;
    existing.sourceTabId = meta.sourceTabId ?? existing.sourceTabId;
    broadcastSnapshot(); schedulePersist();
    return existing.id;
  }
  const now = Date.now();
  const task: BgDownloadTask = {
    id: genTaskId(),
    url: payload.url,
    fileName,
    kind,
    engine: 'local',
    status: 'completed',
    progress: 1,
    finishedAt: now,
    totalBytes: payload.totalBytes,
    idbKey: payload.idbKey,
    sourceUrl: meta.sourceUrl,
    sourceTitle: meta.sourceTitle,
    sourceTabId: meta.sourceTabId,
  };
  queue.push(task);
  broadcastSnapshot(); schedulePersist();
  return task.id;
}

/** 取不到安全文件名时的兜底展示名（登记路径不允许因为 URL 畸形而抛错） */
function safeBaseNameQuiet(url: string): string {
  try { return safeBaseName(url) || 'file'; } catch { return 'file'; }
}

/**
 * 从台账中删除一条任务。
 * 语义边界：只删「队列里的这一条」以及它专属的本地产物 blob，
 * 已落盘的浏览器下载文件不在此删（那需要用户在界面上明确选择删除文件，
 * 由侧栏按 chrome.downloads.removeFile 单独发起）。
 * 进行中的任务先走取消，避免删掉记录后后台仍在写同一个下载。
 * @returns 是否真的删掉了一条
 */
function removeTask(id: string): boolean {
  const idx = queue.findIndex(t => t.id === id);
  if (idx < 0) return false;
  const task = queue[idx];
  if (task.status === 'pending' || task.status === 'running' || task.status === 'paused') {
    cancelTask(id);
  }
  if (task.engine === 'hls') {
    // 分片键约定是 `${taskId}:*`（见 hls.ts）；取消路径通常已清，这里兜住异常残留
    void idbDeleteByPrefix(STORE_HLS_SEGMENTS, `${id}:`).catch(() => { /* noop */ });
  }
  if (task.idbKey) {
    void idbDelete(STORE_HLS_BLOBS, task.idbKey).catch(() => { /* noop */ });
  }
  queue.splice(idx, 1);
  releaseThrottleState(id);
  broadcastSnapshot(); schedulePersist();
  return true;
}

function cancelTask(id: string) {
  const t = queue.find(q => q.id === id); if (!t) return;
  t.status = 'canceled'; t.finishedAt = Date.now();
  if (t.engine === 'hls') {
    // 中止分片抓取并清理分片缓存
    hlsAbort(t.id, 'cancel');
    notifyStatusChange(t); releaseThrottleState(t.id);
    return;
  }
  // 直链：已发起的浏览器下载调用 chrome.downloads.cancel 终止
  if (typeof t.downloadId === 'number') {
    try { chrome.downloads.cancel(t.downloadId); } catch { /* noop */ }
  }
  notifyStatusChange(t); releaseThrottleState(t.id);
}

/** 统一的重试前置清理（重试 / 批量重试 / 自动重试共用） */
function resetTaskForRetry(t: BgDownloadTask) {
  // 重试将产生新的字节序列：重置测速窗口，避免旧样本污染瞬时速度
  resetSpeedSamples(t.id);
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
  // 登记类本地产物没有可重放的远程地址（url 只是展示名），重试只会拿它去下载而必然失败。
  // 界面在这类条目上提供的是「重新保存到本地」（按 idbKey 取回 blob），不是重试。
  if (t.engine === 'local') return;
  resetTaskForRetry(t);
  notifyStatusChange(t); drain();
}

/**
 * 调度器：把空闲并发额度填满。
 * 旧实现每次只启动一个任务、靠任务 finally 续杯，导致恢复队列 / resumeAll /
 * retryFailedAll 只调一次 drain 时退化为串行，maxConcurrent 形同虚设。
 * 现改为循环取 pending 直到 running 达到并发上限；runTask 在首个 await 前
 * 同步将任务置为 running 并递增计数，因此不会重复取到同一任务。
 * 边界：只消费 pending 状态；paused / error / canceled / completed / running 均不启动；
 * 全局暂停（queuePaused）时直接返回，恢复入口（resumeAll）负责再次调用 drain。
 */
function drain() {
  if (queuePaused) return;
  while (running < concurrency) {
    const next = queue.find(q => q.status === 'pending');
    if (!next) break;
    runTask(next).finally(() => { drain(); });
  }
}

async function runTask(task: BgDownloadTask) {
  // 新一轮执行：重置测速窗口（重试/恢复重跑时旧样本与新字节数不连续）
  resetSpeedSamples(task.id);
  // 状态进入 running：结构性变化，立即广播（drain 循环依赖这里同步置位防止重复取任务）
  running++; task.status = 'running'; task.startedAt = Date.now(); notifyStatusChange(task);
  try {
    if (task.engine === 'hls') {
      // Round 5 #30：勾选「分段流也交给外挂」时先试 m3u8DL-RE / ffmpeg / aria2，
      // 失败继续走内置引擎（内置已处理加密清单、重试与 Blob 交接，不能因外挂缺失而丢任务）
      if (externalToolFor('stream')) {
        const ext = await downloadWithExternalTool(
          { url: task.url, fileName: task.fileName, referer: task.referer },
          'stream',
          pct => { task.progress = Math.min(0.99, pct); notifyProgressUpdate(task); }
        );
        if (ext.ok) {
          if (ext.file) task.fileName = ext.file;
          task.progress = 1; task.status = 'completed'; task.finishedAt = Date.now();
          notifyStatusChange(task); releaseThrottleState(task.id);
          return;
        }
        log.warn(`外挂分段流下载失败，回退内置 HLS 引擎：${ext.error}`);
      }
      // HLS：解析清单 → 分片并发下载 → 合并 → Blob 交接侧边栏保存
      const meta = (task.hls && task.hls.segTotal) ? task.hls : await prepareMediaTask(task.url);
      task.hls = meta;
      // 仅元数据就绪、状态未变：走节流进度通道即可
      notifyProgressUpdate(task);
      const base = stripExt(task.fileName || 'video') || 'video';
      const finalName = await runHlsDownload(task.id, meta, base, (done, total, bytes) => {
        task.progress = total > 0 ? Math.min(1, done / total) : 0;
        if (bytes > 0) task.bytesReceived = bytes;
        notifyProgressUpdate(task);
      });
      task.fileName = finalName;
      task.progress = 1; task.status = 'completed'; task.finishedAt = Date.now();
      notifyStatusChange(task); releaseThrottleState(task.id);
      return;
    }
    // Round 5 #30：外挂下载器（aria2 / m3u8DL-RE / ffmpeg）优先于伴生 yt-dlp 与内置直链；
    // 未启用时 externalToolFor 返回 null，这里不做任何额外探测
    if (externalToolFor('file')) {
      const ext = await downloadWithExternalTool(
        { url: task.url, fileName: task.fileName, referer: task.referer },
        'file',
        pct => { task.progress = Math.min(0.99, pct); notifyProgressUpdate(task); }
      );
      if (ext.ok) {
        if (ext.file) task.fileName = ext.file;
        task.progress = 1; task.status = 'completed'; task.finishedAt = Date.now();
        notifyStatusChange(task); releaseThrottleState(task.id);
        return;
      }
      log.warn(`外挂下载失败，回退后续链路：${ext.error}`);
    }
    // 极速下载：开启且伴生程序在线时优先派发（yt-dlp 支持数千站点），失败回退内置直链
    if (isCompanionEnabled() && await ensureCompanion()) {
      const r = await downloadWithCompanion(task.url, pct => {
        task.progress = Math.min(0.99, pct);
        notifyProgressUpdate(task);
      });
      if (r.ok) {
        if (r.file) task.fileName = r.file;
        task.progress = 1; task.status = 'completed'; task.finishedAt = Date.now();
        notifyStatusChange(task); releaseThrottleState(task.id);
        return;
      }
      log.warn('伴生下载失败，回退直链:', r.error);
    }
    try {
      const id = await startDownload({ url: task.url, filename: task.fileName || task.url.split('/').pop() || 'file' });
      task.downloadId = id;
      // 启动期间任务被取消：立即终止刚创建的浏览器下载
      if ((task.status as string) === 'canceled') {
        try { chrome.downloads.cancel(id); } catch { /* noop */ }
      }
    } catch (e) {
      log.error('下载任务启动失败:', task.url, e);
      task.error = e instanceof Error ? e.message : String(e);
      task.errorCode = classifyError(task.error) || 'UNKNOWN';
      task.status = 'error'; task.finishedAt = Date.now();
      notifyStatusChange(task); releaseThrottleState(task.id);
      handleAutoRetry(task);
      return;
    }
  } catch (e) {
    if (isAbortError(e)) {
      // 状态已由 cancelTask/pauseAll 设置；若仍为 running（异常路径）则回退 pending 等待重跑
      if (task.status === 'running') { task.status = 'pending'; }
      notifyStatusChange(task);
      return;
    }
    log.error('下载任务失败:', task.url, e);
    task.error = e instanceof Error ? e.message : String(e);
    task.errorCode = task.engine === 'hls' ? 'HLS' : (classifyError(task.error) || 'UNKNOWN');
    task.status = 'error'; task.finishedAt = Date.now();
    notifyStatusChange(task); releaseThrottleState(task.id);
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
    retries: t.retries,
    // 下载台账：来源页与本地产物键必须随快照下发，否则侧栏的「只看本页」永远为空
    sourceUrl: t.sourceUrl,
    sourceTitle: t.sourceTitle,
    sourceTabId: t.sourceTabId,
    idbKey: t.idbKey
  }));
}

function broadcastSnapshot() {
  // 带 callback 才不返回 Promise：否则侧栏未开时的 reject 抓不进 try/catch，成为未处理拒绝
  try {
    chrome.runtime.sendMessage({ type: MessageType.DOWNLOAD_QUEUE_SNAPSHOT, tasks: serializeQueue(), paused: queuePaused }, () => { void chrome.runtime.lastError; });
  } catch { /* 扩展上下文失效等同步异常 */ }
}

// ===== 进度广播节流（P1-2）=====
/**
 * 背景：每个 chrome.downloads.onChanged 事件都双发"进度事件 + 全量快照"并触发持久化，
 * 侧栏高频重绘、历史模块反复全量写 storage，噪音过大。
 * 策略：
 *  - 纯进度更新（字节/速度/ETA 变化，状态不变）：只发 DOWNLOAD_PROGRESS_EVENT，
 *    按任务节流（窗口内合并，窗口末补发一次保证终值不丢），不再附带全量快照；
 *  - 状态变化（结构性变化）：立即补发在途进度 + 全量快照，侧栏据快照驱动状态与历史记录。
 */
const PROGRESS_THROTTLE_MS = 400;
/** 每任务的进度节流状态：lastAt=最近一次实际发送时间；timer=尾沿补发定时器 */
const progressThrottle = new Map<string, { lastAt: number; timer: ReturnType<typeof setTimeout> | null }>();

/** 组装单任务进度事件负载（与旧 broadcastProgress 字段保持一致，兼容既有消息协议） */
function buildProgressPayload(t: BgDownloadTask) {
  return {
    type: MessageType.DOWNLOAD_PROGRESS_EVENT,
    id: t.id, downloadId: t.downloadId, progress: t.progress,
    bytesReceived: t.bytesReceived, totalBytes: t.totalBytes, state: t.status,
    speedBps: t.speedBps, etaSeconds: t.etaSeconds,
    error: t.error, errorCode: t.errorCode,
    finished: t.status === 'completed' || t.status === 'error' || t.status === 'canceled'
  };
}

/** 立即发送一次进度事件（发送失败视为侧栏未开，静默忽略） */
function sendProgressEvent(t: BgDownloadTask) {
  try { chrome.runtime.sendMessage(buildProgressPayload(t), () => { void chrome.runtime.lastError; }); } catch { /* noop */ }
}

/** 纯进度更新：按任务节流发进度事件，不发全量快照；持久化本身已有防抖，照常调度 */
function notifyProgressUpdate(t: BgDownloadTask) {
  const now = Date.now();
  const st = progressThrottle.get(t.id);
  if (!st) {
    progressThrottle.set(t.id, { lastAt: now, timer: null });
    sendProgressEvent(t);
  } else if (now - st.lastAt >= PROGRESS_THROTTLE_MS) {
    st.lastAt = now;
    sendProgressEvent(t);
  } else if (!st.timer) {
    // 窗口内的更新合并为一次尾沿补发，携带窗口内累计的最新值
    st.timer = setTimeout(() => { st.timer = null; st.lastAt = Date.now(); sendProgressEvent(t); }, PROGRESS_THROTTLE_MS - (now - st.lastAt));
  }
  schedulePersist();
}

/** 状态变化（结构性）：取消在途节流、立即发进度事件 + 全量快照 */
function notifyStatusChange(t: BgDownloadTask) {
  const st = progressThrottle.get(t.id);
  if (st?.timer) { clearTimeout(st.timer); }
  progressThrottle.set(t.id, { lastAt: Date.now(), timer: null });
  sendProgressEvent(t);
  broadcastSnapshot();
  schedulePersist();
}

/** 任务离开队列流转（完成/出错/取消）后清理节流与测速状态，防止 Map 长期增长 */
function releaseThrottleState(id: string) {
  const st = progressThrottle.get(id);
  if (st?.timer) clearTimeout(st.timer);
  progressThrottle.delete(id);
  speedSamples.delete(id);
}

// ===== 瞬时速度（滑动窗口测速）=====
/**
 * 背景：旧实现 speedBps = 总字节 / 自开始累计耗时，是"平均速度"，
 * 下载时间越长显示越"钝"，无法反映当前网络状况。
 * 策略：保留最近 SPEED_WINDOW_MS 内的字节采样点，用窗口斜率求瞬时速度；
 * 窗口样本不足（刚启动/刚恢复）时回退累计平均，避免速度剧烈抖动。
 * 上报字段名保持 speedBps / etaSeconds 不变，侧栏解析不受影响。
 */
const SPEED_WINDOW_MS = 8_000;
/** taskId -> 字节采样序列 [{t: 采样时刻ms, bytes: 累计已收字节}]，按时间升序 */
const speedSamples = new Map<string, { t: number; bytes: number }[]>();

/** 重置某任务的测速采样窗口（开始/暂停/恢复/重试时调用，防止旧样本污染新窗口的斜率） */
function resetSpeedSamples(id: string) {
  speedSamples.delete(id);
}

/**
 * 计算任务的瞬时速度与剩余时间 ETA。
 * @param task 目标任务（读取其 bytesReceived/totalBytes/startedAt）
 * @returns speedBps=窗口斜率（样本不足时回退累计平均）；etaSeconds=按瞬时速度的剩余秒数
 */
function computeInstantSpeed(task: BgDownloadTask): { speedBps?: number; etaSeconds?: number } {
  if (typeof task.bytesReceived !== 'number') return {};
  const now = Date.now();
  let samples = speedSamples.get(task.id);
  if (!samples) { samples = []; speedSamples.set(task.id, samples); }
  samples.push({ t: now, bytes: task.bytesReceived });
  // 丢弃滑出窗口的旧样本（至少保留 2 个点用于求斜率）
  const cutoff = now - SPEED_WINDOW_MS;
  while (samples.length > 2 && samples[0].t < cutoff) samples.shift();

  const head = samples[0];
  const dtSec = (now - head.t) / 1000;
  const dB = task.bytesReceived - head.bytes;
  let speedBps: number | undefined;
  if (samples.length >= 2 && dtSec >= 0.5 && dB > 0) {
    // 窗口内有有效增量：斜率即瞬时速度
    speedBps = dB / dtSec;
  } else if (task.startedAt) {
    // 冷启动/窗口过小：回退累计平均，避免除零或剧烈抖动
    speedBps = task.bytesReceived / Math.max(0.001, (now - task.startedAt) / 1000);
  }
  let etaSeconds: number | undefined;
  if (typeof task.totalBytes === 'number' && task.totalBytes > task.bytesReceived) {
    etaSeconds = speedBps && speedBps > 0 ? Math.round((task.totalBytes - task.bytesReceived) / speedBps) : undefined;
  } else {
    etaSeconds = undefined;
  }
  return { speedBps, etaSeconds };
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
            log.error('Chrome Download API Error:', chrome.runtime.lastError.message, payload);
            reject(chrome.runtime.lastError.message);
            return;
          }
          if (typeof downloadId !== 'number') {
            log.error('Invalid Download ID:', downloadId, payload);
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
      // 记录进入前的状态，用于区分"纯进度更新（节流）"与"状态变化（立即广播）"
      const prevStatus = task.status;
      const state = d?.state?.current;
      const pausedFlag = d?.paused?.current;
      const bytesReceived = d?.bytesReceived?.current;
      const totalBytes = d?.totalBytes?.current;
      if (typeof bytesReceived === 'number') task.bytesReceived = bytesReceived;
      if (typeof totalBytes === 'number') task.totalBytes = totalBytes;
      if (typeof task.bytesReceived === 'number' && typeof task.totalBytes === 'number' && task.totalBytes > 0) {
        task.progress = Math.min(1, Math.max(0, task.bytesReceived / task.totalBytes));
      }
      // 瞬时速度：滑动窗口斜率（替代旧的"累计平均"，字段名与上报口径不变）
      if (typeof task.bytesReceived === 'number' && task.status !== 'paused') {
        const sp = computeInstantSpeed(task);
        task.speedBps = sp.speedBps;
        task.etaSeconds = sp.etaSeconds;
      }
      if (pausedFlag === true) {
        // 进入暂停：重置测速窗口，恢复后不带上暂停前的旧斜率
        if (prevStatus !== 'paused') resetSpeedSamples(task.id);
        task.status = 'paused';
      } else if (state === 'complete') {
        task.status = 'completed'; task.progress = 1; task.finishedAt = Date.now();
      } else if (state === 'interrupted') {
        // 尝试从 delta.error 中获取原因
        const rawReason: string | undefined = (d?.error?.current) || (d?.error?.previous);
        task.finishedAt = Date.now();
        if (rawReason === 'USER_CANCELED') {
          // 用户在浏览器下载界面取消：不是故障，归入已取消且不进自动重试，
          // 否则会被 classifyError 判成 INTERRUPTED 而重新拉起两次，取消形同无效
          task.status = 'canceled';
          task.error = undefined;
          task.errorCode = undefined;
        } else {
          task.status = 'error';
          task.error = rawReason ? `下载中断: ${rawReason}` : '下载中断';
          task.errorCode = classifyError(task.error) || 'INTERRUPTED';
          handleAutoRetry(task);
        }
      } else if (task.status === 'paused' && pausedFlag === false && state === 'in_progress') {
        // 恢复下载：重置测速窗口，从恢复点重新积累瞬时速度样本
        resetSpeedSamples(task.id);
        task.status = 'running';
      }
      // 状态发生变化 → 立即广播（进度事件 + 快照）；仅字节/速度更新 → 节流进度事件
      if (task.status !== prevStatus) {
        notifyStatusChange(task);
        if (task.status === 'completed' || task.status === 'error') releaseThrottleState(task.id);
      } else {
        notifyProgressUpdate(task);
      }
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
      notifyStatusChange(t);
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
