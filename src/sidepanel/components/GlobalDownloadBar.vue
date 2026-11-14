<template>
  <div v-if="totalTasks > 0 && !dismissed" class="gdl-bar" :class="{ 'is-active': activeRunning > 0 }">
    <div class="gdl-top">
      <div class="gdl-info">
        <div class="gdl-dot" :class="{ 'is-pulsing': activeRunning > 0 }"></div>
        <!-- 评审 P1：全部完成后"已完成"可点击，跳转到下载管理面板查看历史 -->
        <!-- UI 三批（组3）：补 aria-label，原只有 title（悬停才可见，读屏不可达） -->
        <button
          v-if="settled"
          class="gdl-label gdl-label--jump"
          title="查看下载历史"
          aria-label="查看下载历史"
          @click="jumpToHistory"
        >{{ label }}</button>
        <span v-else class="gdl-label">{{ label }}</span>
        <span class="gdl-count">{{ completedTasks }}/{{ totalTasks }}</span>
        <!-- UI 三批（组1）：本地 .gdl-error-chip 收敛为共享 BaseTag（danger 语义 sm 紧凑徽标） -->
        <BaseTag v-if="errorCount > 0" variant="danger" size="sm">{{ errorCount }} 失败</BaseTag>
      </div>
      <div class="gdl-right">
        <span v-if="aggSpeed > 0" class="gdl-speed">{{ formatSpeed(aggSpeed) }}</span>
        <span v-if="etaSeconds !== null" class="gdl-eta">剩余 {{ formatEta(etaSeconds) }}</span>
        <span class="gdl-pct">{{ Math.round(percent * 100) }}%</span>
        <!-- UI 三批（组1/组3）：行内操作按钮收敛为 BaseButton size=xs（24px 高，
             原 .gdl-btn 20px 低于触控最小值）；暂停=secondary、继续=success、重试=warning -->
        <div class="gdl-btns" v-if="showActions">
          <BaseButton v-if="!queuePaused && activeRunning > 0" size="xs" variant="secondary" @click="pauseAll">暂停</BaseButton>
          <BaseButton v-if="queuePaused && pausedCount > 0" size="xs" variant="success" @click="resumeAll">继续</BaseButton>
          <BaseButton v-if="errorCount > 0" size="xs" variant="warning" @click="retryFailedAll">重试</BaseButton>
        </div>
        <!-- 评审 P1：任务全部落定后提供显式关闭入口，不再永久驻留；
             UI 三批（组1/组3）：收敛为 BaseButton icon-sm ghost + aria-label -->
        <BaseButton v-if="settled" size="icon-sm" variant="ghost" aria-label="收起下载条" title="收起下载条" @click="closeBar">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </BaseButton>
      </div>
    </div>
    <div class="gdl-track"><div class="gdl-fill" :style="{ width: (percent * 100).toFixed(2) + '%' }"></div></div>
  </div>
</template>
<script lang="ts" setup>
import { onMounted, onBeforeUnmount, ref, computed, watch } from 'vue';
import { subscribe, type DownloadTask, pauseAllDownloads, resumeAllDownloads, retryFailedAllDownloads, isQueueSettled } from '../services/downloadQueue';
// P1-8：分级日志（扩展页面上下文默认 info 级）
import { createLogger } from '@/utils/logger';
// UI 三批（组1）：行内操作按钮 / 状态徽标收敛到 base 目录共享组件
import BaseButton from './base/BaseButton.vue';
import BaseTag from './base/BaseTag.vue';

/** 本模块 logger：记录下载条收起/跳转等交互里程碑 */
const log = createLogger('GlobalDownloadBar');

/** 向入口层发出"打开下载管理面板"事件（SidePanelApp 监听后切 Tab） */
const emit = defineEmits<{ (e: 'go-downloads'): void }>();

const tasks = ref<DownloadTask[]>([]);
/** 队列订阅的取消函数，卸载时必须调用 */
let unsubscribe: (() => void) | null = null;
onMounted(() => { unsubscribe = subscribe(t => { tasks.value = t; }); });

/** 用户手动收起标记：收起后保持隐藏，直到队列出现新的进行中任务再自动重新出现 */
const dismissed = ref(false);

/** 任务状态标签文本（进行中/已暂停/已完成） */
const label = computed(() => activeRunning.value > 0 ? '下载中' : queuePaused.value ? '已暂停' : '已完成');

/**
 * 队列是否已全部落定（无 pending/running/paused）。
 * 落定后才显示 ✕ 关闭入口并允许"已完成"点击跳转（评审 P1）。
 */
const settled = computed(() => isQueueSettled(tasks.value));

/**
 * 自动收起定时器（评审 P1）：全部完成 10 秒后尝试收起，
 * 但只在"窗口不活跃（未聚焦）"时真正隐藏——避免用户正在看的时候突然消失；
 * 窗口仍聚焦时保持显示，由用户点 ✕ 手动关闭。
 */
let autoCollapseTimer: number | null = null;
const AUTO_COLLAPSE_MS = 10_000;

/** 清除自动收起定时器（幂等） */
function clearAutoCollapse(): void {
  if (autoCollapseTimer !== null) { clearTimeout(autoCollapseTimer); autoCollapseTimer = null; }
}

// 落定状态跃迁时维护自动收起定时器；出现新的进行中任务时复位 dismissed，让下载条重新出现
watch(settled, (nowSettled) => {
  if (nowSettled) {
    clearAutoCollapse();
    autoCollapseTimer = window.setTimeout(() => {
      autoCollapseTimer = null;
      // 仅当窗口不活跃（用户不在看侧栏）时自动收起
      if (typeof document !== 'undefined' && !document.hasFocus()) {
        dismissed.value = true;
        log.info('全部完成且窗口不活跃，10 秒后自动收起下载条');
      }
    }, AUTO_COLLAPSE_MS);
  } else {
    clearAutoCollapse();
    dismissed.value = false;
  }
}, { immediate: true });

/** 手动收起下载条（✕） */
function closeBar(): void {
  dismissed.value = true;
  clearAutoCollapse();
  log.info('用户手动收起下载条');
}

/** 点击"已完成"跳转下载管理面板（历史与队列都在该面板承载） */
function jumpToHistory(): void {
  log.info('点击下载完成状态，跳转下载管理面板');
  emit('go-downloads');
}

onBeforeUnmount(() => {
  if (unsubscribe) unsubscribe();
  clearAutoCollapse();
});
const totalTasks = computed(() => tasks.value.length);
const completedTasks = computed(() => tasks.value.filter(t => t.status === 'completed').length);
const activeRunning = computed(() => tasks.value.filter(t => t.status === 'running').length);
const pausedCount = computed(() => tasks.value.filter(t => t.status === 'paused').length);
const errorCount = computed(() => tasks.value.filter(t => t.status === 'error').length);
const queuePaused = computed(() => activeRunning.value === 0 && pausedCount.value > 0);
const showActions = computed(() => activeRunning.value > 0 || pausedCount.value > 0 || errorCount.value > 0);
const percent = computed(() => {
  if (!tasks.value.length) return 0;
  let ws = 0, wt = 0;
  for (const t of tasks.value) {
    const w = (typeof t.totalBytes === 'number' && t.totalBytes > 0) ? t.totalBytes! : 1;
    const p = (typeof t.progress === 'number') ? t.progress : (t.status === 'completed' ? 1 : 0);
    ws += p * w; wt += w;
  }
  return wt > 0 ? ws / wt : 0;
});
const aggSpeed = computed(() => { let s = 0; for (const t of tasks.value) { if (t.status === 'running' && typeof t.speedBps === 'number') s += t.speedBps; } return s; });
const etaSeconds = computed(() => {
  const speed = aggSpeed.value; if (speed <= 0) return null;
  let rem = 0;
  for (const t of tasks.value) { if (t.status === 'running' && typeof t.totalBytes === 'number' && typeof t.bytesReceived === 'number' && t.totalBytes > t.bytesReceived) rem += (t.totalBytes - t.bytesReceived); }
  return rem > 0 ? Math.round(rem / speed) : null;
});
function formatSpeed(bps: number) { const kb = bps/1024; return kb < 1024 ? kb.toFixed(1)+' KB/s' : (kb/1024).toFixed(2)+' MB/s'; }
function formatEta(sec: number) { const m = Math.floor(sec/60), s = sec%60; if (m>60) { const h=Math.floor(m/60); return `${h}h${m%60}m`; } return m>0 ? `${m}m${s}s` : `${s}s`; }
function pauseAll() { pauseAllDownloads(); }
function resumeAll() { resumeAllDownloads(); }
function retryFailedAll() { retryFailedAllDownloads(); }
</script>
<style scoped>
.gdl-bar {
  padding: 7px 14px 5px;
  background: var(--sp-color-bg-elevated);
  border-bottom: 1px solid var(--sp-color-border);
  transition: border-color var(--sp-transition-fast);
}
.gdl-bar.is-active { border-bottom-color: rgba(99,102,241,0.3); }
.gdl-top { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 5px; }
.gdl-info { display: flex; align-items: center; gap: 6px; }
.gdl-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--sp-color-muted); flex-shrink: 0; }
.gdl-dot.is-pulsing { background: var(--sp-color-primary); animation: pulse 1.4s ease infinite; }
@keyframes pulse { 0%,100%{opacity:1}50%{opacity:.4} }
/* UI 三批（组2）：状态行信息文字 11px → 12px */
.gdl-label { font-size: 12px; font-weight: 600; color: var(--sp-color-text); }
/* 已完成态可点击跳转：外观与普通文本一致，悬停显示主色（评审 P1） */
.gdl-label--jump { background: none; border: none; padding: 0; font-family: var(--sp-font-family); cursor: pointer; }
.gdl-label--jump:hover { color: var(--sp-color-primary); text-decoration: underline; }
/* UI 三批（组1）：.gdl-close 由 BaseButton icon-sm ghost 替代，本地幽灵样式删除 */
.gdl-count { font-size: 12px; color: var(--sp-color-muted); }
/* UI 三批（组1）：.gdl-error-chip 由 BaseTag danger sm 替代，本地分叉样式删除 */
.gdl-right { display: flex; align-items: center; gap: 8px; }
/* 组2：速度/剩余时间/百分比属信息性文字，11px → 12px */
.gdl-speed, .gdl-eta { font-size: 12px; color: var(--sp-color-muted); font-family: var(--sp-font-mono,monospace); }
.gdl-pct { font-size: 12px; font-weight: 600; color: var(--sp-color-primary); min-width: 32px; text-align: right; }
.gdl-btns { display: flex; gap: 4px; }
/* UI 三批（组1/组3）：.gdl-btn / --resume / --retry（20px 高，低于触控最小值）
   由 BaseButton size=xs（secondary/success/warning）替代，本地分叉样式删除 */
.gdl-track { height: 3px; background: var(--sp-color-surface); border-radius: 999px; overflow: hidden; }
.gdl-fill { height: 100%; background: var(--sp-color-primary); border-radius: 999px; transition: width var(--sp-transition-base); }
</style>
