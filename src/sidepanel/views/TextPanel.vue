<template>
  <BaseCard title="文本抽取" subtitle="提取页面正文、元数据与结构化信息" :padded="true">
    <div class="toolbar">
      <BaseButton size="sm" variant="primary" :loading="loading" @click="scanText">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        提取文本
      </BaseButton>
      <BaseButton v-if="content" size="sm" variant="secondary" @click="copyJSON">复制 JSON</BaseButton>
      <BaseButton v-if="content" size="sm" variant="secondary" :loading="aiBusy" @click="runAiSummary">AI 摘要</BaseButton>
      <div class="toolbar__right">
        <span v-if="error" class="status status--error">{{ error }}</span>
        <span v-else-if="content" class="status">
          <span class="word-count">{{ content.wordCount }}</span> 字
        </span>
      </div>
    </div>

    <div v-if="content" class="text-content">
      <!-- Meta cards -->
      <div class="meta-grid">
        <div v-if="content.title" class="meta-card">
          <div class="meta-card__label">标题</div>
          <div class="meta-card__value">{{ content.title }}</div>
        </div>
        <div v-if="content.author" class="meta-card">
          <div class="meta-card__label">作者</div>
          <div class="meta-card__value">{{ content.author }}</div>
        </div>
        <div v-if="content.description" class="meta-card meta-card--full">
          <div class="meta-card__label">描述</div>
          <div class="meta-card__value">{{ content.description }}</div>
        </div>
        <div v-if="content.keywords && content.keywords.length" class="meta-card meta-card--full">
          <div class="meta-card__label">关键词</div>
          <div class="meta-card__tags">
            <span v-for="k in content.keywords" :key="k" class="kw-tag">{{ k }}</span>
          </div>
        </div>
      </div>

      <!-- AI 摘要 -->
      <div v-if="aiSummary" class="preview-block">
        <div class="preview-block__header">
          <span class="preview-block__title">AI 摘要 / 关键词</span>
          <BaseButton size="sm" variant="ghost" @click="copyAiSummary">复制</BaseButton>
        </div>
        <pre class="preview-block__body">{{ aiSummary }}</pre>
      </div>

      <!-- Body preview -->
      <div class="preview-block">
        <div class="preview-block__header">
          <span class="preview-block__title">正文预览</span>
          <BaseButton size="sm" variant="ghost" @click="copyBody">复制正文</BaseButton>
        </div>
        <pre class="preview-block__body">{{ content.textContent }}</pre>
      </div>
    </div>

    <div v-else-if="!loading" class="empty-state">
      <div class="empty-state__icon">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
      </div>
      <div class="empty-state__text">点击"提取文本"开始分析当前页面</div>
    </div>
  </BaseCard>
</template>

<script lang="ts">
import { defineComponent, ref } from 'vue';
import { aiSummarizePage } from '../services/aiAssist';
import { BaseButton, BaseCard, BaseTag } from '../components/base';
import { getActiveTabInfo, sendMessageToTab } from '../utils/chromeMessaging';
import { MessageType, type TextContentDTO } from '@/messaging';

export default defineComponent({
  name: 'TextPanel',
  components: { BaseButton, BaseCard, BaseTag },
  setup() {
    const content = ref<TextContentDTO | null>(null);
    const loading = ref(false);
    const error = ref<string | null>(null);

    async function scanText() {
      loading.value = true;
      error.value = null;
      try {
        const info = await getActiveTabInfo();
        if (!info?.id) throw new Error('无法获取当前标签页');
        const res = await sendMessageToTab<{ success: boolean; content?: TextContentDTO; error?: string }>(info.id, { type: MessageType.GET_TEXT_CONTENT });
        if (!res?.success || !res.content) throw new Error(res?.error || '提取失败');
        content.value = res.content;
      } catch (e: any) {
        error.value = e?.message || '提取文本失败';
      } finally {
        loading.value = false;
      }
    }

    function copyJSON() {
      if (!content.value) return;
      navigator.clipboard.writeText(JSON.stringify(content.value, null, 2)).catch(() => {});
    }

    function copyBody() {
      if (!content.value?.textContent) return;
      navigator.clipboard.writeText(content.value.textContent).catch(() => {});
    }

    const aiSummary = ref('');
    const aiBusy = ref(false);
    async function runAiSummary() {
      if (!content.value?.textContent || aiBusy.value) return;
      aiBusy.value = true; aiSummary.value = '';
      try {
        aiSummary.value = await aiSummarizePage(content.value.title || '', content.value.textContent);
      } catch (e: any) {
        aiSummary.value = '⚠ ' + (e?.message || 'AI 请求失败');
      } finally { aiBusy.value = false; }
    }
    function copyAiSummary() {
      if (aiSummary.value) navigator.clipboard.writeText(aiSummary.value).catch(() => {});
    }

    return { content, loading, error, scanText, copyJSON, copyBody, aiSummary, aiBusy, runAiSummary, copyAiSummary };
  }
});
</script>

<style scoped>
.toolbar {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 14px;
}

.toolbar__right { margin-left: auto; }

.status { font-size: 11px; color: var(--sp-color-muted); }
.status--error { color: var(--sp-color-danger); }
.word-count { font-weight: 600; color: var(--sp-color-text); }

/* Meta grid */
.meta-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px;
  margin-bottom: 12px;
}

.meta-card {
  background: var(--sp-color-surface);
  border: 1px solid var(--sp-color-border);
  border-radius: var(--sp-radius-md);
  padding: 8px 10px;
}

.meta-card--full { grid-column: 1 / -1; }

.meta-card__label {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.07em;
  font-weight: 600;
  color: var(--sp-color-muted);
  margin-bottom: 3px;
}

.meta-card__value {
  font-size: 12px;
  color: var(--sp-color-text);
  line-height: 1.4;
  word-break: break-word;
}

.meta-card__tags {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.kw-tag {
  font-size: 11px;
  padding: 2px 7px;
  background: var(--sp-color-primary-light);
  color: var(--sp-color-primary);
  border-radius: 999px;
  border: 1px solid var(--sp-color-primary-light);
}

/* Preview */
.preview-block {
  border: 1px solid var(--sp-color-border);
  border-radius: var(--sp-radius-lg);
  overflow: hidden;
}

.preview-block__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  background: var(--sp-color-bg-elevated);
  border-bottom: 1px solid var(--sp-color-border);
}

.preview-block__title {
  font-size: 11px;
  font-weight: 600;
  color: var(--sp-color-text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.preview-block__body {
  margin: 0;
  padding: 12px;
  font-family: var(--sp-font-mono, monospace);
  font-size: 11px;
  color: var(--sp-color-text);
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 320px;
  overflow-y: auto;
  background: var(--sp-color-surface);
}

/* Empty */
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  padding: 40px 20px;
  color: var(--sp-color-muted);
}

.empty-state__icon {
  width: 44px;
  height: 44px;
  border-radius: 12px;
  background: var(--sp-color-surface);
  display: flex;
  align-items: center;
  justify-content: center;
}

.empty-state__text {
  font-size: 12px;
  color: var(--sp-color-text-secondary);
  text-align: center;
}
</style>
