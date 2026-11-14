/**
 * 侧栏「在编辑器中打开」的交接落库单测。
 *
 * 被测行为的核心不变量：写进 chrome.storage.session 的东西必须能被编辑器
 * 在「侧栏文档已销毁」之后仍然取回。所以断言集中在：
 *  - 交的是 IndexedDB 键，payload 里绝不出现 blob: URL，也不出现 Blob 实例；
 *  - payload 可 JSON 往返（storage.session 无法序列化 Blob）；
 *  - 先写存储再建标签页（否则编辑器抢先加载会读不到清单）；
 *  - 孤儿回收只碰一次性交接键，录制成果键连读都不读。
 * 手法：IDB 与 chrome API 全部打桩，node 环境不触碰浏览器 API。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EDITOR_HANDOFF_PREFIX, EDITOR_HANDOFF_TTL_MS } from '@/shared/editorHandoff';
import { openClipsInEditor } from '@/sidepanel/utils/editorLauncher';
import type { PendingEditorClip } from '@/shared/editorHandoff';

const idb = vi.hoisted(() => ({
  put: vi.fn(),
  get: vi.fn(),
  getAllKeys: vi.fn(),
  del: vi.fn(),
}));

vi.mock('@/shared/blobStore', () => ({
  STORE_HLS_BLOBS: 'hls-blobs',
  idbPut: idb.put,
  idbGet: idb.get,
  idbGetAllKeys: idb.getAllKeys,
  idbDelete: idb.del,
}));

/** 记录副作用发生顺序，用于断言「先写存储再建标签页」 */
const order: string[] = [];

const chromeStub = {
  storage: {
    session: {
      set: vi.fn(async () => { order.push('set'); }),
      get: vi.fn(async () => ({})),
      remove: vi.fn(async () => {}),
    },
  },
  runtime: { getURL: vi.fn((p: string) => `chrome-extension://abcdefg/${p}`) },
  tabs: { create: vi.fn(async () => { order.push('create'); return { id: 9 }; }) },
};

const NOW = 1_700_000_000_000;

/** 造一个非空 Blob */
function makeBlob(bytes = 8): Blob {
  return new Blob([new Uint8Array(bytes)], { type: 'video/webm' });
}

/** 取本次写入 storage.session 的剪辑清单 */
function writtenRefs(): PendingEditorClip[] {
  const arg = chromeStub.storage.session.set.mock.calls.at(-1)?.[0] as { pendingEditorClips: PendingEditorClip[] };
  return arg.pendingEditorClips;
}

beforeEach(() => {
  vi.clearAllMocks();
  order.length = 0;
  idb.getAllKeys.mockResolvedValue([]);
  idb.put.mockResolvedValue(undefined);
  idb.del.mockResolvedValue(undefined);
  vi.stubGlobal('chrome', chromeStub);
  vi.spyOn(Date, 'now').mockReturnValue(NOW);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('openClipsInEditor：交接载荷形态', () => {
  it('内存 Blob 先落 IDB，交出去的是键而不是 blob: URL', async () => {
    const blob = makeBlob(32);
    await openClipsInEditor([{ name: '录屏 1', blob }]);

    expect(idb.put).toHaveBeenCalledTimes(1);
    const [store, key, value] = idb.put.mock.calls[0];
    expect(store).toBe('hls-blobs');
    expect(key.startsWith(EDITOR_HANDOFF_PREFIX)).toBe(true);
    expect(value).toEqual({ savedAt: NOW, blob });

    const refs = writtenRefs();
    expect(refs).toEqual([{ name: '录屏 1', idbKey: key }]);
    // 关键：侧栏关掉后编辑器仍要能取回，故载荷里不能有任何随文档失效的东西
    expect(JSON.stringify(refs)).not.toContain('blob:');
    expect(JSON.parse(JSON.stringify(refs))).toEqual(refs);
  });

  it('已在库里的录制成果直接交键，零拷贝且不落新库', async () => {
    await openClipsInEditor([{ name: '成果.webm', idbKey: 'caprec_123', blob: makeBlob() }]);

    expect(idb.put).not.toHaveBeenCalled();
    expect(writtenRefs()).toEqual([{ name: '成果.webm', idbKey: 'caprec_123' }]);
  });

  it('素材来源优先级：idbKey > blob > url', async () => {
    await openClipsInEditor([{ name: 'a', idbKey: 'caprec_1', blob: makeBlob(), url: 'https://example.com/a.mp4' }]);
    expect(writtenRefs()).toEqual([{ name: 'a', idbKey: 'caprec_1' }]);
    expect(idb.put).not.toHaveBeenCalled();
  });

  it('只有 http 直链时交 url，由编辑器自行抓取', async () => {
    await openClipsInEditor([{ name: '远程', url: 'https://cdn.example.com/a.mp4' }]);
    expect(writtenRefs()).toEqual([{ name: '远程', url: 'https://cdn.example.com/a.mp4' }]);
    expect(idb.put).not.toHaveBeenCalled();
  });

  it('多条 Blob 各自拿到不同的键，不互相覆盖', async () => {
    await openClipsInEditor([{ name: 'a', blob: makeBlob() }, { name: 'b', blob: makeBlob(16) }]);
    const refs = writtenRefs();
    expect(refs).toHaveLength(2);
    expect(refs[0].idbKey).not.toBe(refs[1].idbKey);
    expect(idb.put).toHaveBeenCalledTimes(2);
  });

  it('空 Blob 且无直链的条目被跳过，其余照常移交', async () => {
    await openClipsInEditor([
      { name: '坏的', blob: new Blob([]) },
      { name: '好的', blob: makeBlob() },
    ]);
    expect(writtenRefs().map(r => r.name)).toEqual(['好的']);
    expect(idb.put).toHaveBeenCalledTimes(1);
  });

  it('全部无素材时抛错，且不建标签页（不能打开一个空编辑器）', async () => {
    await expect(openClipsInEditor([{ name: '坏的', blob: new Blob([]) }, { name: '空的' }]))
      .rejects.toThrow('没有可移交的素材');
    expect(chromeStub.storage.session.set).not.toHaveBeenCalled();
    expect(chromeStub.tabs.create).not.toHaveBeenCalled();
  });

  it('空列表直接返回，不触碰 chrome API', async () => {
    await openClipsInEditor([]);
    expect(chromeStub.storage.session.set).not.toHaveBeenCalled();
    expect(chromeStub.tabs.create).not.toHaveBeenCalled();
  });

  it('先写存储再建标签页，且打开的是编辑器页面', async () => {
    await openClipsInEditor([{ name: 'a', blob: makeBlob() }]);
    expect(order).toEqual(['set', 'create']);
    expect(chromeStub.tabs.create).toHaveBeenCalledWith({ url: 'chrome-extension://abcdefg/src/editor/index.html' });
  });

  it('建标签页失败时向上抛错，由调用方提示用户', async () => {
    chromeStub.tabs.create.mockRejectedValueOnce(new Error('tabs 不可用'));
    await expect(openClipsInEditor([{ name: 'a', blob: makeBlob() }])).rejects.toThrow('tabs 不可用');
    // 素材已落库、清单已写入：失败不是静默丢弃
    expect(idb.put).toHaveBeenCalledTimes(1);
    expect(chromeStub.storage.session.set).toHaveBeenCalledTimes(1);
  });
});

describe('openClipsInEditor：孤儿交接素材回收', () => {
  it('只回收过期的一次性键；新鲜交接键保留，录制成果键连读都不读', async () => {
    const staleKey = `${EDITOR_HANDOFF_PREFIX}old`;
    const freshKey = `${EDITOR_HANDOFF_PREFIX}new`;
    idb.getAllKeys.mockResolvedValue(['caprec_1', staleKey, freshKey, 'hls_segment_1']);
    idb.get.mockImplementation(async (_store: string, key: string) => {
      if (key === staleKey) return { savedAt: NOW - EDITOR_HANDOFF_TTL_MS - 1, blob: makeBlob() };
      if (key === freshKey) return { savedAt: NOW - 1000, blob: makeBlob() };
      throw new Error(`不该读取非交接键：${key}`);
    });

    await openClipsInEditor([{ name: 'a', blob: makeBlob() }]);

    expect(idb.get.mock.calls.map(c => c[1])).toEqual([staleKey, freshKey]);
    expect(idb.del).toHaveBeenCalledTimes(1);
    expect(idb.del).toHaveBeenCalledWith('hls-blobs', staleKey);
  });

  it('回收失败不阻断本次交接', async () => {
    idb.getAllKeys.mockRejectedValue(new Error('IDB 暂不可用'));
    await openClipsInEditor([{ name: 'a', blob: makeBlob() }]);
    expect(writtenRefs()).toHaveLength(1);
    expect(chromeStub.tabs.create).toHaveBeenCalledTimes(1);
  });

  it('没有历史交接键时不读不删', async () => {
    idb.getAllKeys.mockResolvedValue(['caprec_1', 'caprec_2']);
    await openClipsInEditor([{ name: 'a', idbKey: 'caprec_1' }]);
    expect(idb.get).not.toHaveBeenCalled();
    expect(idb.del).not.toHaveBeenCalled();
  });
});