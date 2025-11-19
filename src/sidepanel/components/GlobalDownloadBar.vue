<template>
  <div v-if="totalTasks>0" class="gdl-bar" :class="{ 'is-active': activeRunning>0 }">
    <div class="gdl-row">
      <span class="gdl-summary">
        下载队列: {{ completedTasks }}/{{ totalTasks }} 完成
        <span v-if="activeRunning>0"> | 进行中 {{ activeRunning }}</span>
      </span>
      <span class="gdl-metrics" v-if="activeRunning>0">
        <span class="gdl-speed" v-if="aggSpeed>0">速率 {{ formatSpeed(aggSpeed) }}</span>
        <span class="gdl-eta" v-if="etaSeconds!==null">剩余 {{ formatEta(etaSeconds) }}</span>
      </span>
    </div>
    <div class="gdl-progress">
      <div class="gdl-progress__bar">
        <div class="gdl-progress__inner" :style="{ width: (percent*100).toFixed(2)+'%' }"></div>
      </div>
      <span class="gdl-percent">{{ (percent*100).toFixed(0) }}%</span>
    </div>
  </div>
</template>

<script lang="ts" setup>
import { onMounted, onBeforeUnmount, ref, computed } from 'vue';
import { subscribe, type DownloadTask } from '../services/downloadQueue';

const tasks = ref<DownloadTask[]>([]);
let unsubscribe: (()=>void)|null = null;

onMounted(()=>{ unsubscribe = subscribe(t=>{ tasks.value = t; }); });
onBeforeUnmount(()=>{ if(unsubscribe) unsubscribe(); });

const totalTasks = computed(()=> tasks.value.length);
const completedTasks = computed(()=> tasks.value.filter(t=> t.status==='completed').length);
const activeRunning = computed(()=> tasks.value.filter(t=> t.status==='running').length);

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
</script>

<style scoped>
.gdl-bar { border:1px solid rgba(255,255,255,0.08); border-radius: var(--sp-radius-md); padding:8px 12px; margin-bottom: var(--sp-spacing-4); background: rgba(20,28,40,0.6); font-size:12px; display:flex; flex-direction:column; gap:6px; }
.gdl-bar.is-active { box-shadow:0 0 0 1px rgba(79,156,255,0.25), 0 2px 4px rgba(0,0,0,0.4); }
.gdl-row { display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px; }
.gdl-summary { font-weight:500; color: var(--sp-color-heading); }
.gdl-metrics { display:flex; gap:12px; color: var(--sp-color-muted); }
.gdl-progress { display:flex; align-items:center; gap:8px; }
.gdl-progress__bar { flex:1; height:6px; background: rgba(255,255,255,0.1); border-radius:4px; overflow:hidden; position:relative; }
.gdl-progress__inner { height:100%; background: linear-gradient(90deg, #4F9CFF, #62C5FF); transition: width .35s ease; }
.gdl-percent { width:42px; text-align:right; font-variant-numeric: tabular-nums; color: var(--sp-color-muted); }
@media (max-width:640px){ .gdl-row { flex-direction:column; align-items:flex-start; } }
</style>
