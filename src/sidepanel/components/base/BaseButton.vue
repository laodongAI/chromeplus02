<template>
  <button
    class="base-button"
    :class="[`base-button--${variant}`, `base-button--${size}`, { 'is-block': block, 'is-loading': loading }]"
    :disabled="disabled || loading"
    v-bind="$attrs"
  >
    <span v-if="loading" class="base-button__spinner" aria-hidden="true"></span>
    <span class="base-button__label"><slot /></span>
  </button>
</template>

<script setup lang="ts">
interface Props {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md';
  block?: boolean;
  disabled?: boolean;
  loading?: boolean;
}
withDefaults(defineProps<Props>(), { variant:'primary', size:'md', block:false, disabled:false, loading:false });
</script>

<style scoped>
.base-button {
  position: relative;
  display: inline-flex; align-items: center; justify-content: center;
  gap: 5px; border: 1px solid transparent;
  border-radius: var(--sp-radius-md);
  font-family: var(--sp-font-family);
  font-weight: 500; line-height: 1; cursor: pointer;
  transition: all var(--sp-transition-fast);
  white-space: nowrap; user-select: none;
}
.base-button:focus-visible { outline: 2px solid var(--sp-color-primary); outline-offset: 2px; }

.base-button--sm { min-height: 28px; padding: 0 10px; font-size: 11px; border-radius: var(--sp-radius-sm); }
.base-button--md { min-height: 32px; padding: 0 14px; font-size: 12px; }
.base-button.is-block { width: 100%; }

/* Primary */
.base-button--primary {
  background: var(--sp-color-primary); color: white; border-color: transparent;
  box-shadow: 0 1px 3px rgba(99,102,241,0.3);
}
.base-button--primary:hover:not(:disabled) {
  background: var(--sp-color-primary-hover);
  box-shadow: 0 2px 6px rgba(99,102,241,0.4); transform: translateY(-1px);
}
.base-button--primary:active:not(:disabled) { transform: translateY(0); background: var(--sp-color-primary-active); }

/* Secondary */
.base-button--secondary {
  background: var(--sp-color-bg-elevated);
  border-color: var(--sp-color-border-strong);
  color: var(--sp-color-text);
  box-shadow: var(--sp-shadow-sm);
}
.base-button--secondary:hover:not(:disabled) {
  background: var(--sp-color-surface);
  border-color: var(--sp-color-border-hover);
  color: var(--sp-color-heading);
}

/* Ghost */
.base-button--ghost {
  background: transparent; border-color: transparent;
  color: var(--sp-color-text-secondary);
}
.base-button--ghost:hover:not(:disabled) {
  background: var(--sp-color-surface); color: var(--sp-color-text);
}

/* Danger */
.base-button--danger {
  background: var(--sp-color-danger-light);
  border-color: rgba(239,68,68,0.25);
  color: var(--sp-color-danger);
}
.base-button--danger:hover:not(:disabled) {
  background: var(--sp-color-danger); color: white; border-color: transparent;
}

.base-button:disabled { opacity: 0.45; cursor: not-allowed; }

/* Spinner */
.base-button__spinner {
  width: 11px; height: 11px; border-radius: 50%;
  border: 1.5px solid rgba(0,0,0,0.12);
  border-top-color: currentColor;
  animation: spin 0.7s linear infinite; flex-shrink: 0;
}
.base-button--primary .base-button__spinner { border-color: rgba(255,255,255,0.3); border-top-color: white; }
.base-button.is-loading .base-button__label { opacity: 0.7; }
@keyframes spin { to { transform: rotate(360deg); } }
</style>
