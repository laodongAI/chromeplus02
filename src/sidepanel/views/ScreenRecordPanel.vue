<template>
  <div class="screen-record-panel">
    <!-- 录制中状态 -->
    <div v-if="recording" class="recording-overlay">
      <div class="recording-status">
        <div class="rec-pulse"></div>
        <span class="rec-label">录制中</span>
        <span class="rec-timer">{{ timerDisplay }}</span>
      </div>
      <div class="annot-hint" v-if="annotTabId != null">✏️ 黑板画笔已开启：默认就是画笔，直接在页面上手写涂画；工具栏可切换 文字/矩形/直线/箭头、颜色与粗细。注意：只能在浏览器页面内绘制（会录进视频），桌面/其他应用窗口无法画</div>
      <div class="recording-info" v-if="selectedSource">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/>
        </svg>
        <span>{{ selectedSource.name }}</span>
      </div>
      <div class="recording-controls">
        <button class="ctrl-btn ctrl-btn--pause" @click="togglePause">
          <svg v-if="!paused" width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
          <svg v-else width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
          {{ paused ? '继续' : '暂停' }}
        </button>
        <button class="ctrl-btn ctrl-btn--stop" @click="stopRecording">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="3" y="3" width="18" height="18" rx="2"/></svg>
          停止录制
        </button>
      </div>
    </div>

    <!-- 选择来源 -->
    <div v-else class="setup-panel">
      <div class="setup-header">
        <div class="pt">桌面录制</div>
        <div class="ps">录制屏幕、窗口或标签页内容</div>
      </div>

      <!-- 来源类型选择 -->
      <div class="source-type-tabs">
        <button
          v-for="t in sourceTypes"
          :key="t.key"
          class="src-type-btn"
          :class="{ active: sourceType === t.key }"
          @click="sourceType = t.key; selectedSource = null"
        >
          <span v-html="t.icon" class="src-type-icon"></span>
          {{ t.label }}
        </button>
      </div>

      <!-- 录制选项 -->
      <div class="options-row">
        <label class="opt-item">
          <span class="opt-label">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/></svg>
            录制系统音频
          </span>
          <div class="tgl" :class="{ on: options.systemAudio }" @click="options.systemAudio = !options.systemAudio"></div>
        </label>
        <label class="opt-item">
          <span class="opt-label">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>
            录制麦克风
          </span>
          <div class="tgl" :class="{ on: options.microphone }" @click="options.microphone = !options.microphone"></div>
        </label>
        <label class="opt-item">
          <span class="opt-label">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="10" r="3"/><path d="M7 20.662V19a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v1.662"/></svg>
            显示鼠标指针
          </span>
          <div class="tgl" :class="{ on: options.cursor }" @click="options.cursor = !options.cursor"></div>
        </label>
      </div>

      <!-- 画质选择 -->
      <div class="quality-row">
        <span class="quality-label">录制画质</span>
        <div class="quality-opts">
          <button
            v-for="q in qualities"
            :key="q.key"
            class="quality-btn"
            :class="{ active: options.quality === q.key }"
            @click="options.quality = q.key"
          >
            {{ q.label }}
            <span class="quality-hint">{{ q.hint }}</span>
          </button>
        </div>
      </div>

      <!-- 窗口/标签页列表 (标签页模式) -->
      <div v-if="sourceType === 'tab'" class="source-list">
        <div class="source-list__header">
          <span>选择标签页</span>
          <button class="refresh-btn" @click="refreshTabs" :class="{ spinning: loadingTabs }">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
          </button>
        </div>
        <div v-if="loadingTabs" class="source-loading">
          <div class="mini-spinner"></div> 加载标签页…
        </div>
        <div v-else class="tab-list">
          <button
            v-for="tab in tabs"
            :key="tab.id"
            class="source-item"
            :class="{ selected: selectedSource?.id === tab.id }"
            @click="selectTab(tab)"
          >
            <div class="source-item__thumb tab-thumb">
              <img v-if="tab.favIconUrl" :src="tab.favIconUrl" width="14" height="14" />
              <svg v-else width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="3" width="18" height="18" rx="2"/></svg>
            </div>
            <div class="source-item__info">
              <div class="source-item__name">{{ tab.title || '未知标签页' }}</div>
              <div class="source-item__url">{{ formatTabUrl(tab.url) }}</div>
            </div>
            <div v-if="selectedSource?.id === tab.id" class="source-item__check">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><polyline points="20 6 9 17 4 12"/></svg>
            </div>
          </button>
          <div v-if="tabs.length === 0" class="source-empty">未找到可录制的标签页</div>
        </div>
      </div>

      <!-- 屏幕/窗口：提示使用系统选择器 -->
      <div v-else class="screen-hint">
        <div class="screen-hint__icon">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <rect x="2" y="3" width="20" height="14" rx="2"/>
            <line x1="8" y1="21" x2="16" y2="21"/>
            <line x1="12" y1="17" x2="12" y2="21"/>
          </svg>
        </div>
        <div class="screen-hint__text">
          点击"开始录制"后，浏览器将弹出<br/>
          系统窗口供你选择录制目标
        </div>
        <div class="screen-hint__tips">
          <div class="hint-chip">整个屏幕</div>
          <div class="hint-chip">应用窗口</div>
          <div class="hint-chip">浏览器标签</div>
        </div>
      </div>

      <!-- 开始按钮 -->
      <button
        class="start-btn"
        :class="{ disabled: sourceType === 'tab' && !selectedSource }"
        :disabled="starting || (sourceType === 'tab' && !selectedSource)"
        @click="startRecording"
      >
        <span v-if="starting" class="btn-spinner"></span>
        <svg v-else width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="4" fill="#ef4444"/></svg>
        {{ starting ? '准备中…' : '开始录制' }}
      </button>
    </div>

    <!-- 录制完成列表 -->
    <div v-if="recordings.length > 0" class="recordings-list">
      <div class="recordings-list__header">
        <span>已录制文件</span>
        <span class="recordings-count">{{ recordings.length }}</span>
      </div>
      <div v-for="rec in recordings" :key="rec.id" class="rec-item">
        <div class="rec-item__icon">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg>
        </div>
        <div class="rec-item__info">
          <div class="rec-item__name">{{ rec.name }}</div>
          <div class="rec-item__meta">
            <span>{{ rec.duration }}</span>
            <span>{{ rec.size }}</span>
            <span class="chip chip-green">已完成</span>
          </div>
        </div>
        <div class="rec-item__actions">
          <button class="icon-btn" title="下载" @click="downloadRecording(rec)">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          </button>
          <button class="icon-btn icon-btn--primary" title="在新标签页打开全屏编辑器" @click="openInEditor(rec)">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          </button>
          <button class="icon-btn icon-btn--danger" title="删除" @click="deleteRecording(rec)">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
          </button>
        </div>
      </div>
    </div>

    <!-- 错误提示 -->
    <div v-if="error" class="error-banner">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
      <span>{{ error }}</span>
      <button class="banner-close" @click="error = null">
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted, onBeforeUnmount } from 'vue';
import { MessageType } from '@/messaging';
import { sendMessageToTab } from '../utils/chromeMessaging';
import { toast } from '../composables/useToast';

interface SourceItem {
  id: number | string;
  name: string;
  url?: string;
  favIconUrl?: string;
}

interface RecordingFile {
  id: string;
  name: string;
  duration: string;
  size: string;
  blob: Blob;
  url: string;
  createdAt: number;
}

const emit = defineEmits<{ (e: 'open-editor', rec: RecordingFile): void }>();

const sourceType = ref<'screen' | 'tab'>('screen');
const selectedSource = ref<SourceItem | null>(null);
const annotTabId = ref<number | undefined>(undefined);
const tabs = ref<SourceItem[]>([]);
const loadingTabs = ref(false);
const starting = ref(false);
const recording = ref(false);
const paused = ref(false);
const error = ref<string | null>(null);
const recordings = ref<RecordingFile[]>([]);

const options = reactive({
  systemAudio: true,
  microphone: false,
  cursor: true,
  quality: 'high' as 'low' | 'medium' | 'high',
});

const sourceTypes = [
  {
    key: 'screen' as const, label: '屏幕/窗口',
    icon: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>`
  },
  {
    key: 'tab' as const, label: '标签页',
    icon: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>`
  },
];

const qualities = [
  { key: 'low' as const, label: '标清', hint: '720p' },
  { key: 'medium' as const, label: '高清', hint: '1080p' },
  { key: 'high' as const, label: '超清', hint: '2K' },
];

// 录制计时
let timerInterval: number | null = null;
const elapsedSeconds = ref(0);
const timerDisplay = computed(() => {
  const s = elapsedSeconds.value;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${pad(h)}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
});

// MediaRecorder 实例
let mediaRecorder: MediaRecorder | null = null;
let chunks: Blob[] = [];
let stream: MediaStream | null = null;
let recordingStartTime = 0;

async function refreshTabs() {
  loadingTabs.value = true;
  try {
    const chromeTabs = await chrome.tabs.query({});
    tabs.value = chromeTabs
      .filter(t => t.id && t.url && !t.url.startsWith('chrome://') && !t.url.startsWith('chrome-extension://'))
      .map(t => ({ id: t.id!, name: t.title || '未命名标签页', url: t.url, favIconUrl: t.favIconUrl }));
  } catch (e) {
    error.value = '无法获取标签页列表';
  } finally {
    loadingTabs.value = false;
  }
}

function selectTab(tab: SourceItem) {
  selectedSource.value = tab;
}

function formatTabUrl(url?: string) {
  if (!url) return '';
  try {
    const u = new URL(url);
    return u.hostname;
  } catch { return url.slice(0, 30); }
}

const qualityConstraints: Record<string, { width: number; height: number; frameRate: number; videoBitsPerSecond: number }> = {
  low: { width: 1280, height: 720, frameRate: 24, videoBitsPerSecond: 2_000_000 },
  medium: { width: 1920, height: 1080, frameRate: 30, videoBitsPerSecond: 5_000_000 },
  high: { width: 2560, height: 1440, frameRate: 60, videoBitsPerSecond: 10_000_000 },
};

async function startRecording() {
  starting.value = true;
  error.value = null;
  try {
    const q = qualityConstraints[options.quality];
    const displayConstraints: DisplayMediaStreamOptions = {
      video: { width: { ideal: q.width }, height: { ideal: q.height }, frameRate: { ideal: q.frameRate } } as any,
      audio: options.systemAudio,
    };

    // 选标签页模式：chrome.tabCapture 定向采集所选标签页（标签页音频内含，无需系统音频开关）；
    // 屏幕模式：getDisplayMedia 弹系统选择器
    if (sourceType.value === 'tab' && selectedSource.value) {
      const consumerTabId = Number(selectedSource.value.id);
      if (!Number.isFinite(consumerTabId)) throw new Error('标签页无效，请重新选择');
      stream = await new Promise<MediaStream>((resolve, reject) => {
        try {
          chrome.tabCapture.getMediaStream({ consumerTabId }, (s) => {
            const err = chrome.runtime.lastError;
            if (err || !s) {
              reject(new Error(err?.message || '标签页采集失败（需 Chrome 且页面未被浏览器策略限制）'));
              return;
            }
            resolve(s);
          });
        } catch (e) {
          reject(e instanceof Error ? e : new Error(String(e)));
        }
      });
    } else {
      stream = await navigator.mediaDevices.getDisplayMedia(displayConstraints);
    }

    // 叠加麦克风
    if (options.microphone) {
      try {
        const mic = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        mic.getAudioTracks().forEach(t => stream!.addTrack(t));
      } catch (e) {
        console.warn('麦克风获取失败，已忽略', e);
      }
    }

    chunks = [];
    const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9,opus')
      ? 'video/webm;codecs=vp9,opus'
      : 'video/webm';

    mediaRecorder = new MediaRecorder(stream, {
      mimeType,
      videoBitsPerSecond: q.videoBitsPerSecond,
    });

    mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };

    // 开启页面画笔覆盖层（走自动注入通道：页面在扩展重载前打开也能出现工具栏）
    try {
      let targetTabId: number | undefined;
      if (sourceType.value === 'tab' && selectedSource.value) {
        targetTabId = Number(selectedSource.value.id);
      } else {
        const t = await chrome.tabs.query({ active: true, currentWindow: true });
        targetTabId = t[0]?.id;
      }
      if (targetTabId != null && Number.isFinite(targetTabId)) {
        annotTabId.value = targetTabId;
        // frameId: 0 → 只在顶层 frame 创建覆盖层（避免 iframe 重复弹工具栏）
        await sendMessageToTab(targetTabId, { type: MessageType.ANNOTATE_TOGGLE, payload: { active: true } }, { frameId: 0 });
      }
    } catch {
      toast.info('该页面不支持画笔工具（浏览器内部页，或页面需刷新后重试）');
    }
    mediaRecorder.onstop = () => finalizeRecording();
    mediaRecorder.start(1000); // 每秒切片

    // 监听流停止（用户在系统弹窗点了停止）
    stream.getVideoTracks()[0].addEventListener('ended', () => { if (recording.value) stopRecording(); });

    recording.value = true;
    recordingStartTime = Date.now();
    elapsedSeconds.value = 0;
    timerInterval = window.setInterval(() => { elapsedSeconds.value = Math.floor((Date.now() - recordingStartTime) / 1000); }, 1000);

  } catch (e: any) {
    if (e?.name === 'NotAllowedError') {
      error.value = '已取消或权限被拒绝，请允许屏幕录制权限';
    } else {
      error.value = e?.message || '启动录制失败';
    }
  } finally {
    starting.value = false;
  }
}

function togglePause() {
  if (!mediaRecorder) return;
  if (paused.value) {
    mediaRecorder.resume();
    timerInterval = window.setInterval(() => { elapsedSeconds.value = Math.floor((Date.now() - recordingStartTime) / 1000); }, 1000);
  } else {
    mediaRecorder.pause();
    if (timerInterval) clearInterval(timerInterval);
  }
  paused.value = !paused.value;
}

async function closeAnnotate() {
  const tabId = annotTabId.value;
  annotTabId.value = undefined;
  if (tabId == null) return;
  try {
    await sendMessageToTab(tabId, { type: MessageType.ANNOTATE_TOGGLE, payload: { active: false } }, { frameId: 0 });
  } catch { /* noop */ }
}

function stopRecording() {
  void closeAnnotate();
  if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    mediaRecorder.stop();
  }
  stream?.getTracks().forEach(t => t.stop());
  recording.value = false;
  paused.value = false;
}

function finalizeRecording() {
  const blob = new Blob(chunks, { type: 'video/webm' });
  const url = URL.createObjectURL(blob);
  const duration = formatDuration(elapsedSeconds.value);
  const size = formatBytes(blob.size);
  const name = `录制_${new Date().toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).replace(/[\/:]/g, '-')}.webm`;
  recordings.value.unshift({ id: `rec_${Date.now()}`, name, duration, size, blob, url, createdAt: Date.now() });
  chunks = [];
  mediaRecorder = null;
  stream = null;
}

function downloadRecording(rec: RecordingFile) {
  const a = document.createElement('a');
  a.href = rec.url;
  a.download = rec.name;
  a.click();
}

function openInEditor(rec: RecordingFile) {
  emit('open-editor', rec);
}

function deleteRecording(rec: RecordingFile) {
  URL.revokeObjectURL(rec.url);
  recordings.value = recordings.value.filter(r => r.id !== rec.id);
}

function formatDuration(s: number) {
  const m = Math.floor(s / 60), sec = s % 60;
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

function formatBytes(b: number) {
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`;
  return `${(b / 1024 / 1024).toFixed(1)} MB`;
}

onMounted(() => { if (sourceType.value === 'tab') refreshTabs(); });
onBeforeUnmount(() => { if (recording.value) stopRecording(); if (timerInterval) clearInterval(timerInterval); });
</script>

<style scoped>
.annot-hint {
  margin: 8px 16px 0;
  padding: 7px 10px;
  border: 1px solid rgba(245, 158, 11, 0.35);
  background: rgba(245, 158, 11, 0.10);
  color: #d97706;
  border-radius: 8px;
  font-size: 12px;
  line-height: 1.5;
}
.screen-record-panel { display: flex; flex-direction: column; gap: 0; }

/* header */
.setup-header { padding: 14px 14px 10px; }
.pt { font-size: 15px; font-weight: 600; color: var(--sp-color-heading); }
.ps { font-size: 11px; color: var(--sp-color-muted); margin-top: 2px; }

/* recording overlay */
.recording-overlay {
  padding: 20px 14px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 14px;
  background: rgba(239,68,68,0.04);
  border-bottom: 1px solid var(--sp-color-border);
}

.recording-status {
  display: flex;
  align-items: center;
  gap: 10px;
}

.rec-pulse {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: #ef4444;
  animation: pulse-red 1.2s ease infinite;
  flex-shrink: 0;
}

@keyframes pulse-red {
  0%, 100% { opacity: 1; box-shadow: 0 0 0 0 rgba(239,68,68,0.5); }
  50% { opacity: 0.8; box-shadow: 0 0 0 6px rgba(239,68,68,0); }
}

.rec-label {
  font-size: 13px;
  font-weight: 600;
  color: #ef4444;
  text-transform: uppercase;
  letter-spacing: 0.1em;
}

.rec-timer {
  font-size: 28px;
  font-weight: 700;
  color: var(--sp-color-heading);
  font-family: var(--sp-font-mono, monospace);
  letter-spacing: 0.05em;
}

.recording-info {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  color: var(--sp-color-muted);
  padding: 4px 10px;
  background: var(--sp-color-surface);
  border-radius: 999px;
  border: 1px solid var(--sp-color-border);
}

.recording-controls {
  display: flex;
  gap: 8px;
}

.ctrl-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 18px;
  border-radius: var(--sp-radius-lg);
  border: none;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  font-family: var(--sp-font-family);
  transition: all var(--sp-transition-fast);
}

.ctrl-btn--pause {
  background: var(--sp-color-surface);
  border: 1px solid var(--sp-color-border-strong);
  color: var(--sp-color-text);
}

.ctrl-btn--pause:hover { background: var(--sp-color-surface-hover); }

.ctrl-btn--stop {
  background: #ef4444;
  color: white;
  box-shadow: 0 2px 8px rgba(239,68,68,0.35);
}

.ctrl-btn--stop:hover { background: #dc2626; }

/* source type tabs */
.source-type-tabs {
  display: flex;
  gap: 6px;
  padding: 0 14px 10px;
}

.src-type-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 7px 14px;
  border-radius: var(--sp-radius-md);
  border: 1px solid var(--sp-color-border-strong);
  background: var(--sp-color-surface);
  color: var(--sp-color-muted);
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  font-family: var(--sp-font-family);
  transition: all var(--sp-transition-fast);
  flex: 1;
  justify-content: center;
}

.src-type-btn:hover { color: var(--sp-color-text); border-color: var(--sp-color-border-hover); }
.src-type-btn.active {
  background: var(--sp-color-primary-light);
  border-color: var(--sp-color-primary);
  color: var(--sp-color-primary);
}

.src-type-icon { display: flex; align-items: center; }

/* options */
.options-row {
  display: flex;
  flex-direction: column;
  gap: 0;
  margin: 0 14px 10px;
  border: 1px solid var(--sp-color-border);
  border-radius: var(--sp-radius-md);
  overflow: hidden;
  background: var(--sp-color-surface);
}

.opt-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 9px 12px;
  border-bottom: 1px solid var(--sp-color-border);
  cursor: pointer;
  transition: background var(--sp-transition-fast);
}

.opt-item:last-child { border-bottom: none; }
.opt-item:hover { background: var(--sp-color-surface-hover); }

.opt-label {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 12px;
  color: var(--sp-color-text);
  user-select: none;
}

/* quality */
.quality-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 14px 10px;
  gap: 10px;
}

.quality-label { font-size: 11px; color: var(--sp-color-muted); flex-shrink: 0; }

.quality-opts { display: flex; gap: 4px; }

.quality-btn {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 5px 12px;
  border-radius: var(--sp-radius-sm);
  border: 1px solid var(--sp-color-border-strong);
  background: var(--sp-color-surface);
  color: var(--sp-color-text-secondary);
  font-size: 11px;
  font-weight: 500;
  cursor: pointer;
  font-family: var(--sp-font-family);
  transition: all var(--sp-transition-fast);
  line-height: 1.3;
}

.quality-btn.active {
  border-color: var(--sp-color-primary);
  background: var(--sp-color-primary-light);
  color: var(--sp-color-primary);
}

.quality-hint { font-size: 11px; opacity: 0.7; }

/* source list */
.source-list { margin: 0 14px 10px; }

.source-list__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 11px;
  font-weight: 600;
  color: var(--sp-color-muted);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  margin-bottom: 6px;
  padding: 0 2px;
}

.refresh-btn {
  background: none;
  border: none;
  cursor: pointer;
  color: var(--sp-color-muted);
  display: flex;
  align-items: center;
  padding: 2px;
  transition: color var(--sp-transition-fast), transform var(--sp-transition-fast);
}

.refresh-btn:hover { color: var(--sp-color-primary); }
.refresh-btn.spinning svg { animation: spin 0.8s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }

.source-loading {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 14px;
  font-size: 11px;
  color: var(--sp-color-muted);
  justify-content: center;
}

.mini-spinner {
  width: 14px; height: 14px;
  border-radius: 50%;
  border: 2px solid var(--sp-color-border-strong);
  border-top-color: var(--sp-color-primary);
  animation: spin 0.8s linear infinite;
}

.tab-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
  max-height: 200px;
  overflow-y: auto;
  border: 1px solid var(--sp-color-border);
  border-radius: var(--sp-radius-md);
  overflow: hidden;
  background: var(--sp-color-bg-elevated);
}

.source-item {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 8px 10px;
  background: transparent;
  border: none;
  cursor: pointer;
  text-align: left;
  font-family: var(--sp-font-family);
  transition: background var(--sp-transition-fast);
  border-bottom: 1px solid var(--sp-color-border);
}

.source-item:last-child { border-bottom: none; }
.source-item:hover { background: var(--sp-color-bg-subtle); }
.source-item.selected { background: var(--sp-color-primary-light); }

.source-item__thumb {
  width: 24px;
  height: 24px;
  border-radius: 5px;
  background: var(--sp-color-surface);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  color: var(--sp-color-muted);
  overflow: hidden;
}

.source-item__info { flex: 1; min-width: 0; }
.source-item__name { font-size: 11px; font-weight: 500; color: var(--sp-color-text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.source-item__url { font-size: 11px; color: var(--sp-color-muted); margin-top: 1px; }
.source-item__check { color: var(--sp-color-primary); flex-shrink: 0; }
.source-empty { padding: 16px; text-align: center; font-size: 11px; color: var(--sp-color-muted); }

/* screen hint */
.screen-hint {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  padding: 16px 14px;
  text-align: center;
}

.screen-hint__icon {
  width: 56px;
  height: 56px;
  border-radius: 14px;
  background: var(--sp-color-surface);
  border: 1px solid var(--sp-color-border);
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--sp-color-muted);
}

.screen-hint__text { font-size: 11px; color: var(--sp-color-text-secondary); line-height: 1.6; }

.screen-hint__tips { display: flex; gap: 5px; flex-wrap: wrap; justify-content: center; }
.hint-chip {
  font-size: 11px;
  padding: 3px 8px;
  background: var(--sp-color-surface);
  border: 1px solid var(--sp-color-border-strong);
  border-radius: 999px;
  color: var(--sp-color-muted);
}

/* start button */
.start-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  width: calc(100% - 28px);
  margin: 0 14px 14px;
  padding: 11px 0;
  border-radius: var(--sp-radius-lg);
  border: none;
  background: #ef4444;
  color: white;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  font-family: var(--sp-font-family);
  transition: all var(--sp-transition-fast);
  box-shadow: 0 2px 12px rgba(239,68,68,0.3);
}

.start-btn:hover:not(:disabled) { background: #dc2626; box-shadow: 0 4px 16px rgba(239,68,68,0.4); transform: translateY(-1px); }
.start-btn:disabled, .start-btn.disabled { opacity: 0.45; cursor: not-allowed; box-shadow: none; transform: none; }

.btn-spinner {
  width: 14px; height: 14px;
  border-radius: 50%;
  border: 2px solid rgba(255,255,255,0.35);
  border-top-color: white;
  animation: spin 0.7s linear infinite;
}

/* toggle */
.tgl {
  width: 30px; height: 17px;
  background: var(--sp-color-bg-elevated);
  border-radius: 999px;
  border: 1px solid var(--sp-color-border-strong);
  cursor: pointer;
  position: relative;
  transition: background var(--sp-transition-fast);
  flex-shrink: 0;
}
.tgl.on { background: var(--sp-color-primary); border-color: transparent; }
.tgl::after {
  content: '';
  position: absolute;
  top: 2px; left: 2px;
  width: 11px; height: 11px;
  border-radius: 50%;
  background: var(--sp-color-muted);
  transition: left var(--sp-transition-fast), background var(--sp-transition-fast);
}
.tgl.on::after { left: 15px; background: white; }

/* recordings list */
.recordings-list {
  border-top: 1px solid var(--sp-color-border);
  padding: 12px 14px;
}

.recordings-list__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 11px;
  font-weight: 600;
  color: var(--sp-color-muted);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  margin-bottom: 8px;
}

.recordings-count {
  background: var(--sp-color-surface);
  border: 1px solid var(--sp-color-border);
  border-radius: 999px;
  font-size: 11px;
  padding: 1px 6px;
  color: var(--sp-color-text);
}

.rec-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 0;
  border-bottom: 1px solid var(--sp-color-border);
}

.rec-item:last-child { border-bottom: none; }

.rec-item__icon {
  width: 30px; height: 30px;
  border-radius: 8px;
  background: rgba(239,68,68,0.1);
  border: 1px solid rgba(239,68,68,0.2);
  color: #ef4444;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.rec-item__info { flex: 1; min-width: 0; }
.rec-item__name { font-size: 11px; font-weight: 500; color: var(--sp-color-text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.rec-item__meta { display: flex; align-items: center; gap: 6px; margin-top: 2px; font-size: 11px; color: var(--sp-color-muted); }

.rec-item__actions { display: flex; gap: 4px; flex-shrink: 0; }

.icon-btn {
  width: 26px; height: 26px;
  border-radius: var(--sp-radius-sm);
  border: 1px solid var(--sp-color-border-strong);
  background: var(--sp-color-surface);
  color: var(--sp-color-muted);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all var(--sp-transition-fast);
}

.icon-btn:hover { color: var(--sp-color-text); border-color: var(--sp-color-border-hover); }
.icon-btn--primary { color: var(--sp-color-primary); border-color: var(--sp-color-primary-glow); background: var(--sp-color-primary-light); }
.icon-btn--primary:hover { background: var(--sp-color-primary); color: white; border-color: transparent; }
.icon-btn--danger:hover { background: var(--sp-color-danger-light); color: var(--sp-color-danger); border-color: rgba(239,68,68,0.3); }

.chip { display:inline-flex; align-items:center; padding:1px 6px; border-radius:999px; font-size: 11px; font-weight:600; }
.chip-green { background: var(--sp-color-success-light); color: var(--sp-color-success); }

/* error banner */
.error-banner {
  display: flex;
  align-items: flex-start;
  gap: 7px;
  margin: 8px 14px;
  padding: 9px 11px;
  background: var(--sp-color-danger-light);
  border: 1px solid rgba(239,68,68,0.25);
  border-radius: var(--sp-radius-md);
  color: var(--sp-color-danger);
  font-size: 11px;
  line-height: 1.4;
}

.error-banner span { flex: 1; }

.banner-close {
  background: none; border: none; cursor: pointer;
  color: var(--sp-color-danger); opacity: 0.6; padding: 0;
  display: flex; align-items: center; flex-shrink: 0; margin-top: 1px;
  transition: opacity var(--sp-transition-fast);
}
.banner-close:hover { opacity: 1; }
</style>
