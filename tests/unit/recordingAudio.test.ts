import { describe, it, expect } from 'vitest';
import {
  planAudioGraph,
  pttTargetGain,
  pttTimeConstant,
  isEditableTarget,
  isPttActivation,
  PTT_KEY_CODE,
  PTT_ATTACK_MS,
  PTT_RELEASE_MS
} from '@/core/recordingAudio';

const noMods = { ctrlKey: false, altKey: false, metaKey: false };

describe('planAudioGraph：什么时候必须建混音图', () => {
  it('两路音频必混音（MediaRecorder 只取第一条音轨）', () => {
    const p = planAudioGraph({ hasSystemAudio: true, hasMicrophone: true, pushToTalk: false });
    expect(p.needsMixer).toBe(true);
    expect(p.micThroughGain).toBe(false);
    expect(p.silent).toBe(false);
  });

  it('只有系统声：直通，不建 AudioContext', () => {
    const p = planAudioGraph({ hasSystemAudio: true, hasMicrophone: false, pushToTalk: false });
    expect(p.needsMixer).toBe(false);
    expect(p.silent).toBe(false);
  });

  it('只有麦克风且未按住说话：直通', () => {
    const p = planAudioGraph({ hasSystemAudio: false, hasMicrophone: true, pushToTalk: false });
    expect(p.needsMixer).toBe(false);
    expect(p.micThroughGain).toBe(false);
  });

  it('只有麦克风 + 按住说话：必须建图，否则增益节点无处安放（本轮核心判定）', () => {
    const p = planAudioGraph({ hasSystemAudio: false, hasMicrophone: true, pushToTalk: true });
    expect(p.needsMixer).toBe(true);
    expect(p.micThroughGain).toBe(true);
  });

  it('两路 + 按住说话：系统声不经增益门，只有麦克风经', () => {
    const p = planAudioGraph({ hasSystemAudio: true, hasMicrophone: true, pushToTalk: true });
    expect(p.needsMixer).toBe(true);
    expect(p.micThroughGain).toBe(true);
  });

  it('没有麦克风时按住说话不生效（不能凭空造出增益门）', () => {
    const p = planAudioGraph({ hasSystemAudio: true, hasMicrophone: false, pushToTalk: true });
    expect(p.micThroughGain).toBe(false);
    expect(p.needsMixer).toBe(false);
  });

  it('完全没有音轨标记为无声，供面板提示', () => {
    const p = planAudioGraph({ hasSystemAudio: false, hasMicrophone: false, pushToTalk: true });
    expect(p.silent).toBe(true);
    expect(p.needsMixer).toBe(false);
  });
});

describe('按住说话的电平过渡', () => {
  it('按住=1，松开=0', () => {
    expect(pttTargetGain(true)).toBe(1);
    expect(pttTargetGain(false)).toBe(0);
  });

  it('时间常数为斜坡的 1/3（setTargetAtTime 约 3 个常数到位）', () => {
    expect(pttTimeConstant(true)).toBeCloseTo(PTT_ATTACK_MS / 3 / 1000, 6);
    expect(pttTimeConstant(false)).toBeCloseTo(PTT_RELEASE_MS / 3 / 1000, 6);
  });

  it('松开比按下慢：避免尾字被切掉', () => {
    expect(PTT_RELEASE_MS).toBeGreaterThan(PTT_ATTACK_MS);
  });
});

describe('isEditableTarget：输入态不抢按键', () => {
  it('输入类元素与 contentEditable 都算输入态', () => {
    expect(isEditableTarget('INPUT', false)).toBe(true);
    expect(isEditableTarget('textarea', false)).toBe(true);
    expect(isEditableTarget('SELECT', false)).toBe(true);
    expect(isEditableTarget('DIV', true)).toBe(true);
  });

  it('普通元素与空目标不算', () => {
    expect(isEditableTarget('DIV', false)).toBe(false);
    expect(isEditableTarget(undefined, false)).toBe(false);
  });
});

describe('isPttActivation：按键匹配', () => {
  it('裸 V 键触发', () => {
    expect(isPttActivation(PTT_KEY_CODE, noMods, false)).toBe(true);
  });

  it('组合键不触发（留给浏览器/页面快捷键）', () => {
    expect(isPttActivation(PTT_KEY_CODE, { ...noMods, ctrlKey: true }, false)).toBe(false);
    expect(isPttActivation(PTT_KEY_CODE, { ...noMods, altKey: true }, false)).toBe(false);
    expect(isPttActivation(PTT_KEY_CODE, { ...noMods, metaKey: true }, false)).toBe(false);
  });

  it('输入态不触发（用户可能正在打字）', () => {
    expect(isPttActivation(PTT_KEY_CODE, noMods, true)).toBe(false);
  });

  it('其他键不触发', () => {
    expect(isPttActivation('KeyB', noMods, false)).toBe(false);
    expect(isPttActivation('Space', noMods, false)).toBe(false);
    expect(isPttActivation('', noMods, false)).toBe(false);
  });
});