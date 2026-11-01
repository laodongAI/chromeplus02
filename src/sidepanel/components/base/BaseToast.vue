<template>
  <div class="toast-stack" aria-live="polite">
    <transition-group name="toast">
      <div v-for="t in toastState.list" :key="t.id" class="toast" :class="`toast--${t.type}`" role="status">
        <svg v-if="t.type === 'success'" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
        <svg v-else-if="t.type === 'error'" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
        <svg v-else width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
        <span class="toast__msg">{{ t.message }}</span>
      </div>
    </transition-group>
  </div>
</template>

<script setup lang="ts">
import { toastState } from '../../composables/useToast';
</script>

<style scoped>
.toast-stack {
  position: fixed;
  top: 12px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 9999;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  pointer-events: none;
  width: calc(100% - 24px);
}

.toast {
  display: flex;
  align-items: center;
  gap: 6px;
  max-width: 100%;
  padding: 7px 12px;
  border-radius: var(--sp-radius-md);
  font-size: var(--sp-text-sm);
  font-weight: 500;
  background: var(--sp-color-bg-elevated);
  border: 1px solid var(--sp-color-border-strong);
  box-shadow: var(--sp-shadow-md);
  color: var(--sp-color-text);
}

.toast--success { border-color: var(--sp-color-success); color: var(--sp-color-success); }
.toast--error { border-color: var(--sp-color-danger); color: var(--sp-color-danger); }
.toast--info { border-color: var(--sp-color-primary); color: var(--sp-color-primary); }

.toast-enter-active, .toast-leave-active { transition: all var(--sp-transition-base); }
.toast-enter-from, .toast-leave-to { opacity: 0; transform: translateY(-8px); }
</style>
