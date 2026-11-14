// P1-8：分级日志（扩展页面上下文默认 info 级）
import { createLogger } from '@/utils/logger';

/** 本模块 logger：无原前缀，按模块名新建 */
const log = createLogger('downloadHistory');

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

// ===== 写入节流（P1-2）=====
/**
 * 背景：旧实现每条历史记录都全量 storage.local.set 写 1000 条数组，
 * 队列高频事件下产生大量重复写。
 * 策略：
 *  1) 同 ID 且内容等价（状态/错误/大小/文件名/类型/URL 相同）的记录直接跳过 → 不触发写；
 *  2) 真实变更才进入防抖窗口，窗口内的多次变更合并为一次全量写；
 *  3) 页面隐藏/卸载时立即冲刷，避免防抖窗口内的最后一批记录丢失。
 * 存储格式保持 global_download_history_v2 单键数组不变，旧数据可直接读取、无需迁移。
 */
const SAVE_DEBOUNCE_MS = 600;
/** 防抖写定时器句柄（null 表示当前没有待执行的写入） */
let saveTimer: ReturnType<typeof setTimeout> | null = null;

/** 判断两条历史记录是否内容等价（等价则无需重复写 storage） */
function sameRecord(a: HistoryItem, b: HistoryItem): boolean {
  return a.status === b.status && a.error === b.error && a.size === b.size
    && a.filename === b.filename && a.kind === b.kind && a.url === b.url;
}

/** 安排一次防抖写入（已有待执行写入时不重复安排） */
function scheduleSave(): void {
  if (saveTimer !== null) return;
  saveTimer = setTimeout(() => { saveTimer = null; void saveHistory(); }, SAVE_DEBOUNCE_MS);
}

/** 立即冲刷待写入的历史（页面隐藏/卸载时调用，防止防抖窗口内数据丢失） */
export function flushHistorySave(): Promise<void> {
  if (saveTimer !== null) { clearTimeout(saveTimer); saveTimer = null; }
  return saveHistory();
}

// 侧边栏页面卸载前冲刷未落盘的历史；node 测试环境无 window 时跳过
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => { void flushHistorySave(); });
}

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
    log.warn('Failed to load download history', e);
  }
}

export function getHistoryList(): HistoryItem[] {
  return historyList;
}

export function isDownloaded(url?: string): boolean {
  if (!url) return false;
  return historySet.has(url);
}

/**
 * 写入/更新一条下载历史记录。
 * 去抖与去重（P1-2）：
 *  - 同 ID 且内容等价 → 直接返回，不触发任何写入（快照可能重复推送同一终态）；
 *  - 同 ID 内容变化（如重试后再次失败）→ 原地更新字段并保留首次时间戳，进入防抖写入；
 *  - 新记录 → 插入队首，进入防抖写入。
 */
export async function addHistoryRecord(item: Omit<HistoryItem, 'timestamp'> & { timestamp?: number }): Promise<void> {
  const record: HistoryItem = {
    ...item,
    timestamp: item.timestamp || Date.now()
  };

  // 避免重复添加相同ID的记录
  const idx = historyList.findIndex(i => i.id === record.id);
  if (idx >= 0) {
    // 内容完全等价则跳过：这是消除"每次快照都全量写 1000 条"噪音的关键去重点
    if (sameRecord(historyList[idx], record)) return;
    // 内容有变化：保留原时间戳（同一任务的首次落定时间），仅更新业务字段
    historyList[idx] = { ...record, timestamp: historyList[idx].timestamp };
  } else {
    historyList.unshift(record); // 新的在前
  }

  if (record.status === 'success') {
    historySet.add(record.url);
  }

  // 防抖合并写入：窗口内的多次变更只产生一次 storage.local.set
  scheduleSave();
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
    log.warn('Failed to save download history', e);
  }
}

export async function clearHistory() {
  historySet.clear();
  historyList.length = 0;
  // 清空是用户显式操作：取消在途防抖并立即落盘，保证后续读取一致
  await flushHistorySave();
  await chrome.storage.local.remove(LEGACY_STORAGE_KEY);
}

export function getHistoryCount(): number {
  return historyList.length;
}
