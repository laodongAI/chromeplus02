/**
 * HLS 最终产物的侧边栏接收与保存。
 * 背景：Service Worker 中没有 URL.createObjectURL，合并出的大 Blob 通过
 * IndexedDB 交接（共享同源），由侧边栏读取后触发 chrome.downloads 保存。
 * 附带启动清扫：侧栏未打开期间完成的任务，打开后补一次保存。
 */

import { STORE_HLS_BLOBS, idbGet, idbGetAllKeys, idbDelete, idbPut } from '@/shared/blobStore';
import type { HlsBlobEntry } from '@/background/hls';
// P1-1 协议收敛：HLS 产物就绪广播的类型改用消息枚举，消除裸字符串
import { MessageType } from '@/messaging';
// P1-8：分级日志（扩展页面上下文默认 info 级）
import { createLogger } from '@/utils/logger';

/** 本模块 logger：保留原 `[hlsBlob]` 前缀语义 */
const log = createLogger('hlsBlob');

let attached = false;

export function ensureHlsBlobDownloadListener(): void {
  if (attached) return;
  attached = true;
  if (!chrome?.runtime?.onMessage?.addListener) return;
  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === MessageType.HLS_BLOB_READY && typeof message.taskId === 'string') {
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
    log.warn('清扫待保存 Blob 失败:', e);
  }
}

async function saveHlsBlob(taskId: string): Promise<void> {
  try {
    const entry = await idbGet<HlsBlobEntry>(STORE_HLS_BLOBS, taskId);
    if (!entry?.blob) return;

    // 已发起过下载：按浏览器侧的真实状态决定，而不是无条件重发或无条件丢弃
    if (typeof entry.downloadId === 'number') {
      const live = await inspectDownload(entry.downloadId);
      if (live?.state === 'in_progress') return;
      if (live?.state === 'complete') { await idbDelete(STORE_HLS_BLOBS, taskId); return; }
      // 用户主动取消视为终态；其余中断（磁盘/网络/被回收的 blob URL）保留记录重试
      if (live?.state === 'interrupted' && live.error === 'USER_CANCELED') {
        await idbDelete(STORE_HLS_BLOBS, taskId);
        return;
      }
    }

    const url = URL.createObjectURL(entry.blob);
    const downloadId = await new Promise<number | undefined>((resolve) => {
      try {
        chrome.downloads.download({ url, filename: entry.fileName, conflictAction: 'uniquify' }, (id) => {
          void chrome.runtime.lastError;
          resolve(typeof id === 'number' ? id : undefined);
        });
      } catch { resolve(undefined); }
    });
    if (downloadId === undefined) {
      revoke(url);
      log.warn('HLS 产物下载发起失败，保留待保存记录:', entry.fileName);
      return;
    }

    // 记录 downloadId 后才回收产物：下载确认完成前 IDB 里始终留有可重试的副本
    await idbPut(STORE_HLS_BLOBS, taskId, { ...entry, downloadId });
    watchDownloadEnd(downloadId, url, taskId, entry.fileName);
  } catch (e) {
    log.warn('保存 HLS 产物失败:', e);
  }
}

function revoke(url: string): void {
  try { URL.revokeObjectURL(url); } catch { /* noop */ }
}

/** 查询浏览器下载项的终态信息；查不到（已被清理/浏览器重启）返回 null */
function inspectDownload(id: number): Promise<{ state?: string; error?: string } | null> {
  return new Promise((resolve) => {
    try {
      chrome.downloads.search({ id }, (items) => {
        void chrome.runtime.lastError;
        resolve(items?.length ? { state: items[0].state, error: items[0].error } : null);
      });
    } catch { resolve(null); }
  });
}

/**
 * 等下载进入终态再回收对象 URL 与 IDB 记录。
 * 此前发起后 60s 就 revoke、并立刻删 IDB：用户开着"另存为"对话框超过 60s、
 * 或下载中途失败时，产物既没保存下来也无法重试。
 */
function watchDownloadEnd(downloadId: number, url: string, taskId: string, fileName: string): void {
  let settled = false;
  const settle = (completed: boolean) => {
    if (settled) return;
    settled = true;
    try { chrome.downloads.onChanged.removeListener(onChanged); } catch { /* noop */ }
    revoke(url);
    if (completed) {
      void idbDelete(STORE_HLS_BLOBS, taskId);
      log.info('HLS 产物已保存:', fileName);
    } else {
      log.warn('HLS 产物下载未成功，保留记录待重试:', fileName);
    }
  };
  const onChanged = (delta: chrome.downloads.DownloadDelta) => {
    if (delta.id !== downloadId) return;
    const state = delta.state?.current;
    if (state === 'complete') settle(true);
    // 用户取消同样是终态：保留记录只会在下次清扫时违背用户意愿重新下载
    else if (state === 'interrupted') settle(delta.error?.current === 'USER_CANCELED');
  };
  try { chrome.downloads.onChanged.addListener(onChanged); } catch { /* noop */ }
  // 监听注册前可能已到终态（极小产物）：补查一次，避免记录永远滞留
  void inspectDownload(downloadId).then((live) => {
    if (live?.state === 'complete') settle(true);
    else if (live?.state === 'interrupted') settle(live.error === 'USER_CANCELED');
  });
}
