/**
 * 站点识别与支持性判断工具。
 * 数据源：src/data/sites.ts（内置分类目录）。
 * 匹配规则：hostname 后缀精确匹配（避免 notbilibili.com 误判）。
 * 变更记录：删除依赖 RootConfig.supportedSites 的死分支
 *           （config.ts 已随死代码清理移除，全项目无调用方传入 config）。
 */

import { findSiteEntryByHost } from '@/data/sites';

/** 站点信息结构（对外返回的精简视图） */
export interface SiteInfo { id: string; name?: string; category?: string; desc?: string }

/**
 * 检查 URL 是否属于支持的网站（仅内置目录）。
 * @param url 页面 URL（或 host 形式字符串）
 */
export function isSupportedSite(url?: string): boolean {
  if (!url) return false;
  return !!findSiteEntryByHost(url);
}

/**
 * 根据 URL 获取网站信息（含中文名/分类/描述，来自内置目录）。
 * @param url 页面 URL（或 host 形式字符串）
 * @returns 命中目录时返回站点信息，否则 null
 */
export function getSiteInfo(url?: string): SiteInfo | null {
  if (!url) return null;
  const entry = findSiteEntryByHost(url);
  if (!entry) return null;
  return { id: entry.id, name: entry.name, category: entry.category, desc: entry.desc };
}
