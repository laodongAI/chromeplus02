/**
 * 侧栏 → 编辑器素材交接契约（两个独立文档共享）。
 *
 * 为什么不能交 blob: URL：blob URL 的生命周期绑定「创建它的那个文档」。
 * 编辑器是独立标签页，用户打开它之后顺手关掉侧栏是极常见的操作，
 * 侧栏文档一销毁，其创建的全部 blob: URL 立即失效，编辑器 fetch 必然失败。
 * 改为交 IndexedDB 键：IDB 按扩展 origin 共享，与哪个文档还活着无关。
 *
 * 键有两种所有权，编辑器必须区分：
 *  - 带 EDITOR_HANDOFF_PREFIX 的是本次交接临时写入的，读完即可删；
 *  - 录制成果键（caprec_ 前缀）是用户长期保存的产物，只读不删。
 */

/** 一次性交接键前缀（写入方 editorLauncher，消费方 EditorApp） */
export const EDITOR_HANDOFF_PREFIX = 'editor_handoff_';

/** 交接素材存活上限：编辑器一直没来取（打开失败/被拦截）时的孤儿回收阈值 */
export const EDITOR_HANDOFF_TTL_MS = 60 * 60 * 1000;

/** 经 chrome.storage.session 交给编辑器的剪辑描述（不能含 Blob，storage 无法序列化） */
export interface PendingEditorClip {
  name: string;
  /** IndexedDB STORE_HLS_BLOBS 中的素材键 */
  idbKey?: string;
  /** http(s) 直链：编辑器自行抓取 */
  url?: string;
}

/** 临时交接键写入 IDB 的形态（带时间戳供孤儿回收） */
export interface EditorHandoffEntry {
  savedAt: number;
  blob: Blob;
}

/** 该键是否为一次性交接键（读完可删）；录制成果键返回 false，必须保留 */
export function isTransientHandoffKey(key: string): boolean {
  return key.startsWith(EDITOR_HANDOFF_PREFIX);
}

/**
 * 从 IDB 取回的原始值解出 Blob。
 * 两种写入形态并存：临时交接键存 EditorHandoffEntry，录制成果键直接存裸 Blob。
 * 空值/空 Blob 一律视为素材缺失，交由调用方报错，绝不造一个 0 字节片段顶替。
 */
export function resolveHandoffBlob(raw: unknown): Blob | null {
  if (raw instanceof Blob) return raw.size > 0 ? raw : null;
  const entry = raw as EditorHandoffEntry | null | undefined;
  if (entry && entry.blob instanceof Blob && entry.blob.size > 0) return entry.blob;
  return null;
}

/** 交接素材是否已过期（编辑器始终没来取的孤儿） */
export function isStaleHandoff(raw: unknown, now: number): boolean {
  const entry = raw as EditorHandoffEntry | null | undefined;
  // 裸 Blob 是录制成果，不带时间戳，永不按交接 TTL 回收
  if (!entry || typeof entry.savedAt !== 'number') return false;
  return now - entry.savedAt > EDITOR_HANDOFF_TTL_MS;
}