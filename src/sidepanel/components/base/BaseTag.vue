<template>
  <!-- UI 三批（组1）：全站唯一状态徽标实现。
       各面板不再各自抄写 .chip/.chip--success/.dup-badge/.chip-green 等分叉样式，
       统一用 variant 选语义色、size 选尺寸（sm 即原紧凑状态 chip 形态）。 -->
  <span class="base-tag" :class="[`base-tag--${variant}`, `base-tag--${size}`]">
    <slot />
  </span>
</template>

<script setup lang="ts">
/**
 * 状态徽标 Props。
 * variant：neutral/success/warning/danger/info 五档语义色（与 tokens 一一对应）。
 * size：sm=行内紧凑状态徽标（已下载/未下载/重复/已完成），默认 md=大写标注徽章。
 */
withDefaults(defineProps<{
  variant?: 'neutral' | 'success' | 'warning' | 'danger' | 'info';
  size?: 'sm' | 'md';
}>(), {
  variant: 'neutral',
  size: 'md',
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

/* 紧凑状态徽标（原各面板 .chip 的形态）：
   UI 三批（组2）状态文字属正文级，字号 12px（不再用 11px） */
.base-tag--sm {
  padding: 1px 7px;
  font-size: 12px;
  font-weight: 600;
  text-transform: none;
  letter-spacing: 0;
  border-color: var(--sp-color-border);
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
