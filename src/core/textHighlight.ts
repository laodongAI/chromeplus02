/**
 * 网页高亮留存：把"我在页面上划了哪段、批了什么"存成可重定位的锚点，而不是存 DOM 节点。
 *
 * 为什么不能存 XPath / 节点索引：抽取到的是去噪后的正文，节点路径在活动文档上，
 * 页面一改（懒加载、评论插入、站点改版）路径就指到别处，甚至指到广告。
 * 因此采用「原文 + 前后文」的文本锚点（与 Hypothesis/Wallabout 同思路）：
 *  - 精确命中用抽取时记录的偏移；
 *  - 偏移失效（正文重排/重新抓取）时靠前后文在全文里重新定位；
 *  - 前后文也匹配不上（原文被站点改了）才判为定位失败，如实计数给用户看，
 *    绝不悄悄把高亮贴到另一段文字上——错位的批注比丢失更糟。
 *
 * 本模块只做纯数据计算，不碰 DOM，便于 node 环境单测。
 */

/** 高亮锚点：exact 是选中原文，prefix/suffix 取相邻上下文用于消歧与重定位 */
export interface HighlightAnchor {
  exact: string;
  prefix: string;
  suffix: string;
}

/** 落盘的一条高亮 */
export interface StoredHighlight {
  id: string;
  /** 抓取时的页面 URL（归一化后存储，见 normalizePageUrl） */
  url: string;
  /** 页面标题：列表展示用，URL 对用户不可读 */
  title: string;
  anchor: HighlightAnchor;
  /** 用户批注，可空 */
  note: string;
  /** 创建时刻（ms） */
  createdAt: number;
  /** 抽取正文里的字符区间；无法定位时为 -1，靠 anchor 兜底 */
  start: number;
  end: number;
}

/** 命中区间 */
export interface LocatedRange {
  start: number;
  end: number;
}

/** 前后文各取这么多字符：再长对定位没好处，反而让站点微调后整条锚点失效 */
export const MAX_ANCHOR_CONTEXT = 48;

/** 高亮条数上限：单页可以有大量高亮，但没有上限会让 storage.local 无界增长 */
export const MAX_HIGHLIGHTS_PER_PAGE = 500;

/**
 * 由抽取正文与选中区间生成锚点。
 * 偏移越界或倒序一律返回空锚点（exact 空串），调用方据此拒绝入库，而不是存一条永远定位不到的记录。
 */
export function makeAnchor(fullText: string, start: number, end: number): HighlightAnchor {
  const text = String(fullText ?? '');
  const s = Math.max(0, Math.floor(start));
  const e = Math.min(text.length, Math.floor(end));
  const exact = e > s ? text.slice(s, e) : '';
  return {
    exact,
    prefix: exact ? text.slice(Math.max(0, s - MAX_ANCHOR_CONTEXT), s) : '',
    suffix: exact ? text.slice(e, e + MAX_ANCHOR_CONTEXT) : '',
  };
}

/** 空白归一化：连续空白（含换行）压成一个空格，页面渲染与 innerText 的差异主要在这 */
function normalizeSpace(input: string): string {
  return String(input ?? '').replace(/[\s\u00a0\u3000]+/g, ' ').trim();
}

/**
 * 在全文里按锚点重新定位。
 * 顺序：原偏移仍在同一段文字 → 前文精确匹配 → 前后文同时匹配（消歧）→ 归一化空白后匹配。
 * 全部失败返回 null，由调用方统计为"定位失败"。
 */
export function locateAnchor(fullText: string, anchor: HighlightAnchor, hint?: LocatedRange): LocatedRange | null {
  const text = String(fullText ?? '');
  const exact = String(anchor?.exact ?? '');
  if (!exact || !text) return null;

  if (hint && hint.start >= 0 && hint.end > hint.start) {
    if (text.slice(hint.start, hint.end) === exact) return { start: hint.start, end: hint.end };
  }

  const prefix = String(anchor?.prefix ?? '');
  const suffix = String(anchor?.suffix ?? '');

  // 前后文都在：只接受"前文紧邻 + 后文紧随"的位置，避免同一句话被重复出现时贴错
  if (prefix && suffix) {
    const at = text.indexOf(prefix + exact + suffix);
    if (at >= 0) return { start: at + prefix.length, end: at + prefix.length + exact.length };
    // 站点改了前后文但原句还在：降级到句子级匹配，多处出现时投票选一处
  }

  const hits: number[] = [];
  let at = text.indexOf(exact);
  while (at >= 0) {
    hits.push(at);
    at = text.indexOf(exact, at + 1);
    if (hits.length > 50) break;
  }
  if (hits.length === 1) return { start: hits[0], end: hits[0] + exact.length };
  if (hits.length > 1) {
    // 多处出现：用前/后文投票，投不出来就取最靠前的一处（与阅读顺序一致）
    const scored = hits
      .map((h, idx) => ({ h, idx }))
      .map(({ h, idx }) => {
        let score = 0;
        if (prefix && text.slice(Math.max(0, h - prefix.length), h) === prefix) score += 2;
        if (suffix && text.slice(h + exact.length, h + exact.length + suffix.length) === suffix) score += 2;
        if (hint && hint.start >= 0) score -= Math.abs(h - hint.start) / text.length;
        return { h, score, order: idx };
      })
      .sort((a, b) => b.score - a.score || a.order - b.order);
    const best = scored[0];
    return { start: best.h, end: best.h + exact.length };
  }

  // 原文里有空白差异（innerText 换行 vs 归档里压成空格）：归一化后再找一次，命中后换算回原索引
  const flat = findNormalized(text, exact);
  return flat ? { start: flat.start, end: flat.end } : null;
}

/**
 * 在 haystack 里按"忽略空白差异"找 needle，并映射回 haystack 的原始下标。
 * 做法：逐字符扫描，记录归一化串每个字符对应的原串位置，needle 归一化后在归一化串里找。
 * needle 含 ≥2 个词时要求整词边界，避免把 "he" 命中到 "the" 里。
 */
export function findNormalized(haystack: string, needle: string): LocatedRange | null {
  const hay = String(haystack ?? '');
  const want = normalizeSpace(needle);
  if (!hay || !want) return null;
  let flat = '';
  const map: number[] = [];
  let pendingSpace = false;
  for (let i = 0; i < hay.length; i++) {
    const ch = hay[i];
    if (/[\s\u00a0\u3000]/.test(ch)) { pendingSpace = true; continue; }
    if (pendingSpace && flat) { flat += ' '; map.push(i); }
    pendingSpace = false;
    flat += ch;
    map.push(i);
  }
  const at = flat.indexOf(want);
  if (at < 0) return null;
  return { start: map[at], end: map[at + want.length - 1] + 1 };
}

/** 合并重叠/相邻区间：两条高亮叠在一起时渲染不应出现嵌套标记 */
export function mergeRanges(ranges: LocatedRange[]): LocatedRange[] {
  const list = (Array.isArray(ranges) ? ranges : [])
    .filter(r => r && Number.isFinite(r.start) && Number.isFinite(r.end) && r.end > r.start)
    .sort((a, b) => a.start - b.start || a.end - b.end);
  const out: LocatedRange[] = [];
  for (const r of list) {
    const last = out[out.length - 1];
    if (last && r.start <= last.end) {
      if (r.end > last.end) last.end = r.end;
      continue;
    }
    out.push({ start: r.start, end: r.end });
  }
  return out;
}

/** 渲染分段：正文按高亮区间切成「普通/高亮」交替片段，重叠已合并 */
export interface TextSegment extends LocatedRange {
  text: string;
  highlighted: boolean;
}

/**
 * 把全文按高亮区间切段。
 * 无有效区间时返回一整段，调用方不必为"没有高亮"写特判。
 */
export function splitByHighlights(fullText: string, ranges: LocatedRange[]): TextSegment[] {
  const text = String(fullText ?? '');
  const merged = mergeRanges(ranges).filter(r => r.start < text.length);
  if (!merged.length) return text ? [{ start: 0, end: text.length, text, highlighted: false }] : [];
  const out: TextSegment[] = [];
  let cursor = 0;
  for (const r of merged) {
    const s = Math.max(cursor, Math.min(r.start, text.length));
    const e = Math.max(s, Math.min(r.end, text.length));
    if (s > cursor) out.push({ start: cursor, end: s, text: text.slice(cursor, s), highlighted: false });
    out.push({ start: s, end: e, text: text.slice(s, e), highlighted: true });
    cursor = e;
  }
  if (cursor < text.length) out.push({ start: cursor, end: text.length, text: text.slice(cursor), highlighted: false });
  return out;
}

/**
 * URL 归一化：去掉 fragment 与常见跟踪参数，让同一篇文章的不同分享链接归成一条。
 * 只删确定无用的键名，不做通用 query 清洗——站点的真实内容常在 query 里。
 */
export function normalizePageUrl(url: string): string {
  const raw = String(url ?? '').trim();
  if (!raw) return '';
  let parsed: URL;
  try { parsed = new URL(raw); } catch { return raw; }
  parsed.hash = '';
  const tracking = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'spm', 'from', 'share_token', 'wechat_share'];
  tracking.forEach(k => parsed.searchParams.delete(k));
  return parsed.toString();
}

/** 同一 URL 的归一化比较（先归一化再比，忽略末尾斜杠差异） */
export function isSamePage(a: string, b: string): boolean {
  const na = normalizePageUrl(a).replace(/\/$/, '');
  const nb = normalizePageUrl(b).replace(/\/$/, '');
  return !!na && na === nb;
}

/** 高亮 id：时间戳 + 随机尾巴，同一毫秒内连续添加也不会撞键 */
export function newHighlightId(): string {
  return `hl_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * 追加一条高亮并守住上限：超出时丢弃最旧的，返回被丢弃的条数供调用方如实告知，
 * 而不是静默少存——用户会以为自己的批注还在。
 */
export function appendHighlight(list: StoredHighlight[], item: StoredHighlight, limit = MAX_HIGHLIGHTS_PER_PAGE): { list: StoredHighlight[]; dropped: number } {
  const next = [...(Array.isArray(list) ? list : []), item];
  if (next.length <= limit) return { list: next, dropped: 0 };
  const sorted = next.sort((a, b) => (a?.createdAt ?? 0) - (b?.createdAt ?? 0));
  const dropped = sorted.length - limit;
  return { list: sorted.slice(dropped), dropped };
}

/**
 * 高亮 → Markdown 摘录块（写进归档文件的可读部分）。
 * 每条：引用原文 + 批注；批注为空时只留原文，不产出空的斜体标记。
 */
export function highlightsToMarkdown(highlights: Array<{ anchor: HighlightAnchor; note?: string; createdAt?: number }>): string {
  const list = (Array.isArray(highlights) ? highlights : [])
    .map(h => ({ text: normalizeSpace(h?.anchor?.exact ?? ''), note: String(h?.note ?? '').trim() }))
    .filter(h => h.text);
  if (!list.length) return '';
  return list.map((h, i) => {
    const head = `> ${i + 1}. ${h.text}`;
    return h.note ? `${head}\n>     —— 批注：${h.note.replace(/\n+/g, ' ')}` : head;
  }).join('\n>\n');
}
