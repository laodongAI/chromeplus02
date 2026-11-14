/**
 * 增量资源更新来源守卫单测（抓取深审 T2-B）。
 * 缺陷背景：RESOURCE_UPDATE 由内容脚本直接广播，payload 只带 frameId 不带 tabId，
 * 三个媒体面板原先只按 frameId 过滤 → 后台标签页（同为顶层 frame 0）的增量覆盖当前列表。
 * 本守卫把 tabId 从 runtime.onMessage 的 sender 取出，与面板绑定来源做 tab + frame 双比对。
 */
import { describe, it, expect } from 'vitest';
import { isResourceUpdateFromBoundSource, type ResourceBinding } from '@/sidepanel/utils/resourceUpdate';

/** 构造内容脚本发来的 sender（只有 tab 消息才带 tab.id） */
function fromTab(id?: number) {
  return { tab: id === undefined ? undefined : { id } };
}

const BOUND: ResourceBinding = { tabId: 7, frameId: 0 };

describe('isResourceUpdateFromBoundSource：tab 维度', () => {
  it('同一 tab 的顶层增量被采纳', () => {
    expect(isResourceUpdateFromBoundSource(fromTab(7), { frameId: 0 }, BOUND)).toBe(true);
  });

  it('其他 tab 的顶层增量被拒绝（回归：这正是串扰列表的路径）', () => {
    expect(isResourceUpdateFromBoundSource(fromTab(8), { frameId: 0 }, BOUND)).toBe(false);
    expect(isResourceUpdateFromBoundSource(fromTab(1), { frameId: 0 }, BOUND)).toBe(false);
  });

  it('payload 缺 frameId 时按顶层 0 处理，仍受 tab 守卫约束', () => {
    expect(isResourceUpdateFromBoundSource(fromTab(7), {}, BOUND)).toBe(true);
    expect(isResourceUpdateFromBoundSource(fromTab(8), {}, BOUND)).toBe(false);
    expect(isResourceUpdateFromBoundSource(fromTab(7), undefined, BOUND)).toBe(true);
  });

  it('尚未绑定任何 tab（面板刚挂载、还没扫描）时一律拒绝，避免凭空造出别的页面的列表', () => {
    const unbound: ResourceBinding = { tabId: null, frameId: null };
    expect(isResourceUpdateFromBoundSource(fromTab(7), { frameId: 0 }, unbound)).toBe(false);
    expect(isResourceUpdateFromBoundSource(fromTab(0), { frameId: 0 }, unbound)).toBe(false);
  });

  it('非 tab 来源（后台/扩展页广播，sender.tab 缺失）一律拒绝', () => {
    expect(isResourceUpdateFromBoundSource(undefined, { frameId: 0 }, BOUND)).toBe(false);
    expect(isResourceUpdateFromBoundSource({}, { frameId: 0 }, BOUND)).toBe(false);
    expect(isResourceUpdateFromBoundSource(fromTab(), { frameId: 0 }, BOUND)).toBe(false);
    expect(isResourceUpdateFromBoundSource({ tab: {} }, { frameId: 0 }, BOUND)).toBe(false);
  });

  it('tabId 为 0 也是合法绑定（不被当成 falsy 放行）', () => {
    const binding: ResourceBinding = { tabId: 0, frameId: 0 };
    expect(isResourceUpdateFromBoundSource(fromTab(0), { frameId: 0 }, binding)).toBe(true);
    expect(isResourceUpdateFromBoundSource(fromTab(7), { frameId: 0 }, binding)).toBe(false);
  });
});

describe('isResourceUpdateFromBoundSource：frame 维度（沿用原有语义）', () => {
  it('绑定子帧时只采纳该子帧的增量', () => {
    const binding: ResourceBinding = { tabId: 7, frameId: 3 };
    expect(isResourceUpdateFromBoundSource(fromTab(7), { frameId: 3 }, binding)).toBe(true);
    expect(isResourceUpdateFromBoundSource(fromTab(7), { frameId: 0 }, binding)).toBe(false);
    expect(isResourceUpdateFromBoundSource(fromTab(7), { frameId: 4 }, binding)).toBe(false);
  });

  it('绑定 frameId 为 null 视为顶层 0', () => {
    const binding: ResourceBinding = { tabId: 7, frameId: null };
    expect(isResourceUpdateFromBoundSource(fromTab(7), { frameId: 0 }, binding)).toBe(true);
    expect(isResourceUpdateFromBoundSource(fromTab(7), {}, binding)).toBe(true);
    expect(isResourceUpdateFromBoundSource(fromTab(7), { frameId: 2 }, binding)).toBe(false);
  });

  it('frameId 为非数字（异常 payload）按顶层 0 处理，不抛异常', () => {
    expect(isResourceUpdateFromBoundSource(fromTab(7), { frameId: '0' }, BOUND)).toBe(true);
    expect(isResourceUpdateFromBoundSource(fromTab(7), { frameId: null }, BOUND)).toBe(true);
    expect(isResourceUpdateFromBoundSource(fromTab(7), { frameId: 2 }, BOUND)).toBe(false);
  });

  it('tab 正确但 frame 不符时仍拒绝（两个维度是与逻辑）', () => {
    const binding: ResourceBinding = { tabId: 7, frameId: 5 };
    expect(isResourceUpdateFromBoundSource(fromTab(7), { frameId: 0 }, binding)).toBe(false);
  });
});