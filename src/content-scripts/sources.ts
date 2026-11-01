/**
 * 扫描页面资源文件（用于Sources下载功能）
 */

export interface SourceFile {
  url: string;
  path: string; // 相对路径，用于保持目录结构
  type?: string;
  size?: number;
}

/**
 * 扫描页面中的所有资源文件
 * 包括从performance API获取的所有资源
 */
export function scanPageSources(): SourceFile[] {
  const files: SourceFile[] = [];
  const seen = new Set<string>();
  
  // 黑名单域名（过滤无用的第三方资源）
  const blacklistDomains = [
    'google.com', 'gstatic.com', 'doubleclick.net', 'google-analytics.com',
    'googletagmanager.com', 'facebook.net', 'facebook.com',
    'bing.com', 'clarity.ms', 'cloudflare.com',
    'stripe.com', 'licdn.com', 'redditstatic.com',
    'adswizz.com', 'goentri.com'
  ];
  
  const shouldFilter = (url: string): boolean => {
    try {
      const urlObj = new URL(url);
      const host = urlObj.hostname.toLowerCase();
      // 过滤黑名单域名
      if (blacklistDomains.some(domain => host.includes(domain))) {
        return true;
      }
      // 只保留localhost和当前域名
      if (host !== 'localhost' && host !== '127.0.0.1' && host !== window.location.hostname) {
        return true;
      }
      return false;
    } catch {
      return true;
    }
  };

  // 1. 从performance API获取所有资源
  try {
    const resources = performance.getEntriesByType('resource') as PerformanceResourceTiming[];
    resources.forEach(resource => {
      const url = resource.name;
      if (url && !seen.has(url) && !shouldFilter(url)) {
        seen.add(url);
        const path = extractPath(url);
        files.push({
          url,
          path: path || extractFileName(url),
          type: resource.initiatorType,
          size: resource.transferSize || resource.encodedBodySize || 0
        });
      }
    });
  } catch (e) {
    console.warn('[sources] Failed to get performance resources:', e);
  }

  // 2. 扫描所有script标签
  document.querySelectorAll('script[src]').forEach(script => {
    const src = (script as HTMLScriptElement).src;
    if (src && !seen.has(src) && !shouldFilter(src)) {
      seen.add(src);
      const path = extractPath(src);
      files.push({
        url: src,
        path: path || 'scripts/' + extractFileName(src),
        type: 'script'
      });
    }
  });

  // 3. 扫描所有link标签（CSS等）
  document.querySelectorAll('link[href]').forEach(link => {
    const href = (link as HTMLLinkElement).href;
    if (href && !seen.has(href) && !shouldFilter(href)) {
      seen.add(href);
      const path = extractPath(href);
      files.push({
        url: href,
        path: path || 'styles/' + extractFileName(href),
        type: 'stylesheet'
      });
    }
  });

  return files;
}

/**
 * 从URL中提取路径
 */
function extractPath(url: string): string {
  try {
    const urlObj = new URL(url);
    let path = urlObj.pathname;
    
    // 移除查询参数和hash
    if (path.includes('?')) path = path.split('?')[0];
    if (path.includes('#')) path = path.split('#')[0];
    
    // 移除开头的斜杠
    if (path.startsWith('/')) path = path.slice(1);
    
    // 如果路径为空，使用域名作为目录
    if (!path || path === '/') {
      const host = urlObj.hostname.replace(/^www\./, '');
      return `${host}/index.html`;
    }
    
    return path;
  } catch {
    return '';
  }
}

/**
 * 从URL中提取文件名
 */
function extractFileName(url: string): string {
  try {
    const urlObj = new URL(url);
    const pathname = urlObj.pathname;
    const fileName = pathname.split('/').pop() || 'file';
    return fileName;
  } catch {
    const parts = url.split('/');
    return parts[parts.length - 1] || 'file';
  }
}
