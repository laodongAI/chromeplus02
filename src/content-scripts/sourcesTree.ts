/**
 * 获取Chrome DevTools Sources面板的目录树结构
 * 通过chrome.debugger API访问
 */

export interface SourceTreeNode {
  name: string;
  path: string;
  type: 'directory' | 'file';
  children?: SourceTreeNode[];
  url?: string;
  size?: number;
}

/**
 * 获取页面的资源目录树及文件内容
 * 一次性获取所有数据，避免重复attach/detach
 */
export async function getSourcesTreeWithContent(tabId: number): Promise<{
  tree: SourceTreeNode[];
  contentMap: Map<string, string | ArrayBuffer>;
}> {
  const contentMap = new Map<string, string | ArrayBuffer>();
  
  try {
    await chrome.debugger.attach({ tabId }, '1.3');
    await sendDebuggerCommand(tabId, 'Page.enable');

    const resourceTree = await sendDebuggerCommand(tabId, 'Page.getResourceTree');
    
    // 构建树结构
    let tree: SourceTreeNode[] = [];
    if (resourceTree && resourceTree.frameTree) {
      tree = buildSourcesTree(resourceTree.frameTree);
    }

    // 一次性获取所有文件内容
    const allFiles = tree.flatMap(node => getAllFilesInDirectory(node));
    
    console.log(`[sourcesTree] Found ${allFiles.length} files to pre-download`);
    
    // 并发获取文件内容
    const CONCURRENT = 5;
    for (let i = 0; i < allFiles.length; i += CONCURRENT) {
      const batch = allFiles.slice(i, i + CONCURRENT);
      await Promise.all(
        batch.map(async (file) => {
          if (!file.url) return;
          try {
            const result = await sendDebuggerCommand(tabId, 'Page.getResourceContent', {
              frameId: resourceTree.frameTree.frame.id,
              url: file.url
            });
            
            if (result && result.content) {
              if (result.base64Encoded) {
                const binaryString = atob(result.content);
                const bytes = new Uint8Array(binaryString.length);
                for (let i = 0; i < binaryString.length; i++) {
                  bytes[i] = binaryString.charCodeAt(i);
                }
                contentMap.set(file.url, bytes.buffer);
              } else {
                contentMap.set(file.url, result.content);
              }
            }
          } catch (e) {
            console.warn(`[sourcesTree] Failed to get content for ${file.url}:`, e);
          }
        })
      );
    }
    
    await chrome.debugger.detach({ tabId });

    return { tree, contentMap };
  } catch (e) {
    console.error('[sourcesTree] Error getting sources tree:', e);
    try {
      await chrome.debugger.detach({ tabId });
    } catch { /* noop */ }
    throw e;
  }
}

/**
 * 构建 Sources 结构：
 * - 直接列出各域名（不显示 page/top）
 * - 自动过滤第三方/无关域名
 * - 递归收集所有 frame 的资源
 */
function buildSourcesTree(frameTree: any): SourceTreeNode[] {
  const primaryHost = getPrimaryHost(frameTree?.frame?.url);
  const hostMap = new Map<string, SourceTreeNode>();

  collectAllResources(frameTree, (resourceUrl: string, size?: number) => {
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
  return limitTreeDepth(result, 0, 3);
}

function collectAllResources(frameTree: any, onResource: (url: string, size?: number) => void) {
  if (Array.isArray(frameTree?.resources)) {
    for (const resource of frameTree.resources) {
      if (resource?.url) onResource(resource.url, resource.contentSize || resource.size || 0);
    }
  }
  if (Array.isArray(frameTree?.childFrames)) {
    for (const child of frameTree.childFrames) {
      collectAllResources(child, onResource);
    }
  }
}

/**
 * 根据URL添加资源到树中
 */
function getPrimaryHost(raw?: string): string | null {
  if (!raw) return null;
  try {
    const u = new URL(raw);
    return u.port ? `${u.hostname}:${u.port}` : u.hostname;
  } catch {
    return null;
  }
}

function isUsefulHost(host: string, primaryHost: string | null): boolean {
  const lower = host.toLowerCase();
  const blocklist = [
    'google.com', 'googleapis.com', 'gstatic.com', 'googletagmanager.com', 'doubleclick.net',
    'googlesyndication.com', 'googleadservices.com', 'facebook.com', 'facebook.net',
    'clarity.ms', 'bing.com', 'twitter.com', 't.co', 'cloudflare.com'
  ];
  if (blocklist.some(d => lower === d || lower.endsWith('.' + d))) return false;

  // 强制保留 preview-sandbox 与本地开发
  if (lower.includes('preview-sandbox')) return true;
  if (lower.startsWith('localhost') || lower.startsWith('127.0.0.1')) return true;

  // 保留与主域相同的主域
  if (primaryHost) {
    const primaryBase = getBaseDomain(primaryHost);
    const hostBase = getBaseDomain(host);
    if (primaryBase && hostBase && primaryBase === hostBase) return true;
  }

  // 默认过滤掉第三方
  return false;
}

function getBaseDomain(host: string): string | null {
  const parts = host.replace(/:\d+$/, '').split('.');
  if (parts.length < 2) return host;
  return parts.slice(-2).join('.');
}

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

function getPathParts(pathname: string): string[] {
  if (!pathname || pathname === '/') return ['index.html'];
  const clean = pathname.startsWith('/') ? pathname.slice(1) : pathname;
  const parts = clean.split('/').filter(Boolean);
  if (pathname.endsWith('/')) parts.push('index.html');
  return parts.length ? parts : ['index.html'];
}


/**
 * 递归排序树节点
 */
function sortTreeNodes(node: SourceTreeNode): void {
  if (!node.children || node.children.length === 0) return;
  
  // 排序：目录在前，文件在后，然后按名称字母序
  node.children.sort((a, b) => {
    if (a.type !== b.type) {
      return a.type === 'directory' ? -1 : 1;
    }
    return a.name.localeCompare(b.name);
  });
  
  // 递归排序子节点
  node.children.forEach(child => {
    if (child.type === 'directory') {
      sortTreeNodes(child);
    }
  });
}

/**
 * 发送debugger命令
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
 * 将资源添加到树中（支持深层路径）
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
      const filePath = parent.path === parent.name ? parent.path + '/' + first : parent.path + '/' + first;
      parent.children.push({
        name: first,
        path: filePath,
        type: 'file',
        url: resource.url,
        size: resource.contentSize || resource.size || 0
      });
    }
  } else {
    // 这是目录
    let dirNode = parent.children.find(c => c.name === first && c.type === 'directory');
    if (!dirNode) {
      const dirPath = parent.path === parent.name ? parent.path + '/' + first : parent.path + '/' + first;
      dirNode = {
        name: first,
        path: dirPath,
        type: 'directory',
        children: []
      };
      parent.children.push(dirNode);
    }
    addResourceToTree(dirNode, rest, resource);
  }
}

/**
 * 获取目录下的所有文件（递归）
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
 * 限制目录树深度为3级
 */
function limitTreeDepth(nodes: SourceTreeNode[], currentDepth: number, maxDepth: number = 3): SourceTreeNode[] {
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

// downloadFileContent 已被 getSourcesTreeWithContent 替代
// 内容在扫描时一次性获取，避免重复 attach/detach
