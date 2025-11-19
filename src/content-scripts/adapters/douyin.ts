import type { SiteAdapter } from '../types';

function getFirstVideo(): HTMLVideoElement | null {
  const vids = document.querySelectorAll<HTMLVideoElement>('video');
  if (!vids.length) return null;
  return vids[0];
}

export const douyinAdapter: SiteAdapter = {
  id: 'douyin',
  isMatch(loc: Location) {
    const href = loc.href.toLowerCase();
    return href.includes('douyin.com');
  },
  getPageInfo() {
    return { title: document.title, url: location.href };
  },
  play() {
    const v = getFirstVideo();
    v?.play?.();
  },
  pause() {
    const v = getFirstVideo();
    v?.pause?.();
  }
};
