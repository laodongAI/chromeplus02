/**
 * 视频候选筛选回归测试。
 * 覆盖：blob/MSE 与 YouTube SABR 流不可直链、优先级排序不会选中不可下载的候选；
 * 以及 DOM/网络两路候选的归属排序（Tier 2 #17：信息流页面点第 3 个视频却下到最后嗅探的那一条）。
 */
import { describe, it, expect } from 'vitest';
import { isDownloadableSource, pickBestCandidate, buildVideoDownloadFileName, mergeVideoSources } from '@/sidepanel/services/videoSources';

describe('isDownloadableSource：能否作为独立文件取回', () => {
  it('http(s) 直链可下载', () => {
    expect(isDownloadableSource({ url: 'https://example.com/a.mp4' })).toBe(true);
    expect(isDownloadableSource({ url: 'http://example.com/a.m3u8', extension: 'm3u8' })).toBe(true);
  });

  it('blob:/mediasource: 是 MSE 内存句柄，不可直链', () => {
    expect(isDownloadableSource({ url: 'blob:https://www.youtube.com/2f1c-a9' })).toBe(false);
    expect(isDownloadableSource({ url: 'mediasource:https://example.com/x' })).toBe(false);
    expect(isDownloadableSource({ url: 'BLOB:https://example.com/x' })).toBe(false);
  });

  it('streamOnly 标记的 SABR 流即使 URL 是 https 也不可直链', () => {
    const url = 'https://rr2---sn-a5meknzk.googlevideo.com/videoplayback?sabr=1&rn=5';
    expect(isDownloadableSource({ url, kind: 'video', streamOnly: true })).toBe(false);
    // 同端点的渐进式 mp4（无 streamOnly）仍然可直链
    expect(isDownloadableSource({ url: `${url}&itag=18`, extension: 'mp4' })).toBe(true);
  });
});

describe('pickBestCandidate：不可直链的候选必须排在最后', () => {
  it('同时存在直链与 blob 时选直链', () => {
    const best = pickBestCandidate([
      { url: 'blob:https://example.com/x', via: 'dom' },
      { url: 'https://example.com/a.mp4', extension: 'mp4', via: 'network' }
    ]);
    expect(best?.url).toBe('https://example.com/a.mp4');
  });

  it('YouTube 场景：SABR 流不会盖住可用的 mp4 直链', () => {
    const best = pickBestCandidate([
      { url: 'https://rr2---sn-x.googlevideo.com/videoplayback?sabr=1', streamOnly: true },
      { url: 'https://rr2---sn-x.googlevideo.com/videoplayback?itag=18', extension: 'mp4' }
    ]);
    expect(best?.streamOnly).toBeUndefined();
    expect(best?.extension).toBe('mp4');
  });

  it('只有流媒体候选时仍返回它，交由 UI 引导录制', () => {
    const only = { url: 'blob:https://www.youtube.com/x', via: 'dom' };
    expect(pickBestCandidate([only])).toEqual(only);
  });

  it('按扩展名优先级排序：mp4 优于 webm 优于 ts', () => {
    const best = pickBestCandidate([
      { url: 'https://example.com/a.ts', extension: 'ts' },
      { url: 'https://example.com/a.webm', extension: 'webm' },
      { url: 'https://example.com/a.mp4', extension: 'mp4' }
    ]);
    expect(best?.extension).toBe('mp4');
  });

  it('无扩展名时从 URL 猜测，未知扩展名排在已知之后', () => {
    const best = pickBestCandidate([
      { url: 'https://example.com/media?id=1' },
      { url: 'https://example.com/a.webm' }
    ]);
    expect(best?.url).toBe('https://example.com/a.webm');
  });

  it('空列表返回 null', () => {
    expect(pickBestCandidate([])).toBeNull();
  });
});

describe('buildVideoDownloadFileName：SABR 流无扩展名时的兜底', () => {
  it('清理标题中的非法文件名字符并补默认扩展名', () => {
    const name = buildVideoDownloadFileName(
      2,
      { url: 'https://rr2---sn-x.googlevideo.com/videoplayback?sabr=1' },
      { siteName: 'youtube', title: 'a/b:c*d' }
    );
    expect(name).toMatch(/^youtube_a_b_c_d_\d{4}-\d{2}-\d{2}_\d{6}_2\.mp4$/);
  });
});

describe('mergeVideoSources：DOM 是归属证据，必须压过全 frame 的网络嗅探', () => {
  it('信息流场景：选中视频的 currentSrc 胜过更新嗅探到的别的视频', () => {
    // 网络池已按新近 reverse：第一条是滚动后刚嗅探到的「别的视频」
    const network = [
      { url: 'https://cdn.example.com/feed/other-newer.mp4', extension: 'mp4', via: 'network' },
      { url: 'https://cdn.example.com/feed/older.mp4', extension: 'mp4', via: 'network' }
    ];
    const dom = [{ url: 'https://cdn.example.com/feed/picked.mp4', via: 'dom' }];

    const merged = mergeVideoSources(dom, network);
    // 核心回归断言：旧实现网络在前，这里会选中 other-newer.mp4（下错视频）
    expect(merged[0].url).toBe('https://cdn.example.com/feed/picked.mp4');
    expect(pickBestCandidate(merged)?.url).toBe('https://cdn.example.com/feed/picked.mp4');
  });

  it('DOM 只有 blob:/MSE 句柄时，网络直链顶上（YouTube 场景）', () => {
    const dom = [{ url: 'blob:https://www.youtube.com/2f1c-a9', via: 'dom' }];
    const network = [{ url: 'https://rr2---sn-x.googlevideo.com/videoplayback?itag=18', extension: 'mp4', via: 'network' }];

    const merged = mergeVideoSources(dom, network);
    expect(merged).toHaveLength(2);
    expect(pickBestCandidate(merged)?.url).toContain('itag=18');
  });

  it('DOM 的 blob 句柄仍保留在列表里，供 UI 引导「录制保存」', () => {
    const merged = mergeVideoSources([{ url: 'blob:https://example.com/x', via: 'dom' }], []);
    expect(merged).toHaveLength(1);
    expect(isDownloadableSource(merged[0])).toBe(false);
  });

  it('同 URL 去重保留 DOM 的位置，但补齐网络的 kind=hls（否则分段流被当直链下载）', () => {
    const dom = [{ url: 'https://example.com/live/playlist.m3u8', via: 'dom' }];
    const network = [{ url: 'https://example.com/live/playlist.m3u8', kind: 'hls' as const, extension: 'm3u8', mimeType: 'application/vnd.apple.mpegurl', size: 1024, via: 'network' }];

    const merged = mergeVideoSources(dom, network);
    expect(merged).toHaveLength(1);
    expect(merged[0].via).toBe('dom');
    expect(merged[0].kind).toBe('hls');
    expect(merged[0].extension).toBe('m3u8');
    expect(merged[0].mimeType).toBe('application/vnd.apple.mpegurl');
    expect(merged[0].size).toBe(1024);
  });

  it('网络的 streamOnly 标记能补到 DOM 候选上，SABR 流不会被误判可直链', () => {
    const url = 'https://rr2---sn-x.googlevideo.com/videoplayback';
    const merged = mergeVideoSources([{ url, via: 'dom' }], [{ url, streamOnly: true, via: 'network' }]);
    expect(merged).toHaveLength(1);
    expect(isDownloadableSource(merged[0])).toBe(false);
  });

  it('DOM 已有的字段不被网络候选覆盖', () => {
    const merged = mergeVideoSources(
      [{ url: 'https://example.com/a.mp4', extension: 'mp4', kind: 'video', via: 'dom' }],
      [{ url: 'https://example.com/a.mp4', extension: 'ts', kind: 'hls', via: 'network' }]
    );
    expect(merged[0].extension).toBe('mp4');
    expect(merged[0].kind).toBe('video');
  });

  it('去重按去掉 hash 的 URL（同一资源的不同片段标记算一条）', () => {
    const merged = mergeVideoSources(
      [{ url: 'https://example.com/a.mp4#t=10', via: 'dom' }],
      [{ url: 'https://example.com/a.mp4#t=30', via: 'network' }]
    );
    expect(merged).toHaveLength(1);
    expect(merged[0].url).toBe('https://example.com/a.mp4#t=10');
  });

  it('网络候选之间的相对顺序保持不变（新近优先由调用方 reverse 决定）', () => {
    const merged = mergeVideoSources([], [
      { url: 'https://example.com/new.mp4', via: 'network' },
      { url: 'https://example.com/old.mp4', via: 'network' }
    ]);
    expect(merged.map(s => s.url)).toEqual(['https://example.com/new.mp4', 'https://example.com/old.mp4']);
  });

  it('不修改入参对象（补齐元数据写在副本上）', () => {
    const dom = [{ url: 'https://example.com/a.m3u8', via: 'dom' }];
    const network = [{ url: 'https://example.com/a.m3u8', kind: 'hls' as const, via: 'network' }];
    mergeVideoSources(dom, network);
    expect(dom[0]).toEqual({ url: 'https://example.com/a.m3u8', via: 'dom' });
    expect(network[0].kind).toBe('hls');
  });

  it('空 URL 与空列表安全处理', () => {
    expect(mergeVideoSources([], [])).toEqual([]);
    expect(mergeVideoSources([{ url: '' }], [{ url: 'https://example.com/a.mp4' }])).toHaveLength(1);
  });
});