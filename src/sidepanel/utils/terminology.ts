/**
 * UI 三批（组6）：集中术语常量。
 * 目的：消除同一概念在"导航分段 / 面板标题 / 正文文案"三处各写各的问题——
 *  - tab「图片」 vs 面板标题「图像抓取」 vs 文案「图片」 → 统一为「图片」；
 *  - 「Sources」一律改中文「资源包」（导航已用该名，面板内文案与之一致）；
 *  - 「下载 / 下载记录」「录制 / 桌面录制」按 概念名/完整名 成对维护。
 * 所有面板标题、分段文案、跨面板提示语都应引用本模块常量，保证三处同源；
 * tests/unit/designTokens.test.ts 会断言术语表自身不含英文残留（如 Sources）。
 */

/** 品牌与上架信息（manifest 为静态 JSON 无法 import 本模块，两处需保持字面一致，由单测校验） */
export const BRAND = {
  /** UI 内品牌短名（侧栏头部展示） */
  name: 'MediaPlus',
  /** 上架名（manifest.name 同源值：品牌 + 能力短语） */
  storeName: 'MediaPlus - 网页媒体抓取与下载',
  /** 能力清单式描述（manifest.description 同源值，商店审核要求与实际能力相符） */
  description: '扫描并下载网页中的图片、视频、音频、文本与资源包；支持屏幕/窗口/标签页录制与桌面标注、HLS 合并、批量下载与收集篮管理。',
} as const;

/** 抓取子模式术语：键与 navState 的 GrabSubKey 对齐 */
export const GRAB_TERMS = {
  /** 图片子模式（分段 tab 文案） */
  image: '图片',
  video: '视频',
  audio: '音频',
  text: '文本',
  /** 接口（AJAX / POST 请求捕获）子模式 */
  network: '接口',
  /** 原「Sources」，统一中文名 */
  sources: '资源包',
} as const;

/** 网站域术语：一级入口名（支持网站目录，与抓取/下载同级） */
export const SITES_TERMS = {
  /** 一级入口短名（导航栏展示） */
  entry: '网站',
} as const;

/** 面板标题术语（标题带动作后缀，正文一律用 GRAB_TERMS 的名词形式） */
export const PANEL_TITLES = {
  /** 原「图像抓取」→ 与 tab「图片」统一 */
  image: '图片抓取',
  video: '视频采集',
  audio: '音频抓取',
  text: '文本抽取',
  /** 接口抓取：仅 AJAX 与 POST 等接口请求 */
  network: '接口抓取',
  /** 原「Sources文件下载」→ 资源包 */
  sources: '资源包下载',
  sites: '支持网站',
} as const;

/** 下载域术语：入口名 / 历史记录完整名 */
export const DOWNLOAD_TERMS = {
  entry: '下载',
  history: '下载记录',
  queue: '下载队列',
  basket: '收集篮',
} as const;

/** 录制域术语：入口名 / 桌面场景完整名 */
export const RECORD_TERMS = {
  entry: '录制',
  desktop: '桌面录制',
} as const;

/**
 * 抓取子模式键 → 分段文案 的映射（GrabWorkspace 与任何需要展示子模式名的地方共用）。
 * 键顺序即导航展示顺序，与 navState.GRAB_SEGMENT_SUBS 一致。
 */
export const GRAB_SEGMENT_LABELS: Record<keyof typeof GRAB_TERMS, string> = {
  image: GRAB_TERMS.image,
  video: GRAB_TERMS.video,
  audio: GRAB_TERMS.audio,
  text: GRAB_TERMS.text,
  network: GRAB_TERMS.network,
  sources: GRAB_TERMS.sources,
};
