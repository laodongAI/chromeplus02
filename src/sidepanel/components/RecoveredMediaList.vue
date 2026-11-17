<template>
  <div v-if="items.length" class="recovered">
    <div class="recovered__head">
      <span class="recovered__title">回收到的媒体地址</span>
      <span class="recovered__tip">来自页面资源账本与脚本扫描，非实时嗅探；只能下载，不能录制（录制需要页面上的播放元素）</span>
      <BaseButton size="xs" variant="ghost" @click="load">刷新</BaseButton>
    </div>
    <ul class="recovered__list" aria-label="回收媒体列表">
      <li v-for="item in items" :key="item.url" class="recovered__row">
        <BaseTag size="sm" variant="neutral">{{ viaLabel(item.via) }}</BaseTag>
        <BaseTag v-if="formatLabel(item)" size="sm" variant="neutral">{{ formatLabel(item) }}</BaseTag>
        <span class="recovered__url" :title="item.url">{{ shortUrl(item.url) }}</span>
        <span v-if="item.size" class="recovered__size">{{ sizeLabel(item.size) }}</span>
        <BaseButton
          size="xs"
          variant="ghost"
          :loading="busyUrl === item.url"
          :disabled="!!busyUrl || item.streamOnly"
          :title="item.streamOnly ? '该地址取不回独立文件，请改用录制' : '加入下载队列'"
          @click="download(item)"
        >{{ item.streamOnly ? '仅可录制' : '下载' }}</BaseButton>
      </li>
    </ul>
  </div>
</template>

<script setup lang="ts">
/**
 * 候选回收结果列表（Round 5 #29）。
 *
 * 为什么单开一块：视频面板的行来自 DOM 里的 <video>，按 index 定位元素才能录制/下载；
 * 缓存捕捉与深度搜索找回的是「页面上没有播放元素的地址」（懒加载清单、上一帧播过的资源），
 * 把它们伪装成视频行会让录制按钮指向不存在的元素。
 * 音频面板不受此限制（回收条目已并入其列表），所以本组件只挂在视频面板。
 */
import { onBeforeUnmount, ref } from 'vue';
import { BaseButton, BaseTag } from './base';
import { MessageType } from '@/messaging';
import { sendRuntimeMessage } from '../utils/chromeMessaging';
// 下载台账：入队统一走 service，由它附带当前页面作为来源页
import { addDownload, startHlsDownload } from '../services/downloadQueue';
import { formatLabelOf, sizeLabelOf, type MediaMetaFacts } from '@/core/mediaMeta';
import { toast } from '../composables/useToast';

const props = defineProps<{ tabId: number | null; frameId?: number | null }>();

/** 一条回收到的候选（via 非 network 的嗅探存量项） */
interface RecoveredItem {
  url: string;
  kind?: string;
  via?: string;
  mimeType?: string;
  extension?: string;
  size?: number;
  streamOnly?: boolean;
}

const items = ref<RecoveredItem[]>([]);
/** 正在下载的一条 URL（同一时刻只允许一条，避免重复入队） */
const busyUrl = ref('');

async function load(): Promise<void> {
  if (typeof props.tabId !== 'number') { items.value = []; return; }
  try {
    const resp: any = await sendRuntimeMessage({
      type: MessageType.GET_CAPTURED_VIDEO_SOURCES,
      tabId: props.tabId,
      ...(typeof props.frameId === 'number' ? { frameId: props.frameId } : {})
    });
    const list: RecoveredItem[] = Array.isArray(resp?.sources) ? resp.sources : [];
    // 嗅探条目已经出现在各视频行的直链里，这里只列回收路径找回的，避免重复展示
    items.value = list.filter((s) => s?.url && s.via && s.via !== 'network');
  } catch {
    items.value = [];
  }
}

async function download(item: RecoveredItem): Promise<void> {
  busyUrl.value = item.url;
  try {
    if (item.kind === 'hls' || item.kind === 'dash') {
      // 经 service 入队：自动附带当前页面作为来源，台账「只看本页」才认得分段流任务
      const resp = await startHlsDownload(item.url);
      if (!resp?.success) throw new Error(resp?.error || '分段流任务创建失败');
      toast.success(item.kind === 'hls' ? '已加入 HLS 下载队列' : '已加入 DASH 下载队列');
      return;
    }
    // 直链：同样经 service 入队，来源页字段与 HLS 路径保持一致
    const id = await addDownload(item.url, undefined, item.kind === 'audio' ? 'audio' : 'video');
    if (!id) throw new Error('入队失败');
    toast.success('已加入下载队列');
  } catch (e) {
    toast.error(`下载失败：${(e as Error)?.message || String(e)}`);
  } finally {
    busyUrl.value = '';
  }
}

function viaLabel(via?: string): string {
  if (via === 'cache') return '缓存捕捉';
  if (via === 'deep') return '深度搜索';
  return '回收';
}

function formatLabel(item: RecoveredItem): string {
  const facts: MediaMetaFacts = { url: item.url, mimeType: item.mimeType, extension: item.extension };
  return formatLabelOf(facts) || '';
}

function sizeLabel(bytes: number): string {
  return sizeLabelOf(bytes);
}

function shortUrl(url: string): string {
  try {
    const u = new URL(url);
    const path = `${u.host}${u.pathname}`;
    return path.length > 60 ? `…${path.slice(-60)}` : path;
  } catch {
    return url.length > 60 ? `…${url.slice(-60)}` : url;
  }
}

/** 面板切走后后台仍持有存量；挂载后读一次，并在面板可见时低频刷新（回收结果不要求秒级实时） */
void load();
const timer = window.setInterval(() => {
  if (document.visibilityState === 'visible') void load();
}, 5000);
onBeforeUnmount(() => window.clearInterval(timer));
</script>

<style scoped>
.recovered {
  margin-top: 10px;
  padding: 8px;
  border: 1px solid var(--sp-color-border);
  border-radius: 6px;
  background: var(--sp-color-bg-elevated);
}

.recovered__head {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.recovered__title {
  font-size: 12px;
  font-weight: 600;
  color: var(--sp-color-text);
}

.recovered__tip {
  flex: 1 1 160px;
  font-size: 11px;
  color: var(--sp-color-text-secondary, var(--sp-color-text));
}

.recovered__list {
  margin: 6px 0 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.recovered__row {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
}

.recovered__url {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
}

.recovered__size {
  flex: 0 0 auto;
  color: var(--sp-color-text-secondary, var(--sp-color-text));
}
</style>
