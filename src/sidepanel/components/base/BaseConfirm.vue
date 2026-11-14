<template>
  <transition name="confirm-fade">
    <div v-if="confirmState.visible" class="confirm-mask" @click.self="confirmCancel()">
      <!-- UI 三批（组3）焦点管理：
           - aria-modal="true" 声明为模态对话框（role=alertdialog 已有）；
           - @keydown.tab 在两个按钮间循环圈定焦点（shift+tab 反向）；
           - @keydown.esc 等价取消 -->
      <div
        class="confirm-box"
        role="alertdialog"
        aria-modal="true"
        :aria-label="confirmState.title"
        @keydown.tab="trapFocus"
        @keydown.esc="confirmCancel()"
      >
        <div class="confirm-box__title">{{ confirmState.title }}</div>
        <div v-if="confirmState.message" class="confirm-box__msg">{{ confirmState.message }}</div>
        <div class="confirm-box__actions">
          <!-- UI 三批（组1）：本地 .confirm-btn 收敛为 BaseButton（取消=secondary、确认=primary、danger 确认=danger）；
               ref 用于组3 焦点管理（初始聚焦与 Tab 圈定的目标元素） -->
          <BaseButton ref="cancelBtnRef" variant="secondary" @click="confirmCancel()">{{ confirmState.cancelText }}</BaseButton>
          <BaseButton ref="confirmBtnRef" :variant="confirmState.danger ? 'danger' : 'primary'" @click="confirmAccept()">{{ confirmState.confirmText }}</BaseButton>
        </div>
      </div>
    </div>
  </transition>
</template>

<script setup lang="ts">
import { ref, watch, nextTick } from 'vue';
import { confirmState, confirmAccept, confirmCancel } from '../../composables/useConfirm';
import BaseButton from './BaseButton.vue';

/** 取消按钮组件实例（$el 即原生 button，焦点管理目标） */
const cancelBtnRef = ref<InstanceType<typeof BaseButton> | null>(null);
/** 确认按钮组件实例（$el 即原生 button，焦点管理目标） */
const confirmBtnRef = ref<InstanceType<typeof BaseButton> | null>(null);

/** 对话框打开瞬间记录触发元素（document.activeElement），关闭时把焦点归还给它 */
let triggerElement: HTMLElement | null = null;

/**
 * 取 BaseButton 实例根元素（原生 button）的窄化辅助。
 * @param inst BaseButton 组件实例或 null
 * @returns 底层 HTMLElement，实例未挂载时为 null
 */
function btnEl(inst: InstanceType<typeof BaseButton> | null): HTMLElement | null {
  return (inst?.$el as HTMLElement) ?? null;
}

// 组3 焦点管理：visible 跃迁时接管/归还焦点
watch(() => confirmState.visible, (visible) => {
  if (visible) {
    // 打开：先记住是谁触发的（多为面板里的删除/清空按钮）
    triggerElement = document.activeElement as HTMLElement | null;
    nextTick(() => {
      // 默认聚焦确认按钮；danger 时聚焦取消按钮更安全（避免回车直接触发破坏性操作）
      const target = confirmState.danger ? btnEl(cancelBtnRef.value) : btnEl(confirmBtnRef.value);
      target?.focus();
    });
  } else {
    // 关闭：焦点归还触发元素（仅当其仍在文档中——元素可能随操作被移除）
    if (triggerElement && document.contains(triggerElement)) {
      triggerElement.focus();
    }
    triggerElement = null;
  }
});

/**
 * Tab 圈定：对话框内只有两个操作按钮，
 * 手动在 cancel ↔ confirm 间循环，阻止焦点逃逸到遮罩后的面板内容。
 * @param e 键盘事件（.tab 修饰符已保证 key === 'Tab'）
 */
function trapFocus(e: KeyboardEvent): void {
  e.preventDefault();
  const cancelEl = btnEl(cancelBtnRef.value);
  const confirmEl = btnEl(confirmBtnRef.value);
  if (!cancelEl || !confirmEl) return;
  const active = document.activeElement;
  if (e.shiftKey) {
    // 反向：当前在取消 → 跳到确认，否则回到取消（两元素循环）
    (active === cancelEl ? confirmEl : cancelEl).focus();
  } else {
    // 正向：当前在确认 → 回到取消，否则前进到确认
    (active === confirmEl ? cancelEl : confirmEl).focus();
  }
}
</script>

<style scoped>
.confirm-mask {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.4);
  z-index: 9998;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}

.confirm-box {
  width: 100%;
  max-width: 300px;
  background: var(--sp-color-bg-elevated);
  border: 1px solid var(--sp-color-border-strong);
  border-radius: var(--sp-radius-lg);
  box-shadow: var(--sp-shadow-lg);
  padding: 16px;
}

.confirm-box__title {
  font-size: var(--sp-text-md);
  font-weight: 600;
  color: var(--sp-color-heading);
  margin-bottom: 6px;
}

.confirm-box__msg {
  font-size: var(--sp-text-sm);
  color: var(--sp-color-text-secondary);
  line-height: 1.5;
  margin-bottom: 14px;
}

.confirm-box__actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

/* UI 三批（组1）：.confirm-btn / .confirm-btn--danger 由 BaseButton
   （secondary / primary / danger）替代，本地分叉样式删除 */

.confirm-fade-enter-active, .confirm-fade-leave-active { transition: opacity var(--sp-transition-fast); }
.confirm-fade-enter-from, .confirm-fade-leave-to { opacity: 0; }
</style>
