<template>
  <!-- UI 三批（组1）：全站唯一按钮实现。
       录屏/设置/下载条等面板不再各自手写 .start-btn/.btn-save/.gdl-btn 同义按钮，
       需要的尺寸（xs/icon）与色调（outline/success/warning）一律在本组件内扩展。
       aria-label / title 等可访问性属性通过 $attrs 透传给原生 button。 -->
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
/**
 * 通用按钮组件 Props。
 * variant 语义（UI 三批·组1 色彩语义纠正）：
 *  - primary  主操作（开始录制、保存、批量下载）
 *  - danger   破坏/停止类操作（停止录制、删除、清除）
 *  - outline  主色描边（低强调但需要引导的操作，如"测试连接"）
 *  - success / warning  队列恢复/重试等带语义色的轻量操作
 * size：xs=24px 高（下载条等紧凑行内操作，满足 ≥24px 触控目标）；
 *       icon/icon-sm=纯图标方形按钮（必须传 aria-label 提供可读名称）。
 */
interface Props {
  /** 视觉/语义变体 */
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'outline' | 'success' | 'warning';
  /** 尺寸：xs(24px) / sm(28px) / md(32px) / icon(28px 方形) / icon-sm(24px 方形) */
  size?: 'xs' | 'sm' | 'md' | 'icon' | 'icon-sm';
  /** 块级：占满父容器宽度 */
  block?: boolean;
  /** 禁用态 */
  disabled?: boolean;
  /** 加载中：显示 spinner 并禁用 */
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

/* UI 三批（组2）：正文级最小字号 11px → 12px（按钮属正文级交互文字） */
.base-button--xs { min-height: 24px; padding: 0 8px; font-size: 12px; border-radius: var(--sp-radius-xs); }
.base-button--sm { min-height: 28px; padding: 0 10px; font-size: 12px; border-radius: var(--sp-radius-sm); }
.base-button--md { min-height: 32px; padding: 0 14px; font-size: 12px; }
/* 纯图标方形尺寸：28/24px 触控目标（组3 触控目标 ≥24px） */
.base-button--icon { width: 28px; height: 28px; padding: 0; font-size: 12px; border-radius: var(--sp-radius-sm); }
.base-button--icon-sm { width: 24px; height: 24px; padding: 0; font-size: 12px; border-radius: var(--sp-radius-xs); }
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

/* Danger（软危险：底色浅红，悬停转实心，用于删除/清除/停止） */
.base-button--danger {
  background: var(--sp-color-danger-light);
  border-color: rgba(239,68,68,0.25);
  color: var(--sp-color-danger);
}
.base-button--danger:hover:not(:disabled) {
  background: var(--sp-color-danger); color: white; border-color: transparent;
}

/* Outline（主色描边：低强调引导操作，如"测试连接"，收编原 SettingsPanel .btn-test） */
.base-button--outline {
  background: var(--sp-color-primary-light);
  border-color: var(--sp-color-primary);
  color: var(--sp-color-primary);
}
.base-button--outline:hover:not(:disabled) {
  background: var(--sp-color-primary); color: white;
}

/* Success（成功色描边：队列"继续"，收编原下载条 .gdl-btn--resume） */
.base-button--success {
  background: var(--sp-color-success-light);
  border-color: rgba(16,185,129,0.3);
  color: var(--sp-color-success);
}
.base-button--success:hover:not(:disabled) {
  background: var(--sp-color-success); color: white; border-color: transparent;
}

/* Warning（警示色描边：队列"重试"，收编原下载条 .gdl-btn--retry） */
.base-button--warning {
  background: var(--sp-color-warning-light);
  border-color: rgba(245,158,11,0.3);
  color: var(--sp-color-warning);
}
.base-button--warning:hover:not(:disabled) {
  background: var(--sp-color-warning); color: white; border-color: transparent;
}

.base-button:disabled { opacity: 0.45; cursor: not-allowed; }

/* Spinner */
.base-button__spinner {
  width: 11px; height: 11px; border-radius: 50%;
  border: 1.5px solid rgba(0,0,0,0.12);
  border-top-color: currentColor;
  animation: spin 0.7s linear infinite; flex-shrink: 0;
}
.base-button--primary .base-button__spinner,
.base-button--danger .base-button__spinner,
.base-button--success .base-button__spinner,
.base-button--warning .base-button__spinner { border-color: rgba(255,255,255,0.3); border-top-color: white; }
.base-button.is-loading .base-button__label { opacity: 0.7; }
@keyframes spin { to { transform: rotate(360deg); } }
</style>
