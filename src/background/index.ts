/**
 * 背景入口 (Service Worker)。
 * 职责：初始化消息总线，随后各模块注册各自的消息处理器。
 * 说明：录制由内容脚本自行管理生命周期（页面级 MediaRecorder），
 *       标签页关闭时随页面销毁，后台无需额外登记簿。
 */

import { initMessageBus } from './bus';
import { initDownloadsMessageHandler } from './downloads';
import { initCaptureHandlers } from './capture';
import { setupMessageRouter } from './messageRouter';
import { initSourcesDownloadCleanup } from './sourcesDownload';
import { initBadge } from './badge';
import { initCompanionHandlers } from './companion';
import { initNetworkCaptureHandlers } from './networkCapture';
import { initMediaSweepHandlers } from './mediaSweep';
// WebRTC 录流：按设置动态注入 MAIN/ISOLATED 脚本，远端流就地录制后复用录制成果链路
import { initWebRtcCaptureHandlers } from './webrtcCapture';
// 外挂下载器（aria2 RPC / 伴生程序调用本机 m3u8DL-RE、ffmpeg）
import { initExternalToolsHandlers } from './externalTools';
// 页面录制产物交接（内容脚本分块上送 → IDB 持久化 → 侧栏"录制成果"列表）
import { initCaptureRecordingHandlers } from './captureRecording';
// P1-8：分级日志（SW 上下文默认 info 级）
import { createLogger } from '@/utils/logger';

/** 本模块 logger：保留原 `[background:index]` 前缀语义 */
const log = createLogger('background:index');

// 消息总线必须最先初始化，后续模块的 registerBgHandler 才能被路由
initMessageBus();
initDownloadsMessageHandler();
initCaptureHandlers();
setupMessageRouter();
initSourcesDownloadCleanup();
initBadge();
initCompanionHandlers();
// 网络请求捕获（XHR/Fetch 与 POST；依赖 chrome.debugger，按需 attach）
initNetworkCaptureHandlers();
// 媒体候选回收：缓存捕捉（页面资源账本）+ 深度搜索（脚本正文里的懒加载地址）
initMediaSweepHandlers();
// 外挂下载器：设置读取 + 状态探测/派发入口（下载队列内部也在用，见 bg.downloads）
initExternalToolsHandlers();
// 页面录制产物交接：接收内容脚本分块、落 IDB、广播就绪（侧栏列表消费）
initCaptureRecordingHandlers();
// WebRTC 录流：开关驱动的动态注入 + 远端流清单 + 录制归属裁定（产物复用上面的交接链路）
initWebRtcCaptureHandlers();

/**
 * 初始化侧边栏打开行为：点击扩展图标即打开侧边栏（README 承诺的交互）。
 * 兜底策略：
 *  - chrome.sidePanel API 缺失（Chrome < 114）或 setPanelBehavior 不可用时，
 *    输出 warn 级日志并跳过，不阻断后台其余初始化；
 *  - Promise 失败时输出 error 级日志（如策略限制场景）。
 */
function initSidePanelBehavior(): void {
  const sidePanel = chrome?.sidePanel;
  if (!sidePanel?.setPanelBehavior) {
    log.warn('chrome.sidePanel.setPanelBehavior 不可用（Chrome 版本过低？），点击图标不会自动打开侧边栏');
    return;
  }
  sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .then(() => {
      log.info('已设置点击扩展图标打开侧边栏（openPanelOnActionClick=true）');
    })
    .catch((e: unknown) => {
      log.error('setPanelBehavior 失败:', e instanceof Error ? e.message : String(e));
    });
}
initSidePanelBehavior();

log.info('背景脚手架已加载');
