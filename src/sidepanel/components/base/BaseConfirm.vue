<template>
  <transition name="confirm-fade">
    <div v-if="confirmState.visible" class="confirm-mask" @click.self="confirmCancel()">
      <div class="confirm-box" role="alertdialog" :aria-label="confirmState.title">
        <div class="confirm-box__title">{{ confirmState.title }}</div>
        <div v-if="confirmState.message" class="confirm-box__msg">{{ confirmState.message }}</div>
        <div class="confirm-box__actions">
          <button class="confirm-btn" @click="confirmCancel()">{{ confirmState.cancelText }}</button>
          <button class="confirm-btn" :class="{ 'confirm-btn--danger': confirmState.danger }" @click="confirmAccept()">{{ confirmState.confirmText }}</button>
        </div>
      </div>
    </div>
  </transition>
</template>

<script setup lang="ts">
import { confirmState, confirmAccept, confirmCancel } from '../../composables/useConfirm';
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

.confirm-btn {
  padding: 6px 14px;
  border-radius: var(--sp-radius-sm);
  border: 1px solid var(--sp-color-border-strong);
  background: var(--sp-color-bg-elevated);
  color: var(--sp-color-text);
  font-size: var(--sp-text-sm);
  font-weight: 500;
  cursor: pointer;
  font-family: var(--sp-font-family);
  transition: all var(--sp-transition-fast);
}
.confirm-btn:hover { background: var(--sp-color-surface); }

.confirm-btn--danger {
  background: var(--sp-color-danger);
  border-color: var(--sp-color-danger);
  color: #fff;
}
.confirm-btn--danger:hover { filter: brightness(1.08); background: var(--sp-color-danger); }

.confirm-fade-enter-active, .confirm-fade-leave-active { transition: opacity var(--sp-transition-fast); }
.confirm-fade-enter-from, .confirm-fade-leave-to { opacity: 0; }
</style>
