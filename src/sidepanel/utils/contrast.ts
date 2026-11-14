/**
 * UI 三批（组2）：WCAG 相对亮度与对比度纯函数。
 * 用途：tokens.css 的 muted/secondary 等弱化色需要保证在多种底色上
 * 达到 WCAG AA 正文对比度（≥4.5:1），本模块提供可单测的确定性计算，
 * 由 tests/unit/designTokens.test.ts 直接读取 tokens.css 中的色值做断言，
 * 防止后续调色悄悄跌破阈值。
 */

/**
 * 解析 #rgb / #rrggbb 十六进制颜色为 [r,g,b]（0-255）。
 * @param hex 颜色字符串，如 '#626b80' 或 '#fff'
 * @returns 三分量数组；解析失败返回 null
 */
export function parseHexColor(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  let s = m[1];
  // 3 位短写展开为 6 位（#abc -> #aabbcc）
  if (s.length === 3) s = s.split('').map(c => c + c).join('');
  return [
    parseInt(s.slice(0, 2), 16),
    parseInt(s.slice(2, 4), 16),
    parseInt(s.slice(4, 6), 16),
  ];
}

/**
 * 计算 sRGB 相对亮度（WCAG 定义，线性化后的加权求和）。
 * @param rgb [r,g,b]，0-255
 * @returns 相对亮度 0（黑）~ 1（白）
 */
export function relativeLuminance([r, g, b]: [number, number, number]): number {
  // 单通道线性化：<=0.04045 走线性段，否则走 2.4 次幂 gamma 段
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/**
 * 计算两个十六进制颜色的 WCAG 对比度。
 * @param fg 前景色
 * @param bg 背景色
 * @returns 对比度 1~21；任一颜色无法解析时返回 0（视为不达标）
 */
export function contrastRatio(fg: string, bg: string): number {
  const f = parseHexColor(fg);
  const b = parseHexColor(bg);
  if (!f || !b) return 0;
  const l1 = relativeLuminance(f);
  const l2 = relativeLuminance(b);
  const [hi, lo] = l1 >= l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * 判断前景/背景是否达到 WCAG AA 正文对比度（4.5:1）。
 * @param fg 前景色（十六进制）
 * @param bg 背景色（十六进制）
 * @param threshold 阈值，默认正文 4.5；大字号文本可传 3
 */
export function meetsAA(fg: string, bg: string, threshold = 4.5): boolean {
  return contrastRatio(fg, bg) >= threshold;
}

/**
 * 提取 CSS 文本中某个自定义属性的全部十六进制色值声明（按文档顺序）。
 * tokens.css 中同一变量在 :root（浅色）与 [data-theme='dark']（深色）各声明一次，
 * 返回数组 [浅色, 深色]，单测据此分别断言两个主题的对比度。
 * 仅匹配 # 开头的十六进制值；rgba() 类（半透明底色）不参与对比度计算故不返回。
 * @param css tokens.css 之类的样式文本
 * @param varName 变量名，如 '--sp-color-muted'
 * @returns 匹配到的色值列表（可能为空）
 */
export function extractCssVarColors(css: string, varName: string): string[] {
  // 变量名里的 '-' 在正则中无特殊含义，但为稳妥仍整体转义后构造
  const re = new RegExp(`${varName.replace(/[-]/g, '\\-')}\\s*:\\s*(#[0-9a-fA-F]{3,6})`, 'g');
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(css)) !== null) out.push(m[1]);
  return out;
}
