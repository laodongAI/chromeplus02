// P1-8：分级日志（扩展页面上下文默认 info 级）
import { createLogger } from '@/utils/logger';
// 下载台账：类型与终态语义复用 core 纯函数层，避免队列/历史两套字符串各自演化
import { normalizeKind, isSameSource, type DownloadKind, type HistoryStatus } from '@/core/downloadTaxonomy';
import { STORE_HLS_BLOBS, idbDelete } from '@/shared/blobStore';

/** 本模块 logger：无原前缀，按模块名新建 */
const log = createLogger('downloadHistory');

const STORAGE_KEY = 'global_download_history_v2';
const LEGACY_STORAGE_KEY = 'global_download_history';

export interface HistoryItem {
  id: string;
  url: string;
  filename?: string;
  kind: DownloadKind;
  /**
   * 终态。canceled 是台账扩展后新增的一档（需求2）：
   * 用户主动取消的任务此前完全不入档，历史里看不到、也就无从重试。
   */
  status: HistoryStatus;
  error?: string;
  timestamp: number;
  size?: number;
  /** 来源页：让「这条是哪个页面下的」在任务已被队列清理后仍可回答 */
  sourceUrl?: string;
  sourceTitle?: string;
  sourceTabId?: number;
  /** 本地产物 blob 键（engine=local 的记录）；删除记录时按它回收 IDB 空间 */
  idbKey?: string;
  /** 来源方式，徽标展示用（直链 / HLS / 本地产物） */
  engine?: 'direct' | 'hls' | 'local';
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
    && a.filename === b.filename && a.kind === b.kind && a.url === b.url
    // 台账扩展字段一并比对：来源页/产物键变了就是不同记录，不能当作重复丢弃
    && a.sourceUrl === b.sourceUrl && a.sourceTitle === b.sourceTitle
    && a.idbKey === b.idbKey && a.engine === b.engine;
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
        // 读入即归一类型：历史是跨版本累积的存储，旧值/异常值落到 'other'，
        // 分类筛选下拉里就不会出现选不到也看不见的记录
        const normalized: HistoryItem = { ...item, kind: normalizeKind(item.kind) };
        historyList.push(normalized);
        if (normalized.status === 'success') {
          historySet.add(normalized.url);
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
    // 类型归一：旧版本/其它入口可能给出六档之外的值，落到 'other' 而不是让分类查询漏掉它
    kind: normalizeKind(item.kind),
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

  // 「已下载」集合要跟着终态走：重试后失败/取消的记录必须把 URL 撤出来，
  // 否则 isDownloaded 会一直回答"已下载"，各面板的下载按钮就永久变成已下载态
  if (record.status === 'success') historySet.add(record.url);
  else historySet.delete(record.url);

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

/**
 * 删除若干条下载历史记录。
 *
 * 与 clearHistory 的关键区别：这里是「用户逐条/批量删除」，
 * 明确可以选择连带删除产物本体（IDB 里的 blob）。默认 **不删**，
 * 因为「清掉记录」和「删掉我下载的东西」是两个动作，误删不可恢复。
 * 需要连带删除时传 deleteArtifacts=true，只处理带 idbKey 的本地产物；
 * 已落到磁盘的浏览器下载文件不在此列（由调用方按 chrome.downloads 单独处理）。
 *
 * @param ids 待删除的记录 id 列表
 * @param options.deleteArtifacts 是否连带删除 IDB 中的本地产物 blob
 * @returns 实际删除的记录数
 */
export async function deleteHistoryRecords(
  ids: string[],
  options: { deleteArtifacts?: boolean } = {}
): Promise<number> {
  const idSet = new Set(ids.filter(Boolean));
  if (!idSet.size) return 0;
  const removed = historyList.filter(i => idSet.has(i.id));
  if (!removed.length) return 0;

  for (let i = historyList.length - 1; i >= 0; i--) {
    if (idSet.has(historyList[i].id)) historyList.splice(i, 1);
  }
  // 「是否已下载」集合要按剩余记录重建：同一 URL 可能有多条记录（重试），
  // 只有全部不再 success 才算未下载；简单 clear 会把仍可判为已下载的 URL 误撤
  for (const item of removed) {
    if (item.status !== 'success') continue;
    const stillDownloaded = historyList.some(i => i.url === item.url && i.status === 'success');
    if (!stillDownloaded) historySet.delete(item.url);
  }

  if (options.deleteArtifacts) {
    const keys = [...new Set(removed.map(i => i.idbKey).filter((k): k is string => !!k))];
    await Promise.all(keys.map(k => idbDelete(STORE_HLS_BLOBS, k).catch(e => log.warn('删除本地产物失败', k, e))));
  }

  // 删除是用户显式操作：立即落盘，避免刷新后记录又回来了
  await flushHistorySave();
  return removed.length;
}

/** 按来源页取历史记录（下载界面「本页相关」视图用） */
export function getHistoryBySource(pageUrl: string | undefined | null): HistoryItem[] {
  if (!pageUrl) return [];
  return historyList.filter(i => isSameSource(i.sourceUrl, pageUrl));
}

export function getHistoryCount(): number {
  return historyList.length;
}
