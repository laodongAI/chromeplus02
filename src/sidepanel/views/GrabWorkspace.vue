<template>
  <div class="grab-workspace">
    <!-- 子模式分段行：图片 | 视频 | 音频 | 文本 | 接口 | 资源包（可访问 tablist，←/→ 切换） -->
    <div class="grab-workspace__segbar">
      <BaseSegmented
        id-base="grab"
        aria-label="抓取子模式"
        size="sm"
        :items="segmentItems"
        :model-value="segmentModel"
        @update:model-value="onSegmentSelect"
      />
    </div>

    <!-- 子模式内容区：role=tabpanel 与分段 tab 建立 aria 关联 -->
    <div class="grab-workspace__body" role="tabpanel" id="grab-panel" :aria-labelledby="`grab-tab-${segmentModel}`">
      <Suspense>
        <!-- 六个抓取面板：空状态里的「网站目录」入口通过 open-site-catalog 事件
             上抛入口层，切到一级「网站」入口（网站已与抓取同级） -->
        <component :is="activePanel" @open-site-catalog="openSiteCatalog" />
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
 * 抓取工作区（UI 二批之二：信息架构收敛）。
 * 原「抓取」组下的 图像/视频/音频/文本/Sources 五个一级 tab 收敛为本容器的
 * 分段子模式；「支持网站」（SiteCatalogPanel）已升级为一级入口（与抓取同级），
 * 不再由本容器承载——面板空状态的「网站目录」链接改为向上抛事件切换入口。
 * 面板业务逻辑零改动，只调整挂载层级。
 */
import { computed, defineAsyncComponent, type Component } from 'vue';
import BaseSegmented from '../components/base/BaseSegmented.vue';
import { useResourceCounts } from '../composables/useResourceCounts';
import { GRAB_SEGMENT_SUBS, type GrabSubKey } from '../services/navState';
// UI 三批（组6）：分段文案改引用集中术语表 GRAB_SEGMENT_LABELS
// （键与 GrabSubKey 全集一致：image/video/audio/text/network/sources）
import { GRAB_SEGMENT_LABELS } from '../utils/terminology';
// P1-8：分级日志（扩展页面上下文默认 info 级）
import { createLogger } from '@/utils/logger';

/** 本模块 logger：记录子模式切换与网站目录进出 */
const log = createLogger('GrabWorkspace');

const AsyncImageGrabPanel    = defineAsyncComponent(() => import('./ImageGrabPanel.vue'));
const AsyncVideoCapturePanel = defineAsyncComponent(() => import('./VideoCapturePanel.vue'));
const AsyncAudioGrabPanel    = defineAsyncComponent(() => import('./AudioGrabPanel.vue'));
const AsyncTextPanel         = defineAsyncComponent(() => import('./TextPanel.vue'));
const AsyncNetworkPanel      = defineAsyncComponent(() => import('./NetworkPanel.vue'));
const AsyncSourcesPanel      = defineAsyncComponent(() => import('./SourcesDownloadPanel.vue'));

/** 子模式键 → 面板组件 的渲染映射（与 navState 的 GRAB_SUB_PANEL_IDS 一一对应） */
const PANEL_BY_SUB: Record<GrabSubKey, Component> = {
  image:   AsyncImageGrabPanel,
  video:   AsyncVideoCapturePanel,
  audio:   AsyncAudioGrabPanel,
  text:    AsyncTextPanel,
  network: AsyncNetworkPanel,
  sources: AsyncSourcesPanel,
};

const props = defineProps<{
  /** 当前抓取子模式，由入口层持久化 */
  modelValue: GrabSubKey;
}>();

const emit = defineEmits<{
  (e: 'update:modelValue', sub: GrabSubKey): void;
  /** 面板空状态点击「网站目录」：由入口层切到一级「网站」入口 */
  (e: 'open-site-catalog'): void;
}>();

/** 资源计数上下文：分段项上的数量徽标沿用原 tab 徽标数据源 */
const { counts } = useResourceCounts();

/** 传给 BaseSegmented 的 modelValue：直接透传当前子模式 */
const segmentModel = computed<string>(() => props.modelValue);

/** 分段项列表（带各子模式当前资源计数徽标） */
const segmentItems = computed(() =>
  GRAB_SEGMENT_SUBS.map(sub => ({
    key: sub as string,
    label: GRAB_SEGMENT_LABELS[sub],
    // counts 的键与旧 metric 键同名，text/sources 当前无面板上报则恒为 0（不显示徽标）
    count: counts[sub],
  }))
);

/** 当前应挂载的抓取面板 */
const activePanel = computed<Component>(() => PANEL_BY_SUB[props.modelValue] ?? PANEL_BY_SUB.video);

/**
 * 分段行选择回调：向入口层同步（持久化）。
 * @param key BaseSegmented 发出的分段键（string，需收窄为 GrabSubKey）
 */
function onSegmentSelect(key: string): void {
  const sub = key as GrabSubKey;
  log.debug(`切换抓取子模式: ${sub}`);
  emit('update:modelValue', sub);
}

/** 抓取面板空状态点击「网站目录」：上抛入口层切到一级「网站」入口 */
function openSiteCatalog(): void {
  log.info('从抓取空状态请求进入网站入口');
  emit('open-site-catalog');
}
</script>

<style scoped>
.grab-workspace {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
}

/* 分段行容器：与面板区之间以边框分隔，背景跟随导航层 */
.grab-workspace__segbar {
  padding: 6px 8px;
  background: var(--sp-color-bg-elevated);
  border-bottom: 1px solid var(--sp-color-border);
  flex-shrink: 0;
}

/* 内容区：纵向滚动交由面板自身处理（与原 app-body 行为一致） */
.grab-workspace__body {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

/* 异步面板加载兜底（与 SidePanelApp 原样式一致的轻量版） */
.panel-loading {
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 12px; padding: 48px 24px;
  color: var(--sp-color-muted); font-size: 13px;
}
.panel-loading__spinner {
  width: 24px; height: 24px; border-radius: 50%;
  border: 2px solid var(--sp-color-border-strong);
  border-top-color: var(--sp-color-primary);
  animation: grab-spin 0.8s linear infinite;
}
@keyframes grab-spin { to { transform: rotate(360deg); } }
</style>
