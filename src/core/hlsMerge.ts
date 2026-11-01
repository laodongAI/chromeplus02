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

export function mergeSegments(parts: Uint8Array[], type: HlsMergeType): MergedMedia {
  if (!parts.length) throw new Error('没有可合并的分片数据');
  switch (type) {
    case 'fmp4':
      return { blob: new Blob(parts as BlobPart[], { type: 'video/mp4' }), mime: 'video/mp4', extension: 'mp4' };
    case 'aac':
      return { blob: new Blob(parts as BlobPart[], { type: 'audio/aac' }), mime: 'audio/aac', extension: 'aac' };
    case 'ts':
    default:
      return { blob: new Blob(parts as BlobPart[], { type: 'video/mp2t' }), mime: 'video/mp2t', extension: 'ts' };
  }
}

/** 将多个分片按序拼为单个 Uint8Array（转封装器需要整段连续数据） */
export function concatBytes(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((s, p) => s + p.byteLength, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.byteLength;
  }
  return out;
}
