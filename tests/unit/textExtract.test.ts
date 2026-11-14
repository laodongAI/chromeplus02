/**
 * 正文容器打分与文本归一化单测（抓取深审 T2-C 之二）。
 * 缺陷背景：text.ts 原先取 querySelectorAll 的第一个命中（常是包住正文+侧栏的外层壳），
 * 无语义容器时直接取整个 document.body（导航/页脚/广告全进正文），
 * 且 slice(0,5000) 静默截断而 wordCount 报全长 → "显示 2 万字却只拿到 5 千字"。
 * 手法：只测纯函数；pickBestContainer / extractDenoisedBody 依赖真实渲染（innerText），
 *       不在 node 环境覆盖，属已知边界。
 */
import { describe, it, expect } from 'vitest';
import { scoreTextCandidate, normalizeExtractedText, MAX_TEXT_CHARS, type TextCandidateStats } from '@/content-scripts/text';

/** 构造打分输入，默认值代表"一个干净的正文容器" */
function stats(over: Partial<TextCandidateStats> = {}): TextCandidateStats {
  return { textLength: 3000, linkTextLength: 200, paragraphCount: 20, semanticBonus: 0, nestedCandidates: 0, ...over };
}

describe('scoreTextCandidate：选正文而不是选外壳', () => {
  it('article 胜过包住它的外层 wrapper（回归：原先取查询顺序第一个）', () => {
    const article = scoreTextCandidate(stats({ semanticBonus: 200 }));
    // 外壳文本更多，但链接密、段落奖励摊薄，且内含 1 个候选被罚分
    const wrapper = scoreTextCandidate(stats({
      textLength: 5000, linkTextLength: 1500, paragraphCount: 25, semanticBonus: 80, nestedCandidates: 1
    }));
    expect(article).toBeGreaterThan(wrapper);
  });

  it('导航型容器（链接占绝大多数）即使文本量大也输给短正文', () => {
    const nav = scoreTextCandidate(stats({ textLength: 8000, linkTextLength: 7600, paragraphCount: 0, semanticBonus: 80 }));
    const post = scoreTextCandidate(stats({ textLength: 1200, linkTextLength: 60, paragraphCount: 8, semanticBonus: 120 }));
    expect(post).toBeGreaterThan(nav);
  });

  it('段落数提供奖励：同样文本量下分段多的更像正文', () => {
    const many = scoreTextCandidate(stats({ paragraphCount: 30 }));
    const few = scoreTextCandidate(stats({ paragraphCount: 2 }));
    expect(many).toBeGreaterThan(few);
  });

  it('语义奖励单调：article > main > class 命中 > 无奖励', () => {
    const s = (bonus: number) => scoreTextCandidate(stats({ semanticBonus: bonus }));
    expect(s(200)).toBeGreaterThan(s(180));
    expect(s(180)).toBeGreaterThan(s(120));
    expect(s(120)).toBeGreaterThan(s(80));
    expect(s(80)).toBeGreaterThan(s(0));
  });

  it('嵌套候选逐个罚分，越外层的壳越吃亏', () => {
    const s = (n: number) => scoreTextCandidate(stats({ nestedCandidates: n }));
    expect(s(0)).toBeGreaterThan(s(1));
    expect(s(1)).toBeGreaterThan(s(3));
  });

  it('空容器得 0 分，不产生 NaN / 负无穷', () => {
    const score = scoreTextCandidate(stats({ textLength: 0, linkTextLength: 0, paragraphCount: 0 }));
    expect(score).toBe(0);
    expect(Number.isFinite(score)).toBe(true);
  });

  it('链接文本超过总文本（异常统计）时密度钳到 1，不产生负分爆炸', () => {
    const score = scoreTextCandidate(stats({ textLength: 100, linkTextLength: 900, paragraphCount: 0 }));
    expect(Number.isFinite(score)).toBe(true);
    expect(score).toBeLessThanOrEqual(0);
  });

  it('全是链接的容器得分为 0（非链接文本量为 0）', () => {
    expect(scoreTextCandidate(stats({ textLength: 500, linkTextLength: 500, paragraphCount: 0 }))).toBe(0);
  });
});

describe('normalizeExtractedText：保住段落、去掉渲染噪声空白', () => {
  it('CRLF / CR 统一为 LF', () => {
    expect(normalizeExtractedText('a\r\nb\rc')).toBe('a\nb\nc');
  });

  it('制表符与不间断空格折叠为普通空格', () => {
    expect(normalizeExtractedText('a\t\tb\u00a0\u00a0c')).toBe('a b c');
  });

  it('逐行去首尾空白（innerText 常带缩进）', () => {
    expect(normalizeExtractedText('  第一段  \n   第二段   ')).toBe('第一段\n第二段');
  });

  it('连续空行压成一个空行，段落分隔保留', () => {
    expect(normalizeExtractedText('第一段\n\n\n\n\n第二段')).toBe('第一段\n\n第二段');
  });

  it('首尾空白整体去掉', () => {
    expect(normalizeExtractedText('\n\n  正文  \n\n')).toBe('正文');
  });

  it('空串与纯空白返回空串', () => {
    expect(normalizeExtractedText('')).toBe('');
    expect(normalizeExtractedText(' \n\t \n ')).toBe('');
  });

  it('单个换行不被吃掉（列表/诗歌行结构保留）', () => {
    expect(normalizeExtractedText('一\n二\n三')).toBe('一\n二\n三');
  });
});

describe('截断契约', () => {
  it('上限为 20000 字：wordCount 报全长、textContent 只给前缀、truncated 置真', () => {
    expect(MAX_TEXT_CHARS).toBe(20000);
    const raw = '字'.repeat(MAX_TEXT_CHARS + 500);
    // 复刻 extractPageContent 的回传契约，确认三者不再互相矛盾
    const payload = { textContent: raw.slice(0, MAX_TEXT_CHARS), wordCount: raw.length, truncated: raw.length > MAX_TEXT_CHARS };
    expect(payload.textContent).toHaveLength(MAX_TEXT_CHARS);
    expect(payload.wordCount).toBe(MAX_TEXT_CHARS + 500);
    expect(payload.truncated).toBe(true);
  });

  it('未超上限时 truncated 为假，wordCount 与 textContent 长度一致', () => {
    const raw = '字'.repeat(1200);
    const payload = { textContent: raw.slice(0, MAX_TEXT_CHARS), wordCount: raw.length, truncated: raw.length > MAX_TEXT_CHARS };
    expect(payload.truncated).toBe(false);
    expect(payload.wordCount).toBe(payload.textContent.length);
  });
});