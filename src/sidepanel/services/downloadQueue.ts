import { MessageType, type DownloadQueueSnapshotMessage, type DownloadProgressEventMessage, type DownloadQueueActionMessage, type DownloadQueueSnapshotTask, type StartDownloadPayload } from '@/messaging';
import { sendRuntimeMessage } from '../utils/chromeMessaging';
import { addHistoryRecord } from './downloadHistory';
import { ensureHlsBlobDownloadListener } from './hlsBlobDownload';
import { pageSourceFields, ensurePageSourceTracking } from './pageSource';
// 下载台账：类型/状态语义与历史状态映射统一走 core 纯函数层
import { normalizeKind, toHistoryStatus, type DownloadKind } from '@/core/downloadTaxonomy';

export interface DownloadTask {
  id: string;
  url: string;
  fileName?: string;
  kind: DownloadKind;
  /**
   * 下载引擎：后台快照携带，用于「进行中/近期任务」区分来源方式。
   * local = 侧栏已产出的本地产物（文本导出 / 资源包 zip / 录制），不经下载器。
   */
  engine?: 'direct' | 'hls' | 'local';
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
  /** 发起下载的页面（台账「只看本页」的依据，见 core/downloadTaxonomy.isSameSource） */
  sourceUrl?: string;
  sourceTitle?: string;
  sourceTabId?: number;
  /** 本地产物在 IDB blobStore 中的键，仅 engine=local 的登记任务有 */
  idbKey?: string;
}

const queue: DownloadTask[] = [];
const AUTO_PRUNE_SECONDS = 120;
let pruneTimer: number | null = null;

function emitUpdate() {
  window.dispatchEvent(new CustomEvent('download-queue-update', { detail: snapshot() }));
  schedulePrune();
}

export function snapshot() { return queue.map(q => ({ ...q })); }

/** 入队时附带的来源页字段 */
type SourceFields = { sourceUrl?: string; sourceTitle?: string; sourceTabId?: number };

/**
 * 读当前页来源，并顺带确保 tab 切换跟踪已装上。
 * 同步返回缓存值、不 await 查询：登记本地产物的路径可能在 IndexedDB 回调里执行，
 * 为了一次 tabs.query 把台账写入排到微任务之后，会打乱「产物到达 → 立刻有记录」的时序。
 */
function readCurrentSource(): SourceFields {
  ensurePageSourceTracking();
  return pageSourceFields();
}

/**
 * 直链下载入队。
 * @param url 资源地址
 * @param fileName 目标文件名（可选，缺省由后台按命名模板生成）
 * @param kind 媒体类型
 * @param messageType 兼容旧调用方记录的原始消息类型
 * @param sourceOverride 来源页覆盖：重试历史记录时必须传记录自己的来源，
 *        否则「这条是哪个页面下的」会被改写成当前打开的页面（张冠李戴）。
 *        缺省则自动附带当前活动页。
 */
export async function addDownload(
  url: string,
  fileName: string | undefined,
  kind: DownloadKind,
  messageType?: MessageType | string,
  sourceOverride?: { sourceUrl?: string; sourceTitle?: string; sourceTabId?: number }
) {
  const source = sourceOverride ?? readCurrentSource();
  const actionMsg: DownloadQueueActionMessage = {
    type: MessageType.DOWNLOAD_QUEUE_ACTION,
    action: 'add',
    task: { url, filename: fileName, kind, ...source },
  };
  const resp = await sendRuntimeMessage<{ success?: boolean; id?: string }>(actionMsg);
  if (resp?.id) {
    const task: DownloadTask = { id: resp.id, url, fileName, kind, messageType, retries: 0, status: 'pending', progress: 0, ...source };
    queue.push(task); emitUpdate();
    return resp.id;
  }
  return '';
}

/**
 * HLS / DASH 分片流下载入队（走后台 START_HLS_DOWNLOAD 专用链路）。
 * 与 addDownload 一样自动附带来源页：侧栏发出的消息 sender.tab 是空的，
 * 后台只能按 sender.tab 回落到「无来源」，所以这一段必须由侧栏自己带上，
 * 否则视频这条最主要的路径在「只看本页」里永远是空的。
 * @param url 播放清单地址（m3u8 / mpd）
 * @param fileName 可选文件名，缺省由后台按命名模板生成
 * @returns 后台应答（含 task id 与 success/error）
 */
export async function startHlsDownload(url: string, fileName?: string) {
  return sendRuntimeMessage<{ success?: boolean; id?: string; error?: string }>({
    type: MessageType.START_HLS_DOWNLOAD,
    payload: { url, filename: fileName, ...readCurrentSource() },
  });
}

/**
 * 把「已经产出的本地产物」登记进下载台账（需求1）。
 * 适用于文本导出、资源包 zip、录制产物：下载动作已经在侧栏完成，
 * 后台只负责留一条已完成记录并托管 blob 的生命周期（删除时一并清 IDB）。
 * @param opts.url      展示/溯源用的地址（本地产物可用文件名或来源页地址）
 * @param opts.idbKey   产物 blob 在 IDB 中的键；删除任务时后台按它清理
 * @param opts.totalBytes 体积，列表里直接显示
 * @returns 台账任务 id；后台不可用时返回空串（调用方不必为此中断主流程）
 */
export async function registerLocalArtifact(opts: {
  url: string;
  fileName?: string;
  kind?: DownloadKind;
  idbKey?: string;
  totalBytes?: number;
}): Promise<string> {
  const payload: StartDownloadPayload = { ...readCurrentSource(), ...opts };
  try {
    const resp = await sendRuntimeMessage<{ success?: boolean; id?: string }>({
      type: MessageType.DOWNLOAD_QUEUE_ACTION, action: 'register', task: payload,
    });
    return resp?.success && resp.id ? resp.id : '';
  } catch {
    // 登记失败只是少一条台账记录，不应让用户的导出/录制结果丢失
    return '';
  }
}

/** 从台账中删除一条任务（本地产物会连带清理其 IDB blob） */
export async function removeDownloadTask(id: string): Promise<boolean> {
  if (!id) return false;
  try {
    await sendRuntimeMessage({ type: MessageType.DOWNLOAD_QUEUE_ACTION, action: 'remove', id });
  } catch { /* 后台不可达时仍要清掉本地视图，由下一次快照对齐 */ }
  const idx = queue.findIndex(t => t.id === id);
  if (idx >= 0) { queue.splice(idx, 1); emitUpdate(); }
  return true;
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

/** 后台快照里的单任务形态：直接复用消息协议定义，避免两侧字段漂移 */
type SnapshotTaskShape = DownloadQueueSnapshotTask;

/**
 * 是否应该为该终态写一条历史记录。
 * 保留的既有约束：失败但既无错误信息又无错误码时不写（避免历史里出现
 * 一条「失败」却没有任何原因可看的记录，见 downloadQueueSnapshot 单测）。
 * 台账扩展点：canceled 现在也入档——用户取消的任务此前凭空消失、无从重试。
 * @param t 队列任务（已按快照更新完字段）
 * @param status 该任务对应的历史终态
 */
function shouldRecord(t: DownloadTask, status: 'success' | 'failed' | 'canceled'): boolean {
  if (status !== 'failed') return true;
  return !!t.error || !!t.errorCode;
}

/** 由快照任务组装一条历史记录（历史与队列共用同一份来源/产物字段） */
function historyFromTask(t: DownloadTask, status: 'success' | 'failed' | 'canceled') {
  return {
    id: t.id,
    url: t.url,
    filename: t.fileName,
    kind: normalizeKind(t.kind),
    status,
    size: t.totalBytes,
    // 失败原因：优先错误信息，退而取错误码（DRM / NETWORK / INTERRUPTED…），
    // 只有两者的有无才决定是否入档，见 shouldRecord
    error: status === 'failed' ? (t.error || t.errorCode) : undefined,
    sourceUrl: t.sourceUrl,
    sourceTitle: t.sourceTitle,
    sourceTabId: t.sourceTabId,
    idbKey: t.idbKey,
    engine: t.engine,
  };
}

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
      // 来源页与产物键以快照为准（登记类任务的这些字段只在后台侧生成）
      existing.sourceUrl = src.sourceUrl ?? existing.sourceUrl;
      existing.sourceTitle = src.sourceTitle ?? existing.sourceTitle;
      existing.sourceTabId = src.sourceTabId ?? existing.sourceTabId;
      existing.idbKey = src.idbKey ?? existing.idbKey;
      existing.kind = normalizeKind(src.kind ?? existing.kind);

      // 历史只由"非终态 → 终态"的跃迁触发；error 任务在后续快照中反复出现不再重复记录
      // （downloadHistory 内部另有同 ID 同内容的去重兜底）
      const nextHist = toHistoryStatus(existing.status);
      const prevHist = toHistoryStatus(prevStatus);
      if (nextHist && nextHist !== prevHist && shouldRecord(existing, nextHist)) {
        addHistoryRecord(historyFromTask(existing, nextHist));
      }
    } else {
      const newTask: DownloadTask = {
        id: src.id, url: src.url, fileName: src.fileName,
        kind: normalizeKind(src.kind), engine: src.engine,
        messageType: undefined, retries: src.retries ?? 0,
        status: src.status as DownloadTask['status'], progress: src.progress,
        error: src.error, errorCode: src.errorCode,
        // 体积/进度一并带上：侧栏未打开期间跑完的任务、以及登记类本地产物
        // 只有这一次快照机会，漏掉 totalBytes 历史里就永远没有大小
        bytesReceived: src.bytesReceived, totalBytes: src.totalBytes,
        sourceUrl: src.sourceUrl, sourceTitle: src.sourceTitle, sourceTabId: src.sourceTabId,
        idbKey: src.idbKey,
      };
      queue.push(newTask);
      // 侧栏未开时后台已经跑完的任务、以及登记进来的本地产物，
      // 首次见到就已是终态：按同一套映射入档，保证「每种抓取都有一条记录」
      const histStatus = toHistoryStatus(newTask.status);
      if (histStatus && shouldRecord(newTask, histStatus)) addHistoryRecord(historyFromTask(newTask, histStatus));
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
