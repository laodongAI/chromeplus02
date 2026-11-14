import { describe, it, expect } from 'vitest';
import {
  MAX_SUBTITLE_CUES,
  MIN_CUE_DURATION,
  clampCuesToDuration,
  formatTimestamp,
  isVttFileName,
  parseSubtitle,
  serializeSrt,
  serializeVtt,
  shiftCues,
  stripCueMarkup,
} from '@/core/srt';

describe('formatTimestamp：秒 → 时间戳', () => {
  it('补齐时/分/秒与三位毫秒', () => {
    expect(formatTimestamp(0)).toBe('00:00:00,000');
    expect(formatTimestamp(3661.5)).toBe('01:01:01,500');
    expect(formatTimestamp(9.05)).toBe('00:00:09,050');
  });

  it('句点分隔即 VTT 形态', () => {
    expect(formatTimestamp(3661.5, '.')).toBe('01:01:01.500');
  });

  it('负数与 NaN 归零，绝不产出 NaN:NaN', () => {
    expect(formatTimestamp(-5)).toBe('00:00:00,000');
    expect(formatTimestamp(NaN)).toBe('00:00:00,000');
    expect(formatTimestamp(Infinity)).toBe('00:00:00,000');
  });

  it('毫秒四舍五入后仍保持单调（1.9996 → 2.000）', () => {
    expect(formatTimestamp(1.9996)).toBe('00:00:02,000');
  });
});

describe('parseSubtitle：SRT 主体', () => {
  it('标准多段 SRT 完整解析，正文保留换行', () => {
    const text = `1\n00:00:01,000 --> 00:00:02,500\nHello\n\n2\n00:00:02,500 --> 00:00:04,000\n世界\n第二行\n`;
    const r = parseSubtitle(text);
    expect(r.errors).toEqual([]);
    expect(r.cues).toHaveLength(2);
    expect(r.cues[0]).toEqual({ start: 1, end: 2.5, text: 'Hello' });
    expect(r.cues[1].text).toBe('世界\n第二行');
  });

  it('CRLF、BOM、缺序号都能读（真实文件里这三种很常见）', () => {
    const text = '\uFEFF00:00:00,500 --> 00:00:01,200\r\n第一句\r\n';
    const r = parseSubtitle(text);
    expect(r.cues).toEqual([{ start: 0.5, end: 1.2, text: '第一句' }]);
    expect(r.errors).toEqual([]);
  });

  it('可省小时、毫秒分隔符可用句点', () => {
    const r = parseSubtitle('1:02.500 --> 1:05,000\n文本');
    expect(r.cues[0].start).toBeCloseTo(62.5);
    expect(r.cues[0].end).toBe(65);
  });

  it('时间戳倒置的条目跳过并记账，不影响其余条目', () => {
    const text = '1\n00:00:05,000 --> 00:00:01,000\n坏的\n\n2\n00:00:06,000 --> 00:00:07,000\n好的\n';
    const r = parseSubtitle(text);
    expect(r.cues).toHaveLength(1);
    expect(r.cues[0].text).toBe('好的');
    expect(r.errors.join('')).toContain('时间戳非法');
  });

  it('起止相同（手工补的坏条目）按最短时长撑开，否则字幕一闪即没', () => {
    const r = parseSubtitle('00:00:03,000 --> 00:00:03,000\n同刻');
    expect(r.cues[0].end - r.cues[0].start).toBeCloseTo(MIN_CUE_DURATION);
  });

  it('无正文与无时间戳的块各自报错并跳过', () => {
    const r = parseSubtitle('1\n00:00:01,000 --> 00:00:02,000\n   \n\n2\n纯文字块\n');
    expect(r.cues).toHaveLength(0);
    expect(r.errors).toHaveLength(2);
    expect(r.errors.join('')).toContain('没有正文');
    expect(r.errors.join('')).toContain('缺少时间戳行');
  });

  it('结果按起始时间排序（乱序文件不会让字幕叠在错位置）', () => {
    const r = parseSubtitle('00:00:09,000 --> 00:00:10,000\n后\n\n00:00:01,000 --> 00:00:02,000\n前\n');
    expect(r.cues.map((c) => c.text)).toEqual(['前', '后']);
  });

  it('空输入返回空结果而不是抛错', () => {
    for (const v of ['', '   ', '\n\n', undefined as unknown as string]) {
      const r = parseSubtitle(v);
      expect(r.cues).toEqual([]);
    }
  });

  it('超过上限只截断并告知，不把整篇判废', () => {
    const many = Array.from({ length: MAX_SUBTITLE_CUES + 3 }, (_, i) =>
      `${i + 1}\n${formatTimestamp(i)} --> ${formatTimestamp(i + 1)}\nC${i}`).join('\n\n');
    const r = parseSubtitle(many);
    expect(r.cues).toHaveLength(MAX_SUBTITLE_CUES);
    expect(r.truncated).toBe(3);
    expect(r.errors.join('')).toContain('未导入');
  });
});

describe('parseSubtitle：VTT 兼容', () => {
  it('WEBVTT 头、NOTE 块、行内 align/position 设置都不产生假告警', () => {
    const text = 'WEBVTT\n\nNOTE 由 MediaPlus 导出\n\n1\n00:00:01.000 --> 00:00:02.000 align:start position:0%\n字幕一\n\n2\n00:00:02.000 --> 00:00:03.000\n字幕二\n';
    const r = parseSubtitle(text);
    expect(r.errors).toEqual([]);
    expect(r.cues.map((c) => c.text)).toEqual(['字幕一', '字幕二']);
  });

  it('头行与首条字幕挤在同一块时只丢头行，字幕不能跟着丢', () => {
    const r = parseSubtitle('WEBVTT\n00:00:01.000 --> 00:00:02.000\n第一条');
    expect(r.cues).toHaveLength(1);
    expect(r.cues[0].text).toBe('第一条');
  });
});

describe('stripCueMarkup：内联标签', () => {
  it('<br> 转换行，其余标签删除，常见实体解码', () => {
    expect(stripCueMarkup('<i>强调</i><br/>下一行')).toBe('强调\n下一行');
    expect(stripCueMarkup('<c.white>A &amp; B</c.white>')).toBe('A & B');
    expect(stripCueMarkup('&nbsp;x&#39;')).toBe(" x'");
  });
});

describe('序列化与回读', () => {
  it('SRT 产出可被自身解析回同一批字幕（往返一致）', () => {
    const cues = [
      { start: 0, end: 1.5, text: '第一句' },
      { start: 1.5, end: 3.25, text: '第二句\n换行' },
    ];
    const text = serializeSrt(cues);
    expect(text.split('\n')[0]).toBe('1');
    expect(text).toContain('00:00:01,500 --> 00:00:03,250');
    expect(parseSubtitle(text).cues).toEqual(cues);
  });

  it('VTT 产出带头与句点毫秒，同样可回读', () => {
    const cues = [{ start: 1, end: 2, text: '一句' }];
    const text = serializeVtt(cues, '测试');
    expect(text.startsWith('WEBVTT')).toBe(true);
    expect(text).toContain('NOTE 测试');
    expect(text).toContain('00:00:01.000 --> 00:00:02.000');
    expect(parseSubtitle(text).cues).toEqual(cues);
  });

  it('空字幕列表产出空文件（VTT 仍保留可用的头）', () => {
    expect(serializeSrt([])).toBe('');
    expect(serializeVtt([])).toBe('WEBVTT\n');
  });

  it('序号连续且从 1 开始（别的播放器按序号定位）', () => {
    const text = serializeSrt([{ start: 0, end: 1, text: 'a' }, { start: 1, end: 2, text: 'b' }]);
    const blocks = text.trim().split('\n\n');
    expect(blocks.map((b) => b.split('\n')[0])).toEqual(['1', '2']);
  });
});

describe('clampCuesToDuration / shiftCues：落到时间线', () => {
  it('起点越过片尾的条目丢弃，尾部越界的截到片尾', () => {
    const r = clampCuesToDuration([
      { start: 0, end: 5, text: 'a' },
      { start: 9, end: 20, text: 'b' },
      { start: 30, end: 40, text: 'c' },
    ], 10);
    expect(r.dropped).toBe(1);
    expect(r.cues).toEqual([{ start: 0, end: 5, text: 'a' }, { start: 9, end: 10, text: 'b' }]);
  });

  it('时长未知（0 或非法）时不裁剪——宁可不截也不误删', () => {
    const cues = [{ start: 5, end: 9, text: 'a' }];
    expect(clampCuesToDuration(cues, 0).cues).toHaveLength(1);
    expect(clampCuesToDuration(cues, NaN).cues).toHaveLength(1);
  });

  it('整体偏移加到每条字幕，起点不会为负', () => {
    const shifted = shiftCues([{ start: 1, end: 2, text: 'a' }, { start: 3, end: 4, text: 'b' }], 10);
    expect(shifted[0]).toEqual({ start: 11, end: 12, text: 'a' });
    expect(shiftCues([{ start: 1, end: 2, text: 'a' }], -5)[0].start).toBe(0);
    expect(shiftCues([{ start: 1, end: 2, text: 'a' }], NaN)[0].start).toBe(1);
  });
});

describe('isVttFileName', () => {
  it('按扩展名判断，大小写无关', () => {
    expect(isVttFileName('a.vtt')).toBe(true);
    expect(isVttFileName('A.VTT')).toBe(true);
    expect(isVttFileName('a.srt')).toBe(false);
    expect(isVttFileName('')).toBe(false);
  });
});
