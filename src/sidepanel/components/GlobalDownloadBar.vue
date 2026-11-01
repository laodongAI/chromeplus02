<template>
  <div v-if="totalTasks > 0" class="gdl-bar" :class="{ 'is-active': activeRunning > 0 }">
    <div class="gdl-top">
      <div class="gdl-info">
        <div class="gdl-dot" :class="{ 'is-pulsing': activeRunning > 0 }"></div>
        <span class="gdl-label">{{ activeRunning > 0 ? '下载中' : queuePaused ? '已暂停' : '已完成' }}</span>
        <span class="gdl-count">{{ completedTasks }}/{{ totalTasks }}</span>
        <span v-if="errorCount > 0" class="gdl-error-chip">{{ errorCount }} 失败</span>
      </div>
      <div class="gdl-right">
        <span v-if="aggSpeed > 0" class="gdl-speed">{{ formatSpeed(aggSpeed) }}</span>
        <span v-if="etaSeconds !== null" class="gdl-eta">剩余 {{ formatEta(etaSeconds) }}</span>
        <span class="gdl-pct">{{ Math.round(percent * 100) }}%</span>
        <div class="gdl-btns" v-if="showActions">
          <button v-if="!queuePaused && activeRunning > 0" class="gdl-btn" @click="pauseAll">暂停</button>
          <button v-if="queuePaused && pausedCount > 0" class="gdl-btn gdl-btn--resume" @click="resumeAll">继续</button>
          <button v-if="errorCount > 0" class="gdl-btn gdl-btn--retry" @click="retryFailedAll">重试</button>
        </div>
      </div>
    </div>
    <div class="gdl-track"><div class="gdl-fill" :style="{ width: (percent * 100).toFixed(2) + '%' }"></div></div>
  </div>
</template>
<script lang="ts" setup>
import { onMounted, onBeforeUnmount, ref, computed } from 'vue';
import { subscribe, type DownloadTask, pauseAllDownloads, resumeAllDownloads, retryFailedAllDownloads } from '../services/downloadQueue';
const tasks = ref<DownloadTask[]>([]);
let unsubscribe: (() => void) | null = null;
onMounted(() => { unsubscribe = subscribe(t => { tasks.value = t; }); });
onBeforeUnmount(() => { if (unsubscribe) unsubscribe(); });
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
.gdl-label { font-size: 11px; font-weight: 600; color: var(--sp-color-text); }
.gdl-count { font-size: 11px; color: var(--sp-color-muted); }
.gdl-error-chip { font-size: 11px; font-weight: 600; background: var(--sp-color-danger-light); color: var(--sp-color-danger); border: 1px solid rgba(239,68,68,0.2); padding: 1px 6px; border-radius: 999px; }
.gdl-right { display: flex; align-items: center; gap: 8px; }
.gdl-speed, .gdl-eta { font-size: 11px; color: var(--sp-color-muted); font-family: var(--sp-font-mono,monospace); }
.gdl-pct { font-size: 11px; font-weight: 600; color: var(--sp-color-primary); min-width: 32px; text-align: right; }
.gdl-btns { display: flex; gap: 4px; }
.gdl-btn { font-size: 11px; font-weight: 500; color: var(--sp-color-text-secondary); background: var(--sp-color-surface); border: 1px solid var(--sp-color-border-strong); border-radius: 4px; padding: 2px 7px; cursor: pointer; font-family: var(--sp-font-family); transition: all var(--sp-transition-fast); height: 20px; display: flex; align-items: center; }
.gdl-btn:hover { color: var(--sp-color-primary); border-color: var(--sp-color-primary); }
.gdl-btn--resume { color: var(--sp-color-success); border-color: rgba(16,185,129,0.3); background: var(--sp-color-success-light); }
.gdl-btn--retry { color: var(--sp-color-warning); border-color: rgba(245,158,11,0.3); background: var(--sp-color-warning-light); }
.gdl-track { height: 3px; background: var(--sp-color-surface); border-radius: 999px; overflow: hidden; }
.gdl-fill { height: 100%; background: var(--sp-color-primary); border-radius: 999px; transition: width var(--sp-transition-base); }
</style>
