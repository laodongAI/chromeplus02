/**
 * 网络捕获过滤共享工具（后台 networkCapture.ts 与侧栏 NetworkPanel.vue 共用）。
 *
 * 背景：页面通过 <script> 标签发起的 JSONP 接口请求（如东方财富行情列表
 * `pushlogin.eastmoney.com/api/qt/clist/get?...&cb=jQuery...`），
 * 在 CDP 资源类型里是 `Script` 而非 `XHR/Fetch`，早期过滤规则把它们全部
 * 当静态 JS 丢弃，导致"AJAX 抓取抓不到 JSONP 接口"的用户反馈。
 * 本模块提供统一的"接口型脚本请求"判定，后台据此放行、侧栏据此归类展示，
 * 两处口径同源，避免重复实现漂移。
 */

/** 静态资源后缀（GET 请求命中即丢弃；写请求不受影响） */
export const STATIC_EXT_RE = /\.(png|jpg|jpeg|gif|webp|avif|svg|ico|bmp|css|js|mjs|map|woff2?|ttf|eot|otf|mp4|webm|m3u8|mp3|m4a|aac|ogg|wav|flac|flv|avi|mov|zip|rar|7z|gz|pdf)(\?|#|$)/i;

/**
 * JSONP 回调参数名检测：查询串携带 cb= / callback= / jsonp= 等回调参数
 * 即强烈暗示这是 JSONP 接口（典型如 jQuery 生成的 `cb=jQuery3710342_1793692`）。
 */
const JSONP_CB_RE = /[?&](cb|callback|jsonp|jsoncallback|_callback|cbr)=/i;

/** 接口风格路径特征：/api/ /rest/ /service/ /gateway/ 段（普通静态 JS 极少走这类路径） */
const API_PATH_RE = /\/(api|rest|service|gateway)\//i;

/**
 * 判断 URL 是否为"接口型脚本请求"（JSONP 或 API 风格路径）。
 * 命中条件：不是静态资源后缀，且查询串带回调参数或路径含接口段。
 * 供后台 shouldCapture 放行 Script 类型接口、侧栏 AJAX 过滤归类共用。
 * @param url 请求 URL
 * @returns true=按接口请求捕获/展示；false=按普通脚本丢弃
 */
export function isJsonpLikeUrl(url: string): boolean {
  if (!url) return false;
  // 明确带静态后缀（.js/.css 等）一律不算接口
  if (STATIC_EXT_RE.test(url)) return false;
  return JSONP_CB_RE.test(url) || API_PATH_RE.test(url);
}
