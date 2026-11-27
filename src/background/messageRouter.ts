/**
 * 背景消息处理器注册（Sources 扫描/下载与内容脚本自识别）。
 * 统一通过 bus.ts 注册，未匹配消息由总线兜底响应。
 *
 * 治理说明（P1-4）：
 *  - 旧实现把全部资源内容缓存在 globalThis.__sourcesContentCache，
 *    无上限且 SW 回收即丢失，用户"扫描→勾选→下载"间隔稍久就报"请先扫描资源目录"；
 *  - 现改为：扫描只产出目录树与文件清单（轻量），内容在下载时按需获取；
 *  - 取回的内容写入 IndexedDB（复用 @/shared/blobStore 的 hls-blobs store，
 *    以 "sources:content:" 前缀隔离键空间），带条目数/单文件体积上限与 TTL 过期策略。
 */

import { registerBgHandler } from './bus';
import { MessageType, type SourcesDownloadStatusMessage, type SourcesTreeDownloadMessage } from '@/messaging';
import { createDownloadTask, startDownloadTask, getTaskStatus } from './sourcesDownload';
import { getSourcesTree, fetchSourceContents, type SourceFetchFailure } from '../content-scripts/sourcesTree';
import { summarizeSkippedFiles } from '@/utils/frameResources';
import { getRestrictedPageMessage } from '@/utils/restrictedPages';
import { idbGet, idbPut, idbDeleteByPrefix, STORE_HLS_BLOBS } from '@/shared/blobStore';
// P1-8：分级日志（SW 上下文默认 info 级）
import { createLogger } from '@/utils/logger';

/** 本模块 logger：保留原 `[messageRouter]` 前缀语义 */
const log = createLogger('messageRouter');

// ===== Sources 缓存治理参数（集中定义，便于后续调优） =====
/** 内容缓存键统一前缀（IndexedDB，隔离于 HLS 自身键空间） */
const SOURCES_CACHE_PREFIX = 'sources:content:';
/** 扫描清单键（记录最近一次扫描的 tabId 与时间，SW 重启后仍可恢复上下文） */
const SOURCES_SCAN_MANIFEST_KEY = 'sources:scan:manifest';
/** 内容缓存条目 TTL：30 分钟（过期条目读取时视为未命中） */
const SOURCES_CONTENT_TTL_MS = 30 * 60 * 1000;
/** 扫描清单有效期：1 小时（超时则回退为"当前活动标签页"） */
const SOURCES_SCAN_TTL_MS = 60 * 60 * 1000;
/** 单次下载最多处理文件数（防止异常清单拖垮打包） */
const SOURCES_MAX_FILES_PER_DOWNLOAD = 2000;
/** 单文件内容上限：20MB */
const SOURCES_PER_FILE_LIMIT_BYTES = 20 * 1024 * 1024;
/** 单次下载内容总量上限：150MB（超出部分跳过并告警） */
const SOURCES_TOTAL_LIMIT_BYTES = 150 * 1024 * 1024;

/** IndexedDB 内容缓存条目结构 */
interface SourcesCacheEntry {
  savedAt: number; // 写入时间戳（毫秒），用于 TTL 判断
  content: string | ArrayBuffer; // 资源内容（文本或二进制）
}

/** 扫描清单结构（轻量元数据，不含内容） */
interface SourcesScanManifest {
  tabId: number; // 扫描时的目标标签页
  savedAt: number; // 扫描时间戳
  fileCount: number; // 扫描到的文件总数（日志与诊断用）
}

/**
 * 读取未过期的内容缓存条目；未命中或已过期返回 undefined。
 * @param url 资源 URL
 */
async function getCachedContent(url: string): Promise<string | ArrayBuffer | undefined> {
  try {
    const entry = await idbGet<SourcesCacheEntry>(STORE_HLS_BLOBS, SOURCES_CACHE_PREFIX + url);
    if (!entry || typeof entry.savedAt !== 'number') return undefined;
    if (Date.now() - entry.savedAt > SOURCES_CONTENT_TTL_MS) return undefined; // 过期视为未命中
    return entry.content;
  } catch (e) {
    log.warn('读取 Sources 内容缓存失败（忽略，走按需获取）:', e instanceof Error ? e.message : e);
    return undefined;
  }
}

/**
 * 写入内容缓存条目（失败仅告警，不阻断下载主流程）。
 * @param url 资源 URL
 * @param content 资源内容
 */
async function putCachedContent(url: string, content: string | ArrayBuffer): Promise<void> {
  try {
    await idbPut(STORE_HLS_BLOBS, SOURCES_CACHE_PREFIX + url, { savedAt: Date.now(), content } satisfies SourcesCacheEntry);
  } catch (e) {
    log.warn('写入 Sources 内容缓存失败（忽略）:', e instanceof Error ? e.message : e);
  }
}

/**
 * 获取下载目标标签页：优先使用扫描清单记录的 tabId（未过期时），
 * 否则回退到当前活动标签页。
 */
async function resolveScanTabId(): Promise<number | undefined> {
  try {
    const manifest = await idbGet<SourcesScanManifest>(STORE_HLS_BLOBS, SOURCES_SCAN_MANIFEST_KEY);
    if (manifest && Date.now() - manifest.savedAt <= SOURCES_SCAN_TTL_MS) return manifest.tabId;
  } catch { /* 忽略：读取失败走活动标签页回退 */ }
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0]?.id;
}

export function setupMessageRouter() {
  // 内容脚本自识别：回传其所在 tabId/frameId，用于增量消息标记来源
  registerBgHandler(MessageType.WHO_AM_I, (_message, sender) => ({
    success: true,
    tabId: sender?.tab?.id,
    frameId: typeof sender?.frameId === 'number' ? sender.frameId : 0
  }));

  // Sources 下载状态查询：泛型收窄到具体消息接口（P1-1）
  registerBgHandler<SourcesDownloadStatusMessage>(MessageType.SOURCES_DOWNLOAD_STATUS, (message) => {
    // taskId 缺省时查空字符串等价于查不到任务（与旧 any 版本行为一致）
    const task = getTaskStatus(message?.taskId ?? '');
    if (task) {
      return { success: true, task: { progress: task.progress, status: task.status, error: task.error } };
    }
    return { success: false, error: '任务不存在' };
  });

  registerBgHandler(MessageType.SOURCES_TREE_SCAN, async () => {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const tabId = tabs[0]?.id;
    if (!tabId) return { success: false, error: '无法获取当前标签页' };

    // 受限页预检：chrome:// 等内部页上调试器附加必然失败，先给出可读原因，而不是把原始 lastError 透给面板
    const restricted = getRestrictedPageMessage(tabs[0]?.url);
    if (restricted) return { success: false, error: restricted };

    // 调试会话生命周期由 debuggerSession 仲裁：此处不再无条件 detach，
    // 否则会掐断同 tab 上正在跑的网络捕获（Network 域与本模块的 Page 域可共用一次附加）。
    try {
      // 只扫描目录树与文件清单，不再预下载全部内容（P1-4 治理点）
      const { tree, files } = await getSourcesTree(tabId);

      // 新扫描开始时清空旧内容缓存：把缓存体积约束在"最近一次扫描"范围内
      await idbDeleteByPrefix(STORE_HLS_BLOBS, SOURCES_CACHE_PREFIX).catch(() => { /* 忽略 */ });

      // 持久化轻量扫描清单（SW 回收后下载仍可恢复目标 tabId）
      await idbPut(STORE_HLS_BLOBS, SOURCES_SCAN_MANIFEST_KEY, {
        tabId,
        savedAt: Date.now(),
        fileCount: files.length
      } satisfies SourcesScanManifest);

      log.info(`Sources 扫描完成：树 ${tree.length} 个域名，文件清单 ${files.length} 项（内容按需获取）`);
      return { success: true, tree };
    } catch (e) {
      log.error('Sources 扫描失败:', e instanceof Error ? e.message : e);
      return { success: false, error: e instanceof Error ? e.message : '扫描资源目录失败' };
    }
  });

  // Sources 打包下载：泛型收窄后 message.files 已是 SourcesTreeFileItem[]（P1-1）
  registerBgHandler<SourcesTreeDownloadMessage>(MessageType.SOURCES_TREE_DOWNLOAD, async (message) => {
    const files = (message?.files || []) as Array<{ path?: string; url?: string; size?: number }>;
    if (files.length === 0) return { success: false, error: '文件列表为空' };

    // 防御性截断：异常大的清单先限量，避免拖垮打包流程
    const capped = files.slice(0, SOURCES_MAX_FILES_PER_DOWNLOAD);
    if (files.length > capped.length) {
      log.warn(`下载清单超出上限，仅处理前 ${SOURCES_MAX_FILES_PER_DOWNLOAD} 项`);
    }

    // 1) 先查 IndexedDB 内容缓存（TTL 内命中直接复用，避免重复 attach debugger）
    const contents = new Map<string, string | ArrayBuffer>(); // url -> 内容
    const missingUrls: string[] = []; // 缓存未命中、需要按需获取的 URL
    for (const f of capped) {
      if (!f?.url) continue;
      const cached = await getCachedContent(f.url);
      if (cached !== undefined) contents.set(f.url, cached);
      else missingUrls.push(f.url);
    }

    // 2) 未命中部分按需获取（下载时才取内容；分批并发 + 单文件体积上限）
    const fetchFailures: SourceFetchFailure[] = [];
    if (missingUrls.length > 0) {
      const tabId = await resolveScanTabId();
      if (!tabId) return { success: false, error: '请先扫描资源目录（无法定位目标标签页）' };
      const fetched = await fetchSourceContents(tabId, missingUrls, SOURCES_PER_FILE_LIMIT_BYTES);
      fetchFailures.push(...fetched.failures);
      for (const [url, content] of fetched.contents.entries()) {
        contents.set(url, content);
        await putCachedContent(url, content); // 写缓存（失败不阻断）
      }
    }

    // 3) 组装带内容的文件列表，并施加总量上限保护
    const filesWithContent: Array<{ path: string; url: string; content: string | ArrayBuffer; size: number }> = [];
    let totalBytes = 0;
    const overLimitPaths: string[] = [];
    for (const f of capped) {
      if (!f?.url || !f?.path) continue;
      const content = contents.get(f.url);
      if (content === undefined) continue; // 已在 fetchFailures 中登记原因
      const bytes = typeof content === 'string' ? content.length : content.byteLength;
      if (totalBytes + bytes > SOURCES_TOTAL_LIMIT_BYTES) {
        overLimitPaths.push(f.path);
        log.warn(`超出单次下载总量上限(${SOURCES_TOTAL_LIMIT_BYTES}B)，跳过：${f.url}`);
        continue;
      }
      totalBytes += bytes;
      filesWithContent.push({ path: f.path, url: f.url, content, size: f.size || bytes });
    }

    // 缺失必须呈现给用户：旧实现只打一条日志，用户拿到少文件的压缩包却毫不知情
    const skipped = summarizeSkippedFiles(fetchFailures, overLimitPaths, files.length - capped.length);
    if (skipped) log.warn(skipped.text);
    if (filesWithContent.length === 0) {
      return { success: false, error: skipped ? `没有文件可入包。${skipped.text}` : '未找到文件内容，请重新扫描' };
    }

    const taskId = createDownloadTask(filesWithContent);

    // 异步启动打包和下载（立即返回 taskId，进度经消息广播）
    startDownloadTask(taskId, (progress) => {
      try {
        chrome.runtime.sendMessage({ type: MessageType.SOURCES_DOWNLOAD_PROGRESS, taskId, progress }).catch(() => { /* 忽略 */ });
      } catch (e) { /* 忽略 */ }
    }).catch(e => {
      log.error('Download task failed:', e);
    });

    return { success: true, taskId, skipped };
  });
}
