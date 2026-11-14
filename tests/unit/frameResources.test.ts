/**
 * 帧归属索引与打包缺失摘要单测（sourcesTree 深审差量）。
 * 回归目标：
 *  1. iframe 资源必须带自己的 frameId —— 旧实现把顶层 frameId 用于所有 URL，
 *     子帧资源一律取不到且只记日志，用户拿到少文件的压缩包毫不知情；
 *  2. 同一 URL 挂多个帧时候选帧按"归属帧优先"排列，归属帧失效还能重试；
 *  3. 缺失摘要必须把三类原因（取不到 / 超限 / 清单截断）合并成一条可读文案，
 *     全部成功时返回 null（不给用户制造噪音）。
 */
import { describe, it, expect } from 'vitest';
import {
  walkFrameResources, buildFrameResourceIndex, frameCandidatesFor, summarizeSkippedFiles,
  type CdpFrameTree, type SourceFetchFailure,
} from '@/utils/frameResources';

/** 一棵典型的三层帧树：顶层 + 两个子帧，其中一个子帧缺 id */
function makeTree(): CdpFrameTree {
  return {
    frame: { id: 'F_TOP', url: 'https://shop.example.com/' },
    resources: [
      { url: 'https://shop.example.com/app.js', contentSize: 100 },
      { url: 'https://cdn.example.com/shared.js', contentSize: 200 },
    ],
    childFrames: [
      {
        frame: { id: 'F_PAY', url: 'https://pay.example.com/checkout' },
        resources: [
          { url: 'https://pay.example.com/checkout.js', size: 50 },
          { url: 'https://cdn.example.com/shared.js', contentSize: 200 },
        ],
        childFrames: [
          {
            frame: { id: 'F_W3' },
            resources: [{ url: 'https://cdn.w3.org/embed.js' }],
          },
        ],
      },
      // 缺 frame.id 的帧：无法取内容，整段跳过而不是伪造一个 id
      { frame: { url: 'https://ghost.example.com/' }, resources: [{ url: 'https://ghost.example.com/a.js' }] },
    ],
  };
}

describe('walkFrameResources', () => {
  it('按深度优先父帧在前收集，并带上归属帧', () => {
    const seen: Array<{ url: string; frameId: string; size: number }> = [];
    walkFrameResources(makeTree(), r => seen.push(r));
    expect(seen.map(s => [s.frameId, s.url])).toEqual([
      ['F_TOP', 'https://shop.example.com/app.js'],
      ['F_TOP', 'https://cdn.example.com/shared.js'],
      ['F_PAY', 'https://pay.example.com/checkout.js'],
      ['F_PAY', 'https://cdn.example.com/shared.js'],
      ['F_W3', 'https://cdn.w3.org/embed.js'],
    ]);
  });

  it('contentSize 与 size 两种字段都能取到体积，缺失记 0', () => {
    const seen: Array<{ url: string; size: number }> = [];
    walkFrameResources(makeTree(), r => seen.push({ url: r.url, size: r.size }));
    expect(seen.find(s => s.url.endsWith('app.js'))!.size).toBe(100);
    expect(seen.find(s => s.url.endsWith('checkout.js'))!.size).toBe(50);
    expect(seen.find(s => s.url.endsWith('embed.js'))!.size).toBe(0);
  });

  it('缺 frame.id 的帧整段跳过（伪造 id 只会把错误推到下游）', () => {
    const urls: string[] = [];
    walkFrameResources(makeTree(), r => urls.push(r.url));
    expect(urls.some(u => u.includes('ghost.example.com'))).toBe(false);
  });

  it('本层不做协议过滤：blob:/data: 由下游 safeParseUrl 负责，职责单一', () => {
    const urls: string[] = [];
    walkFrameResources({ frame: { id: 'F' }, resources: [{ url: 'blob:https://a.com/x' }, { url: 'data:text/html,' }] }, r => urls.push(r.url));
    expect(urls).toEqual(['blob:https://a.com/x', 'data:text/html,']);
  });

  it('空/畸形输入不抛异常', () => {
    const cases: unknown[] = [
      null, undefined, {}, { frame: {} },
      { frame: { id: 'A' }, resources: 'x' },
      { frame: { id: 'A' }, resources: [null, {}, { url: '' }] },
      { frame: { id: 'A' }, childFrames: 'x' },
    ];
    for (const bad of cases) {
      const out: unknown[] = [];
      walkFrameResources(bad as unknown as CdpFrameTree, r => out.push(r));
      expect(out).toEqual([]);
    }
  });
});

describe('buildFrameResourceIndex / frameCandidatesFor', () => {
  const index = buildFrameResourceIndex(makeTree());

  it('子帧独有权属：iframe 资源的首个候选是子帧本身，不是顶层帧', () => {
    expect(frameCandidatesFor(index, 'https://pay.example.com/checkout.js', 'F_TOP')[0]).toBe('F_PAY');
  });

  it('跨帧共享 URL 保留全部候选帧，父帧在前', () => {
    expect(frameCandidatesFor(index, 'https://cdn.example.com/shared.js', 'F_TOP')).toEqual(['F_TOP', 'F_PAY']);
  });

  it('索引里没有的 URL 退回顶层帧试一次', () => {
    expect(frameCandidatesFor(index, 'https://shop.example.com/new.js', 'F_TOP')).toEqual(['F_TOP']);
  });

  it('顶层帧 ID 也拿不到时返回空数组，由调用方记为 no-frame 失败', () => {
    expect(frameCandidatesFor(index, 'https://shop.example.com/new.js', undefined)).toEqual([]);
  });

  it('顶层帧已在候选里时不重复追加', () => {
    expect(frameCandidatesFor(index, 'https://shop.example.com/app.js', 'F_TOP')).toEqual(['F_TOP']);
  });

  it('空树 + 无顶层 id 时不抛异常', () => {
    expect(frameCandidatesFor(buildFrameResourceIndex(undefined), 'https://a.com/b.js')).toEqual([]);
  });
});

describe('summarizeSkippedFiles', () => {
  const fail = (url: string, reason: SourceFetchFailure['reason'], detail = 'x'): SourceFetchFailure => ({ url, reason, detail });

  it('全部成功返回 null（不给用户制造噪音）', () => {
    expect(summarizeSkippedFiles([], [], 0)).toBeNull();
  });

  it('三类原因合并计数并带出首个失败原因', () => {
    const s = summarizeSkippedFiles(
      [fail('https://a/1.js', 'unavailable', 'No resource with given URL found'), fail('https://a/2.js', 'no-frame', '页面已导航'), fail('https://a/big.wasm', 'oversize', '体积超过单文件上限')],
      ['cdn.a.com/3.js'],
      4
    )!;
    expect(s.count).toBe(8); // 3 项取回失败 + 1 项总量超限 + 4 项清单截断
    expect(s.text).toContain('2 项取不到内容');
    expect(s.text).toContain('No resource with given URL found');
    expect(s.text).toContain('2 项超出体积上限'); // 1 个 oversize 失败 + 1 个总量超限
    expect(s.text).toContain('4 项超出单次文件数上限');
  });

  it('示例路径最多 3 条，超出用"等"收尾', () => {
    const s = summarizeSkippedFiles([fail('u1', 'oversize'), fail('u2', 'oversize'), fail('u3', 'oversize'), fail('u4', 'oversize')], [], 0)!;
    expect(s.count).toBe(4);
    expect(s.text).toContain('例如：u1、u2、u3 等');
  });

  it('恰好 3 条不加"等"', () => {
    const s = summarizeSkippedFiles([fail('u1', 'oversize'), fail('u2', 'oversize'), fail('u3', 'oversize')], [], 0)!;
    expect(s.text.endsWith('例如：u1、u2、u3')).toBe(true);
  });

  it('纯超限时不出现"取不到内容"字样', () => {
    const s = summarizeSkippedFiles([], ['a.js', 'b.js'], 0)!;
    expect(s.count).toBe(2);
    expect(s.text).not.toContain('取不到内容');
    expect(s.text).toContain('2 项超出体积上限');
  });

  it('只有清单截断时也出摘要（旧实现这条路完全静默）', () => {
    const s = summarizeSkippedFiles([], [], 1)!;
    expect(s).not.toBeNull();
    expect(s.text).toContain('1 项超出单次文件数上限');
  });
});