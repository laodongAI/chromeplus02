/**
 * 网络捕获过滤共享工具（shared/netFilter）单元测试。
 * 覆盖用户反馈的真实场景：东方财富行情 JSONP 接口
 * （页面经 <script> 标签发起，CDP 资源类型为 Script，早期被当静态 JS 丢弃）
 * 必须判定为接口；普通静态 JS/CSS/图片必须维持丢弃，避免列表灌入噪声。
 */
import { describe, expect, it } from 'vitest';
import { STATIC_EXT_RE, isJsonpLikeUrl } from '../../src/shared/netFilter';

describe('isJsonpLikeUrl：JSONP / 接口型脚本判定', () => {
  it('用户反馈的东方财富行情 JSONP URL 判定为接口（带 cb= 回调参数 + /api/ 路径）', () => {
    const eastmoney =
      'https://pushlogin.eastmoney.com/api/qt/clist/get?np=1&fltt=1&invt=2' +
      '&cb=jQuery371034228103240558183_1793692051640&fs=m%3A1%2Bb%3AMK0351' +
      '&fields=f12%2Cf13%2Cf14&fid=f6&pn=1&pz=20&po=1&_=1793692051648';
    expect(isJsonpLikeUrl(eastmoney)).toBe(true);
  });

  it('查询串带常见回调参数名（callback/jsonp/jsoncallback/_callback/cbr）判定为接口', () => {
    expect(isJsonpLikeUrl('https://example.com/data?callback=fn&x=1')).toBe(true);
    expect(isJsonpLikeUrl('https://example.com/data?jsonp=cb')).toBe(true);
    expect(isJsonpLikeUrl('https://example.com/data?jsoncallback=1')).toBe(true);
    expect(isJsonpLikeUrl('https://example.com/data?_callback=x')).toBe(true);
    expect(isJsonpLikeUrl('https://example.com/data?cbr=x')).toBe(true);
  });

  it('接口风格路径（/api/ /rest/ /service/ /gateway/）判定为接口', () => {
    expect(isJsonpLikeUrl('https://example.com/api/v1/list?pn=1')).toBe(true);
    expect(isJsonpLikeUrl('https://example.com/rest/user/get')).toBe(true);
    expect(isJsonpLikeUrl('https://example.com/service/query')).toBe(true);
    expect(isJsonpLikeUrl('https://example.com/gateway/data')).toBe(true);
  });

  it('普通静态资源维持丢弃：.js/.css/图片后缀（即使带回调参数也按静态处理）', () => {
    expect(isJsonpLikeUrl('https://cdn.example.com/jquery.min.js')).toBe(false);
    expect(isJsonpLikeUrl('https://cdn.example.com/app.js?v=3&cb=x')).toBe(false);
    expect(isJsonpLikeUrl('https://cdn.example.com/style/main.css')).toBe(false);
    expect(isJsonpLikeUrl('https://cdn.example.com/img/logo.png')).toBe(false);
  });

  it('无回调参数且非接口路径的普通 GET 脚本/页面判定为非接口', () => {
    expect(isJsonpLikeUrl('https://example.com/inline/track?_=1793692051648')).toBe(false);
    expect(isJsonpLikeUrl('https://example.com/page/list')).toBe(false);
  });

  it('空串 / 非法输入返回 false', () => {
    expect(isJsonpLikeUrl('')).toBe(false);
  });
});

describe('STATIC_EXT_RE：静态后缀正则与既有后台口径一致', () => {
  it('命中常见静态后缀（含带查询串/锚点的形态）', () => {
    expect(STATIC_EXT_RE.test('https://a.com/x.js')).toBe(true);
    expect(STATIC_EXT_RE.test('https://a.com/x.js?v=1')).toBe(true);
    expect(STATIC_EXT_RE.test('https://a.com/x.png#z')).toBe(true);
    expect(STATIC_EXT_RE.test('https://a.com/x.woff2')).toBe(true);
  });

  it('接口 URL 不误判为静态', () => {
    expect(STATIC_EXT_RE.test('https://a.com/api/get?cb=x')).toBe(false);
    // 路径段含 "js" 但非后缀（如 /json）不应命中
    expect(STATIC_EXT_RE.test('https://a.com/json/list')).toBe(false);
  });
});
