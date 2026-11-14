/**
 * YAML frontmatter：Markdown 文件头部那段 `---` 包起来的元数据。
 *
 * 为什么手写而不是引库：正文归档是本扩展自己的产出物，字段固定且只有一个层级，
 * 引 js-yaml 会把 40KB 依赖塞进侧栏包，还要处理它在 MV3 下的构建问题。
 * 因此只实现用得到的 YAML 子集，并且：
 *  - 产出侧：所有可能被 YAML 解析成别的类型的值（数字样、true/false/null 样、含冒号井号引号）
 *    一律加引号；多行值用 `\n` 转义写成单行双引号标量，绝不用 block scalar（缩进一改就炸）；
 *  - 读取侧：宽容解析（`key: value` + `- 项` 两种形态），解析不了的行原样留给正文，
 *    不因为别人手改过文件就把整份归档判为读不出来。
 */

/** 允许出现在 frontmatter 里的标量类型 */
export type FrontmatterValue = string | number | boolean | null | undefined | Array<string | number>;

/** frontmatter 文档：键顺序即产出顺序，顺序有语义（标题/来源/时间/标签） */
export type FrontmatterData = Record<string, FrontmatterValue>;

/** frontmatter 定界符 */
const DELIMITER = '---';

/** 不需要加引号的"安全"标量：纯文字，且不会被解析成数字/布尔/null/日期 */
const SAFE_SCALAR_RE = /^[A-Za-z\u4e00-\u9fff][A-Za-z0-9\u4e00-\u9fff _.,;!?()（）\-/]*$/;

/** 看起来像非字符串的 token：即使 SAFE 规则允许也必须加引号，否则读回来类型就变了 */
const AMBIGUOUS_RE = /^(?:[-+]?\d+(?:\.\d+)?|true|false|null|~|yes|no|on|off|nan|inf|undefined)$/i;

/** 键名里非法字符整段并成一个下划线：`a: b` 与 `a  b` 不该变成两个不同字段 */
const KEY_SANITIZE_RE = /[^A-Za-z0-9_\-\u4e00-\u9fff.]+/g;

/** 键是否需要加引号：含冒号/空格/井号等结构性字符 */
function needsKeyQuote(key: string): boolean {
  return !/^[A-Za-z_\u4e00-\u9fff][A-Za-z0-9_\-\u4e00-\u9fff.]*$/.test(key);
}

/**
 * 标量 → YAML 字面量。
 * 双引号写法用 JSON 转义，两者对常用字符集兼容，读回来不会歧义。
 */
export function formatYamlValue(value: Exclude<FrontmatterValue, Array<string | number>>): string {
  if (value === undefined || value === null) return "''";
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : "'NaN'";
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  const text = String(value);
  if (!text) return "''";
  // 多行必须转义成单行标量：block scalar 的缩进一旦被动过（编辑器自动缩进、复制粘贴）内容就变形
  if (/[\n\r]/.test(text) || /\s$/.test(text) || /^\s/.test(text)) return JSON.stringify(text);
  if (AMBIGUOUS_RE.test(text)) return JSON.stringify(text);
  if (!SAFE_SCALAR_RE.test(text)) return JSON.stringify(text);
  return text;
}

/** 标量列表 → 块式 YAML 数组（每项一行，两空格缩进） */
function formatYamlList(items: Array<string | number>): string {
  return `\n${items.map(v => `  - ${formatYamlValue(v)}`).join('\n')}`;
}

/**
 * 生成 frontmatter 文本（含定界符与结尾换行）。
 * 空文档返回空串：调用方据此决定"要不要头部"，而不是产出一对空的 `---`。
 */
export function stringifyFrontmatter(data: FrontmatterData | null | undefined): string {
  const lines: string[] = [];
  for (const [rawKey, value] of Object.entries(data ?? {})) {
    if (value === undefined) continue;
    const key = String(rawKey ?? '').replace(KEY_SANITIZE_RE, '_');
    if (!key) continue;
    const head = needsKeyQuote(key) ? JSON.stringify(key) : key;
    if (Array.isArray(value)) lines.push(value.length ? `${head}:${formatYamlList(value)}` : `${head}: []`);
    else lines.push(`${head}: ${formatYamlValue(value as Exclude<FrontmatterValue, Array<string | number>>)}`);
  }
  if (!lines.length) return '';
  return `${DELIMITER}\n${lines.join('\n')}\n${DELIMITER}\n`;
}

/** 解析结果：data 为元数据，body 为去掉头部的正文（原文，不改空白） */
export interface ParsedFrontmatter {
  data: FrontmatterData;
  body: string;
}

/**
 * 解析 frontmatter。
 * 没有合法头部（首行不是 `---`，或找不到闭合 `---`）时按"整份都是正文"返回，
 * 不报错、不误吞内容——用户拿到的多半是自己手写的 md。
 */
export function parseFrontmatter(text: string): ParsedFrontmatter {
  const raw = String(text ?? '').replace(/^\uFEFF/, '');
  const lines = raw.split(/\r?\n/);
  if (lines[0]?.trim() !== DELIMITER) return { data: {}, body: raw };
  let end = -1;
  for (let i = 1; i < lines.length; i++) {
    const t = lines[i].trim();
    if (t === DELIMITER || t === '...') { end = i; break; }
  }
  if (end < 0) return { data: {}, body: raw };

  const data: FrontmatterData = {};
  let pendingKey: string | null = null;
  for (let i = 1; i < end; i++) {
    const line = lines[i];
    const item = /^\s*-\s+(.*)$/.exec(line);
    if (item && pendingKey) {
      const bucket = data[pendingKey];
      const list = Array.isArray(bucket) ? bucket : [];
      const v = parseScalar(item[1]);
      // 数组项只收字符串/数字：YAML 里 `true` 出现在 tags 列表中当字面量用比当布尔更合意图
      list.push(typeof v === 'string' || typeof v === 'number' ? v : '');
      data[pendingKey] = list;
      continue;
    }
    const kv = /^([^:]{1,120}):\s*(.*)$/.exec(line);
    if (!kv) continue;
    pendingKey = kv[1].trim().replace(/^["']|["']$/g, '');
    if (!pendingKey) { pendingKey = null; continue; }
    const rest = kv[2];
    if (rest.trim() === '' || rest.trim() === '|') {
      // 值在后续 `- 项` 行里；无法判定的一律先给空串，读回至少不是 undefined 键
      data[pendingKey] = '';
      continue;
    }
    if (rest.trim() === '[]') { data[pendingKey] = []; continue; }
    data[pendingKey] = parseScalar(rest);
    pendingKey = null;
  }
  return { data, body: lines.slice(end + 1).join('\n') };
}

/** 单个标量文本 → 值：只认双引号/单引号包裹与裸文本，其余一律当字符串（不做类型猜测） */
function parseScalar(raw: string): Exclude<FrontmatterValue, Array<string | number>> {
  const t = raw.trim();
  if (t.length >= 2 && ((t[0] === '"' && t[t.length - 1] === '"') || (t[0] === "'" && t[t.length - 1] === "'"))) {
    const inner = t.slice(1, -1);
    if (t[0] === '"') {
      try {
        const parsed = JSON.parse(t);
        return typeof parsed === 'string' ? parsed : inner;
      } catch {
        return inner;
      }
    }
    return inner.replace(/''/g, "'");
  }
  if (t === 'true') return true;
  if (t === 'false') return false;
  if (t === 'null' || t === '~') return null;
  if (/^[-+]?\d+(\.\d+)?$/.test(t)) return Number(t);
  return t;
}

/**
 * 组装一份 Markdown 归档：frontmatter + `# 标题` + 正文。
 * 标题重复出现在正文里是有意的——很多 Markdown 阅读器只渲染正文，缺了 H1 就认不出这篇讲什么。
 */
export function buildMarkdownDoc(data: FrontmatterData, body: string, heading?: string): string {
  const head = stringifyFrontmatter(data);
  const title = String(heading ?? '').trim();
  const parts: string[] = [];
  if (title) parts.push(`# ${title}`);
  if (body.trim()) parts.push(body.trim());
  const doc = parts.join('\n\n');
  // 没有内容可写时只交头部（反之只交正文），别产出一堆空行
  if (!doc) return head;
  return `${head}${head ? '\n' : ''}${doc}\n`;
}
