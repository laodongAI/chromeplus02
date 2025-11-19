<template>
  <div class="sidepanel-app">
    <header class="sidepanel-app__header">
      <div>
        <p class="kicker">媒体采集控制台</p>
        <h1>全站多媒体抓取中心</h1>
        <p class="lede">按功能导航切换视频/图片/音频/系统设置，统一执行扫描、批量操作与配置。</p>
      </div>
      <BaseTag variant="info">Alpha</BaseTag>
    </header>

    <div class="nav-table-wrapper">
      <table class="nav-table">
        <tbody>
          <tr>
            <td
              v-for="tab in tabs"
              :key="tab.key"
              :class="['nav-table__cell', { 'is-active': tab.key === activeTab }]"
            >
              <button class="nav-cell" type="button" @click="() => switchTab(tab.key)">
                <div class="nav-cell__row">
                  <span class="nav-cell__label">{{ tab.label }}</span>
                  <span class="nav-cell__count">{{ counts[tab.metric] ?? 0 }}</span>
                </div>
                <p class="nav-cell__desc">{{ tab.description }}</p>
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <main class="sidepanel-app__body">
      <GlobalDownloadBar />
      <component :is="activeComponent" />
    </main>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, defineAsyncComponent } from 'vue';
import { BaseTag } from './components/base';
import { provideResourceCounts } from './composables/useResourceCounts';
import GlobalDownloadBar from './components/GlobalDownloadBar.vue';

// 异步按需加载各面板，减少初始包体。
// 保留原组件名用于后续查找；首屏默认加载 video 面板。
const AsyncVideoCapturePanel = defineAsyncComponent(() => import(/* webpackChunkName: "panel-video" */ './views/VideoCapturePanel.vue'));
const AsyncImageGrabPanel = defineAsyncComponent(() => import(/* webpackChunkName: "panel-image" */ './views/ImageGrabPanel.vue'));
const AsyncAudioGrabPanel = defineAsyncComponent(() => import(/* webpackChunkName: "panel-audio" */ './views/AudioGrabPanel.vue'));
const AsyncSettingsPanel = defineAsyncComponent(() => import(/* webpackChunkName: "panel-settings" */ './views/SettingsPanel.vue'));

type TabKey = 'video' | 'image' | 'audio' | 'settings';

interface TabDefinition {
  key: TabKey;
  label: string;
  description: string;
  metric: TabKey;
  component: any;
}

const tabs: TabDefinition[] = [
  { key: 'video', label: '视频采集', description: '识别并控制页面视频，支持录制与抓帧', metric: 'video', component: AsyncVideoCapturePanel },
  { key: 'image', label: '图像抓取', description: '扫描页面图片，支持预览、复制与批量下载', metric: 'image', component: AsyncImageGrabPanel },
  { key: 'audio', label: '音频抓取', description: '提取音频资源，进行单个或批量下载', metric: 'audio', component: AsyncAudioGrabPanel },
  { key: 'settings', label: '系统设置', description: '配置扫描策略、命名模板与存储路径', metric: 'settings', component: AsyncSettingsPanel }
];

const activeTab = ref<TabKey>('video');
const { counts } = provideResourceCounts();

const activeComponent = computed(() => tabs.find((t) => t.key === activeTab.value)?.component || AsyncVideoCapturePanel);

function switchTab(key: TabKey) {
  activeTab.value = key;
}
</script>

<style scoped>
.sidepanel-app {
  min-height: 100vh;
  padding: var(--sp-spacing-5);
  display: flex;
  flex-direction: column;
  gap: var(--sp-spacing-5);
}

.sidepanel-app__header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: var(--sp-spacing-4);
}

.kicker {
  margin: 0;
  font-size: 12px;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  color: var(--sp-color-muted);
}

h1 {
  margin: 4px 0;
  font-size: 22px;
  color: var(--sp-color-heading);
}

.lede {
  margin: 0;
  color: var(--sp-color-muted);
}

.nav-table-wrapper {
  border-radius: var(--sp-radius-lg);
  overflow: hidden;
  border: 1px solid rgba(255, 255, 255, 0.06);
  background: rgba(15, 23, 38, 0.7);
}

.nav-table {
  width: 100%;
  border-collapse: collapse;
}

.nav-table__cell {
  border-right: 1px solid rgba(255, 255, 255, 0.04);
  padding: 0;
}

.nav-table__cell:last-child {
  border-right: none;
}

.nav-table__cell.is-active {
  background: rgba(79, 156, 255, 0.08);
}

.nav-cell {
  width: 100%;
  border: none;
  background: transparent;
  color: inherit;
  padding: var(--sp-spacing-4);
  text-align: left;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.nav-cell:hover {
  background: rgba(79, 156, 255, 0.05);
}

.nav-cell__row {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.nav-cell__label {
  font-size: 15px;
  font-weight: 600;
  color: var(--sp-color-heading);
}

.nav-cell__count {
  font-size: 12px;
  color: var(--sp-color-muted);
  background: rgba(255, 255, 255, 0.06);
  padding: 2px 8px;
  border-radius: 999px;
}

.nav-cell__desc {
  margin: 0;
  font-size: 13px;
  color: var(--sp-color-muted);
}

.sidepanel-app__body {
  flex: 1;
}

@media (max-width: 640px) {
  .nav-table__cell {
    display: block;
    border-right: none;
    border-bottom: 1px solid rgba(255, 255, 255, 0.04);
  }
}
</style>
