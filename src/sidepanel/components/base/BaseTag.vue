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
  gap: 4px;
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  border: 1px solid transparent;
}

.base-tag--neutral { background: rgba(148, 163, 184, 0.15); color: var(--sp-color-muted); }
.base-tag--success { background: rgba(61, 213, 152, 0.12); color: var(--sp-color-success); border-color: rgba(61, 213, 152, 0.4); }
.base-tag--warning { background: rgba(246, 195, 67, 0.12); color: var(--sp-color-warning); border-color: rgba(246, 195, 67, 0.4); }
.base-tag--danger { background: rgba(248, 113, 113, 0.12); color: var(--sp-color-danger); border-color: rgba(248, 113, 113, 0.4); }
.base-tag--info { background: rgba(79, 156, 255, 0.12); color: var(--sp-color-primary); border-color: rgba(79, 156, 255, 0.4); }
</style>
