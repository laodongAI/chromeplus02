/**
 * UI 三批（最终批）设计系统单测。
 * 覆盖三块可抽纯函数的逻辑：
 *  1. WCAG 对比度计算 + tokens.css 实际色值断言（muted/secondary 在两种主题、多种底色上达 AA）；
 *  2. 集中术语常量（无英文残留、键完整）；
 *  3. 色值→token 映射完整性（站点分类色、错误徽章色在两个主题都有声明）。
 * 另校验 manifest 品牌名与 terminology.BRAND 同源一致（组6 上架名统一）。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  parseHexColor, relativeLuminance, contrastRatio, meetsAA, extractCssVarColors,
} from '../../src/sidepanel/utils/contrast';
import {
  BRAND, GRAB_TERMS, GRAB_SEGMENT_LABELS, PANEL_TITLES, DOWNLOAD_TERMS, RECORD_TERMS,
} from '../../src/sidepanel/utils/terminology';
import { SITE_CATEGORY_ORDER } from '../../src/data/sites';

/** tokens.css 绝对路径（测试直接读源文件，防止"改了 token 忘了改测试基准"的漂移） */
const TOKENS_CSS = readFileSync(resolve(__dirname, '../../src/sidepanel/styles/tokens.css'), 'utf-8');

/** 从 tokens.css 读取某变量的 [浅色, 深色] 两档十六进制值 */
function themeValues(varName: string): [string, string] {
  const vals = extractCssVarColors(TOKENS_CSS, varName);
  expect(vals.length, `${varName} 应在浅色/深色两个作用域各声明一次`).toBe(2);
  return [vals[0], vals[1]];
}

describe('contrast 纯函数', () => {
  it('解析 3/6 位十六进制色', () => {
    expect(parseHexColor('#fff')).toEqual([255, 255, 255]);
    expect(parseHexColor('#626b80')).toEqual([98, 107, 128]);
    expect(parseHexColor('not-a-color')).toBeNull();
  });

  it('黑白对比度为 21:1，同色为 1:1', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 0);
    expect(contrastRatio('#123456', '#123456')).toBeCloseTo(1, 5);
  });

  it('相对亮度：白=1、黑=0（WCAG 定义）', () => {
    expect(relativeLuminance([255, 255, 255])).toBeCloseTo(1, 5);
    expect(relativeLuminance([0, 0, 0])).toBe(0);
  });
});

describe('tokens.css 文本色对比度（组2 可读性修正回归）', () => {
  // 浅色主题三档底色：页面底 / 卡片与浮层 / surface（muted 实际落点）
  const lightBgs = ['#f5f6fa', '#ffffff', '#f0f2f8'];
  // 深色主题三档底色
  const darkBgs = ['#14161d', '#1b1e27', '#222633'];

  it('浅色 muted 在所有浅色底色上 ≥4.5:1（AA 正文）', () => {
    const [muted] = themeValues('--sp-color-muted');
    for (const bg of lightBgs) {
      expect(meetsAA(muted, bg), `muted ${muted} on ${bg} = ${contrastRatio(muted, bg).toFixed(2)}`).toBe(true);
    }
  });

  it('深色 muted 在所有深色底色上 ≥4.5:1', () => {
    const [, mutedDark] = themeValues('--sp-color-muted');
    for (const bg of darkBgs) {
      expect(meetsAA(mutedDark, bg), `muted ${mutedDark} on ${bg} = ${contrastRatio(mutedDark, bg).toFixed(2)}`).toBe(true);
    }
  });

  it('浅色 text-secondary ≥4.5:1 且比 muted 更深（层级不倒置）', () => {
    const [sec, secDark] = themeValues('--sp-color-text-secondary');
    const [muted, mutedDark] = themeValues('--sp-color-muted');
    for (const bg of lightBgs) expect(meetsAA(sec, bg)).toBe(true);
    for (const bg of darkBgs) expect(meetsAA(secDark, bg)).toBe(true);
    // 次要文字亮度层级：secondary 应比 muted 更"实"（浅色下 L 更小、深色下 L 更大）
    expect(relativeLuminance(parseHexColor(sec)!)).toBeLessThan(relativeLuminance(parseHexColor(muted)!));
    expect(relativeLuminance(parseHexColor(secDark)!)).toBeGreaterThan(relativeLuminance(parseHexColor(mutedDark)!));
  });

  it('tokens.css 不再引用 Google Fonts 远程资源（组5 离线化）', () => {
    expect(TOKENS_CSS).not.toMatch(/fonts\.googleapis\.com|fonts\.gstatic\.com/);
  });
});

describe('站点分类色与错误徽章色 token 化（组2）', () => {
  /** 分类中文名 → token 词干（与 SiteCatalogPanel 的 CAT_TOKEN_KEYS 映射同源约定） */
  const catStems: Record<string, string> = {
    '综合': 'general', '娱乐': 'entertain', '学习': 'learn', '英语': 'english',
    '音乐': 'music', '直播': 'live', '新闻': 'news',
  };

  it('SITE_CATEGORY_ORDER 每个分类都有对应 --sp-cat-* bg/fg token，且两主题各声明一次', () => {
    for (const cat of SITE_CATEGORY_ORDER) {
      const stem = catStems[cat];
      expect(stem, `分类「${cat}」缺少 token 词干映射`).toBeTruthy();
      for (const suffix of ['bg', 'fg'] as const) {
        const vals = extractCssVarColors(TOKENS_CSS, `--sp-cat-${stem}-${suffix}`);
        // bg 为 rgba（不参与对比断言）时十六进制匹配为 0 个，只断言 fg 两档
        if (suffix === 'fg') expect(vals.length, `--sp-cat-${stem}-fg 需浅色+深色两档`).toBe(2);
      }
    }
  });

  it('分类前景色在对应主题实底上达 AA（fg 直接落在卡片底色上）', () => {
    for (const cat of SITE_CATEGORY_ORDER) {
      const stem = catStems[cat];
      const [fgLight, fgDark] = themeValues(`--sp-cat-${stem}-fg`);
      expect(meetsAA(fgLight, '#f5f6fa'), `${cat} 浅色前景 ${fgLight}`).toBe(true);
      expect(meetsAA(fgDark, '#14161d'), `${cat} 深色前景 ${fgDark}`).toBe(true);
    }
  });

  it('错误徽章 fg/bg 两主题各声明一次（ErrorBadge 不再硬编码十六进制）', () => {
    const errStems = ['', '-network', '-cors', '-drm', '-permission', '-noresource', '-interrupt'];
    for (const stem of errStems) {
      for (const suffix of ['bg', 'fg'] as const) {
        const vals = extractCssVarColors(TOKENS_CSS, `--sp-err${stem}-${suffix}`);
        expect(vals.length, `--sp-err${stem}-${suffix} 需两档`).toBe(2);
      }
    }
  });
});

describe('集中术语常量（组6）', () => {
  it('抓取子模式术语无英文残留：Sources 一律为「资源包」', () => {
    const values = Object.values(GRAB_TERMS);
    expect(values).not.toContain('Sources');
    expect(GRAB_TERMS.sources).toBe('资源包');
    // 分段映射与术语表同源
    expect(GRAB_SEGMENT_LABELS.sources).toBe(GRAB_TERMS.sources);
  });

  it('图片术语三处同源：tab 名与面板标题都以「图片」为词根（原「图像抓取」分叉消除）', () => {
    expect(GRAB_TERMS.image).toBe('图片');
    expect(PANEL_TITLES.image).toContain('图片');
    expect(PANEL_TITLES.image).not.toContain('图像');
  });

  it('下载/录制成对术语完整', () => {
    expect(DOWNLOAD_TERMS.history).toBe('下载记录');
    expect(RECORD_TERMS.entry).toBe('录制');
    expect(RECORD_TERMS.desktop).toBe('桌面录制');
    expect(RECORD_TERMS.desktop.startsWith(RECORD_TERMS.entry)).toBe(false); // 完整名独立存在
    expect(RECORD_TERMS.desktop).toContain(RECORD_TERMS.entry);
  });

  it('manifest 品牌名与 BRAND 常量同源（静态 JSON 无法 import，靠单测钉死一致性）', () => {
    const manifest = JSON.parse(readFileSync(resolve(__dirname, '../../manifest.json'), 'utf-8'));
    expect(manifest.name).toBe(BRAND.storeName);
    expect(manifest.description).toBe(BRAND.description);
    expect(manifest.action.default_title).toBe(BRAND.storeName);
  });

  it('manifest 版本号与 package.json 同源（版本号多源不一致回归防护）', () => {
    const manifest = JSON.parse(readFileSync(resolve(__dirname, '../../manifest.json'), 'utf-8'));
    const pkg = JSON.parse(readFileSync(resolve(__dirname, '../../package.json'), 'utf-8'));
    expect(manifest.version).toBe(pkg.version);
  });
});
