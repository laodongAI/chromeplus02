import { describe, expect, it } from 'vitest';
import type { ArticleBlock, InlineSpan } from '@/core/articleBlocks';
import {
  buildArchiveHtml, flattenBlocks, htmlEscape, inlineAssets, resolveHighlightRanges,
  sanitizeArchiveUrl, spansToHtml, type ArchiveMeta
} from '@/core/archive';

const META: ArchiveMeta = { title: '测试归档', url: 'https://a.com/p?utm_source=x', capturedAt: Date.UTC(2026, 10, 12, 8, 30) };

/** 段落快捷构造 */
function para(...spans: InlineSpan[]): ArticleBlock {
  return { type: 'paragraph', spans };
}

describe('sanitizeArchiveUrl：协议白名单', () => {
  it('放行 http/https/data:image/mailto', () => {
    expect(sanitizeArchiveUrl('https://a.com/a.png')).toBe('https://a.com/a.png');
    expect(sanitizeArchiveUrl('http://a.com')).toBe('http://a.com');
    expect(sanitizeArchiveUrl('data:image/png;base64,AAAA')).toBe('data:image/png;base64,AAAA');
    expect(sanitizeArchiveUrl('mailto:a@b.com')).toBe('mailto:a@b.com');
  });

  it('拦下 javascript:/vbscript:/data:text/html 与相对协议', () => {
    expect(sanitizeArchiveUrl('javascript:alert(1)')).toBe('');
    expect(sanitizeArchiveUrl('JaVaScRiPt:alert(1)')).toBe('');
    expect(sanitizeArchiveUrl('vbscript:msgbox(1)')).toBe('');
    expect(sanitizeArchiveUrl('data:text/html,<script>alert(1)</script>')).toBe('');
    expect(sanitizeArchiveUrl('//a.com/x.js')).toBe('');
    expect(sanitizeArchiveUrl('/rel/path')).toBe('');
  });

  it('协议名里插控制字符/空白也照样拦（先剥再判）', () => {
    expect(sanitizeArchiveUrl('java\tscript:alert(1)')).toBe('');
    expect(sanitizeArchiveUrl('java\u0000script:alert(1)')).toBe('');
    expect(sanitizeArchiveUrl('  \n javascript:alert(1)')).toBe('');
  });

  it('引号与尖括号百分号化，免得越出属性上下文', () => {
    expect(sanitizeArchiveUrl('https://a.com/?x="y"><img onerror=1>')).toBe('https://a.com/?x=%22y%22%3E%3Cimg%20onerror=1%3E');
  });

  it('地址里的空格写成 %20 而不是被删掉', () => {
    expect(sanitizeArchiveUrl('https://a.com/我的 图片.png')).toBe('https://a.com/我的%20图片.png');
  });

  it('空值返回空串', () => {
    expect(sanitizeArchiveUrl('')).toBe('');
    expect(sanitizeArchiveUrl(undefined as never)).toBe('');
  });
});

describe('htmlEscape / spansToHtml：文本一律转义', () => {
  it('转义 & < > " \'', () => {
    expect(htmlEscape(`<a href="x">&'</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;');
    expect(htmlEscape(null)).toBe('');
    expect(htmlEscape(123)).toBe('123');
  });

  it('强调标记包裹已转义的文本', () => {
    expect(spansToHtml([{ text: '<b>加粗</b>', mark: 'strong' }])).toBe('<strong>&lt;b&gt;加粗&lt;/b&gt;</strong>');
    expect(spansToHtml([{ text: 'code', mark: 'code' }, { text: '尾巴' }])).toBe('<code>code</code>尾巴');
    expect(spansToHtml([{ text: '删', mark: 'del' }, { text: '斜', mark: 'em' }])).toBe('<del>删</del><em>斜</em>');
  });

  it('安全链接带 rel，危险链接只留文字', () => {
    expect(spansToHtml([{ text: '点这里', href: 'https://a.com/x' }]))
      .toBe('<a href="https://a.com/x" rel="noopener noreferrer nofollow">点这里</a>');
    expect(spansToHtml([{ text: '点这里', href: 'javascript:alert(1)' }])).toBe('点这里');
  });

  it('空片段被丢弃；空白片段保留（HTML 自行折叠，删掉会把相邻两词粘在一起）', () => {
    expect(spansToHtml([{ text: '参见' }, { text: ' ' }, { text: '文档' }])).toBe('参见 文档');
    expect(spansToHtml([{ text: '' }, { text: '有效' }])).toBe('有效');
    expect(spansToHtml(undefined as never)).toBe('');
  });
});

describe('flattenBlocks：高亮的坐标系', () => {
  it('块间恰好一个空行，区间连续', () => {
    const { text, spans } = flattenBlocks([para({ text: '第一段' }), para({ text: '第二段' })]);
    expect(text).toBe('第一段\n\n第二段');
    expect(spans.map(s => ({ start: s.start, end: s.end }))).toEqual([{ start: 0, end: 3 }, { start: 5, end: 8 }]);
    expect(spans.every(s => text.slice(s.start, s.end) === flattenBlocks([s.block]).text)).toBe(true);
  });

  it('空白块跳过且不留分隔符', () => {
    const { text, spans } = flattenBlocks([para({ text: '  ' }), para({ text: '有内容' }), { type: 'hr' }]);
    expect(text).toBe('有内容\n\n——————');
    expect(spans).toHaveLength(2);
  });

  it('图片按可读占位参与全文（批注可以落在图注上）', () => {
    expect(flattenBlocks([{ type: 'image', src: 'https://a.com/1.png', alt: '架构图' }]).text).toBe('[图：架构图]');
  });

  it('非法输入返回空全文', () => {
    expect(flattenBlocks(undefined as never)).toEqual({ text: '', spans: [] });
  });
});

describe('inlineAssets：内联与白名单', () => {
  const img = (src: string): ArticleBlock => ({ type: 'image', src, alt: '图' });

  it('命中映射换成 data URL 并标记已内联', () => {
    const out = inlineAssets([img('https://a.com/1.png')], { 'https://a.com/1.png': 'data:image/png;base64,AAA' });
    expect(out[0]).toEqual({ type: 'image', src: 'data:image/png;base64,AAA', alt: '图', inlined: true });
  });

  it('未命中的安全地址原样保留', () => {
    const blocks = [img('https://a.com/1.png')];
    expect(inlineAssets(blocks, {})?.[0]).toBe(blocks[0]);
  });

  it('未命中且协议不可信的地址被清空（宁可少张图）', () => {
    const out = inlineAssets([img('javascript:alert(1)')], {});
    expect(out[0]).toEqual({ type: 'image', src: '', alt: '图' });
  });

  it('无映射时返回副本，不改入参', () => {
    const blocks = [para({ text: '文' })];
    const out = inlineAssets(blocks, undefined);
    expect(out).toEqual(blocks);
    expect(out).not.toBe(blocks);
  });
});

describe('resolveHighlightRanges：偏移校验与丢失计数', () => {
  const full = '第一段内容在这里。第二段内容在这里。';
  const anchor = (exact: string) => ({ exact, prefix: '', suffix: '' });

  it('偏移与全文吻合时直接采用', () => {
    expect(resolveHighlightRanges([{ anchor: anchor('第一段') , start: 0, end: 3 }], full))
      .toEqual({ ranges: [{ start: 0, end: 3 }], lost: 0 });
  });

  it('偏移失效（重新抓过正文）时按原文重搜', () => {
    const r = resolveHighlightRanges([{ anchor: anchor('第二段'), start: 999, end: 1002 }], full);
    expect(r.lost).toBe(0);
    expect(full.slice(r.ranges[0].start, r.ranges[0].end)).toBe('第二段');
  });

  it('偏移指向了别的文字也不算命中——按原文搜到的位置为准', () => {
    const r = resolveHighlightRanges([{ anchor: anchor('第二段'), start: 0, end: 3 }], full);
    expect(r.ranges[0].start).toBe(full.indexOf('第二段'));
  });

  it('原文里搜不到才计为定位失败，且只在批注清单出现', () => {
    const r = resolveHighlightRanges([
      { anchor: anchor('第一段'), start: 0, end: 3 },
      { anchor: anchor('站点已删掉的句子'), start: 0, end: 3 },
    ], full);
    expect(r.lost).toBe(1);
    expect(r.ranges).toEqual([{ start: 0, end: 3 }]);
  });

  it('空 exact 的条目直接过滤，不占 lost', () => {
    expect(resolveHighlightRanges([{ anchor: anchor('') }], full)).toEqual({ ranges: [], lost: 0 });
    expect(resolveHighlightRanges(undefined, full)).toEqual({ ranges: [], lost: 0 });
  });

  it('重叠区间合并成一段', () => {
    expect(resolveHighlightRanges([
      { anchor: anchor('第一段'), start: 0, end: 3 },
      { anchor: anchor('一段内容'), start: 1, end: 5 },
    ], full).ranges).toEqual([{ start: 0, end: 5 }]);
  });
});

describe('buildArchiveHtml：自包含单文件', () => {
  const blocks = [
    { type: 'heading', level: 1, spans: [{ text: '小节一' }] } as ArticleBlock,
    para({ text: '这是正文，包含 <script>alert(1)</script> 这样的字面量。' }),
    { type: 'heading', level: 2, spans: [{ text: '小节二' }] } as ArticleBlock,
    para({ text: '第二段正文。' }),
  ];

  it('产出完整文档骨架，且不带任何可执行脚本', () => {
    const html = buildArchiveHtml(META, blocks);
    expect(html.startsWith('<!DOCTYPE html>')).toBe(true);
    expect(html).toContain('<title>测试归档</title>');
    expect(html).toContain('</html>');
    // 正文里的 script 只剩字面量
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).not.toContain('<script>alert(1)</script>');
    // 除 JSON-LD 外不引任何脚本
    expect(html.match(/<script/g)).toHaveLength(1);
    expect(html).not.toContain('<script>alert');
  });

  it('标题生成目录，锚点 id 与目录条目同源', () => {
    const html = buildArchiveHtml(META, blocks);
    expect(html).toContain('<nav class="toc">');
    expect(html).toContain('<a href="#h-1">小节一</a>');
    expect(html).toContain('<a href="#h-2">小节二</a>');
    expect(html).toContain('<h2 id="h-1" class="h h1">小节一</h2>');
    expect(html).toContain('<h2 id="h-2" class="h h2">小节二</h2>');
  });

  it('标题不足两个时不出目录，可强制打开', () => {
    const onlyOne = [{ type: 'heading', level: 1, spans: [{ text: '唯一' }] } as ArticleBlock, para({ text: '正文' })];
    expect(buildArchiveHtml(META, onlyOne)).not.toContain('<nav class="toc">');
    expect(buildArchiveHtml(META, onlyOne, { toc: true })).toContain('<nav class="toc">');
  });

  it('纯文本段落注入 <mark>，富文本段落交回批注清单', () => {
    const html = buildArchiveHtml(META, [para({ text: '第一段文字内容' })], {
      highlights: [{ anchor: { exact: '段文字', prefix: '', suffix: '' }, start: 2, end: 5 }]
    });
    expect(html).toContain('<p>第一<mark>段文字</mark>内容</p>');
  });

  it('高亮偏移整体平移后仍能落在正文里（按原文重搜）', () => {
    const html = buildArchiveHtml(META, [para({ text: '前面有很多字才到关键句' })], {
      highlights: [{ anchor: { exact: '关键句', prefix: '', suffix: '' }, start: 0, end: 3 }]
    });
    expect(html).toContain('<mark>关键句</mark>');
  });

  it('带链接的段落不硬塞 mark，避免撕破标签', () => {
    const html = buildArchiveHtml(META, [para({ text: '参见', href: 'https://a.com/x' }, { text: '文档' })], {
      highlights: [{ anchor: { exact: '见文档', prefix: '', suffix: '' }, start: 1, end: 4 }]
    });
    expect(html).toContain('<a href="https://a.com/x" rel="noopener noreferrer nofollow">参见</a>文档');
    expect(html).not.toContain('</a><mark>');
  });

  it('批注清单列出原文与批注，并如实报告未定位条数', () => {
    const html = buildArchiveHtml(META, [para({ text: '正文在此' })], {
      highlights: [
        { anchor: { exact: '正文', prefix: '', suffix: '' }, start: 0, end: 2, note: '复习' },
        { anchor: { exact: '已被站点删掉的句子', prefix: '', suffix: '' } },
      ]
    });
    expect(html).toContain('高亮与批注（2，1 条未定位）');
    expect(html).toContain('<mark>正文</mark>');
    expect(html).toContain('批注：复习');
    expect(html).toContain('已被站点删掉的句子');
  });

  it('未内联的图片在页面上标注，并在页脚计数', () => {
    const html = buildArchiveHtml(META, [{ type: 'image', src: 'https://a.com/1.png', alt: '远程图' }]);
    expect(html).toContain('<span class="remote">未内联</span>');
    expect(html).toContain('正文内 1 张图片未内联');
  });

  it('图片内联后不再报未内联，页脚换成完整归档说明', () => {
    const html = buildArchiveHtml(META, [{ type: 'image', src: 'https://a.com/1.png', alt: '图' }], {
      assets: { 'https://a.com/1.png': 'data:image/png;base64,AAA' }
    });
    expect(html).toContain('src="data:image/png;base64,AAA"');
    expect(html).not.toContain('未内联');
    expect(html).toContain('正文、图片、高亮批注均已内嵌');
  });

  it('正文含 </script> 时 JSON-LD 不会提前闭合', () => {
    const html = buildArchiveHtml({ ...META, title: '恶意</script><img onerror=alert(1)>' }, [para({ text: '正文' })]);
    expect(html).not.toContain('</script><img');
    expect(html.match(/<script/g)).toHaveLength(1);
    expect(html).toContain('\\u003c/script>');
  });

  it('信息条给出来源、抓取时刻与补充字段，危险来源地址不生成链接', () => {
    const html = buildArchiveHtml({
      ...META, author: '张三', publishedAt: '2026-11-01', keywords: ['ai', '抓取'],
      extra: { 栏目: '深度', 空字段: '' }
    }, [para({ text: '正文' })]);
    expect(html).toContain('<b>作者</b> 张三');
    expect(html).toContain('<b>原文发布</b> 2026-11-01');
    expect(html).toContain('<b>关键词</b> ai、抓取');
    expect(html).toContain('<b>栏目</b> 深度');
    expect(html).not.toContain('空字段');
    expect(html).toContain('rel="noopener noreferrer nofollow"');
    expect(html).toContain('referrer" content="no-referrer');
    expect(buildArchiveHtml({ ...META, url: 'javascript:alert(1)' }, [para({ text: '正文' })]))
      .toContain('<b>来源</b> （无来源地址）');
  });

  it('代码块/表格/列表/引用按结构渲染且单元格被转义', () => {
    const html = buildArchiveHtml(META, [
      { type: 'code', text: 'if (a < b) console.log("<x>")' },
      { type: 'table', header: ['名称', '值'], rows: [['<b>', '1']] },
      { type: 'list', ordered: true, start: 3, items: [[{ text: '第三步' }], [{ text: '第四步' }]] },
      { type: 'quote', spans: [{ text: '引用内容' }] },
      { type: 'hr' },
    ]);
    expect(html).toContain('<pre><code>if (a &lt; b) console.log(&quot;&lt;x&gt;&quot;)</code></pre>');
    expect(html).toContain('<th>名称</th><th>值</th>');
    expect(html).toContain('<td>&lt;b&gt;</td>');
    expect(html).toContain('<ol start="3"><li>第三步</li><li>第四步</li></ol>');
    expect(html).toContain('<blockquote>引用内容</blockquote>');
    expect(html).toContain('<hr>');
  });

  it('空白正文也只产出合法骨架，不抛错', () => {
    const html = buildArchiveHtml({ ...META, title: '' }, []);
    expect(html).toContain('<title>未命名归档</title>');
    expect(html).toContain('<article>\n\n</article>');
  });

  it('头部 meta 记录归档指纹（条数与丢失数）供后续回读', () => {
    const html = buildArchiveHtml(META, [para({ text: '正文在此' })], {
      highlights: [{ anchor: { exact: '正文', prefix: '', suffix: '' }, start: 0, end: 2 }]
    });
    expect(html).toContain('content="{&quot;url&quot;:&quot;https://a.com/p?utm_source=x&quot;');
    expect(html).toContain('&quot;highlights&quot;:1,&quot;lost&quot;:0}');
  });
});
