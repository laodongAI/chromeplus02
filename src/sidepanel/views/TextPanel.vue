<template>
  <BaseCard title="文本抽取" subtitle="提取正文结构、留存划词高亮，导出 Markdown 或单文件归档" :padded="true">
    <RestrictedBanner v-if="restrictedHint" :message="restrictedHint" @close="restrictedHint = null" />

    <div class="toolbar">
      <BaseButton size="sm" variant="primary" :loading="loading" @click="scanText">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        提取文本
      </BaseButton>
      <BaseButton v-if="content" size="sm" variant="secondary" :loading="capturing" @click="addHighlight">留存选区</BaseButton>
      <BaseButton v-if="content" size="sm" variant="secondary" @click="copyJSON">复制 JSON</BaseButton>
      <BaseButton v-if="content" size="sm" variant="secondary" :loading="aiBusy" @click="runAiSummary">AI 摘要</BaseButton>
      <div class="toolbar__right">
        <span v-if="error && !restrictedHint" class="status status--error">{{ error }}</span>
        <span v-else-if="content" class="status">
          <span class="word-count">{{ content.wordCount }}</span> 字
        </span>
      </div>
    </div>

    <div v-if="content" class="export-bar">
      <BaseButton size="sm" variant="secondary" :loading="exporting === 'md'" :disabled="!!exporting" @click="exportMarkdown">导出 Markdown</BaseButton>
      <BaseButton size="sm" variant="secondary" :loading="exporting === 'html'" :disabled="!!exporting" @click="exportArchive">单文件归档</BaseButton>
      <BaseButton v-if="exporting === 'html'" size="sm" variant="ghost" @click="cancelArchive">停止内联</BaseButton>
      <label class="tpl-field">
        <span class="tpl-field__label">文件名模板</span>
        <input
          v-model="template"
          class="tpl-field__input"
          type="text"
          spellcheck="false"
          :placeholder="DEFAULT_TEMPLATE"
          aria-label="导出文件名模板"
          @change="persistTemplate"
        />
      </label>
      <span v-if="exportHint" class="export-hint">{{ exportHint }}</span>
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
          <span v-if="content.truncated" class="truncated-hint">已截断，全文 {{ content.wordCount }} 字</span>
          <BaseButton size="sm" variant="ghost" @click="copyBody">复制正文</BaseButton>
        </div>
        <pre class="preview-block__body">{{ content.textContent }}</pre>
      </div>

      <!-- 高亮与批注 -->
      <div class="preview-block">
        <div class="preview-block__header">
          <span class="preview-block__title">高亮与批注（{{ highlights.length }}）</span>
          <span v-if="highlights.length && locateStats.lost" class="truncated-hint">
            {{ locateStats.lost }} 条不在本次正文内，仅进批注清单
          </span>
          <BaseButton v-if="highlights.length" size="sm" variant="ghost" @click="confirmClearHighlights">清空本页</BaseButton>
        </div>
        <div v-if="highlights.length" class="hl-list">
          <div v-for="(h, i) in highlights" :key="h.id" class="hl-item">
            <div class="hl-item__head">
              <span class="hl-item__index">{{ i + 1 }}</span>
              <span class="hl-item__text">{{ h.anchor.exact }}</span>
              <BaseButton size="icon-sm" variant="ghost" aria-label="删除这条高亮" title="删除" @click="deleteHighlight(h.id)">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </BaseButton>
            </div>
            <input
              class="hl-item__note"
              type="text"
              :value="h.note"
              placeholder="批注（可留空）"
              :aria-label="`第 ${i + 1} 条高亮的批注`"
              @change="onNoteChange(h.id, $event)"
            />
          </div>
        </div>
        <div v-else class="hl-empty">在页面上选中文字后点「留存选区」，高亮按页面留存，导出时一并带走。</div>
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
import { computed, defineComponent, onMounted, ref } from 'vue';
import { aiSummarizePage } from '../services/aiAssist';
import { BaseButton, BaseCard, RestrictedBanner } from '../components/base';
import { getActiveTabInfo, sendMessageToTab } from '../utils/chromeMessaging';
import { isRestrictedPage, getRestrictedPageMessage } from '../../utils/restrictedPages';
import { toast } from '../composables/useToast';
import { confirmDialog } from '../composables/useConfirm';
import { MessageType, type TextContentDTO } from '@/messaging';
import { buildArchiveHtml, flattenBlocks } from '@/core/archive';
import type { StoredHighlight } from '@/core/textHighlight';
import {
  DEFAULT_TEMPLATE,
  buildArchiveMeta,
  buildMarkdown,
  captureHighlight,
  clearHighlights,
  countLocatable,
  docFilename,
  downloadText,
  inlineImages,
  loadHighlights,
  loadTemplate,
  removeHighlight,
  saveTemplate,
  toArchiveHighlights,
  updateHighlightNote
} from '../services/textArchive';

export default defineComponent({
  name: 'TextPanel',
  components: { BaseButton, BaseCard, RestrictedBanner },
  setup() {
    const content = ref<TextContentDTO | null>(null);
    const loading = ref(false);
    const error = ref<string | null>(null);
    const restrictedHint = ref<string | null>(null);

    const tabId = ref<number | null>(null);
    const pageUrl = ref('');
    const highlights = ref<StoredHighlight[]>([]);
    const capturing = ref(false);

    const template = ref(DEFAULT_TEMPLATE);
    const exporting = ref<'' | 'md' | 'html'>('');
    const exportHint = ref('');
    /** inlineImages 只认这个引用上的 cancelled，取消不必等当前那张图 fetch 完 */
    const archiveSignal = ref<{ cancelled: boolean }>({ cancelled: false });

    onMounted(async () => {
      try { template.value = await loadTemplate(); } catch { /* 存储不可用时用默认模板 */ }
    });

    /** 高亮偏移按全文算：textContent 可能只是前缀，用它定位会算错 */
    const fullText = computed(() => {
      const blocks = content.value?.blocks;
      return blocks?.length ? flattenBlocks(blocks).text : String(content.value?.textContent || '');
    });

    const locateStats = computed(() => countLocatable(content.value?.blocks || [], highlights.value));

    async function scanText() {
      loading.value = true;
      error.value = null;
      try {
        const info = await getActiveTabInfo();
        if (!info?.id) throw new Error('无法获取当前标签页');
        // 受限页面预检：扩展自身页面 / chrome:// / 应用店等不做注入尝试
        if (isRestrictedPage(info.url || info.pendingUrl)) {
          restrictedHint.value = getRestrictedPageMessage(info.url || info.pendingUrl) || '该页面不允许扩展注入内容脚本';
          return;
        }
        restrictedHint.value = null;
        const res = await sendMessageToTab<{ success: boolean; content?: TextContentDTO; error?: string }>(info.id, { type: MessageType.GET_TEXT_CONTENT });
        if (!res?.success || !res.content) throw new Error(res?.error || '提取失败');
        content.value = res.content;
        tabId.value = info.id;
        pageUrl.value = res.content.canonicalUrl || res.content.url || info.url || '';
        aiSummary.value = '';
        exportHint.value = '';
        highlights.value = await loadHighlights(pageUrl.value);
      } catch (e: any) {
        error.value = e?.message || '提取文本失败';
      } finally {
        loading.value = false;
      }
    }

    async function addHighlight() {
      if (!content.value || tabId.value == null || capturing.value) return;
      capturing.value = true;
      error.value = null;
      try {
        const res = await captureHighlight({
          tabId: tabId.value,
          fullText: fullText.value,
          url: pageUrl.value,
          title: content.value.title || '',
          list: highlights.value
        });
        if (!res.added) {
          error.value = res.reason || '留存选区失败';
          return;
        }
        highlights.value = res.list;
        const tail = res.dropped ? `，已达上限丢弃最早 ${res.dropped} 条` : '';
        toast.success(res.located ? `已留存选区${tail}` : `已留存选区（不在本次正文内，仅进批注清单）${tail}`);
      } catch (e: any) {
        error.value = e?.message || '留存选区失败';
      } finally {
        capturing.value = false;
      }
    }

    async function onNoteChange(id: string, ev: Event) {
      const note = (ev.target as HTMLInputElement | null)?.value ?? '';
      highlights.value = await updateHighlightNote(pageUrl.value, highlights.value, id, note);
    }

    async function deleteHighlight(id: string) {
      highlights.value = await removeHighlight(pageUrl.value, highlights.value, id);
    }

    async function confirmClearHighlights() {
      const ok = await confirmDialog({
        title: '清空本页高亮',
        message: `将删除本页留存的 ${highlights.value.length} 条高亮与批注，已导出的文件不受影响。`,
        danger: true,
        confirmText: '清空'
      });
      if (!ok) return;
      await clearHighlights(pageUrl.value);
      highlights.value = [];
    }

    async function persistTemplate() {
      await saveTemplate(template.value.trim() || DEFAULT_TEMPLATE);
      if (!template.value.trim()) template.value = DEFAULT_TEMPLATE;
    }

    function exportMarkdown() {
      if (!content.value || exporting.value) return;
      exporting.value = 'md';
      try {
        const md = buildMarkdown(content.value, highlights.value);
        const name = docFilename(content.value, 'md', template.value);
        downloadText(md, name, 'text/markdown');
        exportHint.value = `已下载 ${name}`;
        toast.success('Markdown 已导出');
      } catch (e: any) {
        error.value = e?.message || '导出 Markdown 失败';
      } finally {
        exporting.value = '';
      }
    }

    async function exportArchive() {
      if (!content.value || exporting.value) return;
      exporting.value = 'html';
      exportHint.value = '正在内联图片…';
      archiveSignal.value = { cancelled: false };
      try {
        const blocks = content.value.blocks || [];
        const { assets, skipped, failed } = await inlineImages(blocks, archiveSignal.value);
        const html = buildArchiveHtml(buildArchiveMeta(content.value), blocks, {
          assets,
          highlights: toArchiveHighlights(highlights.value)
        });
        const name = docFilename(content.value, 'html', template.value);
        downloadText(html, name, 'text/html');
        const inlined = Object.keys(assets).length;
        const parts = [`内联 ${inlined} 张`];
        if (skipped) parts.push(`跳过 ${skipped} 张`);
        if (failed) parts.push(`失败 ${failed} 张`);
        // 跳过/失败的图在归档里保留远程地址：离线打不开是哪几张，用户得知道
        exportHint.value = `已下载 ${name}（图片：${parts.join('，')}${skipped || failed ? '，未内联的保留原地址' : ''}）`;
        toast.success('单文件归档已导出');
      } catch (e: any) {
        error.value = e?.message || '导出归档失败';
        exportHint.value = '';
      } finally {
        exporting.value = '';
      }
    }

    function cancelArchive() {
      archiveSignal.value.cancelled = true;
      exportHint.value = '已停止内联，剩余图片保留原地址';
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

    return {
      DEFAULT_TEMPLATE,
      content, loading, error, restrictedHint, scanText,
      capturing, addHighlight, highlights, locateStats, onNoteChange, deleteHighlight, confirmClearHighlights,
      template, persistTemplate, exporting, exportHint, exportMarkdown, exportArchive, cancelArchive,
      copyJSON, copyBody, aiSummary, aiBusy, runAiSummary, copyAiSummary
    };
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

/* 导出行 */
.export-bar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 12px;
}

.tpl-field {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  margin-left: auto;
}

.tpl-field__label {
  font-size: 11px;
  color: var(--sp-color-muted);
  white-space: nowrap;
}

.tpl-field__input {
  width: 132px;
  min-height: 28px;
  padding: 0 8px;
  font-family: var(--sp-font-mono, monospace);
  font-size: 12px;
  color: var(--sp-color-text);
  background: var(--sp-color-surface);
  border: 1px solid var(--sp-color-border);
  border-radius: var(--sp-radius-sm);
}

.tpl-field__input:focus-visible {
  outline: 2px solid var(--sp-color-primary);
  outline-offset: 1px;
}

.export-hint {
  flex-basis: 100%;
  font-size: 11px;
  color: var(--sp-color-text-secondary);
  word-break: break-all;
}

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

.preview-block + .preview-block { margin-top: 10px; }

.preview-block__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
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

.truncated-hint {
  font-size: 11px;
  color: var(--sp-color-warning, var(--sp-color-muted));
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

/* 高亮清单 */
.hl-list {
  max-height: 280px;
  overflow-y: auto;
  background: var(--sp-color-surface);
}

.hl-item {
  padding: 8px 12px;
  border-bottom: 1px solid var(--sp-color-border);
}

.hl-item:last-child { border-bottom: none; }

.hl-item__head {
  display: flex;
  align-items: flex-start;
  gap: 6px;
}

.hl-item__index {
  flex-shrink: 0;
  min-width: 16px;
  font-size: 11px;
  font-weight: 600;
  color: var(--sp-color-muted);
}

.hl-item__text {
  flex: 1;
  font-size: 12px;
  line-height: 1.5;
  color: var(--sp-color-text);
  background: var(--sp-color-primary-light);
  border-radius: var(--sp-radius-xs);
  padding: 1px 4px;
  word-break: break-word;
}

.hl-item__note {
  width: 100%;
  margin-top: 5px;
  min-height: 26px;
  padding: 0 7px;
  font-size: 12px;
  color: var(--sp-color-text);
  background: var(--sp-color-bg-elevated);
  border: 1px solid var(--sp-color-border);
  border-radius: var(--sp-radius-sm);
}

.hl-item__note:focus-visible {
  outline: 2px solid var(--sp-color-primary);
  outline-offset: 1px;
}

.hl-empty {
  padding: 14px 12px;
  font-size: 12px;
  line-height: 1.5;
  color: var(--sp-color-muted);
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