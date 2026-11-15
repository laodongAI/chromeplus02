/**
 * 文本抓取的落盘层（Round 6 #35）：高亮留存、命名模板、Markdown 与单文件归档出口。
 *
 * 侧栏组件只管交互，这里管"数据放哪、怎么算"：
 *  - 高亮按归一化 URL 分桶存 chrome.storage.local（页面改版不影响：锚点而不是选择器）；
 *  - 图片内联尽力而为，失败计数如实上报——"归档打不开图"和"悄悄少图"是两回事；
 *  - 文件名走全站统一的 formatFilename 模板（{title}/{date}/{site}…）。
 */

import type { ArticleBlock } from '@/core/articleBlocks';
import { blocksToMarkdown } from '@/core/articleBlocks';
import { buildMarkdownDoc, type FrontmatterData } from '@/core/frontmatter';
import { appendHighlight, locateAnchor, newHighlightId, normalizePageUrl, type StoredHighlight } from '@/core/textHighlight';
import { flattenBlocks, type ArchiveHighlight, type ArchiveMeta } from '@/core/archive';
import { formatFilename } from '@/utils/format';
import { MessageType, type TextContentDTO } from '@/messaging';
import { sendMessageToTab } from '../utils/chromeMessaging';

/** 高亮存储键：`{ [归一化URL]: StoredHighlight[] }` */
export const HIGHLIGHTS_KEY = 'text_highlights';
/** 文件名模板设置键 */
export const TEMPLATE_KEY = 'text_filename_template';
export const DEFAULT_TEMPLATE = '{date}-{title}';
/** 最多留存多少个页面的高亮：超出的按"最久没写过"的页面清掉，避免 storage 无界增长 */
export const MAX_TRACKED_PAGES = 200;

export type HighlightsMap = Record<string, StoredHighlight[]>;

/** 单张图片内联上限：超过这个体积的多半是原图，归档里留远程地址更合适 */
const MAX_IMAGE_BYTES = 3 * 1024 * 1024;
/** 整份归档的图片总量上限（base64 前）：浏览器下载与内存都吃得住的量级 */
const MAX_TOTAL_IMAGE_BYTES = 24 * 1024 * 1024;
/** 一次归档最多内联多少张图 */
const MAX_INLINE_IMAGES = 60;

async function readStore(): Promise<HighlightsMap> {
  const got = await chrome.storage.local.get(HIGHLIGHTS_KEY);
  const map = got?.[HIGHLIGHTS_KEY];
  return map && typeof map === 'object' ? (map as HighlightsMap) : {};
}

/** 按页面读取高亮（URL 先归一化，分享链接与带 hash 的地址归同一桶） */
export async function loadHighlights(url: string): Promise<StoredHighlight[]> {
  const key = normalizePageUrl(url);
  if (!key) return [];
  const map = await readStore();
  return Array.isArray(map[key]) ? map[key] : [];
}

/** 写入某页的高亮列表，并顺手把页面数压回上限 */
export async function saveHighlights(url: string, list: StoredHighlight[]): Promise<void> {
  const key = normalizePageUrl(url);
  if (!key) return;
  const map = await readStore();
  if (list.length) map[key] = list;
  else delete map[key];
  await chrome.storage.local.set({ [HIGHLIGHTS_KEY]: prunePages(map) });
}

/** 页面数超限时丢掉"最新一条最旧"的页面：正在读的页面总是留下，丢掉的是几个月没碰的 */
function prunePages(map: HighlightsMap): HighlightsMap {
  const keys = Object.keys(map);
  if (keys.length <= MAX_TRACKED_PAGES) return map;
  const newest = (k: string) => (map[k] || []).reduce((m, h) => Math.max(m, h?.createdAt || 0), 0);
  const doomed = keys.sort((a, b) => newest(a) - newest(b)).slice(0, keys.length - MAX_TRACKED_PAGES);
  for (const k of doomed) delete map[k];
  return map;
}

/** 清空某页高亮（面板上的"清空本页"） */
export async function clearHighlights(url: string): Promise<void> {
  await saveHighlights(url, []);
}

export interface CaptureResult {
  list: StoredHighlight[];
  /** 新增是否成功（无选区/选区过长时 false，reason 给用户看） */
  added: boolean;
  reason?: string;
  /** 新增的高亮有几条落在正文里（其余只在批注清单出现） */
  located: number;
  /** 因条数上限被丢掉的旧高亮数 */
  dropped: number;
}

/**
 * 把页面上的选区存成一条高亮。
 * 锚点由内容脚本给出，偏移在这里按"本次抽取的正文"算：
 * 偏移只是加速提示，算不出来（选区不在正文容器里）照样入库，靠锚点兜底。
 */
export async function captureHighlight(opts: {
  tabId: number;
  fullText: string;
  url: string;
  title: string;
  list: StoredHighlight[];
  note?: string;
}): Promise<CaptureResult> {
  const res = await sendMessageToTab<{ success?: boolean; content?: { ok?: boolean; anchor?: { exact: string; prefix: string; suffix: string }; reason?: string }; error?: string }>(
    opts.tabId,
    { type: MessageType.GET_TEXT_SELECTION }
  );
  const data = res?.content;
  if (!res?.success || !data) return { list: opts.list, added: false, reason: res?.error || '读取选区失败', located: 0, dropped: 0 };
  if (!data.ok || !data.anchor?.exact?.trim()) return { list: opts.list, added: false, reason: data.reason || '页面上没有选中文字', located: 0, dropped: 0 };

  const anchor = { exact: data.anchor.exact, prefix: data.anchor.prefix || '', suffix: data.anchor.suffix || '' };
  const found = locateAnchor(opts.fullText, anchor);
  const item: StoredHighlight = {
    id: newHighlightId(),
    url: normalizePageUrl(opts.url),
    title: opts.title,
    anchor,
    note: String(opts.note || '').trim(),
    createdAt: Date.now(),
    start: found?.start ?? -1,
    end: found?.end ?? -1
  };
  const { list, dropped } = appendHighlight(opts.list, item);
  await saveHighlights(opts.url, list);
  return { list, added: true, located: found ? 1 : 0, dropped };
}

/** 改一条高亮的批注并落盘 */
export async function updateHighlightNote(url: string, list: StoredHighlight[], id: string, note: string): Promise<StoredHighlight[]> {
  const next = list.map(h => (h.id === id ? { ...h, note: String(note || '').trim() } : h));
  await saveHighlights(url, next);
  return next;
}

/** 删一条高亮并落盘 */
export async function removeHighlight(url: string, list: StoredHighlight[], id: string): Promise<StoredHighlight[]> {
  const next = list.filter(h => h.id !== id);
  await saveHighlights(url, next);
  return next;
}

/** 文件名模板（面板上可改，全站共用 formatFilename 的 {key} 语法） */
export async function loadTemplate(): Promise<string> {
  const got = await chrome.storage.local.get(TEMPLATE_KEY);
  const v = got?.[TEMPLATE_KEY];
  return typeof v === 'string' && v.trim() ? v : DEFAULT_TEMPLATE;
}

export async function saveTemplate(tpl: string): Promise<void> {
  await chrome.storage.local.set({ [TEMPLATE_KEY]: tpl || DEFAULT_TEMPLATE });
}

/** 用模板 + 页面元数据算出导出文件名（不含扩展名时自动补） */
export function docFilename(content: TextContentDTO, ext: string, template?: string): string {
  const base = formatFilename(template || DEFAULT_TEMPLATE, {
    title: (content.title || '未命名').trim(),
    site: content.siteName || hostnameOf(content.url || content.canonicalUrl || '') || '网页',
    author: content.author || '未知',
    domain: hostnameOf(content.canonicalUrl || content.url || '')
  });
  const safe = base.replace(/\.(md|html?)$/i, '');
  return `${safe || '未命名归档'}.${ext}`;
}

function hostnameOf(url: string): string {
  try { return new URL(url).hostname; } catch { return ''; }
}

/** frontmatter：字段顺序即人读顺序，空字段不写（YAML 里 `author: ` 比不写更容易被下游当成有值） */
export function buildFrontmatter(content: TextContentDTO, highlights: StoredHighlight[]): FrontmatterData {
  const data: FrontmatterData = {
    title: content.title || '未命名',
    source: content.canonicalUrl || content.url || '',
  };
  if (content.siteName) data.site = content.siteName;
  if (content.author) data.author = content.author;
  if (content.publishedAt) data.published = content.publishedAt;
  data.captured = new Date().toISOString();
  if (content.language) data.language = content.language;
  if (content.description) data.description = content.description;
  if (content.keywords?.length) data.keywords = content.keywords.slice(0, 20);
  data.word_count = content.wordCount || 0;
  if (highlights.length) data.highlights = highlights.length;
  return data;
}

/** Markdown 出口：frontmatter + 结构化正文 +（有则）高亮批注附录 */
export function buildMarkdown(content: TextContentDTO, highlights: StoredHighlight[]): string {
  const blocks = Array.isArray(content.blocks) ? content.blocks : [];
  const body = blocks.length ? blocksToMarkdown(blocks) : String(content.textContent || '');
  const data = buildFrontmatter(content, highlights);
  const appendix = highlights.length ? highlightsToMarkdownBody(highlights) : '';
  const doc = buildMarkdownDoc(data, body, content.title || undefined);
  if (!appendix) return doc;
  return `${doc.replace(/\n*$/, '')}\n\n## 高亮与批注\n\n${appendix}\n`;
}

function highlightsToMarkdownBody(list: StoredHighlight[]): string {
  return list.map((h, i) => {
    const text = String(h.anchor?.exact || '').replace(/\s+/g, ' ').trim();
    if (!text) return '';
    const note = String(h.note || '').trim();
    return note ? `> ${i + 1}. ${text}\n>     —— 批注：${note.replace(/\n+/g, ' ')}` : `> ${i + 1}. ${text}`;
  }).filter(Boolean).join('\n>\n');
}

/** 归档元数据 */
export function buildArchiveMeta(content: TextContentDTO): ArchiveMeta {
  const extra: Record<string, string> = {};
  if (content.wordCount) extra.字数 = String(content.wordCount);
  if (content.truncated) extra.提示 = '正文超长，textContent 为前缀；blocks 为全文';
  return {
    title: content.title || '未命名归档',
    url: content.canonicalUrl || content.url || '',
    site: content.siteName,
    author: content.author,
    description: content.description,
    keywords: content.keywords,
    publishedAt: content.publishedAt,
    capturedAt: Date.now(),
    language: content.language,
    extra
  };
}

export function toArchiveHighlights(list: StoredHighlight[]): ArchiveHighlight[] {
  return list.map(h => ({ anchor: h.anchor, note: h.note, start: h.start >= 0 ? h.start : undefined, end: h.end >= 0 ? h.end : undefined }));
}

/** 高亮能否落在本次抽取的正文里（面板据此提示"这条不在正文内，只进批注清单"） */
export function countLocatable(blocks: ArticleBlock[], list: StoredHighlight[]): { located: number; lost: number } {
  const { text } = flattenBlocks(blocks);
  let located = 0;
  for (const h of list) {
    if (!h.anchor?.exact?.trim()) continue;
    if (locateAnchor(text, h.anchor, h.start >= 0 ? { start: h.start, end: h.end } : undefined)) located++;
  }
  return { located, lost: list.length - located };
}

export interface InlineResult {
  assets: Record<string, string>;
  /** 因体积/总量/张数上限主动跳过的张数 */
  skipped: number;
  /** 取失败的张数（跨域、404、非图片响应） */
  failed: number;
}

/**
 * 图片内联：侧栏直接 fetch 成 data URL。
 * 跨域站点会拒（CORS），这是预期失败而不是 bug，所以只统计不报错；
 * 归档里保留远程地址并标注"未内联"，用户知道离线打不开是哪几张。
 */
export async function inlineImages(blocks: ArticleBlock[], signal?: { cancelled: boolean }): Promise<InlineResult> {
  const assets: Record<string, string> = {};
  let skipped = 0;
  let failed = 0;
  let total = 0;
  for (const b of blocks) {
    if (b?.type !== 'image') continue;
    const src = String(b.src || '');
    if (!src || src.startsWith('data:') || assets[src]) continue;
    if (!/^https?:/i.test(src)) { skipped++; continue; }
    if (signal?.cancelled || Object.keys(assets).length >= MAX_INLINE_IMAGES || total >= MAX_TOTAL_IMAGE_BYTES) { skipped++; continue; }
    try {
      const resp = await fetch(src, { credentials: 'omit', mode: 'cors', redirect: 'follow' });
      if (!resp.ok) { failed++; continue; }
      const blob = await resp.blob();
      if (!/^image\//i.test(blob.type) || blob.size > MAX_IMAGE_BYTES) { skipped++; continue; }
      const data = await blobToDataUrl(blob);
      assets[src] = data;
      total += blob.size;
    } catch {
      failed++;
    }
  }
  return { assets, skipped, failed };
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result || ''));
    fr.onerror = () => reject(fr.error || new Error('读取图片失败'));
    fr.readAsDataURL(blob);
  });
}

/** 触发下载（与资源清单导出同款：chrome.downloads + 60s 后回收 object URL） */
export function downloadText(text: string, fileName: string, mime: string): void {
  // BOM：Windows 记事本打开无 BOM 的 UTF-8 中文会乱码，归档场景人读优先
  const blob = new Blob([`${text}`], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  chrome.downloads.download({ url, filename: fileName, conflictAction: 'uniquify' }, () => {
    void chrome.runtime.lastError;
    setTimeout(() => { try { URL.revokeObjectURL(url); } catch { /* noop */ } }, 60_000);
  });
}
