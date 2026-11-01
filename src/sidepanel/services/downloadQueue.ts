import { MessageType, type DownloadQueueSnapshotMessage, type DownloadProgressEventMessage, type DownloadQueueActionMessage } from '@/messaging';
import { sendRuntimeMessage } from '../utils/chromeMessaging';
import { addHistoryRecord } from './downloadHistory';
import { ensureHlsBlobDownloadListener } from './hlsBlobDownload';

export interface DownloadTask {
  id: string;
  url: string;
  fileName?: string;
  kind: 'image' | 'audio' | 'video';
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

// 旧本地并发逻辑移除，统一由后台队列调度。

interface SnapshotTaskShape { id: string; url: string; fileName?: string; kind?: string; status: string; progress?: number; error?: string; errorCode?: string; downloadId?: number; bytesReceived?: number; totalBytes?: number; speedBps?: number; etaSeconds?: number; retries?: number; }
function applySnapshot(tasks: SnapshotTaskShape[]) {
  const map = new Map<string, DownloadTask>();
  queue.forEach(t => map.set(t.id, t));
  tasks.forEach(src => {
    const existing = map.get(src.id);
    if (existing) {
      const wasCompleted = existing.status === 'completed';
      existing.status = src.status as DownloadTask['status'];
      existing.progress = src.progress;
      existing.error = src.error;
      existing.errorCode = src.errorCode || existing.errorCode;
      existing.downloadId = src.downloadId;
      existing.bytesReceived = src.bytesReceived;
      existing.totalBytes = src.totalBytes;
      existing.speedBps = src.speedBps;
      existing.etaSeconds = src.etaSeconds;
      existing.retries = src.retries ?? existing.retries;
      
      if (!wasCompleted && existing.status === 'completed') {
        addHistoryRecord({
          id: existing.id,
          url: existing.url,
          filename: existing.fileName,
          kind: existing.kind || 'other',
          status: 'success',
          size: existing.totalBytes
        });
      } else if (existing.status === 'error' && existing.error) {
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
      const newTask: DownloadTask = { id: src.id, url: src.url, fileName: src.fileName, kind: (src.kind as DownloadTask['kind']) || 'image', messageType: undefined, retries: src.retries ?? 0, status: src.status as DownloadTask['status'], progress: src.progress, error: src.error, errorCode: src.errorCode };
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
        t.progress = evt.progress ?? t.progress;
        t.bytesReceived = evt.bytesReceived ?? t.bytesReceived;
        t.totalBytes = evt.totalBytes ?? t.totalBytes;
        t.downloadId = evt.downloadId ?? t.downloadId;
        t.speedBps = evt.speedBps ?? t.speedBps;
        t.etaSeconds = evt.etaSeconds ?? t.etaSeconds;
        if (evt.state) t.state = evt.state;
        if (evt.error) t.error = evt.error;
        if (evt.errorCode) t.errorCode = evt.errorCode;
        if (evt.finished && t.status !== 'completed') {
          if (evt.error) t.status = 'error';
          else if (t.status !== 'canceled') t.status = 'completed';
        }
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
