/**
 * 域名黑名单共享模块（唯一维护入口）。
 * 收敛原先 content-scripts/sources.ts 与 sourcesTree.ts 中两套内容不一致的黑名单，
 * 统一采用「后缀精确匹配」策略（host === 黑名单项 或 host 以 ".黑名单项" 结尾），
 * 避免旧版 host.includes(domain) 的误判（如 evil-google.com.hacker.net 场景）。
 */

/**
 * 第三方统计/广告/社交嵌入等无关域名黑名单。
 * 说明：取两份旧实现的并集；新增/调整域名只改这里。
 */
export const DOMAIN_BLOCKLIST: readonly string[] = [
  // —— Google 系（注意 googleapis.com 与 google.com 是不同后缀，需分别列出）——
  'google.com',
  'googleapis.com',
  'gstatic.com',
  'googletagmanager.com',
  'google-analytics.com',
  'doubleclick.net',
  'googlesyndication.com',
  'googleadservices.com',
  // —— Meta/Facebook 系 ——
  'facebook.com',
  'facebook.net',
  // —— 其它常见第三方 ——
  'clarity.ms',
  'bing.com',
  'twitter.com',
  't.co',
  'cloudflare.com',
  'stripe.com',
  'licdn.com',
  'redditstatic.com',
  'adswizz.com',
  'goentri.com'
];

/**
 * 判断主机名是否命中黑名单（大小写不敏感，后缀精确匹配）。
 * @param host 主机名（可含端口，端口部分会被忽略后再匹配）
 * @returns true 表示应被过滤
 */
export function isBlockedHost(host: string): boolean {
  const lower = (host || '').toLowerCase().replace(/:\d+$/, ''); // 去掉端口再匹配
  if (!lower) return false;
  return DOMAIN_BLOCKLIST.some((d) => lower === d || lower.endsWith('.' + d));
}

/**
 * 常见多级公共后缀（PSL 的实用子集，非完整公共后缀列表）。
 * 收录标准：中国站点与主流托管/云服务里高频出现的多级后缀。
 * 未收录的多级后缀会退化为「末段即 TLD」的假设——与完整 PSL 相比仍可能偏宽，
 * 但绝不会像旧版 slice(-2) 那样把 co.uk 整段当成主域，从而放行任意 *.co.uk 第三方。
 */
export const MULTI_LEVEL_PUBLIC_SUFFIXES: readonly string[] = [
  // 英国 / 日本 / 澳新 / 巴西 / 韩国 / 印度 / 南非等 ccTLD 二级类别
  'co.uk', 'org.uk', 'me.uk', 'net.uk', 'ac.uk', 'gov.uk',
  'co.jp', 'ne.jp', 'or.jp', 'ac.jp', 'go.jp',
  'com.au', 'net.au', 'org.au', 'edu.au', 'gov.au',
  'com.br', 'net.br', 'org.br',
  'co.nz', 'net.nz', 'org.nz',
  'co.kr', 'or.kr', 'ne.kr',
  'co.in', 'net.in', 'org.in',
  'co.za', 'org.za', 'co.id', 'com.mx', 'com.ar', 'com.tr', 'com.sg', 'com.hk', 'com.tw',
  // 中国
  'com.cn', 'net.cn', 'org.cn', 'gov.cn', 'edu.cn', 'ac.cn',
  // 托管 / 云服务商（每个子域属于不同租户，绝不能当成同一主域）
  'github.io', 'gitlab.io', 'pages.dev', 'workers.dev', 'vercel.app', 'netlify.app',
  'herokuapp.com', 'appspot.com', 'cloudfront.net', 'azurewebsites.net',
  'web.app', 'firebaseapp.com', 'blogspot.com',
];

/** 归一化为裸主机名：转小写、去端口、去 IPv6 方括号、去尾点 */
function normalizeHost(host: string): string {
  return (host || '')
    .trim()
    .toLowerCase()
    .replace(/:\d*$/, '')   // 只剥数字端口：'[::1]:3000' → '[::1]'，而 '::1' 无端口不误伤
    .replace(/^\[|\]$/g, '')
    .replace(/\.+$/, '');   // 尾点在去端口之后剥离：'example.com.:443' → 'example.com'
}

/** IPv4 字面量（含非法段由调用方按主机名处理，此处只做形态判定） */
function isIpv4(host: string): boolean {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(host);
}

/**
 * 取可注册主域（近似 eTLD+1）。
 * - 端口、大小写、尾点不影响结果；
 * - IPv4 / IPv6 字面量与单段主机名（localhost 等）返回自身，绝不切出「末两段」；
 * - 命中多级公共后缀时多留一段（www.example.co.uk → example.co.uk）；
 * - host 本身就是公共后缀（co.uk / github.io）时返回 null——
 *   它不属于任何单一注册者，拿来做同主域比较会放行无关站点。
 * @returns 主域；无从判定时返回 null
 */
export function getRegistrableDomain(host: string): string | null {
  const lower = normalizeHost(host);
  if (!lower) return null;
  if (lower.includes(':') || isIpv4(lower)) return lower; // IP 字面量：整体即主机
  const labels = lower.split('.');
  if (labels.length < 2) return lower; // localhost / intranet 等单段主机名

  let suffixLabels = 1; // 默认假设末段是 TLD
  for (const suffix of MULTI_LEVEL_PUBLIC_SUFFIXES) {
    const n = suffix.split('.').length;
    if (n <= suffixLabels) continue;
    if (labels.slice(-n).join('.') === suffix) suffixLabels = n;
  }
  if (labels.length <= suffixLabels) return null;
  return labels.slice(-(suffixLabels + 1)).join('.');
}
