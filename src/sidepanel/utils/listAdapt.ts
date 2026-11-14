/**
 * 列表适配纯函数工具（UI 第二批之一：列表适配窄侧栏）。
 * 背景：
 *  - 图像/音频/视频三个面板共用"分页切片、重复项选择、过滤判定、防抖即时生效"
 *    四类列表逻辑。此前提取为面板内实现会造成三份近似重复代码，
 *    故统一收敛到本模块（唯一维护入口），并保证可被 tests/unit 直接导入做单测。
 * 约束：
 *  - 本模块不依赖 Vue / DOM / chrome API（防抖使用全局 setTimeout，浏览器与 node
 *    测试环境均可运行），所有函数为纯函数或无外部状态的工厂函数。
 */

import { compileFilterCached } from '@/core/mediaFilter';
import type { MediaMetaFacts } from '@/core/mediaMeta';

/**
 * 通用分页切片：返回第 page 页（1 起）的元素数组。
 * @param list     完整列表（只读）
 * @param page     页码，从 1 开始；非法值（<1 / 非有限数）按第 1 页处理
 * @param pageSize 每页容量；<=0 时视为不分页，返回整表浅拷贝
 * @returns 当前页元素的新数组（不修改原列表）
 */
export function slicePage<T>(list: readonly T[], page: number, pageSize: number): T[] {
  if (!Number.isFinite(pageSize) || pageSize <= 0) return list.slice();
  // 页码下限钳到 1，避免负偏移导致 slice 语义错乱
  const p = Number.isFinite(page) ? Math.max(1, Math.floor(page)) : 1;
  const start = (p - 1) * pageSize;
  // 页码越界（超出总长度）时返回空数组，与旧面板内联实现行为一致
  if (start >= list.length) return [];
  return list.slice(start, start + pageSize);
}

/**
 * 页码钳制：过滤/刷新后列表变短时，把越界的当前页拉回最后一页。
 * @param page     当前页码（1 起）
 * @param total    过滤后列表总条数
 * @param pageSize 每页容量
 * @returns 钳制后的合法页码（至少 1）
 */
export function clampPage(page: number, total: number, pageSize: number): number {
  const size = Number.isFinite(pageSize) && pageSize > 0 ? pageSize : 1;
  const totalPages = Math.max(1, Math.ceil(Math.max(0, total) / size));
  const p = Number.isFinite(page) ? Math.floor(page) : 1;
  return Math.min(Math.max(1, p), totalPages);
}

/**
 * 计算重复项 key 集合：按 groupKeyOf 分组，组内成员数 >=2 时整组判重。
 * 语义与图像面板 PhashDuplicateTracker（前 16 位哈希分组）一致，
 * 供音频等"URL+大小"分组场景复用，避免各面板重复实现两遍分组计数。
 * @param list       完整列表（只读）
 * @param keyOf      取列表项唯一 key（用于勾选/集合命中判断）
 * @param groupKeyOf 取分组键；返回 null 表示该项不参与重复判定（如哈希未算出）
 * @returns 处于重复分组中的项 key 集合
 */
export function computeDuplicateSet<T>(
  list: readonly T[],
  keyOf: (item: T) => string,
  groupKeyOf: (item: T) => string | null
): Set<string> {
  /** 分组键 -> 组内成员数 */
  const counts = new Map<string, number>();
  for (const it of list) {
    const g = groupKeyOf(it);
    if (g == null) continue;
    counts.set(g, (counts.get(g) || 0) + 1);
  }
  const dups = new Set<string>();
  for (const it of list) {
    const g = groupKeyOf(it);
    if (g != null && (counts.get(g) || 0) >= 2) dups.add(keyOf(it));
  }
  return dups;
}

/**
 * 收集重复项 key 清单（按列表顺序），供"选中重复项/取消选中重复"批量操作使用。
 * @param list   当前可见列表（只读）
 * @param keyOf  取列表项唯一 key
 * @param dupSet 重复 key 集合（来自 computeDuplicateSet 或增量 tracker 快照，不重算）
 * @returns 命中重复集合的 key 数组
 */
export function collectDuplicateKeys<T>(
  list: readonly T[],
  keyOf: (item: T) => string,
  dupSet: ReadonlySet<string>
): string[] {
  const out: string[] = [];
  for (const it of list) {
    const k = keyOf(it);
    if (dupSet.has(k)) out.push(k);
  }
  return out;
}

/**
 * 隐藏冗余重复：dupSet 命中的项按分组保留列表顺序中的第一个，其余隐藏。
 * 取舍说明：整组全部隐藏会让用户失去"下载其中一张"的入口，
 * 因此"隐藏重复"= 隐藏冗余副本、每组保留一个代表（首个出现项）。
 * @param list       待过滤列表（只读）
 * @param keyOf      取列表项唯一 key
 * @param groupKeyOf 取分组键；null 表示不参与（直接保留）
 * @param dupSet     重复 key 集合（复用既有判定结果，不重算哈希）
 * @returns 过滤后的新数组
 */
export function hideRedundantDuplicates<T>(
  list: readonly T[],
  keyOf: (item: T) => string,
  groupKeyOf: (item: T) => string | null,
  dupSet: ReadonlySet<string>
): T[] {
  /** 已经保留过代表成员的分组键 */
  const seenGroups = new Set<string>();
  const out: T[] = [];
  for (const it of list) {
    const k = keyOf(it);
    if (dupSet.has(k)) {
      const g = groupKeyOf(it);
      if (g != null) {
        // 同组已保留过首个代表 -> 本项为冗余副本，隐藏
        if (seenGroups.has(g)) continue;
        seenGroups.add(g);
      }
    }
    out.push(it);
  }
  return out;
}

/**
 * 增量扫描结果回填感知哈希，并挑出需要重新登记去重的项。
 * 扫描结果不带 phash（哈希要等图片 onload 才算得出来），按稳定 key 从上一轮沿用；
 * 不沿用会让每次增量更新都撤掉去重贡献，"隐藏重复"静默失效。
 * 就地补 next 各项的 phash，绝不改 key：key 是稳定身份，改它会让勾选态/懒加载态/已下载态全部错位。
 * @param next      本轮扫描项（就地补 phash）
 * @param prevByKey 上一轮 key -> 项 的索引
 * @returns 新增项或哈希发生变化的项（调用方只需对这些重新登记 tracker）
 */
export function carryForwardPhash<T extends { key: string; phash?: string }>(
  next: T[],
  prevByKey: ReadonlyMap<string, T>
): T[] {
  const changed: T[] = [];
  for (const it of next) {
    const old = prevByKey.get(it.key);
    if (old && !it.phash && old.phash) it.phash = old.phash;
    if (!old || old.phash !== it.phash) changed.push(it);
  }
  return changed;
}

/** 防抖句柄：run 触发延迟执行，cancel 取消未决执行（组件卸载时必须调用防泄漏） */
export interface Debounced {
  /** 调度一次延迟执行（重复调用只保留最后一次） */
  run(): void;
  /** 取消尚未触发的执行 */
  cancel(): void;
}

/**
 * 创建防抖执行器（过滤即时生效用）：连续输入时只在停止 wait 毫秒后执行一次。
 * 使用全局 setTimeout，浏览器返回 number、node 测试返回 Timeout 对象，类型统一收口。
 * @param fn   实际执行逻辑
 * @param wait 延迟毫秒数（如 300）
 */
export function createDebounce(fn: () => void, wait: number): Debounced {
  /** 当前未决定时器句柄；null 表示没有排队中的执行 */
  let timer: ReturnType<typeof setTimeout> | null = null;
  return {
    run() {
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(() => { timer = null; fn(); }, wait);
    },
    cancel() {
      if (timer !== null) { clearTimeout(timer); timer = null; }
    }
  };
}

/**
 * 失败原因汇总（批量操作 Toast 用，评审问题 5）：
 * 去重后最多展示两类，其余以「等 N 类原因」收尾（Toast 单行容量有限）。
 * 三个面板共用，收敛到本模块避免重复实现。
 * @param reasons 原始失败原因清单（可含重复）
 * @returns 汇总短语；空清单返回空串
 */
export function summarizeReasons(reasons: string[]): string {
  if (!reasons.length) return '';
  const uniq = Array.from(new Set(reasons));
  const head = uniq.slice(0, 2).join('；');
  return uniq.length > 2 ? `${head}；等 ${uniq.length} 类原因` : head;
}

/** 下载状态过滤维度：all=不过滤 / new=仅未下载 / downloaded=仅已下载 */
export type DownloadStatusFilter = 'all' | 'new' | 'downloaded';

/** 图像过滤条件（全部即时生效，由面板防抖后传入） */
export interface ImageFilterCriteria {
  /** 最小宽度（px）；<=0 视为不限制 */
  minWidth: number;
  /** 最小高度（px）；<=0 视为不限制 */
  minHeight: number;
  /** 资源类型精确匹配（'' 表示不限） */
  kind: string;
  /** 下载状态维度 */
  downloadStatus: DownloadStatusFilter;
  /** 搜索词（匹配 URL 或感知哈希，大小写不敏感；空白视为无词） */
  query: string;
}

/** 图像过滤所需的最小字段形状 */
export interface ImageFilterItem {
  url: string;
  width: number;
  height: number;
  kind: string;
  phash?: string;
}

/**
 * 图像过滤判定（纯函数）：宽高下限 + 类型 + 下载状态 + 搜索词四项与逻辑。
 * @param item         待判定图片
 * @param c            当前过滤条件
 * @param isDownloaded 下载历史查询注入（面板传入 downloadHistory 的判定，保持纯函数无依赖）
 * @returns 是否应出现在过滤结果中
 */
export function matchesImageFilter(
  item: ImageFilterItem,
  c: ImageFilterCriteria,
  isDownloaded: (url: string) => boolean
): boolean {
  if (c.minWidth > 0 && item.width < c.minWidth) return false;
  if (c.minHeight > 0 && item.height < c.minHeight) return false;
  if (c.kind && item.kind !== c.kind) return false;
  if (c.downloadStatus !== 'all') {
    const downloaded = isDownloaded(item.url);
    if (c.downloadStatus === 'downloaded' && !downloaded) return false;
    if (c.downloadStatus === 'new' && downloaded) return false;
  }
  const q = (c.query || '').trim().toLowerCase();
  if (q) {
    const urlHit = item.url.toLowerCase().includes(q);
    const hashHit = item.phash ? item.phash.toLowerCase().includes(q) : false;
    if (!urlHit && !hashHit) return false;
  }
  return true;
}

/** 音频过滤条件 */
export interface AudioFilterCriteria {
  /** 最小时长（秒）；<=0 不限制。注意：元数据未就绪（undefined）的项在设置下限时被排除（沿用旧语义） */
  minDuration: number;
  /** 最小体积（字节）；<=0 不限制 */
  minSize: number;
  /** 下载状态维度 */
  downloadStatus: DownloadStatusFilter;
  /** 搜索词（匹配标题或 URL） */
  query: string;
  /**
   * 属性过滤表达式（size>50MB and format=mp3）。
   * 语法未完成时不裁剪列表（面板已就地提示），与「用户还在打字」的中间态兼容。
   */
  expr?: string;
}

/** 音频过滤所需的最小字段形状 */
export interface AudioFilterItem {
  url: string;
  title?: string;
  mimeType?: string;
  extension?: string;
  size?: number;
  kind?: MediaMetaFacts['kind'];
}

/** 音频元数据形状（时长/体积，可能尚未补充完成） */
export interface AudioFilterMeta {
  duration?: number;
  contentLength?: number;
}

/**
 * 音频过滤判定（纯函数）：属性表达式 + 时长/体积下限 + 下载状态 + 搜索词。
 * @param item         待判定音频
 * @param meta         该项元数据（缺省视为未就绪）
 * @param c            当前过滤条件
 * @param isDownloaded 下载历史查询注入
 */
export function matchesAudioFilter(
  item: AudioFilterItem,
  meta: AudioFilterMeta,
  c: AudioFilterCriteria,
  isDownloaded: (url: string) => boolean
): boolean {
  if (!matchesExpr(audioFactsOf(item, meta), c.expr)) return false;
  if (c.minDuration > 0 && (!meta.duration || meta.duration < c.minDuration)) return false;
  if (c.minSize > 0 && (!meta.contentLength || meta.contentLength < c.minSize)) return false;
  if (c.downloadStatus !== 'all') {
    const downloaded = isDownloaded(item.url);
    if (c.downloadStatus === 'downloaded' && !downloaded) return false;
    if (c.downloadStatus === 'new' && downloaded) return false;
  }
  const q = (c.query || '').trim().toLowerCase();
  if (q) {
    const titleHit = (item.title || '').toLowerCase().includes(q);
    const urlHit = item.url.toLowerCase().includes(q);
    if (!titleHit && !urlHit) return false;
  }
  return true;
}

/** 视频过滤条件 */
export interface VideoFilterCriteria {
  /** 最小宽度；<=0 不限制（分辨率未知的项在下限生效时被排除，沿用旧语义） */
  minWidth: number;
  /** 最小高度 */
  minHeight: number;
  /** 最小时长（秒） */
  minDuration: number;
  /** 下载状态维度 */
  downloadStatus: DownloadStatusFilter;
  /** 搜索词（匹配 src 主机/路径或任一直链 URL） */
  query: string;
  /** 属性过滤表达式，语义同音频侧 */
  expr?: string;
}

/** 视频过滤所需的最小字段形状 */
export interface VideoFilterItem {
  src?: string;
  width?: number;
  height?: number;
  duration?: number;
  size?: number;
  mimeType?: string;
  extension?: string;
  kind?: MediaMetaFacts['kind'];
  directSources?: Array<{ url?: string; mimeType?: string; extension?: string; size?: number }>;
}

/**
 * 音频项 → 表达式可判定的事实集。
 * HEAD 探测到的体积是权威值，嗅探通道的 content-length 只作首屏兜底（否则设置 size 条件时
 * 会在「探测完成/未完成」两种时刻给出不同结果）。
 */
export function audioFactsOf(item: AudioFilterItem, meta: AudioFilterMeta): MediaMetaFacts {
  return {
    url: item.url,
    title: item.title,
    mimeType: item.mimeType,
    extension: item.extension,
    kind: item.kind,
    size: typeof meta.contentLength === 'number' ? meta.contentLength : item.size,
    duration: meta.duration
  };
}

/** 视频项 → 表达式可判定的事实集（页面内 <video> 常无 src，退回第一条直链认格式） */
export function videoFactsOf(item: VideoFilterItem): MediaMetaFacts {
  const candidate = (item.directSources || []).find(s => s && s.url);
  return {
    url: item.src || candidate?.url || '',
    mimeType: item.mimeType || candidate?.mimeType,
    extension: item.extension || candidate?.extension,
    kind: item.kind,
    // <video> 元素本身没有体积字段，size> 条件只能靠嗅探到的直链字节数；
    // 两者都拿不到时保持 undefined，由 matches() 判为未知不匹配
    size: item.size ?? (item.directSources || []).find(s => typeof s?.size === 'number')?.size,
    width: item.width,
    height: item.height,
    duration: item.duration
  };
}

/**
 * 表达式过滤（音视频共用）。
 * 空表达式或语法未完成一律放行：前者是「没过滤」，后者面板已经红字提示，
 * 这时候再把列表清空会让用户以为是页面没资源。
 */
function matchesExpr(facts: MediaMetaFacts, expr?: string): boolean {
  const src = (expr || '').trim();
  if (!src) return true;
  const compiled = compileFilterCached(src);
  if (compiled.error) return true;
  return compiled.test(facts);
}

/**
 * 视频过滤判定（纯函数）：属性表达式 + 分辨率/时长下限 + 下载状态 + 搜索词。
 * 搜索词匹配逻辑与旧面板内联实现一致：优先解析 URL 按 host/path 命中，
 * 解析失败退化为整串包含；再尝试 directSources 命中。
 * @param item         待判定视频
 * @param c            当前过滤条件
 * @param isDownloaded 下载历史查询注入（以 src 为键）
 */
export function matchesVideoFilter(
  item: VideoFilterItem,
  c: VideoFilterCriteria,
  isDownloaded: (url: string) => boolean
): boolean {
  if (!matchesExpr(videoFactsOf(item), c.expr)) return false;
  if (c.minWidth > 0 && (!item.width || item.width < c.minWidth)) return false;
  if (c.minHeight > 0 && (!item.height || item.height < c.minHeight)) return false;
  if (c.minDuration > 0 && (!item.duration || item.duration < c.minDuration)) return false;
  if (c.downloadStatus !== 'all') {
    const downloaded = isDownloaded(item.src || '');
    if (c.downloadStatus === 'downloaded' && !downloaded) return false;
    if (c.downloadStatus === 'new' && downloaded) return false;
  }
  const q = (c.query || '').trim().toLowerCase();
  if (q) {
    let hit = false;
    if (item.src) {
      try {
        const u = new URL(item.src, 'https://placeholder.local');
        const host = u.hostname.replace(/^www\./, '');
        if (host.toLowerCase().includes(q) || u.pathname.toLowerCase().includes(q)) hit = true;
      } catch {
        if (item.src.toLowerCase().includes(q)) hit = true;
      }
    }
    if (!hit && Array.isArray(item.directSources)) {
      for (const ds of item.directSources) {
        if (ds.url && ds.url.toLowerCase().includes(q)) { hit = true; break; }
      }
    }
    if (!hit) return false;
  }
  return true;
}
