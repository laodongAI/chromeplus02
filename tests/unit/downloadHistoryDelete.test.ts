/**
 * 下载历史台账单测（下载台账 · 需求1/2/3 的存储侧）。
 * 覆盖：类型归一入档、失败/取消把 URL 从「已下载」集合撤出、
 * 按 id 删除记录（含同 URL 多条记录时集合重建）、批量删除返回真实条数。
 * 手法：chrome.storage 最小桩 + vi.mock 掉 IDB 交接（删除产物本体的路径不在此验证）。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const idbDelete = vi.fn(() => Promise.resolve());
vi.mock('@/shared/blobStore', () => ({
  STORE_HLS_BLOBS: 'hls-blobs',
  idbDelete: (store: string, key: string) => idbDelete(store, key),
}));

/** storage 桩里的原始数组，用于断言「确实落盘了」 */
let stored: Record<string, unknown> = {};

async function boot() {
  vi.resetModules();
  stored = {};
  vi.stubGlobal('chrome', {
    storage: {
      local: {
        get: (keys: string[]) => Promise.resolve(
          Object.fromEntries(keys.filter(k => k in stored).map(k => [k, stored[k]]))
        ),
        set: (obj: Record<string, unknown>) => { Object.assign(stored, obj); return Promise.resolve(); },
        remove: (key: string) => { delete stored[key]; return Promise.resolve(); },
      }
    }
  });
  return await import('@/sidepanel/services/downloadHistory');
}

beforeEach(() => { idbDelete.mockClear(); });

describe('addHistoryRecord：类型归一与「已下载」集合', () => {
  it('六档之外的历史值归一到 other：分类筛选不会漏掉它', async () => {
    const h = await boot();
    await h.addHistoryRecord({ id: 'x1', url: 'https://e.com/x1', kind: 'document' as never, status: 'success' });
    expect(h.getHistoryList().find(i => i.id === 'x1')?.kind).toBe('other');
  });

  it('同一 URL 先成功后失败：集合撤出，下载按钮不再永久显示已下载', async () => {
    const h = await boot();
    await h.addHistoryRecord({ id: 'y1', url: 'https://e.com/y1.mp4', kind: 'video', status: 'success' });
    expect(h.isDownloaded('https://e.com/y1.mp4')).toBe(true);
    await h.addHistoryRecord({ id: 'y1', url: 'https://e.com/y1.mp4', kind: 'video', status: 'failed', error: 'NETWORK' });
    expect(h.isDownloaded('https://e.com/y1.mp4')).toBe(false);
  });
});

describe('deleteHistoryRecords：按条/批量删除', () => {
  it('删除单条记录并立即落盘', async () => {
    const h = await boot();
    await h.addHistoryRecord({ id: 'd1', url: 'https://e.com/d1.mp4', kind: 'video', status: 'success' });
    await h.addHistoryRecord({ id: 'd2', url: 'https://e.com/d2.mp3', kind: 'audio', status: 'success' });
    const n = await h.deleteHistoryRecords(['d1']);
    expect(n).toBe(1);
    expect(h.getHistoryList().map(i => i.id)).toEqual(['d2']);
    expect((stored['global_download_history_v2'] as unknown[]).length).toBe(1);
  });

  it('同 URL 还有其它成功记录时，删除其一不撤出「已下载」集合', async () => {
    const h = await boot();
    // 重试场景：同一 URL 先有一条失败、又有一条成功（不同任务 id）
    await h.addHistoryRecord({ id: 's1', url: 'https://e.com/s.mp4', kind: 'video', status: 'failed', error: 'NETWORK' });
    await h.addHistoryRecord({ id: 's2', url: 'https://e.com/s.mp4', kind: 'video', status: 'success' });
    expect(h.isDownloaded('https://e.com/s.mp4')).toBe(true);
    await h.deleteHistoryRecords(['s2']);
    expect(h.isDownloaded('https://e.com/s.mp4')).toBe(false);
  });

  it('默认不删产物 blob；显式 deleteArtifacts 才回收 IDB 空间', async () => {
    const h = await boot();
    await h.addHistoryRecord({ id: 'a1', url: '录屏.webm', kind: 'video', status: 'success', idbKey: 'dlart:a1' });
    await h.deleteHistoryRecords(['a1']);
    expect(idbDelete).toHaveBeenCalledTimes(0);

    await h.addHistoryRecord({ id: 'a2', url: '录屏2.webm', kind: 'video', status: 'success', idbKey: 'dlart:a2' });
    await h.deleteHistoryRecords(['a2'], { deleteArtifacts: true });
    expect(idbDelete).toHaveBeenCalledTimes(1);
    expect(idbDelete.mock.calls[0]).toEqual(['hls-blobs', 'dlart:a2']);
  });

  it('空列表 / 不存在的 id 返回 0 且不触发写入', async () => {
    const h = await boot();
    await h.addHistoryRecord({ id: 'k1', url: 'https://e.com/k1', kind: 'image', status: 'success' });
    stored = {};
    expect(await h.deleteHistoryRecords([])).toBe(0);
    expect(await h.deleteHistoryRecords(['nope'])).toBe(0);
    expect(Object.keys(stored).length).toBe(0);
  });
});

describe('getHistoryBySource：本页关联视图', () => {
  it('按来源页命中，hash 差异不算、查询串差异不算', async () => {
    const h = await boot();
    await h.addHistoryRecord({ id: 'p1', url: 'https://cdn.com/a.mp4', kind: 'video', status: 'success', sourceUrl: 'https://site.com/watch?v=1' });
    await h.addHistoryRecord({ id: 'p2', url: 'https://cdn.com/b.mp4', kind: 'video', status: 'success', sourceUrl: 'https://site.com/watch?v=2' });
    await h.addHistoryRecord({ id: 'p3', url: 'https://cdn.com/c.mp4', kind: 'video', status: 'success' });
    const hit = h.getHistoryBySource('https://site.com/watch?v=1#t=30');
    expect(hit.map(i => i.id)).toEqual(['p1']);
    expect(h.getHistoryBySource(undefined)).toEqual([]);
  });
});
