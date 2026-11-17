/**
 * 下载台账分类与状态语义单测。
 * 守住三件事：类型归一不漏项（文本/资源包/录制产物要能进台账）、
 * 中断与失败分开（重试策略不同）、来源页匹配比的是页面地址而非 CDN 资源地址。
 */
import { describe, expect, it } from 'vitest';
import {
  DOWNLOAD_KIND_ORDER,
  STATUS_GROUP_LABELS,
  STATUS_GROUP_ORDER,
  extractExt,
  inferKind,
  isSameSource,
  kindVariant,
  matchesDownloadFilters,
  normalizeKind,
  statusGroup,
  statusLabel,
  statusVariant,
  toHistoryStatus
} from '@/core/downloadTaxonomy';

describe('normalizeKind', () => {
  it('六个合法类型原样返回', () => {
    for (const k of DOWNLOAD_KIND_ORDER) expect(normalizeKind(k)).toBe(k);
  });

  it('未知值、空值、非字符串一律收敛到 other（旧数据与后台快照可能给 undefined）', () => {
    expect(normalizeKind(undefined)).toBe('other');
    expect(normalizeKind(null)).toBe('other');
    expect(normalizeKind('')).toBe('other');
    expect(normalizeKind('document')).toBe('other');
    expect(normalizeKind(42)).toBe('other');
  });
});

describe('extractExt', () => {
  it('剥掉 query 与 hash 后取扩展名（带签名参数的直链是常态）', () => {
    expect(extractExt('https://cdn.x.com/a/b/movie.mp4?token=abc&expires=1')).toBe('mp4');
    expect(extractExt('https://cdn.x.com/a/b/movie.mp4#frag')).toBe('mp4');
    expect(extractExt('archive.ZIP')).toBe('zip');
  });

  it('无扩展名、点开头、点在末尾都返回空串', () => {
    expect(extractExt('https://x.com/video')).toBe('');
    expect(extractExt('.gitignore')).toBe('');
    expect(extractExt('file.')).toBe('');
    expect(extractExt('')).toBe('');
  });
});

describe('inferKind', () => {
  it('MIME 优先于扩展名', () => {
    expect(inferKind({ fileName: 'a.bin', mime: 'video/mp4' })).toBe('video');
    expect(inferKind({ fileName: 'a.mp4', mime: 'audio/mpeg' })).toBe('audio');
  });

  it('中性 MIME 不作依据，回落到扩展名', () => {
    expect(inferKind({ fileName: 'a.mp4', mime: 'application/octet-stream' })).toBe('video');
    expect(inferKind({ url: 'https://x.com/a.zip', mime: 'application/octet-stream' })).toBe('archive');
  });

  it('六大类都能由扩展名判出', () => {
    expect(inferKind({ fileName: 'v.m3u8' })).toBe('video');
    expect(inferKind({ fileName: 'a.m4a' })).toBe('audio');
    expect(inferKind({ fileName: 'i.webp' })).toBe('image');
    expect(inferKind({ fileName: 't.md' })).toBe('text');
    expect(inferKind({ fileName: 'p.zip' })).toBe('archive');
    expect(inferKind({ fileName: 'x.unknown' })).toBe('other');
  });

  it('文本导出的两种真实产物：Markdown 与单文件 HTML 归档', () => {
    expect(inferKind({ fileName: '正文.md', mime: 'text/markdown;charset=utf-8' })).toBe('text');
    expect(inferKind({ fileName: '归档.html', mime: 'text/html;charset=utf-8' })).toBe('text');
  });

  it('资源包 zip 与录制产物 webm', () => {
    expect(inferKind({ fileName: 'sources_123.zip', mime: 'application/zip' })).toBe('archive');
    expect(inferKind({ fileName: '录制_11-16.webm', mime: 'video/webm' })).toBe('video');
  });

  it('fileName 缺失时用 url，两者都缺归 other', () => {
    expect(inferKind({ url: 'https://x.com/a/b/song.mp3?k=v' })).toBe('audio');
    expect(inferKind({})).toBe('other');
  });
});

describe('statusGroup / statusLabel / statusVariant', () => {
  it('中断与一般失败分属两档（中断可重试，失败多为资源本身取不到）', () => {
    expect(statusGroup('error', 'INTERRUPTED')).toBe('interrupted');
    expect(statusGroup('error', 'DRM')).toBe('failed');
    expect(statusGroup('error')).toBe('failed');
    expect(statusLabel('error', 'INTERRUPTED')).toBe('中断');
    expect(statusLabel('error', 'DRM')).toBe('失败');
    expect(statusVariant('error', 'INTERRUPTED')).toBe('warning');
    expect(statusVariant('error', 'DRM')).toBe('danger');
  });

  it('历史状态与队列状态映射到同一档位', () => {
    expect(statusGroup('success')).toBe('completed');
    expect(statusGroup('completed')).toBe('completed');
    expect(statusGroup('failed')).toBe('failed');
    expect(statusGroup('canceled')).toBe('canceled');
  });

  it('三个中间态都归进行中，running 用 info 徽标以便一眼看到活跃任务', () => {
    for (const s of ['pending', 'running', 'paused']) expect(statusGroup(s)).toBe('active');
    expect(statusVariant('running')).toBe('info');
    expect(statusVariant('paused')).toBe('neutral');
    expect(statusLabel('running')).toBe('下载中');
    expect(statusLabel('paused')).toBe('已暂停');
  });

  it('未知状态原样透出，不吞成空白', () => {
    expect(statusLabel('weird')).toBe('weird');
    expect(statusGroup('weird')).toBe('active');
  });

  it('五个筛选档位都有中文标签（下拉选项不能出现空文案）', () => {
    for (const g of STATUS_GROUP_ORDER) expect(STATUS_GROUP_LABELS[g]).toBeTruthy();
  });
});

describe('toHistoryStatus', () => {
  it('三个终态都留痕——取消此前完全不写历史，台账上像凭空消失', () => {
    expect(toHistoryStatus('completed')).toBe('success');
    expect(toHistoryStatus('error')).toBe('failed');
    expect(toHistoryStatus('canceled')).toBe('canceled');
  });

  it('非终态返回 null，不该写历史', () => {
    for (const s of ['pending', 'running', 'paused']) expect(toHistoryStatus(s)).toBeNull();
  });
});

describe('isSameSource', () => {
  it('同页匹配，忽略 hash（SPA 锚点不改变页面身份）', () => {
    expect(isSameSource('https://x.com/watch?v=1', 'https://x.com/watch?v=1#t=30')).toBe(true);
    expect(isSameSource('https://x.com/a', 'https://x.com/a')).toBe(true);
  });

  it('比的是来源页地址：媒体直链在 CDN 上也要能匹配回页面', () => {
    // 任务 url 是 cdn.example.net，sourceUrl 才是页面；这里传的就是 sourceUrl
    expect(isSameSource('https://x.com/watch?v=1', 'https://x.com/watch?v=1')).toBe(true);
    expect(isSameSource('https://cdn.example.net/v.mp4', 'https://x.com/watch?v=1')).toBe(false);
  });

  it('不同路径、不同源、不同查询都算不同页', () => {
    expect(isSameSource('https://x.com/a', 'https://x.com/b')).toBe(false);
    expect(isSameSource('https://x.com/a', 'https://y.com/a')).toBe(false);
    expect(isSameSource('https://x.com/watch?v=1', 'https://x.com/watch?v=2')).toBe(false);
  });

  it('任一侧缺失或非法 URL 一律不匹配（旧记录没有来源字段）', () => {
    expect(isSameSource(undefined, 'https://x.com/a')).toBe(false);
    expect(isSameSource('https://x.com/a', undefined)).toBe(false);
    expect(isSameSource(null, null)).toBe(false);
    expect(isSameSource('not a url', 'https://x.com/a')).toBe(false);
    expect(isSameSource('', '')).toBe(false);
  });
});

describe('matchesDownloadFilters', () => {
  const item = { kind: 'video', status: 'running', sourceUrl: 'https://x.com/a' };

  it('全不限时保留', () => {
    expect(matchesDownloadFilters(item, { kind: 'all', group: 'all' })).toBe(true);
  });

  it('类型筛选：未知 kind 归 other，不会从 other 档漏掉', () => {
    expect(matchesDownloadFilters(item, { kind: 'video', group: 'all' })).toBe(true);
    expect(matchesDownloadFilters(item, { kind: 'audio', group: 'all' })).toBe(false);
    expect(matchesDownloadFilters({ status: 'completed', kind: undefined }, { kind: 'other', group: 'all' })).toBe(true);
  });

  it('状态筛选按档位而非原始字符串', () => {
    expect(matchesDownloadFilters(item, { kind: 'all', group: 'active' })).toBe(true);
    expect(matchesDownloadFilters(item, { kind: 'all', group: 'completed' })).toBe(false);
    expect(matchesDownloadFilters({ kind: 'video', status: 'error', errorCode: 'INTERRUPTED' }, { kind: 'all', group: 'interrupted' })).toBe(true);
    expect(matchesDownloadFilters({ kind: 'video', status: 'success' }, { kind: 'all', group: 'completed' })).toBe(true);
  });

  it('只看本页：给出 pageUrl 即按来源页过滤', () => {
    expect(matchesDownloadFilters(item, { kind: 'all', group: 'all', pageUrl: 'https://x.com/a' })).toBe(true);
    expect(matchesDownloadFilters(item, { kind: 'all', group: 'all', pageUrl: 'https://x.com/b' })).toBe(false);
    expect(matchesDownloadFilters({ kind: 'video', status: 'running' }, { kind: 'all', group: 'all', pageUrl: 'https://x.com/a' })).toBe(false);
  });

  it('三个条件是与关系', () => {
    expect(matchesDownloadFilters(item, { kind: 'video', group: 'active', pageUrl: 'https://x.com/a' })).toBe(true);
    expect(matchesDownloadFilters(item, { kind: 'video', group: 'completed', pageUrl: 'https://x.com/a' })).toBe(false);
  });
});

describe('kindVariant', () => {
  it('每个类型都有确定档位，不返回 undefined', () => {
    for (const k of DOWNLOAD_KIND_ORDER) expect(kindVariant(k)).toBeTruthy();
  });
});