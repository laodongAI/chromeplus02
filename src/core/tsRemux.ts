/**
 * TS(MPEG-TS) → fMP4(MP4) 转封装（vendored mux.js 6.3.0，Apache-2.0，见 src/vendor/mux.umd.cjs）。
 * 纯 JS 实现，可在 Service Worker 中运行，无需 wasm。
 * 按需动态加载（仅转封装时才拉取 chunk，后台启动保持轻量）。
 * 约定：任何失败（依赖缺失/编解码不支持/超时）返回 null，调用方回退朴素 .ts 合并。
 */

// P1-8：分级日志（模块随调用方运行于 SW/编辑器页面，默认 info 级）
import { createLogger } from '@/utils/logger';

/** 本模块 logger：保留原 `[tsRemux]` 前缀语义 */
const log = createLogger('tsRemux');

/**
 * mux.js CoalesceStream 的 data 载荷：{ type, initSegment(moov), data(moof+mdat), ... }。
 * 注意事件对象本身没有 buffer 属性——可播放字节要自己把 initSegment 与 data 拼起来。
 */
interface TransmuxerSegment {
  initSegment?: Uint8Array;
  data?: Uint8Array;
}

interface TransmuxerLike {
  push(data: Uint8Array): void;
  flush(): void;
  dispose?(): void;
  on(event: string, cb: (payload: TransmuxerSegment) => void): void;
}

/**
 * 转封装驻内存字节上限：转封装需要整段连续数据（峰值约为源字节的 2 倍），
 * SW 内存有限，超限必须回退朴素 .ts 合并。原 1GB 上限过高，收敛到 200MB。
 * 导出供调用方（background/hls）在合并前做同口径判断并输出明确错误码。
 */
export const REMUX_MAX_BYTES = 200_000_000; // 200MB
/** 超过转封装内存上限时的明确错误码（调用方据此打日志并回退朴素合并） */
export const REMUX_OVER_LIMIT_CODE = 'REMUX_OVER_LIMIT';
/** 转封装整体超时（毫秒），防止 mux.js 卡死拖垮任务 */
const REMUX_TIMEOUT_MS = 30_000;

async function loadTransmuxer(): Promise<TransmuxerLike | null> {
  try {
    // @ts-expect-error vendored UMD 库无类型声明
    const mod = await import('@/vendor/mux.umd.cjs');
    const lib = (mod as any)?.default ?? mod;
    const T = lib?.mp4?.Transmuxer;
    return typeof T === 'function' ? new (T as any)() as TransmuxerLike : null;
  } catch {
    return null;
  }
}

export async function canRemux(totalBytes: number): Promise<boolean> {
  if (totalBytes > REMUX_MAX_BYTES) {
    // 超限给出明确错误码日志，便于排查"为什么产物是 .ts 而不是 .mp4"
    log.warn(`超过转封装内存上限 code=${REMUX_OVER_LIMIT_CODE} bytes=${totalBytes} limit=${REMUX_MAX_BYTES}，回退朴素合并`);
    return false;
  }
  return (await loadTransmuxer()) !== null;
}

/**
 * 将完整 MPEG-TS 数据转封装为 fMP4（init+media 拼接后的可播放 MP4 字节）。
 * 返回 null 表示不可用/失败，调用方应回退 .ts。
 */
export async function remuxTsToMp4(tsBytes: Uint8Array): Promise<Uint8Array<ArrayBuffer> | null> {
  const transmuxer = await loadTransmuxer();
  if (!transmuxer) return null;
  return await new Promise<Uint8Array<ArrayBuffer> | null>((resolve) => {
    let settled = false;
    const finish = (v: Uint8Array<ArrayBuffer> | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { transmuxer.dispose?.(); } catch { /* noop */ }
      resolve(v);
    };
    const timer = setTimeout(() => finish(null), REMUX_TIMEOUT_MS);
    /** 首个 initSegment（moov）：多次 emit 时只取一份，避免产物里出现多个 moov */
    let init: Uint8Array | null = null;
    const mediaParts: Uint8Array[] = [];
    transmuxer.on('data', (segment) => {
      if (!init && segment?.initSegment?.length) init = segment.initSegment;
      if (segment?.data?.length) mediaParts.push(segment.data);
    });
    // CoalesceStream 在同一次 flush 内先发 data 再发 done，此处收齐后拼接
    transmuxer.on('done', () => {
      if (settled) return;
      if (!init || !mediaParts.length) { finish(null); return; }
      const total = init.byteLength + mediaParts.reduce((n, p) => n + p.byteLength, 0);
      const out = new Uint8Array(total);
      out.set(init, 0);
      let off = init.byteLength;
      for (const p of mediaParts) { out.set(p, off); off += p.byteLength; }
      finish(out);
    });
    try {
      transmuxer.push(tsBytes);
      transmuxer.flush();
    } catch {
      finish(null);
    }
  });
}
