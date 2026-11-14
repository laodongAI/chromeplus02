/**
 * 录屏 store 生命周期与音频链路行为单测（Tier 1 修复）。
 * 覆盖审计确认的五项缺陷：
 *  1. 系统声 + 麦克风未混音 → MediaRecorder 只录首条音轨，人声被静默丢弃；
 *  2. 采集后不校验音轨 → 选「应用窗口」拿到无声成片且无提示；
 *  3. stop() 后同步停轨 → 末尾约 1s 被截；
 *  4. startRecording 无重入守卫 → 两次启动共写模块级 chunks；
 *  5. ended 监听依赖 recording.value（末尾才置位）→ 窗口期内「停止共享」被忽略。
 * 手法：MediaStream/MediaRecorder/AudioContext 全部用可控假件，
 * MediaRecorder.stop() 故意不同步触发 onstop，以观察轨道释放的真实时机。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ===== 模块隔离：画笔下发、toast、转码下载均非被测目标 =====
vi.mock('@/sidepanel/utils/chromeMessaging', () => ({ sendMessageToTab: vi.fn(async () => undefined) }));
const toastInfo = vi.fn();
vi.mock('@/sidepanel/composables/useToast', () => ({
  toast: { info: (...a: unknown[]) => toastInfo(...a), success: vi.fn(), error: vi.fn(), warning: vi.fn() }
}));
vi.mock('@/core/mediaConvert', () => ({
  canConvertMedia: () => false,
  convertVideoBlobToMp4: vi.fn(),
  triggerBlobDownload: vi.fn()
}));

/** 假轨道：记录 stop 调用次数，并保存 ended 监听器供测试主动触发 */
function makeTrack(kind: 'video' | 'audio') {
  const listeners = new Map<string, Array<() => void>>();
  return {
    kind,
    readyState: 'live' as string,
    stop: vi.fn(function (this: { readyState: string }) { this.readyState = 'ended'; }),
    addEventListener: (ev: string, fn: () => void) => {
      if (!listeners.has(ev)) listeners.set(ev, []);
      listeners.get(ev)!.push(fn);
    },
    /** 测试用：触发浏览器侧的 ended（用户点「停止共享」） */
    fireEnded: () => { (listeners.get('ended') || []).forEach(fn => fn()); }
  };
}
type FakeTrack = ReturnType<typeof makeTrack>;

class FakeMediaStream {
  constructor(private tracks: FakeTrack[] = []) {}
  getTracks(): FakeTrack[] { return this.tracks; }
  getVideoTracks(): FakeTrack[] { return this.tracks.filter(t => t.kind === 'video'); }
  getAudioTracks(): FakeTrack[] { return this.tracks.filter(t => t.kind === 'audio'); }
  addTrack(t: FakeTrack): void { this.tracks.push(t); }
}

/** 本轮测试创建的全部 recorder，便于断言"只创建了一个" */
let recorders: FakeMediaRecorder[] = [];
class FakeMediaRecorder {
  static isTypeSupported = (): boolean => true;
  state: 'inactive' | 'recording' | 'paused' = 'inactive';
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  constructor(public stream: FakeMediaStream) { recorders.push(this); }
  start(): void { this.state = 'recording'; }
  pause(): void { this.state = 'paused'; }
  resume(): void { this.state = 'recording'; }
  /** 真实 MediaRecorder.stop() 是异步的：先置 inactive，稍后才派发 dataavailable + stop */
  stop(): void { this.state = 'inactive'; }
  /** 测试用：冲刷异步收尾，触发 onstop */
  flush(): void {
    this.ondataavailable?.({ data: new Blob(['x'], { type: 'video/webm' }) });
    this.onstop?.();
  }
}

let audioContexts: FakeAudioContext[] = [];
class FakeAudioContext {
  state = 'suspended';
  resume = vi.fn(async () => { this.state = 'running'; });
  close = vi.fn(async () => { this.state = 'closed'; });
  createMediaStreamSource = vi.fn(() => ({ connect: vi.fn() }));
  createMediaStreamDestination = vi.fn(() => ({ stream: new FakeMediaStream([makeTrack('audio')]) }));
  constructor() { audioContexts.push(this); }
}

/** 被测模块（每个用例重新 import 以获得干净的模块级状态） */
let store: typeof import('@/sidepanel/services/recordingStore');
/** 最近一次 getDisplayMedia 返回的流，供断言轨道释放 */
let displayStream: FakeMediaStream;
let micStream: FakeMediaStream | null;

const OPTS = { systemAudio: true, microphone: true, cursor: true, quality: 'medium' as const };

beforeEach(async () => {
  vi.resetModules();
  recorders = [];
  audioContexts = [];
  micStream = null;
  toastInfo.mockClear();

  displayStream = new FakeMediaStream([makeTrack('video'), makeTrack('audio')]);

  vi.stubGlobal('window', { setInterval: vi.fn(() => 1), clearInterval: vi.fn() });
  vi.stubGlobal('navigator', {
    mediaDevices: {
      getDisplayMedia: vi.fn(async () => displayStream),
      getUserMedia: vi.fn(async () => { micStream = new FakeMediaStream([makeTrack('audio')]); return micStream; })
    }
  });
  vi.stubGlobal('MediaStream', FakeMediaStream);
  vi.stubGlobal('MediaRecorder', FakeMediaRecorder);
  vi.stubGlobal('AudioContext', FakeAudioContext);
  // 不要桩掉全局 URL：node 原生已有 createObjectURL，替换成普通对象会让 vitest 匹配器抛 instanceof 错误
  vi.stubGlobal('chrome', { tabs: { query: vi.fn(async () => [{ id: 1 }]) }, runtime: { id: 'test' } });

  store = await import('@/sidepanel/services/recordingStore');
});

afterEach(() => { vi.unstubAllGlobals(); });

describe('音频链路：混音与音轨校验', () => {
  it('系统声 + 麦克风两路音频经 AudioContext 混音为单条音轨', async () => {
    await store.startRecording({ options: OPTS });

    expect(audioContexts).toHaveLength(1);
    expect(audioContexts[0].createMediaStreamSource).toHaveBeenCalledTimes(2);
    expect(audioContexts[0].resume).toHaveBeenCalled(); // suspended 时须唤醒

    const recorded = recorders[0].stream;
    // MediaRecorder 只采集首条音轨：混音后必须恰好一条，否则一路被丢弃
    expect(recorded.getAudioTracks()).toHaveLength(1);
    expect(recorded.getVideoTracks()).toHaveLength(1);
    // 混音产物是新轨道，不是把两条原始音轨直接塞进去
    expect(recorded.getAudioTracks()[0]).not.toBe(displayStream.getAudioTracks()[0]);
    expect(store.recording.value).toBe(true);
  });

  it('仅一路音频时不建 AudioContext，原样透传该音轨', async () => {
    await store.startRecording({ options: { ...OPTS, microphone: false } });

    expect(audioContexts).toHaveLength(0);
    expect(recorders[0].stream.getAudioTracks()).toHaveLength(1);
    expect(recorders[0].stream.getAudioTracks()[0]).toBe(displayStream.getAudioTracks()[0]);
  });

  it('麦克风获取失败时降级为只录系统声，不中断录制', async () => {
    (navigator.mediaDevices.getUserMedia as any).mockRejectedValueOnce(new Error('Permission denied'));
    await store.startRecording({ options: OPTS });

    expect(store.recording.value).toBe(true);
    expect(audioContexts).toHaveLength(0);
    expect(recorders[0].stream.getAudioTracks()).toHaveLength(1);
    expect(toastInfo).toHaveBeenCalledWith(expect.stringContaining('麦克风不可用'));
  });

  it('请求系统声但来源无音轨（Chrome 应用窗口）→ 明确提示且继续录制', async () => {
    displayStream = new FakeMediaStream([makeTrack('video')]);
    await store.startRecording({ options: { ...OPTS, microphone: false } });

    expect(toastInfo).toHaveBeenCalledWith(expect.stringContaining('不提供系统声音'));
    expect(store.recording.value).toBe(true);
    expect(recorders[0].stream.getAudioTracks()).toHaveLength(0);
  });

  it('采集流无视频轨 → 报错、不进入录制态并释放轨道', async () => {
    const orphanAudio = makeTrack('audio');
    displayStream = new FakeMediaStream([orphanAudio]);
    await store.startRecording({ options: OPTS });

    expect(store.recording.value).toBe(false);
    expect(store.error.value).toContain('不含画面');
    expect(recorders).toHaveLength(0);
    expect(orphanAudio.stop).toHaveBeenCalled();
  });
});

describe('停止时序：轨道释放推迟到 onstop', () => {
  it('stopRecording 后轨道仍存活，汇总完成才释放（避免截掉末尾约 1s）', async () => {
    await store.startRecording({ options: OPTS });
    const video = displayStream.getVideoTracks()[0];
    const sysAudio = displayStream.getAudioTracks()[0];
    const micAudio = micStream!.getAudioTracks()[0];

    store.stopRecording();
    expect(recorders[0].state).toBe('inactive');
    // 关键断言：此刻还不能停轨，否则 MediaRecorder 来不及冲刷最后的分片
    expect(video.stop).not.toHaveBeenCalled();
    expect(sysAudio.stop).not.toHaveBeenCalled();
    expect(micAudio.stop).not.toHaveBeenCalled();
    expect(store.recording.value).toBe(false);

    recorders[0].flush();
    expect(video.stop).toHaveBeenCalledTimes(1);
    expect(sysAudio.stop).toHaveBeenCalledTimes(1);
    expect(micAudio.stop).toHaveBeenCalledTimes(1);
    expect(audioContexts[0].close).toHaveBeenCalled();
    expect(store.recordings.value).toHaveLength(1);
  });

  it('recorder 已 inactive 时停止：直接释放轨道，不产生空产物', async () => {
    await store.startRecording({ options: OPTS });
    recorders[0].state = 'inactive';
    const video = displayStream.getVideoTracks()[0];

    store.stopRecording();
    expect(video.stop).toHaveBeenCalled();
    expect(store.recordings.value).toHaveLength(0);
  });
});

describe('重入守卫与 ended 竞态', () => {
  it('录制中重复启动被拒绝，不创建第二个 recorder', async () => {
    await store.startRecording({ options: OPTS });
    await store.startRecording({ options: OPTS });

    expect(recorders).toHaveLength(1);
    expect(navigator.mediaDevices.getDisplayMedia).toHaveBeenCalledTimes(1);
    expect(toastInfo).toHaveBeenCalledWith(expect.stringContaining('正在录制中'));
  });

  it('停止并汇总后可以开始新一轮录制', async () => {
    await store.startRecording({ options: OPTS });
    store.stopRecording();
    recorders[0].flush();

    await store.startRecording({ options: OPTS });
    expect(recorders).toHaveLength(2);
    expect(store.recording.value).toBe(true);
  });

  it('「停止共享」以 recorder 状态判定，recording 标记尚未置位也能结束', async () => {
    await store.startRecording({ options: OPTS });
    // 复现竞态窗口：标记被置回 false，但 recorder 仍在录
    store.recording.value = false;
    displayStream.getVideoTracks()[0].fireEnded();

    expect(recorders[0].state).toBe('inactive');
    recorders[0].flush();
    expect(store.recordings.value).toHaveLength(1);
  });

  it('已停止后再收到 ended 不重复汇总产物', async () => {
    await store.startRecording({ options: OPTS });
    store.stopRecording();
    recorders[0].flush();

    displayStream.getVideoTracks()[0].fireEnded();
    expect(store.recordings.value).toHaveLength(1);
  });
});