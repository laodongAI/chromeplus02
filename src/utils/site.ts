/**
 * 站点识别与支持性判断工具。
 * 职责：判断 URL 是否属于支持站点、根据 URL 返回站点信息。
 */

import type { RootConfig } from './config';

export interface SiteInfo { id: string; name?: string }

/**
 * 检查URL是否匹配支持的网站。
 */
export function isSupportedSite(url?: string, config?: RootConfig): boolean {
  if (!url) return false;
  const u = url.toLowerCase();
  const quick = ['bilibili.com', 'b23.tv', 'douyin.com', 'zhihu.com', 'youtube.com', 'youtu.be', 'weibo.com', 'xiaohongshu.com'];
  if (quick.some((d) => u.includes(d))) return true;
  if (!config?.supportedSites) return false;
  return config.supportedSites.some((site) => {
    if (!site.enabled) return false;
    if (!Array.isArray(site.domains)) return false;
    return site.domains.some((d) => u.includes((d || '').toLowerCase()));
  });
}

/**
 * 根据URL获取网站基础信息（id/name）。
 */
export function getSiteInfo(url?: string, config?: RootConfig): SiteInfo | null {
  if (!url) return null;
  const u = url.toLowerCase();
  const quick: Record<string, SiteInfo> = {
    'bilibili.com': { id: 'bilibili', name: '哔哩哔哩' },
    'b23.tv': { id: 'bilibili', name: '哔哩哔哩' },
    'douyin.com': { id: 'douyin', name: '抖音' },
    'zhihu.com': { id: 'zhihu', name: '知乎' },
    'youtube.com': { id: 'youtube', name: 'YouTube' },
    'youtu.be': { id: 'youtube', name: 'YouTube' },
    'weibo.com': { id: 'weibo', name: '微博' },
    'xiaohongshu.com': { id: 'xiaohongshu', name: '小红书' }
  };
  for (const [domain, info] of Object.entries(quick)) {
    if (u.includes(domain)) return info;
  }
  if (!config?.supportedSites) return null;
  const site = config.supportedSites.find((s) => s.enabled && Array.isArray(s.domains) && s.domains.some((d) => u.includes((d || '').toLowerCase())));
  return site || null;
}
