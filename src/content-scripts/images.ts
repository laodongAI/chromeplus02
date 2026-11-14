/**
 * 图片资源扫描：img / picture source / CSS 背景，支持 Shadow DOM。
 * 性能治理（P1-3）：
 *  - 背景图检测不再对 deepQuerySelectorAll('*') 的每个元素调用 getComputedStyle
 *    （万级节点页面全量读取计算样式会强制样式重算造成卡顿）；
 *    改为先用属性选择器筛出有限候选集（内联 style 含 background、或 class 含
 *    bg/background/banner/cover/hero 关键词的元素），再仅在候选集上读取样式。
 *    代价：纯外部 CSS 规则命中且类名不含上述关键词的背景图可能漏检（可接受）。
 *  - canvas 抓取改为按需触发：仅当调用方显式传入 includeCanvas 时执行，
 *    并限制像素与 dataURL 体积，避免把几 MB 的 data URL 塞进每次扫描结果。
 */

import { deepQuerySelectorAll } from '@/utils/dom';
// P1-8：分级日志（内容脚本上下文，debug 默认静默）
import { createLogger } from '@/utils/logger';

/** 本模块 logger：保留原 `[content/images]` 前缀语义 */
const log = createLogger('content/images');

export interface ImageScanItem {
  url: string;
  width: number;
  height: number;
  kind: string;
}

/** scanImages 选项 */
export interface ScanImagesOptions {
  /** 是否抓取同源 <canvas> 内容（默认 false，由面板显式请求时开启） */
  includeCanvas?: boolean;
}

/** 背景图候选选择器：属性子串匹配，先把范围收窄再读样式 */
const BG_CANDIDATE_SELECTOR =
  '[style*="background"], [class*="bg"], [class*="background"], [class*="banner"], [class*="cover"], [class*="hero"]';
/** 背景图候选上限：极端页面下防止候选集本身过大 */
const BG_CANDIDATE_LIMIT = 300;
/** canvas 抓取像素上限（约 400 万像素），超限跳过 */
const CANVAS_MAX_PIXELS = 4_000_000;
/** canvas dataURL 长度上限（约 2MB 字符），超限跳过 */
const CANVAS_MAX_DATA_URL_LENGTH = 2_000_000;

/**
 * 扫描页面图片资源。
 * @param options 扫描选项（includeCanvas 控制是否抓取 canvas）
 */
export function scanImages(options: ScanImagesOptions = {}): ImageScanItem[] {
  const results: ImageScanItem[] = [];
  const seen = new Set<string>(); // 去重键集合（url+尺寸+类型）
  const push = (url: string, w: number, h: number, kind: string) => {
    if (!url) return;
    try {
      const abs = new URL(url, document.baseURI).href; // 相对地址转绝对
      const key = `${abs}#${w}x${h}#${kind}`; // 复合去重键
      if (seen.has(key)) return;
      seen.add(key);
      results.push({ url: abs, width: w || 0, height: h || 0, kind });
    } catch { /* noop */ }
  };

  // <img>：支持 src、currentSrc、srcset、以及常见 lazy 属性
  deepQuerySelectorAll<HTMLImageElement>('img').forEach((img) => {
    const lazyAttrs = [
      'data-src', 'data-original', 'data-lazy', 'data-lazy-src', 'data-ks-lazyload',
      'data-srcset', 'data-original-src', 'data-url', 'lazy-src', 'data-image'
    ];
    const srcset = img.getAttribute('srcset') || img.getAttribute('data-srcset') || '';
    const bestFromSet = srcset ? pickBestFromSrcset(srcset, Math.max(img.clientWidth, img.naturalWidth)) : '';
    let src = bestFromSet || img.currentSrc || img.src || '';
    if (!src) {
      for (const a of lazyAttrs) {
        const v = img.getAttribute(a);
        if (v && v.trim()) { src = v.trim(); break; }
      }
    }
    if (src) push(src, img.naturalWidth || img.width || 0, img.naturalHeight || img.height || 0, 'img');
  });

  // <picture><source>：解析 srcset 的最佳候选
  deepQuerySelectorAll<HTMLSourceElement>('picture source').forEach((s) => {
    const srcset = s.getAttribute('srcset');
    if (!srcset) return;
    const best = pickBestFromSrcset(srcset, 0);
    if (best) push(best, 0, 0, 'source');
  });

  // CSS 背景图：先按属性筛候选（避免全量 getComputedStyle），再在候选集上读样式
  const bgCandidates = deepQuerySelectorAll<HTMLElement>(BG_CANDIDATE_SELECTOR);
  bgCandidates.slice(0, BG_CANDIDATE_LIMIT).forEach((el) => {
    const style = getComputedStyle(el);
    const bg = style.backgroundImage;
    if (!bg || bg === 'none') return;
    const matches = bg.match(/url\(("|')?(.*?)("|')?\)/g);
    if (!matches) return;
    matches.forEach((m) => {
      const inner = m.replace(/url\(("|')?/, '').replace(/("|')?\)$/, '');
      if (/^data:/i.test(inner)) return;
      push(inner, el.clientWidth, el.clientHeight, 'background');
    });
  });

  // Open Graph / 其他 meta 图片：og:image / twitter:image 等（按需扩展）
  deepQuerySelectorAll<HTMLMetaElement>('meta').forEach(meta => {
    const prop = meta.getAttribute('property') || meta.getAttribute('name') || '';
    if (!prop) return;
    const content = meta.getAttribute('content') || '';
    if (!content) return;
    const normalized = content.trim();
    if (!normalized) return;
    if (/^data:/i.test(normalized)) return; // 跳过内嵌 data
    if (prop.toLowerCase() === 'og:image') {
      push(normalized, 0, 0, 'meta-og');
    } else if (prop.toLowerCase() === 'twitter:image' || prop.toLowerCase() === 'twitter:image:src') {
      push(normalized, 0, 0, 'meta-twitter');
    }
  });

  // 同源 <canvas> 抽取（best-effort）：按需触发 + 体积限制（P1-3 治理点）
  if (options.includeCanvas) {
    deepQuerySelectorAll<HTMLCanvasElement>('canvas').forEach((cv) => {
      try {
        if (!cv.width || !cv.height) return;
        if (cv.width * cv.height > CANVAS_MAX_PIXELS) {
          log.debug('跳过大尺寸 canvas:', cv.width, 'x', cv.height);
          return;
        }
        const dataUrl = cv.toDataURL('image/png');
        if (typeof dataUrl === 'string' && dataUrl.startsWith('data:image/') && dataUrl.length <= CANVAS_MAX_DATA_URL_LENGTH) {
          push(dataUrl, cv.width, cv.height, 'canvas-inline');
        } else if (dataUrl && dataUrl.length > CANVAS_MAX_DATA_URL_LENGTH) {
          log.debug('跳过超大 canvas dataURL:', dataUrl.length);
        }
      } catch { /* tainted or unsupported */ }
    });
  }

  return results;
}

// 解析 srcset，选择尽可能高质量的候选：优先 w 描述，其次 x 倍数
function pickBestFromSrcset(srcset: string, targetWidth: number): string {
  try {
    const entries = srcset
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((part) => {
        const [url, desc] = part.split(/\s+/, 2);
        if (!desc) return { url, score: Number.POSITIVE_INFINITY };
        let score = Number.POSITIVE_INFINITY;
        if (/^([0-9]+)w$/i.test(desc)) {
          const w = parseInt(desc, 10);
          score = targetWidth ? Math.max(0, w - targetWidth) : -w;
        } else if (/^([0-9]+(?:\.[0-9]+)?)x$/i.test(desc)) {
          const x = parseFloat(desc);
          score = -x;
        }
        return { url, score };
      });
    if (!entries.length) return '';
    entries.sort((a, b) => (a.score === b.score ? 0 : a.score < b.score ? -1 : 1));
    return entries[0].url || '';
  } catch {
    try { return srcset.split(',')[0].trim().split(/\s+/)[0] || ''; } catch { return ''; }
  }
}
