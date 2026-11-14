/**
 * 资源清单导出：JSON / CSV（UTF-8 BOM，Excel 直接打开中文不乱码）。
 * 产物经 chrome.downloads 保存到默认下载目录（侧边栏为扩展页面，可直接调用）。
 */

// P1-8：分级日志（扩展页面上下文默认 info 级）
import { createLogger } from '@/utils/logger';

/** 本模块 logger：保留原 `[export]` 前缀语义 */
const log = createLogger('export');

export interface ExportColumn<T> {
  label: string;
  value: (item: T) => string | number | boolean | undefined | null;
}

function downloadBlob(blob: Blob, fileName: string): void {
  try {
    const url = URL.createObjectURL(blob);
    chrome.downloads.download({ url, filename: fileName, conflictAction: 'uniquify' }, () => {
      void chrome.runtime.lastError;
      setTimeout(() => { try { URL.revokeObjectURL(url); } catch { /* noop */ } }, 60_000);
    });
    import('../composables/useToast').then(({ toast }) => toast.success(`已导出 ${fileName}`)).catch(() => { /* noop */ });
  } catch (e) {
    log.warn('触发下载失败:', e);
  }
}

function timestampName(prefix: string, ext: string): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${prefix}_${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}.${ext}`;
}

function csvEscape(v: unknown): string {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * 以「前缀_时间戳.扩展名」命名并下载任意 Blob（供 HAR 等非行列表类导出复用）。
 * @param blob 文件内容
 * @param prefix 文件名前缀（如「接口抓取」）
 * @param ext 扩展名（不带点，如 'har'）
 */
export function exportBlobWithTimestamp(blob: Blob, prefix: string, ext: string): void {
  downloadBlob(blob, timestampName(prefix, ext));
}

export function exportRowsAsJSON<T>(rows: T[], prefix = '资源清单'): void {
  try {
    const blob = new Blob([JSON.stringify(rows, null, 2)], { type: 'application/json;charset=utf-8' });
    downloadBlob(blob, timestampName(prefix, 'json'));
  } catch (e) {
    log.warn('JSON 导出失败:', e);
  }
}

export function exportRowsAsCSV<T>(rows: T[], columns: ExportColumn<T>[], prefix = '资源清单'): void {
  try {
    const header = columns.map(c => csvEscape(c.label)).join(',');
    const lines = rows.map(r => columns.map(c => csvEscape(c.value(r))).join(','));
    // \ufeff BOM：保证 Excel 识别 UTF-8
    const blob = new Blob(['\ufeff' + header + '\r\n' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    downloadBlob(blob, timestampName(prefix, 'csv'));
  } catch (e) {
    log.warn('CSV 导出失败:', e);
  }
}

export function formatDuration(seconds?: number): string {
  if (!Number.isFinite(seconds) || (seconds ?? 0) <= 0) return '';
  const s = Math.round(seconds!);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return m > 0 ? `${m}m${r}s` : `${r}s`;
}
