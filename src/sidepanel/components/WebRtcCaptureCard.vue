<template>
  <div class="rtc">
    <div class="rtc__head">
      <span class="rtc__title">WebRTC 录流</span>
      <button
        type="button"
        class="toggle"
        :class="{ 'is-on': enabled }"
        role="switch"
        :aria-checked="enabled"
        :disabled="busy"
        :title="enabled ? '关闭后不再注入捕获脚本' : '开启后需刷新页面才能挂上已存在的连接'"
        @click="toggle"
      ></button>
      <BaseButton v-if="enabled" size="xs" variant="ghost" :loading="busy" @click="refresh">刷新</BaseButton>
    </div>
    <div class="rtc__tip">
      录制网页里 RTCPeerConnection 的远端音视频（在线通话、WebRTC 低延迟直播）。只录对端推来的流，不录本机摄像头/麦克风。
      <template v-if="enabled">开启后需<strong>刷新页面</strong>才能捕获；产物进入下方「录制成果」列表。</template>
    </div>
    <div v-if="error" class="rtc__error">{{ error }}</div>
    <ul v-if="enabled && streams.length" class="rtc__list" aria-label="WebRTC 流列表">
      <li v-for="s in streams" :key="s.id" class="rtc__row">
        <BaseTag size="sm" variant="neutral">{{ describeRtcStream(s) }}</BaseTag>
        <span class="rtc__spacer"></span>
        <template v-if="recordIdOf(s.id)">
          <BaseTag size="sm" variant="warning">录制中</BaseTag>
          <BaseButton size="xs" variant="ghost" @click="stop(s.id)">停止</BaseButton>
        </template>
        <template v-else>
          <BaseButton size="xs" variant="ghost" :disabled="busy" @click="start(s, 'video')">录制</BaseButton>
          <BaseButton v-if="s.kind === 'mixed'" size="xs" variant="ghost" :disabled="busy" @click="start(s, 'audio')">仅录音</BaseButton>
        </template>
      </li>
    </ul>
    <div v-else-if="enabled" class="rtc__empty">
      尚未检测到远端流。请在页面上发起/加入通话或打开 WebRTC 直播，然后点「刷新」。
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * WebRTC 录流卡片（Round 5 #30）。
 *
 * 为什么单独一块而不是并进视频行：视频行按 DOM 里的 <video> index 定位元素，
 * 而 WebRTC 流可能根本没有对应的播放元素（有的站点直接把流喂给 canvas 或 WebAudio），
 * 伪装成视频行会让录制按钮指向不存在的元素。
 *
 * 开关驱动动态注入：关闭时扩展不往任何页面注入 MAIN 世界脚本，
 * 避免给所有站点凭空加一层 RTCPeerConnection 包装。
 */
import { onBeforeUnmount, ref, watch } from 'vue';
import { BaseButton, BaseTag } from './base';
import { MessageType } from '@/messaging';
import { describeRtcStream, type RtcStreamInfo } from '@/core/webrtcCapture';
import { sendRuntimeMessage } from '../utils/chromeMessaging';
import { toast } from '../composables/useToast';

const props = defineProps<{ tabId: number | null }>();

const enabled = ref(false);
const streams = ref<RtcStreamInfo[]>([]);
const busy = ref(false);
const error = ref('');
/** recordId → 状态（后台广播） */
const recording = ref<Record<string, 'recording' | 'stopped' | 'error'>>({});
/** streamId → recordId（本面板发起的录制，用于把停止按钮挂回对应行） */
const recordByStream = ref<Record<string, string>>({});

function recordIdOf(streamId: string): string {
  const id = recordByStream.value[streamId];
  return id && recording.value[id] === 'recording' ? id : '';
}

async function refresh(): Promise<void> {
  busy.value = true;
  error.value = '';
  try {
    const resp: any = await sendRuntimeMessage({
      type: MessageType.WEBRTC_CAPTURE_STATUS,
      ...(typeof props.tabId === 'number' ? { tabId: props.tabId } : {})
    });
    enabled.value = resp?.enabled === true;
    streams.value = Array.isArray(resp?.streams) ? resp.streams : [];
    recording.value = resp?.recording && typeof resp.recording === 'object' ? resp.recording : {};
  } catch (e) {
    error.value = `读取 WebRTC 状态失败：${(e as Error)?.message || String(e)}`;
  } finally {
    busy.value = false;
  }
}

async function toggle(): Promise<void> {
  busy.value = true;
  error.value = '';
  const next = !enabled.value;
  try {
    const resp: any = await sendRuntimeMessage({ type: MessageType.WEBRTC_CAPTURE_TOGGLE, enabled: next });
    if (!resp?.success) { error.value = resp?.error || '开关切换失败'; return; }
    enabled.value = next;
    recordByStream.value = {};
    recording.value = {};
    if (next) {
      streams.value = [];
      toast.info('已开启 WebRTC 捕获，请刷新目标页面后再点「刷新」');
    } else {
      streams.value = [];
    }
  } catch (e) {
    error.value = `开关切换失败：${(e as Error)?.message || String(e)}`;
  } finally {
    busy.value = false;
  }
}

async function start(s: RtcStreamInfo, mode: 'video' | 'audio'): Promise<void> {
  if (typeof props.tabId !== 'number') { error.value = '未绑定标签页'; return; }
  busy.value = true;
  error.value = '';
  try {
    const resp: any = await sendRuntimeMessage({
      type: MessageType.WEBRTC_CAPTURE_START,
      tabId: props.tabId,
      streamId: s.id,
      mode
    });
    if (!resp?.success || !resp.recordId) { error.value = resp?.error || '启动录制失败'; return; }
    recordByStream.value = { ...recordByStream.value, [s.id]: resp.recordId };
    recording.value = { ...recording.value, [resp.recordId]: 'recording' };
    toast.success(mode === 'audio' ? '已开始录制音频' : '已开始录制');
  } catch (e) {
    error.value = `启动录制失败：${(e as Error)?.message || String(e)}`;
  } finally {
    busy.value = false;
  }
}

async function stop(streamId: string): Promise<void> {
  const recordId = recordByStream.value[streamId];
  if (!recordId) return;
  busy.value = true;
  try {
    const resp: any = await sendRuntimeMessage({ type: MessageType.WEBRTC_CAPTURE_STOP, recordId });
    if (!resp?.success) { error.value = resp?.error || '停止失败'; return; }
    toast.info('已停止，产物正在入库');
  } catch (e) {
    error.value = `停止失败：${(e as Error)?.message || String(e)}`;
  } finally {
    busy.value = false;
  }
}

/** 后台广播：流清单/录制状态变化（页面里新出现一路流时不必手动刷新） */
function onMessage(msg: any): void {
  if (msg?.type !== MessageType.WEBRTC_CAPTURE_UPDATE) return;
  if (typeof props.tabId === 'number' && msg.tabId !== props.tabId) return;
  streams.value = Array.isArray(msg.streams) ? msg.streams : [];
  recording.value = msg.recording && typeof msg.recording === 'object' ? msg.recording : {};
  if (msg.error) error.value = String(msg.error);
}

try { chrome.runtime.onMessage.addListener(onMessage); } catch { /* 非扩展环境（单测） */ }
onBeforeUnmount(() => {
  try { chrome.runtime.onMessage.removeListener(onMessage); } catch { /* noop */ }
});

watch(() => props.tabId, () => { recordByStream.value = {}; void refresh(); });
void refresh();
</script>

<style scoped>
.rtc {
  margin-top: 10px;
  padding: 8px;
  border: 1px solid var(--sp-color-border);
  border-radius: 6px;
  background: var(--sp-color-bg-elevated);
}

.rtc__head {
  display: flex;
  align-items: center;
  gap: 8px;
}

.rtc__title {
  font-size: 12px;
  font-weight: 600;
  color: var(--sp-color-text);
}

.rtc__tip {
  margin-top: 4px;
  font-size: 11px;
  line-height: 1.5;
  color: var(--sp-color-text-secondary, var(--sp-color-text));
}

.rtc__error {
  margin-top: 6px;
  font-size: 11px;
  color: var(--sp-color-danger, #d33);
}

.rtc__empty {
  margin-top: 6px;
  font-size: 11px;
  color: var(--sp-color-text-secondary, var(--sp-color-text));
}

.rtc__list {
  margin: 6px 0 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.rtc__row {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
}

.rtc__spacer {
  flex: 1 1 auto;
}

.toggle {
  width: 34px;
  height: 18px;
  border-radius: 9px;
  border: 1px solid var(--sp-color-border);
  background: var(--sp-color-bg);
  position: relative;
  cursor: pointer;
  padding: 0;
}

.toggle::after {
  content: '';
  position: absolute;
  top: 2px;
  left: 2px;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: var(--sp-color-text-secondary, #888);
  transition: transform 0.15s ease;
}

.toggle.is-on {
  background: var(--sp-color-primary, #3b82f6);
  border-color: var(--sp-color-primary, #3b82f6);
}

.toggle.is-on::after {
  transform: translateX(16px);
  background: #fff;
}

.toggle:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>