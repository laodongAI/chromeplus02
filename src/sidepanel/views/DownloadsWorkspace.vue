<template>
  <div class="downloads-workspace">
    <!-- 子模式分段行：收集篮 | 进行中 | 历史（可访问 tablist，←/→ 切换） -->
    <div class="downloads-workspace__segbar">
      <BaseSegmented
        id-base="dl"
        aria-label="下载子页签"
        size="sm"
        :items="segmentItems"
        :model-value="modelValue"
        @update:model-value="onSegmentSelect"
      />
    </div>

    <!-- 子页签内容区：role=tabpanel 与分段 tab 建立 aria 关联 -->
    <div class="downloads-workspace__body" role="tabpanel" id="dl-panel" :aria-labelledby="`dl-tab-${modelValue}`">
      <Suspense>
        <!-- 收集篮：原 CollectionPanel 原样挂载，业务逻辑零改动 -->
        <AsyncCollectionPanel v-if="modelValue === 'basket'" />
        <!-- 进行中/历史：共用 DownloadManagerPanel，section 决定只渲染队列分节或历史分节；
             两分节数据同源于 downloadQueue / downloadHistory 服务，
             "进行中 → 历史"（完成任务进入历史）的既有语义不因拆分而丢失 -->
        <AsyncDownloadManagerPanel v-else :section="modelValue" />
        <template #fallback>
          <div class="panel-loading">
            <div class="panel-loading__spinner"></div>
            <span>加载中…</span>
          </div>
        </template>
      </Suspense>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * 下载工作区（UI 二批之二：信息架构收敛）。
 * 原一级 tab「收集篮」（CollectionPanel）与「下载」（DownloadManagerPanel）
 * 合并为"收集篮 | 进行中 | 历史"三个子页签：
 *  - 收集篮 → CollectionPanel（原样）；
 *  - 进行中 → DownloadManagerPanel section=queue（实时队列分节）；
 *  - 历史   → DownloadManagerPanel section=history（下载记录分节，
 *             全局下载条"已完成"点击即跳到这里）。
 */
import { computed, defineAsyncComponent } from 'vue';
import BaseSegmented from '../components/base/BaseSegmented.vue';
import { useResourceCounts } from '../composables/useResourceCounts';
import { DOWNLOADS_SEGMENT_SUBS, type DownloadsSubKey } from '../services/navState';
// P1-8：分级日志（扩展页面上下文默认 info 级）
import { createLogger } from '@/utils/logger';

/** 本模块 logger：记录子页签切换 */
const log = createLogger('DownloadsWorkspace');

const AsyncCollectionPanel      = defineAsyncComponent(() => import('./CollectionPanel.vue'));
const AsyncDownloadManagerPanel = defineAsyncComponent(() => import('./DownloadManagerPanel.vue'));

// 子页签值由入口层（SidePanelApp）持久化；本组件脚本不直接引用 props，
// 模板中的 modelValue/onSegmentSelect 即完成受控渲染（避免未使用变量告警）
defineProps<{
  /** 当前下载子页签，由入口层持久化 */
  modelValue: DownloadsSubKey;
}>();

const emit = defineEmits<{ (e: 'update:modelValue', sub: DownloadsSubKey): void }>();

/** 资源计数上下文：收集篮徽标沿用原 tab 徽标数据源 */
const { counts } = useResourceCounts();

/** 子页签文案表（顺序即 DOWNLOADS_SEGMENT_SUBS） */
const SEGMENT_LABELS: Record<DownloadsSubKey, string> = {
  basket: '收集篮', queue: '进行中', history: '历史',
};

/** 分段项列表：仅收集篮有计数徽标（进行中/历史的状态在下载条与列表内部呈现） */
const segmentItems = computed(() =>
  DOWNLOADS_SEGMENT_SUBS.map(sub => ({
    key: sub as string,
    label: SEGMENT_LABELS[sub],
    count: sub === 'basket' ? counts.basket : 0,
  }))
);

/**
 * 子页签选择回调：向入口层同步（持久化）。
 * @param key BaseSegmented 发出的分段键（string，收窄为 DownloadsSubKey）
 */
function onSegmentSelect(key: string): void {
  const sub = key as DownloadsSubKey;
  log.debug(`切换下载子页签: ${sub}`);
  emit('update:modelValue', sub);
}
</script>

<style scoped>
.downloads-workspace {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
}

/* 分段行容器：与内容区以边框分隔，背景跟随导航层 */
.downloads-workspace__segbar {
  padding: 6px 8px;
  background: var(--sp-color-bg-elevated);
  border-bottom: 1px solid var(--sp-color-border);
  flex-shrink: 0;
}

/* 内容区：纵向滚动交由面板自身处理（与原 app-body 行为一致） */
.downloads-workspace__body {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

/* 异步面板加载兜底 */
.panel-loading {
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 12px; padding: 48px 24px;
  color: var(--sp-color-muted); font-size: 13px;
}
.panel-loading__spinner {
  width: 24px; height: 24px; border-radius: 50%;
  border: 2px solid var(--sp-color-border-strong);
  border-top-color: var(--sp-color-primary);
  animation: dl-spin 0.8s linear infinite;
}
@keyframes dl-spin { to { transform: rotate(360deg); } }
</style>
