/**
 * DASH (MPD) 播放清单解析（纯函数，零 DOM 依赖，可在 Node/单测与 SW 中运行）。
 * 实现：轻量 XML 扫描器构建元素树（仅 MPD 关心路径），再按 DASH 语义遍历。
 * 支持：静态 MPD、两级 SegmentTemplate 继承（duration 与 SegmentTimeline）、
 *       $RepresentationID$/$Bandwidth$/$Number$($Number%0Nd$)/$Time$ 模板展开。
 * 不支持（解析层明确标记，调用方给出可读错误）：SegmentBase/indexRange、多 Period、动态直播。
 * 音视频分轨说明：DASH 常见音视频分离，当前无合流能力，调用方对分离流应拒绝并提示录制兜底。
 */

export interface DashRepresentation {
  id: string;
  bandwidth: number;
  mimeType?: string;
  codecs?: string;
  width?: number;
  height?: number;
  audioOnly?: boolean;
  /** 展开后的初始化段地址 */
  initialization?: string;
  /** 展开后的分片地址（按播放顺序） */
  segments: string[];
}

export interface MpdParseResult {
  isDynamic: boolean;
  /** 展示总时长（秒） */
  durationSeconds?: number;
  videoRepresentations: DashRepresentation[];
  audioRepresentations: DashRepresentation[];
  /** 不支持的特性（SegmentBase 等），非空时调用方应拒绝 */
  unsupported: string[];
}

interface XNode {
  tag: string;
  attrs: Record<string, string>;
  children: XNode[];
}

/** 解析 ISO8601 时长（PT#H#M#S / P#D） */
export function parseIsoDuration(s?: string | null): number | undefined {
  if (!s) return undefined;
  const m = /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:([\d.]+)S)?$/.exec(s.trim());
  if (!m) return undefined;
  const [, d, h, min, sec] = m;
  return (Number(d) || 0) * 86400 + (Number(h) || 0) * 3600 + (Number(min) || 0) * 60 + (Number(sec) || 0);
}

function parseAttrs(raw: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const re = /([\w:.-]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw))) {
    attrs[m[1]] = m[3] !== undefined ? m[3] : m[4];
  }
  return attrs;
}

/** 扫描标签序列并按嵌套关系建树（忽略文本/注释/处理指令；足够应付机器生成的 MPD） */
function buildTree(xml: string): XNode | null {
  const TAG_RE = /<(\/?)([\w:.-]+)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>/g;
  const stack: XNode[] = [];
  let root: XNode | null = null;
  let m: RegExpExecArray | null;
  while ((m = TAG_RE.exec(xml))) {
    const closing = m[1] === '/';
    const selfClosing = m[4] === '/';
    if (closing) {
      stack.pop();
      continue;
    }
    const node: XNode = { tag: m[2], attrs: parseAttrs(m[3] || ''), children: [] };
    if (stack.length) stack[stack.length - 1].children.push(node);
    if (node.tag === 'MPD' && !root) root = node;
    if (!selfClosing) stack.push(node);
  }
  return root;
}

function findAll(node: XNode, tag: string, out: XNode[] = []): XNode[] {
  for (const c of node.children) {
    if (c.tag === tag) out.push(c);
    findAll(c, tag, out);
  }
  return out;
}

function findFirst(node: XNode, tag: string): XNode | null {
  for (const c of node.children) {
    if (c.tag === tag) return c;
    const deep = findFirst(c, tag);
    if (deep) return deep;
  }
  return null;
}

function resolveUri(uri: string, baseUrl: string): string {
  try {
    return new URL(uri, baseUrl).href;
  } catch {
    return uri;
  }
}

/** 替换 DASH 地址模板变量（含 $Number%05d$ 这类 printf 变体） */
export function expandTemplate(
  template: string,
  vars: { RepresentationID?: string; Bandwidth?: number; Number?: number; Time?: number }
): string {
  return template
    .replace(/\$RepresentationID\$/g, vars.RepresentationID ?? '')
    .replace(/\$Bandwidth(?:%0(\d+)d)?\$/g, (_, pad) => String(vars.Bandwidth ?? 0).padStart(Number(pad) || 0, '0'))
    .replace(/\$Number(?:%0(\d+)d)?\$/g, (_, pad) => String(vars.Number ?? 0).padStart(Number(pad) || 0, '0'))
    .replace(/\$Time(?:%0(\d+)d)?\$/g, (_, pad) => String(vars.Time ?? 0).padStart(Number(pad) || 0, '0'))
    .replace(/\$\$/g, '$');
}

interface TemplateInfo {
  timescale: number;
  duration?: number;
  startNumber: number;
  initialization?: string;
  media?: string;
  timeline?: { t?: number; d: number; r?: number }[];
}

function toTemplateInfo(node: XNode): TemplateInfo {
  const num = (a: string) => (node.attrs[a] !== undefined ? Number(node.attrs[a]) : undefined);
  const timelineNode = findFirst(node, 'SegmentTimeline');
  const timeline = timelineNode
    ? findAll(timelineNode, 'S').map(s => ({
        t: s.attrs.t !== undefined ? Number(s.attrs.t) : undefined,
        d: Number(s.attrs.d) || 0,
        r: s.attrs.r !== undefined ? Number(s.attrs.r) : 0
      }))
    : undefined;
  return {
    timescale: num('timescale') || 1,
    duration: num('duration'),
    startNumber: num('startNumber') ?? 1,
    initialization: node.attrs.initialization,
    media: node.attrs.media,
    timeline: timeline && timeline.length ? timeline : undefined
  };
}

function expandSegments(
  rep: { id: string; bandwidth: number },
  tpl: TemplateInfo,
  baseUrl: string,
  durationSeconds?: number
): { initialization?: string; segments: string[] } {
  const varsBase = { RepresentationID: rep.id, Bandwidth: rep.bandwidth };
  const initialization = tpl.initialization
    ? resolveUri(expandTemplate(tpl.initialization, varsBase), baseUrl)
    : undefined;
  const segments: string[] = [];
  if (tpl.media) {
    if (tpl.timeline?.length) {
      // $Time$ 模式：按 SegmentTimeline 展开
      let t = 0;
      for (const s of tpl.timeline) {
        const start = s.t !== undefined ? s.t : t;
        const count = (s.r ?? 0) + 1;
        for (let i = 0; i < count; i++) {
          segments.push(resolveUri(expandTemplate(tpl.media, { ...varsBase, Time: start + i * s.d }), baseUrl));
        }
        t = start + count * s.d;
      }
    } else if (tpl.duration) {
      // $Number$ 模式：按媒体总时长估算分片数
      const segSeconds = tpl.duration / tpl.timescale;
      const count = durationSeconds && durationSeconds > 0 ? Math.max(1, Math.ceil(durationSeconds / segSeconds)) : 1;
      for (let i = 0; i < count; i++) {
        segments.push(resolveUri(expandTemplate(tpl.media, { ...varsBase, Number: tpl.startNumber + i }), baseUrl));
      }
    }
  }
  return { initialization, segments };
}

export function parseMPD(xmlText: string, baseUrl: string): MpdParseResult {
  const root = buildTree(xmlText || '');
  if (!root || root.tag !== 'MPD') throw new Error('不是有效的 MPD 清单');

  const result: MpdParseResult = {
    isDynamic: root.attrs.type === 'dynamic',
    durationSeconds: parseIsoDuration(root.attrs.mediaPresentationDuration),
    videoRepresentations: [],
    audioRepresentations: [],
    unsupported: []
  };
  if (result.isDynamic) return result;

  const periods = findAll(root, 'Period');
  if (periods.length > 1) {
    result.unsupported.push('多 Period（多片段节目）');
    return result;
  }
  const period = periods[0];
  if (!period) return result;

  for (const adapt of findAll(period, 'AdaptationSet')) {
    const ct = `${adapt.attrs.contentType || ''} ${adapt.attrs.mimeType || ''}`.toLowerCase();
    const adaptIsAudio = /audio/.test(ct);
    const adaptTplNode = findFirst(adapt, 'SegmentTemplate');
    const adaptTpl = adaptTplNode ? toTemplateInfo(adaptTplNode) : null;

    for (const repNode of findAll(adapt, 'Representation')) {
      const mimeType = repNode.attrs.mimeType || adapt.attrs.mimeType;
      const repTplNode = findFirst(repNode, 'SegmentTemplate');
      const tpl = repTplNode ? toTemplateInfo(repTplNode) : adaptTpl;
      const isAudio = adaptIsAudio || (!ct.includes('video') && /audio/.test((mimeType || '').toLowerCase()));

      if (!tpl || !tpl.media) {
        if (findFirst(repNode, 'SegmentBase') || findFirst(adapt, 'SegmentBase')) {
          if (!result.unsupported.includes('SegmentBase(indexRange)')) result.unsupported.push('SegmentBase(indexRange)');
        } else if (!result.unsupported.includes('缺少 SegmentTemplate')) {
          result.unsupported.push('缺少 SegmentTemplate');
        }
        continue;
      }
      const rep: DashRepresentation = {
        id: repNode.attrs.id || '',
        bandwidth: Number(repNode.attrs.bandwidth) || 0,
        mimeType,
        codecs: repNode.attrs.codecs || adapt.attrs.codecs || undefined,
        width: repNode.attrs.width ? Number(repNode.attrs.width) : undefined,
        height: repNode.attrs.height ? Number(repNode.attrs.height) : undefined,
        audioOnly: isAudio,
        segments: []
      };
      const { initialization, segments } = expandSegments(rep, tpl, baseUrl, result.durationSeconds);
      rep.initialization = initialization;
      rep.segments = segments;
      if (rep.audioOnly) result.audioRepresentations.push(rep);
      else result.videoRepresentations.push(rep);
    }
  }
  return result;
}

/** 选码率最高的视频轨（须有已展开分片） */
export function pickBestDashVideo(reps: DashRepresentation[]): DashRepresentation | null {
  const usable = reps.filter(r => r.segments.length > 0);
  if (!usable.length) return null;
  return usable.reduce((best, r) => (r.bandwidth > best.bandwidth ? r : best), usable[0]);
}
