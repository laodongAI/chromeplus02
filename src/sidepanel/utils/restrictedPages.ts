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
    test: (url) => /chromewebstore\.google\.(com|cn)/i.test(url) || url.startsWith('https://chrome.google.com/webstore'),
    message: 'Chrome 网上应用店页面禁止扩展注入内容脚本。'
  },
  {
    test: (url) => url.startsWith('https://chromewebstore.google.com'),
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
