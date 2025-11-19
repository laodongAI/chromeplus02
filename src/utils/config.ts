/**
 * 配置相关工具函数（TypeScript 版）。
 * 职责：加载/保存配置、获取活跃AI模型、获取站点提示模板。
 * 注意：为兼容现有 JS 逻辑，类型定义尽量宽松，后续逐步收紧。
 */

export interface AiModel {
  id: string;
  name?: string;
  enabled?: boolean;
  apiUrl?: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  apiKey?: string;
}

export interface AnalysisConfig {
  defaultModel?: string;
  promptTemplates?: Record<string, string>;
}

export interface FileStorageConfig {
  mcpEnabled?: boolean;
  mcpApiUrl?: string;
  mcpServicePath?: string;
  mcpStatus?: boolean;
  savedPath?: string;
  filenameTemplate?: string;
}

export interface RootConfig {
  aiModels?: AiModel[];
  analysis?: AnalysisConfig;
  supportedSites?: Array<{ id: string; name?: string; enabled?: boolean; domains?: string[] }>;
  interface?: Record<string, unknown>;
  recording?: Record<string, unknown>;
  fileStorage?: FileStorageConfig;
  [k: string]: unknown;
}

/**
 * 加载配置数据（优先从 chrome.storage.local 读取；如不存在则回退 window.defaultConfig）。
 * @returns 配置对象（可能为空对象）
 */
export async function loadConfig(): Promise<RootConfig> {
  return new Promise<RootConfig>((resolve) => {
    try {
      chrome.storage.local.get('config', (result) => {
        const conf = (result && (result as any).config) || (globalThis as any).defaultConfig || {};
        resolve(conf as RootConfig);
      });
    } catch (e) {
      console.error('[utils/config] 读取配置失败，返回空对象', e);
      resolve({});
    }
  });
}

/**
 * 保存配置数据到 chrome.storage.local。
 * @param config 要保存的配置对象
 */
export async function saveConfig(config: RootConfig): Promise<void> {
  return new Promise<void>((resolve) => {
    try {
      chrome.storage.local.set({ config }, () => resolve());
    } catch (e) {
      console.error('[utils/config] 保存配置失败', e);
      resolve();
    }
  });
}

/**
 * 获取当前活跃的 AI 模型配置。
 * 策略：优先取 analysis.defaultModel 指定且启用的模型；否则取第一个启用的模型；都无则返回 null。
 */
export function getActiveAiModel(config?: RootConfig): AiModel | null {
  if (!config || !config.aiModels || config.aiModels.length === 0) return null;
  const defaultModelId = config.analysis?.defaultModel || 'openai';
  const def = config.aiModels.find((m) => m.id === defaultModelId && m.enabled);
  if (def) return def;
  const first = config.aiModels.find((m) => m.enabled);
  return first || null;
}

/**
 * 获取站点提示模板；找不到则回退 default；仍无则提供通用模板。
 * @param siteId 站点ID（如 bilibili/youtube）
 */
export function getPromptTemplate(siteId: string | undefined, config?: RootConfig): string {
  if (!siteId || !config?.analysis?.promptTemplates) return '';
  return (
    config.analysis.promptTemplates[siteId.toLowerCase()] ||
    config.analysis.promptTemplates.default ||
    '请分析以下内容，给出一个结构化总结：\n\n标题：{title}\nURL：{url}\n内容：{content}\n'
  );
}
