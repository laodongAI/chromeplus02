/**
 * 全局 Toast 通知：模块级响应式队列，容器组件挂在 SidePanelApp。
 * 用法：import { showToast } from '@/sidepanel/composables/useToast';
 *       showToast('已复制链接'); showToast('导出完成', 'success');
 */
import { reactive } from 'vue';

export type ToastType = 'info' | 'success' | 'error';

export interface ToastItem {
  id: number;
  message: string;
  type: ToastType;
}

let nextId = 1;
export const toastState = reactive<{ list: ToastItem[] }>({ list: [] });

const DURATION: Record<ToastType, number> = { info: 2200, success: 2200, error: 3500 };

export function showToast(message: string, type: ToastType = 'info'): void {
  if (!message) return;
  const item: ToastItem = { id: nextId++, message, type };
  toastState.list.push(item);
  // 最多同时 3 条，超出移除最旧
  while (toastState.list.length > 3) toastState.list.shift();
  setTimeout(() => {
    const idx = toastState.list.findIndex(t => t.id === item.id);
    if (idx >= 0) toastState.list.splice(idx, 1);
  }, DURATION[type]);
}

export const toast = {
  info: (msg: string) => showToast(msg, 'info'),
  success: (msg: string) => showToast(msg, 'success'),
  error: (msg: string) => showToast(msg, 'error')
};
