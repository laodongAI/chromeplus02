<template>
  <!-- UI 三批（组1）：错误提示横幅的唯一实现。
       原录屏面板（danger 红）与资源包面板（⚠️ emoji）各抄一份且色彩分叉，
       统一为 danger 语义（错误=红，警示=黄由 RestrictedBanner 承担）。
       组3：关闭按钮补 aria-label；emoji 图标换成内联 SVG。 -->
  <div v-if="message" class="error-banner" :class="`error-banner--${tone}`" role="alert">
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" class="banner-icon" aria-hidden="true">
      <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
    </svg>
    <div class="error-banner__body">
      <div v-if="title" class="error-banner__title">{{ title }}</div>
      <div class="error-banner__msg">{{ message }}</div>
    </div>
    <button v-if="closable" class="banner-close" type="button" aria-label="关闭提示" title="关闭提示" @click="$emit('close')">
      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
    </button>
  </div>
</template>

<script setup lang="ts">
/**
 * 提示横幅 Props。
 * message：正文（必填语义，为空时整个横幅不渲染）。
 * title：可选标题行（如"操作失败"），缺省只显示正文。
 * closable：是否显示关闭按钮（默认显示）。
 * tone：danger=操作失败（红），warning=操作成功但有缺失（黄）。
 *       两种语义共用同一实现，避免各面板再抄一份黄色横幅。
 */
withDefaults(defineProps<{
  message: string;
  title?: string;
  closable?: boolean;
  tone?: 'danger' | 'warning';
}>(), {
  title: '',
  closable: true,
  tone: 'danger',
});

/** 点击关闭时通知父面板清空错误状态 */
defineEmits<{ (e: 'close'): void }>();
</script>

<style scoped>
.error-banner {
  display: flex;
  align-items: flex-start;
  gap: 7px;
  margin: 8px 0 10px;
  padding: 9px 11px;
  background: var(--sp-color-danger-light);
  border: 1px solid rgba(239, 68, 68, 0.25);
  border-radius: var(--sp-radius-md);
  color: var(--sp-color-danger);
  /* 组2：错误信息属正文级文字，11px → 12px */
  font-size: 12px;
  line-height: 1.4;
}
.error-banner__body { flex: 1; min-width: 0; }
.error-banner__title { font-weight: 600; margin-bottom: 2px; }
.error-banner__msg { word-break: break-all; }
.error-banner--warning {
  background: var(--sp-color-warning-light);
  border-color: rgba(245, 158, 11, 0.28);
  color: var(--sp-color-warning);
}
.error-banner--warning .banner-close { color: var(--sp-color-warning); }
.banner-icon { flex-shrink: 0; margin-top: 1px; }
.banner-close {
  background: none; border: none; cursor: pointer;
  color: var(--sp-color-danger); opacity: 0.6;
  /* 组3：触控目标 ≥24px */
  min-width: 24px; min-height: 24px;
  display: flex; align-items: center; justify-content: center;
  flex-shrink: 0;
  transition: opacity var(--sp-transition-fast);
}
.banner-close:hover { opacity: 1; }
</style>
