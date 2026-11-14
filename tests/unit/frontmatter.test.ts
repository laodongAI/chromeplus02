import { describe, it, expect } from 'vitest';
/**
 * YAML frontmatter 子测：产出侧的加引号判定、读取侧的宽容解析、以及两者往返一致。
 * 未覆盖边界：真实 YAML 规范的非子集写法（多级嵌套、anchor/alias）不在支持范围，
 * 这类文件读回来按字符串处理即可，不做严格校验。
 */
import {
  buildMarkdownDoc, parseFrontmatter, stringifyFrontmatter, formatYamlValue,
} from '@/core/frontmatter';

describe('formatYamlValue：什么时候必须加引号', () => {
  it('普通中文/英文文本裸写', () => {
    expect(formatYamlValue('机器学习入门')).toBe('机器学习入门');
    expect(formatYamlValue('Hello World 2026')).toBe('Hello World 2026');
  });

  it('数字样与布尔样字符串加引号，避免读回来类型变了', () => {
    expect(formatYamlValue('2026')).toBe('"2026"');
    expect(formatYamlValue('true')).toBe('"true"');
    expect(formatYamlValue('null')).toBe('"null"');
    expect(formatYamlValue('3.14')).toBe('"3.14"');
  });

  it('含冒号、井号、引号等结构字符加引号并转义', () => {
    expect(formatYamlValue('a: b')).toBe('"a: b"');
    expect(formatYamlValue('say "hi"')).toBe('"say \\"hi\\""');
  });

  it('多行值写成单行转义标量，不用 block scalar', () => {
    expect(formatYamlValue('第一行\n第二行')).toBe('"第一行\\n第二行"');
  });

  it('首尾空白必须加引号，否则被解析器吃掉', () => {
    expect(formatYamlValue(' 带前导空格')).toBe('" 带前导空格"');
    expect(formatYamlValue('带尾随空格 ')).toBe('"带尾随空格 "');
  });

  it('空串、空值、数字、布尔', () => {
    expect(formatYamlValue('')).toBe("''");
    expect(formatYamlValue(null)).toBe("''");
    expect(formatYamlValue(undefined)).toBe("''");
    expect(formatYamlValue(1080)).toBe('1080');
    expect(formatYamlValue(true)).toBe('true');
  });

  it('NaN 不产出非法 YAML', () => {
    expect(formatYamlValue(NaN)).toBe("'NaN'");
  });
});

describe('stringifyFrontmatter：产出形态', () => {
  it('空文档返回空串，调用方据此不写头部', () => {
    expect(stringifyFrontmatter({})).toBe('');
    expect(stringifyFrontmatter(null)).toBe('');
  });

  it('undefined 字段整行跳过，键顺序即产出顺序', () => {
    const out = stringifyFrontmatter({ title: 'T', author: undefined, site: 'S' });
    expect(out).toBe('---\ntitle: T\nsite: S\n---\n');
  });

  it('数组写成块式列表', () => {
    const out = stringifyFrontmatter({ tags: ['机器学习', 'AI'] });
    expect(out).toBe('---\ntags:\n  - 机器学习\n  - AI\n---\n');
  });

  it('空数组写成行内空列表', () => {
    expect(stringifyFrontmatter({ tags: [] })).toBe('---\ntags: []\n---\n');
  });

  it('键名里的换行与冒号被清洗，防止用户可控 meta 写出假字段', () => {
    const out = stringifyFrontmatter({ 'evil: yes\nfake': 'v' });
    expect(out).toBe('---\nevil_yes_fake: v\n---\n');
  });

  it('中文键名保留', () => {
    expect(stringifyFrontmatter({ 栏目: '技术' })).toBe('---\n栏目: 技术\n---\n');
  });
});

describe('parseFrontmatter：宽容读取', () => {
  it('没有头部时整份当正文，不报错也不吞内容', () => {
    const r = parseFrontmatter('# 直接就是正文\n内容');
    expect(r.data).toEqual({});
    expect(r.body).toBe('# 直接就是正文\n内容');
  });

  it('头部未闭合时同样按整份正文处理', () => {
    const r = parseFrontmatter('---\ntitle: T\n没有闭合的分隔符');
    expect(r.data).toEqual({});
    expect(r.body).toContain('title: T');
  });

  it('解析标量、引号值与数组', () => {
    const r = parseFrontmatter('---\ntitle: "带: 冒号"\nwords: 1234\nok: true\nmissing: null\ntags:\n  - 甲\n  - 乙\n---\n正文');
    expect(r.data.title).toBe('带: 冒号');
    expect(r.data.words).toBe(1234);
    expect(r.data.ok).toBe(true);
    expect(r.data.missing).toBeNull();
    expect(r.data.tags).toEqual(['甲', '乙']);
    expect(r.body).toBe('正文');
  });

  it('BOM 与 CRLF 都能读', () => {
    const r = parseFrontmatter('﻿---\r\ntitle: T\r\n---\r\n正文');
    expect(r.data.title).toBe('T');
    expect(r.body).toBe('正文');
  });

  it('正文里再出现 --- 不会被当成头部结束符', () => {
    const r = parseFrontmatter('---\ntitle: T\n---\n第一段\n\n---\n\n第二段');
    expect(r.data.title).toBe('T');
    expect(r.body).toBe('第一段\n\n---\n\n第二段');
  });

  it('空数组与省略值', () => {
    const r = parseFrontmatter('---\ntags: []\nnote:\n---\n正文');
    expect(r.data.tags).toEqual([]);
    expect(r.data.note).toBe('');
  });
});

describe('frontmatter 往返一致', () => {
  it('写出再读回，字段与正文都不变形', () => {
    const data = { title: '深度解析:  transformer 模型', author: '张三', words: 5200, tags: ['AI', 'NLP'], summary: '第一行\n第二行' };
    const doc = stringifyFrontmatter(data) + '正文内容\n第二段落';
    const r = parseFrontmatter(doc);
    expect(r.data.title).toBe('深度解析:  transformer 模型');
    expect(r.data.author).toBe('张三');
    expect(r.data.words).toBe(5200);
    expect(r.data.tags).toEqual(['AI', 'NLP']);
    expect(r.data.summary).toBe('第一行\n第二行');
    expect(r.body).toBe('正文内容\n第二段落');
  });
});

describe('buildMarkdownDoc：整份文件组装', () => {
  it('头部 + H1 + 正文 + 结尾换行', () => {
    const doc = buildMarkdownDoc({ title: 'T' }, '正文', 'T');
    expect(doc.startsWith('---\ntitle: T\n---\n')).toBe(true);
    expect(doc).toContain('# T\n\n正文\n');
  });

  it('无标题时不硬造 H1', () => {
    expect(buildMarkdownDoc({}, '正文')).toBe('正文\n');
  });

  it('有标题时头部与 H1 之间空一行', () => {
    expect(buildMarkdownDoc({ title: 'T' }, '正文', '文章标题')).toBe('---\ntitle: T\n---\n\n# 文章标题\n\n正文\n');
  });

  it('正文为空时只剩头部，不产出多余空行', () => {
    expect(buildMarkdownDoc({ title: 'T' }, '')).toBe('---\ntitle: T\n---\n');
  });
});
