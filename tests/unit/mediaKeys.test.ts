/**
 * 图片身份稳定性与增量 diff key 同源单测（抓取深审 T2-A）。
 * 覆盖三个已确认的连带缺陷：
 *  1. key 曾把 phash 前缀编进去，onImgLoad 算完哈希就改 key →
 *     selected / loadedMap / processedKeys / v-for :key 全按旧 key，缩略图加载完变空白、勾选丢失；
 *  2. 增量扫描结果不带 phash，整表替换后去重贡献被清空 → carryForwardPhash 负责沿用；
 *  3. 内容脚本 diff key曾用 `url#WxH#kind`、侧栏用 `kind|normUrl|WxH|hash` →
 *     diff.removed 在面板里永远找不到对应行，"已移除"高亮与短暂保留完全失效。
 * 手法：只测纯函数，不触碰 DOM / canvas（computePerceptualHash 需真实 canvas，不在 node 环境覆盖）。
 */
import { describe, it, expect } from 'vitest';
import { buildUnifiedMediaKey, normalizeUrlForKey } from '@/utils/mediaKeys';
import { carryForwardPhash } from '@/sidepanel/utils/listAdapt';

/** 内容脚本 scanImages 实际会产出的全部 kind（images.ts 的 push 调用点） */
const SCANNER_KINDS = ['img', 'source', 'background', 'meta-og', 'meta-twitter', 'canvas-inline'];

/** 内容脚本侧：ImageScanItem 直接进构造器（router.ts buildImageKeyDiff） */
function routerKey(i: { url: string; width: number; height: number; kind: string }): string {
  return buildUnifiedMediaKey(i);
}

/** 侧栏侧：从 RESOURCE_UPDATE payload 字段重建（ImageGrabPanel.vue 的 mapped 表达式） */
function panelKey(it: { url?: string; width?: number; height?: number; kind?: string }): string {
  return buildUnifiedMediaKey({
    url: it.url,
    width: it.width || 0,
    height: it.height || 0,
    kind: String(it.kind || 'img')
  });
}

describe('buildUnifiedMediaKey：key 是不含哈希的稳定身份', () => {
  it('算出 phash 前后 key 必须完全一致（P0：改 key 会让缩略图卸载、勾选丢失）', () => {
    const base = { url: 'https://cdn.example.com/a.png', width: 800, height: 600, kind: 'img' };
    const before = buildUnifiedMediaKey(base);
    const after = buildUnifiedMediaKey({ ...base, phash: '0123456789abcdef' });
    expect(after).toBe(before);
    // 哈希换成另一个值也不影响身份
    expect(buildUnifiedMediaKey({ ...base, phash: 'ffffffffffffffff' })).toBe(before);
  });

  it('空哈希与无哈希等价', () => {
    const base = { url: 'https://cdn.example.com/a.png', kind: 'img' };
    expect(buildUnifiedMediaKey({ ...base, phash: '' })).toBe(buildUnifiedMediaKey(base));
  });

  it('追踪参数被剔除：同一资源的带参/不带参 URL 归一为同一 key', () => {
    const a = buildUnifiedMediaKey({ url: 'https://cdn.example.com/a.png?utm_source=feed&t=123', kind: 'img' });
    const b = buildUnifiedMediaKey({ url: 'https://cdn.example.com/a.png', kind: 'img' });
    expect(a).toBe(b);
    expect(normalizeUrlForKey('https://cdn.example.com/a.png?utm_medium=x&id=7')).toBe('https://cdn.example.com/a.png?id=7');
  });

  it('非追踪参数保留：不同资源不被误合并', () => {
    const a = buildUnifiedMediaKey({ url: 'https://cdn.example.com/a.png?v=1', kind: 'img' });
    const b = buildUnifiedMediaKey({ url: 'https://cdn.example.com/a.png?v=2', kind: 'img' });
    expect(a).not.toBe(b);
  });

  it('kind 与尺寸参与身份：同 URL 的不同呈现方式互不覆盖', () => {
    const url = 'https://cdn.example.com/a.png';
    expect(buildUnifiedMediaKey({ url, kind: 'img', width: 800, height: 600 }))
      .not.toBe(buildUnifiedMediaKey({ url, kind: 'background', width: 800, height: 600 }));
    expect(buildUnifiedMediaKey({ url, kind: 'img', width: 800, height: 600 }))
      .not.toBe(buildUnifiedMediaKey({ url, kind: 'img', width: 400, height: 300 }));
  });

  it('缺省尺寸归零，不产生 undefined 字面量', () => {
    expect(buildUnifiedMediaKey({ url: 'https://x.com/a.png', kind: 'meta-og' })).toBe('meta-og|https://x.com/a.png|0x0');
  });

  it('URL 含 fragment 时 key 仍可安全用于集合比对（旧 `url#WxH#kind` 格式的分隔符冲突）', () => {
    const item = { url: 'https://x.com/sprite.png#xywh=0,0,32,32', width: 32, height: 32, kind: 'img' };
    expect(routerKey(item)).toBe(panelKey(item));
    expect(routerKey(item)).toContain('#xywh=0,0,32,32');
  });

  it('无法解析的 URL 退化为原串，不抛异常', () => {
    expect(normalizeUrlForKey('http://')).toBe('http://');
    expect(() => buildUnifiedMediaKey({ url: 'http://', kind: 'img' })).not.toThrow();
  });
});

describe('内容脚本与侧栏 diff key 同源（P0：格式分叉让"已移除"高亮永久失效）', () => {
  it.each(SCANNER_KINDS)('kind=%s 时两侧 key 逐字相等', (kind) => {
    const item = { url: 'https://cdn.example.com/pic.webp?utm_campaign=launch', width: 1200, height: 900, kind };
    expect(routerKey(item)).toBe(panelKey(item));
  });

  it('扫描项尺寸为 0（source / meta-og 这类拿不到尺寸）时两侧仍相等', () => {
    const item = { url: 'https://cdn.example.com/og.jpg', width: 0, height: 0, kind: 'meta-og' };
    expect(routerKey(item)).toBe(panelKey(item));
  });

  it('removed 清单里的 key 能在面板列表中命中（回归：曾永不命中）', () => {
    const scanned = [
      { url: 'https://cdn.example.com/1.png', width: 100, height: 100, kind: 'img' },
      { url: 'https://cdn.example.com/2.png?utm_source=x', width: 200, height: 200, kind: 'background' }
    ];
    // 面板先按 payload 建列表，随后收到内容脚本的 removed key 清单
    const panelList = scanned.map(i => ({ ...i, key: panelKey(i) }));
    const removed = scanned.map(routerKey);
    removed.forEach(k => {
      expect(panelList.find(i => i.key === k)).toBeDefined();
    });
  });
});

describe('carryForwardPhash：增量更新不清空去重贡献', () => {
  type Item = { key: string; url: string; phash?: string };
  const keyOf = (url: string) => buildUnifiedMediaKey({ url, kind: 'img' });

  it('新扫描项不带哈希时沿用上一轮的值，且不算"变化"（无需重新登记）', () => {
    const prev: Item[] = [{ key: keyOf('https://x.com/a.png'), url: 'https://x.com/a.png', phash: 'abcd1234abcd1234' }];
    const next: Item[] = [{ key: keyOf('https://x.com/a.png'), url: 'https://x.com/a.png' }];
    const changed = carryForwardPhash(next, new Map(prev.map(i => [i.key, i])));
    expect(next[0].phash).toBe('abcd1234abcd1234');
    expect(changed).toHaveLength(0);
  });

  it('沿用哈希时绝不改 key（回归：改 key 会让勾选与懒加载态错位）', () => {
    const k = keyOf('https://x.com/a.png');
    const prev: Item[] = [{ key: k, url: 'https://x.com/a.png', phash: 'ffff0000ffff0000' }];
    const next: Item[] = [{ key: k, url: 'https://x.com/a.png' }];
    carryForwardPhash(next, new Map(prev.map(i => [i.key, i])));
    expect(next[0].key).toBe(k);
  });

  it('新增项进入 changed，供调用方登记 tracker', () => {
    const prev: Item[] = [{ key: keyOf('https://x.com/a.png'), url: 'https://x.com/a.png', phash: 'aaaa' }];
    const next: Item[] = [
      { key: keyOf('https://x.com/a.png'), url: 'https://x.com/a.png' },
      { key: keyOf('https://x.com/b.png'), url: 'https://x.com/b.png' }
    ];
    const changed = carryForwardPhash(next, new Map(prev.map(i => [i.key, i])));
    expect(changed).toHaveLength(1);
    expect(changed[0].url).toBe('https://x.com/b.png');
  });

  it('哈希真的变了（同 URL 内容被替换）时进入 changed，且以新值为准', () => {
    const k = keyOf('https://x.com/a.png');
    const prev: Item[] = [{ key: k, url: 'https://x.com/a.png', phash: 'aaaa' }];
    const next: Item[] = [{ key: k, url: 'https://x.com/a.png', phash: 'bbbb' }];
    const changed = carryForwardPhash(next, new Map(prev.map(i => [i.key, i])));
    expect(changed).toHaveLength(1);
    expect(next[0].phash).toBe('bbbb');
  });

  it('上一轮无哈希、本轮也无 → 无变化，不做无谓的重新登记', () => {
    const k = keyOf('https://x.com/a.png');
    const prev: Item[] = [{ key: k, url: 'https://x.com/a.png' }];
    const next: Item[] = [{ key: k, url: 'https://x.com/a.png' }];
    expect(carryForwardPhash(next, new Map(prev.map(i => [i.key, i])))).toHaveLength(0);
    expect(next[0].phash).toBeUndefined();
  });

  it('空 prev（首次扫描）时全部项都是新增', () => {
    const next: Item[] = [
      { key: keyOf('https://x.com/a.png'), url: 'https://x.com/a.png' },
      { key: keyOf('https://x.com/b.png'), url: 'https://x.com/b.png' }
    ];
    expect(carryForwardPhash(next, new Map())).toHaveLength(2);
  });

  it('空 next 不抛异常，返回空 changed', () => {
    expect(carryForwardPhash([], new Map())).toEqual([]);
  });
});