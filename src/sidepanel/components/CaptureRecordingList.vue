<template>
  <!-- 录制成果列表：内容脚本录制完成后经后台落库的产物在此展示。
       视频模式：查看（编辑器）/ 下载 MP4 / 删除；
       音频模式：内嵌播放器试听 / 下载 M4A / 删除。
       （修复「录制后无处查看、下载的 webm 播放不了」两类反馈） -->
  <div v-if="items.length > 0" class="caprec-list">
    <div class="caprec-header">
      <span class="caprec-title">录制成果</span>
      <span class="caprec-count">{{ items.length }}</span>
      <span class="caprec-hint">{{ mode === 'audio' ? '下载为 M4A，任意播放器可打开' : '下载为 MP4，任意播放器可打开' }}</span>
    </div>

    <div v-for="item in items" :key="item.id" class="caprec-item">
      <div class="caprec-info">
        <!-- 文件名（去扩展名展示，完整名悬停可见） -->
        <div class="caprec-name" :title="item.fileName">{{ displayName(item) }}</div>
        <!-- 时长 / 体积 / 完成时间 -->
        <div class="caprec-meta">
          {{ formatRecordingDuration(item.durationMs) }} · {{ formatBytes(item.sizeBytes) }} · {{ formatTime(item.createdAt) }}
        </div>
        <!-- 来源页面（便于用户辨认是哪次录制） -->
        <div v-if="item.sourceTitle" class="caprec-src" :title="item.sourceUrl">来自：{{ item.sourceTitle }}</div>
      </div>

      <!-- 音频模式：内嵌播放器（点击即听，无需下载） -->
      <audio
        v-if="mode === 'audio'"
        class="caprec-audio"
        :src="audioUrls[item.id] || undefined"
        controls
        preload="metadata"
      ></audio>

      <div class="caprec-actions">
        <!-- 视频：在编辑器中查看（预览/剪辑/导出） -->
        <BaseButton
          v-if="mode === 'video'"
          size="sm"
          variant="outline"
          :disabled="busy[item.id] != null"
          @click="openInEditor(item)"
        >
          查看
        </BaseButton>
        <!-- 下载（自动转码为通用格式；转码中显示 loading） -->
        <BaseButton
          size="sm"
          variant="primary"
          :loading="busy[item.id] === 'download'"
          :disabled="busy[item.id] === 'editor'"
          @click="download(item)"
        >
          {{ mode === 'audio' ? '下载 M4A' : '下载 MP4' }}
        </BaseButton>
        <!-- 删除（后台元数据 + IDB Blob 一并清理） -->
        <BaseButton
          size="sm"
          variant="ghost"
          :disabled="busy[item.id] != null"
          @click="remove(item)"
        >
          删除
        </BaseButton>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * 录制成果列表组件（视频/音频面板共用）。
 * 数据源：captureRecordingStore（后台落库的元数据列表，按 mode 过滤）。
 * 交互：
 *  - 视频条目：查看（编辑器新标签页预览）/ 下载 MP4（WebCodecs 转码）/ 删除；
 *  - 音频条目：内嵌 <audio> 试听（blob URL 按需建立）/ 下载 M4A / 删除。
 */
import { computed, onMounted, reactive, watch } from 'vue';
import type { CaptureRecordingMeta } from '@/messaging';
import {
  captureRecordings,
  deleteRecording,
  downloadRecordingConverted,
  formatRecordingDuration,
  getRecordingUrl,
  installCaptureRecordingListener,
  loadCaptureRecordings,
  openRecordingInEditor,
} from '../services/captureRecordingStore';
// 体积格式化复用全局工具（与下载管理面板同款口径，避免重复实现）
import { formatBytes } from '@/utils/format';
import BaseButton from './base/BaseButton.vue';
// 分级日志（扩展页面上下文默认 info 级）
import { createLogger } from '@/utils/logger';

/** 本组件 logger：统一 `[CaptureRecordingList]` 前缀 */
const log = createLogger('CaptureRecordingList');

/** 组件属性：列表模式（决定条目过滤与可用操作） */
const props = defineProps<{
  /** 模式：video=视频录制成果；audio=录音成果 */
  mode: 'video' | 'audio';
}>();

/** 当前模式下的成果列表（最新在前，与存储同序） */
const items = computed<CaptureRecordingMeta[]>(() =>
  captureRecordings.value.filter((x) => x.mode === props.mode)
);

/** 条目忙碌态（recordId → 'download' | 'editor'）：防重复点击 + 按钮 loading */
const busy = reactive<Record<string, 'download' | 'editor' | undefined>>({});

/** 音频条目的试听 URL（recordId → blob: URL；按需建立，避免一次性占用大量句柄） */
const audioUrls = reactive<Record<string, string>>({});

/**
 * 文件名去扩展名展示（完整名在 title 悬停可见）。
 * @param item 成果元数据
 */
function displayName(item: CaptureRecordingMeta): string {
  const dot = item.fileName.lastIndexOf('.');
  return dot > 0 ? item.fileName.slice(0, dot) : item.fileName;
}

/**
 * 时间戳 → 'MM-DD HH:mm' 展示文本（列表元信息行用）。
 * @param ts 毫秒时间戳
 */
function formatTime(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * 为音频条目按需建立试听 URL（条目出现且尚无 URL 时才取）。
 */
async function ensureAudioUrls(): Promise<void> {
  if (props.mode !== 'audio') return;
  for (const item of items.value) {
    if (audioUrls[item.id]) continue;
    const url = await getRecordingUrl(item);
    if (url) audioUrls[item.id] = url;
  }
}

/** 查看（仅视频）：在编辑器中打开预览 */
async function openInEditor(item: CaptureRecordingMeta): Promise<void> {
  busy[item.id] = 'editor';
  try {
    await openRecordingInEditor(item);
  } finally {
    busy[item.id] = undefined;
  }
}

/** 下载：自动转码为通用格式（视频 MP4 / 音频 M4A），失败由 store 内部回退 */
async function download(item: CaptureRecordingMeta): Promise<void> {
  busy[item.id] = 'download';
  log.info('开始转码下载', item.id);
  try {
    await downloadRecordingConverted(item);
  } finally {
    busy[item.id] = undefined;
  }
}

/** 删除：后台元数据 + IDB Blob 一并清理（store 内部含兜底路径） */
async function remove(item: CaptureRecordingMeta): Promise<void> {
  await deleteRecording(item);
}

onMounted(() => {
  // 安装就绪广播监听（幂等）并加载既有列表（侧栏重新打开时恢复）
  installCaptureRecordingListener();
  void loadCaptureRecordings().then(ensureAudioUrls);
});

// 列表变化（新录制完成/删除）时补齐音频试听 URL
watch(items, () => { void ensureAudioUrls(); });
</script>

<style scoped>
.caprec-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

/* 列表头：标题 + 数量 + 格式提示 */
.caprec-header {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  color: var(--sp-color-muted);
}
.caprec-title { font-weight: 600; color: var(--sp-color-text); }
.caprec-count {
  background: var(--sp-color-bg);
  border: 1px solid var(--sp-color-border);
  border-radius: 999px;
  padding: 0 6px;
  font-size: 10px;
}
.caprec-hint { margin-left: auto; font-size: 10px; }

/* 单条成果 */
.caprec-item {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px 10px;
  background: var(--sp-color-bg);
  border: 1px solid var(--sp-color-border);
  border-radius: 8px;
}

.caprec-info { min-width: 0; }
.caprec-name {
  font-size: 12px;
  font-weight: 600;
  color: var(--sp-color-heading);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.caprec-meta { font-size: 11px; color: var(--sp-color-muted); margin-top: 2px; }
.caprec-src {
  font-size: 10px;
  color: var(--sp-color-muted);
  margin-top: 2px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* 音频试听播放器：撑满条目宽度，高度收敛 */
.caprec-audio { width: 100%; height: 32px; }

/* 操作行 */
.caprec-actions {
  display: flex;
  align-items: center;
  gap: 6px;
}
</style>
