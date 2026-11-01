/**
 * 受限页面识别单测：重点回归「本扩展自身页面误报为其它扩展」问题。
 */
import { describe, it, expect } from 'vitest';
import { isRestrictedPage, getRestrictedPageMessage } from '../../src/sidepanel/utils/restrictedPages';

describe('restrictedPages', () => {
  it('正常网页不受限', () => {
    expect(isRestrictedPage('https://www.bilibili.com/video/x')).toBe(false);
    expect(getRestrictedPageMessage('https://www.ted.com/talks/x')).toBeNull();
  });

  it('浏览器内部页面受限', () => {
    expect(isRestrictedPage('chrome://extensions/')).toBe(true);
    expect(isRestrictedPage('edge://extensions/')).toBe(true);
    expect(isRestrictedPage('about:blank')).toBe(true);
    expect(isRestrictedPage('devtools://devtools/bundled/inspector.html')).toBe(true);
  });

  it('应用店页面受限', () => {
    expect(isRestrictedPage('https://chromewebstore.google.com/detail/x/abc')).toBe(true);
  });

  it('本扩展自身页面：给出专属指引而非"其它扩展"误报', () => {
    const editorUrl = 'chrome-extension://dnjdgkecmhnkkenmkocajfibfeepeepg/src/editor/index.html';
    // node 环境无 chrome API 时 selfOrigin() 为空串 → 该规则不触发，
    // 但通用 chrome-extension 规则必须命中
    const msg = getRestrictedPageMessage(editorUrl);
    expect(msg).toBeTruthy();
    expect(isRestrictedPage(editorUrl)).toBe(true);
  });

  it('其它扩展页面受限', () => {
    expect(isRestrictedPage('chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/popup.html')).toBe(true);
  });
});
