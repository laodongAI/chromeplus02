import { MessageType, type TextContentDTO, type TextSelectionDTO } from '@/messaging';
import { blocksToPlainText, type ArticleBlock } from '@/core/articleBlocks';
import { extractArticleBlocks, readSelection } from './articleExtract';

/**
 * 页面文本抽取：正文、标题、元数据。
 * 正文容器按"非链接文本量 × 链接密度折损 + 段落奖励 + 语义标签奖励 — 嵌套候选罚分"打分取最优，
 * 而不是取查询顺序的第一个（第一个常是包住正文与侧栏的外层 wrapper）。
 * 没有语义容器时对 body 去噪后兜底，避免把导航/页脚/广告当正文。
 *
 * 产出两份同源数据：blocks（结构化正文，Markdown 导出、单文件归档、高亮定位都吃它）与
 * textContent（它的纯文本前缀，旧调用方继续用），两者出自同一次走查，不会各抽一遍再对不上。
 */

/** 回传正文字符上限：消息体积与下游可读性的折中，超出部分置 truncated 标志而非静默丢弃 */
export const MAX_TEXT_CHARS = 20000;

/** 正文打分输入（纯数据，便于单测） */
export interface TextCandidateStats {
  /** 容器 innerText 长度 */
  textLength: number;
  /** 容器内所有 <a> 的文本长度之和 */
  linkTextLength: number;
  /** 容器内 <p> 数量 */
  paragraphCount: number;
  /** 语义标签奖励：article/main 高于 .content/.post 这类 class 命中 */
  semanticBonus: number;
  /** 本容器内部还包含多少个其他候选（外层 wrapper 罚分，避免选中包住正文的壳） */
  nestedCandidates: number;
}

/**
 * 正文容器打分（纯函数）。
 * 链接密度高的容器是导航/索引而非正文，故对非链接文本量再按 (1 - 链接密度) 折损一次：
 * 只减掉链接文本不足以压制"正文 + 大量推荐链接"的外层壳。
 */
export function scoreTextCandidate(s: TextCandidateStats): number {
  const nonLink = Math.max(0, s.textLength - s.linkTextLength);
  const linkDensity = s.textLength > 0 ? Math.min(1, s.linkTextLength / s.textLength) : 1;
  return nonLink * (1 - linkDensity) + s.paragraphCount * 40 + s.semanticBonus - s.nestedCandidates * 120;
}

/** 折叠抽取文本里的冗余空白：行首尾空白去掉，连续空行压成一个，保留段落分隔 */
export function normalizeExtractedText(raw: string): string {
  return raw
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t\u00a0]+/g, ' ')
    .split('\n')
    .map(line => line.trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** 语义容器选择器 -> 打分奖励（article/main 最可信，class/id 命中次之） */
const CANDIDATE_SELECTORS: Array<{ selector: string; bonus: number }> = [
  { selector: 'article', bonus: 200 },
  { selector: 'main', bonus: 180 },
  { selector: '[role="main"]', bonus: 180 },
  { selector: '.article, .post, .post-content, .entry-content, .article-content', bonus: 120 },
  { selector: '.content, #content, #main', bonus: 80 }
];

/** 去噪时剔除的非正文子树，以及常见的隐藏/无障碍专用节点 */
const NOISE_SELECTOR = [
  'script', 'style', 'noscript', 'template', 'svg', 'canvas', 'iframe', 'form', 'button', 'input', 'select', 'textarea',
  'nav', 'header', 'footer', 'aside',
  '[role="navigation"]', '[role="banner"]', '[role="contentinfo"]', '[role="complementary"]', '[role="search"]',
  '[hidden]', '[aria-hidden="true"]', '.sr-only', '.visually-hidden',
  '.sidebar', '.nav', '.navbar', '.menu', '.footer', '.header', '.advert', '.ads', '.ad', '.advertisement', '.comment', '.comments', '.related', '.recommend'
].join(',');

/** 块级标签：兜底路径用 cloneNode 取 textContent 会丢段落分隔，先在这些节点后补换行 */
const BLOCK_SELECTOR = 'p,div,li,br,h1,h2,h3,h4,h5,h6,section,article,tr,blockquote,pre,figcaption,dt,dd';

export function initTextExtractor() {
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === MessageType.GET_TEXT_CONTENT) {
      try {
        sendResponse({ success: true, content: extractPageContent() });
      } catch (e: unknown) {
        // 走查也可能抛（极端 DOM、自定义元素），把原因带回去，别让面板只剩一句"提取失败"
        sendResponse({ success: false, error: (e as Error)?.message || '提取文本失败' });
      }
      return;
    }
    if (message?.type === MessageType.GET_TEXT_SELECTION) {
      try {
        sendResponse({ success: true, content: readSelection() as TextSelectionDTO });
      } catch (e: unknown) {
        sendResponse({ success: false, error: (e as Error)?.message || '读取选区失败' });
      }
    }
  });
}

/** 收集一个候选容器的打分输入（innerText 依赖渲染，只能在活动文档上取） */
function collectStats(el: HTMLElement, semanticBonus: number, nestedCandidates: number): TextCandidateStats {
  const text = el.innerText || '';
  let linkTextLength = 0;
  el.querySelectorAll('a').forEach(a => { linkTextLength += (a.innerText || a.textContent || '').length; });
  return {
    textLength: text.length,
    linkTextLength,
    paragraphCount: el.querySelectorAll('p').length,
    semanticBonus,
    nestedCandidates
  };
}

/**
 * 选出正文容器：同一元素被多个选择器命中时取最高奖励，
 * 外层 wrapper 因包含其他候选而被罚分，避免"选中整个内容区连同侧栏"。
 */
function pickBestContainer(): HTMLElement | null {
  /** 元素 -> 最高语义奖励（去重：article 可能同时命中 .content） */
  const bonusByEl = new Map<HTMLElement, number>();
  for (const { selector, bonus } of CANDIDATE_SELECTORS) {
    let matched: NodeListOf<Element>;
    try { matched = document.querySelectorAll(selector); } catch { continue; }
    matched.forEach(node => {
      const el = node as HTMLElement;
      bonusByEl.set(el, Math.max(bonusByEl.get(el) ?? 0, bonus));
    });
  }
  const els = Array.from(bonusByEl.keys());
  if (els.length === 0) return null;

  let best: HTMLElement | null = null;
  let bestScore = -Infinity;
  for (const el of els) {
    // 只统计严格后代，自身不算嵌套
    const nested = els.filter(other => other !== el && el.contains(other)).length;
    const score = scoreTextCandidate(collectStats(el, bonusByEl.get(el) ?? 0, nested));
    if (score > bestScore) { bestScore = score; best = el; }
  }
  return best;
}

/**
 * 无语义容器时的兜底：克隆 body 后剔除噪声子树再取文本。
 * 克隆节点不参与渲染，innerText 会退化成 textContent，故先在块级标签后补换行保住段落结构。
 * 全程不改动活动文档，页面不受影响。
 */
function extractDenoisedBody(): string {
  const clone = document.body.cloneNode(true) as HTMLElement;
  clone.querySelectorAll(NOISE_SELECTOR).forEach(n => n.remove());
  clone.querySelectorAll(BLOCK_SELECTOR).forEach(n => n.appendChild(document.createTextNode('\n')));
  return normalizeExtractedText(clone.textContent || '');
}

/**
 * 正文块：优先走语义容器；容器里没走出内容（SPA 壳、自定义元素包一切）再退到整页。
 * 噪声 class 过滤两条路都开着——正文容器里照样挂着"分享/相关推荐"。
 */
function extractBlocks(): ArticleBlock[] {
  const container = pickBestContainer();
  if (container) {
    const inContainer = extractArticleBlocks(container, { skipNoiseClass: true });
    if (blocksToPlainText(inContainer).trim()) return inContainer;
  }
  return extractArticleBlocks(document.body, { skipNoiseClass: true });
}

function extractPageContent(): TextContentDTO {
  const title = document.title || '';
  const description = getMetaContent('description') || getMetaContent('og:description');
  const keywords = (getMetaContent('keywords') || '').split(',').map(s => s.trim()).filter(Boolean);
  const author = getMetaContent('author') || getMetaContent('article:author');

  const blocks = extractBlocks();
  // 纯文本口径与 blocks 同源；块为空（极端页面）时退回旧的整页去噪文本，保证"至少有一段字"
  const raw = blocks.length ? blocksToPlainText(blocks) : extractDenoisedBody();

  const meta: Record<string, string> = {};
  Array.from(document.querySelectorAll('meta')).forEach(m => {
    const name = m.getAttribute('name') || m.getAttribute('property');
    const content = m.getAttribute('content');
    if (name && content) {
      meta[name] = content;
    }
  });

  return {
    title,
    description,
    keywords,
    author,
    textContent: raw.slice(0, MAX_TEXT_CHARS),
    // wordCount 报全文长度，truncated 告知展示/复制的是前缀，避免"显示 2 万字却只拿到 5 千字"
    wordCount: raw.length,
    truncated: raw.length > MAX_TEXT_CHARS,
    meta,
    blocks,
    url: location.href,
    canonicalUrl: canonicalUrl(),
    siteName: getMetaContent('og:site_name') || hostname(),
    publishedAt: publishedAt(),
    language: document.documentElement?.lang || undefined
  };
}

/** link rel=canonical：同一篇文章的分享链接常带不同 query，归档文件名要归成一个 */
function canonicalUrl(): string {
  try {
    const el = document.querySelector('link[rel="canonical"]') as HTMLLinkElement | null;
    return el?.href?.trim() || location.href;
  } catch {
    return location.href;
  }
}

function hostname(): string {
  try { return new URL(location.href).hostname; } catch { return ''; }
}

/** 发布时间：meta 优先，其次微格式 <time datetime="…"> */
function publishedAt(): string | undefined {
  return getMetaContent('article:published_time')
    || getMetaContent('og:article:published_time')
    || (document.querySelector('time[datetime]')?.getAttribute('datetime') || undefined);
}

function getMetaContent(name: string): string | undefined {
  const el = document.querySelector(`meta[name="${name}"], meta[property="${name}"]`);
  return el?.getAttribute('content') || undefined;
}