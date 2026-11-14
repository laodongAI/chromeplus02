/**
 * 哔哩哔哩站点适配器（占位）。
 * 说明：play/pause 全项目无调用方（播放控制统一走 router.ts 的 CONTROL_VIDEO
 *       稳定索引链路），死代码清理时移除，仅保留实际被使用的匹配与信息提取。
 */
import type { SiteAdapter, PageInfo } from '../types';

export const bilibiliAdapter: SiteAdapter = {
  id: 'bilibili',
  /** 判断当前页面是否属于 B 站（含短链域名） */
  isMatch(loc: Location) {
    const u = loc.href.toLowerCase();
    return u.includes('bilibili.com') || u.includes('b23.tv');
  },
  /** 提取页面基础信息（标题/URL） */
  getPageInfo(): PageInfo {
    return { title: document.title, url: location.href };
  }
};
