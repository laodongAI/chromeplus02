/**
 * 全局设置（MV3 chrome.storage.local）
 * 包含下载配置 + AI 模型配置
 */
import { sendRuntimeMessage } from '../utils/chromeMessaging';
// P1-1 协议收敛：设置同步广播的类型改用消息枚举，消除裸字符串
import { MessageType } from '@/messaging';
// Round 5 #30：外挂下载器配置形态与默认值取自纯模块（后台同源，避免两处默认值漂移）
import { DEFAULT_EXTERNAL_TOOLS, type ExternalToolConfig } from '@/core/externalTools';

export type { ExternalToolConfig };
export { DEFAULT_EXTERNAL_TOOLS };

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
  /** 极速下载：优先派发给本地伴生程序（yt-dlp），未安装时自动回退内置链路 */
  companion: boolean;
  /** 外挂下载器（Round 5 #30）：aria2 RPC / 本机 m3u8DL-RE / ffmpeg；关闭即全部走内置 */
  externalTools: ExternalToolConfig;
  /**
   * WebRTC 录流（Round 5 #30）：开启后动态注入 MAIN/ISOLATED 脚本捕获远端流。
   * 开关由视频面板的 WebRTC 卡片经后台写入；这里必须带上该字段，
   * 否则设置页保存时会把它抹掉，导致捕获被意外关闭。
   */
  webrtcCapture: boolean;
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
          companion: typeof raw.companion === 'boolean' ? raw.companion : false,
          externalTools: { ...DEFAULT_EXTERNAL_TOOLS, ...(raw.externalTools || {}) },
          webrtcCapture: raw.webrtcCapture === true,
          ai: { ...DEFAULT_AI, ...(raw.ai || {}) },
        });
      });
    } catch {
      resolve({ namingTemplate: '{site}_{title}_{datetime}', autoScan: false, maxConcurrent: 3, showShortcutHints: true, theme: 'auto', companion: false, externalTools: { ...DEFAULT_EXTERNAL_TOOLS }, webrtcCapture: false, ai: DEFAULT_AI });
    }
  });
}

export async function saveSettings(settings: ExtensionSettings) {
  try { chrome.storage.local.set({ [KEY]: settings }); } catch { /* noop */ }
  try {
    await sendRuntimeMessage({ type: MessageType.SETTINGS_UPDATE, payload: settings });
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
