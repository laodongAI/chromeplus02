/**
 * 收集篮：跨页面资源暂存（chrome.storage.local 持久化，上限 200 条）。
 * 用户在任意页面把视频/音频/图片加入收集篮，之后统一下载/导出。
 */

import { reactive } from 'vue';

const KEY = 'collection_basket_v1';
const MAX_ITEMS = 200;

export interface BasketItem {
  id: string;
  kind: 'video' | 'audio' | 'image';
  url: string;
  title?: string;
  width?: number;
  height?: number;
  pageUrl?: string;
  addedAt: number;
}

export const basketState = reactive<{ list: BasketItem[]; loaded: boolean }>({ list: [], loaded: false });

export async function loadBasket(): Promise<void> {
  try {
    chrome.storage.local.get(KEY, res => {
      const list = res?.[KEY];
      if (Array.isArray(list)) basketState.list = list;
      basketState.loaded = true;
    });
  } catch { basketState.loaded = true; }
}

async function persist(): Promise<void> {
  try { await chrome.storage.local.set({ [KEY]: JSON.parse(JSON.stringify(basketState.list)) }); } catch { /* noop */ }
}

export interface BasketItemInput {
  kind: BasketItem['kind'];
  url: string;
  title?: string;
  width?: number;
  height?: number;
  pageUrl?: string;
}

/** 按URL去重后加入，返回实际新增数量 */
export async function addToBasket(inputs: BasketItemInput[]): Promise<number> {
  const existing = new Set(basketState.list.map(i => i.url));
  const fresh: BasketItem[] = inputs
    .filter(i => i.url && !existing.has(i.url))
    .map(i => ({
      ...i,
      id: `bk_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      addedAt: Date.now()
    }));
  if (!fresh.length) return 0;
  basketState.list.unshift(...fresh);
  if (basketState.list.length > MAX_ITEMS) basketState.list.length = MAX_ITEMS;
  await persist();
  return fresh.length;
}

export async function removeFromBasket(id: string): Promise<void> {
  const idx = basketState.list.findIndex(i => i.id === id);
  if (idx >= 0) {
    basketState.list.splice(idx, 1);
    await persist();
  }
}

export async function clearBasket(): Promise<void> {
  basketState.list = [];
  await persist();
}

/** 存储变化订阅（多上下文同步；面板挂载时调用一次） */
export function subscribeBasket(listener: (items: BasketItem[]) => void): () => void {
  void loadBasket();
  const handler = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
    if (area === 'local' && changes[KEY]) {
      const list = changes[KEY].newValue;
      if (Array.isArray(list)) {
        basketState.list = list;
        listener(list);
      }
    }
  };
  try { chrome.storage.onChanged.addListener(handler); } catch { /* noop */ }
  return () => {
    try { chrome.storage.onChanged.removeListener(handler); } catch { /* noop */ }
  };
}

/** 批量按 URL 更新标题（AI 补全），返回更新条数 */
export async function updateBasketTitlesByUrl(map: Record<string, string>): Promise<number> {
  let n = 0;
  for (const item of basketState.list) {
    const t = map[item.url];
    if (t && t !== item.title) { item.title = t; n++; }
  }
  if (n > 0) await persist();
  return n;
}
