/**
 * P2-2 感知哈希重复检测增量计数器的单元测试。
 * 覆盖 ImageGrabPanel.vue 模块级导出的 PhashDuplicateTracker 纯逻辑类：
 * 验证与旧"全表重算"实现一致的重复判定语义（前 16 位哈希分组，规模 >=2 即重复）。
 */
import { describe, expect, it } from 'vitest';
import { PhashDuplicateTracker } from '../../src/sidepanel/views/ImageGrabPanel.vue';

/** 生成长度 >=16 的测试哈希前缀串 */
function hash(prefix: string): string { return prefix.padEnd(16, '0'); }

describe('PhashDuplicateTracker：增量重复分组', () => {
  it('单一哈希不判重，第二个同哈希成员出现时两者同时判重', () => {
    const t = new PhashDuplicateTracker();
    t.add('a', hash('ab12'));
    expect(t.isDuplicate('a')).toBe(false);
    t.add('b', hash('ab12'));
    expect(t.isDuplicate('a')).toBe(true);
    expect(t.isDuplicate('b')).toBe(true);
  });

  it('不同哈希互不影响', () => {
    const t = new PhashDuplicateTracker();
    t.add('a', hash('1111'));
    t.add('b', hash('2222'));
    expect(t.isDuplicate('a')).toBe(false);
    expect(t.isDuplicate('b')).toBe(false);
  });

  it('仅比较前 16 位：第 17 位起不同仍判重（与旧实现语义一致）', () => {
    const t = new PhashDuplicateTracker();
    t.add('a', 'ffffffffffffffff111');
    t.add('b', 'ffffffffffffffff999');
    expect(t.isDuplicate('a')).toBe(true);
    expect(t.isDuplicate('b')).toBe(true);
  });

  it('空哈希/未计算哈希不参与分组', () => {
    const t = new PhashDuplicateTracker();
    t.add('a', undefined);
    t.add('b', '');
    expect(t.isDuplicate('a')).toBe(false);
    expect(t.isDuplicate('b')).toBe(false);
    expect(t.duplicates().size).toBe(0);
  });

  it('成员移除后：组规模 2->1 时剩余成员退出重复', () => {
    const t = new PhashDuplicateTracker();
    t.add('a', hash('ab12'));
    t.add('b', hash('ab12'));
    t.remove('a');
    expect(t.isDuplicate('a')).toBe(false);
    expect(t.isDuplicate('b')).toBe(false);
  });

  it('成员移除后：组规模 3->2 时剩余成员仍保持重复', () => {
    const t = new PhashDuplicateTracker();
    t.add('a', hash('ab12'));
    t.add('b', hash('ab12'));
    t.add('c', hash('ab12'));
    t.remove('a');
    expect(t.isDuplicate('b')).toBe(true);
    expect(t.isDuplicate('c')).toBe(true);
    expect(t.isDuplicate('a')).toBe(false);
  });

  it('哈希变更（重新 add）幂等：旧组解除、新组生效', () => {
    const t = new PhashDuplicateTracker();
    t.add('a', hash('1111'));
    t.add('b', hash('1111')); // a/b 重复
    t.add('a', hash('2222')); // a 换哈希 -> a/b 不再重复
    expect(t.isDuplicate('a')).toBe(false);
    expect(t.isDuplicate('b')).toBe(false);
    t.add('c', hash('2222')); // a/c 新组重复
    expect(t.isDuplicate('a')).toBe(true);
    expect(t.isDuplicate('c')).toBe(true);
  });

  it('duplicates() 快照与逐项 isDuplicate 一致；clear 全量重置', () => {
    const t = new PhashDuplicateTracker();
    t.add('a', hash('aaaa'));
    t.add('b', hash('aaaa'));
    t.add('c', hash('cccc'));
    expect(new Set(t.duplicates())).toEqual(new Set(['a', 'b']));
    t.clear();
    expect(t.duplicates().size).toBe(0);
    expect(t.isDuplicate('a')).toBe(false);
  });
});
