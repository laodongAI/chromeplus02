/**
 * 消息协议定义（Content/Background/Sidepanel/Popup 通用）。
 * 注意：避免魔法字符串，统一从此处导入常量。
 *
 * ===== 响应形态契约（P1-1 收敛说明，改动前先核对本节）=====
 * 项目内消息的响应形态分三族，各族内部保持一致，跨族不强行统一
 * （强行统一会破坏侧栏/旧版本的既有解析，正确性优先）：
 *  1. 后台请求-应答族（经 background/bus.ts 分发）：
 *     统一 `{ success: boolean; ...业务字段 }`，失败为 `{ success: false, error: string }`。
 *     覆盖：SOURCES_* 族、DOWNLOAD_QUEUE_*、START_HLS_DOWNLOAD、DIRECT_*_DOWNLOAD、
 *     GET_CAPTURED_VIDEO_SOURCES、COMPANION_*、WHO_AM_I、SETTINGS_UPDATE。
 *     特例：DOWNLOAD_QUEUE_SNAPSHOT 既是应答（带 success）也是广播（不带 success，
 *     仅 type/tasks/paused），侧栏对两种形态均可解析，维持现状。
 *  2. 内容脚本请求-应答族（chrome.tabs.sendMessage）：
 *     同样 `{ success: boolean; ... }`，无例外。GET_TEXT_CONTENT 与 GET_TEXT_SELECTION
 *     都是 `{ success: true, content }`（content 分别为 TextContentDTO / TextSelectionDTO），
 *     失败为 `{ success: false, error }`；侧栏按 res.success + res.content 解析。
 *  3. 广播族（fire-and-forget，无应答）：
 *     DOWNLOAD_PROGRESS_EVENT / DOWNLOAD_QUEUE_SNAPSHOT / RESOURCE_UPDATE /
 *     VIDEO_RECORDING_STATUS / VIDEO_PLAYBACK_STATUS / HLS_BLOB_READY /
 *     SOURCES_DOWNLOAD_PROGRESS / CAPTURE_RECORDING_READY /
 *     NET_CAPTURE_UPDATE / NET_CAPTURE_STATE / RECORDING_COMMAND。发送方不等待响应，接收方按 type 判别。
 *     RECORDING_COMMAND 由全局快捷键触发，侧栏未开时无接收端属正常，发送方必须带 callback
 *     读 lastError，否则产生未处理拒绝（见 background/commands.ts）。
 */

import type { RtcDownCommand, RtcStreamInfo, RtcUpEvent } from '@/core/webrtcCapture';
import type { ArticleBlock } from '@/core/articleBlocks';
import type { HighlightAnchor } from '@/core/textHighlight';
import type { DownloadKind } from '@/core/downloadTaxonomy';

export enum MessageType {
  // 握手
  PING = 'PING',
  PONG = 'PONG',
  // 内容脚本自识别（后台回传 sender.frameId/tabId）
  WHO_AM_I = 'WHO_AM_I',
  // 功能开关
  ENABLE_FEATURES = 'ENABLE_FEATURES',
  // 设置更新
  SETTINGS_UPDATE = 'SETTINGS_UPDATE',
  // 音频
  REQUEST_AUDIO_LIST = 'REQUEST_AUDIO_LIST',
  // 图片
  REQUEST_IMAGE_LIST = 'REQUEST_IMAGE_LIST',
  START_DOWNLOAD = 'START_DOWNLOAD',
  // 视频基础
  GET_VIDEO_LIST = 'GET_VIDEO_LIST',
  CONTROL_VIDEO = 'CONTROL_VIDEO',
  START_RECORD_VIDEO = 'START_RECORD_VIDEO',
  STOP_RECORD_VIDEO = 'STOP_RECORD_VIDEO',
  VIDEO_RECORDING_STATUS = 'VIDEO_RECORDING_STATUS',
  VIDEO_PLAYBACK_STATUS = 'VIDEO_PLAYBACK_STATUS',
  REQUEST_VIDEO_SOURCES = 'REQUEST_VIDEO_SOURCES',
  DIRECT_VIDEO_DOWNLOAD = 'DIRECT_VIDEO_DOWNLOAD',
  // 下载队列扩展
  DOWNLOAD_QUEUE_ACTION = 'DOWNLOAD_QUEUE_ACTION',
  DOWNLOAD_QUEUE_SNAPSHOT = 'DOWNLOAD_QUEUE_SNAPSHOT',
  DOWNLOAD_PROGRESS_EVENT = 'DOWNLOAD_PROGRESS_EVENT'
  , RESOURCE_UPDATE = 'RESOURCE_UPDATE'
  // HLS(m3u8) 分片下载
  , START_HLS_DOWNLOAD = 'START_HLS_DOWNLOAD'
  , HLS_BLOB_READY = 'HLS_BLOB_READY'
  // 录屏页面画笔
  , ANNOTATE_TOGGLE = 'ANNOTATE_TOGGLE'
  // 录屏点击/光标高亮（Round 5 #32）
  , CURSOR_HIGHLIGHT_TOGGLE = 'CURSOR_HIGHLIGHT_TOGGLE'
  // 画笔工具栏显隐：由扩展级全局快捷键驱动，与覆盖层开关分开——快捷键不该凭空造出一个画笔层
  , ANNOTATE_TOOLBAR_TOGGLE = 'ANNOTATE_TOOLBAR_TOGGLE'
  // 录制控制命令：全局快捷键 → 侧栏 recordingStore（侧栏未开时录制本就不存在）
  , RECORDING_COMMAND = 'RECORDING_COMMAND'
  // ===== 网络请求捕获（抓 XHR/Fetch、JSONP 接口型脚本与 POST 等写请求；图片/CSS/普通 JS 等静态资源直接丢弃） =====
  // 依赖 chrome.debugger 的 Network 域，可读取请求头/请求体/响应头/响应体
  , NET_CAPTURE_START = 'NET_CAPTURE_START'
  , NET_CAPTURE_STOP = 'NET_CAPTURE_STOP'
  , NET_CAPTURE_STATUS = 'NET_CAPTURE_STATUS'
  , NET_CAPTURE_QUERY = 'NET_CAPTURE_QUERY'
  , NET_CAPTURE_DETAIL = 'NET_CAPTURE_DETAIL'
  , NET_CAPTURE_EXPORT = 'NET_CAPTURE_EXPORT'
  , NET_CAPTURE_CLEAR = 'NET_CAPTURE_CLEAR'
  // 广播：新捕获/更新一条请求（背景 → 侧栏，无应答）
  , NET_CAPTURE_UPDATE = 'NET_CAPTURE_UPDATE'
  // 广播：捕获开关状态变更（被动 detach 时面板必须落到「已停止」，否则用户以为还在录）
  , NET_CAPTURE_STATE = 'NET_CAPTURE_STATE'
  // 文本
  , GET_TEXT_CONTENT = 'GET_TEXT_CONTENT'
  // 划词高亮：侧栏把页面上的选区取回来做锚点
  , GET_TEXT_SELECTION = 'GET_TEXT_SELECTION'

  // ===== P1-1 收敛：以下类型此前以裸字符串收发，现统一入枚举 =====
  // 字面量值与旧实现逐字相同：已安装旧版本扩展与伴生程序仍按原字符串通信，禁止改动值。
  // Sources 资源目录树（侧栏 ↔ 后台）
  , SOURCES_TREE_SCAN = 'SOURCES_TREE_SCAN'
  , SOURCES_TREE_DOWNLOAD = 'SOURCES_TREE_DOWNLOAD'
  , SOURCES_DOWNLOAD_STATUS = 'SOURCES_DOWNLOAD_STATUS'
  , SOURCES_DOWNLOAD_PROGRESS = 'SOURCES_DOWNLOAD_PROGRESS'
  // 通用直链下载（图片等；与 START_DOWNLOAD/DIRECT_VIDEO_DOWNLOAD 同族，仅 kind 不同）
  , DIRECT_DOWNLOAD_GENERIC = 'DIRECT_DOWNLOAD_GENERIC'
  // 网络嗅探媒体查询（侧栏 → 后台 capture 模块）
  , GET_CAPTURED_VIDEO_SOURCES = 'GET_CAPTURED_VIDEO_SOURCES'
  // 媒体候选回收（侧栏 → 后台 mediaSweep 模块）：
  //  CACHE=读页面资源账本（performance + Cache Storage），DEEP=抓已加载脚本正文扫懒加载地址
  , MEDIA_LEDGER_SCAN = 'MEDIA_LEDGER_SCAN'
  , MEDIA_DEEP_SCAN = 'MEDIA_DEEP_SCAN'
  // 伴生程序状态查询 / 强制重检（侧栏设置页 → 后台 companion 模块）
  , COMPANION_STATUS = 'COMPANION_STATUS'
  , COMPANION_RECHECK = 'COMPANION_RECHECK'
  // 外挂下载器（Round 5 #30）：STATUS=探测 aria2/本机工具可用性，DOWNLOAD=直接把地址交给外挂工具
  , EXTERNAL_TOOLS_STATUS = 'EXTERNAL_TOOLS_STATUS'
  , EXTERNAL_TOOLS_DOWNLOAD = 'EXTERNAL_TOOLS_DOWNLOAD'
  // 桌面标注层：经伴生程序启动/停止覆盖整个桌面的透明画布（可在任意应用窗口上绘制）
  , DESKTOP_OVERLAY_START = 'DESKTOP_OVERLAY_START'
  , DESKTOP_OVERLAY_STOP = 'DESKTOP_OVERLAY_STOP'
  , DESKTOP_OVERLAY_STATUS = 'DESKTOP_OVERLAY_STATUS',

  // ===== 页面录制产物交接（内容脚本 → 后台 → 侧栏）=====
  // 背景：内容脚本里 MediaRecorder 产出的 Blob 无法经 Chrome 消息通道直接传递
  // （runtime.sendMessage 为 JSON 通道，不支持 Blob/ArrayBuffer 跨上下文序列化），
  // 且 webm(VP9/Opus) 在 Windows 默认播放器普遍无法播放。
  // 链路：内容脚本把产物切 base64 分块上送 → 后台拼装并持久化到 IndexedDB
  // （SW 与侧栏同源共享同一 IDB，见 shared/blobStore.ts）→ 侧栏按键取回，
  // 在面板内展示"录制成果"列表：可点击查看（编辑器）/ 转 MP4、M4A 下载（全播放器兼容）。
  /** 单个分块数据（内容脚本 → 后台，请求-应答族 { success }） */
  CAPTURE_RECORDING_CHUNK = 'CAPTURE_RECORDING_CHUNK',
  /** 分块传输结束（内容脚本 → 后台）：触发拼装、IDB 落库与 READY 广播 */
  CAPTURE_RECORDING_DONE = 'CAPTURE_RECORDING_DONE',
  /** 录制产物就绪（后台 → 侧栏广播，无应答；侧栏刷新成果列表） */
  CAPTURE_RECORDING_READY = 'CAPTURE_RECORDING_READY',
  /** 删除一条录制产物（侧栏 → 后台：删元数据 + IDB Blob） */
  CAPTURE_RECORDING_DELETE = 'CAPTURE_RECORDING_DELETE',

  // ===== WebRTC 录流（Round 5 #30）=====
  // MAIN 世界钩子拿到 RTCPeerConnection 的远端 MediaStream，MediaRecorder 就地录制，
  // 产物经 ISOLATED 桥接脚本转 base64 分块，复用上面的 CAPTURE_RECORDING_* 链路落库。
  /** 桥接脚本 → 后台：转发 MAIN 世界的上行事件（流清单/分块/完成/状态） */
  WEBRTC_BRIDGE_EVENT = 'WEBRTC_BRIDGE_EVENT',
  /** 后台 → 桥接脚本：下发 MAIN 世界命令（list/start/stop） */
  WEBRTC_COMMAND = 'WEBRTC_COMMAND',
  /** 侧栏 → 后台：查询开关状态与某 tab 的流清单 */
  WEBRTC_CAPTURE_STATUS = 'WEBRTC_CAPTURE_STATUS',
  /** 侧栏 → 后台：开/关 WebRTC 捕获（动态注册/注销 MAIN + ISOLATED 脚本） */
  WEBRTC_CAPTURE_TOGGLE = 'WEBRTC_CAPTURE_TOGGLE',
  /** 侧栏 → 后台：开始录制某一路流 */
  WEBRTC_CAPTURE_START = 'WEBRTC_CAPTURE_START',
  /** 侧栏 → 后台：停止一路录制 */
  WEBRTC_CAPTURE_STOP = 'WEBRTC_CAPTURE_STOP',
  /** 后台 → 侧栏广播：流清单或录制状态变化 */
  WEBRTC_CAPTURE_UPDATE = 'WEBRTC_CAPTURE_UPDATE',

  // ===== 兼容旧消息（仅保留接收，当前代码库无发送方；勿改字符串值）=====
  /** @deprecated 旧版便捷播放消息；现由 CONTROL_VIDEO(action=play) 取代，内容脚本保留接收以兼容旧侧栏 */
  PLAY_VIDEO = 'PLAY_VIDEO',
  /** @deprecated 旧版便捷暂停消息；现由 CONTROL_VIDEO(action=pause) 取代，内容脚本保留接收以兼容旧侧栏 */
  PAUSE_VIDEO = 'PAUSE_VIDEO',
  /** @deprecated 旧版整页资源扫描消息；当前代码库已无发送方（扫描改走 SOURCES_TREE_*），内容脚本保留接收以兼容外部旧调用 */
  SCAN_PAGE_SOURCES = 'SCAN_PAGE_SOURCES'
}

export interface PongMessage {
  type: MessageType.PONG;
  ok: true;
  version: string;
  capabilities: string[];
  adapterId?: string | null;
  frameId?: number;
}

export interface PingMessage {
  type: MessageType.PING;
}

export interface EnableFeaturesMessage {
  type: MessageType.ENABLE_FEATURES;
  payload: {
    video?: boolean;
    image?: boolean;
    audio?: boolean;
    playbackEvents?: boolean;
    spaWatchers?: boolean;
  };
}

export interface StartDownloadPayload {
  url: string;
  filename?: string;
  /**
   * 来源页地址（Round 5 #30）。
   * 内置 chrome.downloads 链路带不上自定义请求头，所以此前从不传 Referer；
   * 外挂下载器（aria2 / m3u8DL-RE / ffmpeg）可以，缺了它很多站点直接 403。
   */
  referer?: string;
  /** 媒体类型；缺省时由后台按文件名/URL 扩展名推断 */
  kind?: DownloadKind;
  /**
   * 发起下载的页面地址（下载台账 · 需求4）。
   * 与 referer 分工不同：referer 是给下载器用的请求头，sourceUrl 是给界面做
   * 「本页在下的任务」关联用的，因此后台不会拿它去做任何网络动作。
   */
  sourceUrl?: string;
  /** 来源页标题，列表里直接展示「来自：xxx」而不必再查 tab */
  sourceTitle?: string;
  /** 来源页 tab id；页面已关闭时为 undefined，仅用于关联不作操作凭据 */
  sourceTabId?: number;
  /**
   * 本地产物在 IndexedDB blobStore 中的键（登记类任务专用）。
   * 文本导出、资源包 zip、录制产物没有远程 URL，下载动作已经由侧栏完成，
   * 这里只需登记一条已完成记录，故用 idbKey 指向可重新保存的 blob。
   */
  idbKey?: string;
  /** 产物体积（字节）：登记类任务没有下载器回填 totalBytes，由登记方直接给出 */
  totalBytes?: number;
}

/**
 * 队列动作消息（下载台账扩展）。
 *  - add / cancel / retry / pause_all / resume_all / retry_failed_all：既有语义不变；
 *  - register：把「已经产出的本地产物」登记为一条已完成任务（文本导出、zip、录制），
 *    不走下载器、不占并发；
 *  - remove：从台账中删除任务（用户在下载界面点删除），同时清理其 IDB 产物。
 */
export interface DownloadQueueActionMessage {
  type: MessageType.DOWNLOAD_QUEUE_ACTION;
  action: 'add' | 'cancel' | 'retry' | 'pause_all' | 'resume_all' | 'retry_failed_all'
        | 'register' | 'remove';
  task?: StartDownloadPayload;
  id?: string;
}

export interface DownloadProgressEventMessage {
  type: MessageType.DOWNLOAD_PROGRESS_EVENT;
  id: string;
  downloadId?: number;
  bytesReceived?: number;
  totalBytes?: number;
  state?: string;
  speedBps?: number;
  etaSeconds?: number;
  progress?: number;
  finished?: boolean;
  error?: string;
  errorCode?: string; // 统一错误枚举：DRM | CORS | PERMISSION | NO_RESOURCE | NETWORK | INTERRUPTED | UNKNOWN
}

export interface DownloadQueueSnapshotMessage {
  type: MessageType.DOWNLOAD_QUEUE_SNAPSHOT;
  tasks: DownloadQueueSnapshotTask[];
  paused?: boolean; // 队列是否被全局暂停
}

/**
 * 后台队列快照里的单个任务形态（下载台账扩展）。
 * 侧栏 downloadQueue 服务与后台 serializeQueue 共用这一份形状定义，
 * 避免「后台加了字段、侧栏类型没跟上」的静默丢字段。
 */
export interface DownloadQueueSnapshotTask {
  id: string;
  url: string;
  fileName?: string;
  kind?: DownloadKind;
  /** direct=直链、hls=分片合并、local=侧栏已产出的本地产物（登记进台账，不经下载器） */
  engine?: 'direct' | 'hls' | 'local';
  status: string;
  progress?: number;
  error?: string;
  downloadId?: number;
  bytesReceived?: number;
  totalBytes?: number;
  speedBps?: number;
  etaSeconds?: number;
  errorCode?: string;
  retries?: number;
  /** 来源页三件套 + 本地产物键，见 StartDownloadPayload 同名字段 */
  sourceUrl?: string;
  sourceTitle?: string;
  sourceTabId?: number;
  idbKey?: string;
}

export interface AudioItemDTO {
  url: string;
  title?: string;
  /**
   * 以下四项只由网络嗅探通道填充（DOM 扫描项没有响应头可看）。
   * 面板据此在不发 HEAD 请求的前提下先显示格式/体积，元数据探测回来再覆盖。
   */
  mimeType?: string;
  extension?: string;
  size?: number;
  kind?: 'video' | 'audio' | 'hls' | 'dash';
}

export interface ImageItemDTO {
  url: string;
  width?: number;
  height?: number;
  kind?: string; // img|source|background
}

export type VideoControlAction = 'play' | 'pause';

export interface VideoSourceCandidate {
  url: string;
  label?: string;
  mimeType?: string;
  extension?: string;
}

export interface VideoItemDTO {
  index: number;
  src?: string;
  width?: number;
  height?: number;
  duration?: number;
  muted?: boolean;
  visible?: boolean;
  directSources?: VideoSourceCandidate[];
  directSourceCount?: number;
  paused?: boolean;
}

export interface VideoListResponse {
  success: boolean;
  error?: string;
  videos?: VideoItemDTO[];
  frameId?: number;
}

export interface VideoRecordingStatusMessage {
  type: MessageType.VIDEO_RECORDING_STATUS;
  status: 'started' | 'completed' | 'error';
  index?: number;
  startedAt?: number;
  duration?: number;
  fileName?: string;
  error?: string;
  mode?: 'video' | 'audio';
}

export interface VideoPlaybackStatusMessage {
  type: MessageType.VIDEO_PLAYBACK_STATUS;
  index: number;
  playing: boolean;
}

export interface VideoSourcesResponse {
  sources: { url: string; mimeType?: string; extension?: string; size?: number; via?: string; kind?: 'video' | 'audio' | 'hls' | 'dash'; streamOnly?: boolean }[];
  meta?: Record<string, any>;
}

// ===== 设置更新 =====
export interface SettingsUpdateMessage {
  type: MessageType.SETTINGS_UPDATE;
  payload: {
    namingTemplate?: string;
    autoScan?: boolean;
    maxConcurrent?: number;
    showShortcutHints?: boolean;
  };
}

export interface ResourceUpdateMessage {
  type: MessageType.RESOURCE_UPDATE;
  payload: {
    /** 发送本条增量的内容脚本所在 frameId（0 = 顶层窗口） */
    frameId?: number;
    images?: { url: string; width?: number; height?: number; kind?: string }[];
    audio?: { url: string; title?: string }[];
    videos?: { index: number; src?: string; width?: number; height?: number; duration?: number; muted?: boolean; visible?: boolean }[];
    diff?: {
      images?: { added: { url: string; width?: number; height?: number; kind?: string }[]; removed: string[] };
      audio?: { added: { url: string; title?: string }[]; removed: string[] };
      videos?: { added: { index: number; src?: string; width?: number; height?: number; duration?: number; muted?: boolean; visible?: boolean }[]; removed: number[] };
    };
  };
}

export interface TextContentDTO {
  title: string;
  description?: string;
  keywords?: string[];
  author?: string;
  textContent: string;
  htmlContent?: string;
  /** 全文字符数（textContent 可能只是其前缀） */
  wordCount: number;
  /** textContent 是否因长度上限被截断；wordCount 仍为全文长度 */
  truncated?: boolean;
  meta?: Record<string, any>;
  /**
   * 结构化正文块（Round 6 #35）。textContent 与它同源：
   * textContent === blocksToPlainText(blocks) 的前缀，所以旧调用方不受影响，
   * 新调用方（Markdown/归档出口、高亮定位）必须用 blocks，否则标题层级与表格全丢。
   */
  blocks?: ArticleBlock[];
  /** 抽取所在文档的 URL */
  url?: string;
  /** link rel=canonical（缺则等于 url）：同一篇文章的带参分享链接归成一个文件名 */
  canonicalUrl?: string;
  /** 站点名（og:site_name 等，缺则取 hostname） */
  siteName?: string;
  /** 原文发布时间（article:published_time / time[datetime]，站点没给就空着） */
  publishedAt?: string;
  /** 文档语言（html lang） */
  language?: string;
}

/**
 * 划词选区应答（Round 6 #35）。
 * 只回传锚点文本而不回传偏移：偏移属于"抽取正文"这一坐标系，选区属于 DOM，
 * 两者的换算放在侧栏（它同时握着正文与锚点定位函数），内容脚本不做重复实现。
 */
export interface TextSelectionDTO {
  /** 页面上无选区 / 选区为空时为 false */
  ok: boolean;
  anchor?: HighlightAnchor;
  /** 选区所在块的纯文本（用于侧栏提示用户选中了什么） */
  excerpt?: string;
  url?: string;
  /** 失败原因，展示给用户，避免"点了没反应" */
  reason?: string;
}

// ===== P1-1：各消息类型的载荷定义（判别联合成员） =====

/** 内容脚本自识别请求（无载荷；应答回传 tabId/frameId） */
export interface WhoAmIMessage { type: MessageType.WHO_AM_I }

/** Sources 目录树扫描请求（后台取当前活动标签页执行扫描） */
export interface SourcesTreeScanMessage { type: MessageType.SOURCES_TREE_SCAN }

/** Sources 下载清单中的单个文件条目（path 为 zip 内相对路径） */
export interface SourcesTreeFileItem { path?: string; url?: string; size?: number }

/** Sources 目录树下载请求：按勾选的文件清单打包 */
export interface SourcesTreeDownloadMessage { type: MessageType.SOURCES_TREE_DOWNLOAD; files: SourcesTreeFileItem[] }

/** Sources 下载任务状态查询（侧栏轮询用） */
export interface SourcesDownloadStatusMessage { type: MessageType.SOURCES_DOWNLOAD_STATUS; taskId?: string }

/** Sources 下载进度广播（后台 → 侧栏，无应答） */
export interface SourcesDownloadProgressMessage { type: MessageType.SOURCES_DOWNLOAD_PROGRESS; taskId: string; progress: number }

/**
 * 直链下载入队消息：三种类型共用同一载荷（payload.url/filename），
 * 仅后台侧 kind 归类不同（audio/video/image）。
 */
export interface DirectDownloadMessage {
  type: MessageType.START_DOWNLOAD | MessageType.DIRECT_VIDEO_DOWNLOAD | MessageType.DIRECT_DOWNLOAD_GENERIC;
  payload: StartDownloadPayload;
}

/** 网络嗅探媒体查询（按 tabId/frameId 过滤，缺省聚合全部） */
export interface GetCapturedVideoSourcesMessage { type: MessageType.GET_CAPTURED_VIDEO_SOURCES; tabId?: number; frameId?: number }

/**
 * 媒体候选回收消息（Round 5 #29）：
 *  - MEDIA_LEDGER_SCAN 读页面资源账本（缓存捕捉）；
 *  - MEDIA_DEEP_SCAN 抓已加载脚本正文扫懒加载地址（深度搜索）。
 */
export interface MediaSweepMessage {
  type: MessageType.MEDIA_LEDGER_SCAN | MessageType.MEDIA_DEEP_SCAN;
  tabId?: number;
  frameId?: number;
}

/** 回收结果统计；note 用于说明降级原因（站点没用 Cache Storage、脚本被跨源屏蔽、时间预算用尽） */
export interface MediaSweepResult {
  success: boolean;
  /** 新入库的候选条数 */
  added: number;
  /** 读取到的账本条目数 / 成功抓取并扫描的脚本数 */
  scanned?: number;
  /** 实测可取回的脚本候选数（仅深度搜索） */
  verified?: number;
  /** 时间预算用尽，本轮为部分结果 */
  partial?: boolean;
  error?: string;
  note?: string;
}

/**
 * 外挂下载器消息（Round 5 #30）。
 *  - STATUS：探测 aria2 RPC 与 Native Host 本机工具，可 force=false 只回读配置；
 *  - DOWNLOAD：把单个地址直接交给外挂工具（面板上的「用外挂工具下载」入口）。
 */
export interface ExternalToolsMessage {
  type: MessageType.EXTERNAL_TOOLS_STATUS | MessageType.EXTERNAL_TOOLS_DOWNLOAD;
  /** STATUS：false 时跳过探测仅返回已存配置（缺省探测） */
  force?: boolean;
  /** DOWNLOAD 负载；kind=stream 表示分段流，受 preferForStreams 开关约束 */
  payload?: {
    url?: string;
    fileName?: string;
    referer?: string;
    userAgent?: string;
    kind?: 'stream' | 'file';
  };
}

/**
 * 捕获到的单条网络请求（仅 XHR/Fetch 与写请求）。
 * 列表查询只回摘要（不含 responseBody），详情/导出接口才带 body，避免消息体积过大。
 */
export interface CapturedRequestDTO {
  /** 记录唯一 ID（tabId:requestId） */
  id: string;
  /** 所属标签页 */
  tabId: number;
  /** 请求 URL（已去掉 hash） */
  url: string;
  /** HTTP 方法（GET/POST/PUT/DELETE…） */
  method: string;
  /** CDP 资源类型（XHR / Fetch / Document / Other…） */
  resourceType?: string;
  /** HTTP 状态码（未收到响应时缺省） */
  status?: number;
  /** 响应 MIME 类型 */
  mimeType?: string;
  /** 请求头（仅保留字符串值，敏感头原样保留供用户自查） */
  requestHeaders?: Record<string, string>;
  /** 请求体（POST/PUT 等；超长会被截断） */
  postData?: string;
  /** 响应头 */
  responseHeaders?: Record<string, string>;
  /** 响应体文本（仅文本/JSON；二进制不保存） */
  responseBody?: string;
  /** 响应体是否被截断 */
  bodyTruncated?: boolean;
  /** 请求开始时间（毫秒时间戳） */
  startedAt: number;
  /** 请求耗时（毫秒，完成/失败后写入） */
  durationMs?: number;
  /** 失败原因（网络错误、被取消等） */
  error?: string;
  /** 是否已完成（响应体已取回或确认无 body） */
  finished?: boolean;
  /** 列表摘要用：是否存在可查看的响应体 */
  hasBody?: boolean;
  /** 响应体字节数（估算） */
  size?: number;
}

/** 启动/停止/状态/查询/清空 网络捕获（tabId 缺省取当前活动标签页） */
export interface NetCaptureControlMessage {
  type: MessageType.NET_CAPTURE_START | MessageType.NET_CAPTURE_STOP | MessageType.NET_CAPTURE_STATUS
    | MessageType.NET_CAPTURE_QUERY | MessageType.NET_CAPTURE_CLEAR | MessageType.NET_CAPTURE_EXPORT;
  tabId?: number;
}

/** 查询单条请求详情（含响应体） */
export interface NetCaptureDetailMessage { type: MessageType.NET_CAPTURE_DETAIL; id: string }

/** 捕获更新广播（背景 → 侧栏） */
export interface NetCaptureUpdateMessage { type: MessageType.NET_CAPTURE_UPDATE; tabId: number; request: CapturedRequestDTO }

/**
 * 捕获状态变更广播（背景 → 侧栏，无应答）。
 * 由被动 detach 触发：用户点掉 Chrome 调试提示条、DevTools 抢占、标签页关闭。
 * reason 为面向用户的原因文案，侧栏据此停止显示「捕获中」。
 */
export interface NetCaptureStateMessage {
  type: MessageType.NET_CAPTURE_STATE;
  tabId: number;
  active: boolean;
  reason?: string;
}

/** 伴生程序状态查询（应答 { success, online, enabled }） */
export interface CompanionStatusMessage { type: MessageType.COMPANION_STATUS }

/** 伴生程序强制重检（绕过缓存的在线探测） */
export interface CompanionRecheckMessage { type: MessageType.COMPANION_RECHECK }

/**
 * 桌面标注层控制消息（启动 / 停止 / 状态查询）。
 * 应答形态：{ success: boolean; running?: boolean; error?: string }。
 * 需要伴生程序在线；未安装时返回 success=false 并给出提示。
 */
export interface DesktopOverlayMessage {
  type: MessageType.DESKTOP_OVERLAY_START | MessageType.DESKTOP_OVERLAY_STOP | MessageType.DESKTOP_OVERLAY_STATUS;
}

/** HLS 合并产物就绪广播（SW → 侧栏，侧栏据 taskId 从 IndexedDB 取 Blob 保存） */
export interface HlsBlobReadyMessage { type: MessageType.HLS_BLOB_READY; taskId: string }

/**
 * 页面录制产物元数据（内容脚本录制完成时随首个分块上送，后台持久化到 storage.local）。
 * 侧栏"录制成果"列表、编辑器标题、下载命名共用本结构。
 */
export interface CaptureRecordingMeta {
  /** 唯一 id（内容脚本生成：`caprec_${时间戳}_${随机}`），同时作为 IDB Blob 键后缀 */
  id: string;
  /** 录制模式：video=录视频（含音轨）；audio=仅录音 */
  mode: 'video' | 'audio';
  /** MediaRecorder 实际使用的 mimeType（如 video/webm;codecs=vp9,opus） */
  mimeType: string;
  /** 展示/下载用文件名（含扩展名；下载转码后由侧栏改写扩展名） */
  fileName: string;
  /** 产物字节数（列表展示体积用，免再取 Blob） */
  sizeBytes: number;
  /** 实际录制时长（毫秒；已扣除视频暂停导致的 recorder.pause 区间） */
  durationMs: number;
  /** 完成时刻（毫秒时间戳，列表排序与展示用） */
  createdAt: number;
  /** 来源页面标题（便于用户辨认是哪次录制；可能为空） */
  sourceTitle?: string;
  /** 来源页面 URL（排障/辨认用；可能为空） */
  sourceUrl?: string;
}

/** 录制产物分块上送（内容脚本 → 后台）。data 为 base64 字符串；meta 仅首块携带 */
export interface CaptureRecordingChunkMessage {
  type: MessageType.CAPTURE_RECORDING_CHUNK;
  /** 所属录制 id（与 DONE 对应） */
  recordId: string;
  /** 当前分块序号（从 0 开始） */
  seq: number;
  /** 分块总数（接收方据此判断完整性） */
  total: number;
  /** 本块 base64 数据（原始二进制 → base64，约 4/3 膨胀） */
  data: string;
  /** 元数据：仅 seq=0 的首块携带，其余分块省略 */
  meta?: CaptureRecordingMeta;
}

/**
 * 分块传输结束（内容脚本 → 后台）：后台拼装、落 IDB、写元数据并广播 READY。
 * total/durationMs/sizeBytes 可选：边录边送的场景（WebRTC）在结束时才知道总数与时长，
 * 由这里补齐；一次性交接的老链路不带这些字段，行为不变。
 */
export interface CaptureRecordingDoneMessage {
  type: MessageType.CAPTURE_RECORDING_DONE;
  recordId: string;
  total?: number;
  durationMs?: number;
  sizeBytes?: number;
}

/** 录制产物就绪广播（后台 → 侧栏，无应答）：侧栏刷新成果列表并提示 */
export interface CaptureRecordingReadyMessage { type: MessageType.CAPTURE_RECORDING_READY; meta: CaptureRecordingMeta }

/** 删除录制产物（侧栏 → 后台）：应答 { success }（后台请求-应答族） */
export interface CaptureRecordingDeleteMessage { type: MessageType.CAPTURE_RECORDING_DELETE; recordId: string }

/** 桥接脚本 → 后台：MAIN 世界上行事件（后台按 sender.tab.id 归属裁定是否接受） */
export interface WebRtcBridgeEventMessage { type: MessageType.WEBRTC_BRIDGE_EVENT; event: RtcUpEvent }

/** 后台 → 桥接脚本：下发 MAIN 世界命令 */
export interface WebRtcCommandMessage { type: MessageType.WEBRTC_COMMAND; command: RtcDownCommand }

/** 侧栏 → 后台：查询开关与流清单 */
export interface WebRtcCaptureStatusMessage { type: MessageType.WEBRTC_CAPTURE_STATUS; tabId?: number }

/** 侧栏 → 后台：开/关捕获（动态注册/注销内容脚本） */
export interface WebRtcCaptureToggleMessage { type: MessageType.WEBRTC_CAPTURE_TOGGLE; enabled: boolean }

/** 侧栏 → 后台：开始录制某一路流 */
export interface WebRtcCaptureStartMessage {
  type: MessageType.WEBRTC_CAPTURE_START;
  tabId: number;
  streamId: string;
  mode?: 'video' | 'audio';
}

/** 侧栏 → 后台：停止一路录制 */
export interface WebRtcCaptureStopMessage { type: MessageType.WEBRTC_CAPTURE_STOP; recordId: string }

/** 后台 → 侧栏广播：流清单/录制状态变化 */
export interface WebRtcCaptureUpdateMessage {
  type: MessageType.WEBRTC_CAPTURE_UPDATE;
  tabId: number;
  streams: RtcStreamInfo[];
  /** recordId → 录制状态 */
  recording: Record<string, 'recording' | 'stopped' | 'error'>;
  error?: string;
}

/**
 * HLS 下载任务入队消息。
 * payload 复用下载台账的 StartDownloadPayload：字段只增不删，
 * 后台 enqueueHls 按原有 3 个字段消费，新增的来源页字段向后兼容。
 */
export interface StartHlsDownloadMessage {
  type: MessageType.START_HLS_DOWNLOAD;
  payload: StartDownloadPayload;
}

/** 视频元素列表扫描请求（内容脚本） */
export interface GetVideoListMessage { type: MessageType.GET_VIDEO_LIST }

/** 图片列表扫描请求；payload.includeCanvas=true 时才执行 canvas 抓取（P1-3 按需化） */
export interface RequestImageListMessage { type: MessageType.REQUEST_IMAGE_LIST; payload?: { includeCanvas?: boolean } }

/** 音频列表扫描请求（内容脚本） */
export interface RequestAudioListMessage { type: MessageType.REQUEST_AUDIO_LIST }

/** 视频播放控制消息（index 稳定索引 + play/pause 动作） */
export interface ControlVideoMessage { type: MessageType.CONTROL_VIDEO; index?: number; action?: VideoControlAction }

/** 启动页面级录制消息（index 定位视频元素，mode 区分录视频/仅录音） */
export interface StartRecordVideoMessage { type: MessageType.START_RECORD_VIDEO; index?: number; mode?: 'video' | 'audio' }

/** 停止页面级录制消息 */
export interface StopRecordVideoMessage { type: MessageType.STOP_RECORD_VIDEO; index?: number }

/** 视频直链候选查询（内容脚本按 index 返回 currentSrc/src/source 子标签等候选） */
export interface RequestVideoSourcesMessage { type: MessageType.REQUEST_VIDEO_SOURCES; index?: number }

/** 录屏页面画笔覆盖层开关 */
export interface AnnotateToggleMessage { type: MessageType.ANNOTATE_TOGGLE; payload?: { active?: boolean } }

/** 录屏点击/光标高亮覆盖层开关（Round 5 #32；广播到所有 frame，iframe 内的点击也要有高亮） */
export interface CursorHighlightToggleMessage { type: MessageType.CURSOR_HIGHLIGHT_TOGGLE; payload?: { active?: boolean } }

/** 画笔工具栏显隐（只在覆盖层已开启的页面上生效；无载荷，语义就是「翻转当前状态」） */
export interface AnnotateToolbarToggleMessage { type: MessageType.ANNOTATE_TOOLBAR_TOGGLE }

/** 录制控制命令（背景收到 chrome.commands 后转发给侧栏；侧栏未开时无接收端，属正常） */
export interface RecordingCommandMessage {
  type: MessageType.RECORDING_COMMAND;
  action: 'toggle-pause' | 'stop';
}

/** 页面正文抽取请求（应答 { success, content: TextContentDTO }，见文件头契约第 2 条） */
export interface GetTextContentMessage { type: MessageType.GET_TEXT_CONTENT }

/** 划词选区取回请求（应答 { success, content: TextSelectionDTO }） */
export interface GetTextSelectionMessage { type: MessageType.GET_TEXT_SELECTION }

/** @deprecated 旧版便捷播放（无载荷） */
export interface PlayVideoMessage { type: MessageType.PLAY_VIDEO }

/** @deprecated 旧版便捷暂停（无载荷） */
export interface PauseVideoMessage { type: MessageType.PAUSE_VIDEO }

/** @deprecated 旧版整页资源扫描（无载荷） */
export interface ScanPageSourcesMessage { type: MessageType.SCAN_PAGE_SOURCES }

/**
 * 全项目消息判别联合：所有经 chrome.runtime/tabs 消息通道收发的类型。
 * 用法：`switch (message.type)` 或泛型注册函数按 type 收窄到具体成员。
 * 注意：PONG 是纯应答（非请求），不在此联合内；应答形态见文件头契约注释。
 */
export type AnyMessage =
  | PingMessage
  | WhoAmIMessage
  | EnableFeaturesMessage
  | SettingsUpdateMessage
  | RequestAudioListMessage
  | RequestImageListMessage
  | DirectDownloadMessage
  | GetVideoListMessage
  | ControlVideoMessage
  | StartRecordVideoMessage
  | StopRecordVideoMessage
  | VideoRecordingStatusMessage
  | VideoPlaybackStatusMessage
  | RequestVideoSourcesMessage
  | DownloadQueueActionMessage
  | DownloadQueueSnapshotMessage
  | DownloadProgressEventMessage
  | ResourceUpdateMessage
  | StartHlsDownloadMessage
  | HlsBlobReadyMessage
  | AnnotateToggleMessage
  | CursorHighlightToggleMessage
  | AnnotateToolbarToggleMessage
  | RecordingCommandMessage
  | GetTextContentMessage
  | GetTextSelectionMessage
  | SourcesTreeScanMessage
  | SourcesTreeDownloadMessage
  | SourcesDownloadStatusMessage
  | SourcesDownloadProgressMessage
  | GetCapturedVideoSourcesMessage
  | MediaSweepMessage
  | ExternalToolsMessage
  | CompanionStatusMessage
  | CompanionRecheckMessage
  | CaptureRecordingChunkMessage
  | CaptureRecordingDoneMessage
  | CaptureRecordingReadyMessage
  | CaptureRecordingDeleteMessage
  | WebRtcBridgeEventMessage
  | WebRtcCommandMessage
  | WebRtcCaptureStatusMessage
  | WebRtcCaptureToggleMessage
  | WebRtcCaptureStartMessage
  | WebRtcCaptureStopMessage
  | WebRtcCaptureUpdateMessage
  | PlayVideoMessage
  | PauseVideoMessage
  | ScanPageSourcesMessage;
