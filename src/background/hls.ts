/**
 * HLS(m3u8) 分片下载编排器（后台）。
 * 能力：
 *  - 解析 master → 选最高码率 → 解析 media 清单
 *  - 分片并发下载（默认 4 并发，单分片重试 2 次），进度回调
 *  - AES-128 加密流解密（crypto.subtle；SAMPLE-AES 明确拒绝）
 *  - 分片缓存于 IndexedDB：断点续传 / 暂停续下 / SW 重启恢复
 *  - 朴素二进制合并（TS/fMP4/AAC），最终 Blob 写入 IDB 并广播侧边栏保存
 * 大文件内存策略：分片以 ArrayBuffer 逐个落 IDB；合并时逐片从 IDB 读出并
 * 包装成独立 Blob 后引用拼接，任一时刻 JS 内存只持有一个分片的 ArrayBuffer，
 * 不在 SW 内存中同时物化全部数据（转封装路径例外，受 REMUX_MAX_BYTES 上限保护）。
 */

import { parseM3U8, pickBestVariant, type M3u8Byterange, type M3u8ParseResult } from '@/core/m3u8';
import { MessageType } from '@/messaging';
// P1-8：分级日志（SW 上下文默认 info 级）
import { createLogger } from '@/utils/logger';
import { parseMPD, pickBestDashVideo } from '@/core/mpd';
import { detectMergeType, mergeBlobParts, type HlsMergeType, type MergedMedia } from '@/core/hlsMerge';
import { canRemux, remuxTsToMp4, REMUX_MAX_BYTES, REMUX_OVER_LIMIT_CODE } from '@/core/tsRemux';
import { STORE_HLS_SEGMENTS, STORE_HLS_BLOBS, idbPut, idbGet, idbGetAllKeys, idbDeleteByPrefix } from '@/shared/blobStore';

/** 本模块 logger：保留原 `[hls]` 前缀语义 */
const log = createLogger('hls');

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
  /** EXT-X-MAP 的 BYTERANGE 属性（初始化段只取文件的一部分时使用；DASH 无此概念） */
  initByterange?: M3u8Byterange;
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
  /** 已发起的浏览器下载 id：侧栏据此判断是否仍在下载，避免重开时重复保存 */
  downloadId?: number;
}

const SEG_CONCURRENCY = 4;
const SEG_RETRIES = 2;

/**
 * 初始化段（EXT-X-MAP / DASH init）在 IDB 中的键后缀。
 * 与普通分片同库同前缀存储：`${taskId}:init`，合并时读取。
 */
const INIT_KEY_SUFFIX = 'init';

/**
 * 初始化段的哨兵下标：纳入下载调度、重试与进度统计，
 * 但不占用真实分片序号（真实分片下标恒 >= 0）。
 */
export const HLS_INIT_INDEX = -1;

/**
 * 从 IDB 已有键集合解析"已下载下标"（断点续传跳过判定）。
 * 键格式：`${taskId}:<数字>` 为普通分片；`${taskId}:init` 为初始化段（映射为 HLS_INIT_INDEX）。
 * 纯函数，便于单测。
 * @param taskId 任务 ID
 * @param keys   IDB 分片库全部键
 * @returns 已存在数据对应的下标集合
 */
export function computeHaveIndices(taskId: string, keys: string[]): Set<number> {
  const prefix = `${taskId}:`;
  const have = new Set<number>();
  for (const k of keys) {
    if (!k.startsWith(prefix)) continue;
    const tail = k.slice(prefix.length);
    if (tail === INIT_KEY_SUFFIX) { have.add(HLS_INIT_INDEX); continue; }
    const n = Number(tail);
    if (Number.isFinite(n)) have.add(n);
  }
  return have;
}

/**
 * 构建待下载下标列表：初始化段（存在且未下载时）恒排在队首，
 * 之后按序追加缺失的普通分片下标。纯函数，便于单测。
 * @param meta 任务元数据
 * @param have 已下载下标集合（computeHaveIndices 的产物）
 * @returns 待下载下标列表（含 HLS_INIT_INDEX 哨兵）
 */
export function buildPendingIndices(meta: HlsTaskMeta, have: Set<number>): number[] {
  const pending: number[] = [];
  if (meta.initSegment && !have.has(HLS_INIT_INDEX)) pending.push(HLS_INIT_INDEX);
  meta.segments.forEach((_, i) => { if (!have.has(i)) pending.push(i); });
  return pending;
}

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
    // 交接项（收口轮）：EXT-X-MAP 的 BYTERANGE 直接读 core/m3u8 解析结果，
    // 原 extractInitByterange 正则兜底已删除（解析器透出 initByterange 后不再需要）
    initByterange: parsed.initByterange,
    keyInfo: parsed.keyInfo ? { ...parsed.keyInfo } as HlsKeyInfo : undefined,
    mergeType: detectMergeType({ initSegment: parsed.initSegment, segments: parsed.segments.map(s => s.url) }),
    totalDuration: parsed.totalDuration,
    segTotal: parsed.segments.length
  };
}

/**
 * 拉取并解析播放清单。
 * @param url 清单地址（master 或 media）
 * @returns 解析结果（含 EXT-X-MAP BYTERANGE 等全部透出字段，收口轮交接后不再需要原文兜底）
 */
async function fetchPlaylist(url: string): Promise<M3u8ParseResult> {
  const resp = await fetch(url, { credentials: 'include' });
  if (!resp.ok) throw new Error(`清单请求失败: ${resp.status}`);
  const text = await resp.text();
  return parseM3U8(text, url);
}

/** DASH(mpd) → HlsTaskMeta：复用分片下载/合并管道（fMP4 init+分片拼接） */
export async function prepareDashTask(mpdUrl: string): Promise<HlsTaskMeta> {
  const resp = await fetch(mpdUrl, { credentials: 'include' });
  if (!resp.ok) throw new Error(`清单请求失败: ${resp.status}`);
  const text = await resp.text();
  const parsed = parseMPD(text, mpdUrl);
  if (parsed.isDynamic) throw new Error('直播 DASH 暂不支持下载');
  if (parsed.unsupported.length) throw new Error(`暂不支持的 MPD 特性: ${parsed.unsupported.join('、')}`);
  const best = pickBestDashVideo(parsed.videoRepresentations);
  if (!best) throw new Error('未解析到可下载的视频轨');
  // 音视频分轨：无合流能力时拒绝，避免产出无声视频
  if (parsed.audioRepresentations.length > 0) {
    throw new Error('该 DASH 为音视频分离流，下载视频轨将无声，建议使用录制兜底');
  }
  return {
    playlistUrl: mpdUrl,
    segments: best.segments,
    sequences: best.segments.map((_, i) => i),
    byteranges: best.segments.map(() => undefined),
    initSegment: best.initialization,
    mergeType: 'fmp4',
    totalDuration: parsed.durationSeconds,
    segTotal: best.segments.length
  };
}

/** 按清单类型自动分发：mpd → DASH，其余按 m3u8 处理 */
export async function prepareMediaTask(url: string): Promise<HlsTaskMeta> {
  if (/\.mpd(?:$|[?#])/i.test(url)) return prepareDashTask(url);
  return prepareHlsTask(url);
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
    // 进度总量 = 普通分片数 + 初始化段（存在时计 1，保证进度条口径与下载项一致）
    const hasInit = !!meta.initSegment;
    const total = meta.segments.length + (hasInit ? 1 : 0);
    let bytes = 0;

    const key = meta.keyInfo ? await getKeyCryptoKey(meta.keyInfo, signal) : null;

    // 断点续传：跳过已存在的分片（含初始化段，见 computeHaveIndices/buildPendingIndices）
    const prefix = `${taskId}:`;
    const keys = await idbGetAllKeys(STORE_HLS_SEGMENTS);
    const have = computeHaveIndices(taskId, keys);
    // 已存在数可能包含历史遗留的越界下标（清单变化），钳制到 total 防止进度超过 100%
    let done = Math.min(have.size, total);
    onProgress(done, total, bytes);

    const pending = buildPendingIndices(meta, have);
    log.info(`任务 ${taskId} 开始下载：共 ${total} 项（初始化段 ${hasInit ? '需要' : '不需要'}），已存在 ${done} 项，待下载 ${pending.length} 项`);

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

    // ===== 流式合并（P1-6）=====
    // 逐片从 IDB 读出并立即包装成独立 Blob：任一时刻 JS 内存只持有一个分片的
    // ArrayBuffer，最终 Blob 由分片 Blob 引用拼接，避免"全部数据常驻"的内存峰值。
    const blobParts: Blob[] = [];
    let totalBytes = 0;
    /** 把一个分片 ArrayBuffer 包装成独立 Blob 并累计字节数 */
    const appendPart = (buf: ArrayBuffer) => { blobParts.push(new Blob([buf])); totalBytes += buf.byteLength; };

    // 初始化段排在拼接首位（fMP4 必须 init + media 顺序拼接才是合法 MP4）
    if (hasInit) {
      const initBuf = await idbGet<ArrayBuffer>(STORE_HLS_SEGMENTS, `${taskId}:${INIT_KEY_SUFFIX}`);
      if (!initBuf) throw new Error('初始化段缺失，请重试');
      appendPart(initBuf);
    }
    for (let i = 0; i < meta.segments.length; i++) {
      const buf = await idbGet<ArrayBuffer>(STORE_HLS_SEGMENTS, `${taskId}:${i}`);
      if (!buf) throw new Error(`分片 ${i} 缺失，请重试`);
      appendPart(buf);
    }

    // TS 分片：优先转封装为标准 MP4（mux.js）；超过 REMUX_MAX_BYTES 上限
    // 输出明确错误码日志并回退朴素 .ts 拼接（此时不再物化连续内存）
    let merged: MergedMedia | undefined;
    if (meta.mergeType === 'ts') {
      if (totalBytes <= REMUX_MAX_BYTES && await canRemux(totalBytes)) {
        // 转封装需要连续字节：逐块拼接（总量已受 200MB 上限约束，内存峰值可控）
        const tsBytes = new Uint8Array(totalBytes);
        let off = 0;
        for (const b of blobParts) {
          const ab = await b.arrayBuffer();
          tsBytes.set(new Uint8Array(ab), off);
          off += ab.byteLength;
        }
        const remuxed = await remuxTsToMp4(tsBytes);
        if (remuxed) {
          merged = { blob: new Blob([remuxed], { type: 'video/mp4' }), mime: 'video/mp4', extension: 'mp4' };
        } else {
          log.info(`任务 ${taskId} 转封装不可用/失败，回退朴素 .ts 拼接`);
        }
      } else if (totalBytes > REMUX_MAX_BYTES) {
        // canRemux 内部已输出 code=REMUX_OVER_LIMIT 警告，这里补充任务级上下文
        log.warn(`任务 ${taskId} 跳过转封装 code=${REMUX_OVER_LIMIT_CODE} bytes=${totalBytes} limit=${REMUX_MAX_BYTES}，回退朴素 .ts 拼接`);
      }
    }
    if (!merged) {
      // 朴素拼接：合并分片 Blob 引用（收口轮交接项：MIME/扩展名映射统一抽取到
      // core/hlsMerge.mergeBlobParts，传入 Blob[] 仅做引用拼接、不物化内存）
      merged = mergeBlobParts(blobParts, meta.mergeType);
    }

    // 交给侧边栏触发保存（SW 无 createObjectURL）
    const entry: HlsBlobEntry = { blob: merged.blob, fileName: `${fileNameBase}.${merged.extension}`, mime: merged.mime, totalDuration: meta.totalDuration, savedAt: Date.now() };
    await idbPut(STORE_HLS_BLOBS, taskId, entry);

    // 分片缓存清理（Blob 已持有完整数据）
    await idbDeleteByPrefix(STORE_HLS_SEGMENTS, prefix);

    // 广播产物就绪（P1-1：改用 MessageType 枚举，与 sourcesDownload.ts 的同类广播一致）
    try { await chrome.runtime.sendMessage({ type: MessageType.HLS_BLOB_READY, taskId }); } catch { /* 侧栏未开：启动时会清扫 */ }
    return entry.fileName;
  } finally {
    controllers.delete(taskId);
  }
}

/**
 * 下载单个下载项并落 IDB（含重试与断点续传键写入）。
 * @param taskId 任务 ID
 * @param idx    下载项下标：>=0 为普通分片；HLS_INIT_INDEX(-1) 为初始化段
 * @param meta   任务元数据（URL 清单、字节范围、序号等）
 * @param key    AES-128 解密密钥（无加密时为 null）
 * @param signal 中止信号
 * @param onBytes 已下载字节增量回调（进度统计）
 */
async function downloadSegment(
  taskId: string,
  idx: number,
  meta: HlsTaskMeta,
  key: CryptoKey | null,
  signal: AbortSignal,
  onBytes: (n: number) => void
): Promise<void> {
  // 初始化段与普通分片走同一条下载/重试通道，仅地址、字节范围来源与落库键不同
  const isInit = idx === HLS_INIT_INDEX;
  const url = isInit ? meta.initSegment! : meta.segments[idx];
  const label = isInit ? '初始化段' : `分片 ${idx}`;
  const storeKey = isInit ? `${taskId}:${INIT_KEY_SUFFIX}` : `${taskId}:${idx}`;
  let lastErr: unknown = null;
  for (let attempt = 0; attempt <= SEG_RETRIES; attempt++) {
    try {
      const headers: Record<string, string> = {};
      const br = isInit ? meta.initByterange : meta.byteranges?.[idx];
      if (br && br.length > 0) {
        const offset = br.offset ?? 0;
        headers['Range'] = `bytes=${offset}-${offset + br.length - 1}`;
      }
      const resp = await fetch(url, { credentials: 'include', signal, headers });
      if (!resp.ok) throw new Error(`${label} 请求失败: ${resp.status}`);
      let buf = await resp.arrayBuffer();
      if (key) {
        if (isInit) log.debug(`任务 ${taskId} 初始化段为加密流，按当前密钥解密（EXT-X-MAP + AES-128 场景）`);
        buf = await decryptSegment(buf, key, meta, idx);
      }
      onBytes(buf.byteLength);
      await idbPut(STORE_HLS_SEGMENTS, storeKey, buf);
      return;
    } catch (e) {
      if (signal.aborted) throw abortError();
      lastErr = e;
      log.warn(`任务 ${taskId} ${label} 第 ${attempt + 1} 次下载失败:`, e);
      await new Promise(r => setTimeout(r, 400 * (attempt + 1)));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(`${label} 下载失败: ${url}`);
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

export async function decryptSegment(buf: ArrayBuffer, key: CryptoKey, meta: HlsTaskMeta, idx: number): Promise<ArrayBuffer> {
  const ivHex = meta.keyInfo?.iv;
  let iv: Uint8Array<ArrayBuffer>;
  if (ivHex) {
    iv = hexToBytes(ivHex.replace(/^0x/i, ''));
  } else {
    // 隐式 IV：媒体序号的 128 位大端表示
    iv = new Uint8Array(16);
    // 初始化段（哨兵下标）没有自身媒体序号：按惯例沿用首个分片的序号
    const seq = idx === HLS_INIT_INDEX ? (meta.sequences?.[0] ?? 0) : (meta.sequences?.[idx] ?? idx);
    new DataView(iv.buffer).setUint32(12, seq >>> 0);
  }
  if (iv.byteLength !== 16) throw new Error('IV 长度异常');
  // AES-CBC 必须传 { name, iv }：只给算法名字符串会因缺少 iv 抛 TypeError，
  // 导致所有 EXT-X-KEY 加密流重试耗尽后失败（上面算出的 iv 此前根本没被用上）
  return crypto.subtle.decrypt({ name: 'AES-CBC', iv }, key, buf);
}

function hexToBytes(hex: string): Uint8Array<ArrayBuffer> {
  const clean = hex.trim();
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

export { isAbortError };
