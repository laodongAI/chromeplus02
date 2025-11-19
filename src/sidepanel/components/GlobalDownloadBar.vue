<template>
  <div v-if="totalTasks>0" class="gdl-bar" :class="{ 'is-active': activeRunning>0 }">
    <div class="gdl-row top-line">
      <span class="gdl-summary" :title="queuePaused? '队列已暂停' : '队列运行中'">
        下载: {{ completedTasks }}/{{ totalTasks }} 完成
        <span v-if="activeRunning>0"> | 运行 {{ activeRunning }}</span>
        <span v-if="pausedCount>0"> | 暂停 {{ pausedCount }}</span>
        <span v-if="errorCount>0" class="err-chip" :title="errorTooltip">
          失败 {{ errorCount }}
        </span>
      </span>
      <span class="gdl-metrics">
        <span v-if="aggSpeed>0">速率 {{ formatSpeed(aggSpeed) }}</span>
        <span v-if="etaSeconds!==null">剩余 {{ formatEta(etaSeconds) }}</span>
      </span>
    </div>
    <div class="gdl-progress">
      <div class="gdl-progress__bar">
        <div class="gdl-progress__inner" :style="{ width: (percent*100).toFixed(2)+'%' }"></div>
      </div>
      <span class="gdl-percent">{{ (percent*100).toFixed(0) }}%</span>
    </div>
    <div class="gdl-actions" v-if="showActions">
      <button v-if="!queuePaused && activeRunning>0" class="gdl-btn" @click="pauseAll" title="暂停所有当前下载">暂停全部</button>
      <button v-if="queuePaused && pausedCount>0" class="gdl-btn" @click="resumeAll" title="恢复全部已暂停">继续全部</button>
      <button v-if="errorCount>0" class="gdl-btn" @click="retryFailedAll" title="重试全部失败任务">重试失败</button>
    </div>
  </div>
</template>

<script lang="ts" setup>
import { onMounted, onBeforeUnmount, ref, computed } from 'vue';
import { subscribe, type DownloadTask, pauseAllDownloads, resumeAllDownloads, retryFailedAllDownloads } from '../services/downloadQueue';

const tasks = ref<DownloadTask[]>([]);
let unsubscribe: (()=>void)|null = null;

onMounted(()=>{ unsubscribe = subscribe(t=>{ tasks.value = t; }); });
onBeforeUnmount(()=>{ if(unsubscribe) unsubscribe(); });

const totalTasks = computed(()=> tasks.value.length);
const completedTasks = computed(()=> tasks.value.filter(t=> t.status==='completed').length);
const activeRunning = computed(()=> tasks.value.filter(t=> t.status==='running').length);
const pausedCount = computed(()=> tasks.value.filter(t=> t.status==='paused').length);
const errorCount = computed(()=> tasks.value.filter(t=> t.status==='error').length);
const queuePaused = computed(()=> activeRunning.value===0 && pausedCount.value>0 && tasks.value.some(t=> t.status==='paused'));
const errorTooltip = computed(()=>{
  const map: Record<string, number> = {};
  tasks.value.filter(t=> t.status==='error' && t.errorCode).forEach(t=>{ map[t.errorCode!] = (map[t.errorCode!]|0)+1; });
  return Object.entries(map).map(([k,v])=> `${k}:${v}`).join('\n');
});
const showActions = computed(()=> activeRunning.value>0 || pausedCount.value>0 || errorCount.value>0 );

// 加权进度：优先使用文件大小；未知大小按任务平均权重
const percent = computed(()=>{
  if(!tasks.value.length) return 0;
  let weightedSum = 0;
  let weightTotal = 0;
  for(const t of tasks.value){
    const sizeKnown = typeof t.totalBytes === 'number' && t.totalBytes>0;
    const w = sizeKnown ? t.totalBytes! : 1;
    const p = (typeof t.progress === 'number') ? t.progress : (t.status==='completed' ? 1 : 0);
    weightedSum += p*w; weightTotal += w;
  }
  return weightTotal>0 ? weightedSum/weightTotal : 0;
});

// 聚合速度与剩余时间估算
const aggSpeed = computed(()=>{
  let speed = 0;
  for(const t of tasks.value){
    if(t.status==='running' && typeof t.speedBps === 'number') speed += t.speedBps;
  }
  return speed;
});
const etaSeconds = computed(()=>{
  // 若没有速度或没有剩余字节则返回 null
  const speed = aggSpeed.value;
  if(speed<=0) return null;
  let remainBytes = 0;
  for(const t of tasks.value){
    if(t.status==='running' && typeof t.totalBytes === 'number' && typeof t.bytesReceived === 'number' && t.totalBytes>t.bytesReceived){
      remainBytes += (t.totalBytes - t.bytesReceived);
    }
  }
  if(remainBytes<=0) return null;
  return Math.round(remainBytes / speed);
});

function formatSpeed(bps: number){
  if(bps<1024) return bps.toFixed(0)+' B/s';
  const kb = bps/1024;
  if(kb<1024) return kb.toFixed(1)+' KB/s';
  const mb = kb/1024; return mb.toFixed(2)+' MB/s';
}
function formatEta(sec: number){
  const m = Math.floor(sec/60); const s = sec%60;
  if(m>60){ const h = Math.floor(m/60); const rm = m%60; return `${h}h${rm}m`; }
  if(m>0) return `${m}m${s}s`; return `${s}s`; }

function pauseAll(){ pauseAllDownloads(); }
function resumeAll(){ resumeAllDownloads(); }
function retryFailedAll(){ retryFailedAllDownloads(); }
</script>

<style scoped>
.gdl-bar { border:1px solid rgba(255,255,255,0.08); border-radius: var(--sp-radius-md); padding:8px 12px; margin-bottom: var(--sp-spacing-4); background: rgba(20,28,40,0.6); font-size:12px; display:flex; flex-direction:column; gap:6px; }
.gdl-bar.is-active { box-shadow:0 0 0 1px rgba(79,156,255,0.25), 0 2px 4px rgba(0,0,0,0.4); }
.gdl-row { display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px; }
.top-line { margin-bottom:2px; }
.gdl-summary { font-weight:500; color: var(--sp-color-heading); }
.gdl-metrics { display:flex; gap:12px; color: var(--sp-color-muted); }
.gdl-progress { display:flex; align-items:center; gap:8px; }
.gdl-progress__bar { flex:1; height:6px; background: rgba(255,255,255,0.1); border-radius:4px; overflow:hidden; position:relative; }
.gdl-progress__inner { height:100%; background: linear-gradient(90deg, #4F9CFF, #62C5FF); transition: width .35s ease; }
.gdl-percent { width:42px; text-align:right; font-variant-numeric: tabular-nums; color: var(--sp-color-muted); }
.gdl-actions { display:flex; gap:8px; flex-wrap:wrap; }
.gdl-btn { background:#203347; color:#cdd9e5; border:1px solid #335578; padding:4px 10px; font-size:12px; border-radius:4px; cursor:pointer; line-height:1.2; }
.gdl-btn:hover { background:#2a4461; }
.gdl-btn:active { background:#183246; }
.err-chip { display:inline-block; background:#5b1f24; color:#ffb4b4; padding:0 6px; margin-left:6px; border-radius:4px; font-size:11px; }
@media (max-width:640px){ .gdl-row { flex-direction:column; align-items:flex-start; } }
</style>
