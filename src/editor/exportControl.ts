/**
 * 导出会话控制（编辑器两条导出通道共用的纯逻辑）。
 *
 * 收敛三类真实故障：
 *  1. 收尾挂死：`rec.stop()` 之后才挂 onstop，若录制器已停止则事件永不再来，
 *     Promise 永不 resolve，导出遮罩永久卡住；
 *  2. 画面截尾：MediaRecorder 按墙钟采集，渲染快于实时会让成片短于音轨；
 *  3. 静默丢音轨：单条音轨解码失败被 catch 吞掉，成片缺声而用户全程无感知。
 * 取消统一用标准 AbortSignal.throwIfAborted()，此处不另造一套取消语义。
 * 这里只放不依赖 Vue/DOM 的部分，便于 tests/unit 直接覆盖。
 */

/** 录制器收尾等待上限：超过即判失败，绝不静默交出一个被截断的文件 */
export const EXPORT_STOP_TIMEOUT_MS = 8000;

/**
 * 安全停止 MediaRecorder 并等待收尾完成。
 * 关键顺序：先挂 onstop/onerror 再 stop()——stop() 可能同步派发事件，晚挂就永远等不到。
 * 已处于 inactive 时直接返回（此时 stop() 会抛 InvalidStateError）。
 * @param rec       录制器
 * @param timeoutMs 收尾等待上限
 */
export async function stopMediaRecorder(rec: MediaRecorder, timeoutMs = EXPORT_STOP_TIMEOUT_MS): Promise<void> {
  if (rec.state === 'inactive') return;
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const cleanup = () => { rec.onstop = null; rec.onerror = null; };
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error(`封装超时：录制器未在 ${Math.round(timeoutMs / 1000)} 秒内收尾`));
    }, timeoutMs);
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      cleanup();
      resolve();
    };
    rec.onstop = finish;
    rec.onerror = finish;
    // 主动索取最后一块数据：不依赖 timeslice 恰好在此刻到点
    try { rec.requestData(); } catch { /* noop：状态已变时不影响收尾 */ }
    try {
      rec.stop();
    } catch (e) {
      settled = true;
      clearTimeout(timer);
      cleanup();
      reject(e instanceof Error ? e : new Error(String(e)));
    }
  });
}

/**
 * 计算逐帧渲染后需要等待的毫秒数。
 * MediaRecorder 按墙钟采集画布流：渲染快于实时会让成片短于音轨（画面被截尾），
 * 故每帧必须对齐到 (frameIndex+1)/fps 秒的真实时刻。落后时返回 0，由调用方让出主线程。
 * @param startMs    渲染起始墙钟（performance.now()）
 * @param frameIndex 刚渲染完的帧序号（从 0 起）
 * @param fps        目标帧率
 * @param nowMs      当前墙钟
 */
export function computeFrameDelay(startMs: number, frameIndex: number, fps: number, nowMs: number): number {
  if (!isFinite(fps) || fps <= 0) return 0;
  const due = startMs + ((frameIndex + 1) / fps) * 1000;
  return Math.max(0, due - nowMs);
}

/** 导出音轨来源 */
export type ExportTrackKind = 'clip' | 'bgm' | 'dub';

/** 把单条音轨的失败归因为面向用户的一句话（进可见告警清单，不再静默跳过） */
export function describeAudioTrackFailure(kind: ExportTrackKind, label: string, err: unknown): string {
  const reason = err instanceof Error ? err.message : String(err);
  const noun = kind === 'bgm' ? '背景音乐' : kind === 'dub' ? '配音' : '片段原声';
  return `${noun}「${label || '未命名'}」未能加入导出音轨：${reason}`;
}