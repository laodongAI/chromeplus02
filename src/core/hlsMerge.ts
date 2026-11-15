/**
 * HLS 分片合并策略（纯逻辑）。
 * 说明：当前采用"朴素二进制拼接"，三种结果都是合法可播放的渐进式流：
 *  - MPEG-TS 分片直接拼接 → .ts（VLC/PotPlayer/mpv 等可直接播放）
 *  - fMP4（含 EXT-X-MAP 初始化段）init + 分片拼接 → .mp4（fMP4 渐进流即合法 MP4）
 *  - ADTS/AAC 音频分片拼接 → .aac
 * 转封装为标准 MP4（ffmpeg.wasm offscreen remux / TS remuxer）为后续版本扩展点，
 * 届时在此模块前插入 remux 步骤即可，不影响队列与下载链路。
 */

export type HlsMergeType = 'ts' | 'fmp4' | 'aac';

export function detectMergeType(meta: { initSegment?: string; segments: string[] }): HlsMergeType {
  if (meta.initSegment) return 'fmp4';
  const sample = meta.segments.slice(0, 5).map(u => (u.split('?')[0] || '').toLowerCase());
  if (sample.some(u => u.endsWith('.m4s') || u.endsWith('.mp4'))) return 'fmp4';
  if (sample.length && sample.every(u => u.endsWith('.aac'))) return 'aac';
  return 'ts';
}

export interface MergedMedia {
  blob: Blob;
  mime: string;
  extension: string;
}

/**
 * 合并类型 → MIME/扩展名的唯一映射来源（收口轮交接项）。
 * 此前 background/hls.ts 因流式合并不能物化 Uint8Array 数组，本地复制了一份
 * MERGE_META；现抽出 `mergeBlobParts`（接受 BlobPart[]，直接引用拼接），
 * 两处共用同一映射，消除双份配置不一致风险。
 */
export const MERGE_META: Record<HlsMergeType, { mime: string; extension: string }> = {
  fmp4: { mime: 'video/mp4', extension: 'mp4' },
  aac: { mime: 'audio/aac', extension: 'aac' },
  ts: { mime: 'video/mp2t', extension: 'ts' }
};

/**
 * 合并任意 BlobPart（Uint8Array / ArrayBuffer / Blob 引用）为最终产物。
 * 流式路径传入独立 Blob 数组时仅做引用拼接，不会把分片数据物化回连续内存。
 * @param parts 分片数据（顺序即拼接顺序）
 * @param type  合并类型（决定 MIME/扩展名）
 */
export function mergeBlobParts(parts: BlobPart[], type: HlsMergeType): MergedMedia {
  if (!parts.length) throw new Error('没有可合并的分片数据');
  const { mime, extension } = MERGE_META[type] || MERGE_META.ts;
  return { blob: new Blob(parts, { type: mime }), mime, extension };
}

/**
 * 合并 Uint8Array 分片数组（旧入口，保留兼容：内部委托 mergeBlobParts）。
 * @param parts 分片字节数组
 * @param type  合并类型
 */
export function mergeSegments(parts: Uint8Array[], type: HlsMergeType): MergedMedia {
  return mergeBlobParts(parts as BlobPart[], type);
}
