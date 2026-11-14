<template>
  <!-- UI 三批（组1）：受限页面提示横幅的唯一实现。
       原图像/音频/视频三个面板各抄一份 .restricted-banner 且已分叉，
       现统一为本组件；各面板的文案差异通过 message/hint props 传入。
       组3：关闭按钮补 aria-label（纯图标按钮必须有可读名称）。 -->
  <div v-if="message" class="restricted-banner" role="status">
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="banner-icon" aria-hidden="true">
      <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
    </svg>
    <span class="banner-text">{{ message }}<em v-if="hint" class="banner-hint">{{ hint }}</em></span>
    <button class="banner-close" type="button" aria-label="关闭受限页面提示" title="关闭提示" @click="$emit('close')">
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
    </button>
  </div>
</template>

<script setup lang="ts">
/**
 * 受限页面横幅 Props。
 * message：主提示文案（各面板保留自身差异文案，如"当前页面受限…"）。
 * hint：主文案下方的补充引导行（默认建议切回普通网页），传空字符串则不渲染。
 */
withDefaults(defineProps<{
  /** 主提示文案 */
  message: string;
  /** 补充引导文案（可缺省） */
  hint?: string;
}>(), {
  hint: '请切换到普通网页后再试。',
});

/** 点击关闭按钮时向父面板发出（父面板负责清空自身 restrictedHint 状态） */
defineEmits<{ (e: 'close'): void }>();
</script>

<style scoped>
/* 警示黄横幅：色彩全部走 token，深浅主题随动 */
.restricted-banner {
  display: flex;
  align-items: flex-start;
  gap: 7px;
  margin-bottom: 10px;
  padding: 8px 10px;
  border-radius: var(--sp-radius-md);
  background: var(--sp-color-warning-light);
  border: 1px solid rgba(245, 158, 11, 0.25);
  color: var(--sp-color-warning);
  /* 组2：横幅文字属信息性内容，字号提到正文级最小值 12px */
  font-size: 12px;
  line-height: 1.4;
}
.restricted-banner span { flex: 1; }
.banner-close {
  background: none;
  border: none;
  cursor: pointer;
  color: var(--sp-color-warning);
  opacity: 0.6;
  /* 组3：触控目标 ≥24px（视觉仍是 11px 图标，用尺寸+居中扩展可点区） */
  min-width: 24px;
  min-height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  transition: opacity var(--sp-transition-fast);
}
.banner-close:hover { opacity: 1; }
.banner-icon { flex-shrink: 0; margin-top: 1px; }
.banner-hint {
  display: block;
  font-style: normal;
  font-size: 11px;
  opacity: 0.85;
  margin-top: 2px;
}
</style>
