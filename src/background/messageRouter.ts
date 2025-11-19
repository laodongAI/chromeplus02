/**
 * 背景消息路由占位。
 * 说明：定义统一的消息入口，避免魔法字符串分散在各处；迁移完成后在 index.ts 启用。
 */

export enum BgMessageType {
  GetCurrentUrl = 'GET_CURRENT_URL',
  GetActiveBilibiliTab = 'GET_ACTIVE_BILIBILI_TAB',
  CheckMcpService = 'CHECK_MCP_SERVICE',
  ProxyAiRequest = 'PROXY_AI_REQUEST',
  GetConfig = 'GET_CONFIG',
  SaveConfig = 'SAVE_CONFIG',
  ContentSiteInfo = 'CONTENT_SITE_INFO'
}

export function setupMessageRouter() {
  // 示例：迁移后启用
  // chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  //   switch (message.type as BgMessageType) {
  //     case BgMessageType.GetCurrentUrl:
  //       // TODO: 调用对应处理器
  //       break;
  //     default:
  //       sendResponse({ success: false, error: '未知的消息类型' });
  //   }
  //   return true; // 异步响应
  // });
    // 示例：迁移完成后在 background/index.ts 中调用本方法
    // 为避免与旧 background.js 冲突，此处暂不默认启用
    // import * as H from './handlers'
    // chrome.runtime.onMessage.addListener((message: any, sender, sendResponse) => {
    //   switch (message?.type as BgMessageType) {
    //     case BgMessageType.GetCurrentUrl:
    //       H.handleGetCurrentUrl(sender, sendResponse); break;
    //     case BgMessageType.GetActiveBilibiliTab:
    //       H.handleGetActiveBilibiliTab(sendResponse); break;
    //     case BgMessageType.CheckMcpService:
    //       H.handleCheckMcpService(sendResponse); break;
    //     case BgMessageType.ProxyAiRequest:
    //       H.handleProxyAiRequest(message?.data, sendResponse); break;
    //     case BgMessageType.ContentSiteInfo:
    //       H.handleContentSiteInfo(message?.data, sender); sendResponse({ success: true }); break;
    //     default:
    //       sendResponse({ success: false, error: '未知的消息类型' });
    //   }
    //   return true;
    // });
}
