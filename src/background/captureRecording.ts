/**
 * 后台：页面录制产物接收与持久化（内容脚本 → 后台 → 侧栏 链路的中间层）。
 *
 * 背景：
 *  - 内容脚本里 MediaRecorder 产出的 Blob 无法经 Chrome 消息通道直接传递
 *    （JSON 通道不支持 Blob），且 webm 在 Windows 默认播放器无法播放；
 *  - 内容脚本把产物切 base64 分块上送（CAPTURE_RECORDING_CHUNK × N + DONE），
 *    本模块拼装为 Blob 后持久化到 IndexedDB（SW 与侧栏同源共享同一 IDB，
 *    复用 shared/blobStore 的 hls-blobs 键值库，键前缀 `caprec_` 与 HLS 隔离），
 *    元数据写 chrome.storage.local（SW 重启不丢），随后广播 CAPTURE_RECORDING_READY，
 *    侧栏"录制成果"列表据此展示：查看（编辑器）/ 转 MP4、M4A 下载 / 删除。
 *
 * 可靠性设计：
 *  - 分块缓冲设孤儿超时（10 分钟未收齐 DONE 即丢弃），防内存泄漏；
 *  - 元数据列表设容量上限（超出淘汰最旧并同步删其 IDB Blob），防 IDB 膨胀；
 *  - 内容脚本侧交接失败时自行回退本地 webm 下载，本模块无需保证"必达"。
 */

import { MessageType, type AnyMessage, type CaptureRecordingMeta } from '@/messaging';
import { registerBgHandler } from './bus';
import { idbDelete, idbPut, STORE_HLS_BLOBS } from '@/shared/blobStore';
// 分级日志（Service Worker 上下文默认 warn 级）
import { createLogger } from '@/utils/logger';

/** 本模块 logger：统一 `[captureRecording]` 前缀 */
const log = createLogger('captureRecording');

/** IDB 中录制产物 Blob 的键前缀（与 HLS 合并产物同库不同前缀，互不干扰） */
export const CAPREC_IDB_PREFIX = 'caprec_';
/** 元数据在 chrome.storage.local 的键（数组，最新在前） */
export const CAPREC_META_STORAGE_KEY = 'capture_recordings_v1';
/** 元数据列表容量上限：超出淘汰最旧（含其 IDB Blob），防无限膨胀 */
export const CAPREC_MAX_STORED = 20;
/** 单个录制分块缓冲的孤儿超时（毫秒）：超时未收齐即丢弃，防 SW 内存泄漏 */
const PENDING_TIMEOUT_MS = 10 * 60 * 1000;

/** 进行中的分块缓冲（recordId → 缓冲项；仅驻留 SW 内存，重启即失） */
interface PendingRecording {
  /** 元数据（随首块到达；理论上必有，缺失时 DONE 按失败处理） */
  meta?: CaptureRecordingMeta;
  /** 分块总数（首块携带的 total 字段） */
  total: number;
  /** 已收到的分块（seq → base64 数据） */
  received: Map<number, string>;
  /** 孤儿超时定时器（DONE 到达或超时时清理） */
  timer: ReturnType<typeof setTimeout>;
}

/** 分块缓冲表（SW 内存态） */
const pending = new Map<string, PendingRecording>();

/**
 * base64 字符串 → Uint8Array（atob 逐段转换）。
 * @param b64 base64 编码数据
 * @returns 原始字节数组
 */
function base64ToUint8Array(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * 纯函数：按容量上限淘汰最旧元数据（最新在前，保留前 cap 条）。
 * 抽为纯函数便于单测（不触碰 chrome/IDB）。
 * @param metas 元数据列表（假定已按 createdAt 降序）
 * @param cap 容量上限
 * @returns { kept: 保留列表, evicted: 被淘汰列表（调用方负责删其 Blob） }
 */
export function evictOverflowMetas(
  metas: CaptureRecordingMeta[],
  cap: number
): { kept: CaptureRecordingMeta[]; evicted: CaptureRecordingMeta[] } {
  if (metas.length <= cap) return { kept: metas, evicted: [] };
  return { kept: metas.slice(0, cap), evicted: metas.slice(cap) };
}

/**
 * 读取元数据列表（storage.local；损坏/缺失时返回空数组）。
 */
async function readMetaList(): Promise<CaptureRecordingMeta[]> {
  const obj = await chrome.storage.local.get(CAPREC_META_STORAGE_KEY) as Record<string, unknown>;
  const list = obj[CAPREC_META_STORAGE_KEY];
  return Array.isArray(list) ? (list as CaptureRecordingMeta[]) : [];
}

/**
 * 写入元数据列表（先做容量淘汰，被淘汰条目的 IDB Blob 一并删除）。
 * @param metas 新列表（最新在前）
 */
async function writeMetaList(metas: CaptureRecordingMeta[]): Promise<void> {
  const { kept, evicted } = evictOverflowMetas(metas, CAPREC_MAX_STORED);
  // 淘汰条目的 Blob 异步删除（失败仅告警，不阻塞主流程）
  for (const m of evicted) {
    idbDelete(STORE_HLS_BLOBS, CAPREC_IDB_PREFIX + m.id).catch((e) => {
      log.warn('淘汰录制产物 Blob 删除失败', m.id, e);
    });
  }
  if (evicted.length > 0) log.info(`录制成果超限，已淘汰最旧 ${evicted.length} 条`);
  await chrome.storage.local.set({ [CAPREC_META_STORAGE_KEY]: kept });
}

/**
 * 拼装已收齐的分块为 Blob 并落库，随后广播 READY。
 * @param recordId 录制 id
 * @param final 边录边送场景（WebRTC）在结束时才确定的总数/时长/体积；一次性交接不传
 * @returns true=成功；false=分块不全或元数据缺失
 */
async function finalizePending(
  recordId: string,
  final?: { total?: number; durationMs?: number; sizeBytes?: number }
): Promise<boolean> {
  const item = pending.get(recordId);
  if (!item) {
    log.warn('DONE 到达但无分块缓冲', recordId);
    return false;
  }
  pending.delete(recordId);
  clearTimeout(item.timer);
  if (final?.total && final.total > 0) item.total = final.total;
  if (item.meta) {
    if (final?.durationMs) item.meta.durationMs = final.durationMs;
    if (final?.sizeBytes) item.meta.sizeBytes = final.sizeBytes;
  }

  // 完整性校验：总数一致且每块齐备
  if (!item.meta || item.received.size < item.total) {
    log.warn('分块不完整，丢弃录制产物', recordId, '收到', item.received.size, '/', item.total);
    return false;
  }
  try {
    // 按序拼接 base64 → 字节 → Blob
    const parts: Uint8Array[] = [];
    for (let seq = 0; seq < item.total; seq++) {
      const b64 = item.received.get(seq);
      if (b64 == null) throw new Error(`缺少分块 ${seq}`);
      parts.push(base64ToUint8Array(b64));
    }
    const blob = new Blob(parts as BlobPart[], { type: item.meta.mimeType || 'application/octet-stream' });
    // 落 IDB（侧栏按同键读取；SW 与侧栏共享同一 IDB 实例）
    await idbPut(STORE_HLS_BLOBS, CAPREC_IDB_PREFIX + recordId, blob);
    // 元数据列表：新条目置顶
    const list = await readMetaList();
    await writeMetaList([item.meta, ...list]);
    log.info(`录制产物已入库：${recordId}（${(blob.size / 1048576).toFixed(2)}MB，mode=${item.meta.mode}）`);
    // 广播就绪（侧栏可能未开：sendMessage 会 reject，吞掉即可）
    try {
      await chrome.runtime.sendMessage({ type: MessageType.CAPTURE_RECORDING_READY, meta: item.meta });
    } catch { /* 无接收方（侧栏未打开）：数据已持久化，下次打开侧栏会主动拉列表 */ }
    return true;
  } catch (e) {
    log.error('录制产物入库失败', recordId, e);
    return false;
  }
}

/** 分块入缓冲（导出供 WebRTC 协调层直接调用，避免后台自己给自己发 runtime 消息） */
export function acceptRecordingChunk(m: {
  recordId: string; seq: number; total: number; data: string; meta?: CaptureRecordingMeta;
}): { success: boolean; error?: string } {
  if (!m.recordId || typeof m.seq !== 'number' || typeof m.data !== 'string') {
    return { success: false, error: '分块参数无效' };
  }
  const armTimeout = (recordId: string) => setTimeout(() => {
    log.warn('录制分块缓冲超时，丢弃', recordId);
    pending.delete(recordId);
  }, PENDING_TIMEOUT_MS);
  let item = pending.get(m.recordId);
  if (!item) {
    // 新建缓冲并挂孤儿超时（DONE 迟迟不到时自动清理，防 SW 内存泄漏）
    item = { total: m.total || 0, received: new Map(), timer: armTimeout(m.recordId) };
    pending.set(m.recordId, item);
  }
  if (m.meta) item.meta = m.meta;
  if (m.total > 0) item.total = m.total;
  item.received.set(m.seq, m.data);
  // 每收到一块就续期：边录边送（WebRTC）可能持续几十分钟，
  // 只在首块挂一次超时的话，长录制会在录到一半时被当成孤儿丢掉。
  clearTimeout(item.timer);
  item.timer = armTimeout(m.recordId);
  log.debug(`录制分块 ${m.seq + 1}/${item.total} 已接收（${m.recordId}）`);
  return { success: true };
}

/** 收尾入库（同上，导出供 WebRTC 协调层直接调用） */
export async function acceptRecordingDone(m: {
  recordId: string; total?: number; durationMs?: number; sizeBytes?: number;
}): Promise<{ success: boolean; error?: string }> {
  if (!m.recordId) return { success: false, error: '缺少 recordId' };
  const ok = await finalizePending(m.recordId, { total: m.total, durationMs: m.durationMs, sizeBytes: m.sizeBytes });
  return ok ? { success: true } : { success: false, error: '分块不完整或入库失败' };
}

/**
 * 注册录制产物交接相关的全部后台处理器（在 background/index.ts 初始化时调用）。
 */
export function initCaptureRecordingHandlers(): void {
  // ── 单个分块上送：写入缓冲（首块携带 meta 与 total） ──
  registerBgHandler(MessageType.CAPTURE_RECORDING_CHUNK, (msg: AnyMessage) => {
    return acceptRecordingChunk(msg as unknown as { recordId: string; seq: number; total: number; data: string; meta?: CaptureRecordingMeta });
  });

  // ── 分块传输结束：拼装落库并广播 ──
  registerBgHandler(MessageType.CAPTURE_RECORDING_DONE, async (msg: AnyMessage) => {
    return acceptRecordingDone(msg as unknown as { recordId: string; total?: number; durationMs?: number; sizeBytes?: number });
  });

  // ── 删除一条录制产物（侧栏 → 后台：元数据 + IDB Blob 一并删除） ──
  registerBgHandler(MessageType.CAPTURE_RECORDING_DELETE, async (msg: AnyMessage) => {
    const m = msg as unknown as { recordId: string };
    if (!m.recordId) return { success: false, error: '缺少 recordId' };
    try {
      const list = await readMetaList();
      await writeMetaList(list.filter((x) => x.id !== m.recordId));
      await idbDelete(STORE_HLS_BLOBS, CAPREC_IDB_PREFIX + m.recordId);
      log.info('录制产物已删除', m.recordId);
      return { success: true };
    } catch (e) {
      log.error('删除录制产物失败', m.recordId, e);
      return { success: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  log.info('录制产物交接处理器已注册');
}
