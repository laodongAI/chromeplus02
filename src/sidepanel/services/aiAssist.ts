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

/** 接口 AI 分析输入条目：只保留必要的请求/响应文本，避免 prompt 过大 */
export interface NetworkInsightItem {
  /** HTTP 方法（GET/POST/…） */
  method: string;
  /** 请求 URL */
  url: string;
  /** HTTP 状态码（未收到响应时缺省） */
  status?: number;
  /** 响应 MIME 类型 */
  mimeType?: string;
  /** 请求体文本（POST/PUT 等） */
  postData?: string;
  /** 响应体文本（仅文本/JSON） */
  responseBody?: string;
}

/**
 * 对捕获到的接口请求做语义分析（接口用途 / 关键字段 / 业务流程）。
 * @param page 当前页面信息（标题与地址，可为空）
 * @param items 捕获到的接口列表（最多分析 20 条，超出的忽略）
 * @returns AI 返回的中文分析文本
 */
export async function aiAnalyzeNetwork(
  page: { title?: string; url?: string },
  items: NetworkInsightItem[]
): Promise<string> {
  // 逐条拼接精简上下文：请求体最多 400 字、响应体最多 600 字，防止超出上下文窗口
  const lines = items.slice(0, 20).map((it, n) => {
    const req = it.postData ? `\n   请求体：${it.postData.slice(0, 400)}` : '';
    const res = it.responseBody ? `\n   响应体：${it.responseBody.slice(0, 600)}` : '';
    const meta = `${it.status ? ` [${it.status}]` : ''}${it.mimeType ? ` (${it.mimeType})` : ''}`;
    return `${n + 1}. ${it.method} ${it.url}${meta}${req}${res}`;
  }).join('\n');
  return aiChat([
    { role: 'system', content: '你是资深前后端接口分析专家，只输出中文、结构清晰的结论，不要寒暄。' },
    {
      role: 'user',
      content: `请分析以下网页捕获到的接口请求，按三部分输出：\n一、接口清单：逐个说明用途与关键字段（编号与输入对应）；\n二、业务流程：推断页面在做什么、数据如何流转（3-6 句）；\n三、可关注数据：最值得提取的数据点或潜在风险。\n\n页面：${page.title || '（无标题）'} ${page.url || ''}\n接口共 ${items.length} 条（最多分析 20 条）：\n${lines}`
    }
  ], { maxTokens: 1200, temperature: 0.3 });
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
