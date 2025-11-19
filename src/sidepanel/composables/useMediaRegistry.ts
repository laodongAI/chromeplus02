import { buildUnifiedMediaKey } from '../utils/mediaKeys';

interface RegistryState {
  processed: Set<string>;
  downloaded: Set<string>;
  initialized: boolean;
}

const state: RegistryState = {
  processed: new Set<string>(),
  downloaded: new Set<string>(),
  initialized: false
};

import { loadState, saveState } from '../services/persist';
let saveTimer: number | null = null;
function scheduleSave(){
  if(saveTimer) clearTimeout(saveTimer);
  saveTimer = window.setTimeout(()=>{
    saveState({ processed: Array.from(state.processed), downloaded: Array.from(state.downloaded) });
  }, 600);
}

export async function initializeRegistry(){
  if(state.initialized) return;
  const data = await loadState();
  if(Array.isArray(data.processed)) data.processed.forEach(k=> state.processed.add(k));
  if(Array.isArray(data.downloaded)) data.downloaded.forEach(k=> state.downloaded.add(k));
  state.initialized = true;
}

export function mediaKey(raw: { url: string; width?: number; height?: number; kind?: string; phash?: string }) {
  return buildUnifiedMediaKey(raw);
}

export function markProcessed(key: string) { state.processed.add(key); scheduleSave(); }
export function markDownloaded(key: string) { state.downloaded.add(key); scheduleSave(); }
export function isProcessed(key: string) { return state.processed.has(key); }
export function isDownloaded(key: string) { return state.downloaded.has(key); }
export function registrySnapshot() { return { processed: new Set(state.processed), downloaded: new Set(state.downloaded) }; }
