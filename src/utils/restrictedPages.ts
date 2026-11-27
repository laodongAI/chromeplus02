const NEW_TAB_URLS = [
  'chrome://newtab/',
  'edge://newtab/',
  'brave://newtab/',
  'opera://startpage/'
];

interface RestrictedRule {
  test: (url: string) => boolean;
  message: string;
}

function selfOrigin(): string {
  try { return chrome.runtime.getURL(''); } catch { return ''; }
}

const RULES: RestrictedRule[] = [
  {
    // 本扩展自身的页面（侧栏入口/编辑器等）：把最常见场景给出行动指引
    test: (url) => {
      const origin = selfOrigin();
      return !!origin && url.startsWith(origin);
    },
    message: '当前标签页是 MediaPlus 自己的页面（如视频编辑器），无法作为分析对象。请切换到要分析的网页标签后重试。'
  },
  {
    test: (url) => /^chrome:\/\//i.test(url) || /^edge:\/\//i.test(url) || /^brave:\/\//i.test(url) || /^opera:\/\//i.test(url),
    message: '该标签页属于浏览器内部页面（如 chrome:// 或 edge://），Chrome 扩展无法在此注入内容脚本。'
  },
  {
    test: (url) => url.startsWith('chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai'),
    message: '该页面是 Chrome PDF 查看器，无法注入内容脚本。'
  },
  {
    test: (url) => url.startsWith('chrome-extension://') || url.startsWith('edge-extension://') || url.startsWith('about:'),
    message: '正在查看扩展内部页面或 about: 页面，Chrome 不允许在此注入内容脚本。'
  },
  {
    // 网上应用店规则去重（P2-5）：正则已同时覆盖 chromewebstore.google.com/.cn
    // 与旧版 chrome.google.com/webstore，删除了下方完全重复的第 6 条规则。
    test: (url) => /chromewebstore\.google\.(com|cn)/i.test(url) || url.startsWith('https://chrome.google.com/webstore'),
    message: 'Chrome 网上应用店页面禁止扩展注入内容脚本。'
  },
  {
    test: (url) => url.startsWith('view-source:'),
    message: 'view-source: 页面不允许注入内容脚本。'
  },
  {
    test: (url) => url.startsWith('devtools://'),
    message: '开发者工具 (devtools://) 页面无法注入内容脚本。'
  },
  {
    test: (url) => NEW_TAB_URLS.some((prefix) => url.startsWith(prefix)),
    message: '浏览器新标签页不允许第三方扩展注入内容脚本。'
  }
];

export function getRestrictedPageMessage(url?: string | null): string | null {
  if (!url) return null;
  const normalized = url.trim();
  if (!normalized) return null;
  for (const rule of RULES) {
    if (rule.test(normalized)) {
      // 返回核心原因，不重复拼接行动提示（由 UI 层统一展示）
      return rule.message;
    }
  }
  return null;
}

export function isRestrictedPage(url?: string | null): boolean {
  return getRestrictedPageMessage(url) != null;
}

/**
 * 把后台通道（chrome.debugger / chrome.scripting）在受限页上抛出的原始错误
 * 翻译成可读原因；不匹配则返回 null（调用方保留原始错误）。
 * 之所以在拿到原始错误后再映射：活动标签页的 URL 并非总能拿到（权限/竞态），
 * 预检只能作为第一道防线，这里是兜底。
 * 口径与 mediaSweep 的优雅降级正则一致，统一收敛到本模块维护。
 */
export function friendlyRestrictedError(message?: string | null): string | null {
  if (!message) return null;
  if (/cannot access a (chrome|chrome-extension|edge|brave|opera|about|devtools|view-source)/i.test(message)
    || /cannot be scripted|cannot access/i.test(message)) {
    return '当前标签页是浏览器内部页面或扩展自身页面，无法作为分析对象。请切换到要分析的网页标签后重试。';
  }
  return null;
}
