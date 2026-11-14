/**
 * Round 5 #29：媒体候选回收的纯逻辑单测（脚本正文扫描 + 资源账本转换 + 合并语义）。
 */
import { describe, expect, it } from 'vitest';
import {
  backfillSweepRecords,
  extractMediaUrlsFromScript,
  filterNewCandidates,
  mediaUrlsFromResourceEntries,
  resolveAgainstBase,
  scriptUrlsFromResourceEntries
} from '@/core/mediaSweep';

const BASE = 'https://s.example.com/app/player.min.js';

describe('resolveAgainstBase：脚本内相对地址解析', () => {
  it('相对路径按脚本 URL 解析，绝对地址原样保留', () => {
    expect(resolveAgainstBase('/media/a.m3u8', BASE)).toBe('https://s.example.com/media/a.m3u8');
    expect(resolveAgainstBase('../v.mp4', BASE)).toBe('https://s.example.com/v.mp4');
    expect(resolveAgainstBase('https://cdn.other/x.mp4', BASE)).toBe('https://cdn.other/x.mp4');
  });

  it('转义与模板残片：转义还原后能解析，非法协议与畸形串返回 null', () => {
    expect(resolveAgainstBase('https:\\/\\/cdn.other\\/a.m3u8', BASE)).toBe('https://cdn.other/a.m3u8');
    expect(resolveAgainstBase('a.m3u8', 'not-a-url')).toBeNull();
    expect(resolveAgainstBase('chrome-extension://x/a.mp3', BASE)).toBeNull();
  });
});

describe('extractMediaUrlsFromScript：脚本正文提取媒体地址', () => {
  it('认出字符串字面量里的音视频与清单地址', () => {
    const src = `var p={src:"https://cdn.other/movie/main.mp4"}; fetch('/api/stream/index.m3u8'); u="http://a/b.mp3";`;
    const urls = extractMediaUrlsFromScript(src, BASE).map((c) => c.url);
    expect(urls).toContain('https://cdn.other/movie/main.mp4');
    expect(urls).toContain('https://s.example.com/api/stream/index.m3u8');
    expect(urls).toContain('http://a/b.mp3');
  });

  it('非媒体字符串与噪声一律不进候选', () => {
    // `.mp4` 后面还跟着字母（mp4boot）不算扩展名；CSS 选择器与键名更不是地址
    const src = `const css=".video-player{color:red}"; const key="apiKey"; const t="player.mp4boot";`;
    const urls = extractMediaUrlsFromScript(src, BASE).map((c) => c.url);
    expect(urls).toEqual([]);
  });

  it('同一路径重复出现只留一条；带查询的签名地址各自保留', () => {
    const src = `a="/v/1.mp4"; b="/v/1.mp4"; c="/v/1.mp4?sign=x"; d="/v/1.mp4?sign=y";`;
    const urls = extractMediaUrlsFromScript(src, BASE).map((c) => c.url);
    expect(urls.filter((u) => u.endsWith('/v/1.mp4'))).toHaveLength(1);
    expect(urls.filter((u) => u.includes('sign='))).toHaveLength(2);
  });

  it('转义斜杠写法与反引号模板都能识别', () => {
    const src = 'const a = "https:\\/\\/cdn.other\\/seg.m3u8"; const b = `/media/track.m4a`;';
    const urls = extractMediaUrlsFromScript(src, BASE).map((c) => c.url);
    expect(urls).toContain('https://cdn.other/seg.m3u8');
    expect(urls).toContain('https://s.example.com/media/track.m4a');
  });

  it('黑名单域（googleapis 等）即使带媒体扩展名也丢弃', () => {
    const src = 'const a = "https://fonts.googleapis.com/cdn/x.mp4";';
    expect(extractMediaUrlsFromScript(src, BASE)).toEqual([]);
  });

  it('空文本与超大文本直接返回空（超大文本由调用方截断后再扫）', () => {
    expect(extractMediaUrlsFromScript('', BASE)).toEqual([]);
    expect(extractMediaUrlsFromScript('a'.repeat(9 * 1024 * 1024), BASE)).toEqual([]);
  });
});

describe('mediaUrlsFromResourceEntries：资源账本转换', () => {
  it('保留媒体条目与其字节数，非媒体条目丢弃', () => {
    const out = mediaUrlsFromResourceEntries([
      { name: 'https://cdn.other/a.mp4', encodedBodySize: 1024, initiatorType: 'video' },
      { name: 'https://cdn.other/app.css', encodedBodySize: 512, initiatorType: 'css' },
      { name: 'https://cdn.other/seg-1.ts', encodedBodySize: 2048, initiatorType: 'fetch' }
    ]);
    expect(out.map((c) => c.url)).toEqual(['https://cdn.other/a.mp4', 'https://cdn.other/seg-1.ts']);
    expect(out[0].size).toBe(1024);
    expect(out[0].via).toBe('cache');
  });

  it('体积为 0（未统计）时留 undefined，不让表达式把「不知道」当成「很小」', () => {
    const out = mediaUrlsFromResourceEntries([{ name: 'https://cdn.other/a.mp3', encodedBodySize: 0 }]);
    expect(out[0].size).toBeUndefined();
  });
});

describe('scriptUrlsFromResourceEntries：深度搜索的抓取清单', () => {
  it('认 initiatorType 与路径形态两种线索；无 .js 后缀的打包 chunk 也算脚本', () => {
    const out = scriptUrlsFromResourceEntries([
      { name: 'https://s.example.com/app/player.js?v=1', initiatorType: 'script' },
      { name: 'https://s.example.com/app/player.js?v=1', initiatorType: 'script' },
      { name: 'https://cdn.other/vendor.chunk', initiatorType: 'script' },
      // 打包器用 import()/fetch 装载的 chunk：initiatorType 不是 script，但路径就是 .js
      { name: 'https://cdn.other/lazy-entry.js', initiatorType: 'fetch' },
      { name: 'blob:https://s.example.com/xyz', initiatorType: 'script' },
      { name: 'https://cdn.other/data.json', initiatorType: 'fetch' },
      // script 类型但明显是 JSONP：不该进脚本抓取清单
      { name: 'https://cdn.other/config.json', initiatorType: 'script' }
    ]);
    expect(out).toEqual([
      'https://s.example.com/app/player.js?v=1',
      'https://cdn.other/vendor.chunk',
      'https://cdn.other/lazy-entry.js'
    ]);
  });
});

describe('filterNewCandidates / backfillSweepRecords：入库合并语义', () => {
  const cand = { url: 'https://cdn.other/a.mp4', kind: 'video' as const, via: 'deep' as const, extension: 'mp4', size: 500 };

  it('判重口径与嗅探存量一致：忽略 hash，但查询串（签名）不同视为不同资源', () => {
    expect(filterNewCandidates([cand], ['https://cdn.other/a.mp4#t=0'])).toEqual([]);
    expect(filterNewCandidates([cand], ['https://cdn.other/a.mp4?x=1'])).toHaveLength(1);
    expect(filterNewCandidates([cand], ['https://cdn.other/b.mp4'])).toHaveLength(1);
  });

  it('同批重复只留第一条', () => {
    expect(filterNewCandidates([cand, { ...cand }], [])).toHaveLength(1);
  });

  it('补齐缺失字段，但绝不覆盖已有实测值', () => {
    const existing = [{ url: 'https://cdn.other/a.mp4', size: 9999 }, { url: 'https://cdn.other/a.mp4?x=1' }];
    // 第一条已有实测体积（9999）必须原样保留；第二条没体积，允许被推断值补上
    const filled = backfillSweepRecords(existing, [cand, { ...cand, url: 'https://cdn.other/a.mp4?x=1', size: 1 }]);
    expect(existing[0].size).toBe(9999);
    expect(existing[0].extension).toBe('mp4');
    expect(existing[1].size).toBe(1);
    expect(filled).toBe(2);
    const open = [{ url: 'https://cdn.other/a.mp4' }];
    expect(backfillSweepRecords(open, [cand])).toBe(1);
    expect(open[0].size).toBe(500);
    expect(open[0].extension).toBe('mp4');
  });
});
