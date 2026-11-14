/**
 * 正文结构块：内容脚本把 DOM 走查成结构化块，本模块负责把块渲染成 Markdown 与纯文本。
 * （HTML 渲染在 archive.ts：那里才需要转义与协议白名单，混在一起会让纯渲染层背上安全职责。）
 *
 * 之所以拆成"结构化数据 + 纯渲染"两层：
 *  - 旧实现只回传一坨 innerText，标题层级、列表、代码块、表格、链接全部拍平，
 *    存成 Markdown 还得手动重排版，归档更是只剩一段流水文字；
 *  - DOM 走查离不开文档，node 环境测不了；渲染层只吃纯数据，能覆盖住最容易出错的部分
 *    （嵌套列表缩进、表格竖线转义、链接标题括号、连续块之间的空行）。
 *
 * 渲染层的所有输出都假定：块与块之间恰好一个空行，行内不掺 HTML 标签。
 */

/** 行内片段：一段文字 + 可选的链接或强调标记。相邻同标记的片段应合并为一个 span */
export interface InlineSpan {
  text: string;
  /** 超链接目标，空串按无链接处理 */
  href?: string;
  /** 强调类型；多个标记叠加时只保留最外层一种（Markdown 嵌套写法在导出里得不偿失） */
  mark?: 'strong' | 'em' | 'code' | 'del';
}

/** 结构化正文块。与内容脚本的 DOM 标签一一对应，不做视觉美化 */
export type ArticleBlock =
  | { type: 'heading'; level: number; spans: InlineSpan[] }
  | { type: 'paragraph'; spans: InlineSpan[] }
  | { type: 'quote'; spans: InlineSpan[] }
  | { type: 'list'; ordered: boolean; start: number; items: InlineSpan[][] }
  | { type: 'code'; text: string; lang?: string }
  | { type: 'image'; src: string; alt: string; /** 图片已内联为 data URL（归档层标注） */ inlined?: boolean }
  | { type: 'table'; header: string[]; rows: string[][] }
  | { type: 'hr' };

/** 支持的最大标题层级：h1–h6，超出按 h6 处理 */
const MAX_HEADING_LEVEL = 6;

/**
 * Markdown 需转义的字符：反斜杠、反引号、星号、下划线、方括号、尖括号、竖线。
 * 只转义会改变块/行内结构的字符，其余保持原样，否则中文正文导出满是无谓反斜杠。
 * 方括号单独成支：写进字符类要么语义不清要么触发 useless-escape。
 */
const MD_ESCAPE_RE = /[\\`*_<>|]|\[|\]/g;

/** 行内文本转义（code 片段不转义：反引号内即字面量） */
export function escapeMarkdown(text: string): string {
  return String(text ?? '').replace(MD_ESCAPE_RE, '\\$&');
}

/** 链接标题 / 图片 alt 里的方括号会截断 `[text](url)`，这两个位置直接去掉方括号 */
function stripBrackets(text: string): string {
  return String(text ?? '').replace(/[[\]]/g, '');
}

/** URL 里的空格与括号必须百分号化，否则 Markdown 解析在第一个空格处断开 */
function encodeHref(href: string): string {
  return String(href ?? '')
    .trim()
    .replace(/ /g, '%20')
    .replace(/\(/g, '%28')
    .replace(/\)/g, '%29');
}

/** 空片段与纯空白片段一律丢弃，避免渲染出 `- ` 这种半截列表项 */
function cleanSpans(spans: InlineSpan[] | undefined): InlineSpan[] {
  return (Array.isArray(spans) ? spans : [])
    .map(s => ({ text: String(s?.text ?? ''), href: s?.href?.trim() || undefined, mark: s?.mark }))
    .filter(s => s.text.trim().length > 0);
}

/**
 * 行内片段 → Markdown。
 * 相邻同标记片段合并，保证被 DOM 拆碎的 `**粗｜体**` 仍输出成连续强调；
 * 句子边界不合并，否则跨句会被并成一整块强调。
 */
export function inlineToMarkdown(spans: InlineSpan[]): string {
  const list = cleanSpans(spans);
  const out: string[] = [];
  let buf: InlineSpan | null = null;
  const flush = () => {
    if (!buf) return;
    let body = buf.mark === 'code' ? wrapCode(buf.text) : escapeMarkdown(buf.text);
    if (buf.mark === 'strong') body = `**${body}**`;
    else if (buf.mark === 'em') body = `*${body}*`;
    else if (buf.mark === 'del') body = `~~${body}~~`;
    if (buf.href) body = `[${stripBrackets(body)}](${encodeHref(buf.href)})`;
    out.push(body);
    buf = null;
  };
  for (const s of list) {
    const same = !!buf && buf.mark === s.mark && (buf.href ?? '') === (s.href ?? '');
    if (same && !/[。！？.!?\s]$/.test(buf!.text) && !/^[。！？.!?\s]/.test(s.text)) {
      buf!.text += s.text;
      continue;
    }
    flush();
    buf = { ...s };
  }
  flush();
  return out.join('');
}

/** 行内代码：内容里的反引号用等长的围栏包住，避免提前闭合 */
function wrapCode(text: string): string {
  const t = String(text ?? '');
  const maxRun = (t.match(/`+/g) ?? []).reduce((m, run) => Math.max(m, run.length), 0);
  const fence = '`'.repeat(maxRun + 1);
  const pad = t.startsWith('`') || t.endsWith('`') ? ' ' : '';
  return `${fence}${pad}${t}${pad}${fence}`;
}

/** 表格单元格：竖线转义、换行压成 <br>，否则一行数据会被拆成多行 */
function tableCell(value: string): string {
  return String(value ?? '')
    .replace(/\s*\n\s*/g, '<br>')
    .replace(/\|/g, '\\|')
    .trim();
}

/** 块级 → Markdown（渲染入口） */
export function blocksToMarkdown(blocks: ArticleBlock[]): string {
  const parts: string[] = [];
  for (const b of Array.isArray(blocks) ? blocks : []) {
    switch (b?.type) {
      case 'heading': {
        const level = Math.min(MAX_HEADING_LEVEL, Math.max(1, Math.round(b.level) || 1));
        const text = inlineToMarkdown(b.spans);
        if (text) parts.push(`${'#'.repeat(level)} ${text}`);
        break;
      }
      case 'paragraph': {
        const text = inlineToMarkdown(b.spans);
        if (text) parts.push(text);
        break;
      }
      case 'quote': {
        const text = inlineToMarkdown(b.spans);
        if (text) parts.push(text.split('\n').map(l => `> ${l}`).join('\n'));
        break;
      }
      case 'list': {
        const lines: string[] = [];
        (Array.isArray(b.items) ? b.items : []).forEach((item, i) => {
          const text = inlineToMarkdown(item);
          if (!text) return;
          const bullet = b.ordered ? `${(b.start || 1) + i}. ` : '- ';
          // 列表项内换行按两空格续行，嵌套结构在块级已被拍平为多项
          lines.push(`${bullet}${text.split('\n').join('\n  ')}`);
        });
        if (lines.length) parts.push(lines.join('\n'));
        break;
      }
      case 'code': {
        const text = String(b.text ?? '').replace(/\n+$/, '');
        if (!text.trim()) break;
        // 围栏必须比内容里最长的反引号串更长，否则内容里的 ``` 会提前闭合
        const runs = (text.match(/`+/g) ?? []).map(m => m.length + 1);
        const fence = '`'.repeat(Math.max(3, ...runs));
        parts.push(`${fence}${b.lang ?? ''}\n${text}\n${fence}`);
        break;
      }
      case 'image': {
        const src = encodeHref(b.src ?? '');
        if (!src) break;
        parts.push(`![${stripBrackets(b.alt ?? '')}](${src})`);
        break;
      }
      case 'table': {
        const header = (Array.isArray(b.header) ? b.header : []).map(tableCell);
        const rows = (Array.isArray(b.rows) ? b.rows : []).map(r => (Array.isArray(r) ? r : []).map(tableCell));
        if (!header.length && !rows.length) break;
        const cols = Math.max(header.length, ...rows.map(r => r.length));
        // 补齐到同列数；空单元格写成空格，`|  |` 之外的写法在部分解析器里不算合法表格行
        const line = (cells: string[]) => {
          const row = cells.slice();
          while (row.length < cols) row.push('');
          return `| ${row.map(c => c || ' ').join(' | ')} |`;
        };
        parts.push([line(header.length ? header : Array(cols).fill('')), line(Array.from({ length: cols }, () => '---')), ...rows.map(line)].join('\n'));
        break;
      }
      case 'hr':
        parts.push('---');
        break;
      default:
        break;
    }
  }
  return parts.join('\n\n').trim();
}

/**
 * 单块 → 纯文本，保留可读的结构线索（列表用「·」、代码块缩进、表格按列宽对齐）。
 * 单独导出给归档层复用：单文件归档要按块定位高亮偏移，必须与全文渲染同一口径，
 * 两边各写一遍迟早漂移，而漂移的后果是高亮贴错位置——比不贴更糟。
 */
export function blockToPlainText(b: ArticleBlock): string {
  switch (b?.type) {
    case 'heading':
    case 'paragraph':
    case 'quote':
      return inlineToPlainText(b.spans);
    case 'list':
      return (Array.isArray(b.items) ? b.items : [])
        .map((item, i) => `${b.ordered ? `${(b.start || 1) + i}.` : '·'} ${inlineToPlainText(item)}`.trimEnd())
        .filter(line => line)
        .join('\n');
    case 'code': {
      const text = String(b.text ?? '').replace(/\n+$/, '');
      // 全空代码块不占位：正文抽取常带一个空 <pre>，留下面前全是缩进空行
      if (!text.trim()) return '';
      return text.split('\n').map(l => `    ${l}`).join('\n');
    }
    case 'image': {
      const alt = (b.alt ?? '').trim();
      return alt ? `[图：${alt}]` : '';
    }
    case 'table': {
      const rows = [(Array.isArray(b.header) ? b.header : []), ...(Array.isArray(b.rows) ? b.rows : [])]
        .map(r => (Array.isArray(r) ? r.map(c => String(c ?? '').replace(/\s+/g, ' ').trim()) : []))
        .filter(r => r.some(Boolean));
      if (!rows.length) return '';
      const cols = Math.max(...rows.map(r => r.length));
      const width = Array.from({ length: cols }, (_, i) => Math.max(2, ...rows.map(r => (r[i] ?? '').length)));
      // 先逐格补齐列宽再拼，行尾多余空格最后统一去掉
      return rows.map(r => r.map((c, i) => (c ?? '').padEnd(width[i])).join('  ').trimEnd()).join('\n');
    }
    case 'hr':
      return '——————';
    default:
      return '';
  }
}

/** 块级 → 纯文本全文（块间恰好一个空行）；高亮偏移以此为坐标系，与 archive.flattenBlocks 一致 */
export function blocksToPlainText(blocks: ArticleBlock[]): string {
  return (Array.isArray(blocks) ? blocks : []).map(blockToPlainText).filter(Boolean).join('\n\n');
}

/** 行内片段 → 纯文本：丢掉标记只留文字（链接 URL 不进正文，避免污染字数与全文检索） */
export function inlineToPlainText(spans: InlineSpan[]): string {
  let out = '';
  for (const s of cleanSpans(spans)) out += s.mark === 'code' ? ` ${s.text.trim()} ` : s.text;
  return out.replace(/[ \t\u00a0]+/g, ' ').trim();
}

/** 正文总字数（纯文本口径，用于面板展示与截断提示） */
export function countPlainText(blocks: ArticleBlock[]): number {
  return blocksToPlainText(blocks).length;
}
