/**
 * 过滤表达式解析与求值单测（Round 5 #28）。
 * 面板输入是用户实时敲的，所以「语法错误只回描述、绝不抛」和
 * 「字段未知一律不匹配」两条契约比功能本身更重要，逐条钉住。
 */
import { describe, it, expect } from 'vitest';
import { parseFilterExpr, matchesFilter, compileFilter } from '@/core/mediaFilter';
import type { MediaMetaFacts } from '@/core/mediaMeta';

const mp3 = (over: Partial<MediaMetaFacts> = {}): MediaMetaFacts => ({
  url: 'https://cdn.example.com/audio/song.mp3', title: '青花瓷',
  kind: 'audio', extension: 'mp3', size: 8 * 1024 * 1024, duration: 240, ...over
});

/** 表达式 → 判定（假定语法正确，错误路径另有专测） */
const hit = (expr: string, facts: MediaMetaFacts) => {
  const { node, error } = parseFilterExpr(expr);
  if (error) throw new Error(`表达式应合法：${expr} → ${error}`);
  return matchesFilter(node, facts);
};

describe('数值字段与单位换算', () => {
  it('size 支持 1024 进制的 B/KB/MB/GB/TB 与 K/M/G 简写', () => {
    expect(hit('size>5MB', mp3())).toBe(true);
    expect(hit('size>10MB', mp3())).toBe(false);
    expect(hit('size>=8m', mp3())).toBe(true);
    expect(hit('size<1GB', mp3())).toBe(true);
    expect(hit('size>8388608', mp3({ size: 8388609 }))).toBe(true);
  });

  it('duration 无单位按秒，m/h 换算成秒', () => {
    expect(hit('duration>=4m', mp3())).toBe(true);
    expect(hit('duration>=5m', mp3())).toBe(false);
    expect(hit('duration<1h', mp3())).toBe(true);
    expect(hit('duration>200', mp3())).toBe(true);
  });

  it('res/height 接受 1080p 与 4k 这类档位写法', () => {
    const video = mp3({ kind: 'video', extension: 'mp4', width: 1920, height: 1080 });
    const uhd = mp3({ kind: 'video', extension: 'mp4', width: 3840, height: 2160 });
    expect(hit('res>=1080p', video)).toBe(true);
    expect(hit('res>=4k', video)).toBe(false);
    // 4k 按 2160 行理解，不是按 4000
    expect(hit('res>=4k', uhd)).toBe(true);
    expect(hit('height>=720 and width<=1920', video)).toBe(true);
  });

  it('字段未知时不匹配（不把「不知道」当成 0）', () => {
    const unknown = { url: 'https://a.com/stream/1', kind: 'audio' } as MediaMetaFacts;
    expect(hit('size>0', unknown)).toBe(false);
    expect(hit('size<999GB', unknown)).toBe(false);
    expect(hit('duration>0', unknown)).toBe(false);
    expect(hit('res>=480p', unknown)).toBe(false);
  });
});

describe('文本字段与裸词', () => {
  it('format 同时认标签与扩展名，= 精确、~ 包含', () => {
    expect(hit('format=mp3', mp3())).toBe(true);
    expect(hit('format=m4a', mp3())).toBe(false);
    expect(hit('format!=mp3', mp3())).toBe(false);
    expect(hit('format=hls', mp3({ extension: 'm3u8', kind: 'hls' }))).toBe(true);
    expect(hit('format~mp', mp3())).toBe(true);
  });

  it('kind/type 判定流类别', () => {
    expect(hit('kind=audio', mp3())).toBe(true);
    expect(hit('type=hls', mp3())).toBe(false);
    expect(hit('kind=hls or kind=dash', mp3({ kind: 'dash' }))).toBe(true);
  });

  it('裸词按可检索文本包含匹配（标题/地址/格式/清晰度/类型）', () => {
    expect(hit('青花瓷', mp3())).toBe(true);
    expect(hit('周杰伦', mp3())).toBe(false);
    expect(hit('"cdn.example"', mp3())).toBe(true);
    expect(hit('song.mp3', mp3())).toBe(true);
  });
});

describe('逻辑组合', () => {
  it('and/or/not 与括号', () => {
    expect(hit('size>5MB and format=mp3', mp3())).toBe(true);
    expect(hit('size>5MB and format=m4a', mp3())).toBe(false);
    expect(hit('not (format=m4a or kind=video)', mp3())).toBe(true);
    expect(hit('(size>10MB or duration<3m) and format=mp3', mp3())).toBe(false);
    expect(hit('(size>10MB or duration<3m) or format=mp3', mp3())).toBe(true);
  });

  it('相邻条件可省略 and，&& || ! 同样可用', () => {
    expect(hit('format=mp3 size>5MB', mp3())).toBe(true);
    expect(hit('format=mp3 && size>50MB', mp3())).toBe(false);
    expect(hit('format=m4a || size>5MB', mp3())).toBe(true);
    expect(hit('!format=m4a', mp3())).toBe(true);
  });

  it('空表达式不过滤', () => {
    for (const blank of ['', '   ', '\t\n']) {
      const r = parseFilterExpr(blank);
      expect(r.node).toBeNull();
      expect(r.error).toBeUndefined();
      expect(matchesFilter(r.node, mp3())).toBe(true);
    }
  });
});

describe('语法错误只回描述，不抛异常', () => {
  const bad = [
    'size>',              // 右值缺失
    'bitrate>100',        // 未知字段
    '(size>1MB and format=mp3', // 括号未闭合
    'name="青花',          // 引号未闭合
    'format>mp3',         // 文本字段用了 >
    'size~5',             // 数值字段用了 ~
    'size>1MB and and duration>1m',
    '1024',               // 裸数字
    'size>5LT',           // 非法体积单位
    'duration>5d',        // 非法时长单位
    'res>=3k',            // 不存在的清晰度档位
    'size&1MB'            // 符号写错的 and
  ];

  it.each(bad)('非法表达式「%s」被拒绝', (expr) => {
    const r = parseFilterExpr(expr);
    expect(r.node).toBeNull();
    expect(r.error).toBeTruthy();
  });

  it('错误信息可指导用户改写', () => {
    expect(parseFilterExpr('bitrate>100').error).toContain('未知字段');
    expect(parseFilterExpr('format>mp3').error).toContain('文本字段');
    expect(parseFilterExpr('size>').error).toContain('缺少比较值');
  });

  it('compileFilter 出错时给出 error 且 test 恒真（不清空列表）', () => {
    const c = compileFilter('size>>1MB');
    expect(c.error).toBeTruthy();
    expect(c.test(mp3())).toBe(true);
  });

  it('合法表达式的 compileFilter 与 parse+matches 结论一致', () => {
    const c = compileFilter('size>1MB and (format=mp3 or kind=video)');
    expect(c.error).toBeUndefined();
    expect(c.test(mp3())).toBe(true);
    expect(c.test({ url: 'https://a.com/x.wav', size: 4 * 1024 * 1024 } as MediaMetaFacts)).toBe(false);
  });
});
