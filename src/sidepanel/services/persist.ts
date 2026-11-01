import { getActiveTabId } from '../utils/chromeMessaging';

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

function buildKey(tabId: number, origin: string){ return `sp_state:${origin}:${tabId}`; }

export async function loadState(): Promise<PersistPayload> {
  try {
    const tabId = await getActiveTabId();
    if(!tabId) return {};
    const tabs = await chrome.tabs.query({ active:true, currentWindow:true });
    const origin = tabs[0]?.url ? safeOrigin(tabs[0].url) : 'unknown';
    const key = buildKey(tabId, origin);
    return await new Promise<PersistPayload>(resolve => {
      chrome.storage.local.get(key, res => { resolve(res[key] || {}); });
    });
  } catch { return {}; }
}

export async function saveState(data: PersistPayload) {
  try {
    const tabId = await getActiveTabId();
    if(!tabId) return;
    const tabs = await chrome.tabs.query({ active:true, currentWindow:true });
    const origin = tabs[0]?.url ? safeOrigin(tabs[0].url) : 'unknown';
    const key = buildKey(tabId, origin);
    // 读取旧值合并，避免覆盖其它面板数据
    const existing = await new Promise<PersistPayload>(resolve => { chrome.storage.local.get(key, res => resolve(res[key] || {})); });
    const merged: PersistPayload = {
      processed: data.processed ?? existing.processed,
      downloaded: data.downloaded ?? existing.downloaded,
      selections: { ...(existing.selections||{}), ...(data.selections||{}) },
      filters: { ...(existing.filters||{}), ...(data.filters||{}) }
    };
    await new Promise<void>(resolve => { chrome.storage.local.set({ [key]: merged }, ()=> resolve()); });
  } catch { /* noop */ }
}

function safeOrigin(u: string){ try { const url = new URL(u); return url.origin.replace(/[^a-zA-Z0-9:/._-]/g,''); } catch { return 'unknown'; } }
