/**
 * 主题应用：读取设置中的 theme（auto/light/dark），写入 html[data-theme]。
 * - auto 跟随系统 prefers-color-scheme 并监听变化
 * - 监听 chrome.storage 变化，设置面板切换即时生效（无需刷新）
 */

export type ThemeMode = 'auto' | 'light' | 'dark';

const schemeQuery = typeof window !== 'undefined' && window.matchMedia
  ? window.matchMedia('(prefers-color-scheme: dark)')
  : null;

let currentMode: ThemeMode = 'auto';

function resolvedTheme(mode: ThemeMode): 'light' | 'dark' {
  if (mode !== 'auto') return mode;
  return schemeQuery?.matches ? 'dark' : 'light';
}

function apply(mode: ThemeMode): void {
  currentMode = mode;
  try {
    document.documentElement.dataset.theme = resolvedTheme(mode);
  } catch { /* noop */ }
}

/** 以给定模式立即应用主题（通常来自 settings.theme） */
export function applyTheme(mode?: string): void {
  apply(mode === 'light' || mode === 'dark' ? mode : 'auto');
}

/** 初始化：先按 auto 应用避免首帧闪烁，再异步读取设置校正，并持续监听 */
export function initThemeWatcher(getTheme?: () => Promise<string | undefined>): void {
  apply(currentMode);
  if (schemeQuery) {
    try { schemeQuery.addEventListener('change', () => apply(currentMode)); } catch { /* noop */ }
  }
  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      const change = changes.global_settings_v2;
      const theme = change?.newValue?.theme;
      if (typeof theme === 'string') applyTheme(theme);
    });
  } catch { /* noop */ }
  if (getTheme) {
    getTheme().then(t => { if (t) applyTheme(t); }).catch(() => { /* noop */ });
  }
}
