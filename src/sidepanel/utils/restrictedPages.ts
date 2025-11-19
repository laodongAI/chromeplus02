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

const RULES: RestrictedRule[] = [
  {
    test: (url) => /^chrome:\/\//i.test(url) || /^edge:\/\//i.test(url) || /^brave:\/\//i.test(url) || /^opera:\/\//i.test(url),
    message: '该标签页属于浏览器内部页面（如 chrome:// 或 edge://），Chrome 扩展无法在此注入内容脚本。'
  },
  {
    test: (url) => url.startsWith('chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai'),
    message: '该页面是 Chrome PDF 查看器，无法注入内容脚本。'
  },
  {
    test: (url) => url.startsWith('chrome-extension://') && !url.includes('sidepanel.html'),
    message: '正在查看其它扩展页面，Chrome 不允许注入到 chrome-extension:// 页面。'
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
      return `${rule.message} 请切换到普通网页后再试。`;
    }
  }
  return null;
}

export function isRestrictedPage(url?: string | null): boolean {
  return getRestrictedPageMessage(url) != null;
}
