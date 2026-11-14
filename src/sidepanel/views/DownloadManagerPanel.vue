<template>
  <!-- UI 二批之二：section 决定渲染形态（all=旧版单面板 / queue=进行中子页签 / history=历史子页签），
       标题与副标题随形态切换，业务逻辑（队列订阅、历史读写、重试/取消）完全共用 -->
  <BaseCard :title="cardTitle" :subtitle="cardSubtitle" padded>
    <div class="filter-row" v-if="showHistory">
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

    <!-- 进行中 / 近期下载任务（实时队列） -->
    <div class="queue-section" v-if="showQueue && queueTasks.length">
      <div class="queue-section__head">
        <span class="queue-section__title">进行中 / 近期任务（{{ queueTasks.length }}）</span>
        <!-- 拆分进行中/历史子页签后，提示文案指向「历史」子页签，保持"进行中 → 历史"的引导语义 -->
        <span class="queue-section__hint">{{ section === 'queue' ? '全局暂停/继续在顶部下载条；完成的任务可在「历史」子页签查看' : '全局暂停/继续在顶部下载条；完成的任务会进入下方历史' }}</span>
      </div>
      <div v-for="t in queueTasks" :key="t.id" class="queue-item">
        <div class="queue-item__body">
          <div class="queue-item__name" :title="t.url">
            <!-- UI 三批（组1）：引擎标注收敛共享 BaseTag（HLS=warning、直链=info），替代本地 .engine-chip 复制样式 -->
            <BaseTag size="sm" :variant="t.engine === 'hls' ? 'warning' : 'info'">{{ engineLabel(t.engine) }}</BaseTag>
            {{ t.fileName || shortenUrl(t.url) }}
          </div>
          <div class="queue-item__bar"><div class="queue-item__bar-fill" :class="{ 'is-done': t.status === 'completed' }" :style="{ width: Math.round((t.progress || 0) * 100) + '%' }"></div></div>
          <div class="queue-item__meta">
            <!-- UI 三批（组1）：任务状态徽标收敛共享 BaseTag，替代本地 .status-chip 复制样式 -->
            <BaseTag size="sm" :variant="statusVariant(t.status)">{{ statusLabel(t.status) }}</BaseTag>
            <span v-if="t.totalBytes">{{ formatSize(t.totalBytes) }}</span>
            <span v-if="t.speedBps">{{ formatSize(t.speedBps) }}/s</span>
            <span v-if="t.etaSeconds">剩余 {{ t.etaSeconds }}s</span>
            <span v-if="t.error" class="queue-item__err" :title="t.error">{{ t.error }}</span>
          </div>
        </div>
        <div class="queue-item__actions">
          <BaseButton v-if="t.status === 'error' || t.status === 'canceled'" size="sm" variant="secondary" @click="retryDownload(t.id)">重试</BaseButton>
          <BaseButton v-if="t.status === 'pending' || t.status === 'running' || t.status === 'paused'" size="sm" variant="ghost" @click="cancelDownload(t.id)">取消</BaseButton>
        </div>
      </div>
    </div>

    <!-- 进行中子页签专属空状态：队列无任务时明确指向「历史」子页签，避免空白页观感 -->
    <div v-if="section === 'queue' && !queueTasks.length" class="empty-state">
      <div class="empty-state__icon">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
      </div>
      <span>当前没有进行中或近期的下载任务</span>
      <span class="empty-state__hint">已完成与失败的任务可在「历史」子页签查看</span>
    </div>

    <div class="history-list" v-if="showHistory">
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
            <!-- UI 三批（组1）：历史记录状态徽标同样收敛共享 BaseTag -->
            <BaseTag size="sm" :variant="item.status === 'success' ? 'success' : 'danger'">
              {{ item.status === 'success' ? '成功' : '失败' }}
            </BaseTag>
            <span class="history-item__time">{{ formatTime(item.timestamp) }}</span>
            <span v-if="item.size" class="history-item__size">{{ formatSize(item.size) }}</span>
          </div>
          <div v-if="item.error" class="history-item__error">{{ item.error }}</div>
        </div>
        <div class="history-item__actions">
          <BaseButton size="sm" variant="ghost" @click="copyLink(item.url)">复制</BaseButton>
          <BaseButton size="sm" variant="secondary" @click="retryHistoryItem(item)">重试</BaseButton>
        </div>
      </div>
    </div>
  </BaseCard>
</template>

<script lang="ts">
import { defineComponent, ref, computed, onMounted, onBeforeUnmount, type PropType } from 'vue';
// UI 三批（组1）：新增共享徽标组件 BaseTag，替换本面板 .status-chip/.engine-chip 复制样式
import { BaseCard, BaseButton, BaseTag } from '../components/base';
import { loadHistory, getHistoryList, clearHistory, type HistoryItem } from '../services/downloadHistory';
import { addDownload, subscribe, cancelDownload, retryDownload, type DownloadTask } from '../services/downloadQueue';
import { formatBytes } from '@/utils/format';
import { confirmDialog } from '../composables/useConfirm';
import { toast } from '../composables/useToast';
// P1-8：分级日志（扩展页面上下文默认 info 级，debug 需显式放开）
import { createLogger } from '@/utils/logger';

/** 本模块 logger：保留原 `[DownloadManagerPanel]` 前缀语义 */
const log = createLogger('DownloadManagerPanel');

export default defineComponent({
  name: 'DownloadManagerPanel',
  components: { BaseCard, BaseButton, BaseTag },
  props: {
    /**
     * UI 二批之二：渲染分节开关。
     *  - 'all'（默认）：队列 + 历史同屏（旧版单 tab 形态，保留兼容）；
     *  - 'queue'：仅队列分节（下载入口「进行中」子页签）；
     *  - 'history'：仅历史列表（下载入口「历史」子页签，下载条"已完成"跳转目标）。
     */
    section: { type: String as PropType<'all' | 'queue' | 'history'>, default: 'all' },
  },
  setup(props) {
    /** 队列分节是否渲染（history 形态下隐藏） */
    const showQueue = computed(() => props.section !== 'history');
    /** 历史分节与过滤行是否渲染（queue 形态下隐藏） */
    const showHistory = computed(() => props.section !== 'queue');
    /** 卡片标题随形态切换：进行中=下载队列 / 历史=下载记录 / all=旧版标题 */
    const cardTitle = computed(() => (props.section === 'queue' ? '下载队列' : '下载记录'));
    /** 卡片副标题随形态切换 */
    const cardSubtitle = computed(() =>
      props.section === 'queue'
        ? '进行中与近期的下载任务；完成的任务可在「历史」子页签查看'
        : props.section === 'history'
          ? '查看所有下载任务的历史与状态'
          : '查看所有下载任务的历史与状态'
    );
    const filterStatus = ref('all');
    const filterType = ref('all');
    const historyList = ref<HistoryItem[]>([]);

    async function refreshHistory() {
      await loadHistory();
      historyList.value = [...getHistoryList()];
    }

    // ── 实时下载队列（进行中/近期任务） ──
    const queueTasks = ref<DownloadTask[]>([]);
    // 队列订阅的取消函数，卸载时必须调用，防止重复挂载后叠加订阅（P0-6）
    let unsubscribeQueue: (() => void) | null = null;

    onMounted(() => {
      log.debug('挂载：注册下载历史刷新监听与队列订阅');
      refreshHistory();
      // 注意：refreshHistory 在 setup 闭包中引用稳定，add/remove 使用同一函数引用才能正确移除
      window.addEventListener('download-queue-update', refreshHistory);
      unsubscribeQueue = subscribe(tasks => { queueTasks.value = tasks; });
    });
    onBeforeUnmount(() => {
      log.debug('卸载：移除 window 监听与队列订阅，防止监听器泄漏（P0-6）');
      // 修复 P0-6：原实现只取消了队列订阅，遗漏了 window 事件监听，
      // 切换 Tab 反复挂载会导致 'download-queue-update' 监听器不断叠加
      window.removeEventListener('download-queue-update', refreshHistory);
      unsubscribeQueue?.();
      unsubscribeQueue = null;
    });

    function engineLabel(engine?: string): string {
      if (engine === 'hls') return 'HLS';
      return '直链';
    }
    function statusLabel(status: string): string {
      const map: Record<string, string> = {
        pending: '待开始', running: '下载中', paused: '已暂停',
        completed: '已完成', error: '失败', canceled: '已取消'
      };
      return map[status] || status;
    }
    /**
     * 队列状态 → BaseTag 语义变体（UI 三批·组1：替代原 statusClass 本地样式类名映射）。
     * 已完成=success、失败=danger，其余中间态（待开始/下载中/已暂停/已取消）统一 neutral，
     * 与共享徽标组件的五档语义一一对应，不再自造类名。
     * @param status 队列任务状态
     */
    function statusVariant(status: string): 'success' | 'danger' | 'neutral' {
      if (status === 'completed') return 'success';
      if (status === 'error') return 'danger';
      return 'neutral';
    }
    function shortenUrl(url: string): string {
      return url.length > 56 ? url.slice(0, 56) + '…' : url;
    }

    const displayList = computed(() => {
      return historyList.value.filter(item => {
        if (filterStatus.value !== 'all' && item.status !== filterStatus.value) return false;
        if (filterType.value !== 'all' && item.kind !== filterType.value) return false;
        return true;
      }).sort((a, b) => b.timestamp - a.timestamp);
    });

    async function clearAll() {
      const ok = await confirmDialog({ title: '清除下载历史', message: '将移除全部下载记录（不删除已下载文件），不可恢复。', danger: true, confirmText: '清除' });
      if (ok) {
        await clearHistory();
        historyList.value = [];
        toast.success('下载历史已清除');
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

    // 收口轮 lint 修复：历史重试入口命名为 retryHistoryItem，避免与队列服务
    // retryDownload（按 id 取消后重入队）同名遮蔽——原实现局部函数覆盖了导入，
    // 队列任务的"重试"按钮实际调用的仍是本函数（走历史重下载语义），行为不变，
    // 仅消除"导入被遮蔽"的隐性错误。
    function retryHistoryItem(item: HistoryItem) {
      // 注意签名：addDownload(url, fileName, kind)；历史记录的 kind 可能为 other，回退为 image
      const kind = item.kind === 'video' || item.kind === 'audio' ? item.kind : 'image';
      addDownload(item.url, item.filename, kind);
    }

    return { filterStatus, filterType, historyList, displayList, refreshHistory, clearAll, getFilename, formatTime, formatSize, copyLink, retryHistoryItem, retryDownload,
             queueTasks, engineLabel, statusLabel, statusVariant, shortenUrl, cancelDownload,
             // UI 二批之二：分节渲染开关与随形态切换的标题（模板绑定 section/showQueue/showHistory/cardTitle/cardSubtitle）
             showQueue, showHistory, cardTitle, cardSubtitle };
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

/* 空状态引导副文案（进行中子页签指向「历史」子页签，UI 二批之二） */
.empty-state__hint { font-size: 11px; }

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

/* UI 三批（组1）：原 .status-chip/.status-chip--ok/err/muted 复制样式已删除，
   状态徽标统一收敛到共享组件 BaseTag（success/danger/neutral 语义） */

.queue-section { margin-bottom: 14px; }
.queue-section__head { display: flex; align-items: baseline; gap: 8px; margin-bottom: 8px; }
.queue-section__title { font-size: 12px; font-weight: 600; color: var(--sp-color-heading); }
.queue-section__hint { font-size: 11px; color: var(--sp-color-muted); }

.queue-item {
  display: flex; align-items: center; gap: 10px;
  padding: 8px 10px; margin-bottom: 6px;
  border: 1px solid var(--sp-color-border);
  border-radius: var(--sp-radius-md);
  background: var(--sp-color-bg-elevated);
}
.queue-item__body { flex: 1; min-width: 0; }
.queue-item__name {
  font-size: 12px; font-weight: 500; color: var(--sp-color-text);
  display: flex; align-items: center; gap: 6px;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
/* UI 三批（组1）：原 .engine-chip/.engine-chip--hls 复制样式已删除，
   引擎标注同样收敛 BaseTag（HLS=warning、直链=info），10px 小字一并升到 12px 正文档 */
.queue-item__bar {
  height: 4px; border-radius: 999px; margin: 5px 0 4px;
  background: var(--sp-color-bg-subtle); overflow: hidden;
}
.queue-item__bar-fill {
  height: 100%; border-radius: 999px;
  background: var(--sp-color-primary);
  transition: width var(--sp-transition-base);
}
.queue-item__bar-fill.is-done { background: var(--sp-color-success); }
/* UI 三批（组2）：任务元信息属正文级状态文字，11px → 12px */
.queue-item__meta { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; font-size: 12px; color: var(--sp-color-muted); }
.queue-item__err { color: var(--sp-color-danger); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 240px; }
.queue-item__actions { display: flex; gap: 4px; flex-shrink: 0; }

/* UI 三批（组2）：历史时间/大小为信息性元数据，11px → 12px */
.history-item__time, .history-item__size {
  font-size: 12px;
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
