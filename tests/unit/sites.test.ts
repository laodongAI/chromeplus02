/**
 * 内置网站目录数据完整性单测。
 */
import { describe, it, expect } from 'vitest';
import { SITE_CATALOG, SITE_CATEGORY_ORDER, findSiteEntryByHost, type SiteCategory } from '@/data/sites';
import { isSupportedSite, getSiteInfo } from '@/utils/site';

describe('SITE_CATALOG 数据完整性', () => {
  it('条目数量充足且字段完整', () => {
    expect(SITE_CATALOG.length).toBeGreaterThanOrEqual(40);
    for (const s of SITE_CATALOG) {
      expect(s.id, s.id).toBeTruthy();
      expect(s.name).toBeTruthy();
      expect(s.url).toMatch(/^https:\/\//);
      expect(s.domains.length).toBeGreaterThan(0);
      expect(s.domains.every(d => d && !d.includes('/') && !d.includes(':'))).toBe(true);
      expect(s.desc.length).toBeGreaterThan(4);
      expect(SITE_CATEGORY_ORDER).toContain(s.category);
    }
  });

  it('id 与域名无重复', () => {
    const ids = SITE_CATALOG.map(s => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    const domains = SITE_CATALOG.flatMap(s => s.domains);
    expect(new Set(domains).size).toBe(domains.length);
  });

  it('七个分类每个都有站点', () => {
    for (const c of SITE_CATEGORY_ORDER as SiteCategory[]) {
      expect(SITE_CATALOG.filter(s => s.category === c).length, c).toBeGreaterThan(2);
    }
  });
});

describe('findSiteEntryByHost 后缀匹配', () => {
  it('完整 URL 与纯 hostname 均可命中', () => {
    expect(findSiteEntryByHost('https://www.bilibili.com/video/x')?.id).toBe('bilibili');
    expect(findSiteEntryByHost('www.youtube.com')?.id).toBe('youtube');
    expect(findSiteEntryByHost('https://b23.tv/abc')?.id).toBe('bilibili');
  });

  it('子域命中但冒牌域名不命中', () => {
    expect(findSiteEntryByHost('v.douyin.com/abc')?.id).toBe('douyin');
    expect(findSiteEntryByHost('notbilibili.com')).toBeNull();
    expect(findSiteEntryByHost('bilibili.com.evil.io')).toBeNull();
  });

  it('未知站点返回 null', () => {
    expect(findSiteEntryByHost('https://example.org')).toBeNull();
  });
});

describe('site utils（目录驱动）', () => {
  it('isSupportedSite 识别目录站点', () => {
    expect(isSupportedSite('https://www.ted.com/talks/x')).toBe(true);
    expect(isSupportedSite('https://www.ximalaya.com/some/album')).toBe(true);
    expect(isSupportedSite('https://example.org')).toBe(false);
  });

  it('getSiteInfo 返回中文名/分类/描述', () => {
    const info = getSiteInfo('https://www.youtube.com/watch?v=abc');
    expect(info?.id).toBe('youtube');
    expect(info?.name).toBe('YouTube');
    expect(info?.category).toBe('综合');
  });

  it('用户配置可补充目录之外的站点', () => {
    const cfg = { supportedSites: [{ id: 'mysite', name: '我的站', enabled: true, domains: ['mysite.dev'] }] } as any;
    expect(isSupportedSite('https://mysite.dev/v/1', cfg)).toBe(true);
    expect(getSiteInfo('https://mysite.dev/v/1', cfg)?.name).toBe('我的站');
  });
});
