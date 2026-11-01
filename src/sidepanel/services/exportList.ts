/**
 * 资源清单导出：JSON / CSV（UTF-8 BOM，Excel 直接打开中文不乱码）。
 * 产物经 chrome.downloads 保存到默认下载目录（侧边栏为扩展页面，可直接调用）。
 */

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
    console.warn('[export] 触发下载失败:', e);
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

export function exportRowsAsJSON<T>(rows: T[], prefix = '资源清单'): void {
  try {
    const blob = new Blob([JSON.stringify(rows, null, 2)], { type: 'application/json;charset=utf-8' });
    downloadBlob(blob, timestampName(prefix, 'json'));
  } catch (e) {
    console.warn('[export] JSON 导出失败:', e);
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
    console.warn('[export] CSV 导出失败:', e);
  }
}

export function formatDuration(seconds?: number): string {
  if (!Number.isFinite(seconds) || (seconds ?? 0) <= 0) return '';
  const s = Math.round(seconds!);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return m > 0 ? `${m}m${r}s` : `${r}s`;
}
