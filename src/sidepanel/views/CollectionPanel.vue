<template>
  <BaseCard title="收集篮" subtitle="跨页面暂存的资源，统一下载或导出" padded>
    <div class="filter-row">
      <select v-model="filterKind" class="sp-select">
        <option value="all">全部类型</option>
        <option value="video">视频</option>
        <option value="audio">音频</option>
        <option value="image">图片</option>
      </select>
      <div class="filter-row__right">
        <BaseButton size="sm" variant="ghost" :disabled="!displayList.length" @click="exportCsv">导出CSV</BaseButton>
        <BaseButton size="sm" variant="ghost" :disabled="!displayList.length" @click="exportJson">导出JSON</BaseButton>
        <BaseButton size="sm" variant="ghost" :disabled="!displayList.length" @click="onClear">清空</BaseButton>
        <BaseButton size="sm" :disabled="!selectedCount" @click="downloadSelected">下载选中 ({{ selectedCount }})</BaseButton>
      </div>
    </div>

    <div class="basket-list">
      <div v-if="displayList.length === 0" class="empty-state">
        <div class="empty-state__icon">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
        </div>
        <span>收集篮是空的</span>
        <span class="empty-state__hint">在视频/图像/音频面板选中资源后点击「加入收集篮」</span>
      </div>

      <div v-for="item in displayList" :key="item.id" class="basket-item" :class="{ 'is-selected': selected.has(item.id) }">
        <input type="checkbox" class="basket-item__check" :checked="selected.has(item.id)" @change="toggleSelect(item.id)" />
        <span class="basket-item__kind" :class="`basket-item__kind--${item.kind}`">{{ kindLabel(item.kind) }}</span>
        <div class="basket-item__body">
          <div class="basket-item__name" :title="item.url">{{ item.title || shorten(item.url) }}</div>
          <div class="basket-item__meta">
            <span v-if="item.width && item.height">{{ item.width }}x{{ item.height }}</span>
            <span>{{ formatTime(item.addedAt) }}</span>
          </div>
        </div>
        <div class="basket-item__actions">
          <BaseButton size="sm" variant="secondary" @click="downloadSingle(item)">{{ isDownloaded(item.url) ? '已下载' : '下载' }}</BaseButton>
          <BaseButton size="sm" variant="ghost" @click="onRemove(item)">移除</BaseButton>
        </div>
      </div>
    </div>
  </BaseCard>
</template>

<script lang="ts">
import { defineComponent, ref, computed, onMounted, onBeforeUnmount } from 'vue';
import { BaseCard, BaseButton } from '../components/base';
import { basketState, subscribeBasket, addToBasket, removeFromBasket, clearBasket, type BasketItem } from '../services/collection';
import { addDownload } from '../services/downloadQueue';
import { isDownloaded } from '../services/downloadHistory';
import { exportRowsAsJSON, exportRowsAsCSV } from '../services/exportList';
import { confirmDialog } from '../composables/useConfirm';
import { toast } from '../composables/useToast';
import { useResourceCounts } from '../composables/useResourceCounts';

type BasketKind = BasketItem['kind'];

export default defineComponent({
  name: 'CollectionPanel',
  components: { BaseCard, BaseButton },
  setup() {
    const { setCount } = useResourceCounts();
    const filterKind = ref<'all' | BasketKind>('all');
    const selected = ref(new Set<string>());
    let unsubscribe: (() => void) | null = null;

    onMounted(() => {
      unsubscribe = subscribeBasket(list => {
        setCount('basket', list.length);
        // 清理已不存在的选中项
        const ids = new Set(list.map(i => i.id));
        Array.from(selected.value).forEach(id => { if (!ids.has(id)) selected.value.delete(id); });
      });
    });
    onBeforeUnmount(() => { unsubscribe?.(); });

    const displayList = computed(() => {
      return basketState.list.filter(i => filterKind.value === 'all' || i.kind === filterKind.value);
    });
    const selectedCount = computed(() => selected.value.size);

    function toggleSelect(id: string) {
      if (selected.value.has(id)) selected.value.delete(id);
      else selected.value.add(id);
      // 触发响应式
      selected.value = new Set(selected.value);
    }

    function kindLabel(k: BasketKind): string {
      return k === 'video' ? '视频' : k === 'audio' ? '音频' : '图片';
    }
    function shorten(url: string): string {
      return url.length > 64 ? url.slice(0, 64) + '…' : url;
    }
    function formatTime(ts: number): string {
      const d = new Date(ts);
      return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    }

    function kindOf(k: BasketKind): 'video' | 'audio' | 'image' { return k; }

    async function downloadSingle(item: BasketItem) {
      await addDownload(item.url, item.title, kindOf(item.kind));
      toast.info('已加入下载队列');
    }
    async function downloadSelected() {
      const items = displayList.value.filter(i => selected.value.has(i.id));
      for (const it of items) {
        await addDownload(it.url, it.title, kindOf(it.kind));
      }
      toast.success(`已加入下载队列 ${items.length} 项`);
    }
    async function onRemove(item: BasketItem) {
      await removeFromBasket(item.id);
      selected.value.delete(item.id);
      selected.value = new Set(selected.value);
    }
    async function onClear() {
      const ok = await confirmDialog({ title: '清空收集篮', message: '将移除全部暂存资源（不删除已下载文件），不可恢复。', danger: true, confirmText: '清空' });
      if (ok) {
        await clearBasket();
        selected.value.clear();
        toast.success('收集篮已清空');
      }
    }
    function exportJson() {
      exportRowsAsJSON(displayList.value.map(i => ({ kind: kindLabel(i.kind), title: i.title || '', url: i.url, pageUrl: i.pageUrl || '', addedAt: i.addedAt })), '收集篮');
      toast.success('已导出 JSON');
    }
    function exportCsv() {
      exportRowsAsCSV(displayList.value, [
        { label: '类型', value: i => kindLabel(i.kind) },
        { label: '标题', value: i => i.title || '' },
        { label: '地址', value: i => i.url },
        { label: '来源页', value: i => i.pageUrl || '' }
      ], '收集篮');
      toast.success('已导出 CSV');
    }

    return { basketState, filterKind, displayList, selected, selectedCount, toggleSelect, kindLabel, shorten, formatTime, downloadSingle, downloadSelected, onRemove, onClear, exportJson, exportCsv, addToBasket };
  }
});
</script>

<style scoped>
.filter-row {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 12px;
}
.filter-row__right { display: flex; gap: 4px; margin-left: auto; }

.sp-select {
  height: 28px;
  padding: 0 8px;
  background: var(--sp-color-surface);
  border: 1px solid var(--sp-color-border-strong);
  border-radius: var(--sp-radius-sm);
  color: var(--sp-color-text);
  font-size: 11px;
  font-family: var(--sp-font-family);
  outline: none;
  cursor: pointer;
}
.sp-select:focus { border-color: var(--sp-color-primary); }

.basket-list {
  display: flex;
  flex-direction: column;
  gap: 1px;
  border: 1px solid var(--sp-color-border);
  border-radius: var(--sp-radius-lg);
  overflow: hidden;
  background: var(--sp-color-border);
  max-height: 480px;
  overflow-y: auto;
}

.empty-state {
  display: flex; flex-direction: column; align-items: center; gap: 6px;
  padding: 32px;
  background: var(--sp-color-bg-elevated);
  color: var(--sp-color-muted);
  font-size: 12px;
}
.empty-state__icon {
  width: 36px; height: 36px; border-radius: 10px;
  background: var(--sp-color-surface);
  display: flex; align-items: center; justify-content: center;
}
.empty-state__hint { font-size: 11px; }

.basket-item {
  display: flex; align-items: center; gap: 8px;
  padding: 8px 10px;
  background: var(--sp-color-bg-elevated);
  transition: background var(--sp-transition-fast);
}
.basket-item:hover { background: var(--sp-color-surface); }
.basket-item.is-selected { background: var(--sp-color-primary-light); }

.basket-item__check { accent-color: var(--sp-color-primary); flex-shrink: 0; }

.basket-item__kind {
  font-size: 11px; font-weight: 600;
  padding: 1px 6px; border-radius: 999px;
  flex-shrink: 0;
}
.basket-item__kind--video { background: var(--sp-color-primary-light); color: var(--sp-color-primary); }
.basket-item__kind--image { background: rgba(139,92,246,0.12); color: #8b5cf6; }
.basket-item__kind--audio { background: var(--sp-color-success-light); color: var(--sp-color-success); }

.basket-item__body { flex: 1; min-width: 0; }
.basket-item__name {
  font-size: 12px; font-weight: 500; color: var(--sp-color-text);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.basket-item__meta { display: flex; gap: 8px; font-size: 11px; color: var(--sp-color-muted); margin-top: 2px; }

.basket-item__actions { display: flex; gap: 4px; flex-shrink: 0; }
</style>
