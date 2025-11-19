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
import { sendRuntimeMessage } from '../utils/chromeMessaging';
import { MessageType } from '@/messaging';

interface ExtensionSettings { namingTemplate: string; autoScan: boolean; maxConcurrent: number }

function loadSettings(): Promise<ExtensionSettings> {
  return new Promise(resolve => {
    try {
      chrome.storage.local.get('global_settings_v1', res => {
        const raw = res?.global_settings_v1 || {};
        resolve({
          namingTemplate: raw.namingTemplate || '{site}_{title}_{datetime}',
          autoScan: typeof raw.autoScan === 'boolean' ? raw.autoScan : false,
          maxConcurrent: typeof raw.maxConcurrent === 'number' ? raw.maxConcurrent : 3
        });
      });
    } catch { resolve({ namingTemplate: '{site}_{title}_{datetime}', autoScan: false, maxConcurrent: 3 }); }
  });
}

async function saveSettings(s: ExtensionSettings) {
  try {
    chrome.storage.local.set({ global_settings_v1: { ...s } });
    // 通知后台更新运行时参数
    await sendRuntimeMessage({ type:  MessageType.SETTINGS_UPDATE, payload: { namingTemplate: s.namingTemplate, autoScan: s.autoScan, maxConcurrent: s.maxConcurrent } });
  } catch { /* noop */ }
}

export default defineComponent({
  name: 'SettingsPanel',
  components: { BaseCard, FormField },
  setup() {
    const state = reactive<ExtensionSettings>({ namingTemplate: '{site}_{title}_{datetime}', autoScan: false, maxConcurrent: 3 });
    loadSettings().then(s => { Object.assign(state, s); });

    let saveTimer: number | null = null;
    watch(state, () => {
      if (saveTimer) window.clearTimeout(saveTimer);
      saveTimer = window.setTimeout(() => { saveSettings(state); saveTimer = null; }, 400);
    }, { deep: true });

    const previewFilename = computed(() => {
      const docTitle = document.title || 'page';
      const site = (() => { try { return new URL(location.href).hostname.replace(/^www\./,''); } catch { return 'site'; } })();
      return formatFilename(state.namingTemplate, { site, title: docTitle.slice(0,40), index: 1 });
    });

    return { state, previewFilename };
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
</style>
