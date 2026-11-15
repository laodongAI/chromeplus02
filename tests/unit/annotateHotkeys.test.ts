/**
 * 页内画笔覆盖层快捷键判定单测。
 * 重点守住那个真实缺陷：覆盖层默认是操作模式，提示却承诺「按 H 隐藏工具栏」，
 * 旧守卫让 H 在默认状态下完全失效。这里把「H 两模式都生效、空格只在绘制模式生效」钉死。
 */
import { describe, expect, it } from 'vitest';
import { resolveAnnotateKey, type AnnotateKeyInput } from '@/core/annotateHotkeys';

const key = (patch: Partial<AnnotateKeyInput> = {}): AnnotateKeyInput => ({
  key: 'h',
  ctrlKey: false,
  altKey: false,
  metaKey: false,
  selectMode: true,
  focusInOverlay: false,
  editableTarget: false,
  ...patch
});

describe('resolveAnnotateKey：工具栏显隐', () => {
  it('默认操作模式 + 焦点在页面上时 H 依然生效（旧实现在这里返回 null，即用户报的缺陷）', () => {
    expect(resolveAnnotateKey(key({ selectMode: true, focusInOverlay: false }))).toBe('toolbar');
  });

  it('绘制模式、焦点在覆盖层内、大写 H 都生效', () => {
    expect(resolveAnnotateKey(key({ selectMode: false }))).toBe('toolbar');
    expect(resolveAnnotateKey(key({ focusInOverlay: true }))).toBe('toolbar');
    expect(resolveAnnotateKey(key({ key: 'H' }))).toBe('toolbar');
  });

  it('文本输入态不接管：在页面输入框里打 h 不该藏工具栏', () => {
    expect(resolveAnnotateKey(key({ editableTarget: true }))).toBeNull();
    expect(resolveAnnotateKey(key({ key: ' ', editableTarget: true }))).toBeNull();
  });
});

describe('resolveAnnotateKey：模式切换只在绘制模式接管空格', () => {
  it('操作模式下空格放行给页面（滚动 / 视频播放暂停）', () => {
    expect(resolveAnnotateKey(key({ key: ' ', selectMode: true, focusInOverlay: false }))).toBeNull();
  });

  it('绘制模式下空格切模式；操作模式但焦点已在覆盖层内也接管', () => {
    expect(resolveAnnotateKey(key({ key: ' ', selectMode: false }))).toBe('mode');
    expect(resolveAnnotateKey(key({ key: ' ', selectMode: true, focusInOverlay: true }))).toBe('mode');
  });
});

describe('resolveAnnotateKey：组合键一律放行', () => {
  it('Ctrl/Alt/Meta 组合不接管，留给浏览器、站点与扩展全局 commands', () => {
    expect(resolveAnnotateKey(key({ ctrlKey: true }))).toBeNull();
    expect(resolveAnnotateKey(key({ metaKey: true }))).toBeNull();
    // 全局 commands 用 Alt+Shift+H；页内判定必须放行，否则同一次按键被处理两次等于没切换
    expect(resolveAnnotateKey(key({ altKey: true }))).toBeNull();
    expect(resolveAnnotateKey(key({ key: ' ', altKey: true, selectMode: false }))).toBeNull();
  });

  it('无关按键放行', () => {
    expect(resolveAnnotateKey(key({ key: 'a' }))).toBeNull();
    expect(resolveAnnotateKey(key({ key: 'Enter', selectMode: false }))).toBeNull();
    expect(resolveAnnotateKey(key({ key: '' }))).toBeNull();
  });
});