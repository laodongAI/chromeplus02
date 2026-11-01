/**
 * 全局设置（MV3 chrome.storage.local）
 * 包含下载配置 + AI 模型配置
 */
import { sendRuntimeMessage } from '../utils/chromeMessaging';

export interface AIModelConfig {
  provider: 'openai' | 'anthropic' | 'gemini' | 'deepseek' | 'zhipu' | 'moonshot' | 'qwen' | 'custom';
  apiKey: string;
  baseUrl: string;        // 自定义端点（兼容 OpenAI 格式）
  model: string;          // 模型名称
  whisperModel: string;   // 语音转写模型
  translateProvider: 'openai' | 'deepl' | 'baidu';
  deeplApiKey: string;
  baiduAppId: string;
  baiduSecretKey: string;
}

export type ThemeMode = 'auto' | 'light' | 'dark';

export interface ExtensionSettings {
  namingTemplate: string;
  autoScan: boolean;
  maxConcurrent: number;
  showShortcutHints: boolean;
  /** 界面主题：auto 跟随系统 */
  theme: ThemeMode;
  ai: AIModelConfig;
}

const DEFAULT_AI: AIModelConfig = {
  provider: 'openai',
  apiKey: '',
  baseUrl: 'https://api.openai.com/v1',
  model: 'gpt-4o-mini',
  whisperModel: 'whisper-1',
  translateProvider: 'openai',
  deeplApiKey: '',
  baiduAppId: '',
  baiduSecretKey: '',
};

const KEY = 'global_settings_v2';

export async function loadSettings(): Promise<ExtensionSettings> {
  return new Promise(resolve => {
    try {
      chrome.storage.local.get(KEY, res => {
        const raw = res?.[KEY] || {};
        resolve({
          namingTemplate: raw.namingTemplate || '{site}_{title}_{datetime}',
          autoScan: typeof raw.autoScan === 'boolean' ? raw.autoScan : false,
          maxConcurrent: typeof raw.maxConcurrent === 'number' ? raw.maxConcurrent : 3,
          showShortcutHints: typeof raw.showShortcutHints === 'boolean' ? raw.showShortcutHints : true,
          theme: raw.theme === 'light' || raw.theme === 'dark' ? raw.theme : 'auto',
          ai: { ...DEFAULT_AI, ...(raw.ai || {}) },
        });
      });
    } catch {
      resolve({ namingTemplate: '{site}_{title}_{datetime}', autoScan: false, maxConcurrent: 3, showShortcutHints: true, theme: 'auto', ai: DEFAULT_AI });
    }
  });
}

export async function saveSettings(settings: ExtensionSettings) {
  try { chrome.storage.local.set({ [KEY]: settings }); } catch { /* noop */ }
  try {
    await sendRuntimeMessage({ type: 'SETTINGS_UPDATE', payload: settings });
  } catch { /* noop */ }
}

/** 读取 AI 配置（编辑器独立页面调用） */
export async function loadAIConfig(): Promise<AIModelConfig> {
  return new Promise(resolve => {
    try {
      chrome.storage.local.get(KEY, res => {
        resolve({ ...DEFAULT_AI, ...(res?.[KEY]?.ai || {}) });
      });
    } catch { resolve({ ...DEFAULT_AI }); }
  });
}

export function applyLocalPatch(current: ExtensionSettings, patch: Partial<ExtensionSettings>): ExtensionSettings {
  return { ...current, ...patch };
}
