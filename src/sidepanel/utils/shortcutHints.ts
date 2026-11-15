export const GLOBAL_SHORTCUT_HINT = '快捷键: Ctrl+A 全选 · Ctrl+D 清除 · Ctrl+Shift+I 反选 · Ctrl+Shift+N 选新 · Ctrl+Shift+R 重扫';

/**
 * 屏幕录制的全局快捷键（manifest commands → background/commands.ts）。
 * 「需 Chrome 在前台」这个前提必须写出来：chrome.commands 只在 Chrome 窗口聚焦时触发，
 * 录其他应用而 Chrome 在后台时按了没反应，不说明就会被当成 bug。
 */
export const RECORD_HOTKEY_HINT = '全局快捷键: Alt+Shift+H 画笔工具栏显隐 · Alt+Shift+P 暂停/继续 · Alt+Shift+S 停止（需 Chrome 窗口在前台；可在 chrome://extensions/shortcuts 改键）';
