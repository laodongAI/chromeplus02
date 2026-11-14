/**
 * 单文件归档：把一次抓取的全部成果（元数据 + 结构化正文 + 高亮批注 + 图片）打包成一个
 * 自包含的 .html，双击即读，不依赖原站是否还活着。
 *
 * 为什么是 HTML 而不是 zip：zip 需要解压工具，而"在浏览器里点开一篇归档"是最高频动作；
 * 单文件 HTML 能内联图片（data URL）、能带目录与高亮批注，frontmatter 也能原样嵌进去，
 * 一份文件同时是人读的和机器读的。Markdown 出口走 buildMarkdownDoc，两条出口共用同一份块数据。
 *
 * 安全边界（必须守住）：归档内容来自任意网页，构建 HTML 时
 *  - 所有文本一律转义，绝不原样拼进标签之间；
 *  - href/src 只放行 http/https/data:image/mailto，`javascript:` 这类协议一律丢弃；
 *  - 不写内联事件属性、不引外部脚本，归档文件自身不含可执行逻辑。
 *
 * 高亮的坐标系是 flattenBlocks() 产出的纯文本全文（块间以空行分隔）。记录偏移与重新定位
 * 都以它为准，因此正文块与高亮必须出自同一次抽取；换了正文再套旧偏移只会贴错位置，
 * 所以 slice 校验不通过时按原文重新搜索，搜不到就只在批注清单里出现。
 *
 * 本模块是纯字符串产出，不碰 DOM，可在 node 环境单测。
 */

import type { ArticleBlock, InlineSpan } from './articleBlocks';
import { blockToPlainText, inlineToPlainText } from './articleBlocks';
import type { HighlightAnchor } from './textHighlight';
import { splitByHighlights, type LocatedRange } from './textHighlight';

/** 归档元数据：产出为文件头部的 <meta> + JSON-LD + 可见信息条 */
export interface ArchiveMeta {
  title: string;
  url: string;
  site?: string;
  author?: string;
  description?: string;
  keywords?: string[];
  /** 原文发布时间（站点给的，缺则不显示） */
  publishedAt?: string;
  /** 抓取时刻（ms），归档的"出生日期" */
  capturedAt: number;
  language?: string;
  /** 额外字段：站点 meta 里非标准但有用的信息 */
  extra?: Record<string, string>;
}

/** 一条高亮在归档里的呈现 */
export interface ArchiveHighlight {
  anchor: HighlightAnchor;
  note?: string;
  /** 抽取正文里的区间；缺失或校验不过时按原文重新搜索 */
  start?: number;
  end?: number;
}

/** 构建选项 */
export interface ArchiveOptions {
  /** 原图 URL → data URL；缺项的图片保留远程 URL 并标注"未内联" */
  assets?: Record<string, string>;
  highlights?: ArchiveHighlight[];
  /** 是否生成目录（正文有 ≥2 个标题时默认开） */
  toc?: boolean;
}

/** 允许的链接协议：其余（javascript:、data:text/html…）一律视为不可信 */
const SAFE_URL_RE = /^(?:https?:|data:image\/|mailto:)/i;

/**
 * 协议白名单过滤，返回空串表示"这个 URL 不该进归档"。
 * 先剥控制字符：`java\tscript:` 这类绕过只在协议名里插字符才有效；
 * 判协议时空白也一并忽略（`java script:` 同样危险），但真写进归档时空白留作 %20，不把地址改坏。
 */
export function sanitizeArchiveUrl(raw: string): string {
  const u = String(raw ?? '').trim();
  if (!u) return '';
  const stripped = u.replace(/[\u0000-\u001f\u007f]/g, '');
  if (!SAFE_URL_RE.test(stripped.replace(/\s/g, ''))) return '';
  return stripped.replace(/"/g, '%22').replace(/</g, '%3C').replace(/>/g, '%3E').replace(/\s/g, '%20');
}

/** HTML 文本转义：& < > " ' 全覆盖，属性与文本节点共用一套 */
export function htmlEscape(input: unknown): string {
  return String(input ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** 时间戳 → 本地可读时间；非法值退回当前时刻，绝不让归档头部出现 Invalid Date */
function formatCaptured(ms: number): string {
  const t = Number.isFinite(ms) ? new Date(ms) : new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${t.getFullYear()}-${p(t.getMonth() + 1)}-${p(t.getDate())} ${p(t.getHours())}:${p(t.getMinutes())}`;
}

/** 行内片段 → HTML（强调/链接；未知标记按纯文本处理） */
export function spansToHtml(spans: InlineSpan[]): string {
  const list = Array.isArray(spans) ? spans : [];
  let out = '';
  for (const s of list) {
    const text = String(s?.text ?? '');
    if (!text) continue;
    let inner = htmlEscape(text);
    if (s.mark === 'code') inner = `<code>${inner}</code>`;
    else if (s.mark === 'strong') inner = `<strong>${inner}</strong>`;
    else if (s.mark === 'em') inner = `<em>${inner}</em>`;
    else if (s.mark === 'del') inner = `<del>${inner}</del>`;
    const href = sanitizeArchiveUrl(s.href ?? '');
    out += href ? `<a href="${href}" rel="noopener noreferrer nofollow">${inner}</a>` : inner;
  }
  return out;
}

/** 块级纯文本的分隔符：与 flattenBlocks 一致，高亮偏移以此为坐标系 */
const BLOCK_SEP = '\n\n';

/** 一个块在扁平全文里的区间（供按块注入高亮） */
export interface FlatBlock {
  start: number;
  end: number;
  block: ArticleBlock;
}

/**
 * 正文块 → 扁平全文 + 每块区间。
 * 空白块跳过且不留分隔符，保证全文与 blocksToPlainText 的可读性一致；
 * 偏移以"未 trim 的拼接结果"为准，因此调用方要把这份 text 当唯一坐标系，不要另行 trim。
 */
export function flattenBlocks(blocks: ArticleBlock[]): { text: string; spans: FlatBlock[] } {
  const chunks: string[] = [];
  const spans: FlatBlock[] = [];
  let cursor = 0;
  for (const block of Array.isArray(blocks) ? blocks : []) {
    const text = blockToPlainText(block);
    if (!text) continue;
    if (chunks.length) { cursor += BLOCK_SEP.length; chunks.push(BLOCK_SEP); }
    chunks.push(text);
    spans.push({ start: cursor, end: cursor + text.length, block });
    cursor += text.length;
  }
  return { text: chunks.join(''), spans };
}

/** 图片 URL 换成内联 data URL；未内联的保留远程地址，但同样要过协议白名单 */
export function inlineAssets(blocks: ArticleBlock[], assets: Record<string, string> | undefined): ArticleBlock[] {
  const list = Array.isArray(blocks) ? blocks : [];
  if (!assets) return list.slice();
  return list.map(b => {
    if (b?.type !== 'image') return b;
    const origin = String(b.src ?? '');
    const data = assets[origin];
    if (data) return { type: 'image', src: data, alt: b.alt ?? '', inlined: true } as ArticleBlock;
    const safe = sanitizeArchiveUrl(origin);
    return safe === origin ? b : { type: 'image', src: safe, alt: b.alt ?? '' } as ArticleBlock;
  });
}

/** 渲染上下文：块区间 + 已定位的高亮区间 */
interface RenderCtx {
  ranges: LocatedRange[];
  /** 当前块在全文里的起点 */
  blockStart: number;
}

/** 段落内注入 <mark>：只有整段是纯文本（无链接/强调）时才做，富文本块交给文末批注清单 */
function paragraphHtml(spans: InlineSpan[], ctx: RenderCtx): string {
  const list = Array.isArray(spans) ? spans : [];
  const plain = inlineToPlainText(list);
  const isRich = list.some(s => s?.text?.trim() && (s.href || s.mark));
  if (isRich) return spansToHtml(list);
  if (!plain) return '';
  if (!ctx.ranges.length) return htmlEscape(plain);
  const local = ctx.ranges
    .filter(r => r.end > ctx.blockStart && r.start < ctx.blockStart + plain.length)
    .map(r => ({ start: Math.max(0, r.start - ctx.blockStart), end: Math.min(plain.length, r.end - ctx.blockStart) }));
  if (!local.length) return htmlEscape(plain);
  return splitByHighlights(plain, local)
    .map(s => (s.highlighted ? `<mark>${htmlEscape(s.text)}</mark>` : htmlEscape(s.text)))
    .join('');
}

/** 单块 → HTML 片段（含目录用的标题 id） */
function blockToHtml(block: ArticleBlock, ctx: RenderCtx, headingIndex: number): string {
  switch (block?.type) {
    case 'heading': {
      const level = Math.min(6, Math.max(1, Math.round(block.level) || 1));
      const text = spansToHtml(block.spans);
      if (!text) return '';
      return `<h2 id="h-${headingIndex}" class="h h${level}">${text}</h2>`;
    }
    case 'paragraph': {
      const text = paragraphHtml(block.spans, ctx);
      return text ? `<p>${text}</p>` : '';
    }
    case 'quote': {
      const text = spansToHtml(block.spans);
      return text ? `<blockquote>${text}</blockquote>` : '';
    }
    case 'list': {
      const items = (Array.isArray(block.items) ? block.items : [])
        .map(item => spansToHtml(item))
        .filter(Boolean)
        .map(t => `<li>${t}</li>`);
      if (!items.length) return '';
      const tag = block.ordered ? 'ol' : 'ul';
      const start = block.ordered && block.start > 1 ? ` start="${Math.round(block.start)}"` : '';
      return `<${tag}${start}>${items.join('')}</${tag}>`;
    }
    case 'code': {
      const text = String(block.text ?? '');
      return text.trim() ? `<pre><code>${htmlEscape(text)}</code></pre>` : '';
    }
    case 'image': {
      const src = String(block.src ?? '');
      if (!src) return '';
      const alt = htmlEscape((block.alt ?? '').trim());
      const note = src.startsWith('data:') ? '' : '<span class="remote">未内联</span>';
      return `<figure><img src="${htmlEscape(src)}" alt="${alt}"><figcaption>${alt}${note}</figcaption></figure>`;
    }
    case 'table': {
      const head = (Array.isArray(block.header) ? block.header : []).map(c => `<th>${htmlEscape(c)}</th>`);
      const rows = (Array.isArray(block.rows) ? block.rows : [])
        .map(r => `<tr>${(Array.isArray(r) ? r : []).map(c => `<td>${htmlEscape(c)}</td>`).join('')}</tr>`);
      if (!head.length && !rows.length) return '';
      return `<table><thead><tr>${head.join('')}</tr></thead><tbody>${rows.join('')}</tbody></table>`;
    }
    case 'hr':
      return '<hr>';
    default:
      return '';
  }
}

/** 归档样式：跟随系统深浅色，正文按阅读排版限宽 */
const ARCHIVE_CSS = [
  ':root{color-scheme:light dark;--fg:#1c1c22;--muted:#6b6b78;--line:#e3e3ea;--bg:#fff;--mark:#ffe58a;--card:#f7f7fb}',
  '@media (prefers-color-scheme:dark){:root{--fg:#e8e8f0;--muted:#9a9aa8;--line:#2c2c38;--bg:#14141b;--mark:#5a4a12;--card:#1c1c26}}',
  '*{box-sizing:border-box}',
  'body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.75 -apple-system,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif}',
  '.wrap{max-width:820px;margin:0 auto;padding:28px 20px 80px}',
  '.card{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:14px 16px;font-size:13px;color:var(--muted);word-break:break-all;line-height:1.9}',
  '.card b{color:var(--fg);font-weight:600}',
  'h1{font-size:26px;line-height:1.35;margin:22px 0 6px}',
  '.h{margin:26px 0 10px;line-height:1.4}',
  '.h1{font-size:23px}.h2{font-size:21px}.h3{font-size:18px}.h4,.h5,.h6{font-size:16px}',
  'p{margin:12px 0}',
  'a{color:#2f6fed;text-decoration:none}a:hover{text-decoration:underline}',
  'code{background:var(--card);border:1px solid var(--line);border-radius:4px;padding:1px 5px;font-size:.92em}',
  'pre{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:12px 14px;overflow:auto}',
  'pre code{background:none;border:none;padding:0}',
  'blockquote{margin:14px 0;padding:2px 0 2px 14px;border-left:3px solid var(--line);color:var(--muted)}',
  'img{max-width:100%;height:auto;border-radius:6px;display:block}',
  'figure{margin:16px 0}figcaption{font-size:12px;color:var(--muted);margin-top:6px}',
  '.remote{border:1px solid var(--line);border-radius:4px;padding:0 5px;margin-left:6px}',
  'table{border-collapse:collapse;width:100%;font-size:14px;display:block;overflow:auto}',
  'th,td{border:1px solid var(--line);padding:7px 10px;text-align:left;vertical-align:top}',
  'th{background:var(--card)}',
  'mark{background:var(--mark);color:inherit;padding:1px 2px;border-radius:2px}',
  '.note{display:block;background:var(--card);border-left:3px solid var(--mark);border-radius:0 6px 6px 0;padding:6px 10px;margin:6px 0;font-size:14px}',
  '.toc{margin:18px 0;padding:12px 16px;border:1px solid var(--line);border-radius:10px;font-size:14px}',
  '.toc ol{margin:6px 0 0;padding-left:20px}.toc li{margin:3px 0}',
  '.hl-list{margin:26px 0 0;border-top:2px solid var(--line);padding-top:14px}',
  '.hl-list h2{font-size:18px}',
  'footer{margin-top:34px;font-size:12px;color:var(--muted);border-top:1px solid var(--line);padding-top:12px}',
].join('');

/**
 * 校验并修正高亮区间：记录偏移与全文不符（正文重新抓取过）时按原文重新搜索；
 * 搜不到就返回空，该条只在批注清单里出现，绝不贴到别处。
 */
export function resolveHighlightRanges(highlights: ArchiveHighlight[] | undefined, fullText: string): { ranges: LocatedRange[]; lost: number } {
  const list = (Array.isArray(highlights) ? highlights : []).filter(h => h?.anchor?.exact);
  const ranges: LocatedRange[] = [];
  let lost = 0;
  for (const h of list) {
    const exact = h.anchor.exact;
    const s = h.start;
    const e = h.end;
    if (typeof s === 'number' && typeof e === 'number' && e > s && fullText.slice(s, e) === exact) {
      ranges.push({ start: s, end: e });
      continue;
    }
    const at = fullText.indexOf(exact);
    if (at >= 0) ranges.push({ start: at, end: at + exact.length });
    else lost++;
  }
  return { ranges: merge(ranges), lost };
}

/** 区间合并（复用 textHighlight 的语义：重叠即并成一段） */
function merge(ranges: LocatedRange[]): LocatedRange[] {
  const sorted = [...ranges].sort((a, b) => a.start - b.start);
  const out: LocatedRange[] = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    if (last && r.start <= last.end) { if (r.end > last.end) last.end = r.end; continue; }
    out.push({ ...r });
  }
  return out;
}

/**
 * 生成单文件归档 HTML。
 * @param meta   元数据
 * @param blocks 结构化正文块（建议先过 inlineAssets）
 * @param opts   图片映射、高亮、目录开关
 */
export function buildArchiveHtml(meta: ArchiveMeta, blocks: ArticleBlock[], opts: ArchiveOptions = {}): string {
  const inlined = inlineAssets(blocks, opts.assets);
  const flat = flattenBlocks(inlined);
  const resolved = resolveHighlightRanges(opts.highlights, flat.text);
  const highlights = (Array.isArray(opts.highlights) ? opts.highlights : []).filter(h => h?.anchor?.exact);

  const bodyParts: string[] = [];
  const tocItems: Array<{ text: string; index: number }> = [];
  let headingCount = 0;
  for (const span of flat.spans) {
    const b = span.block;
    // 标题 id 与目录条目用同一个递增序号，锚点才不会指错
    const headingIndex = b?.type === 'heading' ? ++headingCount : 0;
    if (b?.type === 'heading') {
      const text = inlineToPlainText(b.spans);
      if (text) tocItems.push({ text, index: headingIndex });
    }
    bodyParts.push(blockToHtml(b, { ranges: resolved.ranges, blockStart: span.start }, headingIndex));
  }
  const bodyHtml = bodyParts.filter(Boolean).join('\n');

  const wantToc = opts.toc ?? tocItems.length >= 2;
  const tocHtml = wantToc && tocItems.length
    ? `<nav class="toc"><b>目录</b><ol>${tocItems.map(t => `<li><a href="#h-${t.index}">${htmlEscape(t.text)}</a></li>`).join('')}</ol></nav>`
    : '';

  const hlHtml = highlights.length
    ? `<section class="hl-list"><h2>高亮与批注（${highlights.length}${resolved.lost ? `，${resolved.lost} 条未定位` : ''}）</h2><ol>${highlights.map(h => {
      const note = String(h.note ?? '').trim();
      return `<li><mark>${htmlEscape(h.anchor.exact)}</mark>${note ? `<span class="note">批注：${htmlEscape(note)}</span>` : ''}</li>`;
    }).join('')}</ol></section>`
    : '';

  const jsonLd: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: meta.title,
    url: meta.url,
    description: meta.description,
    dateCreated: new Date(Number.isFinite(meta.capturedAt) ? meta.capturedAt : Date.now()).toISOString(),
    keywords: Array.isArray(meta.keywords) ? meta.keywords.join(',') : meta.keywords,
    inLanguage: meta.language,
  };
  if (meta.author) jsonLd.author = { '@type': 'Person', name: meta.author };
  if (meta.publishedAt) jsonLd.datePublished = meta.publishedAt;

  const extraRows = Object.entries(meta.extra ?? {})
    .filter(([k, v]) => k && v)
    .map(([k, v]) => `<div><b>${htmlEscape(k)}</b> ${htmlEscape(v)}</div>`);

  const sourceUrl = sanitizeArchiveUrl(meta.url);
  const info = [
    `<div><b>来源</b> ${sourceUrl ? `<a href="${htmlEscape(sourceUrl)}" rel="noopener noreferrer nofollow">${htmlEscape(meta.site || meta.url)}</a>` : htmlEscape(meta.site || '（无来源地址）')}</div>`,
    `<div><b>抓取</b> ${htmlEscape(formatCaptured(meta.capturedAt))}</div>`,
    meta.author ? `<div><b>作者</b> ${htmlEscape(meta.author)}</div>` : '',
    meta.publishedAt ? `<div><b>原文发布</b> ${htmlEscape(meta.publishedAt)}</div>` : '',
    Array.isArray(meta.keywords) && meta.keywords.length ? `<div><b>关键词</b> ${htmlEscape(meta.keywords.join('、'))}</div>` : '',
    ...extraRows,
  ].filter(Boolean).join('');

  const title = htmlEscape(meta.title || '未命名归档');
  const remoteCount = inlined.filter(b => b?.type === 'image' && !String(b.src ?? '').startsWith('data:')).length;
  const capturedIso = new Date(Number.isFinite(meta.capturedAt) ? meta.capturedAt : Date.now()).toISOString();

  return [
    '<!DOCTYPE html>',
    '<html lang="zh-CN"><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width,initial-scale=1">',
    `<title>${title}</title>`,
    '<meta name="referrer" content="no-referrer">',
    `<meta name="x-mediaplus-archive" content="${htmlEscape(JSON.stringify({ url: meta.url, capturedAt: capturedIso, highlights: highlights.length, lost: resolved.lost }))}">`,
    // JSON-LD 里的 < 必须转义，否则正文含 "</script>" 时提前闭合，脚本内容变成可执行 HTML
    `<script type="application/ld+json">${JSON.stringify(jsonLd).replace(/</g, '\\u003c')}</script>`,
    `<style>${ARCHIVE_CSS}</style>`,
    '</head><body><div class="wrap">',
    `<h1>${title}</h1>`,
    `<div class="card">${info}</div>`,
    tocHtml,
    '<article>',
    bodyHtml,
    '</article>',
    hlHtml,
    remoteCount
      ? `<footer>正文内 ${remoteCount} 张图片未内联，离线打开时不显示。</footer>`
      : '<footer>本文件为 MediaPlus 单文件归档：正文、图片、高亮批注均已内嵌。</footer>',
    '</div></body></html>',
  ].join('\n');
}
