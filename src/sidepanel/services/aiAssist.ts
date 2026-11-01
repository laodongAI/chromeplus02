/**
 * AI 辅助服务：基于设置中的 OpenAI 兼容端点（智谱 GLM 等 7 家预设）。
 * 编辑器的语音转字幕走独立链路，此处供抓取面板的摘要/命名等轻量 AI 能力复用。
 */

import { loadAIConfig } from './settings';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export async function aiChat(messages: ChatMessage[], opts?: { maxTokens?: number; temperature?: number }): Promise<string> {
  const cfg = await loadAIConfig();
  if (!cfg.apiKey) throw new Error('未配置 AI API Key（设置 → AI 模型配置）');
  const base = cfg.baseUrl.replace(/\/$/, '');
  const resp = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${cfg.apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: cfg.model,
      messages,
      max_tokens: opts?.maxTokens ?? 700,
      temperature: opts?.temperature ?? 0.4
    })
  });
  if (!resp.ok) throw new Error(`AI ${resp.status}: ${(await resp.text()).slice(0, 160)}`);
  const data = await resp.json();
  const content = data?.choices?.[0]?.message?.content;
  if (!content) throw new Error('AI 返回为空');
  return String(content);
}

/** 网页内容摘要 + 关键词 */
export async function aiSummarizePage(title: string, textContent: string): Promise<string> {
  return aiChat([
    { role: 'system', content: '你是专业的内容分析师，输出简洁的中文分析结果。' },
    {
      role: 'user',
      content: `请为以下网页内容生成摘要与关键词。格式严格为两行：\n摘要：（120 字以内）\n关键词：（3-6 个，用、分隔）\n\n标题：${title || '（无）'}\n正文：\n${textContent.slice(0, 6000)}`
    }
  ], { maxTokens: 500 });
}

/** 为资源列表建议简洁标题；返回 url → 标题 映射（尽力解析，失败抛错由调用方提示） */
export async function aiSuggestTitles(items: { url: string; title?: string; kind: string }[], pageContext?: string): Promise<Record<string, string>> {
  const list = items.slice(0, 20).map((i, n) => `${n + 1}. [${i.kind}] ${i.title || '（无标题）'}\n   ${i.url}`).join('\n');
  const out = await aiChat([
    { role: 'system', content: '你是资源整理助手，只输出 JSON，不要解释。' },
    {
      role: 'user',
      content: `为以下媒体资源各建议一个简洁的中文标题（≤14 字，可意译，不要含扩展名）。${pageContext ? `页面背景：${pageContext.slice(0, 300)}` : ''}\n严格输出 JSON：{"结果":[{"序号":1,"标题":"..."},...]}，序号对应以下列表：\n${list}`
    }
  ], { maxTokens: 800 });
  const m = /\{[\s\S]*\}/.exec(out);
  if (!m) throw new Error('AI 未返回可解析的结果');
  const parsed = JSON.parse(m[0]) as { 结果?: { 序号: number; 标题?: string }[] };
  const map: Record<string, string> = {};
  (parsed.结果 || []).forEach(r => {
    const item = items[(r.序号 || 0) - 1];
    if (item && r.标题) map[item.url] = String(r.标题).slice(0, 40);
  });
  if (!Object.keys(map).length) throw new Error('AI 未给出有效标题');
  return map;
}
