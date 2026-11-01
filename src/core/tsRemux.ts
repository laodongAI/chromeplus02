/**
 * TS(MPEG-TS) → fMP4(MP4) 转封装（vendored mux.js 6.3.0，Apache-2.0，见 src/vendor/mux.umd.cjs）。
 * 纯 JS 实现，可在 Service Worker 中运行，无需 wasm。
 * 按需动态加载（仅转封装时才拉取 chunk，后台启动保持轻量）。
 * 约定：任何失败（依赖缺失/编解码不支持/超时）返回 null，调用方回退朴素 .ts 合并。
 */

interface TransmuxerLike {
  push(data: Uint8Array): void;
  flush(): void;
  dispose?(): void;
  on(event: string, cb: (payload: { buffer?: ArrayBuffer }) => void): void;
}

/** 超过该字节数跳过转封装（转封装需整段驻内存，保护 SW），回退朴素合并 */
const REMUX_MAX_BYTES = 1_000_000_000; // 1GB
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
  if (totalBytes > REMUX_MAX_BYTES) return false;
  return (await loadTransmuxer()) !== null;
}

/**
 * 将完整 MPEG-TS 数据转封装为 fMP4（init+media 拼接后的可播放 MP4 字节）。
 * 返回 null 表示不可用/失败，调用方应回退 .ts。
 */
export async function remuxTsToMp4(tsBytes: Uint8Array): Promise<Uint8Array | null> {
  const transmuxer = await loadTransmuxer();
  if (!transmuxer) return null;
  return await new Promise<Uint8Array | null>((resolve) => {
    let settled = false;
    const finish = (v: Uint8Array | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { transmuxer.dispose?.(); } catch { /* noop */ }
      resolve(v);
    };
    const timer = setTimeout(() => finish(null), REMUX_TIMEOUT_MS);
    transmuxer.on('data', (segment) => {
      if (segment?.buffer) finish(new Uint8Array(segment.buffer as ArrayBuffer));
      else finish(null);
    });
    transmuxer.on('done', () => { if (!settled) finish(null); });
    try {
      transmuxer.push(tsBytes);
      transmuxer.flush();
    } catch {
      finish(null);
    }
  });
}
