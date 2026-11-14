/**
 * 字幕（SRT / WebVTT）解析与序列化——纯逻辑层。
 *
 * 编辑器的字幕此前只能靠 Whisper 逐段识别，既不能把网上下载的 .srt 带进来，
 * 也不能把已识别的字幕交出去（换工具就得重打一遍）。SRT/VTT 是事实标准，
 * 这里做双向转换，并遵守三条原则：
 *  1. 宽容解析、严格产出：真实字幕文件里缺序号、用句点当毫秒分隔、带 HTML 标签
 *     都很常见，解析端一律兼容；产出端固定标准形态，保证别的工具读得懂。
 *  2. 坏行不毁整篇：单条时间戳坏掉只跳过该条并记账，错误清单回传面板显示——
 *     静默丢字幕比报错更糟，用户会以为文件没问题。
 *  3. 只依赖字符串，不碰 DOM/网络，便于在 node 环境直接单测。
 */

/** 一条字幕提示（时间相对时间线起点，单位秒） */
export interface SubtitleCue {
  start: number;
  end: number;
  text: string;
}

export interface SubtitleParseResult {
  cues: SubtitleCue[];
  /** 面向用户的告警（哪一块被跳过、为什么）；为空表示完整解析 */
  errors: string[];
  /** 因超过上限而被丢弃的条数 */
  truncated: number;
}

/** 单次导入的字幕条数上限：超大文件（全片逐词字幕）会拖垮时间线渲染 */
export const MAX_SUBTITLE_CUES = 5000;

/** 最短持证时长：时间戳相同（常见于手工补的错误条目）时按此撑开，否则字幕一闪即没 */
export const MIN_CUE_DURATION = 0.2;

/** 时间戳行：可选小时、逗号或句点分隔毫秒、箭头后可跟 VTT 的 align/position 设置 */
const TIME_LINE_RE =
  /^\s*(?:(\d{1,2}):)?(\d{1,2}):(\d{1,2})[.,](\d{1,3})\s*-->\s*(?:(\d{1,2}):)?(\d{1,2}):(\d{1,2})[.,](\d{1,3})\s*(?:[^\r\n]*)$/;

/** VTT 的非字幕块（注释、样式、区域定义），整块丢弃而不是当成坏行 */
const VTT_META_RE = /^(NOTE|STYLE|REGION)\b/i;
/** VTT 文件头行（可能带 Kind/timing-format 参数），只占一行，不能连带吞掉同块首条字幕 */
const VTT_HEAD_RE = /^WEBVTT(\s|$)/i;

function toSeconds(h: string | undefined, m: string, s: string, ms: string): number {
  const hours = Number(h ?? 0);
  return hours * 3600 + Number(m) * 60 + Number(s) + Number(ms.padEnd(3, '0')) / 1000;
}

/** 秒 → `HH:MM:SS,mmm`（sep 传 '.' 即 VTT 形态）；非法/负数归零，毫秒四舍五入后仍需回卷 */
export function formatTimestamp(seconds: number, sep: ',' | '.' = ','): string {
  const safe = Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
  const totalMs = Math.round(safe * 1000);
  const ms = totalMs % 1000;
  const totalSec = (totalMs - ms) / 1000;
  const s = totalSec % 60;
  const m = Math.floor(totalSec / 60) % 60;
  const h = Math.floor(totalSec / 3600);
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${p(h)}:${p(m)}:${p(s)}${sep}${p(ms, 3)}`;
}

/**
 * 去掉内联标签并解码常见实体。
 * `<br>` 先换成换行（否则两行文字会黏成一句），其余标签（i/b/c.xxx/v）直接删——
 * 编辑器的字幕模型没有样式位，保留标签只会把 `<i>` 当文字显示出来。
 */
export function stripCueMarkup(line: string): string {
  return line
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
}

/**
 * 解析 SRT/VTT 文本。两者结构同源，共用一套块解析：
 * 空行分块 → 块内找时间戳行 → 之前的纯数字行是序号 → 之后的是正文。
 * VTT 的 NOTE/STYLE/REGION 块整块跳过，WEBVTT 头只丢一行，避免把首条字幕当元信息误删。
 */
export function parseSubtitle(text: string): SubtitleParseResult {
  const cues: SubtitleCue[] = [];
  const errors: string[] = [];
  const normalized = String(text ?? '').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const blocks = normalized.split(/\n{2,}/);
  let truncated = 0;
  for (let i = 0; i < blocks.length; i++) {
    const raw = blocks[i];
    if (!raw.trim()) continue;
    if (cues.length >= MAX_SUBTITLE_CUES) {
      truncated++;
      continue;
    }
    const lines = raw.split('\n');
    const head = lines[0].trim();
    if (VTT_META_RE.test(head)) continue;
    // 有些文件把 WEBVTT 头和第一条字幕写在同一块（严格说不合规），只丢头行，别把字幕一起吞掉
    if (VTT_HEAD_RE.test(head)) lines.shift();
    const timeIdx = lines.findIndex((l) => TIME_LINE_RE.test(l));
    if (timeIdx < 0) {
      // 只有纯数字（孤立序号）的块是分隔空行造成的碎片，不值得告警
      const rest = lines.join('\n').trim();
      if (rest && !/^\d+$/.test(rest)) errors.push(`第 ${i + 1} 块缺少时间戳行，已跳过：${rest.slice(0, 40)}`);
      continue;
    }
    const m = TIME_LINE_RE.exec(lines[timeIdx])!;
    const start = toSeconds(m[1], m[2], m[3], m[4]);
    let end = toSeconds(m[5], m[6], m[7], m[8]);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) {
      errors.push(`第 ${i + 1} 块时间戳非法（${lines[timeIdx].trim()}），已跳过`);
      continue;
    }
    if (end - start < MIN_CUE_DURATION) end = start + MIN_CUE_DURATION;
    const content = lines
      .slice(timeIdx + 1)
      .map(stripCueMarkup)
      .join('\n')
      .trim();
    if (!content) {
      errors.push(`第 ${i + 1} 块没有正文，已跳过`);
      continue;
    }
    cues.push({ start, end, text: content });
  }
  if (truncated > 0) errors.push(`字幕条数超过 ${MAX_SUBTITLE_CUES}，后续 ${truncated} 条未导入`);
  cues.sort((a, b) => a.start - b.start);
  return { cues, errors, truncated };
}

/**
 * 按时间线长度裁剪导入的字幕：起点已超出成片的条目没有落点，直接丢弃；
 * 末尾越界的条目截到片尾。返回被丢弃的条数供面板如实告知。
 */
export function clampCuesToDuration(cues: SubtitleCue[], duration: number): { cues: SubtitleCue[]; dropped: number } {
  if (!Number.isFinite(duration) || duration <= 0) return { cues: cues.map((c) => ({ ...c })), dropped: 0 };
  const out: SubtitleCue[] = [];
  let dropped = 0;
  for (const c of cues) {
    if (c.start >= duration) {
      dropped++;
      continue;
    }
    out.push({ ...c, end: Math.min(c.end, duration) });
  }
  return { cues: out, dropped };
}

/** 把整段偏移（秒）加到字幕上：源字幕按素材自身零点计时，落到时间线要加片段入点 */
export function shiftCues(cues: SubtitleCue[], offsetSeconds: number): SubtitleCue[] {
  const d = Number.isFinite(offsetSeconds) ? offsetSeconds : 0;
  return cues.map((c) => ({ start: Math.max(0, c.start + d), end: Math.max(0, c.end + d), text: c.text }));
}

function serialize(cues: SubtitleCue[], sep: ',' | '.', header: string | null): string {
  const body = cues
    .map((c, i) => `${i + 1}\n${formatTimestamp(c.start, sep)} --> ${formatTimestamp(c.end, sep)}\n${c.text}`)
    .join('\n\n');
  const text = header ? `${header}\n\n${body}\n` : `${body}\n`;
  return cues.length ? text : header ? `${header}\n` : '';
}

/** 产出标准 SRT（块之间恰好一个空行，毫秒用逗号） */
export function serializeSrt(cues: SubtitleCue[]): string {
  return serialize(cues, ',', null);
}

/** 产出 WebVTT（带 WEBVTT 头，毫秒用句点） */
export function serializeVtt(cues: SubtitleCue[], title?: string): string {
  return serialize(cues, '.', title && title.trim() ? `WEBVTT\n\nNOTE ${title.trim()}` : 'WEBVTT');
}

/** 从文件名/扩展名判断该按哪种格式产出；未知一律按 SRT（兼容性最好） */
export function isVttFileName(name: string): boolean {
  return /\.vtt$/i.test(String(name ?? ''));
}
