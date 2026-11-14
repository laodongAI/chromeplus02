/**
 * 嗅探条目的展示元信息（纯函数，无 chrome/DOM 依赖，可单测）。
 *
 * 竞品（猫抓/Fatkun）在列表里直接给出体积/封装/分辨率，用户不必逐条点开就能判断值不值得下。
 * 本模块只做「把已有事实翻译成人话」这一件事：三项分别来自 content-length、
 * Content-Type/URL 扩展名、主清单 RESOLUTION 或 <video> 元素尺寸。
 * 拿不到就返回 undefined/''，由 UI 显示占位 —— 用 0 兜底会让用户把「未知」读成「空文件」。
 */

import { extFromUrl, extFromContentType, type NetworkMediaKind } from '@/utils/mediaType';

/** 一条嗅探结果已确认的元信息（字段缺失即真的不知道，不要猜） */
export interface MediaMetaFacts {
  url: string;
  title?: string;
  mimeType?: string;
  extension?: string;
  kind?: NetworkMediaKind;
  /** 字节数（content-length 或 HEAD 探测结果） */
  size?: number;
  width?: number;
  height?: number;
  /** 秒 */
  duration?: number;
}

/** 扩展名 → 列表展示的封装名。流媒体带上协议名，用于区分「一个文件」与「一条流」 */
const FORMAT_LABELS: Record<string, string> = {
  mp3: 'MP3', m4a: 'M4A', aac: 'AAC', flac: 'FLAC', wav: 'WAV', ogg: 'OGG', opus: 'OPUS',
  mp4: 'MP4', webm: 'WEBM', mkv: 'MKV', mov: 'MOV', flv: 'FLV', avi: 'AVI',
  ts: 'TS', m4s: 'M4S', m3u8: 'HLS', mpd: 'DASH',
  jpg: 'JPG', jpeg: 'JPG', png: 'PNG', webp: 'WEBP', gif: 'GIF', avif: 'AVIF', svg: 'SVG'
};

/** 清晰度档位（以垂直分辨率归档） */
export function heightTier(height: number | undefined): string | undefined {
  if (!height || !Number.isFinite(height) || height <= 0) return undefined;
  if (height >= 2160) return '4K';
  if (height >= 1440) return '2K';
  return `${Math.round(height)}P`;
}

/**
 * 封装格式标签：显式扩展名 > URL 扩展名 > Content-Type。
 * 三者都认不出时返回 undefined（无扩展名的签名直链很常见，宁缺勿错）。
 */
export function formatLabelOf(facts: Pick<MediaMetaFacts, 'url' | 'mimeType' | 'extension'>): string | undefined {
  const candidates = [facts.extension, extFromUrl(facts.url), extFromContentType(facts.mimeType)];
  for (const c of candidates) {
    const ext = (c || '').toLowerCase().replace(/^\./, '');
    const label = FORMAT_LABELS[ext];
    if (label) return label;
  }
  return undefined;
}

/** 解析 HLS 的 `RESOLUTION=1920x1080`；畸形值返回 null 而不是抛 */
export function parseResolutionString(value: string | undefined): { width: number; height: number } | null {
  const m = (value || '').trim().match(/^(\d+)\s*[x×]\s*(\d+)$/i);
  if (!m) return null;
  const width = Number(m[1]);
  const height = Number(m[2]);
  if (!width || !height) return null;
  return { width, height };
}

/** 分辨率标签：`1920×1080 1080P`；只有高度时退化为 `1080P`；都不知道返回 undefined */
export function resolutionLabelOf(facts: Pick<MediaMetaFacts, 'width' | 'height'>): string | undefined {
  const tier = heightTier(facts.height);
  if (facts.width && facts.height) return `${Math.round(facts.width)}×${Math.round(facts.height)}${tier ? ` ${tier}` : ''}`;
  return tier;
}

/** 体积标签（1024 进制，与 utils/format 的 formatBytes 同一口径）；未知返回 '' 供 UI 判空 */
export function sizeLabelOf(bytes: number | undefined): string {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes < 0) return '';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let n = bytes;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  return `${i === 0 ? n : n >= 100 ? Math.round(n) : Math.round(n * 10) / 10} ${units[i]}`;
}

/** 时长标签（秒 → `1:23:45` / `3:05`）；未知返回 '' */
export function durationLabelOf(seconds: number | undefined): string {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 0) return '';
  const s = Math.round(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (v: number) => String(v).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}

/** 表达式与搜索框共用的可检索文本（标题/地址/格式/清晰度/类型拼成一条） */
export function searchableTextOf(facts: MediaMetaFacts): string {
  return [
    facts.title || '',
    facts.url || '',
    formatLabelOf(facts) || '',
    resolutionLabelOf(facts) || '',
    facts.kind || ''
  ].filter(Boolean).join(' ').toLowerCase();
}
