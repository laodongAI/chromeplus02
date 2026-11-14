/**
 * 音频资源扫描器：从页面中识别可下载的音频 URL。
 * 策略：
 *  - <audio> 元素的 src 与 <source> 子元素
 *  - <a href> 指向常见音频后缀（.mp3/.m4a/.aac/.wav/.ogg/.flac/.opus）
 *  - meta/og:audio（若存在）
 */

// 深度查询（含 Shadow DOM）统一使用共享工具，消除与 router.ts / images.ts 的重复实现
import { deepQuerySelectorAll } from '@/utils/dom';

const AUDIO_EXT = [/\.mp3(\?|$)/i, /\.m4a(\?|$)/i, /\.aac(\?|$)/i, /\.wav(\?|$)/i, /\.ogg(\?|$)/i, /\.flac(\?|$)/i, /\.opus(\?|$)/i];
const AUDIO_DATA_TYPES = new Set(['mp3', 'm4a', 'aac', 'flac', 'wav', 'ogg', 'opus', 'audio']);

/** 标题长度上限：避免把整段歌词/简介当成标题塞进列表行 */
const MAX_TITLE_LEN = 200;

/**
 * 纯按钮文案/格式名黑名单：这些文本出现在下载链接里时不含任何曲目信息，
 * 采纳它们会让整页音频都叫"下载"或"播放"。按整串精确匹配（归一化后），
 * 不做子串匹配，避免误伤"播放列表：某某专辑"这类有效标题。
 */
const NOISE_TITLES = new Set([
  '下载', '点击下载', '立即下载', '下载音频', '下载歌曲', '下载文件', '保存', '更多',
  '播放', '点击播放', '立即播放', '在线播放', '播放音频', '试听', '点击试听', '在线试听',
  '音频', '音乐', '歌曲', '声音', 'audio', 'music', 'sound', 'song',
  'play', 'download', 'listen', 'play audio', 'download audio', 'save', 'more',
  'mp3', 'm4a', 'aac', 'wav', 'ogg', 'flac', 'opus', 'webm', 'mp4'
]);

/** 归一化标题：去零宽字符、折叠空白、去首尾空白 */
function normalizeTitle(raw: string | null | undefined): string {
  return (raw || '').replace(/[\u200b-\u200d\ufeff]/g, '').replace(/\s+/g, ' ').trim();
}

/** 是否为无信息量的噪声标题（按钮文案、纯符号、单字符） */
function isNoiseTitle(t: string): boolean {
  if (t.length <= 1) return true;
  if (/^[\p{P}\p{S}]+$/u.test(t)) return true;
  const key = t.toLowerCase().replace(/[。.！!？?：:、，,\s]+$/g, '').trim();
  return NOISE_TITLES.has(key);
}

/**
 * 从 URL 末段文件名兜底出标题（去扩展名、下划线转空格）。
 * 文件名是事实证据，即便叫 download.mp3 也照实给出——套用按钮文案黑名单会把它清成空标题，
 * 用户看到一排"未命名音频"比看到一排真实文件名更糟。
 * data:/blob: 没有有意义的文件名，返回空串由 UI 落到"未命名音频"，
 * 而不是拿整页 document.title 冒充曲名。
 */
export function audioTitleFromUrl(url: string): string {
  try {
    const u = new URL(url, 'https://placeholder.local');
    if (u.protocol === 'data:' || u.protocol === 'blob:') return '';
    const last = u.pathname.split('/').filter(Boolean).pop() || '';
    const name = decodeURIComponent(last)
      .replace(/\.[a-z0-9]{2,5}$/i, '')
      .replace(/_+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    return name.slice(0, MAX_TITLE_LEN);
  } catch { return ''; }
}

/**
 * 按优先级取第一个有效标题，全部无效时退到 URL 文件名。
 * 纯函数（不读 document），可直接被 tests/unit 覆盖。
 * @param candidates 候选标题，按可信度从高到低排列
 * @param url        资源绝对 URL，用于兜底
 */
export function cleanAudioTitle(candidates: Array<string | null | undefined>, url: string): string {
  for (const c of candidates) {
    const t = normalizeTitle(c);
    if (t && !isNoiseTitle(t)) return t.slice(0, MAX_TITLE_LEN);
  }
  return audioTitleFromUrl(url);
}

/** 取元素自身的可访问标题，其次 <figure><figcaption>（音频播放器最常见的标题容器） */
function nearbyTitle(el: Element): string {
  const own = el.getAttribute('aria-label') || el.getAttribute('title') || '';
  if (normalizeTitle(own)) return own;
  const caption = el.closest('figure')?.querySelector('figcaption');
  return caption?.textContent || '';
}

export interface AudioItem {
  url: string;
  title?: string;
}

export function isAudioUrl(u: string): boolean {
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
  const add = (u: string | null | undefined, ...candidates: Array<string | null | undefined>) => {
    if (!u) return;
    try {
      const abs = new URL(u, document.baseURI).href;
      urls.set(abs, { url: abs, title: cleanAudioTitle(candidates, abs) });
    } catch { /* ignore invalid */ }
  };

  // 1) audio 标签（支持 Shadow DOM）
  deepQuerySelectorAll<HTMLAudioElement>('audio').forEach((au) => {
    if (au.src && isAudioUrl(au.src)) add(au.src, nearbyTitle(au));
    au.querySelectorAll('source').forEach((s) => {
      const src = (s as HTMLSourceElement).src;
      const type = (s as HTMLSourceElement).type || '';
      if (src && (isAudioUrl(src) || type.toLowerCase().startsWith('audio/'))) add(src, nearbyTitle(au), s.getAttribute('title'));
    });
    // 常见懒加载属性
    const lazy = au.getAttribute('data-src') || au.getAttribute('data-audio') || au.getAttribute('data-url');
    if (lazy && isAudioUrl(lazy)) add(lazy, nearbyTitle(au));
  });

  // 2) 可能的下载链接
  deepQuerySelectorAll<HTMLAnchorElement>('a[href]').forEach((a) => {
    const href = a.href;
    if (!href) return;
    const typeHint = (a.getAttribute('type') || '').toLowerCase();
    // download 属性常直接写着目标文件名，比锚文本（多为"下载/播放"）可信得多
    if (isAudioUrl(href) || typeHint.startsWith('audio/')) {
      add(href, a.getAttribute('download'), a.getAttribute('title'), a.getAttribute('aria-label'), a.textContent);
    }
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
        nearbyTitle(el) ||
        el.textContent;

      add(rawUrl, title);
    });
  });

  // 3) og:audio
  const ogAudio = document.querySelector<HTMLMetaElement>('meta[property="og:audio"][content]');
  if (ogAudio?.content && isAudioUrl(ogAudio.content)) add(ogAudio.content, document.title);

    // 4) preload/link 引用的音频资源 (<link rel="preload" as="audio" href="..."> 或 <link rel="audio" href>)
    const audioRelTypes = ['audio', 'preload', 'enclosure'];
    document.querySelectorAll<HTMLLinkElement>('link[rel][href]').forEach(link => {
      const rel = (link.rel || '').toLowerCase();
      const asAttr = (link.getAttribute('as') || '').toLowerCase();
      if (!link.href) return;
      const isAudioRel = audioRelTypes.includes(rel) || (rel === 'preload' && asAttr === 'audio');
      if (isAudioRel && isAudioUrl(link.href)) add(link.href, link.getAttribute('title'), document.title);
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

// ===== JSON-LD 提取 =====
interface JsonLdAudioLike { url?: string; contentUrl?: string; name?: string; headline?: string; }
function extractAudioFromJsonLd(root: Record<string, unknown>): AudioItem[] {
  const found: AudioItem[] = [];
  const visit = (node: Record<string, unknown> | Record<string, unknown>[] | null) => {
    if (!node || typeof node !== 'object') return;
    // 处理数组
    if (Array.isArray(node)) { node.forEach(visit); return; }
    const type = (node['@type'] as string || '').toLowerCase();
    if (['audioobject', 'musicrecording', 'audiobook'].includes(type)) {
      const candidate = node as JsonLdAudioLike;
      const url = candidate.contentUrl || candidate.url;
      if (url && isAudioUrl(url)) {
        const title = candidate.name || candidate.headline;
        found.push({ url, title });
      }
    }
    // 继续遍历子属性
    Object.keys(node).forEach(k => visit(node[k] as Record<string, unknown>));
  };
  visit(root);
  return found;
}
