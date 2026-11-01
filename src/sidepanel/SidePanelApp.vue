<template>
  <div class="app">
    <header class="app-header">
      <div class="app-header__brand">
        <div class="app-logo">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>
          </svg>
        </div>
        <span class="app-logo__name">MediaPlus</span>
      </div>
      <span class="app-badge">Alpha</span>
    </header>

    <nav class="tab-nav">
      <div class="tab-groups">
        <button
          v-for="g in groups"
          :key="g.key"
          class="group-btn"
          :class="{ 'is-active': g.key === activeGroup.key }"
          @click="switchGroup(g)"
        >{{ g.label }}</button>
      </div>
      <div class="tab-row">
        <button
          v-for="tab in visibleTabs"
          :key="tab.key"
          class="tab-btn"
          :class="{ 'is-active': tab.key === activeTab, 'tab-btn--launch': tab.launch }"
          :style="tab.key === activeTab ? { '--tab-color': tab.color, '--tab-bg': tab.bgColor } : {}"
          @click="tab.launch ? launchEditor() : switchTab(tab.key)"
          :title="tab.description"
        >
          <span class="tab-btn__icon" v-html="tab.icon"></span>
          <span class="tab-btn__label">{{ tab.label }}</span>
          <span v-if="tab.launch" class="tab-btn__ext-icon">
            <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
          </span>
          <span class="tab-btn__count" v-if="(counts[tab.metric] ?? 0) > 0 && !tab.launch" :style="{ background: tab.color }">
            {{ counts[tab.metric] ?? 0 }}
          </span>
        </button>
      </div>
    </nav>

    <main class="app-body">
      <GlobalDownloadBar />
      <Suspense>
        <component
          :is="activeComponent"
          v-bind="activeTab === 'editor' ? { initialFiles: editorFiles } : {}"
          @open-editor="openInEditor"
        />
        <template #fallback>
          <div class="panel-loading">
            <div class="panel-loading__spinner"></div>
            <span>加载中…</span>
          </div>
        </template>
      </Suspense>
    </main>

    <BaseToast />
    <BaseConfirm />
  </div>
</template>

<script setup lang="ts">
import { computed, ref, defineAsyncComponent } from 'vue';
import { provideResourceCounts } from './composables/useResourceCounts';
import GlobalDownloadBar from './components/GlobalDownloadBar.vue';
import BaseToast from './components/base/BaseToast.vue';
import BaseConfirm from './components/base/BaseConfirm.vue';

const AsyncVideoCapturePanel    = defineAsyncComponent(() => import('./views/VideoCapturePanel.vue'));
const AsyncImageGrabPanel       = defineAsyncComponent(() => import('./views/ImageGrabPanel.vue'));
const AsyncAudioGrabPanel       = defineAsyncComponent(() => import('./views/AudioGrabPanel.vue'));
const AsyncTextPanel            = defineAsyncComponent(() => import('./views/TextPanel.vue'));
const AsyncDownloadManagerPanel = defineAsyncComponent(() => import('./views/DownloadManagerPanel.vue'));
const AsyncSourcesDownloadPanel = defineAsyncComponent(() => import('./views/SourcesDownloadPanel.vue'));
const AsyncSettingsPanel        = defineAsyncComponent(() => import('./views/SettingsPanel.vue'));
const AsyncScreenRecordPanel    = defineAsyncComponent(() => import('./views/ScreenRecordPanel.vue'));
const AsyncVideoEditorPanel     = defineAsyncComponent(() => import('./views/VideoEditorPanel.vue'));
const AsyncCollectionPanel      = defineAsyncComponent(() => import('./views/CollectionPanel.vue'));

type TabKey = 'video'|'image'|'audio'|'text'|'downloads'|'sources'|'settings'|'screenrec'|'editor'|'basket';
type GroupKey = 'grab' | 'tools' | 'manage' | 'system';

const tabs = [
  { key:'video'     as TabKey, label:'视频',   description:'识别并控制页面视频，支持录制与抓帧',    metric:'video'     as TabKey, color:'#6366f1', bgColor:'rgba(99,102,241,0.08)',  component:AsyncVideoCapturePanel,
    icon:`<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg>` },
  { key:'image'     as TabKey, label:'图像',   description:'扫描页面图片，支持预览与批量下载',      metric:'image'     as TabKey, color:'#8b5cf6', bgColor:'rgba(139,92,246,0.08)',  component:AsyncImageGrabPanel,
    icon:`<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>` },
  { key:'audio'     as TabKey, label:'音频',   description:'提取音频资源，进行单个或批量下载',      metric:'audio'     as TabKey, color:'#10b981', bgColor:'rgba(16,185,129,0.08)',  component:AsyncAudioGrabPanel,
    icon:`<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>` },
  { key:'text'      as TabKey, label:'文本',   description:'提取页面正文、元数据与结构化信息',      metric:'text'      as TabKey, color:'#f59e0b', bgColor:'rgba(245,158,11,0.08)',  component:AsyncTextPanel,
    icon:`<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>` },
  { key:'downloads' as TabKey, label:'下载',   description:'查看下载历史与任务状态',               metric:'downloads' as TabKey, color:'#06b6d4', bgColor:'rgba(6,182,212,0.08)',   component:AsyncDownloadManagerPanel,
    icon:`<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>` },
  { key:'basket'    as TabKey, label:'收集篮', description:'跨页面暂存资源，统一下载或导出',        metric:'basket'    as TabKey, color:'#f97316', bgColor:'rgba(249,115,22,0.08)',  component:AsyncCollectionPanel,
    icon:`<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 0 1-8 0"/></svg>` },
  { key:'sources'   as TabKey, label:'Sources',description:'下载页面资源文件并保持目录结构',        metric:'sources'   as TabKey, color:'#ec4899', bgColor:'rgba(236,72,153,0.08)',  component:AsyncSourcesDownloadPanel,
    icon:`<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>` },
  { key:'screenrec' as TabKey, label:'录屏',   description:'录制屏幕、窗口或标签页',               metric:'screenrec' as TabKey, color:'#ef4444', bgColor:'rgba(239,68,68,0.08)',   component:AsyncScreenRecordPanel,
    icon:`<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="3" fill="currentColor"/></svg>` },
  { key:'editor'    as TabKey, label:'编辑',   description:'点击在新标签页打开全屏视频编辑器',   metric:'editor'    as TabKey, color:'#6366f1', bgColor:'rgba(99,102,241,0.08)',  component:AsyncVideoEditorPanel, launch: true,
    icon:`<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>` },
  { key:'settings'  as TabKey, label:'设置',   description:'配置扫描策略、命名模板与存储路径',     metric:'settings'  as TabKey, color:'#6b7280', bgColor:'rgba(107,114,128,0.08)', component:AsyncSettingsPanel,
    icon:`<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>` },
];

const activeTab  = ref<TabKey>('video');
const editorFiles = ref<{ name: string; blob: Blob; url: string }[]>([]);
const { counts } = provideResourceCounts();
const activeComponent = computed(() => tabs.find(t => t.key === activeTab.value)?.component || AsyncVideoCapturePanel);

// ── 分组导航：降低 10 个平级 Tab 的认知负担（UX-MULTI-TAB-001） ──
const groups: { key: GroupKey; label: string; tabs: TabKey[] }[] = [
  { key: 'grab',   label: '抓取', tabs: ['video', 'image', 'audio', 'text'] },
  { key: 'tools',  label: '工具', tabs: ['sources', 'screenrec', 'editor'] },
  { key: 'manage', label: '管理', tabs: ['downloads', 'basket'] },
  { key: 'system', label: '系统', tabs: ['settings'] }
];
const activeGroup = computed(() => groups.find(g => g.tabs.includes(activeTab.value)) || groups[0]);
const visibleTabs = computed(() => tabs.filter(t => activeGroup.value.tabs.includes(t.key)));

function switchTab(key: TabKey) { activeTab.value = key; }
function switchGroup(g: { key: GroupKey; tabs: TabKey[] }) {
  if (!g.tabs.includes(activeTab.value)) activeTab.value = g.tabs[0];
}

/** 在当前窗口的当前标签页左侧打开全屏编辑器（通过 chrome.tabs.create 在同窗口新标签打开） */
function launchEditor(clips?: { name: string; url: string }[]) {
  const editorUrl = chrome.runtime.getURL('src/editor/index.html');
  // 用 chrome.tabs.create 在同窗口打开，用户在左侧就能看到编辑器
  chrome.tabs.create({ url: editorUrl }, (tab) => {
    if (!clips?.length) return;
    // 通过 chrome.storage.session 传递待编辑文件（无需等待消息）
    chrome.storage.session?.set({ pendingEditorClips: clips });
  });
}

function openInEditor(rec: { name: string; blob: Blob; url: string }) {
  launchEditor([{ name: rec.name, url: rec.url }]);
  // 同时更新侧边栏内的编辑器文件列表（备用）
  editorFiles.value = [...editorFiles.value, rec];
}
</script>

<style scoped>
.app {
  height: 100vh;
  display: flex;
  flex-direction: column;
  background: var(--sp-color-bg);
  overflow: hidden;
}

/* ── Header ── */
.app-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  background: var(--sp-color-bg-elevated);
  border-bottom: 1px solid var(--sp-color-border);
  flex-shrink: 0;
  box-shadow: var(--sp-shadow-sm);
}

.app-header__brand { display: flex; align-items: center; gap: 8px; }

.app-logo {
  width: 28px; height: 28px;
  border-radius: 8px;
  background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%);
  display: flex; align-items: center; justify-content: center;
  box-shadow: 0 2px 8px rgba(99,102,241,0.35);
  flex-shrink: 0;
}

.app-logo__name {
  font-size: 14px; font-weight: 700;
  color: var(--sp-color-heading);
  letter-spacing: -0.02em;
}

.app-badge {
  font-size: 11px; font-weight: 600;
  letter-spacing: 0.06em; text-transform: uppercase;
  color: #d97706;
  background: rgba(245,158,11,0.12);
  border: 1px solid rgba(245,158,11,0.28);
  padding: 2px 8px;
  border-radius: 999px;
}

/* ── Tab Nav（分组：组行 + 当前组 Tab 行） ── */
.tab-nav {
  display: flex;
  flex-direction: column;
  background: var(--sp-color-bg-elevated);
  border-bottom: 1px solid var(--sp-color-border);
  flex-shrink: 0;
}

.tab-groups {
  display: flex;
  gap: 2px;
  padding: 6px 8px 0;
}

.group-btn {
  padding: 3px 10px;
  border: none;
  border-radius: var(--sp-radius-full);
  background: transparent;
  color: var(--sp-color-muted);
  font-size: 11px;
  font-weight: 600;
  font-family: var(--sp-font-family);
  cursor: pointer;
  transition: all var(--sp-transition-fast);
}
.group-btn:hover { color: var(--sp-color-text); background: var(--sp-color-surface); }
.group-btn.is-active {
  color: var(--sp-color-primary);
  background: var(--sp-color-primary-light);
}

.tab-row {
  display: flex;
  overflow-x: auto;
  scrollbar-width: none;
  gap: 0;
}
.tab-row::-webkit-scrollbar { display: none; }

.tab-btn {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 3px;
  padding: 8px 6px;
  border: none;
  background: transparent;
  color: var(--sp-color-muted);
  cursor: pointer;
  flex: 1;
  min-width: 44px;
  position: relative;
  border-bottom: 2px solid transparent;
  transition: all var(--sp-transition-fast);
  white-space: nowrap;
}

.tab-btn:hover {
  background: var(--sp-color-surface);
  color: var(--sp-color-text);
}

.tab-btn.is-active {
  color: var(--tab-color, var(--sp-color-primary));
  border-bottom-color: var(--tab-color, var(--sp-color-primary));
  background: var(--tab-bg, var(--sp-color-primary-light));
}

.tab-btn__icon { display: flex; align-items: center; justify-content: center; line-height: 0; }
.tab-btn__label { font-size: 11px; font-weight: 600; letter-spacing: 0.01em; }

.tab-btn__count {
  position: absolute; top: 4px; right: 4px;
  font-size: 11px; font-weight: 700;
  color: white;
  border-radius: 999px;
  min-width: 14px; height: 14px;
  display: flex; align-items: center; justify-content: center;
  padding: 0 3px; line-height: 1;
}

/* ── Body ── */
.app-body {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow-y: auto;
  overflow-x: hidden;
  min-height: 0;
}

/* ── Loading ── */
.panel-loading {
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 12px; padding: 48px 24px;
  color: var(--sp-color-muted); font-size: 13px;
}

.panel-loading__spinner {
  width: 24px; height: 24px;
  border-radius: 50%;
  border: 2px solid var(--sp-color-border-strong);
  border-top-color: var(--sp-color-primary);
  animation: spin 0.8s linear infinite;
}

@keyframes spin { to { transform: rotate(360deg); } }
</style>
