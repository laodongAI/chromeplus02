/**
 * 文件命名变量服务：集中描述与扩展占位符，提供解析与校验。
 */
import { formatFilename } from '@/utils/format';

export interface NamingContext {
  site?: string;
  title?: string;
  index?: number;
  date?: string;
  time?: string;
  datetime?: string;
}

export interface NamingVariableDescriptor { key: string; description: string; example?: string }

export const NAMING_VARIABLES: NamingVariableDescriptor[] = [
  { key: 'site', description: '站点主机名（去除 www）', example: 'youtube' },
  { key: 'title', description: '页面或资源标题截断', example: 'MyVideoTitle' },
  { key: 'date', description: '当前日期 YYYY-MM-DD', example: '2025-11-19' },
  { key: 'time', description: '当前时间 HH-MM', example: '13-42' },
  { key: 'datetime', description: 'date + _ + time', example: '2025-11-19_13-42' },
  { key: 'index', description: '序号（队列/扫描顺序）', example: '3' }
];

export function generateFilename(template: string, ctx: NamingContext): string {
  return formatFilename(template, ctx as Record<string, unknown>);
}

export function sanitizeTemplate(input: string): string {
  return input.replace(/\s+/g, '_').slice(0, 140);
}

export function listVariables(): NamingVariableDescriptor[] { return NAMING_VARIABLES.slice(); }
