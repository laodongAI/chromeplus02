/**
 * 背景入口 (Service Worker) - 初始占位。
 * 职责：后续迁移原始 background.js 中的事件监听与消息路由。
 * 迁移策略：
 *  1. 保留现有 root/background.js 直至 TS 逻辑稳定。
 *  2. 分离监听 -> events.ts，消息路由 -> messageRouter.ts。
 *  3. 渐进式重构，确保不同时注册重复监听。
 */

import { initDownloadsMessageHandler } from './downloads';
import { initCaptureHandlers } from './capture';

initDownloadsMessageHandler();
initCaptureHandlers();

console.log('[background:index] 背景脚手架已加载');
