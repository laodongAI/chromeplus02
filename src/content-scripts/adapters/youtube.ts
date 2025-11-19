/**
 * YouTube 站点适配器（占位）。
 */
import type { SiteAdapter, PageInfo } from '../types';

function findVideo(): HTMLVideoElement | null {
  return document.querySelector('video');
}

export const youtubeAdapter: SiteAdapter = {
  id: 'youtube',
  isMatch(loc: Location) {
    const u = loc.href.toLowerCase();
    return u.includes('youtube.com') || u.includes('youtu.be');
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
