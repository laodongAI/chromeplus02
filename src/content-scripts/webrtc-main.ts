/**
 * WebRTC 录流 —— MAIN 世界脚本（Round 5 #30）。
 *
 * 为什么必须活在 MAIN 世界：
 *  - RTCPeerConnection 实例由页面脚本创建，ISOLATED 内容脚本看不到它们；
 *  - MediaStream 不可跨世界传递，MediaRecorder 只能建在持有流的世界里。
 * 因此本文件不使用任何 chrome.* API，产物经 window.postMessage 交给 ISOLATED 桥接脚本。
 *
 * 注入方式：由后台按设置动态注册（world=MAIN, runAt=document_start），
 * 关闭时完全不注入，避免给所有页面凭空加一层构造函数包装。
 * 开启后需要刷新页面才能挂上已存在的连接——这是 document_start 钩子的固有限制。
 *
 * 兼容性约定：包装后的构造函数必须与原构造函数行为一致
 * （prototype 不变、静态成员可继承、instanceof 成立），否则依赖这些特性的站点会坏。
 */

import {
  RTC_BRIDGE_SOURCE,
  RTC_CHUNK_BYTES,
  arrayBufferToBase64,
  buildRtcFileName,
  classifyStreamKind,
  mergeRtcStreams,
  parseRtcDownCommand,
  pickRtcMime,
  type RtcRecordMeta,
  type RtcStreamInfo,
  type RtcTrackInfo
} from '@/core/webrtcCapture';

/** 重复注入保护：同一文档只挂一次钩子 */
const INSTALL_FLAG = '__mediaplusRtcHooked';

interface KnownStream {
  stream: MediaStream;
  info: RtcStreamInfo;
}

interface ActiveRecord {
  recordId: string;
  recorder: MediaRecorder;
  mode: 'video' | 'audio';
  mime: string;
  fileName: string;
  startedAt: number;
  seq: number;
  sizeBytes: number;
  queue: Blob[];
  draining: boolean;
  finished: boolean;
  metaSent: boolean;
}

function post(payload: Record<string, unknown>): void {
  try { window.postMessage({ source: RTC_BRIDGE_SOURCE, dir: 'up', ...payload }, '*'); } catch { /* 总线不可用：放弃本次上报 */ }
}

function trackInfo(t: MediaStreamTrack): RtcTrackInfo {
  return {
    kind: t.kind === 'video' ? 'video' : 'audio',
    id: t.id,
    label: t.label || '',
    enabled: t.enabled,
    muted: t.muted,
    readyState: t.readyState
  };
}

function install(): void {
  const g = window as unknown as Record<string, any>;
  const Native: typeof RTCPeerConnection | undefined = g.RTCPeerConnection || g.webkitRTCPeerConnection;
  /** 已知远端流（stream.id → 流本体 + 摘要） */
  const known = new Map<string, KnownStream>();
  /** 进行中的录制（recordId → 状态） */
  const active = new Map<string, ActiveRecord>();
  let connSeq = 0;
  let reportTimer: number | null = null;

  function snapshot(): RtcStreamInfo[] {
    const list: RtcStreamInfo[] = [];
    for (const k of known.values()) {
      const tracks = k.stream.getTracks().map(trackInfo);
      if (!tracks.length) continue;
      list.push({ ...k.info, kind: classifyStreamKind(tracks), tracks });
    }
    return mergeRtcStreams([], list);
  }

  /** 合并上报：track 事件常常连发，逐条 postMessage 会把总线刷爆 */
  function report(): void {
    if (reportTimer !== null) return;
    reportTimer = window.setTimeout(() => {
      reportTimer = null;
      post({ kind: 'streams', streams: snapshot() });
    }, 200);
  }

  function registerStream(stream: MediaStream, connectionId: number, direction: 'remote' | 'local'): void {
    if (!stream || !stream.id) return;
    if (known.has(stream.id)) { report(); return; }
    const tracks = stream.getTracks().map(trackInfo);
    if (!tracks.length) return;
    known.set(stream.id, {
      stream,
      info: { id: stream.id, connectionId, direction, kind: classifyStreamKind(tracks), tracks, discoveredAt: Date.now() }
    });
    // 轨道结束/移除后清单要跟着变，否则面板会一直显示一路已经死掉的流
    stream.addEventListener('removetrack', report);
    stream.addEventListener('addtrack', report);
    for (const t of stream.getTracks()) t.addEventListener('ended', report);
    report();
  }

  function dropConnection(connectionId: number): void {
    let changed = false;
    for (const [id, k] of known) {
      if (k.info.connectionId === connectionId) { known.delete(id); changed = true; }
    }
    if (changed) report();
  }

  if (Native) {
    const Patched = function (this: unknown, ...args: any[]) {
      const pc: RTCPeerConnection = new (Native as any)(...args);
      const connectionId = ++connSeq;
      try {
        pc.addEventListener('track', (ev: RTCTrackEvent) => {
          const list = ev.streams && ev.streams.length ? Array.from(ev.streams) : [new MediaStream([ev.track])];
          for (const s of list) registerStream(s, connectionId, 'remote');
        });
        // 老站点仍用 addstream（已废弃但存在）
        pc.addEventListener('addstream', (ev: any) => { if (ev?.stream) registerStream(ev.stream, connectionId, 'remote'); });
        pc.addEventListener('connectionstatechange', () => {
          if (pc.connectionState === 'closed' || pc.connectionState === 'failed') dropConnection(connectionId);
        });
      } catch { /* 监听失败不影响连接本身 */ }
      return pc;
    } as unknown as typeof RTCPeerConnection;
    // prototype 与静态成员都指向原生构造函数：instanceof / generateCertificate 等用法保持可用
    (Patched as any).prototype = (Native as any).prototype;
    Object.setPrototypeOf(Patched, Native);
    g.RTCPeerConnection = Patched;
    if (g.webkitRTCPeerConnection) g.webkitRTCPeerConnection = Patched;
  }

  /** 把队列里的 Blob 切片上送；串行执行，保证 seq 与产物字节顺序一致 */
  async function drain(rec: ActiveRecord): Promise<void> {
    if (rec.draining) return;
    rec.draining = true;
    try {
      while (rec.queue.length) {
        const blob = rec.queue.shift()!;
        if (!blob.size) continue;
        const buf = await blob.arrayBuffer();
        for (let off = 0; off < buf.byteLength; off += RTC_CHUNK_BYTES) {
          const slice = buf.slice(off, off + RTC_CHUNK_BYTES);
          const meta: RtcRecordMeta | undefined = rec.metaSent ? undefined : {
            id: rec.recordId,
            mode: rec.mode,
            mimeType: rec.mime,
            fileName: rec.fileName,
            sizeBytes: 0,
            durationMs: 0,
            createdAt: Date.now(),
            sourceTitle: document.title || '',
            sourceUrl: location.href
          };
          rec.metaSent = true;
          rec.sizeBytes += slice.byteLength;
          post({ kind: 'chunk', recordId: rec.recordId, seq: rec.seq++, data: arrayBufferToBase64(slice), meta });
        }
      }
    } finally {
      rec.draining = false;
    }
  }

  async function finish(rec: ActiveRecord): Promise<void> {
    if (rec.finished) return;
    rec.finished = true;
    await drain(rec);
    post({
      kind: 'done',
      recordId: rec.recordId,
      total: rec.seq,
      durationMs: Date.now() - rec.startedAt,
      sizeBytes: rec.sizeBytes
    });
    active.delete(rec.recordId);
  }

  function stopRecord(recordId: string): void {
    const rec = active.get(recordId);
    if (!rec) return;
    try { if (rec.recorder.state !== 'inactive') rec.recorder.stop(); else void finish(rec); } catch { void finish(rec); }
  }

  function startRecord(recordId: string, streamId: string, mode: 'video' | 'audio', fileName: string): void {
    if (active.has(recordId)) return;
    const k = known.get(streamId);
    if (!k) { post({ kind: 'status', recordId, state: 'error', error: '该 WebRTC 流已不存在，请刷新列表' }); return; }
    const tracks = mode === 'audio' ? k.stream.getAudioTracks() : k.stream.getTracks();
    if (!tracks.length) { post({ kind: 'status', recordId, state: 'error', error: mode === 'audio' ? '该流没有音频轨' : '该流没有可录制的轨道' }); return; }
    if (typeof MediaRecorder === 'undefined') { post({ kind: 'status', recordId, state: 'error', error: '当前浏览器不支持 MediaRecorder' }); return; }
    const mime = pickRtcMime(mode, (m) => MediaRecorder.isTypeSupported(m));
    if (!mime) { post({ kind: 'status', recordId, state: 'error', error: '浏览器不支持可用的 WebM/MP4 录制格式' }); return; }

    let recorder: MediaRecorder;
    try {
      // 仅录音时另建一条只含音频轨的流，避免把视频也录进去
      const target = mode === 'audio' ? new MediaStream(tracks) : k.stream;
      recorder = new MediaRecorder(target, { mimeType: mime });
    } catch (e) {
      post({ kind: 'status', recordId, state: 'error', error: `创建录制器失败：${e instanceof Error ? e.message : String(e)}` });
      return;
    }
    const rec: ActiveRecord = {
      recordId, recorder, mode, mime,
      fileName: fileName || buildRtcFileName(document.title, mode, mime, Date.now()),
      startedAt: Date.now(), seq: 0, sizeBytes: 0, queue: [], draining: false, finished: false, metaSent: false
    };
    recorder.ondataavailable = (e: BlobEvent) => {
      if (e.data && e.data.size) { rec.queue.push(e.data); void drain(rec); }
    };
    recorder.onstop = () => { void finish(rec); };
    recorder.onerror = (e: Event) => {
      const err = (e as unknown as { error?: { message?: string } })?.error?.message || '录制出错';
      post({ kind: 'status', recordId, state: 'error', error: err });
      void finish(rec);
    };
    active.set(recordId, rec);
    try {
      // 3s 一片：既能持续上送（长录制不必把整段留在内存），又不至于把总线刷爆
      recorder.start(3000);
      post({ kind: 'status', recordId, state: 'recording' });
    } catch (e) {
      active.delete(recordId);
      post({ kind: 'status', recordId, state: 'error', error: `启动录制失败：${e instanceof Error ? e.message : String(e)}` });
      return;
    }
    // 对端挂断后轨道会 ended，此时自动收尾，避免产物永远等不到 DONE
    for (const t of tracks) t.addEventListener('ended', () => stopRecord(recordId), { once: true });
  }

  window.addEventListener('message', (ev: MessageEvent) => {
    if (ev.source !== window) return;
    const cmd = parseRtcDownCommand(ev.data);
    if (!cmd) return;
    if (cmd.kind === 'list') { post({ kind: 'streams', streams: snapshot() }); return; }
    if (cmd.kind === 'start') { startRecord(cmd.recordId, cmd.streamId, cmd.mode, cmd.fileName); return; }
    stopRecord(cmd.recordId);
  });

  // 页面卸载/刷新：把已录到的部分收尾入库，而不是整段丢掉
  window.addEventListener('pagehide', () => { for (const id of [...active.keys()]) stopRecord(id); });

  post({ kind: 'hello', streams: snapshot() });
}

const g = window as unknown as Record<string, any>;
if (!g[INSTALL_FLAG]) {
  g[INSTALL_FLAG] = true;
  try { install(); } catch { /* 挂钩失败不能影响页面本身 */ }
}