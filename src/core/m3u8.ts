/**
 * m3u8 (HLS) 播放清单解析（纯函数，无 chrome API 依赖，可单测）。
 * 支持：master 清单（多码率变体）、media 清单（EXTINF/EXT-X-BYTERANGE/
 * EXT-X-KEY(AES-128)/EXT-X-MAP(fMP4)/EXT-X-ENDLIST 直播检测）。
 * 不支持：SAMPLE-AES（DRM）、SMIL 等高级特性——解析层标记，调用方给出用户可读错误。
 */

export interface M3u8Variant {
  url: string;
  bandwidth: number;
  resolution?: string;
  codecs?: string;
}

export interface M3u8Byterange {
  length: number;
  offset?: number;
}

export interface M3u8Segment {
  url: string;
  /** 秒 */
  duration: number;
  byterange?: M3u8Byterange;
  /** 全局序号 = EXT-X-MEDIA-SEQUENCE + 行进序号（AES-128 隐式 IV 需要） */
  sequence: number;
}

export interface M3u8KeyInfo {
  method: 'AES-128' | 'SAMPLE-AES';
  uri: string;
  /** 十六进制 IV 字符串（含 0x 前缀或裸 hex） */
  iv?: string;
}

export interface M3u8ParseResult {
  type: 'master' | 'media';
  variants?: M3u8Variant[];
  segments?: M3u8Segment[];
  /** EXT-X-MAP 的 URI（fMP4 初始化段） */
  initSegment?: string;
  /** 当前清单生效的加密信息（v1：单 key 假设，多 key 场景取首个非 NONE key） */
  keyInfo?: M3u8KeyInfo;
  mediaSequence?: number;
  targetDuration?: number;
  /** 全部分片时长之和（秒） */
  totalDuration?: number;
  /** 无 EXT-X-ENDLIST 视为直播流 */
  isLive: boolean;
  /** SAMPLE-AES 等不支持的加密方式（调用方应拒绝下载并提示） */
  unsupportedEncryption?: boolean;
}

/** 解析 KEY=VALUE 属性串（兼容带引号值） */
function parseAttrs(input: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const re = /([\w-]+)=("[^"]*"|[^,]*)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(input))) {
    let v = m[2];
    if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
    attrs[m[1]] = v;
  }
  return attrs;
}

function resolveUri(uri: string, baseUrl: string): string {
  try {
    return new URL(uri, baseUrl).href;
  } catch {
    return uri;
  }
}

export function parseM3U8(text: string, baseUrl: string): M3u8ParseResult {
  const lines = (text || '').split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
  if (!lines.some(l => l.toUpperCase().startsWith('#EXTM3U'))) {
    throw new Error('不是有效的 m3u8 播放清单');
  }

  const result: M3u8ParseResult = { type: 'media', isLive: true };
  const variants: M3u8Variant[] = [];
  const segments: M3u8Segment[] = [];

  let mediaSequence = 0;
  let seqCounter = 0;
  let pendingDuration: number | null = null;
  let pendingByterange: M3u8Byterange | null = null;
  let prevByterangeEnd: number | null = null;
  let sawMaster = false;
  let sawSegment = false;

  for (const line of lines) {
    if (line.startsWith('#EXT-X-STREAM-INF')) {
      sawMaster = true;
      const attrs = parseAttrs(line.slice(line.indexOf(':') + 1));
      variants.push({
        url: '', // 待下一行 URI 填充
        bandwidth: Number(attrs.BANDWIDTH) || 0,
        resolution: attrs.RESOLUTION,
        codecs: attrs.CODECS
      });
      continue;
    }
    if (line.startsWith('#EXT-X-MEDIA-SEQUENCE')) {
      mediaSequence = Number(line.slice(line.indexOf(':') + 1)) || 0;
      seqCounter = mediaSequence;
      continue;
    }
    if (line.startsWith('#EXT-X-TARGETDURATION')) {
      result.targetDuration = Number(line.slice(line.indexOf(':') + 1)) || undefined;
      continue;
    }
    if (line.startsWith('#EXT-X-ENDLIST')) {
      result.isLive = false;
      continue;
    }
    if (line.startsWith('#EXT-X-KEY')) {
      const attrs = parseAttrs(line.slice(line.indexOf(':') + 1));
      const method = (attrs.METHOD || 'NONE').toUpperCase();
      if (method === 'NONE') continue;
      if (method === 'AES-128') {
        // v1 仅保留首个 key（多 key 轮换场景罕见，遇到时按首个解密并可能失败）
        if (!result.keyInfo) {
          result.keyInfo = { method: 'AES-128', uri: resolveUri(attrs.URI || '', baseUrl), iv: attrs.IV };
        }
      } else if (method === 'SAMPLE-AES') {
        result.unsupportedEncryption = true;
      }
      continue;
    }
    if (line.startsWith('#EXT-X-MAP')) {
      const attrs = parseAttrs(line.slice(line.indexOf(':') + 1));
      if (attrs.URI) result.initSegment = resolveUri(attrs.URI, baseUrl);
      continue;
    }
    if (line.startsWith('#EXT-X-BYTERANGE')) {
      // 格式：<length>[@<offset>]；offset 缺省时延续上一段末尾
      const spec = line.slice(line.indexOf(':') + 1);
      const [lenStr, offStr] = spec.split('@');
      const length = Number(lenStr) || 0;
      const offset: number = offStr !== undefined ? Number(offStr) : (prevByterangeEnd ?? 0);
      pendingByterange = { length, offset };
      continue;
    }
    if (line.startsWith('#EXTINF')) {
      const durStr = line.slice(line.indexOf(':') + 1).split(',')[0];
      pendingDuration = Number(durStr) || 0;
      continue;
    }
    if (line.startsWith('#')) continue; // 其他标签忽略

    // 非注释行：URI（变体或分片）
    if (sawMaster && variants.length > 0 && !variants[variants.length - 1].url) {
      variants[variants.length - 1].url = resolveUri(line, baseUrl);
      continue;
    }
    if (pendingDuration !== null || !sawMaster) {
      const seg: M3u8Segment = { url: resolveUri(line, baseUrl), duration: pendingDuration ?? 0, sequence: seqCounter++ };
      if (pendingByterange) {
        seg.byterange = pendingByterange;
        prevByterangeEnd = (pendingByterange.offset ?? 0) + pendingByterange.length;
        pendingByterange = null;
      }
      segments.push(seg);
      sawSegment = true;
      pendingDuration = null;
    }
  }

  if (sawMaster && variants.length > 0) {
    result.type = 'master';
    result.variants = variants.filter(v => v.url);
    return result;
  }
  if (!sawSegment) throw new Error('清单中没有可下载的分片');
  result.segments = segments;
  result.mediaSequence = mediaSequence;
  result.totalDuration = segments.reduce((s, x) => s + x.duration, 0);
  return result;
}

/** 从 master 清单选择码率最高的变体 */
export function pickBestVariant(variants: M3u8Variant[]): M3u8Variant | null {
  if (!variants.length) return null;
  return variants.reduce((best, v) => (v.bandwidth > best.bandwidth ? v : best), variants[0]);
}
