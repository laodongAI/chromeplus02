/**
 * 下载台账的分类与状态语义（纯函数层，可单测）。
 *
 * 为什么单独抽一层：队列（后台实时任务）与历史（落定归档）此前各用一套字符串，
 * 类型只有 video/audio/image，文本导出、资源包 zip、录制产物根本进不了台账；
 * 状态把「中断」和「失败」混为一谈，用户看不出哪些是网络/后台休眠导致、可以重试。
 * 这里把类型归一、状态分组、来源页匹配统一成一份口径，队列与历史共用，
 * UI 只做渲染，不再各自维护映射表。
 */

/** 台账资源类型：抓取面板的三大类 + 文本导出 + 资源包 + 兜底 */
export type DownloadKind = 'video' | 'audio' | 'image' | 'text' | 'archive' | 'other';

/** 队列任务状态（后台状态机原样沿用） */
export type DownloadStatus = 'pending' | 'running' | 'paused' | 'completed' | 'error' | 'canceled';

/** 历史归档状态：任务落定后的终态语义 */
export type HistoryStatus = 'success' | 'failed' | 'canceled';

/**
 * 状态分组：UI 筛选用的粗粒度档位。
 * 中断单列一档——它多为后台休眠/网络断开，重试大概率能成，与「资源本身取不到」的失败不同。
 */
export type DownloadStatusGroup = 'active' | 'completed' | 'interrupted' | 'failed' | 'canceled';

/** BaseTag 的语义档位（与共享徽标组件一致，不自造类名） */
export type DownloadTagVariant = 'success' | 'danger' | 'warning' | 'info' | 'neutral';

/** 类型筛选顺序即下拉选项顺序 */
export const DOWNLOAD_KIND_ORDER: readonly DownloadKind[] = ['video', 'audio', 'image', 'text', 'archive', 'other'];

export const DOWNLOAD_KIND_LABELS: Record<DownloadKind, string> = {
  video: '视频', audio: '音频', image: '图片', text: '文本', archive: '资源包', other: '其他'
};

export const DOWNLOAD_STATUS_LABELS: Record<DownloadStatus, string> = {
  pending: '待开始', running: '下载中', paused: '已暂停',
  completed: '已完成', error: '失败', canceled: '已取消'
};

export const STATUS_GROUP_LABELS: Record<DownloadStatusGroup, string> = {
  active: '进行中', completed: '已完成', interrupted: '中断', failed: '失败', canceled: '已取消'
};

/** 状态筛选下拉顺序（all 由 UI 自行 prepend） */
export const STATUS_GROUP_ORDER: readonly DownloadStatusGroup[] = ['active', 'completed', 'interrupted', 'failed', 'canceled'];

const KIND_SET = new Set<string>(DOWNLOAD_KIND_ORDER);

/**
 * 归一化任意来源的类型值。
 * 后台快照、旧历史记录、本地产物登记都可能给出 undefined 或未知字符串，
 * 一律收敛到 other，避免 UI 出现空白徽标或筛选漏项。
 */
export function normalizeKind(raw: unknown): DownloadKind {
  return typeof raw === 'string' && KIND_SET.has(raw) ? (raw as DownloadKind) : 'other';
}

/** 扩展名 → 类型（全小写、不含点） */
const EXT_KIND: Record<string, DownloadKind> = {
  mp4: 'video', m4v: 'video', mkv: 'video', webm: 'video', mov: 'video', avi: 'video',
  flv: 'video', ts: 'video', m3u8: 'video', mpd: 'video', mpeg: 'video', mpg: 'video', wmv: 'video', '3gp': 'video',
  mp3: 'audio', m4a: 'audio', aac: 'audio', wav: 'audio', flac: 'audio', ogg: 'audio',
  oga: 'audio', opus: 'audio', wma: 'audio', mid: 'audio', midi: 'audio',
  png: 'image', jpg: 'image', jpeg: 'image', gif: 'image', webp: 'image', bmp: 'image',
  svg: 'image', ico: 'image', avif: 'image', tiff: 'image', tif: 'image', heic: 'image',
  txt: 'text', md: 'text', markdown: 'text', html: 'text', htm: 'text', json: 'text',
  csv: 'text', xml: 'text', srt: 'text', vtt: 'text', ass: 'text', log: 'text',
  zip: 'archive', rar: 'archive', '7z': 'archive', tar: 'archive', gz: 'archive', bz2: 'archive', xz: 'archive'
};

/**
 * 从文件名或 URL 里取扩展名。
 * 必须先剥掉 query 与 hash——带签名参数的直链（?token=…）否则会被当成扩展名的一部分。
 */
export function extractExt(nameOrUrl: string): string {
  if (typeof nameOrUrl !== 'string' || !nameOrUrl) return '';
  const clean = nameOrUrl.split('#')[0].split('?')[0];
  const seg = clean.split('/').filter(Boolean).pop() || '';
  const dot = seg.lastIndexOf('.');
  if (dot <= 0 || dot === seg.length - 1) return '';
  return seg.slice(dot + 1).toLowerCase();
}

/**
 * 推断资源类型：MIME 优先（最权威），其次扩展名，都判不出归 other。
 * application/octet-stream 这类中性 MIME 不作为依据，继续看扩展名。
 */
export function inferKind(input: { fileName?: string; url?: string; mime?: string }): DownloadKind {
  const mime = (input.mime || '').split(';')[0].trim().toLowerCase();
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('text/')) return 'text';
  if (mime === 'application/zip' || mime === 'application/x-zip-compressed'
    || mime === 'application/x-7z-compressed' || mime === 'application/gzip'
    || mime === 'application/x-rar-compressed' || mime === 'application/x-tar') return 'archive';
  if (mime === 'application/json' || mime === 'application/xml' || mime === 'application/x-subrip') return 'text';
  const ext = extractExt(input.fileName || '') || extractExt(input.url || '');
  return EXT_KIND[ext] || 'other';
}

/**
 * 状态分组：队列状态与历史状态共用同一套档位。
 * 历史用 success/failed/canceled，队列用 completed/error/canceled + 中间态，
 * 这里统一映射，UI 筛选不必关心数据来自哪一侧。
 */
export function statusGroup(status: string, errorCode?: string): DownloadStatusGroup {
  if (status === 'completed' || status === 'success') return 'completed';
  if (status === 'canceled') return 'canceled';
  if (status === 'error' || status === 'failed') {
    return errorCode === 'INTERRUPTED' ? 'interrupted' : 'failed';
  }
  return 'active';
}

/** 任务状态徽标文案：中断单独成词，其余按状态表 */
export function statusLabel(status: string, errorCode?: string): string {
  if (statusGroup(status, errorCode) === 'interrupted') return '中断';
  return DOWNLOAD_STATUS_LABELS[status as DownloadStatus] || status;
}

/** 任务状态 → BaseTag 语义档位 */
export function statusVariant(status: string, errorCode?: string): DownloadTagVariant {
  switch (statusGroup(status, errorCode)) {
    case 'completed': return 'success';
    case 'failed': return 'danger';
    case 'interrupted': return 'warning';
    case 'canceled': return 'neutral';
    default: return status === 'running' ? 'info' : 'neutral';
  }
}

/** 类型 → BaseTag 语义档位（列表图标底色沿用同一套语义） */
export function kindVariant(kind: DownloadKind): DownloadTagVariant {
  if (kind === 'video') return 'info';
  if (kind === 'audio') return 'success';
  if (kind === 'image') return 'warning';
  return 'neutral';
}

/**
 * 队列状态 → 历史归档状态；非终态返回 null（不该写历史）。
 * 取消也要留痕：用户主动取消的任务此前完全不进历史，台账上像是凭空消失。
 */
export function toHistoryStatus(status: string): HistoryStatus | null {
  if (status === 'completed') return 'success';
  if (status === 'error') return 'failed';
  if (status === 'canceled') return 'canceled';
  return null;
}

/**
 * 来源页匹配：判断一条任务是否属于当前页面。
 * 比的是来源页地址（sourceUrl/referer），不是资源地址——媒体直链常在 CDN 上，
 * 与页面不同源，拿资源地址比会一条都匹配不上。
 * 忽略 hash（SPA 路由锚点不改变页面身份），但**保留查询串**：
 * watch?v=1 与 watch?v=2 是两个不同的视频页，只比 pathname 会把它们的下载互相串台。
 * 解析失败或任一侧缺失一律不匹配。
 */
export function isSameSource(taskSourceUrl: string | undefined | null, pageUrl: string | undefined | null): boolean {
  if (!taskSourceUrl || !pageUrl) return false;
  try {
    const a = new URL(taskSourceUrl);
    const b = new URL(pageUrl);
    return a.origin === b.origin && a.pathname === b.pathname && a.search === b.search;
  } catch {
    return false;
  }
}

/** 台账筛选条件（队列与历史共用） */
export interface DownloadFilter {
  /** 类型档位；all = 不限 */
  kind: DownloadKind | 'all';
  /** 状态档位；all = 不限 */
  group: DownloadStatusGroup | 'all';
  /** 当前页地址；给出即只看本页关联任务，null/undefined = 不限 */
  pageUrl?: string | null;
}

/** 参与筛选的最小字段集（队列任务与历史记录都满足） */
export interface FilterableItem {
  kind?: unknown;
  status: string;
  errorCode?: string;
  sourceUrl?: string;
}

/** 筛选谓词：三个条件全部满足才保留 */
export function matchesDownloadFilters(item: FilterableItem, filter: DownloadFilter): boolean {
  if (filter.kind !== 'all' && normalizeKind(item.kind) !== filter.kind) return false;
  if (filter.group !== 'all' && statusGroup(item.status, item.errorCode) !== filter.group) return false;
  if (filter.pageUrl && !isSameSource(item.sourceUrl, filter.pageUrl)) return false;
  return true;
}