/**
 * site 工具的基础单测。
 */
import { describe, it, expect } from 'vitest';
import { isSupportedSite, getSiteInfo } from '../../src/utils/site';

describe('site utils', () => {
  it('isSupportedSite 快速命中', () => {
    expect(isSupportedSite('https://www.bilibili.com/video/xxx')).toBe(true);
  });

  it('getSiteInfo 返回站点信息', () => {
    const info = getSiteInfo('https://www.youtube.com/watch?v=abc');
    expect(info?.id).toBe('youtube');
  });
});
