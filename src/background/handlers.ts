/**
 * 背景消息处理器（TypeScript 版）。
 * 说明：与旧版 background.js 的处理器保持等效行为，逐步替换。
 */

import { getCurrentTabUrl, getActiveBilibiliTabId } from './helpers';
import { checkMcpStatus as checkMcpViaLocal } from '../services/mcp';

export async function handleGetCurrentUrl(sender: chrome.runtime.MessageSender, sendResponse: (resp: any) => void) {
  try {
    const url = await getCurrentTabUrl(sender.tab?.id);
    sendResponse({ success: true, url });
  } catch (e: any) {
    sendResponse({ success: false, error: e?.message || '获取URL失败' });
  }
}

export async function handleGetActiveBilibiliTab(sendResponse: (resp: any) => void) {
  try {
    const tabId = await getActiveBilibiliTabId();
    sendResponse({ success: true, tabId });
  } catch (e: any) {
    sendResponse({ success: false, error: e?.message || '获取B站标签页失败' });
  }
}

export async function handleCheckMcpService(sendResponse: (resp: any) => void) {
  try {
    const status = await checkMcpViaLocal();
    const available = status.status === 'online';
    await chrome.storage.local.set({ mcpServiceAvailable: available });
    sendResponse({ success: true, available });
  } catch (e: any) {
    sendResponse({ success: false, error: e?.message || 'MCP状态检查失败' });
  }
}

export async function handleProxyAiRequest(data: { url: string; apiKey: string; prompt: string }, sendResponse: (resp: any) => void) {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30_000);
    try {
      const resp = await fetch(data.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${data.apiKey}` },
        body: JSON.stringify({
          model: 'moonshot-v1-8k',
          messages: [
            { role: 'system', content: '你是一个专业视频内容分析助手，负责分析B站视频页面内容。' },
            { role: 'user', content: data.prompt }
          ],
          max_tokens: 1000,
          temperature: 0.7
        }),
        signal: controller.signal
      });
      clearTimeout(timeoutId);
      if (!resp.ok) {
        const text = await resp.text().catch(() => '无错误详情');
        throw new Error(`API请求失败: ${resp.status} ${resp.statusText} - ${text}`);
      }
      const json = await resp.json();
      sendResponse({ success: true, result: json.choices?.[0]?.message?.content });
    } catch (err: any) {
      clearTimeout(timeoutId);
      if (err?.name === 'AbortError') {
        sendResponse({ success: false, error: 'AI请求超时' });
      } else if (err?.name === 'TypeError' && err?.message === 'Failed to fetch') {
        sendResponse({ success: false, error: '网络连接错误: 无法连接到AI服务器' });
      } else {
        sendResponse({ success: false, error: err?.message || '代理请求失败' });
      }
    }
  } catch (e: any) {
    sendResponse({ success: false, error: e?.message || '代理请求失败' });
  }
}

export function handleContentSiteInfo(data: any, sender: chrome.runtime.MessageSender) {
  // 先记录日志；后续可引入内存状态与广播逻辑
  const tabId = sender.tab?.id;
  console.log('[bg.handlers] 内容脚本上报站点信息:', { tabId, data });
}
