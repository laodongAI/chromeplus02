/**
 * Round 5 #30：WebRTC 录流纯逻辑单测。
 * 重点是"总线不可信"与"产物必须能还原"：上行/下行消息校验、流清单归一化与去重、
 * 封装格式选择、base64 分片编码（大缓冲不能栈溢出）。
 */
import { describe, expect, it } from 'vitest';
import {
  RTC_BRIDGE_SOURCE,
  RTC_CHUNK_BYTES,
  arrayBufferToBase64,
  buildRtcFileName,
  classifyStreamKind,
  describeRtcStream,
  makeRtcRecordId,
  mergeRtcStreams,
  normalizeRtcStream,
  parseRtcDownCommand,
  parseRtcUpEvent,
  pickRtcMime,
  type RtcStreamInfo,
  type RtcTrackInfo
} from '@/core/webrtcCapture';

const track = (patch: Partial<RtcTrackInfo> = {}): RtcTrackInfo => ({
  kind: 'video', id: 't1', label: '', enabled: true, muted: false, readyState: 'live', ...patch
});
const stream = (patch: Partial<RtcStreamInfo> = {}): RtcStreamInfo => ({
  id: 's1', connectionId: 1, direction: 'remote', kind: 'video', tracks: [track()], discoveredAt: 1, ...patch
});
const up = (payload: Record<string, unknown>) => ({ source: RTC_BRIDGE_SOURCE, dir: 'up', ...payload });
const down = (payload: Record<string, unknown>) => ({ source: RTC_BRIDGE_SOURCE, dir: 'down', ...payload });

describe('parseRtcUpEvent：总线不是信任边界', () => {
  it('来源/方向不对的一律丢弃（页面自己也能 postMessage）', () => {
    expect(parseRtcUpEvent(null)).toBeNull();
    expect(parseRtcUpEvent('x')).toBeNull();
    expect(parseRtcUpEvent({ source: 'other', dir: 'up', kind: 'streams', streams: [] })).toBeNull();
    expect(parseRtcUpEvent({ source: RTC_BRIDGE_SOURCE, dir: 'down', kind: 'list' })).toBeNull();
    expect(parseRtcUpEvent(up({ kind: 'whatever' }))).toBeNull();
  });

  it('流清单逐条归一化，非法条目被剔除而不是整包失败', () => {
    const ev = parseRtcUpEvent(up({ kind: 'streams', streams: [stream(), { id: '' }, null, { id: 's2', tracks: [] }] }));
    expect(ev?.kind).toBe('streams');
    expect((ev as any).streams).toHaveLength(1);
  });

  it('分块必须带合法 recordId / 非负整数 seq / 字符串 data', () => {
    expect(parseRtcUpEvent(up({ kind: 'chunk', recordId: 'r', seq: 0, data: 'AA==' }))?.kind).toBe('chunk');
    expect(parseRtcUpEvent(up({ kind: 'chunk', recordId: '', seq: 0, data: 'x' }))).toBeNull();
    expect(parseRtcUpEvent(up({ kind: 'chunk', recordId: 'r', seq: -1, data: 'x' }))).toBeNull();
    expect(parseRtcUpEvent(up({ kind: 'chunk', recordId: 'r', seq: 1.5, data: 'x' }))).toBeNull();
    expect(parseRtcUpEvent(up({ kind: 'chunk', recordId: 'r', seq: 0, data: 123 }))).toBeNull();
  });

  it('首块 meta 缺字段时补默认值，而不是让后台拿到 undefined', () => {
    const ev = parseRtcUpEvent(up({ kind: 'chunk', recordId: 'r', seq: 0, data: 'x', meta: { id: 'r', mode: 'video' } })) as any;
    expect(ev.meta.mimeType).toBe('video/webm');
    expect(ev.meta.fileName).toBe('webrtc.webm');
    expect(ev.meta.sizeBytes).toBe(0);
  });

  it('done 的 total 必须是非负整数；status 只认三种状态', () => {
    expect((parseRtcUpEvent(up({ kind: 'done', recordId: 'r', total: 3 })) as any).total).toBe(3);
    expect(parseRtcUpEvent(up({ kind: 'done', recordId: 'r', total: -1 }))).toBeNull();
    expect(parseRtcUpEvent(up({ kind: 'done', recordId: 'r', total: 'x' }))).toBeNull();
    expect(parseRtcUpEvent(up({ kind: 'status', recordId: 'r', state: 'recording' }))?.kind).toBe('status');
    expect(parseRtcUpEvent(up({ kind: 'status', recordId: 'r', state: 'paused' }))).toBeNull();
  });
});

describe('parseRtcDownCommand：MAIN 世界侧同样不信任总线', () => {
  it('list / start / stop 的基本校验', () => {
    expect(parseRtcDownCommand(down({ kind: 'list' }))?.kind).toBe('list');
    expect(parseRtcDownCommand(down({ kind: 'start', recordId: 'r', streamId: 's', mode: 'audio' }))?.kind).toBe('start');
    expect(parseRtcDownCommand(down({ kind: 'stop', recordId: 'r' }))?.kind).toBe('stop');
    expect(parseRtcDownCommand(down({ kind: 'start', recordId: 'r', streamId: 's', mode: 'both' }))).toBeNull();
    expect(parseRtcDownCommand(down({ kind: 'start', recordId: '', streamId: 's', mode: 'video' }))).toBeNull();
    expect(parseRtcDownCommand(down({ kind: 'stop' }))).toBeNull();
    expect(parseRtcDownCommand({ source: RTC_BRIDGE_SOURCE, dir: 'up', kind: 'list' })).toBeNull();
  });

  it('start 缺 fileName 时兜底，不会把 undefined 传进录制器', () => {
    const cmd = parseRtcDownCommand(down({ kind: 'start', recordId: 'r', streamId: 's', mode: 'video' })) as any;
    expect(cmd.fileName).toBe('webrtc');
  });
});

describe('流清单归一化与合并', () => {
  it('缺 id 或无有效轨道的流丢弃；direction 默认 remote', () => {
    expect(normalizeRtcStream({ id: 's', tracks: [track()] })?.direction).toBe('remote');
    expect(normalizeRtcStream({ tracks: [track()] })).toBeNull();
    expect(normalizeRtcStream({ id: 's', tracks: [{ kind: 'data', id: 'x' }] })).toBeNull();
    expect(normalizeRtcStream({ id: 's', tracks: 'nope' })).toBeNull();
  });

  it('类型按轨道构成判定', () => {
    expect(classifyStreamKind([track({ kind: 'audio' })])).toBe('audio');
    expect(classifyStreamKind([track()])).toBe('video');
    expect(classifyStreamKind([track(), track({ kind: 'audio', id: 't2' })])).toBe('mixed');
  });

  it('按 id 去重，剔除本地流与已全部 ended 的流', () => {
    const merged = mergeRtcStreams(
      [stream({ id: 'a' }), stream({ id: 'b', direction: 'local' })],
      [stream({ id: 'a', connectionId: 9 }), stream({ id: 'c', tracks: [track({ readyState: 'ended' })] }), stream({ id: 'd' })]
    );
    expect(merged.map((s) => s.id)).toEqual(['a', 'd']);
    expect(merged[0].connectionId).toBe(9);
  });

  it('面板摘要包含连接序号/类型/轨道数，全静音时标注', () => {
    expect(describeRtcStream(stream())).toContain('连接 #1');
    expect(describeRtcStream(stream())).toContain('视频');
    expect(describeRtcStream(stream({ tracks: [track({ muted: true })] }))).toContain('静音中');
    expect(describeRtcStream(stream({ kind: 'mixed', tracks: [track(), track({ kind: 'audio', id: 't2' })] }))).toContain('音视频');
  });
});

describe('pickRtcMime：不硬写浏览器不认的格式', () => {
  it('按候选顺序取第一个被支持的', () => {
    expect(pickRtcMime('video', () => true)).toBe('video/webm;codecs=vp9,opus');
    expect(pickRtcMime('video', (m) => m === 'video/webm;codecs=vp8,opus')).toBe('video/webm;codecs=vp8,opus');
    expect(pickRtcMime('audio', () => true)).toBe('audio/webm;codecs=opus');
  });

  it('全不支持返回空串；探测函数抛错时继续试下一个', () => {
    expect(pickRtcMime('video', () => false)).toBe('');
    expect(pickRtcMime('video', (m) => { if (m.includes('vp9')) throw new Error('bad'); return true; }))
      .toBe('video/webm;codecs=vp8,opus');
  });
});

describe('buildRtcFileName：非法字符与扩展名', () => {
  const now = new Date(2026, 10, 11, 9, 8, 7).getTime();
  it('剥掉 Windows 非法字符并带时间戳', () => {
    const name = buildRtcFileName('a<b>c:d"e|f?g*h', 'video', 'video/webm', now);
    expect(name).toBe('abcdefgh_video_20261111_090807.webm');
  });

  it('扩展名跟随实际封装；空标题兜底', () => {
    expect(buildRtcFileName('', 'audio', 'audio/webm;codecs=opus', now).endsWith('.webm')).toBe(true);
    expect(buildRtcFileName('t', 'audio', 'audio/ogg;codecs=opus', now).endsWith('.ogg')).toBe(true);
    expect(buildRtcFileName('t', 'video', 'video/mp4', now).endsWith('.mp4')).toBe(true);
    expect(buildRtcFileName('', 'video', 'video/webm', now).startsWith('webrtc_')).toBe(true);
  });

  it('超长标题被截断，不会生成超长文件名', () => {
    expect(buildRtcFileName('x'.repeat(300), 'video', 'video/webm', now).length).toBeLessThan(100);
  });
});

describe('分块编码与 id', () => {
  it('base64 与 atob 往返一致，且大于 32K 的缓冲不栈溢出', () => {
    const bytes = new Uint8Array(RTC_CHUNK_BYTES);
    for (let i = 0; i < bytes.length; i++) bytes[i] = i % 256;
    const b64 = arrayBufferToBase64(bytes.buffer);
    const back = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    expect(back.length).toBe(bytes.length);
    expect(back[0]).toBe(0);
    expect(back[bytes.length - 1]).toBe(bytes[bytes.length - 1]);
  });

  it('空缓冲编码为空串', () => {
    expect(arrayBufferToBase64(new ArrayBuffer(0))).toBe('');
  });

  it('recordId 带前缀且随随机数变化（页面无法预先猜出后台发起的 id）', () => {
    const a = makeRtcRecordId(1700000000000, 0.123456);
    const b = makeRtcRecordId(1700000000000, 0.654321);
    expect(a.startsWith('rtc_')).toBe(true);
    expect(a).not.toBe(b);
  });
});