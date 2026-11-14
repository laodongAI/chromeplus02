/**
 * 抖音站点适配器（占位）。
 * 说明：play/pause 全项目无调用方（播放控制统一走 router.ts 的 CONTROL_VIDEO
 *       稳定索引链路），死代码清理时移除，仅保留实际被使用的匹配与信息提取。
 */
import type { SiteAdapter } from '../types';

export const douyinAdapter: SiteAdapter = {
  id: 'douyin',
  /** 判断当前页面是否属于抖音 */
  isMatch(loc: Location) {
    const href = loc.href.toLowerCase();
    return href.includes('douyin.com');
  },
  /** 提取页面基础信息（标题/URL） */
  getPageInfo() {
    return { title: document.title, url: location.href };
  }
};
