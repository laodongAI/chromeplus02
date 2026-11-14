/**
 * 录制音频图与按住说话（Round 5 #31）——纯决策层。
 *
 * 为什么需要这一层：原实现只在「系统声 + 麦克风同时存在」时才建 AudioContext，
 * 单路音频直接把轨道交给 MediaRecorder。按住说话要给麦克风插一个 GainNode，
 * 于是「只有麦克风」也必须建混音图——这个判定散在启动流程里很容易漏，
 * 漏掉的表现是「开了按住说话但麦克风一直有声」，所以抽成可单测的纯函数。
 *
 * 平台边界：chrome.commands 只有 keydown 没有 keyup，做不出「松开即静音」，
 * 因此按住说话只在侧栏文档内监听按键 + 面板上的按住按钮，不注入页面抢按键
 * （页面里按 V 可能正在输入，抢键会破坏用户操作）。
 */

/** 音频图输入事实 */
export interface AudioGraphInput {
  hasSystemAudio: boolean;
  hasMicrophone: boolean;
  pushToTalk: boolean;
}

/** 音频图搭建方案 */
export interface AudioGraphPlan {
  /** 是否需要 AudioContext + MediaStreamDestination（否则轨道直通） */
  needsMixer: boolean;
  /** 麦克风是否要经 GainNode（按住说话） */
  micThroughGain: boolean;
  /** 本次是否完全没有音轨（用于提示无声录制） */
  silent: boolean;
}

/**
 * 决定音频图形态。
 * 规则：两路以上必混音（MediaRecorder 只取第一条音轨，不混音等于静默丢一路）；
 * 单路麦克风 + 按住说话也要混音，因为增益节点只能活在 AudioContext 里。
 */
export function planAudioGraph(input: AudioGraphInput): AudioGraphPlan {
  const sources = (input.hasSystemAudio ? 1 : 0) + (input.hasMicrophone ? 1 : 0);
  const micThroughGain = input.hasMicrophone && input.pushToTalk;
  return {
    needsMixer: sources > 1 || micThroughGain,
    micThroughGain,
    silent: sources === 0
  };
}

/** 按住说话的按键（用 code 而非 key：不受输入法与大小写影响） */
export const PTT_KEY_CODE = 'KeyV';
/** 按键提示文案（面板按钮 title 与说明共用） */
export const PTT_KEY_LABEL = 'V';

/** 按下时的增益爬升时间：太短会有「咔」的电平跳变，太长会吃掉字头 */
export const PTT_ATTACK_MS = 25;
/** 松开时的增益回落时间：比爬升慢一点，避免尾字被切掉 */
export const PTT_RELEASE_MS = 90;

/** 目标增益：按住 = 1，松开 = 0（用 setTargetAtTime 平滑过渡，不做硬切） */
export function pttTargetGain(holding: boolean): number {
  return holding ? 1 : 0;
}

/** setTargetAtTime 的时间常数：约 3 个常数到达目标值，故取 ramps 的 1/3 */
export function pttTimeConstant(holding: boolean): number {
  const ms = holding ? PTT_ATTACK_MS : PTT_RELEASE_MS;
  return ms / 3 / 1000;
}

/** 目标元素是否处于文本输入态（此时不抢按键） */
export function isEditableTarget(tagName: string | undefined, isContentEditable: boolean): boolean {
  const tag = String(tagName || '').toUpperCase();
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || isContentEditable === true;
}

/** 本次按键是否应触发按住说话（忽略组合键与输入态，避免与浏览器/页面快捷键打架） */
export function isPttActivation(
  code: string,
  mods: { ctrlKey: boolean; altKey: boolean; metaKey: boolean },
  editableTarget: boolean
): boolean {
  if (editableTarget) return false;
  if (mods.ctrlKey || mods.altKey || mods.metaKey) return false;
  return code === PTT_KEY_CODE;
}