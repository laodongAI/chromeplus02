/**
 * 哔哩哔哩站点适配器（占位）。
 * 提供页面信息获取与基本播放控制能力。
 */
import type { SiteAdapter, PageInfo } from '../types';

function findVideo(): HTMLVideoElement | null {
  return document.querySelector('video');
}

export const bilibiliAdapter: SiteAdapter = {
  id: 'bilibili',
  isMatch(loc: Location) {
    const u = loc.href.toLowerCase();
    return u.includes('bilibili.com') || u.includes('b23.tv');
  },
  getPageInfo(): PageInfo {
    return { title: document.title, url: location.href };
  },
  play() {
    const v = findVideo();
    if (v) v.play();
  },
  pause() {
    const v = findVideo();
    if (v) v.pause();
  }
};
