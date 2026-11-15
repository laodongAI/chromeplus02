/**
 * 页内画笔覆盖层的快捷键判定——纯逻辑层。
 *
 * 为什么单独抽出来：原实现把「操作模式下不接管按键」写成一条守卫，
 * 而覆盖层默认就是操作模式，结果提示文案承诺的「按 H 隐藏工具栏」在默认状态下
 * 根本不生效——用户按了没反应，只能以为功能没做。判定条件是这个缺陷的核心，
 * 所以抽成可单测的纯函数，而不是继续埋在事件回调里。
 *
 * 分工：
 *  - 裸 H：两种模式都生效。工具栏会被录进画面，藏掉它是录屏刚需，
 *    不能因为「正在操作网页」就失效。覆盖层是用户主动开启且仅在录制期间存在，
 *    这个前提下接管 H 的代价可接受。
 *  - 裸空格：只在绘制模式（或焦点已在覆盖层内）生效。操作模式下空格是页面滚动
 *    与视频播放/暂停，全局劫持会直接破坏用户正在录制的操作。
 *  - 任何带 Ctrl/Alt/Meta 的组合一律放行：留给浏览器、站点，以及扩展注册的
 *    全局 commands（Alt+Shift+H 等），避免同一个按键被两套机制各处理一次。
 */

/** 覆盖层快捷键能触发的动作 */
export type AnnotateKeyAction = 'toolbar' | 'mode' | null;

/** 判定所需的按键与上下文事实 */
export interface AnnotateKeyInput {
  /** KeyboardEvent.key（用 key 而非 code：H 在各键盘布局下都是 'h'） */
  key: string;
  ctrlKey: boolean;
  altKey: boolean;
  metaKey: boolean;
  /** 是否处于操作模式（true = 放行页面点击） */
  selectMode: boolean;
  /** 焦点是否落在覆盖层内部（点过工具栏即为 true） */
  focusInOverlay: boolean;
  /** 焦点是否在文本输入控件里（此时任何按键都不接管） */
  editableTarget: boolean;
}

/** 工具栏显隐的裸键提示（两种模式都可用） */
export const ANNOTATE_TOOLBAR_KEY_LABEL = 'H';
/** 模式切换的裸键提示（仅绘制模式可用） */
export const ANNOTATE_MODE_KEY_LABEL = '空格';

/**
 * 判定一次按键应触发什么动作。
 * 返回 null 表示放行给页面/浏览器，调用方不得 preventDefault。
 */
export function resolveAnnotateKey(input: AnnotateKeyInput): AnnotateKeyAction {
  if (input.editableTarget) return null;
  if (input.ctrlKey || input.altKey || input.metaKey) return null;

  const isH = input.key === 'h' || input.key === 'H';
  if (isH) return 'toolbar';

  if (input.key === ' ' && (!input.selectMode || input.focusInOverlay)) return 'mode';
  return null;
}