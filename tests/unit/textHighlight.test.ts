import { describe, expect, it } from 'vitest';
import {
  MAX_ANCHOR_CONTEXT, MAX_HIGHLIGHTS_PER_PAGE,
  appendHighlight, findNormalized, highlightsToMarkdown, isSamePage, locateAnchor,
  makeAnchor, mergeRanges, newHighlightId, normalizePageUrl, splitByHighlights,
  type StoredHighlight
} from '@/core/textHighlight';

/** 造一条高亮，只关心 appendHighlight 用到的字段 */
function hl(id: string, createdAt: number): StoredHighlight {
  return { id, url: 'https://a.com/p', title: 't', anchor: { exact: id, prefix: '', suffix: '' }, note: '', createdAt, start: 0, end: id.length };
}

describe('makeAnchor：由偏移生成锚点', () => {
  it('前后文各取上限长度', () => {
    const text = `${'前'.repeat(60)}选中内容${'后'.repeat(60)}`;
    const start = 60;
    const end = 64;
    const a = makeAnchor(text, start, end);
    expect(a.exact).toBe('选中内容');
    expect(a.prefix).toHaveLength(MAX_ANCHOR_CONTEXT);
    expect(a.suffix).toHaveLength(MAX_ANCHOR_CONTEXT);
    expect(a.prefix.endsWith('前')).toBe(true);
  });

  it('偏移越界时夹紧，不抛错', () => {
    expect(makeAnchor('短', -5, 99).exact).toBe('短');
  });

  it('区间非法（倒序/零长）时给出空锚点，让调用方拒绝入库', () => {
    expect(makeAnchor('abc', 2, 2).exact).toBe('');
    expect(makeAnchor('abc', 5, 1).exact).toBe('');
    const bad = makeAnchor('abc', 9, 12);
    expect(bad.exact).toBe('');
    expect(bad.prefix).toBe('');
    expect(bad.suffix).toBe('');
  });
});

describe('locateAnchor：重定位优先用记录偏移', () => {
  const text = '引言部分。这是被选中的句子。结尾部分。';
  const at = text.indexOf('被选中的句子');
  const anchor = makeAnchor(text, at, at + '被选中的句子'.length);

  it('偏移仍然指向同一段文字时直接返回', () => {
    const end = at + '被选中的句子'.length;
    expect(locateAnchor(text, anchor, { start: at, end })).toEqual({ start: at, end });
  });

  it('偏移失效后靠前后文重新找到', () => {
    const shifted = `补了一段前言${text.slice(0, at)}大大改写了${text.slice(at + '被选中的句子'.length)}`;
    // 原句被改写 → 前后文一起失效，定位不上时如实返回 null
    expect(locateAnchor(shifted, anchor, { start: 0, end: 3 })).toBeNull();
  });

  it('偏移失效但原文还在：按前后文命中', () => {
    const tail = `${text}这是被选中的句子。另一处结尾。`;
    const range = locateAnchor(tail, anchor, { start: 0, end: 1 });
    expect(range).not.toBeNull();
    expect(tail.slice(range!.start, range!.end)).toBe('被选中的句子');
    // 两处都出现时，前文完全吻合的第一处胜出
    expect(range!.start).toBe(at);
  });

  it('前后文都没有、且唯一出现：直接命中', () => {
    expect(locateAnchor(text, { exact: '被选中的句子', prefix: '', suffix: '' })).toEqual({ start: at, end: at + 6 });
  });

  it('多次出现且前后文投不出结果时取最靠前的一处', () => {
    const repeated = '重复 重复 重复';
    const r = locateAnchor(repeated, { exact: '重复', prefix: '', suffix: '' });
    expect(r).toEqual({ start: 0, end: 2 });
  });

  it('空白差异导致精确匹配失败时走归一化兜底', () => {
    const loose = '这里   有\n\n很多空白';
    const r = locateAnchor(loose, { exact: '有 很多', prefix: '', suffix: '' });
    expect(r).not.toBeNull();
    expect(loose.slice(r!.start, r!.end).replace(/\s+/g, ' ')).toBe('有 很多');
  });

  it('原文与锚点任一为空都不猜位置', () => {
    expect(locateAnchor('', anchor)).toBeNull();
    expect(locateAnchor(text, { exact: '', prefix: '', suffix: '' })).toBeNull();
  });

  it('锚点被站点改掉后返回 null，绝不贴到别处', () => {
    expect(locateAnchor('完全不同的正文内容', { exact: '被选中的句子', prefix: '', suffix: '' })).toBeNull();
  });
});

describe('findNormalized：忽略空白的定位并映射回原下标', () => {
  it('命中后返回原串下标（含被压缩的空白）', () => {
    const r = findNormalized('x  a   b  y', 'a b');
    expect(r).toEqual({ start: 3, end: 8 });
  });

  it('needle 自身首尾空白被忽略', () => {
    expect(findNormalized('hello world', '  world  ')).toEqual({ start: 6, end: 11 });
  });

  it('找不到返回 null', () => {
    expect(findNormalized('abc', 'xyz')).toBeNull();
    expect(findNormalized('', 'a')).toBeNull();
    expect(findNormalized('a', '')).toBeNull();
  });
});

describe('mergeRanges：重叠与相邻合并', () => {
  it('乱序输入先排序再合并', () => {
    expect(mergeRanges([{ start: 8, end: 10 }, { start: 0, end: 3 }, { start: 2, end: 5 }]))
      .toEqual([{ start: 0, end: 5 }, { start: 8, end: 10 }]);
  });

  it('包含关系不放大区间', () => {
    expect(mergeRanges([{ start: 0, end: 10 }, { start: 3, end: 5 }])).toEqual([{ start: 0, end: 10 }]);
  });

  it('恰好相邻合并成一段，中间断开则保留两段', () => {
    expect(mergeRanges([{ start: 0, end: 4 }, { start: 4, end: 8 }])).toEqual([{ start: 0, end: 8 }]);
    expect(mergeRanges([{ start: 0, end: 4 }, { start: 5, end: 8 }])).toEqual([{ start: 0, end: 4 }, { start: 5, end: 8 }]);
  });

  it('丢弃零长与非法区间', () => {
    expect(mergeRanges([{ start: 3, end: 3 }, { start: 5, end: 1 }, { start: 1, end: 2 }, { start: NaN, end: 4 } as never]))
      .toEqual([{ start: 1, end: 2 }]);
  });
});

describe('splitByHighlights：正文分段', () => {
  const text = '0123456789';

  it('无高亮时整段返回，调用方不必特判', () => {
    expect(splitByHighlights(text, [])).toEqual([{ start: 0, end: text.length, text, highlighted: false }]);
  });

  it('中间高亮切成普通/高亮/普通三段', () => {
    const parts = splitByHighlights(text, [{ start: 3, end: 6 }]);
    expect(parts.map(p => `${p.highlighted ? 'H' : 'N'}:${p.text}`)).toEqual(['N:012', 'H:345', 'N:6789']);
  });

  it('越界区间夹紧到文本长度，超出的部分忽略', () => {
    const parts = splitByHighlights('abc', [{ start: 1, end: 99 }, { start: 200, end: 300 }]);
    expect(parts.map(p => `${p.highlighted ? 'H' : 'N'}:${p.text}`)).toEqual(['N:a', 'H:bc']);
  });

  it('空文本不产出分段', () => {
    expect(splitByHighlights('', [])).toEqual([]);
  });
});

describe('normalizePageUrl / isSamePage：同一篇文章归一条', () => {
  it('去掉 fragment 与跟踪参数，保留业务参数', () => {
    expect(normalizePageUrl('https://a.com/p?id=7&utm_source=weixin#c3'))
      .toBe('https://a.com/p?id=7');
    expect(normalizePageUrl('https://a.com/p?spm=1.2&from=timeline&x=1')).toBe('https://a.com/p?x=1');
  });

  it('不认识的 query 一律保留（正文常在其中）', () => {
    expect(normalizePageUrl('https://a.com/p?mid=1&idx=2')).toBe('https://a.com/p?mid=1&idx=2');
  });

  it('非法 URL 原样返回，空串仍为空', () => {
    expect(normalizePageUrl('不是个链接')).toBe('不是个链接');
    expect(normalizePageUrl('   ')).toBe('');
  });

  it('分享链接与末尾斜杠差异视为同页', () => {
    expect(isSamePage('https://a.com/p?utm_source=x', 'https://a.com/p')).toBe(true);
    expect(isSamePage('https://a.com/p/', 'https://a.com/p')).toBe(true);
    expect(isSamePage('https://a.com/p', 'https://a.com/q')).toBe(false);
    expect(isSamePage('', '')).toBe(false);
  });
});

describe('newHighlightId', () => {
  it('同一毫秒连续生成也不重复', () => {
    const ids = new Set(Array.from({ length: 50 }, () => newHighlightId()));
    expect(ids.size).toBe(50);
    expect([...ids].every(id => id.startsWith('hl_'))).toBe(true);
  });
});

describe('appendHighlight：上限与如实计数', () => {
  it('未达上限原样追加', () => {
    const r = appendHighlight([hl('a', 1)], hl('b', 2), 5);
    expect(r.list.map(x => x.id)).toEqual(['a', 'b']);
    expect(r.dropped).toBe(0);
  });

  it('超限丢最旧的，并报告丢了几条', () => {
    const list = [hl('a', 1), hl('b', 2), hl('c', 3)];
    const r = appendHighlight(list, hl('d', 4), 3);
    expect(r.dropped).toBe(1);
    expect(r.list.map(x => x.id)).toEqual(['b', 'c', 'd']);
    // 不改动入参
    expect(list).toHaveLength(3);
  });

  it('默认上限是常量，防止 storage 无界增长', () => {
    const big = Array.from({ length: MAX_HIGHLIGHTS_PER_PAGE }, (_, i) => hl(`k${i}`, i));
    const r = appendHighlight(big, hl('new', MAX_HIGHLIGHTS_PER_PAGE));
    expect(r.list).toHaveLength(MAX_HIGHLIGHTS_PER_PAGE);
    expect(r.dropped).toBe(1);
    expect(r.list[r.list.length - 1].id).toBe('new');
  });

  it('入参非数组时按空列表处理', () => {
    expect(appendHighlight(undefined as never, hl('x', 1)).list.map(i => i.id)).toEqual(['x']);
  });
});

describe('highlightsToMarkdown：批注清单', () => {
  it('有批注时追加署名行', () => {
    const md = highlightsToMarkdown([{ anchor: { exact: '原句', prefix: '', suffix: '' }, note: '这里要复看' }]);
    expect(md).toBe('> 1. 原句\n>     —— 批注：这里要复看');
  });

  it('无批注只留原文，不产出空标记', () => {
    expect(highlightsToMarkdown([{ anchor: { exact: '原句', prefix: '', suffix: '' } }])).toBe('> 1. 原句');
  });

  it('多条之间用引用空行分隔，空 exact 被跳过且序号连续', () => {
    const md = highlightsToMarkdown([
      { anchor: { exact: '第一句', prefix: '', suffix: '' }, note: 'a' },
      { anchor: { exact: '   ', prefix: '', suffix: '' } },
      { anchor: { exact: '第二  句', prefix: '', suffix: '' } },
    ]);
    expect(md).toBe('> 1. 第一句\n>     —— 批注：a\n>\n> 2. 第二 句');
  });

  it('空列表返回空串', () => {
    expect(highlightsToMarkdown([])).toBe('');
    expect(highlightsToMarkdown(undefined as never)).toBe('');
  });
});
