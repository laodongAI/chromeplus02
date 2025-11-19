<template>
  <BaseCard title="系统设置" subtitle="统一配置扫描、命名与并发" padded>
    <form class="settings-form" @submit.prevent>
      <FormField label="自动扫描" hint="打开后将尝试增量发现新增资源" meta="autoScan">
        <input type="checkbox" v-model="state.autoScan" />
      </FormField>
      <FormField label="命名模板" hint="支持变量: {site} {title} {date} {time} {datetime} {index}" meta="namingTemplate">
        <input type="text" v-model="state.namingTemplate" placeholder="{site}_{title}_{datetime}" />
      </FormField>
      <FormField label="并发上限" hint="下载同时进行的最大任务数 (1-10)" meta="maxConcurrent">
        <input type="number" min="1" max="10" v-model.number="state.maxConcurrent" />
      </FormField>
      <div class="preview-block">
        <span class="preview-label">预览文件名:</span>
        <code class="preview-value">{{ previewFilename }}</code>
      </div>
    </form>
  </BaseCard>
</template>

<script lang="ts">
import { defineComponent, reactive, computed, watch } from 'vue';
import { BaseCard, FormField } from '../components/base';
import { formatFilename } from '@/utils/format';
import { loadSettings, saveSettings, type ExtensionSettings } from '../services/settings';
import { sendRuntimeMessage } from '../utils/chromeMessaging';
import { MessageType } from '@/messaging';

// 增强：添加显式“立即保存”按钮与重置功能，避免用户疑惑自动保存时机。
// 统一使用 services/settings.ts 中的加载与保存逻辑，减少重复代码。

export default defineComponent({
  name: 'SettingsPanel',
  components: { BaseCard, FormField },
  setup() {
    const state = reactive<ExtensionSettings>({ namingTemplate: '{site}_{title}_{datetime}', autoScan: false, maxConcurrent: 3 });
    loadSettings().then(s => { Object.assign(state, s); });

    let saveTimer: number | null = null;
    watch(state, () => {
      if (saveTimer) window.clearTimeout(saveTimer);
      // 防抖自动保存
      saveTimer = window.setTimeout(() => { saveSettings(state); saveTimer = null; }, 400);
    }, { deep: true });

    function immediateSave(){
      if (saveTimer) { window.clearTimeout(saveTimer); saveTimer = null; }
      saveSettings(state);
    }

    function resetToDefault(){
      state.namingTemplate = '{site}_{title}_{datetime}';
      state.autoScan = false;
      state.maxConcurrent = 3;
      immediateSave();
    }

    const previewFilename = computed(() => {
      const docTitle = document.title || 'page';
      const site = (() => { try { return new URL(location.href).hostname.replace(/^www\./,''); } catch { return 'site'; } })();
      return formatFilename(state.namingTemplate, { site, title: docTitle.slice(0,40), index: 1 });
    });

    return { state, previewFilename, immediateSave, resetToDefault };
  }
});
</script>

<style scoped>
.settings-form {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.preview-block {
  display: flex;
  flex-direction: column;
  font-size: 12px;
  gap: 6px;
  background: rgba(255,255,255,0.04);
  padding: 10px 12px;
  border-radius: var(--sp-radius-sm);
}
.preview-label { color: var(--sp-color-muted); }
.preview-value { color: var(--sp-color-heading); word-break: break-all; }
.settings-actions { display:flex; gap:8px; margin-top:8px; }
.settings-actions button { background:#203347; color:#cdd9e5; border:1px solid #335578; padding:4px 10px; font-size:12px; border-radius:4px; cursor:pointer; }
.settings-actions button:hover { background:#2a4461; }
.settings-actions button:active { background:#183246; }
</style>
