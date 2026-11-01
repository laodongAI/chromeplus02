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

// 消息总线必须最先初始化，后续模块的 registerBgHandler 才能被路由
initMessageBus();
initDownloadsMessageHandler();
initCaptureHandlers();
setupMessageRouter();
initSourcesDownloadCleanup();
initBadge();

console.log('[background:index] 背景脚手架已加载');
