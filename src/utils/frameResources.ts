/**
 * CDP Page.getResourceTree 的帧归属索引（纯逻辑，便于单测）。
 *
 * 为什么必须按帧取内容：Page.getResourceContent 的 frameId 必须是「拥有该资源的帧」。
 * 旧实现只取顶层 frameTree.frame.id 并用于所有 URL，于是 iframe 里的资源一律取不到，
 * CDP 返回错误后被 catch 静默计数，用户看到的是一个少了文件的压缩包。
 */

/** 一条资源及其归属帧 */
export interface FrameResource {
  url: string;
  frameId: string;
  size: number;
}

/** 资源 URL → 候选帧（首个为归属帧，其余供归属帧已销毁时重试） */
export type FrameResourceIndex = Map<string, string[]>;

/** CDP FrameResourceTree 的最小结构（只声明本模块用到的字段） */
export interface CdpFrameTree {
  frame?: { id?: string; url?: string };
  resources?: Array<{ url?: string; contentSize?: number; size?: number }>;
  childFrames?: CdpFrameTree[];
}

/**
 * 深度优先遍历整棵帧树（父帧在前），逐条回调资源并带上归属帧 ID。
 * 缺 frame.id 的帧整段跳过：没有帧 ID 就无法取内容，伪造一个只会把错误推到下游。
 */
export function walkFrameResources(
  frameTree: CdpFrameTree | null | undefined,
  onResource: (resource: FrameResource) => void
): void {
  if (!frameTree || typeof frameTree !== 'object') return;
  const frameId = frameTree.frame?.id;
  if (typeof frameId === 'string' && frameId && Array.isArray(frameTree.resources)) {
    for (const r of frameTree.resources) {
      if (typeof r?.url !== 'string' || !r.url) continue;
      onResource({ url: r.url, frameId, size: r.contentSize || r.size || 0 });
    }
  }
  if (Array.isArray(frameTree.childFrames)) {
    for (const child of frameTree.childFrames) walkFrameResources(child, onResource);
  }
}

/**
 * 建立 URL → 候选帧索引。
 * 同一 URL 可能挂在多个帧下（共享脚本/样式），按遍历顺序去重后全部保留：
 * 首个是归属帧，其余是重试备选（父帧先于子帧，故顶层帧优先）。
 */
export function buildFrameResourceIndex(frameTree: CdpFrameTree | null | undefined): FrameResourceIndex {
  const index: FrameResourceIndex = new Map();
  walkFrameResources(frameTree, ({ url, frameId }) => {
    const frames = index.get(url);
    if (!frames) { index.set(url, [frameId]); return; }
    if (!frames.includes(frameId)) frames.push(frameId);
  });
  return index;
}

/**
 * 取某个 URL 的候选帧列表。
 * 索引里没有该 URL 时（扫描后页面新增了资源）退回顶层帧试一次——
 * 这是唯一合理的猜测，且失败会被计入失败清单而非静默丢弃。
 */
export function frameCandidatesFor(
  index: FrameResourceIndex,
  url: string,
  topFrameId?: string
): string[] {
  const candidates = [...(index.get(url) ?? [])];
  if (topFrameId && !candidates.includes(topFrameId)) candidates.push(topFrameId);
  return candidates;
}

/** 内容取回失败的原因分类（供上层给出可操作的提示，而不是只记一条日志） */
export type SourceFetchFailureReason = 'no-frame' | 'oversize' | 'unavailable';

export interface SourceFetchFailure {
  url: string;
  reason: SourceFetchFailureReason;
  detail: string;
}

/** 打包缺失摘要：随下载应答返回侧栏，用户必须看得到少了哪些文件、为什么少 */
export interface SkippedFilesSummary {
  count: number;
  text: string;
}

/** 摘要里最多列出的示例路径数（完整清单在后台日志里） */
const SUMMARY_SAMPLE_LIMIT = 3;

/**
 * 汇总未能入包的文件。全部成功时返回 null，调用方据此决定是否渲染提示。
 * @param failures   取内容阶段的失败清单
 * @param overLimit  取到了内容但超出单次打包总量上限的路径
 * @param cappedCount 被清单上限截掉的项数
 */
export function summarizeSkippedFiles(
  failures: readonly SourceFetchFailure[],
  overLimit: readonly string[],
  cappedCount = 0
): SkippedFilesSummary | null {
  const count = failures.length + overLimit.length + cappedCount;
  if (count <= 0) return null;

  const parts: string[] = [];
  const unavailable = failures.filter(f => f.reason !== 'oversize');
  const oversize = failures.filter(f => f.reason === 'oversize').length + overLimit.length;
  if (unavailable.length) parts.push(`${unavailable.length} 项取不到内容（${unavailable[0].detail}）`);
  if (oversize) parts.push(`${oversize} 项超出体积上限`);
  if (cappedCount) parts.push(`${cappedCount} 项超出单次文件数上限`);

  const samples = [...failures.map(f => f.url), ...overLimit].slice(0, SUMMARY_SAMPLE_LIMIT);
  const sampleText = samples.length ? `例如：${samples.join('、')}${count > samples.length ? ' 等' : ''}` : '';
  return { count, text: `${count} 个文件未入包：${parts.join('；')}。${sampleText}` };
}