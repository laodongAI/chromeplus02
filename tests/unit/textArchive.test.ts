import { describe, it, expect } from 'vitest';
/**
 * 文本抓取落盘层子测（Round 6 #35）：命名模板、frontmatter 字段口径、
 * Markdown 出口（结构化正文优先 + 高亮附录）、归档元数据与高亮定位计数。
 * 未覆盖边界：chrome.storage 读写与图片内联 fetch 依赖浏览器上下文，不在 node 单测范围。
 */
import {
  DEFAULT_TEMPLATE,
  buildArchiveMeta,
  buildFrontmatter,
  buildMarkdown,
  countLocatable,
  docFilename,
  toArchiveHighlights
} from '@/sidepanel/services/textArchive';
import { makeAnchor, type StoredHighlight } from '@/core/textHighlight';
import { flattenBlocks } from '@/core/archive';
import type { ArticleBlock } from '@/core/articleBlocks';
import type { TextContentDTO } from '@/messaging';

const BLOCKS: ArticleBlock[] = [
  { type: 'heading', level: 2, spans: [{ text: '小节标题' }] },
  { type: 'paragraph', spans: [{ text: '第一段正文，含关键结论。' }] },
  { type: 'table', header: ['列A', '列B'], rows: [['1', '2']] }
];

function makeContent(over: Partial<TextContentDTO> = {}): TextContentDTO {
  return {
    title: '测试文章',
    textContent: '第一段正文，含关键结论。',
    wordCount: 14,
    blocks: BLOCKS,
    url: 'https://example.com/post?id=1',
    canonicalUrl: 'https://example.com/post',
    siteName: '示例站',
    ...over
  };
}

/** 按正文全文造一条真高亮：锚点与偏移都出自同一份文本，定位必然命中 */
function makeHighlight(fullText: string, exact: string, note = '', over: Partial<StoredHighlight> = {}): StoredHighlight {
  const start = fullText.indexOf(exact);
  return {
    id: `h-${exact}`,
    url: 'https://example.com/post',
    title: '测试文章',
    anchor: start >= 0 ? makeAnchor(fullText, start, start + exact.length) : { exact, prefix: '', suffix: '' },
    note,
    createdAt: 1_700_000_000_000,
    start,
    end: start >= 0 ? start + exact.length : -1,
    ...over
  };
}

describe('docFilename：命名模板 → 合法文件名', () => {
  it('默认模板产出 日期-标题.md', () => {
    const name = docFilename(makeContent(), 'md');
    expect(name).toMatch(/^\d{4}-\d{2}-\d{2}-测试文章\.md$/);
  });

  it('自定义模板里的 site/author/domain 全部替换', () => {
    const name = docFilename(makeContent({ author: '张三' }), 'html', '{site}-{author}-{domain}-{title}');
    expect(name).toBe('示例站-张三-example.com-测试文章.html');
  });

  it('标题里的非法文件名字符换成下划线，不产出带斜杠的路径', () => {
    const name = docFilename(makeContent({ title: 'a/b:c*d' }), 'md', '{title}');
    expect(name).toBe('a_b_c_d.md');
  });

  it('模板自带扩展名时不重复追加', () => {
    expect(docFilename(makeContent(), 'md', '{title}.md')).toBe('测试文章.md');
    expect(docFilename(makeContent(), 'html', '{title}.html')).toBe('测试文章.html');
  });

  it('空标题落到"未命名"，不产出只有扩展名的文件', () => {
    expect(docFilename(makeContent({ title: '' }), 'md', '{title}')).toBe('未命名.md');
  });

  it('缺 siteName 时用 hostname 兜底', () => {
    const name = docFilename(makeContent({ siteName: undefined }), 'md', '{site}');
    expect(name).toBe('example.com.md');
  });

  it('DEFAULT_TEMPLATE 就是 {date}-{title}', () => {
    expect(DEFAULT_TEMPLATE).toBe('{date}-{title}');
  });
});

describe('buildFrontmatter：空字段不写，来源取 canonical', () => {
  it('source 优先 canonicalUrl，带参分享链接归一到同一地址', () => {
    const data = buildFrontmatter(makeContent(), []);
    expect(data.source).toBe('https://example.com/post');
  });

  it('缺 canonicalUrl 时退回 url', () => {
    expect(buildFrontmatter(makeContent({ canonicalUrl: undefined }), []).source).toBe('https://example.com/post?id=1');
  });

  it('站点没给的可选字段一律不出现在 YAML 里', () => {
    const md = buildMarkdown(makeContent({ author: undefined, publishedAt: undefined, language: undefined, description: undefined, keywords: [] }), []);
    const head = md.split('---')[1] || '';
    for (const key of ['author', 'published', 'language', 'description', 'keywords', 'highlights']) {
      expect(head).not.toContain(`${key}:`);
    }
  });

  it('字数与抓取时刻总是写，高亮数仅在有高亮时写', () => {
    const plain = buildFrontmatter(makeContent(), []);
    expect(plain.word_count).toBe(14);
    expect(typeof plain.captured).toBe('string');
    expect(plain.highlights).toBeUndefined();

    const withHl = buildFrontmatter(makeContent(), [makeHighlight('第一段正文，含关键结论。', '关键结论')]);
    expect(withHl.highlights).toBe(1);
  });

  it('关键词最多带 20 个，避免 frontmatter 比正文还长', () => {
    const keywords = Array.from({ length: 30 }, (_, i) => `k${i}`);
    expect(buildFrontmatter(makeContent({ keywords }), []).keywords).toHaveLength(20);
  });
});

describe('buildMarkdown：结构化正文优先，高亮进附录', () => {
  it('有 blocks 时保留标题层级与表格，而不是拍平的纯文本', () => {
    const md = buildMarkdown(makeContent(), []);
    expect(md).toContain('## 小节标题');
    expect(md).toContain('| 列A | 列B |');
    expect(md).toContain('| --- | --- |');
  });

  it('没有 blocks 时退回 textContent，旧数据照样能导出', () => {
    const md = buildMarkdown(makeContent({ blocks: undefined }), []);
    expect(md).toContain('第一段正文，含关键结论。');
    expect(md).not.toContain('## 小节标题');
  });

  it('blocks 为空数组同样退回 textContent', () => {
    expect(buildMarkdown(makeContent({ blocks: [] }), [])).toContain('第一段正文，含关键结论。');
  });

  it('有高亮时追加「高亮与批注」附录，批注跟在引用块里', () => {
    const fullText = flattenBlocks(BLOCKS).text;
    const md = buildMarkdown(makeContent(), [makeHighlight(fullText, '关键结论', '这里要复查')]);
    expect(md).toContain('## 高亮与批注');
    expect(md).toContain('> 1. 关键结论');
    expect(md).toContain('—— 批注：这里要复查');
  });

  it('无批注的高亮只写引用，不写空的批注行', () => {
    const fullText = flattenBlocks(BLOCKS).text;
    const md = buildMarkdown(makeContent(), [makeHighlight(fullText, '关键结论')]);
    expect(md).toContain('> 1. 关键结论');
    expect(md).not.toContain('—— 批注：');
  });

  it('没有高亮时不产出空附录', () => {
    expect(buildMarkdown(makeContent(), [])).not.toContain('## 高亮与批注');
  });

  it('空锚点的高亮被跳过，不产出半截引用行', () => {
    const md = buildMarkdown(makeContent(), [makeHighlight('', '', '', { anchor: { exact: '  ', prefix: '', suffix: '' } })]);
    expect(md).not.toContain('> 1.');
  });
});

describe('buildArchiveMeta：归档元数据与截断提示', () => {
  it('url 取 canonical，字数进 extra', () => {
    const meta = buildArchiveMeta(makeContent());
    expect(meta.url).toBe('https://example.com/post');
    expect(meta.title).toBe('测试文章');
    expect(meta.extra?.字数).toBe('14');
    expect(typeof meta.capturedAt).toBe('number');
  });

  it('正文被截断时如实标注，未截断则不写提示', () => {
    expect(buildArchiveMeta(makeContent({ truncated: true })).extra?.提示).toBeTruthy();
    expect(buildArchiveMeta(makeContent({ truncated: false })).extra?.提示).toBeUndefined();
  });

  it('空标题落到"未命名归档"', () => {
    expect(buildArchiveMeta(makeContent({ title: '' })).title).toBe('未命名归档');
  });
});

describe('toArchiveHighlights：-1 偏移视为未知', () => {
  it('算不出偏移的高亮不带 start/end，交给归档层按锚点重搜', () => {
    const [hl] = toArchiveHighlights([makeHighlight('', '不在正文里的句子')]);
    expect(hl.start).toBeUndefined();
    expect(hl.end).toBeUndefined();
    expect(hl.anchor.exact).toBe('不在正文里的句子');
  });

  it('有效偏移原样带走，批注不丢', () => {
    const fullText = flattenBlocks(BLOCKS).text;
    const [hl] = toArchiveHighlights([makeHighlight(fullText, '关键结论', '批注')]);
    expect(hl.start).toBeGreaterThanOrEqual(0);
    expect(hl.end).toBeGreaterThan(hl.start!);
    expect(hl.note).toBe('批注');
  });
});

describe('countLocatable：区分"落在正文里"与"只进批注清单"', () => {
  const fullText = flattenBlocks(BLOCKS).text;

  it('命中的计入 located，落空的计入 lost', () => {
    const list = [makeHighlight(fullText, '关键结论'), makeHighlight('', '页脚推荐语')];
    expect(countLocatable(BLOCKS, list)).toEqual({ located: 1, lost: 1 });
  });

  it('全部命中时 lost 为 0', () => {
    expect(countLocatable(BLOCKS, [makeHighlight(fullText, '小节标题')])).toEqual({ located: 1, lost: 0 });
  });

  it('空列表不报错', () => {
    expect(countLocatable(BLOCKS, [])).toEqual({ located: 0, lost: 0 });
    expect(countLocatable([], [])).toEqual({ located: 0, lost: 0 });
  });

  it('偏移失效但锚点仍在正文里时，靠锚点兜底命中', () => {
    const stale = makeHighlight(fullText, '关键结论', '', { start: 9999, end: 99999 });
    expect(countLocatable(BLOCKS, [stale]).located).toBe(1);
  });
});