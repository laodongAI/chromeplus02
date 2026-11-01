<template>
  <BaseCard title="下载记录" subtitle="查看所有下载任务的历史与状态" padded>
    <div class="filter-row">
      <select v-model="filterStatus" class="sp-select">
        <option value="all">全部状态</option>
        <option value="success">成功</option>
        <option value="failed">失败</option>
      </select>
      <select v-model="filterType" class="sp-select">
        <option value="all">全部类型</option>
        <option value="video">视频</option>
        <option value="image">图片</option>
        <option value="audio">音频</option>
      </select>
      <div class="filter-row__right">
        <BaseButton size="sm" variant="ghost" @click="refreshHistory">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
          刷新
        </BaseButton>
        <BaseButton size="sm" variant="ghost" @click="clearAll" :disabled="historyList.length === 0">清空</BaseButton>
      </div>
    </div>

    <div class="history-list">
      <div v-if="displayList.length === 0" class="empty-state">
        <div class="empty-state__icon">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
        </div>
        <span>暂无下载记录</span>
      </div>

      <div v-for="item in displayList" :key="item.id" class="history-item">
        <div class="history-item__icon" :class="`history-item__icon--${item.kind}`">
          <svg v-if="item.kind === 'video'" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg>
          <svg v-else-if="item.kind === 'image'" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
          <svg v-else width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>
        </div>
        <div class="history-item__body">
          <div class="history-item__name" :title="item.filename || item.url">
            {{ item.filename || getFilename(item.url) }}
          </div>
          <div class="history-item__meta">
            <span class="status-chip" :class="item.status === 'success' ? 'status-chip--ok' : 'status-chip--err'">
              {{ item.status === 'success' ? '成功' : '失败' }}
            </span>
            <span class="history-item__time">{{ formatTime(item.timestamp) }}</span>
            <span v-if="item.size" class="history-item__size">{{ formatSize(item.size) }}</span>
          </div>
          <div v-if="item.error" class="history-item__error">{{ item.error }}</div>
        </div>
        <div class="history-item__actions">
          <BaseButton size="sm" variant="ghost" @click="copyLink(item.url)">复制</BaseButton>
          <BaseButton size="sm" variant="secondary" @click="retryDownload(item)">重试</BaseButton>
        </div>
      </div>
    </div>
  </BaseCard>
</template>

<script lang="ts">
import { defineComponent, ref, computed, onMounted } from 'vue';
import { BaseCard, BaseButton } from '../components/base';
import { loadHistory, getHistoryList, clearHistory, type HistoryItem } from '../services/downloadHistory';
import { addDownload } from '../services/downloadQueue';
import { formatBytes } from '@/utils/format';

export default defineComponent({
  name: 'DownloadManagerPanel',
  components: { BaseCard, BaseButton },
  setup() {
    const filterStatus = ref('all');
    const filterType = ref('all');
    const historyList = ref<HistoryItem[]>([]);

    async function refreshHistory() {
      await loadHistory();
      historyList.value = [...getHistoryList()];
    }

    onMounted(() => {
      refreshHistory();
      window.addEventListener('download-queue-update', refreshHistory);
    });

    const displayList = computed(() => {
      return historyList.value.filter(item => {
        if (filterStatus.value !== 'all' && item.status !== filterStatus.value) return false;
        if (filterType.value !== 'all' && item.kind !== filterType.value) return false;
        return true;
      }).sort((a, b) => b.timestamp - a.timestamp);
    });

    async function clearAll() {
      if (confirm('确定要清除所有下载历史吗？')) {
        await clearHistory();
        historyList.value = [];
      }
    }

    function getFilename(url: string) {
      try {
        const u = new URL(url);
        return u.pathname.split('/').filter(Boolean).pop() || url.slice(0, 40);
      } catch { return url.slice(0, 40); }
    }

    function formatTime(ts: number) {
      const d = new Date(ts);
      const now = new Date();
      const diff = now.getTime() - ts;
      if (diff < 60000) return '刚刚';
      if (diff < 3600000) return `${Math.floor(diff / 60000)} 分钟前`;
      if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
      return d.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
    }

    function formatSize(bytes: number) { return formatBytes(bytes); }

    function copyLink(url: string) {
      navigator.clipboard.writeText(url).catch(() => {});
    }

    function retryDownload(item: HistoryItem) {
      // 注意签名：addDownload(url, fileName, kind)；历史记录的 kind 可能为 other，回退为 image
      const kind = item.kind === 'video' || item.kind === 'audio' ? item.kind : 'image';
      addDownload(item.url, item.filename, kind);
    }

    return { filterStatus, filterType, historyList, displayList, refreshHistory, clearAll, getFilename, formatTime, formatSize, copyLink, retryDownload };
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

.filter-row__right {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-left: auto;
}

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

.history-list {
  display: flex;
  flex-direction: column;
  gap: 1px;
  border: 1px solid var(--sp-color-border);
  border-radius: var(--sp-radius-lg);
  overflow: hidden;
  background: var(--sp-color-border);
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 32px;
  background: var(--sp-color-bg-elevated);
  color: var(--sp-color-muted);
  font-size: 12px;
}

.empty-state__icon {
  width: 40px;
  height: 40px;
  border-radius: 10px;
  background: var(--sp-color-surface);
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--sp-color-muted);
}

.history-item {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 10px 12px;
  background: var(--sp-color-bg-elevated);
  transition: background var(--sp-transition-fast);
}

.history-item:hover { background: var(--sp-color-surface); }

.history-item__icon {
  width: 28px;
  height: 28px;
  border-radius: 7px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  margin-top: 1px;
}

.history-item__icon--video { background: var(--sp-color-primary-light); color: var(--sp-color-primary); }
.history-item__icon--image { background: rgba(168, 85, 247, 0.12); color: #a855f7; }
.history-item__icon--audio { background: rgba(34, 197, 94, 0.12); color: #22c55e; }

.history-item__body { flex: 1; min-width: 0; }

.history-item__name {
  font-size: 12px;
  font-weight: 500;
  color: var(--sp-color-text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  margin-bottom: 3px;
}

.history-item__meta {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.status-chip {
  font-size: 11px;
  font-weight: 600;
  padding: 1px 6px;
  border-radius: 999px;
}

.status-chip--ok { background: var(--sp-color-success-light); color: var(--sp-color-success); }
.status-chip--err { background: var(--sp-color-danger-light); color: var(--sp-color-danger); }

.history-item__time, .history-item__size {
  font-size: 11px;
  color: var(--sp-color-muted);
}

.history-item__error {
  font-size: 11px;
  color: var(--sp-color-danger);
  margin-top: 3px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.history-item__actions {
  display: flex;
  gap: 4px;
  flex-shrink: 0;
  align-items: center;
}
</style>
