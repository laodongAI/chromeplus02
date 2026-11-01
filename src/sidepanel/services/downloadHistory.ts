
const STORAGE_KEY = 'global_download_history_v2';
const LEGACY_STORAGE_KEY = 'global_download_history';

export interface HistoryItem {
  id: string;
  url: string;
  filename?: string;
  kind: 'video' | 'image' | 'audio' | 'other';
  status: 'success' | 'failed';
  error?: string;
  timestamp: number;
  size?: number;
}

// 使用 Set 存储已下载的 URL 哈希或 URL 本身 (用于快速去重判断)
const historySet = new Set<string>();
// 存储完整历史记录
const historyList: HistoryItem[] = [];

let loaded = false;

export async function loadHistory() {
  if (loaded) return;
  try {
    const res = await chrome.storage.local.get([STORAGE_KEY, LEGACY_STORAGE_KEY]);
    
    // 加载新版历史
    const list = res[STORAGE_KEY];
    if (Array.isArray(list)) {
      list.forEach((item: HistoryItem) => {
        historyList.push(item);
        if (item.status === 'success') {
          historySet.add(item.url);
        }
      });
    }

    // 迁移旧版历史 (如果存在且未迁移)
    const legacyList = res[LEGACY_STORAGE_KEY];
    if (Array.isArray(legacyList) && legacyList.length > 0) {
      let migratedCount = 0;
      legacyList.forEach((url: string) => {
        if (!historySet.has(url)) {
          historySet.add(url);
          // 创建一个模拟的历史记录
          historyList.push({
            id: `legacy-${Date.now()}-${Math.random()}`,
            url,
            kind: 'other',
            status: 'success',
            timestamp: Date.now()
          });
          migratedCount++;
        }
      });
      if (migratedCount > 0) {
        await saveHistory();
        // 可选：清除旧数据
        // await chrome.storage.local.remove(LEGACY_STORAGE_KEY);
      }
    }

    loaded = true;
  } catch (e) {
    console.warn('Failed to load download history', e);
  }
}

export function getHistoryList(): HistoryItem[] {
  return historyList;
}

export function isDownloaded(url?: string): boolean {
  if (!url) return false;
  return historySet.has(url);
}

export async function addHistoryRecord(item: Omit<HistoryItem, 'timestamp'> & { timestamp?: number }) {
  const record: HistoryItem = {
    ...item,
    timestamp: item.timestamp || Date.now()
  };
  
  // 避免重复添加相同ID的记录
  const idx = historyList.findIndex(i => i.id === record.id);
  if (idx >= 0) {
    historyList[idx] = record;
  } else {
    historyList.unshift(record); // 新的在前
  }

  if (record.status === 'success') {
    historySet.add(record.url);
  }

  await saveHistory();
}

/**
 * @deprecated Use addHistoryRecord instead
 */
export async function markDownloaded(url?: string) {
  if (!url) return;
  if (historySet.has(url)) return;
  
  // 兼容旧调用，默认作为 'other' 类型成功记录
  await addHistoryRecord({
    id: `manual-${Date.now()}`,
    url,
    kind: 'other',
    status: 'success'
  });
}

async function saveHistory() {
  try {
    // 限制历史记录数量，例如最近 1000 条
    if (historyList.length > 1000) {
      historyList.length = 1000;
    }
    await chrome.storage.local.set({ [STORAGE_KEY]: historyList });
  } catch (e) {
    console.warn('Failed to save download history', e);
  }
}

export async function clearHistory() {
  historySet.clear();
  historyList.length = 0;
  await saveHistory();
  await chrome.storage.local.remove(LEGACY_STORAGE_KEY);
}

export function getHistoryCount(): number {
  return historyList.length;
}
