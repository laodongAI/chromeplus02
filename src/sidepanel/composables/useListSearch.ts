import { ref, type Ref } from 'vue';

export interface CustomShortcut {
  key: string; // 规范化为小写字符，如 'a','f','r'
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
  handler: () => void;
}
export interface UseListSearchOptions {
  onRefresh?: () => void;
  selectAll?: () => void;
  clearSelection?: () => void;
  invertSelection?: () => void;
  selectNew?: () => void;
  customShortcuts?: CustomShortcut[]; // 预留: 可由设置面板动态注入
}

export interface UseListSearch {
  searchQuery: Ref<string>;
  searchInputRef: Ref<HTMLInputElement | null>;
  focusSearch: () => void;
  register: () => void;
  unregister: () => void;
  textMatch: (q: string, ...fields: Array<string | undefined | null>) => boolean;
}

export function useListSearch(opts: UseListSearchOptions = {}): UseListSearch {
  const searchQuery = ref('');
  const searchInputRef = ref<HTMLInputElement | null>(null);

  const focusSearch = () => {
    try { searchInputRef.value?.focus(); } catch { /* noop */ }
  };

  const handleKey = (e: KeyboardEvent) => {
    if (!e.ctrlKey) return;
    const key = e.key?.toLowerCase?.() || '';
    if (opts.customShortcuts && opts.customShortcuts.length) {
      for (const sc of opts.customShortcuts) {
        if (sc.key === key && (!!sc.ctrl === e.ctrlKey) && (!!sc.shift === e.shiftKey) && (!!sc.alt === e.altKey)) {
          e.preventDefault();
          try { sc.handler(); } catch { /* noop */ }
          return;
        }
      }
    }
    if (key === 'a') { e.preventDefault(); opts.selectAll?.(); return; }
    if (key === 'd') { e.preventDefault(); opts.clearSelection?.(); return; }
    if (key === 'f') { e.preventDefault(); focusSearch(); return; }
    if (key === 'r' && e.shiftKey) { e.preventDefault(); opts.onRefresh?.(); return; }
    if (key === 'i' && e.shiftKey) { e.preventDefault(); opts.invertSelection?.(); return; }
    if (key === 'n' && e.shiftKey) { e.preventDefault(); opts.selectNew?.(); return; }
  };

  const register = () => { try { window.addEventListener('keydown', handleKey); } catch { /* noop */ } };
  const unregister = () => { try { window.removeEventListener('keydown', handleKey); } catch { /* noop */ } };

  const textMatch = (q: string, ...fields: Array<string | undefined | null>) => {
    const needle = (q || '').trim().toLowerCase();
    if (!needle) return true;
    for (const f of fields) {
      if (!f) continue;
      if (String(f).toLowerCase().includes(needle)) return true;
    }
    return false;
  };

  return { searchQuery, searchInputRef, focusSearch, register, unregister, textMatch };
}
