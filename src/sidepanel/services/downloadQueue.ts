import { MessageType, type DownloadQueueSnapshotMessage, type DownloadProgressEventMessage, type DownloadQueueActionMessage } from '@/messaging';
import { sendRuntimeMessage } from '../utils/chromeMessaging';
import { addHistoryRecord } from './downloadHistory';
import { ensureHlsBlobDownloadListener } from './hlsBlobDownload';

export interface DownloadTask {
  id: string;
  url: string;
  fileName?: string;
  kind: 'image' | 'audio' | 'video';
  /** 下载引擎：后台快照携带，用于「进行中/近期任务」区分 HLS 与直链 */
  engine?: 'direct' | 'hls';
  messageType?: MessageType | string; // allow legacy
  status: 'pending' | 'running' | 'paused' | 'completed' | 'error' | 'canceled';
  error?: string;
  errorCode?: string; // DRM | CORS | PERMISSION | NO_RESOURCE | NETWORK | INTERRUPTED | UNKNOWN
  progress?: number; // 0-1
  downloadId?: number; // chrome.downloads id
  bytesReceived?: number;
  totalBytes?: number;
  state?: string;
  speedBps?: number; // average speed since start
  etaSeconds?: number; // estimated remaining seconds
  startedAt?: number;
  finishedAt?: number;
  retries?: number;
  autoRetrying?: boolean;
}

const queue: DownloadTask[] = [];
const AUTO_PRUNE_SECONDS = 120;
let pruneTimer: number | null = null;

function emitUpdate() {
  window.dispatchEvent(new CustomEvent('download-queue-update', { detail: snapshot() }));
  schedulePrune();
}

export function snapshot() { return queue.map(q => ({ ...q })); }

export async function addDownload(url: string, fileName: string | undefined, kind: DownloadTask['kind'], messageType?: MessageType | string) {
  const actionMsg: DownloadQueueActionMessage = { type: MessageType.DOWNLOAD_QUEUE_ACTION, action: 'add', task: { url, filename: fileName, kind } };
  const resp = await sendRuntimeMessage<{ success?: boolean; id?: string }>(actionMsg);
  if (resp?.id) {
    const task: DownloadTask = { id: resp.id, url, fileName, kind, messageType, retries: 0, status: 'pending', progress: 0 };
    queue.push(task); emitUpdate();
    return resp.id;
  }
  return '';
}

export async function cancelDownload(id: string) {
  await sendRuntimeMessage({ type: MessageType.DOWNLOAD_QUEUE_ACTION, action: 'cancel', id });
}

export async function retryDownload(id: string){
  await sendRuntimeMessage({ type: MessageType.DOWNLOAD_QUEUE_ACTION, action: 'retry', id });
}

export async function pauseAllDownloads(){
  await sendRuntimeMessage({ type: MessageType.DOWNLOAD_QUEUE_ACTION, action: 'pause_all' });
}
export async function resumeAllDownloads(){
  await sendRuntimeMessage({ type: MessageType.DOWNLOAD_QUEUE_ACTION, action: 'resume_all' });
}
export async function retryFailedAllDownloads(){
  await sendRuntimeMessage({ type: MessageType.DOWNLOAD_QUEUE_ACTION, action: 'retry_failed_all' });
}

/**
 * 判断下载队列是否已全部落定（UI 第一批 · 评审 P1：全局下载条收尾用）。
 * "落定"指不存在 pending/running/paused 的进行中任务，全部处于
 * completed/error/canceled 终态；空队列视为未落定（此时下载条本身隐藏）。
 * 纯函数、无副作用，便于单测与组件按状态决定"可关闭/可跳转"。
 * @param tasks 当前队列快照
 */
export function isQueueSettled(tasks: DownloadTask[]): boolean {
  if (tasks.length === 0) return false;
  return tasks.every(t => t.status === 'completed' || t.status === 'error' || t.status === 'canceled');
}

// 旧本地并发逻辑移除，统一由后台队列调度。

interface SnapshotTaskShape { id: string; url: string; fileName?: string; kind?: string; engine?: 'direct' | 'hls'; status: string; progress?: number; error?: string; errorCode?: string; downloadId?: number; bytesReceived?: number; totalBytes?: number; speedBps?: number; etaSeconds?: number; retries?: number; }
function applySnapshot(tasks: SnapshotTaskShape[]) {
  const map = new Map<string, DownloadTask>();
  queue.forEach(t => map.set(t.id, t));
  tasks.forEach(src => {
    const existing = map.get(src.id);
    if (existing) {
      // 记录覆盖前的状态，用于"仅在状态真正跃迁时写历史"（旧逻辑对 error 任务每次快照都重复写历史）
      const prevStatus = existing.status;
      existing.status = src.status as DownloadTask['status'];
      existing.engine = src.engine ?? existing.engine;
      existing.progress = src.progress;
      existing.error = src.error;
      existing.errorCode = src.errorCode || existing.errorCode;
      existing.downloadId = src.downloadId;
      existing.bytesReceived = src.bytesReceived;
      existing.totalBytes = src.totalBytes;
      existing.speedBps = src.speedBps;
      existing.etaSeconds = src.etaSeconds;
      existing.retries = src.retries ?? existing.retries;

      // 历史只由"非终态 → 终态"的跃迁触发；error 任务在后续快照中反复出现不再重复记录
      // （downloadHistory 内部另有同 ID 同内容的去重兜底）
      if (prevStatus !== 'completed' && existing.status === 'completed') {
        addHistoryRecord({
          id: existing.id,
          url: existing.url,
          filename: existing.fileName,
          kind: existing.kind || 'other',
          status: 'success',
          size: existing.totalBytes
        });
      } else if (prevStatus !== 'error' && existing.status === 'error' && existing.error) {
        addHistoryRecord({
          id: existing.id,
          url: existing.url,
          filename: existing.fileName,
          kind: existing.kind || 'other',
          status: 'failed',
          error: existing.error,
          size: existing.totalBytes
        });
      }
    } else {
      const newTask: DownloadTask = { id: src.id, url: src.url, fileName: src.fileName, kind: (src.kind as DownloadTask['kind']) || 'image', engine: src.engine, messageType: undefined, retries: src.retries ?? 0, status: src.status as DownloadTask['status'], progress: src.progress, error: src.error, errorCode: src.errorCode };
      queue.push(newTask);
      if (newTask.status === 'completed') {
        addHistoryRecord({
          id: newTask.id,
          url: newTask.url,
          filename: newTask.fileName,
          kind: newTask.kind || 'other',
          status: 'success',
          size: newTask.totalBytes
        });
      } else if (newTask.status === 'error' && newTask.error) {
        addHistoryRecord({
          id: newTask.id,
          url: newTask.url,
          filename: newTask.fileName,
          kind: newTask.kind || 'other',
          status: 'failed',
          error: newTask.error,
          size: newTask.totalBytes
        });
      }
    }
  });
  // 移除已不存在任务（后台已清理）
  for (let i = queue.length - 1; i >= 0; i--) {
    if (!tasks.find(t => t.id === queue[i].id)) queue.splice(i, 1);
  }
  emitUpdate();
}

// 订阅接口（简单事件监听封装）
export type QueueListener = (tasks: DownloadTask[]) => void;
export function subscribe(listener: QueueListener){
  ensureRuntimeProgressListener();
  const handler = (e: Event) => { listener((e as CustomEvent).detail); };
  window.addEventListener('download-queue-update', handler);
  // 初始推送
  listener(snapshot());
  return () => window.removeEventListener('download-queue-update', handler);
}

function schedulePrune(){
  if(pruneTimer) return;
  pruneTimer = window.setTimeout(()=>{ pruneTimer = null; autoPrune(); }, 10000);
}

function autoPrune(){
  const now = Date.now();
  let changed = false;
  for(let i=queue.length-1; i>=0; i--){
    const t = queue[i];
    if((t.status==='completed' || t.status==='canceled' || t.status==='error') && t.finishedAt && (now - t.finishedAt) > AUTO_PRUNE_SECONDS*1000){
      queue.splice(i,1); changed = true;
    }
  }
  if(changed) emitUpdate();
}

// ===== 运行时下载进度监听 =====
let progressListenerAttached = false;
function ensureRuntimeProgressListener(){
  if (progressListenerAttached) return;
  if (!chrome?.runtime?.onMessage?.addListener) return;
  // HLS 产物接收（Blob 经 IDB 从 SW 交接）
  ensureHlsBlobDownloadListener();
  const handler: Parameters<typeof chrome.runtime.onMessage.addListener>[0] = (message) => {
    if (!message || !message.type) return;
    if (message.type === MessageType.DOWNLOAD_PROGRESS_EVENT) {
      const evt = message as DownloadProgressEventMessage;
      const t = queue.find(q => q.id === evt.id);
      if (t) {
        // 进度事件只驱动局部数值更新（后台已按任务节流）。
        // 状态跃迁与历史记录统一由全量快照驱动（后台仅在结构性变化时发快照），
        // 避免"进度事件先置终态 → 快照跃迁判定失效 → 历史漏记/重复"的双路径竞争。
        t.progress = evt.progress ?? t.progress;
        t.bytesReceived = evt.bytesReceived ?? t.bytesReceived;
        t.totalBytes = evt.totalBytes ?? t.totalBytes;
        t.downloadId = evt.downloadId ?? t.downloadId;
        t.speedBps = evt.speedBps ?? t.speedBps;
        t.etaSeconds = evt.etaSeconds ?? t.etaSeconds;
        if (evt.state) t.state = evt.state;
        if (evt.error) t.error = evt.error;
        if (evt.errorCode) t.errorCode = evt.errorCode;
      }
      emitUpdate();
    } else if (message.type === MessageType.DOWNLOAD_QUEUE_SNAPSHOT) {
      const snap = message as DownloadQueueSnapshotMessage;
      applySnapshot(snap.tasks as unknown as SnapshotTaskShape[]);
    }
  };
  chrome.runtime.onMessage.addListener(handler);
  progressListenerAttached = true;
}
