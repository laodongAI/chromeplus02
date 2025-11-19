/**
 * 统一媒体去重与标识工具。
 * key 结构: type|normalizedUrl|WxH|hashPrefix
 */
export interface MediaIdentity {
  url: string;
  kind?: string; // 'img' | 'background' | 'frame' | 'audio' | 'video'
  width?: number;
  height?: number;
  phash?: string; // 感知哈希
  mime?: string;
}

const TRACKING_PARAMS = [
  'utm_source','utm_medium','utm_campaign','utm_id','utm_term','utm_content','timestamp','t','_t'
];

export function normalizeUrlForKey(raw: string): string {
  try {
    const u = new URL(raw, 'https://placeholder.local');
    TRACKING_PARAMS.forEach(p=>u.searchParams.delete(p));
    return u.href;
  } catch { return raw; }
}

export function buildUnifiedMediaKey(obj: Partial<MediaIdentity>): string {
  const norm = normalizeUrlForKey(obj.url || '');
  const type = obj.kind || (obj.mime ? 'audio' : 'media');
  const w = obj.width || 0;
  const h = obj.height || 0;
  const hashPrefix = obj.phash ? String(obj.phash).slice(0,8) : '';
  return `${type}|${norm}|${w}x${h}|${hashPrefix}`;
}

/**
 * 简单感知哈希 (aHash) 8x8 灰度 -> 64bit -> hex
 */
export function computePerceptualHash(img: HTMLImageElement | HTMLCanvasElement): string {
  const size = 8;
  const canvas = document.createElement('canvas');
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';
  ctx.drawImage(img, 0, 0, size, size);
  const data = ctx.getImageData(0,0,size,size).data;
  const gray: number[] = [];
  for (let i=0;i<data.length;i+=4) {
    gray.push(data[i]*0.299 + data[i+1]*0.587 + data[i+2]*0.114);
  }
  const avg = gray.reduce((a,b)=>a+b,0)/gray.length;
  let bits='';
  gray.forEach(v=> bits += v>avg ? '1':'0');
  let hex='';
  for(let i=0;i<bits.length;i+=4){ hex += parseInt(bits.substr(i,4),2).toString(16); }
  return hex;
}
