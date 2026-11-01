/**
 * 站点识别与支持性判断工具。
 * 数据源：src/data/sites.ts（内置分类目录）+ 用户配置（RootConfig.supportedSites）。
 * 匹配规则：hostname 后缀精确匹配（替代旧的关键词 includes，避免 notbilibili.com 误判）。
 */

import type { RootConfig } from './config';
import { SITE_CATALOG, findSiteEntryByHost } from '@/data/sites';

export interface SiteInfo { id: string; name?: string; category?: string; desc?: string }

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return '';
  }
}

function matchInConfig(url: string, config?: RootConfig): SiteInfo | null {
  if (!config?.supportedSites) return null;
  const host = hostOf(url);
  if (!host) return null;
  for (const site of config.supportedSites) {
    if (!site.enabled || !Array.isArray(site.domains)) continue;
    for (const d of site.domains) {
      const dd = (d || '').toLowerCase();
      if (dd && (host === dd || host.endsWith('.' + dd))) {
        return { id: site.id || dd, name: site.name };
      }
    }
  }
  return null;
}

/**
 * 检查 URL 是否属于支持的网站（内置目录优先，其次用户配置）。
 */
export function isSupportedSite(url?: string, config?: RootConfig): boolean {
  if (!url) return false;
  if (findSiteEntryByHost(url)) return true;
  return !!matchInConfig(url, config);
}

/**
 * 根据 URL 获取网站信息（含中文名/分类/描述，来自内置目录）。
 */
export function getSiteInfo(url?: string, config?: RootConfig): SiteInfo | null {
  if (!url) return null;
  const entry = findSiteEntryByHost(url);
  if (entry) return { id: entry.id, name: entry.name, category: entry.category, desc: entry.desc };
  return matchInConfig(url, config);
}
