/**
 * 嗅探列表的属性过滤表达式（纯函数，零 eval，可单测）。
 *
 * 只有「最小/最大」两个下拉框时，用户想表达「只要 50MB 以上的 mp3」就无能为力。
 * 这里实现一个足够小的表达式语言：
 *   size>50MB and (format=mp3 or format=m4a)
 *   duration>=5m res>=720p -「口播长视频」
 *   kind=hls and size<1GB
 *   周杰伦            —— 裸词按可检索文本包含匹配（标题/地址/格式/清晰度/类型）
 *
 * 语法：字段 比较符 值，用 and/or/not 与括号组合；相邻两个条件之间可省略 and。
 * 比较符：> >= < <= = == !=（字符串字段额外支持 ~ 包含、!~ 不包含）。
 * 单位：size 支持 B/KB/MB/GB/TB（也接受简写 K/M/G，按 1024 进制）；
 *      duration 支持 s/m/h；分辨率可写 1080p 或 4k。
 * 语义约定：字段值未知（无 content-length 的流、拿不到尺寸的视频）时，涉及该字段的
 *          比较一律不匹配 —— 与面板既有的「设了下限就排除未知项」保持一致，
 *          避免把「不知道多大」伪装成「很小」。
 */

import { formatLabelOf, searchableTextOf, type MediaMetaFacts } from './mediaMeta';

export type FilterOp = '>' | '>=' | '<' | '<=' | '=' | '!=' | '~' | '!~';
type FieldKind = 'size' | 'duration' | 'number' | 'string';

interface FieldSpec {
  kind: FieldKind;
  /** 从事实里取出该字段的数值（string 字段忽略返回值） */
  numeric?: (f: MediaMetaFacts) => number | undefined;
  strings?: (f: MediaMetaFacts) => string[];
}

const BYTE_UNITS: Record<string, number> = {
  b: 1, kb: 1024, mb: 1024 ** 2, gb: 1024 ** 3, tb: 1024 ** 4,
  k: 1024, m: 1024 ** 2, g: 1024 ** 3, t: 1024 ** 4
};
const SECOND_UNITS: Record<string, number> = { s: 1, sec: 1, secs: 1, m: 60, min: 60, mins: 60, h: 3600, hr: 3600, hrs: 3600 };

/** 档位名 → 垂直分辨率（`res>=4k` 里的 4k 指 2160 行，不是 4000） */
const NAMED_TIERS: Record<string, number> = { '2k': 1440, '4k': 2160, '5k': 2880, '6k': 3840, '8k': 4320 };

const FIELDS: Record<string, FieldSpec> = {
  size: { kind: 'size', numeric: f => (Number.isFinite(f.size) ? f.size : undefined) },
  bytes: { kind: 'size', numeric: f => (Number.isFinite(f.size) ? f.size : undefined) },
  duration: { kind: 'duration', numeric: f => (Number.isFinite(f.duration) ? f.duration : undefined) },
  dur: { kind: 'duration', numeric: f => (Number.isFinite(f.duration) ? f.duration : undefined) },
  time: { kind: 'duration', numeric: f => (Number.isFinite(f.duration) ? f.duration : undefined) },
  width: { kind: 'number', numeric: f => (Number.isFinite(f.width) ? f.width : undefined) },
  height: { kind: 'number', numeric: f => (Number.isFinite(f.height) ? f.height : undefined) },
  res: { kind: 'number', numeric: f => (Number.isFinite(f.height) ? f.height : undefined) },
  resolution: { kind: 'number', numeric: f => (Number.isFinite(f.height) ? f.height : undefined) },
  format: { kind: 'string', strings: f => formatTokens(f) },
  fmt: { kind: 'string', strings: f => formatTokens(f) },
  ext: { kind: 'string', strings: f => formatTokens(f) },
  kind: { kind: 'string', strings: f => (f.kind ? [f.kind.toLowerCase()] : []) },
  type: { kind: 'string', strings: f => (f.kind ? [f.kind.toLowerCase()] : []) },
  url: { kind: 'string', strings: f => [String(f.url || '').toLowerCase()] },
  name: { kind: 'string', strings: f => [String(f.title || '').toLowerCase()] },
  title: { kind: 'string', strings: f => [String(f.title || '').toLowerCase()] }
};

/** format 既认标签（MP3/HLS）也认原始扩展名，用户写哪个都能命中 */
function formatTokens(f: MediaMetaFacts): string[] {
  const out = new Set<string>();
  const label = formatLabelOf(f);
  if (label) out.add(label.toLowerCase());
  for (const raw of [f.extension, f.mimeType]) {
    const v = String(raw || '').toLowerCase();
    if (v) out.add(v);
  }
  return Array.from(out);
}

export type FilterNode =
  | { type: 'and'; left: FilterNode; right: FilterNode }
  | { type: 'or'; left: FilterNode; right: FilterNode }
  | { type: 'not'; operand: FilterNode }
  | { type: 'cmp'; field: string; op: FilterOp; value: number | string; unit?: string }
  | { type: 'text'; value: string };

export interface ParseResult {
  node: FilterNode | null;
  /** 语法错误的人话描述；node 为 null 且无 error 表示表达式为空（不过滤） */
  error?: string;
}

// ===== 词法 =====

type Token =
  | { t: '(' } | { t: ')' }
  | { t: 'and' } | { t: 'or' } | { t: 'not' }
  | { t: 'op'; v: FilterOp }
  | { t: 'num'; v: number; unit?: string }
  | { t: 'word'; v: string; quoted: boolean };

const OPERATORS: Array<[string, FilterOp]> = [
  ['>=', '>='], ['<=', '<='], ['!=', '!='], ['!~', '!~'], ['==', '='], ['~=', '~'],
  ['>', '>'], ['<', '<'], ['=', '='], ['~', '~']
];

function tokenize(src: string): { tokens: Token[]; error?: string } {
  const tokens: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (/\s/.test(ch)) { i++; continue; }
    if (ch === '(') { tokens.push({ t: '(' }); i++; continue; }
    if (ch === ')') { tokens.push({ t: ')' }); i++; continue; }
    const op = OPERATORS.find(([lit]) => src.startsWith(lit, i));
    if (op) { tokens.push({ t: 'op', v: op[1] }); i += op[0].length; continue; }
    // 符号形式的逻辑运算符：!= / !~ 已在上面被吃掉，剩下的单 ! 只可能是取反
    if (src.startsWith('&&', i)) { tokens.push({ t: 'and' }); i += 2; continue; }
    if (src.startsWith('||', i)) { tokens.push({ t: 'or' }); i += 2; continue; }
    if (ch === '!') { tokens.push({ t: 'not' }); i++; continue; }
    if (ch === '&' || ch === '|') return { tokens, error: `「${ch}」请写成 and / or（位置 ${i + 1}）` };
    if (ch === '"' || ch === "'") {
      const end = src.indexOf(ch, i + 1);
      if (end < 0) return { tokens, error: `引号没有闭合（位置 ${i + 1}）` };
      tokens.push({ t: 'word', v: src.slice(i + 1, end).toLowerCase(), quoted: true });
      i = end + 1;
      continue;
    }
    const word = src.slice(i).match(/^[^\s()><=!~&|]+/);
    if (!word) return { tokens, error: `无法识别的字符「${ch}」（位置 ${i + 1}）` };
    const raw = word[0];
    const num = raw.match(/^(\d+(?:\.\d+)?)(.*)$/);
    if (num && (raw[0] >= '0' && raw[0] <= '9')) {
      tokens.push({ t: 'num', v: Number(num[1]), unit: num[2] ? num[2].toLowerCase() : undefined });
    } else if (/^(and|&&)$/i.test(raw)) tokens.push({ t: 'and' });
    else if (/^(or|\|\|)$/i.test(raw)) tokens.push({ t: 'or' });
    else if (/^(not|!)$/i.test(raw)) tokens.push({ t: 'not' });
    else tokens.push({ t: 'word', v: raw.toLowerCase(), quoted: false });
    i += raw.length;
  }
  return { tokens };
}

/** 出错时把 token 翻成人话（直接打印 t 字段用户看不懂） */
function describeToken(tk: Token | undefined): string {
  if (!tk) return '表达式结尾';
  if (tk.t === 'op') return `运算符 ${tk.v}`;
  if (tk.t === 'word') return `「${tk.v}」`;
  if (tk.t === 'num') return `${tk.v}${tk.unit || ''}`;
  if (tk.t === 'and' || tk.t === 'or' || tk.t === 'not') return `连接词 ${tk.t}`;
  return tk.t === '(' ? '左括号' : '右括号';
}

// ===== 语法 =====

class FilterSyntaxError extends Error {}

function parse(tokens: Token[]): FilterNode | null {
  let pos = 0;
  const peek = () => tokens[pos];
  const eat = (t: Token['t']) => {
    if (tokens[pos] && tokens[pos].t === t) { pos++; return true; }
    return false;
  };
  const startsPrimary = (tk: Token | undefined) =>
    !!tk && (tk.t === '(' || tk.t === 'not' || tk.t === 'word' || tk.t === 'num');

  function parseOr(): FilterNode {
    let left = parseAnd();
    while (peek() && peek().t === 'or') {
      pos++;
      left = { type: 'or', left, right: parseAnd() };
    }
    return left;
  }

  function parseAnd(): FilterNode {
    let left = parseNot();
    for (;;) {
      if (eat('and')) { left = { type: 'and', left, right: parseNot() }; continue; }
      // 相邻条件省略 and：`mp3 size>1M` 等价于 `mp3 and size>1M`
      if (startsPrimary(peek())) { left = { type: 'and', left, right: parseNot() }; continue; }
      return left;
    }
  }

  function parseNot(): FilterNode {
    if (eat('not')) return { type: 'not', operand: parseNot() };
    return parsePrimary();
  }

  function parsePrimary(): FilterNode {
    const tk = peek();
    if (!tk) throw new FilterSyntaxError('表达式在条件中途结束了');
    if (tk.t === '(') {
      pos++;
      const inner = parseOr();
      if (!eat(')')) throw new FilterSyntaxError('括号没有闭合');
      return inner;
    }
    if (tk.t === 'num') throw new FilterSyntaxError('数字需要写成「字段 比较符 数字」，例如 size>10MB');
    if (tk.t !== 'word') {
      throw new FilterSyntaxError(`${describeToken(tk)} 放错了位置：条件写成 字段 比较符 值，条件之间用 and / or 连接`);
    }
    // word：可能是字段名，也可能是裸搜索词
    const next = tokens[pos + 1];
    if (next && next.t === 'op') {
      const field = tk.v;
      const spec = FIELDS[field];
      if (!spec) {
        throw new FilterSyntaxError(`未知字段「${field}」，可用：size / duration / width / height / res / format / kind / url / name`);
      }
      const isText = spec.kind === 'string';
      const allowed = isText ? ['=', '!=', '~', '!~'] : ['>', '>=', '<', '<=', '=', '!='];
      if (!allowed.includes(next.v)) {
        throw new FilterSyntaxError(isText
          ? `「${field}」是文本字段，只支持 = != ~ !~（~ 表示包含）`
          : `「${field}」是数值字段，不支持 ${next.v}，请写成 ${field}>1080 这类形式`);
      }
      pos += 2;
      const value = parseValue(field);
      return { type: 'cmp', field, op: next.v, ...value };
    }
    pos++;
    return { type: 'text', value: tk.v };
  }

  function parseValue(field: string): { value: number | string; unit?: string } {
    const spec = FIELDS[field];
    const tk = peek();
    if (!tk) throw new FilterSyntaxError(`「${field}」后面缺少比较值`);
    if (spec.kind === 'string') {
      if (tk.t !== 'word') throw new FilterSyntaxError(`「${field}」是文本字段，值请写成 mp3 / hls 这样的词`);
      pos++;
      return { value: tk.v };
    }
    if (tk.t === 'num') {
      pos++;
      if (tk.unit && spec.kind === 'size' && !BYTE_UNITS[tk.unit]) {
        throw new FilterSyntaxError(`「${tk.unit}」不是可用的体积单位（B/KB/MB/GB/TB）`);
      }
      if (tk.unit && spec.kind === 'duration' && !SECOND_UNITS[tk.unit]) {
        throw new FilterSyntaxError(`「${tk.unit}」不是可用的时长单位（s/m/h）`);
      }
      // 清晰度字段收 1080p / 4k 这类档位写法：用户写 4k 指的是 2160 行，不是 4000
      if (tk.unit && spec.kind === 'number') {
        if (tk.unit === 'p') return { value: tk.v };
        const tier = NAMED_TIERS[`${tk.v}k`];
        if (!tier) throw new FilterSyntaxError(`「${tk.v}${tk.unit}」不是可识别的清晰度写法，请写 1080p 或 2k/4k/8k`);
        return { value: tier };
      }
      return { value: tk.v, unit: tk.unit };
    }
    throw new FilterSyntaxError(`「${field}」需要数值，例如 ${field}>1080`);
  }

  if (!tokens.length) return null;
  const node = parseOr();
  if (pos < tokens.length) throw new FilterSyntaxError(`${describeToken(tokens[pos])} 附近语法不对，条件之间请用 and / or 连接`);
  return node;
}

export function parseFilterExpr(src: string): ParseResult {
  const trimmed = (src || '').trim();
  if (!trimmed) return { node: null };
  const { tokens, error } = tokenize(trimmed);
  if (error) return { node: null, error };
  try {
    return { node: parse(tokens) };
  } catch (e) {
    return { node: null, error: e instanceof Error ? e.message : String(e) };
  }
}

// ===== 求值 =====

function compareNumber(op: FilterOp, left: number, right: number): boolean {
  switch (op) {
    case '>': return left > right;
    case '>=': return left >= right;
    case '<': return left < right;
    case '<=': return left <= right;
    case '=': return left === right;
    case '!=': return left !== right;
    default: return false;
  }
}

function compareString(op: FilterOp, values: string[], target: string): boolean {
  const exact = values.some(v => v === target);
  const contains = values.some(v => v.includes(target));
  switch (op) {
    case '=': return exact;
    case '!=': return !exact;
    case '~': return contains;
    case '!~': return !contains;
    default: return false;
  }
}

/** 右值换算成字段单位：size→字节、duration→秒、number→原值 */
function normalizeRhs(spec: FieldSpec, value: number | string, unit?: string): number | undefined {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return undefined;
  if (!unit) return n;
  if (spec.kind === 'size') return n * (BYTE_UNITS[unit] ?? 1);
  if (spec.kind === 'duration') return n * (SECOND_UNITS[unit] ?? 1);
  return n;
}

export function matchesFilter(node: FilterNode | null, facts: MediaMetaFacts): boolean {
  if (!node) return true;
  switch (node.type) {
    case 'and': return matchesFilter(node.left, facts) && matchesFilter(node.right, facts);
    case 'or': return matchesFilter(node.left, facts) || matchesFilter(node.right, facts);
    case 'not': return !matchesFilter(node.operand, facts);
    case 'text': return searchableTextOf(facts).includes(node.value);
    case 'cmp': {
      const spec = FIELDS[node.field];
      if (spec.kind === 'string') {
        const values = spec.strings?.(facts) ?? [];
        if (!values.length) return false;
        return compareString(node.op, values, String(node.value).toLowerCase());
      }
      const left = spec.numeric?.(facts);
      if (typeof left !== 'number' || !Number.isFinite(left)) return false;
      const right = normalizeRhs(spec, node.value, node.unit);
      if (typeof right !== 'number') return false;
      return compareNumber(node.op, left, right);
    }
    default: return true;
  }
}

export interface CompiledFilter {
  node: FilterNode | null;
  error?: string;
  /** 空表达式时恒为 true，UI 可据此区分「没过滤」与「过滤掉全部」 */
  test: (facts: MediaMetaFacts) => boolean;
}

/** 编译一次、逐行复用；语法错误只回传描述，绝不抛（面板输入是用户实时敲的） */
export function compileFilter(src: string): CompiledFilter {
  const { node, error } = parseFilterExpr(src);
  return { node, error, test: (facts: MediaMetaFacts) => matchesFilter(node, facts) };
}

const COMPILED_CACHE = new Map<string, CompiledFilter>();
const CACHE_LIMIT = 32;

/**
 * 列表逐行判定时复用同一份编译结果。
 * 缓存设上限：过滤表达式来自输入框，理论上可以被无限拉长，超限直接清空重来比 LRU 划算。
 */
export function compileFilterCached(src: string): CompiledFilter {
  const key = (src || '').trim();
  if (!key) return { node: null, test: () => true };
  const hit = COMPILED_CACHE.get(key);
  if (hit) return hit;
  const compiled = compileFilter(key);
  if (COMPILED_CACHE.size >= CACHE_LIMIT) COMPILED_CACHE.clear();
  COMPILED_CACHE.set(key, compiled);
  return compiled;
}
