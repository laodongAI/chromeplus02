/**
 * DOM → 结构化正文块 + 划词选区锚点（内容脚本专用：离不开 document）。
 *
 * 分工：这里只把节点走成纯数据，不做任何排版决策（标题井号、表格竖线、缩进由
 * @/core/articleBlocks 负责），锚点的重定位由 @/core/textHighlight 负责。
 * 好处是排版与定位都能在 node 环境单测；代价是走查本身测不了，只能靠线上验证，
 * 所以这里的规则一律写得"宁缺毋滥"：认不出的结构拍平成段落，绝不猜成别的类型。
 */

import type { ArticleBlock, InlineSpan } from '@/core/articleBlocks';
import { inlineToPlainText } from '@/core/articleBlocks';
import { makeAnchor, type HighlightAnchor } from '@/core/textHighlight';

/** 图片块（走查里要单独读 alt，联合类型不带 alt 的分支得先窄化掉） */
type ImageBlock = Extract<ArticleBlock, { type: 'image' }>;

/** 单次抽取的块数上限：病态页面（把每行都包成 div 的站点）不该把消息通道撑爆 */
const MAX_BLOCKS = 3000;
/** 单个代码块字符上限：超过的多半是内联脚本或整页 diff，不是正文 */
const MAX_CODE_CHARS = 20000;
/** 选区字符上限：再长的"高亮"已经不是高亮，定位收益也接近零 */
export const MAX_SELECTION_CHARS = 4000;

/** 噪声标签：与 text.ts 的 NOISE_SELECTOR 同源语义，这里按 tagName 快判（选择器匹配要 try/catch） */
const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'SVG', 'CANVAS', 'IFRAME', 'FORM', 'BUTTON', 'INPUT', 'SELECT', 'TEXTAREA', 'NAV', 'HEADER', 'FOOTER', 'ASIDE', 'DATALIST', 'OPTGROUP', 'OPTION']);

/** 块级标签：遇到就收尾当前行内片段，另起一块 */
const BLOCK_TAGS = new Set([
  'ADDRESS', 'ARTICLE', 'ASIDE', 'BLOCKQUOTE', 'CENTER', 'DD', 'DETAILS', 'DIALOG', 'DIV', 'DL', 'DT',
  'FIELDSET', 'FIGCAPTION', 'FIGURE', 'FOOTER', 'FORM', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'HEADER',
  'HR', 'LI', 'MAIN', 'NAV', 'OL', 'P', 'PRE', 'SECTION', 'TABLE', 'TBODY', 'TD', 'TH', 'THEAD', 'TR', 'UL'
]);

/** 行内标签 → Markdown 强调类型（嵌套时取外层，与 articleBlocks 的"只保留一种标记"约定一致） */
const MARK_TAGS: Record<string, 'strong' | 'em' | 'code' | 'del'> = {
  STRONG: 'strong', B: 'strong', EM: 'em', I: 'em', CODE: 'code', KBD: 'code', SAMP: 'code', VAR: 'code',
  DEL: 'del', S: 'del', STRIKE: 'del'
};

/** 噪声 class/id（列表类站点惯用的侧栏/推荐位命名，与 NOISE_SELECTOR 保持同一批关键词） */const NOISE_CLASS_RE = /(^|[-_\s])(sidebar|nav|menu|footer|advert|ads?|advertisement|comment|related|recommend|share|subscribe|cookie|banner|toolbar|crumb)([-_\s]|$)/i;

export interface ExtractOptions {
  /** 噪声 class 过滤：整页兜底时要开，正文容器内可以关（容器里也常有 .share 按钮组） */
  skipNoiseClass?: boolean;
}

/** 走查入口：root 的子孙节点 → 结构化正文块 */
export function extractArticleBlocks(root: Element, opts: ExtractOptions = {}): ArticleBlock[] {
  const out: ArticleBlock[] = [];
  walkChildren(root, out, opts);
  return out;
}

function walkChildren(parent: Element, out: ArticleBlock[], opts: ExtractOptions) {
  for (const child of Array.from(parent.children)) {
    if (out.length >= MAX_BLOCKS) return;
    walkBlock(child, out, opts);
  }
}

/**
 * 块级元素 → 0..n 个块。
 * 认得出的结构（标题/列表/表格/代码/图/分隔线/引用）按类型出块，认不出的容器递归下钻，
 * 只剩文字的容器拍成一个段落——这是"宁缺毋滥"的落点：段落永远比丢内容好。
 */
function walkBlock(el: Element, out: ArticleBlock[], opts: ExtractOptions) {
  if (isSkipped(el, opts)) return;
  const tag = el.tagName;

  if (/^H[1-6]$/.test(tag)) {
    const spans = inlineOf(el, opts);
    if (plain(spans)) out.push({ type: 'heading', level: Number(tag.charAt(1)), spans });
    return;
  }
  if (tag === 'HR') { out.push({ type: 'hr' }); return; }
  if (tag === 'PRE') {
    const b = codeBlock(el);
    if (b) out.push(b);
    return;
  }
  if (tag === 'UL' || tag === 'OL') { listBlock(el, out, opts); return; }
  if (tag === 'TABLE') {
    const b = tableBlock(el);
    if (b) out.push(b);
    else mixedBlock(el, out, opts);   // 表格当布局用的站点：退回普通走查，别整块丢掉
    return;
  }
  if (tag === 'IMG') {
    const b = imageBlock(el as HTMLImageElement, '');
    if (b) out.push(b);
    return;
  }
  if (tag === 'FIGURE' || tag === 'PICTURE') { figureBlock(el, out, opts); return; }
  if (tag === 'BLOCKQUOTE') { quoteBlock(el, out, opts); return; }
  if (tag === 'BR') return;

  mixedBlock(el, out, opts);
}

/** 引用块：内部的标题保留层级，其余正文降级成 quote（Markdown 的 > 只管段落） */
function quoteBlock(el: Element, out: ArticleBlock[], opts: ExtractOptions) {
  const inner: ArticleBlock[] = [];
  walkChildren(el, inner, opts);
  if (!inner.length) {
    const spans = inlineOf(el, opts);
    if (plain(spans)) out.push({ type: 'quote', spans });
    return;
  }
  for (const b of inner) {
    if (b.type === 'paragraph') out.push({ type: 'quote', spans: b.spans });
    else out.push(b);
  }
}

/** 图文混排的 figure：图出图块，figcaption 作上一张图的说明 */
function figureBlock(el: Element, out: ArticleBlock[], opts: ExtractOptions) {
  const caption = textOfFirst(el, 'FIGCAPTION');
  const imgs = Array.from(el.querySelectorAll('img')) as HTMLImageElement[];
  let pushed = 0;
  for (const img of imgs.slice(0, 12)) {
    if (isSkipped(img, opts)) continue;
    const b = imageBlock(img, caption);
    if (b) { out.push(b); pushed++; }
  }
  if (pushed) return;
  mixedBlock(el, out, opts);
}

function imageBlock(img: HTMLImageElement, caption: string): ImageBlock | null {
  const src = imageSrc(img);
  if (!src) return null;
  // 1x1/占位图与装饰图不进归档：正文里多一张灰块比少一张更糟
  if (img.naturalWidth && img.naturalWidth <= 40) return null;
  const alt = (img.getAttribute('alt') || img.getAttribute('title') || caption || '').trim();
  return { type: 'image', src, alt };
}

/**
 * 图片真实地址：懒加载站点把地址藏在 data-* / srcset 里，src 往往是一张占位图。
 * 取不到就返回空串（调用方丢块），而不是留一个必然 404 的占位地址。
 */
function imageSrc(img: HTMLImageElement): string {
  const cur = (img.currentSrc || img.getAttribute('src') || '').trim();
  const lazyKeys = ['data-src', 'data-original', 'data-lazy-src', 'data-original-src', 'data-actualsrc', 'data-echo'];
  const isPlaceholder = !cur || cur.startsWith('data:') || /placeholder|blank|spacer|1x1|loading/i.test(cur);
  if (isPlaceholder) {
    for (const key of lazyKeys) {
      const v = (img.getAttribute(key) || '').trim();
      if (v) return absUrl(v);
    }
  }
  const fromSet = pickSrcset(img.getAttribute('srcset'));
  const styleSet = pickCssUrl(img.getAttribute('style'));
  const best = fromSet || (isPlaceholder ? styleSet : '') || cur;
  return best ? absUrl(best) : '';
}

/** srcset 里按描述符挑最大的一张（无描述符时取最后一个，与浏览器默认一致） */
function pickSrcset(srcset: string | null): string {
  const raw = (srcset || '').trim();
  if (!raw) return '';
  let best = '';
  let bestW = -1;
  for (const part of raw.split(',')) {
    const [url, ...desc] = part.trim().split(/\s+/);
    if (!url) continue;
    const w = Number((desc[0] || '').replace(/w$/i, '')) || 0;
    if (w >= bestW) { bestW = w; best = url; }
  }
  return best;
}

/** 背景图兜底：`background-image:url(x)` 里的地址 */
function pickCssUrl(style: string | null): string {
  const m = /url\(\s*['"]?([^'")]+)['"]?\s*\)/i.exec(style || '');
  return m ? m[1].trim() : '';
}

function absUrl(raw: string): string {
  try { return new URL(raw, document.baseURI).href; } catch { return raw; }
}

/** 代码块：只取 textContent（innerText 会把高亮 span 的换行算两遍），语言从常见 class 里认 */
function codeBlock(pre: Element): ArticleBlock | null {
  const codeEl = pre.querySelector('code') || pre;
  const text = String(codeEl.textContent || '').replace(/\r\n?/g, '\n').replace(/\n{3,}/g, '\n\n').replace(/^\n+|\n+$/g, '');
  if (!text.trim()) return null;
  const lang = /\blanguage-([\w+#-]+)/i.exec(codeEl.className)?.[1] || /\bhljs-([\w+#-]+)/i.exec(codeEl.className)?.[1];
  const clipped = text.length > MAX_CODE_CHARS ? `${text.slice(0, MAX_CODE_CHARS)}\n…（代码过长已截断）` : text;
  return { type: 'code', text: clipped, ...(lang ? { lang } : {}) };
}

/**
 * 列表：一个 ul/ol 出一个块；条目里嵌套的子列表单独成块跟在后面。
 * ArticleBlock 的 list 不带 children 字段，硬做无限嵌套会让 Markdown 与归档两头都复杂一倍，
 * 收益不值——拍平后信息不丢，只是缩进层级没了。
 */
function listBlock(el: Element, out: ArticleBlock[], opts: ExtractOptions) {
  const ordered = el.tagName === 'OL';
  const start = Number(el.getAttribute('start')) || 1;
  const items: InlineSpan[][] = [];
  const nested: Element[] = [];
  for (const li of Array.from(el.children)) {
    if (li.tagName !== 'LI' || isSkipped(li, opts)) continue;
    const own: InlineSpan[] = [];
    for (const n of Array.from(li.childNodes)) {
      if (n.nodeType === Node.TEXT_NODE) { pushText(own, (n as Text).data); continue; }
      if (n.nodeType !== Node.ELEMENT_NODE) continue;
      const c = n as Element;
      if (isSkipped(c, opts)) continue;
      if (c.tagName === 'UL' || c.tagName === 'OL') { nested.push(c); continue; }
      collectInline(c, own, MARK_TAGS[c.tagName], hrefOf(c), opts);
    }
    if (plain(own)) items.push(own);
  }
  if (items.length) out.push({ type: 'list', ordered, start, items });
  for (const sub of nested) {
    if (out.length >= MAX_BLOCKS) return;
    listBlock(sub, out, opts);
  }
}

/** 表格：首行整行是 th 才当表头，否则没有表头（布局表不误判成数据表） */
function tableBlock(table: Element): ArticleBlock | null {
  const rows = (Array.from(table.querySelectorAll('tr')) as Element[]).filter(tr => !isSkipped(tr, {}));
  if (!rows.length) return null;
  const grid: string[][] = [];
  let headerless = true;
  rows.forEach((tr, i) => {
    const cells = Array.from(tr.children).filter(c => c.tagName === 'TD' || c.tagName === 'TH');
    if (!cells.length) return;
    if (i === 0 && cells.every(c => c.tagName === 'TH')) headerless = false;
    grid.push(cells.map(cellText));
  });
  if (!grid.length) return null;
  const header = headerless ? [] : grid[0];
  const body = headerless ? grid : grid.slice(1);
  // 只有一行一列的"表"是布局壳，交给段落走查
  if (body.length + header.length < 2 || Math.max(...grid.map(r => r.length)) < 2) return null;
  return { type: 'table', header, rows: body.filter(r => r.some(Boolean)) };
}

/** 单元格：合并单元格不做（渲染层按列宽补齐），只把文本压干净 */
function cellText(cell: Element): string {
  return String(cell.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 500);
}

/**
 * 混合容器：行内内容攒成段落，遇到块级子元素先收尾再递归。
 * `<br>` 直接分段——正文里连续 br 是段落分隔的常见写法，压成空格会让两句话粘一起。
 */
function mixedBlock(el: Element, out: ArticleBlock[], opts: ExtractOptions) {
  let spans: InlineSpan[] = [];
  const flush = () => {
    if (plain(spans) && out.length < MAX_BLOCKS) out.push({ type: 'paragraph', spans });
    spans = [];
  };
  for (const n of Array.from(el.childNodes)) {
    if (n.nodeType === Node.TEXT_NODE) { pushText(spans, (n as Text).data); continue; }
    if (n.nodeType !== Node.ELEMENT_NODE) continue;
    const c = n as Element;
    if (isSkipped(c, opts)) continue;
    if (c.tagName === 'BR') { flush(); continue; }
    if (BLOCK_TAGS.has(c.tagName)) { flush(); walkBlock(c, out, opts); continue; }
    collectInline(c, spans, MARK_TAGS[c.tagName], hrefOf(c), opts);
  }
  flush();
}

function inlineOf(el: Element, opts: ExtractOptions): InlineSpan[] {
  const spans: InlineSpan[] = [];
  for (const n of Array.from(el.childNodes)) {
    if (n.nodeType === Node.TEXT_NODE) { pushText(spans, (n as Text).data); continue; }
    if (n.nodeType !== Node.ELEMENT_NODE) continue;
    const c = n as Element;
    if (isSkipped(c, opts)) continue;
    collectInline(c, spans, MARK_TAGS[c.tagName], hrefOf(c), opts);
  }
  return spans;
}

/** 行内走查：把子树的文字按「链接 / 强调」归并成 span */
function collectInline(el: Element, out: InlineSpan[], mark: InlineSpan['mark'], href: string | undefined, opts: ExtractOptions) {
  if (isSkipped(el, opts)) return;
  const tag = el.tagName;
  if (tag === 'BR') { pushText(out, '\n'); return; }
  if (tag === 'IMG') {
    // 段落中间的小图：正文里留个占位，免得整张图无声消失
    const b = imageBlock(el as HTMLImageElement, '');
    pushText(out, b ? `[图：${b.alt || ''}]` : '');
    return;
  }
  const nextMark = mark ?? undefined;
  const nextHref = href ?? undefined;
  for (const n of Array.from(el.childNodes)) {
    if (n.nodeType === Node.TEXT_NODE) { pushText(out, (n as Text).data, nextHref, nextMark); continue; }
    if (n.nodeType !== Node.ELEMENT_NODE) continue;
    const c = n as Element;
    if (isSkipped(c, opts)) continue;
    collectInline(c, out, MARK_TAGS[c.tagName] ?? nextMark, hrefOf(c) ?? nextHref, opts);
  }
}

function pushText(out: InlineSpan[], data: string, href?: string, mark?: InlineSpan['mark']) {
  if (!data) return;
  if (out.length > 4000) return;   // 单个块里上万 span 只会拖垮序列化
  out.push({ text: data, ...(href ? { href } : {}), ...(mark ? { mark } : {}) });
}

/** 链接绝对化：`<a name="x">` 没有 href，返回 undefined 按普通文字处理 */
function hrefOf(el: Element): string | undefined {
  if (el.tagName !== 'A') return undefined;
  const raw = el.getAttribute('href');
  if (raw == null) return undefined;
  const trimmed = raw.trim();
  if (!trimmed || trimmed.startsWith('#')) return undefined;
  return absUrl(trimmed);
}

/** 渲染层同款空判定：span 集合压成纯文本后是否还剩字 */
function plain(spans: InlineSpan[]): string {
  return inlineToPlainText(spans);
}

/**
 * 是否跳过。三重判据：标签黑名单、噪声 class/id 关键词、页面可见性。
 * 可见性只在真实文档上判（checkVisibility 对游离节点一律返回不可见，会把兜底路径全灭）。
 */
function isSkipped(el: Element, opts: ExtractOptions): boolean {
  const tag = el.tagName;
  if (SKIP_TAGS.has(tag)) return true;
  if (opts.skipNoiseClass) {
    const hint = `${typeof el.className === 'string' ? el.className : ''} ${el.id || ''}`.trim();
    if (hint && NOISE_CLASS_RE.test(hint)) return true;
  }
  return !isVisible(el);
}

function isVisible(el: Element): boolean {
  if (!el.isConnected) return true;
  if ((el as HTMLElement).hidden) return false;
  const check = (el as HTMLElement).checkVisibility as ((o?: unknown) => boolean) | undefined;
  if (typeof check !== 'function') return true;
  try {
    return check.call(el, { checkVisibilityCSS: true, contentVisibilityAuto: true, opacityProperty: false, visibilityProperty: true });
  } catch {
    return true;
  }
}

function textOfFirst(root: Element, selector: string): string {
  const el = root.querySelector(selector);
  return el ? String(el.textContent || '').replace(/\s+/g, ' ').trim() : '';
}

// ===== 划词选区 → 锚点 =====

export interface SelectionResult {
  anchor: HighlightAnchor;
  /** 选区文本，失败原因等提示语用它 */
  excerpt: string;
  url: string;
  ok: boolean;
  reason?: string;
}

/**
 * 读取当前选区，产出「原文 + 前后文」锚点。
 * 这里刻意不回传偏移：偏移属于抽取正文的坐标系，而选区落在 DOM 上，
 * 换算交给侧栏（它同时握着正文和 locateAnchor）——内容脚本不重复实现一套定位。
 */
export function readSelection(): SelectionResult {
  const url = location.href;
  const sel = window.getSelection?.();
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) {
    return { ok: false, excerpt: '', url, anchor: { exact: '', prefix: '', suffix: '' }, reason: '页面上没有选中文字' };
  }
  const raw = sel.toString() || '';
  const excerpt = raw.replace(/\s+/g, ' ').trim();
  if (!excerpt) return { ok: false, excerpt: '', url, anchor: { exact: '', prefix: '', suffix: '' }, reason: '选区是空白' };
  if (excerpt.length > MAX_SELECTION_CHARS) {
    return { ok: false, excerpt: excerpt.slice(0, 120), url, anchor: { exact: '', prefix: '', suffix: '' }, reason: `选区过长（${excerpt.length} 字），请分段留存` };
  }
  const range = sel.getRangeAt(0);
  const scope = selectionScope(range.commonAncestorContainer, raw.length);
  const { text, index } = flattenWithIndex(scope);
  const start = positionOf(range.startContainer, range.startOffset, index);
  const end = positionOf(range.endContainer, range.endOffset, index);
  const anchor = start != null && end != null && end > start
    ? makeAnchor(text, start, end)
    : { exact: raw, prefix: '', suffix: '' };
  if (!anchor.exact.trim()) anchor.exact = raw;
  return { ok: true, excerpt, url, anchor };
}

/** 选区的上下文容器：取最近的块级祖先，文字太少就再往上爬（前后文要够定位用） */
function selectionScope(node: Node, need: number): Element {
  let el: Element | null = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
  while (el && el.tagName !== 'BODY' && el.tagName !== 'HTML') {
    const len = (el.textContent || '').length;
    if (BLOCK_TAGS.has(el.tagName) && len >= need + 24) return el;
    el = el.parentElement;
  }
  return document.body;
}

/** 走查子树取纯文本，同时记住每个文本节点在原串里的起点（选区端点据此换算） */
function flattenWithIndex(root: Node): { text: string; index: Map<Node, number> } {
  let text = '';
  const index = new Map<Node, number>();
  const walk = (n: Node) => {
    if (n.nodeType === Node.TEXT_NODE) {
      index.set(n, text.length);
      text += (n as Text).data;
      return;
    }
    if (n.nodeType !== Node.ELEMENT_NODE) return;
    const el = n as Element;
    if (SKIP_TAGS.has(el.tagName)) return;
    if (el.tagName === 'BR') { text += '\n'; return; }
    for (const c of Array.from(el.childNodes)) walk(c);
    if (BLOCK_TAGS.has(el.tagName)) text += '\n\n';   // 与归档正文同款块分隔
  };
  for (const c of Array.from(root.childNodes)) walk(c);
  return { text, index };
}

/** 选区端点 → 扁平串下标；拿不到就返回 null，由调用方退回"只有原文"的锚点 */
function positionOf(node: Node, offset: number, index: Map<Node, number>): number | null {
  if (node.nodeType === Node.TEXT_NODE) {
    const base = index.get(node);
    if (base == null) return null;
    return base + Math.max(0, Math.min(offset, (node as Text).data.length));
  }
  const kids = node.childNodes;
  const target = kids.item(Math.max(0, Math.min(offset, kids.length - 1)));
  if (target) {
    const p = firstTextPos(target, index);
    if (p != null) return p;
  }
  return null;
}

function firstTextPos(node: Node, index: Map<Node, number>): number | null {
  if (node.nodeType === Node.TEXT_NODE) return index.get(node) ?? null;
  for (const c of Array.from(node.childNodes)) {
    const p = firstTextPos(c, index);
    if (p != null) return p;
  }
  return null;
}
