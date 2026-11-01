/**
 * 模板与文件名格式化工具。
 */

/**
 * 用数据替换模板中的 {key} 占位符。
 */
export function formatPrompt(template: string, data: Record<string, unknown> | undefined): string {
  if (!template) return '';
  return template.replace(/\{([^}]+)\}/g, (_m, key) => {
    const v = data ? (data as any)[key] : undefined;
    return typeof v !== 'undefined' ? String(v) : `{${key}}`;
  });
}

/**
 * 根据模板生成合法文件名，自动包含日期/时间占位符。
 */
export function formatFilename(template: string | undefined, data: Record<string, unknown>): string {
  const base = template || 'analysis_result';
  const now = new Date();
  const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const timeStr = `${String(now.getHours()).padStart(2, '0')}-${String(now.getMinutes()).padStart(2, '0')}`;
  const templateData = { ...data, date: dateStr, time: timeStr, datetime: `${dateStr}_${timeStr}` };
  let filename = base.replace(/\{([^}]+)\}/g, (_m, key) => {
    const v = (templateData as any)[key];
    return typeof v !== 'undefined' ? String(v) : `{${key}}`;
  });
  filename = filename.replace(/[\\/:*?"<>|]/g, '_');
  return filename || 'analysis_result';
}

/**
 * 格式化字节大小。
 */
export function formatBytes(bytes: number, decimals = 2) {
  if (!+bytes) return '0 B';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}
