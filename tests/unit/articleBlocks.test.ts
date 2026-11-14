import { describe, it, expect } from 'vitest';
/**
 * 正文结构块渲染层单测。
 * 覆盖 Markdown / 纯文本两条出口里最容易出错的部分：强调合并边界、围栏长度自适应、
 * 表格补齐、标题层级钳位、空块不留残迹。
 * 未覆盖边界：DOM → 块 的走查在内容脚本里，node 环境无文档，只能在扩展页面里实测。
 */
import {
  blockToPlainText, blocksToMarkdown, blocksToPlainText, countPlainText,
  escapeMarkdown, inlineToMarkdown, inlineToPlainText,
  type ArticleBlock, type InlineSpan,
} from '@/core/articleBlocks';

const md = (...blocks: ArticleBlock[]) => blocksToMarkdown(blocks);
const txt = (...blocks: ArticleBlock[]) => blocksToPlainText(blocks);
const para = (...spans: InlineSpan[]): ArticleBlock => ({ type: 'paragraph', spans });
const head = (level: number, text: string): ArticleBlock => ({ type: 'heading', level, spans: [{ text }] });
const list = (ordered: boolean, start: number, ...items: string[][]): ArticleBlock => ({ type: 'list', ordered, start, items: items.map(g => g.map(t => ({ text: t }))) });

describe('escapeMarkdown：只转义改变结构的字符', () => {
  it('转义反斜杠、星号、下划线、反引号、方括号、尖括号、竖线', () => {
    expect(escapeMarkdown('a*b_c`d[e]<f>|g')).toBe('a\\*b\\_c\\`d\\[e\\]\\<f\\>\\|g');
    expect(escapeMarkdown('C:\\path')).toBe('C:\\\\path');
  });

  it('中文与常用标点保持原样', () => {
    expect(escapeMarkdown('这是一段中文，带标点。')).toBe('这是一段中文，带标点。');
  });

  it('空值安全', () => {
    expect(escapeMarkdown(undefined as unknown as string)).toBe('');
  });
});

describe('inlineToMarkdown：强调与链接', () => {
  it('按标记包裹', () => {
    expect(inlineToMarkdown([{ text: '重点', mark: 'strong' }])).toBe('**重点**');
    expect(inlineToMarkdown([{ text: '略', mark: 'em' }])).toBe('*略*');
    expect(inlineToMarkdown([{ text: '删掉', mark: 'del' }])).toBe('~~删掉~~');
    expect(inlineToMarkdown([{ text: 'npm i', mark: 'code' }])).toBe('`npm i`');
  });

  it('相邻同标记片段合并（被 DOM 拆碎的词不再断开）', () => {
    expect(inlineToMarkdown([{ text: '机器', mark: 'strong' }, { text: '学习', mark: 'strong' }])).toBe('**机器学习**');
  });

  it('句子边界不合并：跨句各成一段强调', () => {
    const spans = [{ text: '第一句。', mark: 'strong' as const }, { text: '第二句', mark: 'strong' as const }];
    expect(inlineToMarkdown(spans)).toBe('**第一句。****第二句**');
  });

  it('链接：标题里的方括号被剥掉，URL 空格与括号百分号化', () => {
    const spans = [{ text: '看这里', href: 'https://a.com/x y(1)' }];
    expect(inlineToMarkdown(spans)).toBe('[看这里](https://a.com/x%20y%281%29)');
  });

  it('行内代码里的反引号用加长围栏，不会提前闭合', () => {
    expect(inlineToMarkdown([{ text: 'a``b', mark: 'code' }])).toBe('```a``b```');
  });

  it('空白片段与空数组产出空串', () => {
    expect(inlineToMarkdown([{ text: '   ' }, { text: '' }])).toBe('');
    expect(inlineToMarkdown(undefined as unknown as InlineSpan[])).toBe('');
  });
});

describe('blocksToMarkdown：块级结构', () => {
  it('标题层级钳到 1-6', () => {
    expect(md(head(0, 'T'))).toBe('# T');
    expect(md(head(3, 'T'))).toBe('### T');
    expect(md(head(9, 'T'))).toBe('###### T');
  });

  it('引用每行都带 >', () => {
    const quote: ArticleBlock = { type: 'quote', spans: [{ text: '一行\n两行' }] };
    expect(md(quote)).toBe('> 一行\n> 两行');
  });

  it('无序列表用 -，有序列表按 start 编号', () => {
    expect(md(list(false, 1, ['甲'], ['乙']))).toBe('- 甲\n- 乙');
    expect(md(list(true, 3, ['甲'], ['乙']))).toBe('3. 甲\n4. 乙');
  });

  it('列表项内换行按两空格续行，不破坏列表结构', () => {
    const item: ArticleBlock = { type: 'list', ordered: false, start: 1, items: [[{ text: 'a\nb' }]] };
    expect(md(item)).toBe('- a\n  b');
  });

  it('代码块围栏：常规三反引号，内容自带围栏时加长', () => {
    const code: ArticleBlock = { type: 'code', lang: 'js', text: 'const a = `hi`;' };
    expect(md(code)).toBe('```js\nconst a = `hi`;\n```');
    // Markdown 样例本身：内容里的 ``` 会提前闭合三反引号围栏，必须加长
    const nested: ArticleBlock = { type: 'code', text: '```js\nx\n```' };
    const out = md(nested);
    expect(out.startsWith('````\n')).toBe(true);
    expect(out.endsWith('\n````')).toBe(true);
  });

  it('空代码块不产出围栏', () => {
    const code: ArticleBlock = { type: 'code', text: '   \n\n' };
    expect(md(code)).toBe('');
  });

  it('图片语法带 alt；无 src 的图片块被丢弃', () => {
    const img: ArticleBlock = { type: 'image', src: 'https://a.com/1.png', alt: '图示' };
    expect(md(img)).toBe('![图示](https://a.com/1.png)');
    const none: ArticleBlock = { type: 'image', src: '', alt: 'x' };
    expect(md(none)).toBe('');
  });

  it('表格：缺列补齐、分隔行齐全、单元格竖线转义', () => {
    const table: ArticleBlock = { type: 'table', header: ['甲', '乙'], rows: [['1', '2|3'], ['短']] };
    const lines = md(table).split('\n');
    expect(lines[0]).toBe('| 甲 | 乙 |');
    expect(lines[1]).toBe('| --- | --- |');
    expect(lines[2]).toBe('| 1 | 2\\|3 |');
    expect(lines[3]).toBe('| 短 |   |');
  });

  it('无表头的表格也要产出合法的表头行', () => {
    const table: ArticleBlock = { type: 'table', header: [], rows: [['a', 'b']] };
    const lines = md(table).split('\n');
    expect(lines[0]).toBe('|   |   |');
    expect(lines[1]).toBe('| --- | --- |');
  });

  it('分隔线与块间空行', () => {
    expect(md(para({ text: '上' }), { type: 'hr' }, para({ text: '下' }))).toBe('上\n\n---\n\n下');
  });

  it('空块与非法输入不抛错且产出空串', () => {
    expect(md()).toBe('');
    expect(blocksToMarkdown(undefined as unknown as ArticleBlock[])).toBe('');
    expect(md({ type: 'paragraph', spans: [] }, para({ text: '仅有的一段' }))).toBe('仅有的一段');
  });
});

describe('blockToPlainText / blocksToPlainText：纯文本口径', () => {
  it('列表用 · 与序号，代码缩进四空格', () => {
    expect(blockToPlainText(list(false, 1, ['甲'], ['乙']))).toBe('· 甲\n· 乙');
    expect(blockToPlainText(list(true, 2, ['甲']))).toBe('2. 甲');
    const code: ArticleBlock = { type: 'code', text: 'a\nb\n' };
    expect(blockToPlainText(code)).toBe('    a\n    b');
  });

  it('表格按列宽对齐，单元格内换行压成空格', () => {
    const table: ArticleBlock = { type: 'table', header: ['名字', '值'], rows: [['较长', '1'], ['短', '22']] };
    const lines = blockToPlainText(table).split('\n');
    expect(lines[0]).toBe('名字  值');
    expect(lines[1]).toBe('较长  1');
    expect(lines[2]).toBe('短   22');
  });

  it('图片按 alt 占位，无 alt 不占位', () => {
    const withAlt: ArticleBlock = { type: 'image', src: 'x', alt: '流程图' };
    const noAlt: ArticleBlock = { type: 'image', src: 'x', alt: '  ' };
    expect(blockToPlainText(withAlt)).toBe('[图：流程图]');
    expect(blockToPlainText(noAlt)).toBe('');
  });

  it('块间恰好一个空行，链接只留文字', () => {
    const block = para({ text: '参见' }, { text: '文档', href: 'https://a.com' });
    expect(txt(block, para({ text: '结束' }))).toBe('参见文档\n\n结束');
    expect(countPlainText([para({ text: 'abcd' })])).toBe(4);
  });

  it('全文与逐块口径一致（归档层高亮偏移坐标系靠这条不变量）', () => {
    const blocks = [head(2, '标题'), para({ text: '正文一段' }), { type: 'hr' } as ArticleBlock];
    expect(blocksToPlainText(blocks)).toBe(blocks.map(blockToPlainText).filter(Boolean).join('\n\n'));
  });
});

describe('inlineToPlainText', () => {
  it('相邻片段直接相接：DOM 把一个词拆成两个 strong 也不该多出空格', () => {
    expect(inlineToPlainText([{ text: 'a  b', mark: 'strong' }, { text: 'c' }])).toBe('a bc');
  });

  it('行内代码两侧补空格，避免与正文黏成一片', () => {
    const spans = [{ text: '执行' }, { text: 'npm i', mark: 'code' as const }, { text: '即可' }];
    expect(inlineToPlainText(spans)).toBe('执行 npm i 即可');
  });
});
