/**
 * 侧栏信息架构（IA）导航状态模块（UI 第二批之二：信息架构收敛）。
 *
 * 背景：旧版侧栏为「组行 + tab 行」两级导航、共 11 个一级 tab；
 * 本轮收敛为 5 个一级入口：抓取 / 网站 / 下载 / 录制 / 设置，
 * 其中「抓取」「下载」内部再以分段（segmented）子模式承载原各面板。
 * 「网站」（支持网站目录）应用户要求与抓取、下载同级，为一级入口。
 *
 * 本模块只放"可抽成纯函数"的导航逻辑（旧 tab 键迁移映射、子模式与面板对应关系、
 * 状态校验规范化），以及 chrome.storage.local 的读写封装；
 * 不依赖任何 Vue 运行时，便于在 node 环境（vitest）直接做单元测试。
 */
import { createLogger } from '@/utils/logger';

/** 本模块 logger：记录旧键迁移、非法状态回退等导航里程碑 */
const log = createLogger('navState');

// ────────────────────────────── 类型定义 ──────────────────────────────

/** 一级入口键：抓取 | 网站 | 下载 | 录制 | 设置（网站为支持网站目录，与抓取同级） */
export type EntryKey = 'grab' | 'sites' | 'downloads' | 'record' | 'settings';

/**
 * 抓取入口的子模式键：
 *  image/video/audio/text/network/sources 为六个抓取面板分段子模式
 *  （network 为「接口」面板：仅捕获 AJAX 与 POST 等接口请求）。
 *  「支持网站」目录已升级为一级入口（见 EntryKey 的 sites），不再是抓取子模式。
 */
export type GrabSubKey = 'image' | 'video' | 'audio' | 'text' | 'network' | 'sources';

/** 抓取入口的"分段"子模式键：与 GrabSubKey 全集一致 */
export type GrabSegmentSubKey = GrabSubKey;

/**
 * 下载入口的子模式键：
 *  basket=收集篮（原 CollectionPanel）；
 *  queue=进行中（DownloadManagerPanel 队列分节）；history=历史（其历史分节）。
 */
export type DownloadsSubKey = 'basket' | 'queue' | 'history';

/** 完整导航状态：当前一级入口 + 两个可记忆子模式的入口各自的停留位 */
export interface NavState {
  /** 当前一级入口 */
  entry: EntryKey;
  /** 抓取入口的子模式停留位 */
  grabSub: GrabSubKey;
  /** 下载入口的子模式停留位 */
  downloadsSub: DownloadsSubKey;
}

// ────────────────────────────── 常量与映射 ──────────────────────────────

/** 一级入口全集（渲染顺序即导航栏顺序）；网站紧随抓取（选站后回抓取扫描，动线相邻） */
export const ENTRY_KEYS: readonly EntryKey[] = ['grab', 'sites', 'downloads', 'record', 'settings'] as const;

/** 抓取入口的分段子模式（按展示顺序） */
export const GRAB_SEGMENT_SUBS: readonly GrabSegmentSubKey[] = ['image', 'video', 'audio', 'text', 'network', 'sources'] as const;

/** 下载入口的分段子模式（按展示顺序） */
export const DOWNLOADS_SEGMENT_SUBS: readonly DownloadsSubKey[] = ['basket', 'queue', 'history'] as const;

/** 默认导航状态：升级后首次进入落在「抓取-视频」（与旧版默认 tab 行为一致） */
export const DEFAULT_NAV_STATE: NavState = { entry: 'grab', grabSub: 'video', downloadsSub: 'queue' };

/** 抓取子模式 → 所承载面板组件名 的对应关系（唯一事实来源，供渲染与单测共同校验） */
export const GRAB_SUB_PANEL_IDS: Record<GrabSubKey, string> = {
  image:   'ImageGrabPanel',
  video:   'VideoCapturePanel',
  audio:   'AudioGrabPanel',
  text:    'TextPanel',
  network: 'NetworkPanel',
  sources: 'SourcesDownloadPanel',
};

/** 下载子模式 → 所承载面板组件名 的对应关系（queue/history 共用 DownloadManagerPanel 的不同分节） */
export const DOWNLOADS_SUB_PANEL_IDS: Record<DownloadsSubKey, string> = {
  basket:  'CollectionPanel',
  queue:   'DownloadManagerPanel',
  history: 'DownloadManagerPanel',
};

/** 一级入口 → 所承载容器/面板组件名 的对应关系（网站入口直接承载 SiteCatalogPanel） */
export const ENTRY_PANEL_IDS: Record<EntryKey, string> = {
  grab:      'GrabWorkspace',
  sites:     'SiteCatalogPanel',
  downloads: 'DownloadsWorkspace',
  record:    'ScreenRecordPanel',
  settings:  'SettingsPanel',
};

// ────────────────────────────── 类型守卫 ──────────────────────────────

/** 运行时校验任意值是否为合法一级入口键 */
export function isEntryKey(v: unknown): v is EntryKey {
  return typeof v === 'string' && (ENTRY_KEYS as readonly string[]).includes(v);
}

/** 运行时校验任意值是否为合法抓取子模式键 */
export function isGrabSubKey(v: unknown): v is GrabSubKey {
  return typeof v === 'string' && (Object.keys(GRAB_SUB_PANEL_IDS) as string[]).includes(v);
}

/** 运行时校验任意值是否为合法下载子模式键 */
export function isDownloadsSubKey(v: unknown): v is DownloadsSubKey {
  return typeof v === 'string' && (Object.keys(DOWNLOADS_SUB_PANEL_IDS) as string[]).includes(v);
}

// ────────────────────────────── 旧键迁移（纯函数） ──────────────────────────────

/**
 * 旧版 11 个一级 tab 键 → 新导航状态 的迁移映射。
 *
 * 旧键语义与新去向：
 *  - video/image/audio/text/sources → 抓取入口 + 对应子模式；
 *  - sites（原「网站」tab）        → 一级「网站」入口（支持网站目录与抓取同级）；
 *  - downloads（原下载管理 tab）    → 下载入口 + 进行中子页签（旧 tab 同时承载队列与历史，队列优先）；
 *  - basket（原收集篮 tab）        → 下载入口 + 收集篮子页签；
 *  - screenrec（原录屏 tab）        → 录制入口（文案统一为「录制」）；
 *  - settings                      → 设置入口；
 *  - editor（launch 型入口，无面板）→ 抓取-视频 兜底（编辑器现为结果项动作按钮，不再是停留页）。
 *
 * @param legacy 旧版 tab 键（任意值，非字符串或未识别返回 null）
 * @returns 迁移后的完整导航状态；无法识别时返回 null（由调用方决定回退策略）
 */
export function migrateLegacyTab(legacy: unknown): NavState | null {
  switch (legacy) {
    case 'video':     return { entry: 'grab', grabSub: 'video',   downloadsSub: 'queue' };
    case 'image':     return { entry: 'grab', grabSub: 'image',   downloadsSub: 'queue' };
    case 'audio':     return { entry: 'grab', grabSub: 'audio',   downloadsSub: 'queue' };
    case 'text':      return { entry: 'grab', grabSub: 'text',    downloadsSub: 'queue' };
    case 'sources':   return { entry: 'grab', grabSub: 'sources', downloadsSub: 'queue' };
    case 'sites':     return { entry: 'sites', grabSub: 'video',  downloadsSub: 'queue' };
    case 'downloads': return { entry: 'downloads', grabSub: 'video', downloadsSub: 'queue' };
    case 'basket':    return { entry: 'downloads', grabSub: 'video', downloadsSub: 'basket' };
    case 'screenrec': return { entry: 'record', grabSub: 'video', downloadsSub: 'queue' };
    case 'settings':  return { entry: 'settings', grabSub: 'video', downloadsSub: 'queue' };
    // editor 是 launch 型入口（点击即新标签页打开编辑器），侧栏内无停留面板：兜底到抓取-视频
    case 'editor':    return { entry: 'grab', grabSub: 'video', downloadsSub: 'queue' };
    default:          return null;
  }
}

/**
 * 校验并规范化任意来源（持久化/消息）的导航状态。
 *
 * 兼容三种输入形态：
 *  1. 新格式对象 { entry, grabSub, downloadsSub }：逐字段校验，非法字段单独回退默认值；
 *  2. 旧格式字符串（如 'video'）：走 migrateLegacyTab 迁移；迁移失败回退默认状态；
 *  3. 其他/空值：直接回退默认状态。
 *
 * @param raw 原始值
 * @returns 保证字段全部合法的 NavState（永不返回 null，保证升级后不会停在空白页）
 */
export function normalizeNavState(raw: unknown): NavState {
  // 形态 2：旧版把 tab 键直接存成字符串的场景，先尝试迁移
  if (typeof raw === 'string') {
    const migrated = migrateLegacyTab(raw);
    if (migrated) {
      log.info(`检测到旧版导航键 "${raw}"，已迁移为新结构`, migrated);
      return migrated;
    }
    log.warn(`无法识别的旧版导航键 "${raw}"，回退默认导航状态`);
    return { ...DEFAULT_NAV_STATE };
  }
  // 形态 3：非对象直接回退
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_NAV_STATE };
  // 形态 1：逐字段校验，非法字段仅该字段回退（部分损坏不至于整体丢状态）
  const r = raw as Record<string, unknown>;
  // 中间版本迁移：上一版把「网站」放在抓取分段（grabSub='sites' 持久化残留），
  // 本版已升级为一级入口——检测到该停留位时直接迁到「网站」入口，不打断用户位置记忆
  if (r.entry === 'grab' && r.grabSub === 'sites') {
    log.info('检测到旧版停留位 抓取-网站 分段，已迁移为一级「网站」入口');
    return { entry: 'sites', grabSub: 'video', downloadsSub: isDownloadsSubKey(r.downloadsSub) ? r.downloadsSub : DEFAULT_NAV_STATE.downloadsSub };
  }
  return {
    entry:        isEntryKey(r.entry)        ? r.entry        : DEFAULT_NAV_STATE.entry,
    grabSub:      isGrabSubKey(r.grabSub)    ? r.grabSub      : DEFAULT_NAV_STATE.grabSub,
    downloadsSub: isDownloadsSubKey(r.downloadsSub) ? r.downloadsSub : DEFAULT_NAV_STATE.downloadsSub,
  };
}

// ────────────────────────────── 持久化 ──────────────────────────────

/** 导航状态持久化键（v1：新结构首版；旧版从未持久化过 tab，无需读旧键） */
const NAV_STORAGE_KEY = 'sp_nav_state_v1';

/**
 * 读取持久化的导航状态；无记录/异常时返回默认状态。
 * 读取结果统一过 normalizeNavState，兼容未来可能出现的旧格式残留。
 */
export async function loadNavState(): Promise<NavState> {
  try {
    const res = await new Promise<Record<string, unknown>>(resolve => {
      try { chrome.storage.local.get(NAV_STORAGE_KEY, r => resolve(r || {})); }
      catch { resolve({}); }
    });
    return normalizeNavState(res[NAV_STORAGE_KEY]);
  } catch (e) {
    log.warn('读取导航状态失败，使用默认值', e);
    return { ...DEFAULT_NAV_STATE };
  }
}

/**
 * 保存导航状态（fire-and-forget：侧栏导航失败不应打断任何主流程）。
 * @param state 当前完整导航状态
 */
export async function saveNavState(state: NavState): Promise<void> {
  try {
    await new Promise<void>(resolve => {
      try { chrome.storage.local.set({ [NAV_STORAGE_KEY]: state }, () => resolve()); }
      catch { resolve(); }
    });
    log.debug('导航状态已保存', state);
  } catch (e) {
    log.warn('保存导航状态失败', e);
  }
}
