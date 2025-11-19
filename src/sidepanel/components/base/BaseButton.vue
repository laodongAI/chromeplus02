<template>
  <button
    class="base-button"
    :class="[
      `base-button--${variant}`,
      `base-button--${size}`,
      { 'is-block': block, 'is-loading': loading }
    ]"
    :disabled="disabled || loading"
    v-bind="$attrs"
  >
    <span v-if="loading" class="base-button__spinner" aria-hidden="true"></span>
    <span class="base-button__label">
      <slot />
    </span>
  </button>
</template>

<script setup lang="ts">
import { computed } from 'vue';

interface Props {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md';
  block?: boolean;
  disabled?: boolean;
  loading?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  variant: 'primary',
  size: 'md',
  block: false,
  disabled: false,
  loading: false
});

const variant = computed(() => props.variant);
const size = computed(() => props.size);
const block = computed(() => props.block);
const disabled = computed(() => props.disabled);
const loading = computed(() => props.loading);
</script>

<style scoped>
.base-button {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  border: 1px solid transparent;
  border-radius: var(--sp-radius-sm);
  font-weight: 600;
  font-size: 14px;
  line-height: 1;
  cursor: pointer;
  transition: background var(--sp-transition-fast), border-color var(--sp-transition-fast), color var(--sp-transition-fast);
  min-height: 36px;
  padding: 0 var(--sp-spacing-4);
  color: var(--sp-color-heading);
  background: var(--sp-color-primary);
  box-shadow: 0 4px 16px rgba(79, 156, 255, 0.2);
}

.base-button:disabled {
  opacity: 0.6;
  cursor: not-allowed;
  box-shadow: none;
}

.base-button--secondary {
  background: var(--sp-color-surface);
  border-color: var(--sp-color-border);
  color: var(--sp-color-text);
}

.base-button--ghost {
  background: transparent;
  border-color: transparent;
  color: var(--sp-color-muted);
}

.base-button--danger {
  background: var(--sp-color-danger);
  box-shadow: 0 4px 16px rgba(248, 113, 113, 0.2);
}

.base-button--sm {
  min-height: 30px;
  padding: 0 var(--sp-spacing-3);
  font-size: 13px;
}

.base-button--md {
  min-height: 40px;
}

.base-button.is-block {
  width: 100%;
}

.base-button__spinner {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  border: 2px solid rgba(255, 255, 255, 0.4);
  border-top-color: #fff;
  animation: spin 0.7s linear infinite;
}

@keyframes spin {
  0% { transform: rotate(0deg); }
  100% { transform: rotate(360deg); }
}
</style>
