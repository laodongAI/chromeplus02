/**
 * 图片资源扫描：img / picture source / CSS 背景，支持 Shadow DOM。
 */

export interface ImageScanItem {
  url: string;
  width: number;
  height: number;
  kind: string;
}

export function scanImages(): ImageScanItem[] {
  const results: ImageScanItem[] = [];
  const seen = new Set<string>();
  const push = (url: string, w: number, h: number, kind: string) => {
    if (!url) return;
    try {
      const abs = new URL(url, document.baseURI).href;
      const key = `${abs}#${w}x${h}#${kind}`;
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

  // CSS 背景图
  deepQuerySelectorAll<HTMLElement>('*').forEach((el) => {
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

  // 可选：同源 <canvas> 抽取（best-effort）
  deepQuerySelectorAll<HTMLCanvasElement>('canvas').forEach((cv) => {
    try {
      if (!cv.width || !cv.height) return;
      const dataUrl = cv.toDataURL('image/png');
      if (typeof dataUrl === 'string' && dataUrl.startsWith('data:image/')) {
        push(dataUrl, cv.width, cv.height, 'canvas-inline');
      }
    } catch { /* tainted or unsupported */ }
  });

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

function deepQuerySelectorAll<T extends Element>(selector: string, root: Document | ShadowRoot = document): T[] {
  const out: T[] = [];
  const queue: (Document | ShadowRoot)[] = [root];
  while (queue.length) {
    const current = queue.shift()!;
    current.querySelectorAll<T>(selector).forEach((el) => out.push(el));
    current.querySelectorAll<HTMLElement>('*').forEach((el) => {
      const withShadow = el as HTMLElement & { shadowRoot?: ShadowRoot | null };
      if (withShadow.shadowRoot) queue.push(withShadow.shadowRoot);
    });
  }
  return out;
}
