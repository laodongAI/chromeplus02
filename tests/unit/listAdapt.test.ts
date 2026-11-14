/**
 * UI 第二批之一（列表适配窄侧栏）共享纯函数模块的单元测试。
 * 覆盖 tests 可抽离的三类核心逻辑：
 *  1. 分页切片与页码钳制（slicePage / clampPage）
 *  2. 重复项选择与隐藏冗余重复（computeDuplicateSet / collectDuplicateKeys / hideRedundantDuplicates）
 *  3. 过滤即时生效的判定（matchesImageFilter / matchesAudioFilter / matchesVideoFilter）
 * 以及防抖执行器（createDebounce，使用 vi 假定时器）。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  slicePage,
  clampPage,
  computeDuplicateSet,
  collectDuplicateKeys,
  hideRedundantDuplicates,
  createDebounce,
  summarizeReasons,
  matchesImageFilter,
  matchesAudioFilter,
  matchesVideoFilter,
  videoFactsOf,
  type ImageFilterCriteria,
  type AudioFilterCriteria,
  type VideoFilterCriteria
} from '../../src/sidepanel/utils/listAdapt';

describe('slicePage：分页切片', () => {
  const list = Array.from({ length: 145 }, (_, i) => i);

  it('第 1 页返回前 pageSize 条', () => {
    const p = slicePage(list, 1, 60);
    expect(p.length).toBe(60);
    expect(p[0]).toBe(0);
    expect(p[59]).toBe(59);
  });

  it('末页返回剩余条数', () => {
    const p = slicePage(list, 3, 60);
    expect(p.length).toBe(25);
    expect(p[0]).toBe(120);
  });

  it('页码越界返回空数组而不是报错', () => {
    expect(slicePage(list, 99, 60)).toEqual([]);
  });

  it('非法页码（0/负数/NaN）按第 1 页处理', () => {
    expect(slicePage(list, 0, 60)[0]).toBe(0);
    expect(slicePage(list, -5, 60)[0]).toBe(0);
    expect(slicePage(list, NaN, 60)[0]).toBe(0);
  });

  it('pageSize<=0 视为不分页返回整表浅拷贝', () => {
    expect(slicePage(list, 1, 0).length).toBe(145);
    expect(slicePage(list, 1, -1).length).toBe(145);
  });

  it('空列表返回空数组', () => {
    expect(slicePage([], 1, 60)).toEqual([]);
  });
});

describe('clampPage：页码钳制', () => {
  it('列表变短时把越界页码拉回最后一页', () => {
    expect(clampPage(5, 100, 60)).toBe(2);
  });

  it('合法页码保持不变', () => {
    expect(clampPage(1, 100, 60)).toBe(1);
    expect(clampPage(2, 100, 60)).toBe(2);
  });

  it('空列表钳到第 1 页（至少 1）', () => {
    expect(clampPage(3, 0, 60)).toBe(1);
  });

  it('非法输入（NaN/0 页码）兜底为第 1 页', () => {
    expect(clampPage(NaN, 100, 60)).toBe(1);
    expect(clampPage(0, 100, 60)).toBe(1);
  });
});

describe('computeDuplicateSet：重复集合', () => {
  /** 取 url 作为 key、按 group 字段分组的测试形状 */
  const keyOf = (i: { url: string }) => i.url;
  const groupOf = (i: { group: string | null }) => i.group;

  it('同组 >=2 个成员时整组判重，单成员组不判重', () => {
    const list = [
      { url: 'a', group: 'g1' },
      { url: 'b', group: 'g1' },
      { url: 'c', group: 'g2' }
    ];
    const dups = computeDuplicateSet(list, keyOf, groupOf);
    expect(dups.has('a')).toBe(true);
    expect(dups.has('b')).toBe(true);
    expect(dups.has('c')).toBe(false);
  });

  it('group 为 null 的项不参与重复判定', () => {
    const list = [
      { url: 'a', group: null },
      { url: 'b', group: null }
    ];
    expect(computeDuplicateSet(list, keyOf, groupOf).size).toBe(0);
  });

  it('三成员组全部判重', () => {
    const list = [
      { url: 'a', group: 'g' },
      { url: 'b', group: 'g' },
      { url: 'c', group: 'g' }
    ];
    expect(computeDuplicateSet(list, keyOf, groupOf).size).toBe(3);
  });
});

describe('collectDuplicateKeys：重复项选择', () => {
  it('按列表顺序收集命中重复集合的 key', () => {
    const list = [{ url: 'x' }, { url: 'y' }, { url: 'z' }];
    const keys = collectDuplicateKeys(list, i => i.url, new Set(['z', 'x']));
    expect(keys).toEqual(['x', 'z']);
  });

  it('无命中返回空数组', () => {
    expect(collectDuplicateKeys([{ url: 'x' }], i => i.url, new Set())).toEqual([]);
  });
});

describe('hideRedundantDuplicates：隐藏冗余重复', () => {
  /** 语义：dupSet 命中的项按分组保留首个，其余隐藏；非重复项与无组键项不受影响 */
  const list = [
    { url: 'a', group: 'g1' }, // g1 首个 -> 保留
    { url: 'b', group: 'g2' }, // 非重复 -> 保留
    { url: 'c', group: 'g1' }, // g1 冗余 -> 隐藏
    { url: 'd', group: null }, // 无组键（哈希未算出）-> 保留
    { url: 'e', group: 'g1' }  // g1 冗余 -> 隐藏
  ];
  const dupSet = new Set(['a', 'c', 'e']);

  it('每组保留第一个代表，隐藏其余冗余副本', () => {
    const out = hideRedundantDuplicates(list, i => i.url, i => i.group, dupSet);
    expect(out.map(i => i.url)).toEqual(['a', 'b', 'd']);
  });

  it('dupSet 为空时列表原样返回', () => {
    expect(hideRedundantDuplicates(list, i => i.url, i => i.group, new Set()).length).toBe(list.length);
  });
});

describe('matchesImageFilter：图像过滤判定', () => {
  /** 构造完整默认条件（各维度按需覆盖） */
  const criteria = (over: Partial<ImageFilterCriteria> = {}): ImageFilterCriteria => ({
    minWidth: 0, minHeight: 0, kind: '', downloadStatus: 'all', query: '', ...over
  });
  const neverDownloaded = () => false;
  const img = { url: 'https://e.com/a.png', width: 200, height: 100, kind: 'img', phash: 'abcd1234' };

  it('默认条件全通过', () => {
    expect(matchesImageFilter(img, criteria(), neverDownloaded)).toBe(true);
  });

  it('宽高下限：小于下限被排除，等于下限保留', () => {
    expect(matchesImageFilter(img, criteria({ minWidth: 201 }), neverDownloaded)).toBe(false);
    expect(matchesImageFilter(img, criteria({ minWidth: 200 }), neverDownloaded)).toBe(true);
    expect(matchesImageFilter(img, criteria({ minHeight: 101 }), neverDownloaded)).toBe(false);
  });

  it('类型精确匹配', () => {
    expect(matchesImageFilter(img, criteria({ kind: 'background' }), neverDownloaded)).toBe(false);
    expect(matchesImageFilter(img, criteria({ kind: 'img' }), neverDownloaded)).toBe(true);
  });

  it('下载状态维度按注入的 isDownloaded 判定', () => {
    const always = () => true;
    expect(matchesImageFilter(img, criteria({ downloadStatus: 'downloaded' }), always)).toBe(true);
    expect(matchesImageFilter(img, criteria({ downloadStatus: 'new' }), always)).toBe(false);
    expect(matchesImageFilter(img, criteria({ downloadStatus: 'new' }), neverDownloaded)).toBe(true);
  });

  it('搜索词命中 URL 或哈希（大小写不敏感），空白视为无词', () => {
    expect(matchesImageFilter(img, criteria({ query: 'A.PNG' }), neverDownloaded)).toBe(true);
    expect(matchesImageFilter(img, criteria({ query: '1234' }), neverDownloaded)).toBe(true);
    expect(matchesImageFilter(img, criteria({ query: 'zzz' }), neverDownloaded)).toBe(false);
    expect(matchesImageFilter(img, criteria({ query: '   ' }), neverDownloaded)).toBe(true);
  });
});

describe('matchesAudioFilter：音频过滤判定', () => {
  const criteria = (over: Partial<AudioFilterCriteria> = {}): AudioFilterCriteria => ({
    minDuration: 0, minSize: 0, downloadStatus: 'all', query: '', ...over
  });
  const neverDownloaded = () => false;
  const item = { url: 'https://e.com/a.mp3', title: 'Sample Song' };

  it('默认条件全通过；元数据缺失不影响', () => {
    expect(matchesAudioFilter(item, {}, criteria(), neverDownloaded)).toBe(true);
  });

  it('时长/大小下限：未就绪（undefined）的项在下限生效时被排除（沿用旧语义）', () => {
    expect(matchesAudioFilter(item, { duration: 30 }, criteria({ minDuration: 31 }), neverDownloaded)).toBe(false);
    expect(matchesAudioFilter(item, {}, criteria({ minDuration: 1 }), neverDownloaded)).toBe(false);
    expect(matchesAudioFilter(item, { contentLength: 1024 }, criteria({ minSize: 1024 }), neverDownloaded)).toBe(true);
  });

  it('搜索词命中标题或 URL', () => {
    expect(matchesAudioFilter(item, {}, criteria({ query: 'sample' }), neverDownloaded)).toBe(true);
    expect(matchesAudioFilter(item, {}, criteria({ query: '.mp3' }), neverDownloaded)).toBe(true);
    expect(matchesAudioFilter(item, {}, criteria({ query: 'zzz' }), neverDownloaded)).toBe(false);
  });
});

/**
 * 属性过滤表达式接入过滤链（Round 5 #28）。
 * 这里只验「表达式是否真的参与了判定」与几条容易写错的取值口径，
 * 语法本身的覆盖在 mediaFilter.test.ts。
 */
describe('matchesAudioFilter / matchesVideoFilter：属性表达式', () => {
  const neverDownloaded = () => false;
  const audioCriteria = (over: Partial<AudioFilterCriteria> = {}): AudioFilterCriteria => ({
    minDuration: 0, minSize: 0, downloadStatus: 'all', query: '', ...over
  });
  const videoCriteria = (over: Partial<VideoFilterCriteria> = {}): VideoFilterCriteria => ({
    minWidth: 0, minHeight: 0, minDuration: 0, downloadStatus: 'all', query: '', ...over
  });

  it('音频体积优先取 HEAD 探测值，未探测到时用嗅探 content-length 兜底', () => {
    const item = { url: 'https://e.com/a.mp3', size: 8 * 1024 * 1024 };
    expect(matchesAudioFilter(item, {}, audioCriteria({ expr: 'size>5MB' }), neverDownloaded)).toBe(true);
    expect(matchesAudioFilter(item, { contentLength: 1024 }, audioCriteria({ expr: 'size>5MB' }), neverDownloaded)).toBe(false);
  });

  it('音频格式同时认扩展名与嗅探 MIME', () => {
    expect(matchesAudioFilter({ url: 'https://e.com/a.mp3' }, {}, audioCriteria({ expr: 'format=mp3' }), neverDownloaded)).toBe(true);
    expect(matchesAudioFilter({ url: 'https://e.com/s/1', mimeType: 'audio/mpeg' }, {}, audioCriteria({ expr: 'format=mp3' }), neverDownloaded)).toBe(true);
    expect(matchesAudioFilter({ url: 'https://e.com/a.mp3' }, {}, audioCriteria({ expr: 'format=m4a' }), neverDownloaded)).toBe(false);
  });

  it('语法未写完时放行：红字已给反馈，清空列表会被误读成页面没资源', () => {
    expect(matchesAudioFilter({ url: 'https://e.com/a.mp3' }, {}, audioCriteria({ expr: 'size>' }), neverDownloaded)).toBe(true);
    expect(matchesVideoFilter({ src: 'https://e.com/a.mp4' }, videoCriteria({ expr: 'size>' }), neverDownloaded)).toBe(true);
  });

  it('视频：无 src 的 MSE 元素退回第一条直链认格式，分辨率用元素尺寸', () => {
    const video = { width: 1920, height: 1080, directSources: [{ url: 'https://cdn.other/x.m3u8' }] };
    expect(matchesVideoFilter(video, videoCriteria({ expr: 'format=hls' }), neverDownloaded)).toBe(true);
    expect(matchesVideoFilter(video, videoCriteria({ expr: 'res>=720p and format=mp4' }), neverDownloaded)).toBe(false);
    expect(matchesVideoFilter({ src: 'https://e.com/a.mp4', width: 640, height: 360 }, videoCriteria({ expr: 'res>=720p' }), neverDownloaded)).toBe(false);
  });

  it('视频体积来自嗅探直链的 content-length；元素与所有直链都没有体积时判为未知不匹配', () => {
    const withSize = { src: 'https://e.com/a.mp4', directSources: [{ url: 'https://e.com/a.mp4', size: 40 * 1024 * 1024 }] };
    expect(matchesVideoFilter(withSize, videoCriteria({ expr: 'size>20MB' }), neverDownloaded)).toBe(true);
    expect(matchesVideoFilter(withSize, videoCriteria({ expr: 'size>50MB' }), neverDownloaded)).toBe(false);
    // blob:/MSE 元素没有体积线索：size> 必须排除，而不是当成 0 通过
    expect(matchesVideoFilter({ src: 'blob:https://e.com/x' }, videoCriteria({ expr: 'size>1MB' }), neverDownloaded)).toBe(false);
    expect(videoFactsOf({ src: 'blob:https://e.com/x' }).size).toBeUndefined();
  });

  it('表达式与搜索词/下限条件是叠加关系，不是互斥', () => {
    const item = { url: 'https://e.com/a.mp3', title: 'Sample', size: 1024 };
    expect(matchesAudioFilter(item, {}, audioCriteria({ query: 'sample', expr: 'size>2MB' }), neverDownloaded)).toBe(false);
    expect(matchesAudioFilter(item, {}, audioCriteria({ query: 'zzz', expr: 'size>1KB' }), neverDownloaded)).toBe(false);
    expect(matchesAudioFilter(item, {}, audioCriteria({ query: 'sample', expr: 'size>=1KB' }), neverDownloaded)).toBe(true);
  });
});

describe('matchesVideoFilter：视频过滤判定', () => {
  const criteria = (over: Partial<VideoFilterCriteria> = {}): VideoFilterCriteria => ({
    minWidth: 0, minHeight: 0, minDuration: 0, downloadStatus: 'all', query: '', ...over
  });
  const neverDownloaded = () => false;
  const video = {
    src: 'https://www.example.com/media/clip.mp4',
    width: 1280, height: 720, duration: 60,
    directSources: [{ url: 'https://cdn.other/x.m3u8' }]
  };

  it('默认条件全通过', () => {
    expect(matchesVideoFilter(video, criteria(), neverDownloaded)).toBe(true);
  });

  it('分辨率/时长下限：未知（0/undefined）的项在下限生效时被排除', () => {
    expect(matchesVideoFilter({ src: 'a' }, criteria({ minWidth: 1 }), neverDownloaded)).toBe(false);
    expect(matchesVideoFilter(video, criteria({ minDuration: 61 }), neverDownloaded)).toBe(false);
  });

  it('搜索词按 host/path 命中，或命中任一直链 URL', () => {
    expect(matchesVideoFilter(video, criteria({ query: 'example' }), neverDownloaded)).toBe(true);
    expect(matchesVideoFilter(video, criteria({ query: 'clip.mp4' }), neverDownloaded)).toBe(true);
    expect(matchesVideoFilter(video, criteria({ query: 'cdn.other' }), neverDownloaded)).toBe(true);
    expect(matchesVideoFilter(video, criteria({ query: 'zzz' }), neverDownloaded)).toBe(false);
  });

  it('下载状态维度按注入的 isDownloaded（以 src 为键）判定', () => {
    expect(matchesVideoFilter(video, criteria({ downloadStatus: 'downloaded' }), () => true)).toBe(true);
    expect(matchesVideoFilter(video, criteria({ downloadStatus: 'downloaded' }), neverDownloaded)).toBe(false);
  });
});

describe('summarizeReasons：批量失败原因汇总', () => {
  it('空清单返回空串', () => {
    expect(summarizeReasons([])).toBe('');
  });

  it('去重后不超过两类时全部展示（分号连接）', () => {
    expect(summarizeReasons(['403', '403', '网络'])).toBe('403；网络');
  });

  it('超过两类时取前两类并带"等 N 类原因"收尾', () => {
    expect(summarizeReasons(['a', 'b', 'c', 'c'])).toBe('a；b；等 3 类原因');
  });
});

describe('createDebounce：过滤即时生效防抖', () => {
  afterEach(() => { vi.useRealTimers(); });

  it('连续触发只在停止 wait 后执行一次（最后一次参数生效）', () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const d = createDebounce(fn, 300);
    d.run(); d.run(); d.run();
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(299);
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('cancel 取消未触发的执行', () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const d = createDebounce(fn, 300);
    d.run();
    d.cancel();
    vi.advanceTimersByTime(1000);
    expect(fn).not.toHaveBeenCalled();
  });

  it('触发后可再次调度（非一次性）', () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const d = createDebounce(fn, 300);
    d.run();
    vi.advanceTimersByTime(300);
    d.run();
    vi.advanceTimersByTime(300);
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
