/**
 * 录制定时自动停止（Round 5 #32）——纯逻辑层。
 *
 * 计时口径刻意与面板显示的录像时长一致（不含暂停段）：用户设「5 分钟」
 * 期望的是成片 5 分钟，而不是墙钟 5 分钟。判定放在 store 的每秒计时回调里，
 * 不另起定时器，避免暂停/恢复时两套计时漂移。
 */

/** 自动停止预设（0 = 不限） */
export const AUTO_STOP_PRESETS: Array<{ label: string; seconds: number }> = [
  { label: '不限', seconds: 0 },
  { label: '1 分钟', seconds: 60 },
  { label: '3 分钟', seconds: 180 },
  { label: '5 分钟', seconds: 300 },
  { label: '10 分钟', seconds: 600 },
  { label: '30 分钟', seconds: 1800 }
];

/** 上限 4 小时：再长的录制应当分段，单个 webm 过大时转码与交接都会吃满内存 */
export const AUTO_STOP_MAX_SECONDS = 4 * 3600;

/**
 * 归一化用户输入：非法/负数/超限一律收敛到合法区间，0 表示不限。
 * 面板的自定义输入框可能传来空串或 NaN，不能让它变成「立刻停止」。
 */
export function normalizeAutoStopSeconds(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(Math.floor(n), AUTO_STOP_MAX_SECONDS);
}

/** 是否到达自动停止点（不限时永不触发） */
export function shouldAutoStop(elapsedSeconds: number, limitSeconds: number): boolean {
  if (!(limitSeconds > 0)) return false;
  return elapsedSeconds >= limitSeconds;
}

/** 剩余秒数（不限时返回 0，面板据此隐藏倒计时） */
export function remainingSeconds(elapsedSeconds: number, limitSeconds: number): number {
  if (!(limitSeconds > 0)) return 0;
  return Math.max(0, limitSeconds - Math.max(0, Math.floor(elapsedSeconds)));
}

/** 倒计时文本：mm:ss，超过 1 小时补 hh */
export function formatCountdown(totalSeconds: number): string {
  // Math.floor(NaN) 仍是 NaN，Math.max 也拦不住，必须先判有限性
  const s = Number.isFinite(totalSeconds) ? Math.max(0, Math.floor(totalSeconds)) : 0;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${pad(h)}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
}