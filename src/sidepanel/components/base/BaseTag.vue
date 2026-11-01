<template>
  <span class="base-tag" :class="`base-tag--${variant}`">
    <slot />
  </span>
</template>

<script setup lang="ts">
withDefaults(defineProps<{ variant?: 'neutral' | 'success' | 'warning' | 'danger' | 'info' }>(), {
  variant: 'neutral'
});
</script>

<style scoped>
.base-tag {
  display: inline-flex;
  align-items: center;
  gap: var(--sp-spacing-1);
  padding: 4px 10px;
  border-radius: var(--sp-radius-full);
  font-size: var(--sp-text-xs);
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  border: 1px solid transparent;
}

.base-tag--neutral {
  background: var(--sp-color-bg-subtle);
  color: var(--sp-color-muted);
  border-color: var(--sp-color-border);
}

.base-tag--success {
  background: var(--sp-color-success-light);
  color: var(--sp-color-success);
  border-color: rgba(16, 185, 129, 0.3);
}

.base-tag--warning {
  background: var(--sp-color-warning-light);
  color: var(--sp-color-warning);
  border-color: rgba(245, 158, 11, 0.3);
}

.base-tag--danger {
  background: var(--sp-color-danger-light);
  color: var(--sp-color-danger);
  border-color: rgba(239, 68, 68, 0.3);
}

.base-tag--info {
  background: var(--sp-color-primary-light);
  color: var(--sp-color-primary);
  border-color: rgba(59, 130, 246, 0.3);
}
</style>
