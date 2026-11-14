<template>
  <span class="sweep-controls">
    <BaseButton
      size="sm"
      variant="ghost"
      :loading="ledgerBusy"
      :disabled="deepBusy"
      title="读取页面自己的资源账本（performance 记录 + Cache Storage），找回嗅探开始前已经播过的媒体"
      @click="runLedger"
    >缓存捕捉</BaseButton>
    <BaseButton
      size="sm"
      variant="ghost"
      :loading="deepBusy"
      :disabled="ledgerBusy"
      title="抓取页面已加载的 JS 正文，扫描其中写死的懒加载媒体地址；候选需实测可取回才进列表"
      @click="runDeep"
    >深度搜索</BaseButton>
    <span v-if="note" class="sweep-controls__note">{{ note }}</span>
  </span>
</template>

<script setup lang="ts">
/**
 * 媒体候选回收按钮组（Round 5 #29，音视频面板共用）。
 *
 * 为什么需要它：嗅探（webRequest）只能看见扩展活着之后的请求。
 * SPA 换页、侧栏开得晚、后台 SW 休眠期间加载过的媒体，列表里就是空的，
 * 而这两条路径拿的都是页面自己已经付过费的信息：
 *  - 缓存捕捉：performance 资源计时 + Cache Storage 的已加载清单；
 *  - 深度搜索：已下载 JS 里的字符串字面量（懒加载地址常写死在播放器代码里）。
 * 平台边界：Chrome 不给扩展 HTTP 缓存枚举接口（CDP getCachedResources 已移除），
 * 所以这里是「已加载 URL 找回」，不是「磁盘缓存文件导出」。
 */
import { ref } from 'vue';
import { BaseButton } from './base';
import { MessageType, type MediaSweepResult } from '@/messaging';
import { sendRuntimeMessage } from '../utils/chromeMessaging';
import { toast } from '../composables/useToast';

const emit = defineEmits<{ (e: 'done'): void }>();

/** 缓存捕捉进行中 */
const ledgerBusy = ref(false);
/** 深度搜索进行中 */
const deepBusy = ref(false);
/** 上一次回收的说明（降级原因或部分结果，随下一次操作清空） */
const note = ref('');

async function run(type: MessageType.MEDIA_LEDGER_SCAN | MessageType.MEDIA_DEEP_SCAN, busy: typeof ledgerBusy): Promise<void> {
  busy.value = true;
  note.value = '';
  try {
    const resp = await sendRuntimeMessage<MediaSweepResult>({ type });
    if (!resp?.success) {
      toast.error(resp?.error || '候选回收失败');
      return;
    }
    const added = resp.added || 0;
    note.value = resp.note || '';
    if (added > 0) toast.success(`新找回 ${added} 条候选`);
    else toast.info(resp.note || '没有新候选（可能确实没有更多可回收的资源）');
    emit('done');
  } catch (e) {
    toast.error(`候选回收失败：${(e as Error)?.message || String(e)}`);
  } finally {
    busy.value = false;
  }
}

function runLedger(): void { void run(MessageType.MEDIA_LEDGER_SCAN, ledgerBusy); }
function runDeep(): void { void run(MessageType.MEDIA_DEEP_SCAN, deepBusy); }
</script>

<style scoped>
.sweep-controls {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.sweep-controls__note {
  font-size: 11px;
  color: var(--sp-color-text-secondary, var(--sp-color-text));
}
</style>
