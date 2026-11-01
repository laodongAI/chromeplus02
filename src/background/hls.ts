/**
 * HLS(m3u8) 分片下载编排器（后台）。
 * 能力：
 *  - 解析 master → 选最高码率 → 解析 media 清单
 *  - 分片并发下载（默认 4 并发，单分片重试 2 次），进度回调
 *  - AES-128 加密流解密（crypto.subtle；SAMPLE-AES 明确拒绝）
 *  - 分片缓存于 IndexedDB：断点续传 / 暂停续下 / SW 重启恢复
 *  - 朴素二进制合并（TS/fMP4/AAC），最终 Blob 写入 IDB 并广播侧边栏保存
 * 大文件内存策略：分片以 ArrayBuffer 逐个落 IDB，合并用 Blob 引用拼接，
 * 不在 SW 内存中同时持有全部数据。
 */

import { parseM3U8, pickBestVariant, type M3u8Byterange, type M3u8ParseResult } from '@/core/m3u8';
import { detectMergeType, mergeSegments, concatBytes, type HlsMergeType } from '@/core/hlsMerge';
import { canRemux, remuxTsToMp4 } from '@/core/tsRemux';
import { STORE_HLS_SEGMENTS, STORE_HLS_BLOBS, idbPut, idbGet, idbGetAllKeys, idbDeleteByPrefix } from '@/shared/blobStore';

export interface HlsKeyInfo {
  method: 'AES-128';
  uri: string;
  iv?: string;
}

export interface HlsTaskMeta {
  playlistUrl: string;
  segments: string[];
  /** 与 segments 对齐的全局序号（AES-128 隐式 IV 用） */
  sequences: number[];
  byteranges: (M3u8Byterange | undefined)[];
  initSegment?: string;
  keyInfo?: HlsKeyInfo;
  mergeType: HlsMergeType;
  totalDuration?: number;
  segTotal: number;
}

export interface HlsBlobEntry {
  blob: Blob;
  fileName: string;
  mime: string;
  totalDuration?: number;
  savedAt: number;
}

const SEG_CONCURRENCY = 4;
const SEG_RETRIES = 2;

// taskId -> AbortController
const controllers = new Map<string, AbortController>();
// key uri -> CryptoKey（同一任务/页面通常复用一个 key）
const keyCache = new Map<string, CryptoKey>();

function abortError(): Error {
  return Object.assign(new Error('已中止'), { name: 'AbortError', __aborted: true });
}

function isAbortError(e: unknown): boolean {
  return !!(e && (e as any).__aborted === true);
}

/** 中止指定任务的分片下载；mode 决定落点（pause 保留分片，cancel 清理） */
export function hlsAbort(taskId: string, mode: 'pause' | 'cancel'): void {
  const c = controllers.get(taskId);
  if (c) {
    (c as any).__mode = mode;
    c.abort();
  }
  if (mode === 'cancel') {
    // 分片清理延迟到 runHlsDownload 的 catch 中统一处理（这里先标记）
    void idbDeleteByPrefix(STORE_HLS_SEGMENTS, `${taskId}:`);
  }
}

export async function prepareHlsTask(playlistUrl: string): Promise<HlsTaskMeta> {
  let url = playlistUrl;
  let parsed = await fetchPlaylist(url);
  if (parsed.type === 'master') {
    const v = pickBestVariant(parsed.variants || []);
    if (!v) throw new Error('清单中没有可选的码率');
    url = v.url;
    parsed = await fetchPlaylist(url);
  }
  if (parsed.type !== 'media' || !parsed.segments?.length) throw new Error('未解析到可用分片');
  if (parsed.isLive) throw new Error('直播流暂不支持下载');
  if (parsed.unsupportedEncryption) throw new Error('该流使用 SAMPLE-AES 加密（DRM），不支持下载，请使用录制');
  return {
    playlistUrl: url,
    segments: parsed.segments.map(s => s.url),
    sequences: parsed.segments.map(s => s.sequence),
    byteranges: parsed.segments.map(s => s.byterange),
    initSegment: parsed.initSegment,
    keyInfo: parsed.keyInfo ? { ...parsed.keyInfo } as HlsKeyInfo : undefined,
    mergeType: detectMergeType({ initSegment: parsed.initSegment, segments: parsed.segments.map(s => s.url) }),
    totalDuration: parsed.totalDuration,
    segTotal: parsed.segments.length
  };
}

async function fetchPlaylist(url: string): Promise<M3u8ParseResult> {
  const resp = await fetch(url, { credentials: 'include' });
  if (!resp.ok) throw new Error(`清单请求失败: ${resp.status}`);
  const text = await resp.text();
  return parseM3U8(text, url);
}

/**
 * 运行 HLS 下载任务：分片并发抓取 → 合并 → Blob 写入 IDB → 广播侧边栏。
 * onProgress(done, total, bytes) 逐分片回调。
 * fileNameBase：不含扩展名的文件名基名（真实扩展名由合并结果决定）。
 */
export async function runHlsDownload(
  taskId: string,
  meta: HlsTaskMeta,
  fileNameBase: string,
  onProgress: (done: number, total: number, bytes: number) => void
): Promise<string> {
  const controller = new AbortController();
  controllers.set(taskId, controller);
  try {
    const signal = controller.signal;
    const total = meta.segments.length;
    let bytes = 0;

    const key = meta.keyInfo ? await getKeyCryptoKey(meta.keyInfo, signal) : null;

    // 断点续传：跳过已存在的分片
    const prefix = `${taskId}:`;
    const keys = await idbGetAllKeys(STORE_HLS_SEGMENTS);
    const have = new Set(keys.filter(k => k.startsWith(prefix)).map(k => Number(k.slice(prefix.length))));
    let done = have.size;
    onProgress(done, total, bytes);

    const pending: number[] = [];
    meta.segments.forEach((_, i) => { if (!have.has(i)) pending.push(i); });

    let cursor = 0;
    const worker = async () => {
      while (cursor < pending.length) {
        if (signal.aborted) throw abortError();
        const idx = pending[cursor++];
        await downloadSegment(taskId, idx, meta, key, signal, (n) => { bytes += n; });
        done++;
        onProgress(done, total, bytes);
      }
    };
    await Promise.all(Array.from({ length: Math.min(SEG_CONCURRENCY, pending.length) }, worker));
    if (signal.aborted) throw abortError();

    // 初始化段 + 全部分片 → 合并
    const parts: Uint8Array[] = [];
    if (meta.initSegment) {
      const initBuf = await idbGet<ArrayBuffer>(STORE_HLS_SEGMENTS, `${taskId}:init`);
      if (!initBuf) throw new Error('初始化段缺失，请重试');
      parts.push(new Uint8Array(initBuf));
    }
    for (let i = 0; i < total; i++) {
      const buf = await idbGet<ArrayBuffer>(STORE_HLS_SEGMENTS, `${taskId}:${i}`);
      if (!buf) throw new Error(`分片 ${i} 缺失，请重试`);
      parts.push(new Uint8Array(buf));
    }
    // TS 分片：优先转封装为标准 MP4（mux.js），失败/超量回退朴素 .ts 拼接
    let merged;
    if (meta.mergeType === 'ts') {
      const totalBytes = parts.reduce((s, p) => s + p.byteLength, 0);
      let remuxed: Uint8Array | null = null;
      if (await canRemux(totalBytes)) {
        remuxed = await remuxTsToMp4(concatBytes(parts));
      }
      merged = remuxed
        ? { blob: new Blob([remuxed.buffer as ArrayBuffer], { type: 'video/mp4' }), mime: 'video/mp4', extension: 'mp4' }
        : mergeSegments(parts, 'ts');
    } else {
      merged = mergeSegments(parts, meta.mergeType);
    }

    // 交给侧边栏触发保存（SW 无 createObjectURL）
    const entry: HlsBlobEntry = { blob: merged.blob, fileName: `${fileNameBase}.${merged.extension}`, mime: merged.mime, totalDuration: meta.totalDuration, savedAt: Date.now() };
    await idbPut(STORE_HLS_BLOBS, taskId, entry);

    // 分片缓存清理（Blob 已持有完整数据）
    await idbDeleteByPrefix(STORE_HLS_SEGMENTS, prefix);

    try { await chrome.runtime.sendMessage({ type: 'HLS_BLOB_READY', taskId }); } catch { /* 侧栏未开：启动时会清扫 */ }
    return entry.fileName;
  } finally {
    controllers.delete(taskId);
  }
}

async function downloadSegment(
  taskId: string,
  idx: number,
  meta: HlsTaskMeta,
  key: CryptoKey | null,
  signal: AbortSignal,
  onBytes: (n: number) => void
): Promise<void> {
  let lastErr: unknown = null;
  for (let attempt = 0; attempt <= SEG_RETRIES; attempt++) {
    try {
      const headers: Record<string, string> = {};
      const br = meta.byteranges?.[idx];
      if (br && br.length > 0) {
        const offset = br.offset ?? 0;
        headers['Range'] = `bytes=${offset}-${offset + br.length - 1}`;
      }
      const resp = await fetch(meta.segments[idx], { credentials: 'include', signal, headers });
      if (!resp.ok) throw new Error(`分片 ${idx} 请求失败: ${resp.status}`);
      let buf = await resp.arrayBuffer();
      if (key) buf = await decryptSegment(buf, key, meta, idx);
      onBytes(buf.byteLength);
      await idbPut(STORE_HLS_SEGMENTS, `${taskId}:${idx}`, buf);
      return;
    } catch (e) {
      if (signal.aborted) throw abortError();
      lastErr = e;
      await new Promise(r => setTimeout(r, 400 * (attempt + 1)));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(`分片 ${meta.segments[idx]} 下载失败`);
}

async function getKeyCryptoKey(info: HlsKeyInfo, signal: AbortSignal): Promise<CryptoKey> {
  const cached = keyCache.get(info.uri);
  if (cached) return cached;
  const resp = await fetch(info.uri, { credentials: 'include', signal });
  if (!resp.ok) throw new Error(`密钥下载失败: ${resp.status}`);
  const raw = await resp.arrayBuffer();
  if (raw.byteLength !== 16) throw new Error('密钥长度异常（应为 16 字节）');
  const ck = await crypto.subtle.importKey('raw', raw, 'AES-CBC', false, ['decrypt']);
  keyCache.set(info.uri, ck);
  return ck;
}

async function decryptSegment(buf: ArrayBuffer, key: CryptoKey, meta: HlsTaskMeta, idx: number): Promise<ArrayBuffer> {
  const ivHex = meta.keyInfo?.iv;
  let iv: Uint8Array;
  if (ivHex) {
    iv = hexToBytes(ivHex.replace(/^0x/i, ''));
  } else {
    // 隐式 IV：媒体序号的 128 位大端表示
    iv = new Uint8Array(16);
    const seq = meta.sequences?.[idx] ?? idx;
    new DataView(iv.buffer).setUint32(12, seq >>> 0);
  }
  if (iv.byteLength !== 16) throw new Error('IV 长度异常');
  return crypto.subtle.decrypt('AES-CBC', key, buf);
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.trim();
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

export { isAbortError };
