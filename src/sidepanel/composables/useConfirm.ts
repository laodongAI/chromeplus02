/**
 * 确认对话框服务：Promise 化 confirm，替代原生 confirm()。
 * 用法：const ok = await confirmDialog({ title: '清空历史', message: '此操作不可恢复', danger: true });
 */
import { reactive } from 'vue';

export interface ConfirmOptions {
  title: string;
  message?: string;
  /** 危险操作确认按钮显示红色 */
  danger?: boolean;
  confirmText?: string;
  cancelText?: string;
}

interface ConfirmState extends ConfirmOptions {
  visible: boolean;
  resolve: ((ok: boolean) => void) | null;
}

export const confirmState = reactive<ConfirmState>({
  title: '',
  message: '',
  danger: false,
  confirmText: '确定',
  cancelText: '取消',
  visible: false,
  resolve: null
});

export function confirmDialog(options: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    // 若已有未关闭对话框，先结算为取消
    if (confirmState.resolve) confirmState.resolve(false);
    Object.assign(confirmState, {
      title: options.title,
      message: options.message || '',
      danger: !!options.danger,
      confirmText: options.confirmText || '确定',
      cancelText: options.cancelText || '取消',
      visible: true,
      resolve
    });
  });
}

function settle(ok: boolean): void {
  confirmState.visible = false;
  const r = confirmState.resolve;
  confirmState.resolve = null;
  r?.(ok);
}

export function confirmAccept(): void { settle(true); }
export function confirmCancel(): void { settle(false); }
