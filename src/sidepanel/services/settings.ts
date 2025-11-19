/**
 * 全局设置加载与保存（MV3 chrome.storage.local）。
 * 与后台并发/命名模板联动，侧边栏调用后会通过消息通知后台刷新运行时参数。
 */
import { sendRuntimeMessage } from '../utils/chromeMessaging';

export interface ExtensionSettings {
  namingTemplate: string;
  autoScan: boolean;
  maxConcurrent: number;
}

const KEY = 'global_settings_v1';

export async function loadSettings(): Promise<ExtensionSettings> {
  return new Promise(resolve => {
    try {
      chrome.storage.local.get(KEY, res => {
        const raw = res?.[KEY] || {};
        resolve({
          namingTemplate: raw.namingTemplate || '{site}_{title}_{datetime}',
            autoScan: typeof raw.autoScan === 'boolean' ? raw.autoScan : false,
            maxConcurrent: typeof raw.maxConcurrent === 'number' ? raw.maxConcurrent : 3
        });
      });
    } catch { resolve({ namingTemplate: '{site}_{title}_{datetime}', autoScan: false, maxConcurrent: 3 }); }
  });
}

export async function saveSettings(settings: ExtensionSettings) {
  try { chrome.storage.local.set({ [KEY]: settings }); } catch { /* noop */ }
  try {
    await sendRuntimeMessage({ type: 'SETTINGS_UPDATE', payload: { namingTemplate: settings.namingTemplate, autoScan: settings.autoScan, maxConcurrent: settings.maxConcurrent } });
  } catch { /* noop */ }
}

export function applyLocalPatch(current: ExtensionSettings, patch: Partial<ExtensionSettings>): ExtensionSettings {
  return { ...current, ...patch };
}
