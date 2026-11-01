/**
 * 内置支持网站目录（分类数据）。
 * 用途：① 设置面板「支持网站目录」展示（搜索/分类筛选/一键打开）
 *      ② utils/site.ts 的站点识别与中文名映射
 *      ③ 后续 extractor 站点适配架构的数据源
 * 说明：描述字段如实标注能力边界（DRM/登录/地区限制），
 *       DRM 内容无法直链下载，扩展会提示使用录制兜底。
 */

export type SiteCategory = '综合' | '娱乐' | '学习' | '英语' | '音乐' | '直播' | '新闻';

export interface SiteEntry {
  id: string;
  /** 显示名 */
  name: string;
  /** 主页地址（一键打开） */
  url: string;
  /** 识别用域名（含短链域，按 hostname 后缀匹配） */
  domains: string[];
  category: SiteCategory;
  /** 能力与边界描述 */
  desc: string;
}

export const SITE_CATEGORY_ORDER: SiteCategory[] = ['综合', '娱乐', '学习', '英语', '音乐', '直播', '新闻'];

export const SITE_CATALOG: SiteEntry[] = [
  // ── 综合 ──
  { id: 'youtube', name: 'YouTube', url: 'https://www.youtube.com', domains: ['youtube.com', 'youtu.be'], category: '综合', desc: '全球最大视频平台；短视频/长视频/直播普遍可嗅探，部分内容需登录' },
  { id: 'bilibili', name: '哔哩哔哩', url: 'https://www.bilibili.com', domains: ['bilibili.com', 'b23.tv'], category: '综合', desc: '国内综合视频社区；DASH 音视频分轨，直链无声时建议录制兜底' },
  { id: 'ixigua', name: '西瓜视频', url: 'https://www.ixigua.com', domains: ['ixigua.com'], category: '综合', desc: '字节系中长视频平台，直链嗅探友好' },
  { id: 'vimeo', name: 'Vimeo', url: 'https://vimeo.com', domains: ['vimeo.com'], category: '综合', desc: '创作者视频社区，画质普遍较高' },
  { id: 'dailymotion', name: 'Dailymotion', url: 'https://www.dailymotion.com', domains: ['dailymotion.com'], category: '综合', desc: '欧洲主流视频平台' },
  { id: 'youku', name: '优酷', url: 'https://www.youku.com', domains: ['youku.com'], category: '综合', desc: '部分 VIP 内容有 DRM，仅可录制兜底' },
  { id: 'qqvideo', name: '腾讯视频', url: 'https://v.qq.com', domains: ['v.qq.com'], category: '综合', desc: '大量 VIP/DRM 内容，建议录制兜底' },
  { id: 'iqiyi', name: '爱奇艺', url: 'https://www.iqiyi.com', domains: ['iqiyi.com'], category: '综合', desc: '正版剧集多为 DRM，仅可录制兜底' },
  { id: 'mgtv', name: '芒果TV', url: 'https://www.mgtv.com', domains: ['mgtv.com'], category: '综合', desc: '版权内容 DRM 较多' },
  { id: 'cctv', name: '央视网', url: 'https://www.cctv.com', domains: ['cctv.com', 'cctv.cn'], category: '综合', desc: '央视系节目点播与直播回看' },

  // ── 娱乐 / 短视频 ──
  { id: 'douyin', name: '抖音', url: 'https://www.douyin.com', domains: ['douyin.com', 'iesdouyin.com'], category: '娱乐', desc: '短视频无水印直链嗅探效果最好' },
  { id: 'tiktok', name: 'TikTok', url: 'https://www.tiktok.com', domains: ['tiktok.com'], category: '娱乐', desc: '国际版抖音' },
  { id: 'kuaishou', name: '快手', url: 'https://www.kuaishou.com', domains: ['kuaishou.com'], category: '娱乐', desc: '短视频与直播' },
  { id: 'xiaohongshu', name: '小红书', url: 'https://www.xiaohongshu.com', domains: ['xiaohongshu.com'], category: '娱乐', desc: '图文/视频笔记，图片批量下载友好' },
  { id: 'weibo', name: '微博', url: 'https://weibo.com', domains: ['weibo.com', 'weibo.cn'], category: '娱乐', desc: '视频与图集嗅探' },
  { id: 'instagram', name: 'Instagram', url: 'https://www.instagram.com', domains: ['instagram.com'], category: '娱乐', desc: '需登录；图片与短视频' },

  // ── 学习 ──
  { id: 'open163', name: '网易公开课', url: 'https://open.163.com', domains: ['open.163.com'], category: '学习', desc: '国内外名校公开课，直链友好' },
  { id: 'icourse163', name: '中国大学MOOC', url: 'https://www.icourse163.org', domains: ['icourse163.org'], category: '学习', desc: '国家精品课程；部分课件视频需登录' },
  { id: 'xuetangx', name: '学堂在线', url: 'https://www.xuetangx.com', domains: ['xuetangx.com'], category: '学习', desc: '清华系慕课平台' },
  { id: 'study163', name: '网易云课堂', url: 'https://study.163.com', domains: ['study.163.com'], category: '学习', desc: '职业技能课程' },
  { id: 'coursera', name: 'Coursera', url: 'https://www.coursera.org', domains: ['coursera.org'], category: '学习', desc: '需登录；部分课程视频加密，建议录制' },
  { id: 'edx', name: 'edX', url: 'https://www.edx.org', domains: ['edx.org'], category: '学习', desc: 'MIT/哈佛系慕课' },
  { id: 'khanacademy', name: '可汗学院', url: 'https://www.khanacademy.org', domains: ['khanacademy.org'], category: '学习', desc: '视频托管于 YouTube，嗅探通畅' },
  { id: 'udemy', name: 'Udemy', url: 'https://www.udemy.com', domains: ['udemy.com'], category: '学习', desc: '付费课程有 DRM，仅可录制兜底' },

  // ── 英语 ──
  { id: 'ted', name: 'TED', url: 'https://www.ted.com', domains: ['ted.com'], category: '英语', desc: '演讲视频 + 多语字幕，英语听力佳' },
  { id: 'npr', name: 'NPR', url: 'https://www.npr.org', domains: ['npr.org'], category: '英语', desc: '新闻音频 + 完整文稿（已专项适配），跟读素材' },
  { id: 'voa', name: 'VOA Learning English', url: 'https://learningenglish.voanews.com', domains: ['voanews.com'], category: '英语', desc: '慢速英语 + 文稿，入门听力' },
  { id: 'bbcle', name: 'BBC Learning English', url: 'https://www.bbc.co.uk/learningenglish', domains: ['bbc.co.uk'], category: '英语', desc: '系列英语课程视频与音频' },
  { id: 'bbc', name: 'BBC', url: 'https://www.bbc.com', domains: ['bbc.com'], category: '英语', desc: '新闻视频；部分内容地区限制' },
  { id: 'cnn', name: 'CNN', url: 'https://www.cnn.com', domains: ['cnn.com'], category: '英语', desc: '新闻视频（含 CNN 10 学生新闻）' },
  { id: 'elllo', name: 'elllo', url: 'https://elllo.org', domains: ['elllo.org'], category: '英语', desc: '多等级英语听力素材站，直链友好' },

  // ── 音乐 / 音频 ──
  { id: 'music163', name: '网易云音乐', url: 'https://music.163.com', domains: ['music.163.com'], category: '音乐', desc: 'MV 与外链音频；VIP 歌曲不可下载' },
  { id: 'qqmusic', name: 'QQ音乐', url: 'https://y.qq.com', domains: ['y.qq.com'], category: '音乐', desc: 'DRM 严格，建议录制兜底' },
  { id: 'ximalaya', name: '喜马拉雅', url: 'https://www.ximalaya.com', domains: ['ximalaya.com'], category: '音乐', desc: '有声书/播客音频嗅探' },
  { id: 'soundcloud', name: 'SoundCloud', url: 'https://soundcloud.com', domains: ['soundcloud.com'], category: '音乐', desc: '独立音乐流媒体' },
  { id: 'xiaoyuzhou', name: '小宇宙', url: 'https://www.xiaoyuzhoufm.com', domains: ['xiaoyuzhoufm.com'], category: '音乐', desc: '中文播客客户端网页版' },

  // ── 直播（嗅探当前流） ──
  { id: 'douyu', name: '斗鱼', url: 'https://www.douyu.com', domains: ['douyu.com'], category: '直播', desc: '直播流 m3u8 嗅探（仅当前流，不能录历史）' },
  { id: 'huya', name: '虎牙', url: 'https://www.huya.com', domains: ['huya.com'], category: '直播', desc: '直播流嗅探（仅当前流）' },
  { id: 'twitch', name: 'Twitch', url: 'https://www.twitch.tv', domains: ['twitch.tv'], category: '直播', desc: '直播/回放；广告分片较多需筛选' },

  // ── 新闻资讯 ──
  { id: '36kr', name: '36氪', url: 'https://36kr.com', domains: ['36kr.com'], category: '新闻', desc: '科技商业资讯（图文/视频）' },
  { id: 'huxiu', name: '虎嗅', url: 'https://www.huxiu.com', domains: ['huxiu.com'], category: '新闻', desc: '科技商业深度报道' },
  { id: 'sspai', name: '少数派', url: 'https://sspai.com', domains: ['sspai.com'], category: '新闻', desc: '数字生活指南（图文/视频）' },
  { id: 'theverge', name: 'The Verge', url: 'https://www.theverge.com', domains: ['theverge.com'], category: '新闻', desc: '科技媒体，英语新闻视频' }
];

/** 按 hostname（后缀）匹配站点目录；比旧实现的关键词 includes 更准确 */
export function findSiteEntryByHost(urlOrHost: string): SiteEntry | null {
  try {
    let host = (urlOrHost || '').trim().toLowerCase();
    if (!host) return null;
    if (host.includes('://')) {
      host = new URL(host).hostname;
    } else if (host.includes('/')) {
      host = host.slice(0, host.indexOf('/')); // 纯 host+路径 形式，剥掉路径
    }
    if (!host) return null;
    for (const site of SITE_CATALOG) {
      for (const d of site.domains) {
        if (host === d || host.endsWith('.' + d)) return site;
      }
    }
    return null;
  } catch {
    return null;
  }
}
