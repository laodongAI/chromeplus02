
import { MessageType, type TextContentDTO } from '@/messaging';

/**
 * 简单的文本抽取模块
 * 目标：提取页面正文、标题、元数据
 */

export function initTextExtractor() {
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type === MessageType.GET_TEXT_CONTENT) {
      const data = extractPageContent();
      sendResponse(data);
    }
  });
}

function extractPageContent(): TextContentDTO {
  const title = document.title || '';
  const description = getMetaContent('description') || getMetaContent('og:description');
  const keywords = (getMetaContent('keywords') || '').split(',').map(s => s.trim()).filter(Boolean);
  const author = getMetaContent('author') || getMetaContent('article:author');

  // 简易正文提取：寻找包含最多 P 标签的容器
  // 这是一个非常基础的启发式算法，后续可以替换为 Readability.js
  const candidates = Array.from(document.querySelectorAll('article, main, .content, .post, .article, #content, #main'));
  let bestCandidate = document.body;
  
  if (candidates.length > 0) {
    // 优先选择语义化标签
    bestCandidate = candidates[0] as HTMLElement;
  } else {
    // 否则遍历 div，打分
    // 这里简化处理，直接取 body
  }

  // 提取纯文本
  const textContent = bestCandidate.innerText || '';
  const wordCount = textContent.length;

  // 提取所有 meta
  const meta: Record<string, string> = {};
  Array.from(document.querySelectorAll('meta')).forEach(m => {
    const name = m.getAttribute('name') || m.getAttribute('property');
    const content = m.getAttribute('content');
    if (name && content) {
      meta[name] = content;
    }
  });

  return {
    title,
    description,
    keywords,
    author,
    textContent: textContent.slice(0, 5000), // 限制长度防止过大
    wordCount,
    meta
  };
}

function getMetaContent(name: string): string | undefined {
  const el = document.querySelector(`meta[name="${name}"], meta[property="${name}"]`);
  return el?.getAttribute('content') || undefined;
}
