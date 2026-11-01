/**
 * 背景消息处理器注册（Sources 扫描/下载与内容脚本自识别）。
 * 统一通过 bus.ts 注册，未匹配消息由总线兜底响应。
 */

import { registerBgHandler } from './bus';
import { createDownloadTask, startDownloadTask, getTaskStatus } from './sourcesDownload';
import { getSourcesTreeWithContent } from '../content-scripts/sourcesTree';

export function setupMessageRouter() {
  // 内容脚本自识别：回传其所在 tabId/frameId，用于增量消息标记来源
  registerBgHandler('WHO_AM_I', (_message, sender) => ({
    success: true,
    tabId: sender?.tab?.id,
    frameId: typeof sender?.frameId === 'number' ? sender.frameId : 0
  }));

  registerBgHandler('SOURCES_DOWNLOAD_STATUS', (message) => {
    const task = getTaskStatus(message?.taskId);
    if (task) {
      return { success: true, task: { progress: task.progress, status: task.status, error: task.error } };
    }
    return { success: false, error: '任务不存在' };
  });

  registerBgHandler('SOURCES_TREE_SCAN', async () => {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const tabId = tabs[0]?.id;
    if (!tabId) return { success: false, error: '无法获取当前标签页' };

    // 检查是否已有debugger附加
    try {
      await chrome.debugger.detach({ tabId });
    } catch { /* 忽略：可能本来就没有 */ }

    // 一次性获取树和内容
    const { tree, contentMap } = await getSourcesTreeWithContent(tabId);

    // 保存内容到全局Map供后续下载使用
    (globalThis as any).__sourcesContentCache = contentMap;
    (globalThis as any).__sourcesContentTabId = tabId;

    console.log('[messageRouter] Tree nodes:', tree.length);
    console.log('[messageRouter] Cached contents:', contentMap.size);
    return { success: true, tree };
  });

  registerBgHandler('SOURCES_TREE_DOWNLOAD', async (message) => {
    const files = message?.files || [];
    if (files.length === 0) return { success: false, error: '文件列表为空' };

    // 使用缓存的内容
    const contentMap = (globalThis as any).__sourcesContentCache as Map<string, string | ArrayBuffer>;
    if (!contentMap) return { success: false, error: '请先扫描资源目录' };

    // 从缓存中获取文件内容
    const filesWithContent = files.map((file: any) => {
      const content = contentMap.get(file.url);
      if (content) {
        return { path: file.path, url: file.url, content, size: file.size };
      }
      return null;
    }).filter((f: any): f is { path: string; url: string; content: string | ArrayBuffer; size: number } => f !== null);

    if (filesWithContent.length === 0) return { success: false, error: '未找到文件内容，请重新扫描' };

    const taskId = createDownloadTask(filesWithContent);

    // 异步启动打包和下载（立即返回 taskId，进度经消息广播）
    startDownloadTask(taskId, (progress) => {
      try {
        chrome.runtime.sendMessage({ type: 'SOURCES_DOWNLOAD_PROGRESS', taskId, progress }).catch(() => { /* 忽略 */ });
      } catch (e) { /* 忽略 */ }
    }).catch(e => {
      console.error('[messageRouter] Download task failed:', e);
    });

    return { success: true, taskId };
  });
}
