/**
 * 获取 Chrome DevTools Sources 面板的目录树结构（经 chrome.debugger API）。
 * 治理说明（P1-4）：
 *  - 扫描阶段只构建目录树与文件清单，不再无条件预下载全部内容
 *    （旧实现会把整个页面所有资源内容塞进内存 Map，大页面会顶爆 SW 堆）；
 *  - 内容改为「下载时按需获取」：fetchSourceContents 只取用户勾选的文件，
 *    分批并发 + 单文件体积上限，结果由 messageRouter 写入 IndexedDB 缓存。
 * 本模块运行在后台（Service Worker）上下文，仅使用 chrome.debugger API。
 */

import { isBlockedHost, getRegistrableDomain } from '@/utils/domains';
// 资源按归属帧取内容：顶层 frameId 不能用于 iframe 资源（旧实现的静默丢文件根因）
import { walkFrameResources, buildFrameResourceIndex, frameCandidatesFor, type CdpFrameTree } from '@/utils/frameResources';
// P1-8：分级日志（模块运行在后台 SW 上下文，默认 info 级可见）
import { createLogger } from '@/utils/logger';
// 受限页原始错误 → 可读原因（debugger 附加在 chrome:// 等页面必然失败）
import { friendlyRestrictedError } from '@/utils/restrictedPages';
// 调试会话与 networkCapture 共享：本模块只借用 Page 域，不能自行 detach 掐断对方的 Network 域
import { acquireDebugger, releaseDebugger } from '@/background/debuggerSession';

/** 本模块 logger：保留原 `[sourcesTree]` 前缀语义 */
const log = createLogger('sourcesTree');

export interface SourceTreeNode {
  name: string;
  path: string;
  type: 'directory' | 'file';
  children?: SourceTreeNode[];
  url?: string;
  size?: number;
}

/** 文件清单项：扫描阶段产出的轻量元数据（不含内容） */
export interface SourceFileEntry {
  url: string;  // 资源完整 URL（按需获取内容的键）
  path: string; // 展示/打包用相对路径
  size: number; // 资源体积（字节，来自 CDP contentSize）
}

/** 扫描结果：展示树（截断到 3 级）+ 完整文件清单（截断前收集，>3 层文件不丢失） */
export interface SourcesScanResult {
  tree: SourceTreeNode[];
  files: SourceFileEntry[];
}

/**
 * 扫描页面资源目录树（不获取内容）。
 * @param tabId 目标标签页 ID
 * @returns 展示树与完整文件清单
 */
export async function getSourcesTree(tabId: number): Promise<SourcesScanResult> {
  try {
    await acquireDebugger(tabId, 'sources-tree');
    await sendDebuggerCommand(tabId, 'Page.enable');
    const resourceTree = await sendDebuggerCommand(tabId, 'Page.getResourceTree');

    // 构建未截断的完整树
    let fullTree: SourceTreeNode[] = [];
    if (resourceTree && resourceTree.frameTree) {
      fullTree = buildSourcesTree(resourceTree.frameTree, /*truncate*/ false);
    }
    // 关键：在深度截断之前收集全部文件清单，避免 >3 层的文件静默丢失
    const files: SourceFileEntry[] = [];
    for (const hostNode of fullTree) {
      for (const f of getAllFilesInDirectory(hostNode)) {
        if (f.url) files.push({ url: f.url, path: f.path, size: f.size || 0 });
      }
    }
    // 展示树截断到 3 级（仅影响 UI 展示层，下载清单不受影响）
    const tree = limitTreeDepth(fullTree, 0, 3);

    log.info(`扫描完成：文件 ${files.length} 个，顶层域名 ${tree.length} 个`);
    await releaseDebugger(tabId, 'sources-tree');
    return { tree, files };
  } catch (e) {
    log.error('扫描资源目录失败:', e);
    await releaseDebugger(tabId, 'sources-tree');
    // 受限页兜底：URL 预检可能拿不到标签页 URL（竞态/权限），把附加失败的原始错误翻成可读原因
    const friendly = friendlyRestrictedError(e instanceof Error ? e.message : String(e));
    throw friendly ? new Error(friendly) : e;
  }
}

/** 按需获取内容的默认并发数 */
const FETCH_CONCURRENCY = 5;
/** 单文件内容默认上限：20MB（超过则跳过，防止个别巨型资源顶爆内存） */
const DEFAULT_PER_FILE_LIMIT_BYTES = 20 * 1024 * 1024;

/** 内容取回失败的原因分类与失败清单结构：定义在 @/utils/frameResources，此处转出供上层引用 */
export type { SourceFetchFailureReason, SourceFetchFailure } from '@/utils/frameResources';
import type { SourceFetchFailure } from '@/utils/frameResources';

export interface SourceContentsResult {
  contents: Map<string, string | ArrayBuffer>;
  failures: SourceFetchFailure[];
}

/**
 * 按需获取指定 URL 列表的资源内容（下载阶段调用）。
 * 一次会话租约内分批并发取回，控制单文件体积上限。
 * 每个 URL 按其归属帧取内容；归属帧已销毁时依次重试其余候选帧。
 * @param tabId 目标标签页 ID
 * @param urls 需要获取内容的资源 URL 列表
 * @param perFileLimitBytes 单文件体积上限（字节），默认 20MB
 * @returns 取回的内容与失败清单；失败项必须呈现给用户，不能静默少文件
 */
export async function fetchSourceContents(
  tabId: number,
  urls: string[],
  perFileLimitBytes: number = DEFAULT_PER_FILE_LIMIT_BYTES
): Promise<SourceContentsResult> {
  const contentMap = new Map<string, string | ArrayBuffer>();
  const failures: SourceFetchFailure[] = [];
  if (!urls.length) return { contents: contentMap, failures };

  try {
    await acquireDebugger(tabId, 'sources-tree');
    await sendDebuggerCommand(tabId, 'Page.enable');
    // 建立 URL → 归属帧索引：iframe 资源必须用 iframe 自己的 frameId 才取得到
    const resourceTree = await sendDebuggerCommand(tabId, 'Page.getResourceTree');
    const frameTree: CdpFrameTree | undefined = resourceTree?.frameTree;
    const topFrameId: string | undefined = frameTree?.frame?.id;
    const frameIndex = buildFrameResourceIndex(frameTree);
    if (!frameIndex.size && !topFrameId) throw new Error('无法获取页面帧信息（页面可能已导航或关闭）');

    for (let i = 0; i < urls.length; i += FETCH_CONCURRENCY) {
      const batch = urls.slice(i, i + FETCH_CONCURRENCY);
      await Promise.all(
        batch.map(async (url) => {
          const candidates = frameCandidatesFor(frameIndex, url, topFrameId);
          if (!candidates.length) {
            failures.push({ url, reason: 'no-frame', detail: '找不到拥有该资源的帧（页面可能已导航）' });
            return;
          }
          let lastError = '资源内容不可用';
          for (const frameId of candidates) {
            try {
              const result = await sendDebuggerCommand(tabId, 'Page.getResourceContent', { frameId, url });
              if (!result || typeof result.content !== 'string') { lastError = 'CDP 未返回资源内容'; continue; }
              if (result.base64Encoded) {
                // base64 解码前先按编码长度估算体积，超限直接跳过（避免解码浪费内存）
                const approxBytes = Math.floor((result.content.length * 3) / 4);
                if (approxBytes > perFileLimitBytes) {
                  failures.push({ url, reason: 'oversize', detail: `体积约 ${approxBytes}B，超过单文件上限 ${perFileLimitBytes}B` });
                  return;
                }
                contentMap.set(url, base64ToArrayBuffer(result.content));
                return;
              }
              if (result.content.length > perFileLimitBytes) {
                failures.push({ url, reason: 'oversize', detail: `文本体积 ${result.content.length}B，超过单文件上限 ${perFileLimitBytes}B` });
                return;
              }
              contentMap.set(url, result.content);
              return;
            } catch (e) {
              lastError = e instanceof Error ? e.message : String(e);
            }
          }
          failures.push({ url, reason: 'unavailable', detail: lastError });
        })
      );
    }
    log.info(`按需取回内容：成功 ${contentMap.size}，失败 ${failures.length}`);
    for (const f of failures) log.warn(`取回失败(${f.reason})：${f.url} — ${f.detail}`);
    await releaseDebugger(tabId, 'sources-tree');
    return { contents: contentMap, failures };
  } catch (e) {
    log.error('批量获取内容失败:', e);
    await releaseDebugger(tabId, 'sources-tree');
    const raw = e instanceof Error ? e.message : String(e);
    const detail = friendlyRestrictedError(raw) || raw;
    // 整批中断时把尚未取回的 URL 全部登记为失败，调用方才能如实告知缺失范围
    for (const url of urls) {
      if (!contentMap.has(url) && !failures.some(f => f.url === url)) {
        failures.push({ url, reason: 'unavailable', detail });
      }
    }
    // 已取回的部分仍然返回，让调用方尽可能完成打包
    return { contents: contentMap, failures };
  }
}

/**
 * base64 字符串转 ArrayBuffer（二进制资源解码）。
 * @param b64 标准 base64 字符串
 */
function base64ToArrayBuffer(b64: string): ArrayBuffer {
  const binaryString = atob(b64); // 解码为二进制字符串
  const bytes = new Uint8Array(binaryString.length); // 字节缓冲
  for (let i = 0; i < binaryString.length; i++) bytes[i] = binaryString.charCodeAt(i);
  return bytes.buffer;
}

/**
 * 构建 Sources 结构：
 * - 直接列出各域名（不显示 page/top）
 * - 自动过滤第三方/无关域名
 * - 递归收集所有 frame 的资源
 * 导出仅供单测覆盖帧归属与域名过滤（本模块自身只在文件内调用）。
 * @param frameTree CDP Page.getResourceTree 返回的 frame 树
 * @param truncate 是否在构建时截断深度（默认 false，由调用方在截断前收集文件清单）
 */
export function buildSourcesTree(frameTree: CdpFrameTree, truncate: boolean = false): SourceTreeNode[] {
  const primaryHost = getPrimaryHost(frameTree?.frame?.url);
  const hostMap = new Map<string, SourceTreeNode>();

  walkFrameResources(frameTree, ({ url: resourceUrl, size }) => {
    const url = safeParseUrl(resourceUrl);
    if (!url) return;
    const host = url.port ? `${url.hostname}:${url.port}` : url.hostname;
    if (!host) return;
    if (!isUsefulHost(host, primaryHost)) return;

    let hostNode = hostMap.get(host);
    if (!hostNode) {
      hostNode = {
        name: host,
        path: host,
        type: 'directory',
        children: []
      };
      hostMap.set(host, hostNode);
    }
    const parts = getPathParts(url.pathname);
    addResourceToTree(hostNode, parts, { url: resourceUrl, contentSize: size || 0 });
  });

  const result = Array.from(hostMap.values());
  result.forEach(node => sortTreeNodes(node));
  return truncate ? limitTreeDepth(result, 0, 3) : result;
}

/** 从 URL 提取主域名（host[:port]），解析失败返回 null */
function getPrimaryHost(raw?: string): string | null {
  if (!raw) return null;
  try {
    const u = new URL(raw);
    return u.port ? `${u.hostname}:${u.port}` : u.hostname;
  } catch {
    return null;
  }
}

/**
 * 判断资源域名是否值得保留：
 * - 命中共享黑名单（@/utils/domains，唯一维护入口）则过滤；
 * - 强制保留 preview-sandbox 与本地开发域名（含不同端口，本地前后端常分端口）；
 * - 保留与页面主域同可注册主域的域名；其余第三方默认过滤。
 * 导出仅供单测覆盖主域判定（本模块自身只在文件内调用）。
 */
export function isUsefulHost(host: string, primaryHost: string | null): boolean {
  if (isBlockedHost(host)) return false;

  const lower = host.toLowerCase();
  // 强制保留 preview-sandbox 与本地开发
  if (lower.includes('preview-sandbox')) return true;
  if (isLocalDevHost(lower)) return true;

  // 保留与主域相同的主域（多级公共后缀交给共享 getRegistrableDomain，
  // 旧版 slice(-2) 会把 example.co.uk 判成 co.uk，从而放行任意 *.co.uk 第三方）
  if (primaryHost) {
    const primaryBase = getRegistrableDomain(primaryHost);
    const hostBase = getRegistrableDomain(host);
    // 非空判定不可省：主域退化时（如畸形帧 URL）两个空串相等会把所有第三方放行
    if (primaryBase && hostBase && primaryBase === hostBase) return true;
  }

  // 默认过滤掉第三方
  return false;
}

/** 本地开发主机：localhost / 环回 / *.local；端口不参与判定 */
function isLocalDevHost(host: string): boolean {
  const bare = host.replace(/:\d+$/, '');
  return bare === 'localhost' || bare.endsWith('.localhost')
    || bare === '127.0.0.1' || bare === '[::1]' || bare === '::1'
    || bare.endsWith('.local');
}

/** 安全解析 URL，仅接受 http/https 协议 */
function safeParseUrl(raw?: string): URL | null {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (!/^https?:/i.test(url.protocol)) return null;
    return url;
  } catch {
    return null;
  }
}

/** 将 URL pathname 拆为路径段；根路径/目录路径补 index.html */
function getPathParts(pathname: string): string[] {
  if (!pathname || pathname === '/') return ['index.html'];
  const clean = pathname.startsWith('/') ? pathname.slice(1) : pathname;
  const parts = clean.split('/').filter(Boolean);
  if (pathname.endsWith('/')) parts.push('index.html');
  return parts.length ? parts : ['index.html'];
}

/**
 * 递归排序树节点：目录在前、文件在后，同类按名称字母序。
 */
function sortTreeNodes(node: SourceTreeNode): void {
  if (!node.children || node.children.length === 0) return;

  node.children.sort((a, b) => {
    if (a.type !== b.type) {
      return a.type === 'directory' ? -1 : 1;
    }
    return a.name.localeCompare(b.name);
  });

  node.children.forEach(child => {
    if (child.type === 'directory') {
      sortTreeNodes(child);
    }
  });
}

/**
 * 发送 debugger 命令（Promise 化封装，lastError 转 reject）。
 */
function sendDebuggerCommand(tabId: number, method: string, params?: any): Promise<any> {
  return new Promise((resolve, reject) => {
    chrome.debugger.sendCommand({ tabId }, method, params, (result) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve(result);
      }
    });
  });
}

/**
 * 将资源添加到树中（支持深层路径）。
 * 修复说明：原实现 filePath/dirPath 的三元两分支完全相同
 * （parent.path === parent.name ? A : A），属重构残留；
 * 两分支语义一致，统一为 parent.path + '/' + name，行为不变。
 */
function addResourceToTree(
  parent: SourceTreeNode,
  pathParts: string[],
  resource: any
): void {
  if (pathParts.length === 0) return;

  const [first, ...rest] = pathParts;
  if (!parent.children) parent.children = [];

  if (rest.length === 0) {
    // 这是文件
    const existing = parent.children.find(c => c.name === first && c.type === 'file');
    if (!existing) {
      parent.children.push({
        name: first,
        path: parent.path + '/' + first,
        type: 'file',
        url: resource.url,
        size: resource.contentSize || resource.size || 0
      });
    }
  } else {
    // 这是目录
    let dirNode = parent.children.find(c => c.name === first && c.type === 'directory');
    if (!dirNode) {
      dirNode = {
        name: first,
        path: parent.path + '/' + first,
        type: 'directory',
        children: []
      };
      parent.children.push(dirNode);
    }
    addResourceToTree(dirNode, rest, resource);
  }
}

/**
 * 获取目录下的所有文件（递归）。
 * 注意：必须在 limitTreeDepth 截断之前对完整树调用，
 * 否则 >3 层的文件会从清单中静默丢失。
 */
export function getAllFilesInDirectory(node: SourceTreeNode): SourceTreeNode[] {
  const files: SourceTreeNode[] = [];

  if (node.type === 'file') {
    files.push(node);
  } else if (node.children) {
    for (const child of node.children) {
      files.push(...getAllFilesInDirectory(child));
    }
  }

  return files;
}

/**
 * 限制目录树深度（仅用于展示层截断）。
 * @param nodes 待截断的节点数组
 * @param currentDepth 当前层级（顶层传 0）
 * @param maxDepth 最大保留层级数
 */
export function limitTreeDepth(nodes: SourceTreeNode[], currentDepth: number, maxDepth: number = 3): SourceTreeNode[] {
  if (currentDepth >= maxDepth) {
    return nodes.map(node => ({
      ...node,
      children: undefined
    }));
  }

  return nodes.map(node => {
    if (node.type === 'directory' && node.children) {
      return {
        ...node,
        children: limitTreeDepth(node.children, currentDepth + 1, maxDepth)
      };
    }
    return node;
  });
}
