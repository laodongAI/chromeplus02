/**
 * 当前页面来源跟踪（下载台账 · 需求4）。
 *
 * 为什么单独一个模块：下载台账要回答两个问题——
 *  1. 「这条下载是在哪个页面发起的」→ 入队时把 url/title/tabId 写进任务；
 *  2. 「现在这个页面有哪些任务在下」→ 界面需要一个会随标签页切换而更新的当前页，
 *     点「只看本页」时不必再异步查一次 tab。
 * 各抓取面板此前各自 query 活动 tab（AudioGrab/ImageGrab/VideoCapture 都有一份），
 * 但下载服务拿不到，所以这里做一份共享的、可响应的当前页状态。
 *
 * 语义边界：只跟踪「当前窗口的活动普通网页 tab」。受限页（chrome:// 等）拿不到 url，
 * 此时 pageSource.url 为 undefined，界面把「只看本页」置灰而不是假装匹配到全部。
 */
import { computed, ref } from 'vue';
import { getActiveTabInfo } from '../utils/chromeMessaging';
import { isRestrictedPage } from '../../utils/restrictedPages';
import { createLogger } from '@/utils/logger';

const log = createLogger('pageSource');

export interface PageSourceInfo {
  tabId?: number;
  url?: string;
  title?: string;
}

/** 当前页地址（已确认是可比对的 http(s) 页面；受限页/取不到时为 undefined） */
const url = ref<string | undefined>(undefined);
/** 当前页标题，供台账列表显示「来自：xxx」 */
const title = ref<string | undefined>(undefined);
/** 当前页 tabId */
const tabId = ref<number | undefined>(undefined);

let listenersInstalled = false;
/** 正在进行中的刷新，避免 tab 切换事件风暴时并发查询 */
let refreshing: Promise<void> | null = null;

/**
 * 把 chrome.tabs.Tab 形态收敛成台账用的来源三元组。
 * @param raw chrome.tabs.query / onActivated 回查拿到的 tab
 */
function readTab(raw: { id?: number; url?: string; pendingUrl?: string; title?: string } | null | undefined): PageSourceInfo {
  const candidate = raw?.url || raw?.pendingUrl || '';
  // 受限页 URL 空或不可比对：保留上一次的来源反而更糟（会把上个页面的任务算到本页），
  // 所以直接判为「无来源」，由界面禁用本页筛选
  const usable = !!candidate && /^https?:/i.test(candidate) && !isRestrictedPage(candidate);
  return {
    tabId: raw?.id,
    url: usable ? candidate : undefined,
    title: usable ? (raw?.title || undefined) : undefined,
  };
}

/**
 * chrome.tabs 是否可用。
 * 必须用 typeof 判定而不是 `chrome?.tabs`：可选链救不了「标识符根本没声明」，
 * 在 node 单测环境里 `chrome?.tabs` 直接抛 ReferenceError（被 catch 吞掉也会刷警告日志）。
 */
function hasTabsApi(): boolean {
  return typeof chrome !== 'undefined' && !!chrome?.tabs?.query;
}

/** 重新查询活动 tab 并写入状态（并发调用共享同一次查询） */
export function refreshPageSource(): Promise<void> {
  if (refreshing) return refreshing;
  if (!hasTabsApi()) return Promise.resolve();
  refreshing = (async () => {
    try {
      const info = await getActiveTabInfo();
      if (!info) {
        url.value = undefined; title.value = undefined; tabId.value = undefined;
        return;
      }
      // getActiveTabInfo 不带 title，这里补一次 tabs.get；失败则退化为无标题
      let full: chrome.tabs.Tab | null = null;
      if (info.id != null && chrome?.tabs?.get) {
        await new Promise<void>((resolve) => {
          try { chrome.tabs.get(info.id as number, (t) => { void chrome.runtime.lastError; full = t || null; resolve(); }); }
          catch { resolve(); }
        });
      }
      const next = readTab(full || { id: info.id ?? undefined, url: info.url ?? undefined, pendingUrl: info.pendingUrl ?? undefined });
      url.value = next.url;
      title.value = next.title;
      tabId.value = next.tabId;
    } catch (e) {
      log.warn('刷新当前页来源失败', e);
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

/**
 * 安装 tab 切换/更新监听（幂等）。
 * 由下载工作区与抓取面板按需调用；监听常驻不移除，
 * 因为侧栏文档本身就是「一次会话」，移除反而会让后台界面停在旧页面。
 */
export function ensurePageSourceTracking(): void {
  void refreshPageSource();
  if (listenersInstalled) return;
  if (!hasTabsApi()) return;
  listenersInstalled = true;
  chrome.tabs.onActivated.addListener(() => { void refreshPageSource(); });
  // SPA 站点用 pushState 换「页面身份」（如视频站的 watch?v=xxx），只靠 onActivated 会漏；
  // status=complete 时再刷一次，保证来源页与用户实际看到的页面一致
  if (chrome.tabs.onUpdated?.addListener) {
    chrome.tabs.onUpdated.addListener((_tabId, changeInfo) => {
      if (changeInfo.status === 'complete' || changeInfo.url) void refreshPageSource();
    });
  }
}

/** 当前页来源（同步读，供点击入队时附带） */
export const pageSource = {
  url,
  title,
  tabId,
};

// 模块装载即查一次：侧栏一打开来源就是热的，用户第一次点下载不至于落到「无来源」。
// 与 downloadHistory 的 pagehide 监听同属「服务自带最小副作用」的既有写法。
void refreshPageSource();

/** 响应式的当前页来源，界面直接绑定用（切换 tab 会自动更新） */
export const currentPageSource = computed<PageSourceInfo>(() => ({
  url: url.value,
  title: title.value,
  tabId: tabId.value,
}));

/** 拿到一份可直接展开进出队参数的来源字段（无来源时返回空对象，不写入 undefined 噪声字段） */
export function pageSourceFields(): { sourceUrl?: string; sourceTitle?: string; sourceTabId?: number } {
  return url.value
    ? { sourceUrl: url.value, sourceTitle: title.value, sourceTabId: tabId.value }
    : {};
}
