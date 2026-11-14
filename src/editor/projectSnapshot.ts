/**
 * 编辑器工程快照契约（自动保存 / 崩溃恢复）。
 *
 * 核心约束：Clip.url / DubClip.url 是本文档创建的 blob: object URL，
 * 页面一刷新就失效，绝不能原样落盘。落盘前换成耐久引用：
 *  - materialKey：素材已写入 IndexedDB（本地导入、配音、侧栏交接）；
 *  - sourceUrl：素材是 http(s) 直链，恢复时重新抓取。
 * 两者都没有的条目无法恢复，恢复时必须明确告知用户，不能静默少一段。
 *
 * 本模块只放不依赖 Vue/DOM/IDB 的纯逻辑，便于 tests/unit 直接覆盖。
 */

/** 工程快照在 STORE_HLS_BLOBS 中的键（单槽：始终保存最近一次工程） */
export const EDITOR_PROJECT_KEY = 'editor_project_latest';

/** 工程自有素材键前缀（与 caprec_ 录制成果、editor_handoff_ 一次性交接区分所有权） */
export const EDITOR_MATERIAL_PREFIX = 'editor_mat_';

/** 快照结构版本：不兼容时放弃恢复并告知，而不是按旧字段猜 */
export const PROJECT_SNAPSHOT_VERSION = 1;

/** 自动保存防抖：连续拖动裁剪/滑块时不要每帧写库 */
export const AUTOSAVE_DEBOUNCE_MS = 1500;

/** 孤儿素材回收阈值：工程被替换后，旧素材保留 7 天供反悔，之后回收 */
export const MATERIAL_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** 落盘后的媒体条目：url 置空，靠 materialKey / sourceUrl 复原 */
export interface PersistedMedia {
  id: string;
  url: string;
  materialKey?: string;
  sourceUrl?: string;
  /** 其余剪辑参数（裁剪/滤镜/分屏/标注等）原样透传，避免与 SFC 内 Clip 接口重复定义 */
  [k: string]: unknown;
}

export interface PersistedTrack {
  clips: PersistedMedia[];
  locked: boolean;
  visible: boolean;
  muted: boolean;
}

export interface PersistedProject {
  version: number;
  savedAt: number;
  tracks: PersistedTrack[];
  dubs: PersistedMedia[];
  caps: unknown[];
  markers: unknown[];
  audioTracks: unknown[];
  bgVolume: number;
  bgMuted: boolean;
  masterVolume: number;
  bgMusicKey?: string;
  /** 背景音乐显示名：Blob 从 IDB 取回后不带文件名，轨道标签靠它还原 */
  bgMusicName?: string;
}

/** 生成一个工程自有素材键 */
export function newMaterialKey(): string {
  return `${EDITOR_MATERIAL_PREFIX}${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

/** 是否为随文档失效的 URL（blob: / data:），落盘前必须剔除 */
export function isDocumentUrl(url: unknown): boolean {
  return typeof url === 'string' && (url.startsWith('blob:') || url.startsWith('data:'));
}

/**
 * 落盘前转换：把文档内 URL 置空，保留耐久引用。
 * 不改动入参（自动保存与 Undo 快照共用同一批对象，就地改会污染运行态）。
 */
export function toPersistedMedia<T extends { url: string }>(item: T): T {
  if (!isDocumentUrl(item.url)) return { ...item };
  return { ...item, url: '' };
}

/**
 * 解析并校验落盘快照。结构不符或版本不兼容一律返回 null，
 * 由调用方告知用户"上次工程无法读取"，而不是半恢复出一个错位时间线。
 */
export function parseProjectSnapshot(raw: unknown): PersistedProject | null {
  if (!raw || typeof raw !== 'object') return null;
  const p = raw as Partial<PersistedProject>;
  if (p.version !== PROJECT_SNAPSHOT_VERSION) return null;
  if (typeof p.savedAt !== 'number' || !isFinite(p.savedAt)) return null;
  if (!Array.isArray(p.tracks) || !Array.isArray(p.dubs)) return null;
  for (const t of p.tracks) {
    if (!t || typeof t !== 'object' || !Array.isArray(t.clips)) return null;
  }
  return {
    version: p.version,
    savedAt: p.savedAt,
    tracks: p.tracks as PersistedTrack[],
    dubs: p.dubs as PersistedMedia[],
    caps: Array.isArray(p.caps) ? p.caps : [],
    markers: Array.isArray(p.markers) ? p.markers : [],
    audioTracks: Array.isArray(p.audioTracks) ? p.audioTracks : [],
    bgVolume: typeof p.bgVolume === 'number' ? p.bgVolume : 80,
    bgMuted: !!p.bgMuted,
    masterVolume: typeof p.masterVolume === 'number' ? p.masterVolume : 1,
    bgMusicKey: typeof p.bgMusicKey === 'string' ? p.bgMusicKey : undefined,
    bgMusicName: typeof p.bgMusicName === 'string' ? p.bgMusicName : undefined,
  };
}

/** 是否值得提示恢复（空工程不必打扰用户） */
export function hasRecoverableContent(p: PersistedProject): boolean {
  return p.tracks.some(t => t.clips.length > 0) || p.dubs.length > 0 || p.caps.length > 0;
}

/** 收集工程自有的素材键；caprec_ 等他人所有的键绝不纳入（删了等于毁掉用户的录制成果） */
export function collectMaterialKeys(p: PersistedProject): string[] {
  const keys = new Set<string>();
  const add = (k: unknown) => {
    if (typeof k === 'string' && k.startsWith(EDITOR_MATERIAL_PREFIX)) keys.add(k);
  };
  for (const t of p.tracks) for (const c of t.clips) add(c.materialKey);
  for (const d of p.dubs) add(d.materialKey);
  add(p.bgMusicKey);
  return Array.from(keys);
}

/**
 * 孤儿素材判定：只回收工程自有前缀、且超过 TTL、且不被当前快照引用的素材。
 * @param key      IDB 键
 * @param savedAt  素材写入时刻（缺失时不回收，宁可留着也不误删）
 * @param now      当前时刻
 * @param keptKeys 当前快照引用的键集合
 */
export function isOrphanMaterial(key: string, savedAt: unknown, now: number, keptKeys: ReadonlySet<string>): boolean {
  if (!key.startsWith(EDITOR_MATERIAL_PREFIX)) return false;
  if (keptKeys.has(key)) return false;
  if (typeof savedAt !== 'number' || !isFinite(savedAt)) return false;
  return now - savedAt > MATERIAL_TTL_MS;
}