/**
 * 编辑器启动工具（侧栏上下文共用）。
 *
 * 背景：此前"打开编辑器"逻辑内联在 SidePanelApp.launchEditor（录屏产物入口），
 * 页面录制成果列表（captureRecordingStore）需要同款入口；按"相同功能不得重复定义"
 * 的项目规则抽到本工具，两处共用同一实现。
 *
 * 数据交接：编辑器是独立标签页（独立文档），无法直接接收侧栏内存对象。
 * 交的是 IndexedDB 键而非 blob: URL——blob URL 随创建它的文档销毁而失效，
 * 用户打开编辑器后关掉侧栏就会让素材取不回来（详见 shared/editorHandoff.ts）。
 * 键列表经 chrome.storage.session.pendingEditorClips 传递，编辑器读取一次后清空。
 */

import { createLogger } from '@/utils/logger';
import { idbPut, idbGet, idbGetAllKeys, idbDelete, STORE_HLS_BLOBS } from '@/shared/blobStore';
import {
  EDITOR_HANDOFF_PREFIX,
  isStaleHandoff,
  type EditorHandoffEntry,
  type PendingEditorClip,
} from '@/shared/editorHandoff';

/** 本模块 logger：统一 `[editorLauncher]` 前缀 */
const log = createLogger('editorLauncher');

/**
 * 待交给编辑器的剪辑描述。素材来源三选一，优先级 idbKey > blob > url：
 * 已在库里的（录制成果）直接交键，零拷贝；侧栏内存里的先落库再交键。
 */
export interface EditorClipRef {
  /** 展示/导出用名称 */
  name: string;
  /** 已在 IndexedDB 中的素材键（长期保存的成果键，编辑器只读不删） */
  idbKey?: string;
  /** 侧栏内存中的素材：由本工具落 IDB 后交一次性键 */
  blob?: Blob;
  /** http(s) 直链：编辑器自行抓取（受白名单与体积上限约束） */
  url?: string;
}

/** 回收编辑器始终没来取的孤儿交接素材，避免大 Blob 在 IDB 里无限堆积 */
async function sweepStaleHandoffs(): Promise<void> {
  try {
    const keys = (await idbGetAllKeys(STORE_HLS_BLOBS)).filter(k => k.startsWith(EDITOR_HANDOFF_PREFIX));
    const now = Date.now();
    let removed = 0;
    for (const key of keys) {
      const raw = await idbGet(STORE_HLS_BLOBS, key);
      if (!isStaleHandoff(raw, now)) continue;
      await idbDelete(STORE_HLS_BLOBS, key);
      removed++;
    }
    if (removed > 0) log.info(`已回收 ${removed} 条过期编辑器交接素材`);
  } catch (e) {
    // 回收失败不阻断本次交接
    log.warn('回收过期交接素材失败', e);
  }
}

/**
 * 在新标签页打开编辑器并移交剪辑列表。
 * 失败（如 chrome.tabs 不可用）时抛错，由调用方决定提示文案。
 * @param clips 剪辑列表（至少 1 条）
 */
export async function openClipsInEditor(clips: EditorClipRef[]): Promise<void> {
  if (!clips.length) {
    log.warn('没有可打开的剪辑');
    return;
  }
  await sweepStaleHandoffs();

  const refs: PendingEditorClip[] = [];
  for (const c of clips) {
    if (c.idbKey) {
      refs.push({ name: c.name, idbKey: c.idbKey });
    } else if (c.blob && c.blob.size > 0) {
      const key = `${EDITOR_HANDOFF_PREFIX}${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      await idbPut(STORE_HLS_BLOBS, key, { savedAt: Date.now(), blob: c.blob } satisfies EditorHandoffEntry);
      refs.push({ name: c.name, idbKey: key });
    } else if (c.url) {
      refs.push({ name: c.name, url: c.url });
    } else {
      log.warn('剪辑缺少可用素材来源，已跳过', c.name);
    }
  }
  if (!refs.length) throw new Error('没有可移交的素材（Blob 为空且无直链）');

  // 先写存储再建标签页，避免编辑器先加载读不到待载入列表
  await chrome.storage.session.set({ pendingEditorClips: refs });
  const url = chrome.runtime.getURL('src/editor/index.html');
  await chrome.tabs.create({ url });
  log.info(`已打开编辑器，移交 ${refs.length} 条剪辑（IDB 键交接）`);
}