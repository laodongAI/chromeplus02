import { getActiveTabId } from '../utils/chromeMessaging';
// P1-8：分级日志（扩展页面上下文默认 info 级）
import { createLogger } from '@/utils/logger';

/** 本模块 logger：保留原 `[persist]` 前缀语义 */
const log = createLogger('persist');

interface PersistPayload {
  processed?: string[];
  downloaded?: string[];
  selections?: { image?: string[]; audio?: string[]; video?: number[] };
  filters?: {
    image?: { minWidth?: number; minHeight?: number; kind?: string; frameInterval?: number };
    audio?: { minDuration?: number; minSize?: number };
    video?: { frameInterval?: number; minWidth?: number; minHeight?: number; minDuration?: number };
  };
}

/** 持久化状态键的统一前缀（清理/淘汰时按前缀识别，避免误删其他功能的数据） */
const KEY_PREFIX = 'sp_state:';
/** LRU 索引键：记录每个状态键的最后使用时间戳（毫秒） */
const LRU_INDEX_KEY = 'sp_state_lru';
/** 最多保留多少个 tab 的持久化状态；超出按最后使用时间淘汰最旧的（P2-4 容量上限兜底） */
const MAX_PERSISTED_TABS = 40;

/** 构造某 tab 在某 origin 下的状态键；键以 :<tabId> 结尾，便于关闭回收时按后缀匹配 */
function buildKey(tabId: number, origin: string){ return `${KEY_PREFIX}${origin}:${tabId}`; }

/** 包装 chrome.storage.local.get 为 Promise（沿用本模块既有的回调风格） */
function storageGet(keys: string | string[] | null): Promise<Record<string, any>> {
  return new Promise(resolve => { try { chrome.storage.local.get(keys, res => resolve(res || {})); } catch { resolve({}); } });
}
/** 包装 chrome.storage.local.set 为 Promise */
function storageSet(obj: Record<string, any>): Promise<void> {
  return new Promise(resolve => { try { chrome.storage.local.set(obj, () => resolve()); } catch { resolve(); } });
}
/** 包装 chrome.storage.local.remove 为 Promise */
function storageRemove(keys: string[]): Promise<void> {
  return new Promise(resolve => { try { chrome.storage.local.remove(keys, () => resolve()); } catch { resolve(); } });
}

/**
 * 登记键的最后使用时间，并按容量上限执行 LRU 淘汰（P2-4）。
 * 淘汰时会同步删除被逐出键的 storage 数据与索引项，防止状态残留长期累积。
 * @param key 刚被读写的状态键
 */
async function touchLru(key: string) {
  const idx = await storageGet(LRU_INDEX_KEY);
  const map: Record<string, number> = idx[LRU_INDEX_KEY] || {};
  map[key] = Date.now();
  const keys = Object.keys(map);
  const stale: string[] = [];
  if (keys.length > MAX_PERSISTED_TABS) {
    // 按最后使用时间升序，淘汰超额的最旧条目
    const evictCount = keys.length - MAX_PERSISTED_TABS;
    const evicted = keys.sort((a, b) => map[a] - map[b]).slice(0, evictCount);
    for (const k of evicted) { delete map[k]; stale.push(k); }
    log.info(`LRU 淘汰 ${evicted.length} 个超量状态键（上限 ${MAX_PERSISTED_TABS}）`);
  }
  await storageSet({ [LRU_INDEX_KEY]: map });
  if (stale.length) await storageRemove(stale);
}

/** tab 关闭监听是否已注册（模块级幂等守卫，避免面板反复导入导致重复注册） */
let tabCleanupRegistered = false;

/**
 * 注册"标签页关闭即回收其持久化状态"的监听（P2-4）。
 * 侧栏存活期间，tab 关闭后其 sp_state:<origin>:<tabId> 键立即删除；
 * 侧栏未存活时错过的回收由 touchLru 的容量上限兜底。
 * 注意：persist.ts 会在侧栏页面加载时被面板导入，从而完成注册；
 * 单用户本地部署下该监听随侧栏页面存活，成本可忽略。
 */
function registerTabCleanup() {
  if (tabCleanupRegistered) return;
  if (typeof chrome === 'undefined' || !chrome?.tabs?.onRemoved?.addListener) return;
  tabCleanupRegistered = true;
  chrome.tabs.onRemoved.addListener(async (tabId: number) => {
    try {
      const all = await storageGet(null);
      const stale: string[] = [];
      for (const k of Object.keys(all)) {
        // 仅回收本模块前缀且以 :<tabId> 结尾的键；前导冒号避免 15 误配 5 之类的后缀误判
        if (k.startsWith(KEY_PREFIX) && k.endsWith(`:${tabId}`)) stale.push(k);
      }
      if (!stale.length) return;
      const idx = await storageGet(LRU_INDEX_KEY);
      const map: Record<string, number> = idx[LRU_INDEX_KEY] || {};
      stale.forEach(k => delete map[k]);
      await storageRemove(stale);
      await storageSet({ [LRU_INDEX_KEY]: map });
      log.info(`标签页 ${tabId} 已关闭：回收 ${stale.length} 个持久化状态键`);
    } catch { /* 回收失败不影响主流程，等待 LRU 兜底 */ }
  });
}
registerTabCleanup();

/** 读取当前活动 tab 的持久化状态（无数据时返回空对象，行为与旧版一致） */
export async function loadState(): Promise<PersistPayload> {
  try {
    const tabId = await getActiveTabId();
    if(!tabId) return {};
    const tabs = await chrome.tabs.query({ active:true, currentWindow:true });
    const origin = tabs[0]?.url ? safeOrigin(tabs[0].url) : 'unknown';
    const key = buildKey(tabId, origin);
    const res = await storageGet(key);
    // 读取也视为"使用"，刷新 LRU 时间戳，保证活跃 tab 不被淘汰
    void touchLru(key);
    return (res[key] as PersistPayload) || {};
  } catch { return {}; }
}

/** 保存当前活动 tab 的持久化状态（与旧值合并，避免覆盖其它面板数据） */
export async function saveState(data: PersistPayload) {
  try {
    const tabId = await getActiveTabId();
    if(!tabId) return;
    const tabs = await chrome.tabs.query({ active:true, currentWindow:true });
    const origin = tabs[0]?.url ? safeOrigin(tabs[0].url) : 'unknown';
    const key = buildKey(tabId, origin);
    // 读取旧值合并，避免覆盖其它面板数据
    const existing = (await storageGet(key))[key] as PersistPayload || {};
    const merged: PersistPayload = {
      processed: data.processed ?? existing.processed,
      downloaded: data.downloaded ?? existing.downloaded,
      selections: { ...(existing.selections||{}), ...(data.selections||{}) },
      filters: { ...(existing.filters||{}), ...(data.filters||{}) }
    };
    await storageSet({ [key]: merged });
    // 写入后登记 LRU，超量时淘汰最旧的 tab 状态（P2-4）
    await touchLru(key);
  } catch { /* noop */ }
}

/** 提取并净化 URL 的 origin，保证可安全用作 storage 键片段 */
function safeOrigin(u: string){ try { const url = new URL(u); return url.origin.replace(/[^a-zA-Z0-9:/._-]/g,''); } catch { return 'unknown'; } }
