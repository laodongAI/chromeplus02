/**
 * .vue 组件注册守卫（Round 5 #29 复盘新增）。
 *
 * 背景：Options API（defineComponent + components: {...}）的模板里用了某个组件，
 * 但只在 <script> 里 import 而没有登记到 components，vue-tsc 与 vite build 都不报错，
 * 运行时才「Failed to resolve component」——按钮/输入框直接不渲染。
 * 本轮实测抓到 3 处（MediaSweepControls 两处、ExprFilterInput 两处），所以固化成测试。
 *
 * 判定范围：非 <script setup> 的 .vue（setup 语法自己解析 import，不存在该问题）。
 * 递归自引用（TreeNode 用 name 自引用）视为已注册。
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

/** 内置/框架标签，不需要登记 */
const BUILT_INS = new Set([
  'component', 'componentis', 'transition', 'transitiongroup', 'keepalive',
  'teleport', 'suspense', 'slot', 'template', 'router-view', 'routerView'
]);

function collectVueFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return collectVueFiles(full);
    return name.endsWith('.vue') ? [full] : [];
  });
}

/** 归一化组件名：去掉连字符并小写，使 <expr-filter-input> 与 ExprFilterInput 可比 */
function normalize(tag: string): string {
  return tag.toLowerCase().replace(/-/g, '');
}

function findUnregistered(source: string): string[] {
  const template = /<template>([\s\S]*)<\/template>/.exec(source)?.[1];
  if (!template) return [];
  if (/<script[^>]*\bsetup\b/.test(source)) return [];

  const used = new Set<string>();
  for (const m of template.matchAll(/<([A-Za-z][A-Za-z0-9-]*)(?=[\s/>])/g)) {
    const tag = m[1];
    const normalized = normalize(tag);
    // 内置标签、纯小写的原生 HTML（无连字符且全小写，如 div/span/video）不参与检查
    if (BUILT_INS.has(normalized) || /^[a-z][a-z0-9]*$/.test(tag)) continue;
    used.add(normalized);
  }

  const registered = new Set<string>();
  const componentsBlock = /\bcomponents:\s*\{([\s\S]*?)\}/.exec(source)?.[1];
  for (const entry of (componentsBlock || '').split(',')) {
    const key = entry.trim().split(/[:\s]/)[0];
    if (key) registered.add(normalize(key));
  }
  // 自身 name 允许递归引用
  const selfName = /\bname:\s*['"]([^'"]+)['"]/.exec(source)?.[1];
  if (selfName) registered.add(normalize(selfName));

  return [...used].filter((tag) => !registered.has(tag));
}

describe('Options API 面板的模板组件必须登记到 components', () => {
  const dirs = ['src/sidepanel', 'src/editor'];
  const files = dirs.flatMap(collectVueFiles);

  it('扫描到的 .vue 数量足够（防止路径写错导致空跑）', () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it('没有“模板里用了但没注册”的组件', () => {
    const offenders: string[] = [];
    for (const file of files) {
      const missing = findUnregistered(readFileSync(file, 'utf8'), file);
      if (missing.length) offenders.push(`${file.split(sep).join('/')}: ${missing.join(', ')}`);
    }
    expect(offenders).toEqual([]);
  });
});
