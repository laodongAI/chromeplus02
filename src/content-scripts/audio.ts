/**
 * 音频资源扫描器：从页面中识别可下载的音频 URL。
 * 策略：
 *  - <audio> 元素的 src 与 <source> 子元素
 *  - <a href> 指向常见音频后缀（.mp3/.m4a/.aac/.wav/.ogg）
 *  - meta/og:audio（若存在）
 */

const AUDIO_EXT = [/\.mp3(\?|$)/i, /\.m4a(\?|$)/i, /\.aac(\?|$)/i, /\.wav(\?|$)/i, /\.ogg(\?|$)/i];
const AUDIO_DATA_TYPES = new Set(['mp3', 'm4a', 'aac', 'flac', 'wav', 'ogg', 'audio']);

export interface AudioItem {
  url: string;
  title?: string;
}

function isAudioUrl(u: string): boolean {
  if (!u) return false;
  if (AUDIO_EXT.some((re) => re.test(u))) return true;
  // 允许基于查询参数的类型提示
  try {
    const url = new URL(u, document.baseURI);
    const t = (url.searchParams.get('type') || url.searchParams.get('mime') || '').toLowerCase();
    if (t && (t.startsWith('audio/') || isKnownAudioType(t))) return true;
  } catch { /* noop */ }
  return false;
}

function isKnownAudioType(type?: string | null): boolean {
  if (!type) return false;
  return AUDIO_DATA_TYPES.has(type.toLowerCase());
}

export function scanAudioUrls(): AudioItem[] {
  const urls = new Map<string, AudioItem>();
  const add = (u: string | null | undefined, title?: string) => {
    if (!u) return;
    try {
      const abs = new URL(u, document.baseURI).href;
      urls.set(abs, { url: abs, title: (title || document.title || '').trim() });
    } catch { /* ignore invalid */ }
  };

  // 1) audio 标签（支持 Shadow DOM）
  deepQuerySelectorAll<HTMLAudioElement>('audio').forEach((au) => {
    if (au.src && isAudioUrl(au.src)) add(au.src, au.getAttribute('title') || document.title);
    au.querySelectorAll('source').forEach((s) => {
      const src = (s as HTMLSourceElement).src;
      const type = (s as HTMLSourceElement).type || '';
      if (src && (isAudioUrl(src) || type.toLowerCase().startsWith('audio/'))) add(src, au.getAttribute('title') || document.title);
    });
    // 常见懒加载属性
    const lazy = au.getAttribute('data-src') || au.getAttribute('data-audio') || au.getAttribute('data-url');
    if (lazy && isAudioUrl(lazy)) add(lazy, au.getAttribute('title') || document.title);
  });

  // 2) 可能的下载链接
  deepQuerySelectorAll<HTMLAnchorElement>('a[href]').forEach((a) => {
    const href = a.href;
    if (!href) return;
    const typeHint = (a.getAttribute('type') || '').toLowerCase();
    if (isAudioUrl(href) || typeHint.startsWith('audio/')) add(href, a.textContent || a.title || document.title);
  });

  // 2.1) 自定义 data-url（例如 CGTN 列表的播放按钮）
  const dataUrlSelectors = ['.js-play[data-url]', '[data-audio-url]'];
  dataUrlSelectors.forEach((selector) => {
    deepQuerySelectorAll<HTMLElement>(selector).forEach((el) => {
      const rawUrl = el.getAttribute('data-url') || el.getAttribute('data-audio-url');
      if (!rawUrl) return;

      const typeHint = el.getAttribute('data-type') || el.getAttribute('data-format');
      const looksLikeAudio = isAudioUrl(rawUrl) || isKnownAudioType(typeHint) || el.classList.contains('js-play');
      if (!looksLikeAudio) return;

      const title =
        el.getAttribute('data-showname') ||
        el.getAttribute('data-showName') ||
        el.getAttribute('data-title') ||
        el.textContent ||
        document.title;

      add(rawUrl, title?.trim() || document.title);
    });
  });

  // 3) og:audio
  const ogAudio = document.querySelector<HTMLMetaElement>('meta[property="og:audio"][content]');
  if (ogAudio?.content && isAudioUrl(ogAudio.content)) add(ogAudio.content, document.title);

    // 4) preload/link 引用的音频资源 (<link rel="preload" as="audio" href="..."> 或 <link rel="audio" href>)
    document.querySelectorAll<HTMLLinkElement>('link[rel][href]').forEach(link => {
      const rel = (link.rel || '').toLowerCase();
      const asAttr = (link.getAttribute('as') || '').toLowerCase();
      if (!link.href) return;
      const isAudioRel = rel === 'audio' || (rel === 'preload' && asAttr === 'audio');
      if (isAudioRel && isAudioUrl(link.href)) add(link.href, document.title);
    });

    // 5) JSON-LD 中的 AudioObject 描述
    document.querySelectorAll<HTMLScriptElement>('script[type="application/ld+json"]').forEach(script => {
      const text = script.textContent || script.innerHTML || '';
      if (!text.trim()) return;
      try {
        const data = JSON.parse(text);
        extractAudioFromJsonLd(data).forEach(item => add(item.url, item.title));
      } catch { /* ignore malformed JSON-LD */ }
    });

  return Array.from(urls.values());
}

function deepQuerySelectorAll<T extends Element>(selector: string, root: Document | ShadowRoot = document): T[] {
  const out: T[] = [];
  const queue: (Document | ShadowRoot)[] = [root];
  while (queue.length) {
    const current = queue.shift()!;
    current.querySelectorAll<T>(selector).forEach((el) => out.push(el));
    current.querySelectorAll<HTMLElement>('*').forEach((el) => {
      const anyEl = el as any;
      if (anyEl.shadowRoot) queue.push(anyEl.shadowRoot as ShadowRoot);
    });
  }
  return out;
}

// ===== JSON-LD 提取 =====
interface JsonLdAudioLike { url?: string; contentUrl?: string; name?: string; headline?: string; }
function extractAudioFromJsonLd(root: any): AudioItem[] {
  const found: AudioItem[] = [];
  const visit = (node: any) => {
    if (!node || typeof node !== 'object') return;
    // 处理数组
    if (Array.isArray(node)) { node.forEach(visit); return; }
    const type = (node['@type'] || '').toLowerCase();
    if (type === 'audioobject' || type === 'musicrecording') {
      const candidate: JsonLdAudioLike = node;
      const url = candidate.contentUrl || candidate.url;
      if (url && isAudioUrl(url)) {
        const title = candidate.name || candidate.headline || document.title;
        found.push({ url, title });
      }
    }
    // 继续遍历子属性
    Object.keys(node).forEach(k => {
      if (k === '@context' || k === '@type') return;
      visit(node[k]);
    });
  };
  visit(root);
  return found;
}
