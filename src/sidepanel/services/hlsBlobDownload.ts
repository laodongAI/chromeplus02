/**
 * HLS 最终产物的侧边栏接收与保存。
 * 背景：Service Worker 中没有 URL.createObjectURL，合并出的大 Blob 通过
 * IndexedDB 交接（共享同源），由侧边栏读取后触发 chrome.downloads 保存。
 * 附带启动清扫：侧栏未打开期间完成的任务，打开后补一次保存。
 */

import { STORE_HLS_BLOBS, idbGet, idbGetAllKeys, idbDelete } from '@/shared/blobStore';
import type { HlsBlobEntry } from '@/background/hls';

let attached = false;

export function ensureHlsBlobDownloadListener(): void {
  if (attached) return;
  attached = true;
  if (!chrome?.runtime?.onMessage?.addListener) return;
  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === 'HLS_BLOB_READY' && typeof message.taskId === 'string') {
      void saveHlsBlob(message.taskId);
    }
    // 无 sendResponse：广播型消息
    return undefined;
  });
  // 清扫历史遗留（侧栏离线期间完成的任务）
  void sweepPendingBlobs();
}

async function sweepPendingBlobs(): Promise<void> {
  try {
    const keys = await idbGetAllKeys(STORE_HLS_BLOBS);
    for (const key of keys) {
      await saveHlsBlob(key);
    }
  } catch (e) {
    console.warn('[hlsBlob] 清扫待保存 Blob 失败:', e);
  }
}

async function saveHlsBlob(taskId: string): Promise<void> {
  try {
    const entry = await idbGet<HlsBlobEntry>(STORE_HLS_BLOBS, taskId);
    if (!entry?.blob) return;
    const url = URL.createObjectURL(entry.blob);
    await new Promise<void>((resolve) => {
      try {
        chrome.downloads.download({ url, filename: entry.fileName, conflictAction: 'uniquify' }, () => {
          void chrome.runtime.lastError;
          resolve();
        });
      } catch { resolve(); }
    });
    // 下载 API 已接管数据引用，延迟回收对象 URL 与 IDB 记录
    setTimeout(() => { try { URL.revokeObjectURL(url); } catch { /* noop */ } }, 60_000);
    await idbDelete(STORE_HLS_BLOBS, taskId);
    console.log('[hlsBlob] HLS 产物已保存:', entry.fileName);
  } catch (e) {
    console.warn('[hlsBlob] 保存 HLS 产物失败:', e);
  }
}
