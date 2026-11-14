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
      <div class="app-header__status">
        <!-- 评审 P0：录制进行中显示全局角标（切走入口也可见），点击回到录制面板恢复完整状态 -->
        <button
          v-if="isRecording"
          class="rec-badge"
          :class="{ 'is-paused': isRecordingPaused }"
          title="录制进行中，点击返回录制面板"
          @click="goToRecording"
        >
          <span class="rec-badge__dot"></span>
          <span>{{ isRecordingPaused ? '已暂停' : '录制中' }} {{ recordingTimerDisplay }}</span>
        </button>
        <!-- UI 三批（组6）：展示 manifest 真实版本号而非「Alpha」——
             manifest version 为 1.0.0 却标 Alpha 会误导用户且与上架审核信息不一致，
             展示真实版本便于支持排障（用户反馈时可直接报出扩展版本） -->
        <span class="app-badge">v{{ appVersion }}</span>
      </div>
    </header>

    <!-- UI 二批之二：两级 11 tab 导航收敛为一级入口（抓取/网站/下载/录制/设置），
         可访问 tablist 实现（←/→ 方向键切换 + 可见焦点环）；
         「网站」为支持网站目录，应用户要求与抓取、下载同级 -->
    <nav class="entry-nav">
      <BaseSegmented
        id-base="entry"
        aria-label="主导航"
        size="md"
        :items="entryItems"
        :model-value="nav.entry"
        @update:model-value="onEntrySelect"
      />
    </nav>

    <main class="app-body">
      <!-- 全局下载条：点击"已完成"跳转 下载入口-历史子页签（原跳下载 tab 的语义保留） -->
      <GlobalDownloadBar @go-downloads="goToDownloadsHistory" />
      <div class="app-body__panel" role="tabpanel" id="entry-panel" :aria-labelledby="`entry-tab-${nav.entry}`">
        <Suspense>
          <!-- 抓取/下载容器以 v-model 风格双向绑定各自子模式（入口层负责持久化）；
               录制/设置/网站无子模式，多余的 model-value 绑定与事件对它们是惰性透传属性。
               open-site-catalog：抓取面板空状态的「网站目录」入口 → 切到一级「网站」入口；
               open-site：网站目录选站打开后 → 切回 抓取-视频 准备一键扫描 -->
          <component
            :is="activeComponent"
            :model-value="activeSubModel"
            @update:model-value="onSubChange"
            @open-editor="openInEditor"
            @open-site-catalog="goToSites"
            @open-site="onSiteOpened"
          />
          <template #fallback>
            <div class="panel-loading">
              <div class="panel-loading__spinner"></div>
              <span>加载中…</span>
            </div>
          </template>
        </Suspense>
      </div>
    </main>

    <BaseToast />
    <BaseConfirm />
  </div>
</template>

<script setup lang="ts">
/**
 * 侧栏入口层（UI 二批之二：信息架构收敛）。
 * 导航从「组行 + tab 行」两级 11 个 tab 收敛为 5 个一级入口：
 *  - 抓取   → GrabWorkspace（分段子模式：图片|视频|音频|文本|接口|资源包）
 *  - 网站   → SiteCatalogPanel（支持网站目录；应用户要求与抓取、下载同级）
 *  - 下载   → DownloadsWorkspace（子页签：收集篮|进行中|历史）
 *  - 录制   → ScreenRecordPanel（文案统一为"录制"，仅屏幕/标签页录制）
 *  - 设置   → SettingsPanel（唯一设置入口；options_ui 已在上轮移除，不再加回）
 * 「编辑」不再是入口：它是 launch 型动作（新标签页打开编辑器），
 * 由 ScreenRecordPanel 等结果项上的"在编辑器中打开"动作触发（openInEditor）。
 */
import { computed, onMounted, reactive, ref, watch, defineAsyncComponent, type Component } from 'vue';
import { provideResourceCounts } from './composables/useResourceCounts';
import GlobalDownloadBar from './components/GlobalDownloadBar.vue';
import BaseToast from './components/base/BaseToast.vue';
import BaseConfirm from './components/base/BaseConfirm.vue';
import BaseSegmented from './components/base/BaseSegmented.vue';
// UI 二批之二：导航状态（类型/默认值/持久化）统一由 navState 模块承载
import {
  DEFAULT_NAV_STATE,
  type DownloadsSubKey,
  type EntryKey,
  type GrabSubKey,
  type NavState,
  loadNavState,
  saveNavState,
} from './services/navState';
// P1-8：分级日志（扩展页面上下文默认 info 级）
import { createLogger } from '@/utils/logger';
// UI 三批（组6）：一级入口文案引用术语表（下载/录制/网站的入口名与全站成对术语同源）
import { DOWNLOAD_TERMS, RECORD_TERMS, SITES_TERMS } from './utils/terminology';
// 编辑器启动（新标签页 + IndexedDB 键交接；与录制成果列表共用）
import { openClipsInEditor } from './utils/editorLauncher';
import { toast } from './composables/useToast';
// 评审 P0：录屏运行时状态提升到模块级 store；入口层直接订阅，
// 使"录制中"角标在任意入口下都可见、计时连续（不依赖录制面板是否挂载）
import {
  recording as isRecording,
  paused as isRecordingPaused,
  timerDisplay as recordingTimerDisplay,
} from './services/recordingStore';

/** 本模块 logger：记录入口切换、跳转联动等导航里程碑 */
const log = createLogger('SidePanelApp');

// ── 一级入口 → 容器/面板组件（异步加载，保持首屏包体不变大） ──
const AsyncGrabWorkspace      = defineAsyncComponent(() => import('./views/GrabWorkspace.vue'));
const AsyncSiteCatalogPanel   = defineAsyncComponent(() => import('./views/SiteCatalogPanel.vue'));
const AsyncDownloadsWorkspace = defineAsyncComponent(() => import('./views/DownloadsWorkspace.vue'));
const AsyncScreenRecordPanel  = defineAsyncComponent(() => import('./views/ScreenRecordPanel.vue'));
const AsyncSettingsPanel      = defineAsyncComponent(() => import('./views/SettingsPanel.vue'));

/** 一级入口键 → 挂载组件 的渲染映射（与 navState.ENTRY_PANEL_IDS 一一对应） */
const ENTRY_COMPONENTS: Record<EntryKey, Component> = {
  grab:      AsyncGrabWorkspace,
  sites:     AsyncSiteCatalogPanel,
  downloads: AsyncDownloadsWorkspace,
  record:    AsyncScreenRecordPanel,
  settings:  AsyncSettingsPanel,
};

/**
 * UI 三批（组6）：头部版本徽章展示的扩展版本号。
 * 初值 '1.0.0' 为兜底；onMounted 读取 manifest 真实 version 覆盖，
 * 替换原先与 manifest 并存的「Alpha」字样（误导用户且与上架信息不一致）。
 */
const appVersion = ref('1.0.0');

// ── 导航状态：入口 + 两个可记忆子模式；持久化到 chrome.storage.local ──
const nav = reactive<NavState>({ ...DEFAULT_NAV_STATE });
/** 持久化状态是否已完成首次加载：加载完成前不写回，避免默认值覆盖旧记录 */
const navReady = ref(false);

onMounted(async () => {
  // UI 三批（组6）：读取 manifest 真实版本号供头部徽章展示；
  // 非扩展运行环境（如单测 jsdom 无 chrome 全局）try/catch 回退 '1.0.0'
  try {
    appVersion.value = chrome.runtime.getManifest().version;
    log.debug('已读取 manifest 版本号', appVersion.value);
  } catch { /* noop：chrome 不可用时保留兜底版本 */ }
  // 恢复上次停留的入口/子模式（内部兼容旧键迁移与非法值回退，绝不会停在空白页）
  const restored = await loadNavState();
  Object.assign(nav, restored);
  navReady.value = true;
  log.info('导航状态已恢复', restored);
});

// 导航状态任意变化即持久化（deep 监听；加载完成前跳过，见 navReady 注释）
watch(nav, () => {
  if (!navReady.value) return;
  void saveNavState({ entry: nav.entry, grabSub: nav.grabSub, downloadsSub: nav.downloadsSub });
}, { deep: true });

/** 资源计数上下文：抓取徽标 = 各抓取子模式计数之和（含接口）；下载徽标 = 收集篮数量 */
const { counts } = provideResourceCounts();

/** 一级入口的分段项定义（图标沿用原 tab 内联 SVG） */
const entryItems = computed(() => [
  {
    key: 'grab' as EntryKey,
    label: '抓取',
    title: '扫描页面图片/视频/音频/文本/接口/资源包',
    count: counts.video + counts.image + counts.audio + counts.text + counts.network + counts.sources,
    icon: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg>`,
  },
  {
    key: 'sites' as EntryKey,
    // 入口名引用 SITES_TERMS.entry（与面板标题「支持网站」同源）
    label: SITES_TERMS.entry,
    title: '支持网站目录：选站打开后一键扫描抓取',
    count: counts.sites,
    icon: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>`,
  },
  {
    key: 'downloads' as EntryKey,
    // UI 三批（组6）：入口名引用 DOWNLOAD_TERMS.entry（与「下载记录」成对同源）
    label: DOWNLOAD_TERMS.entry,
    title: '收集篮 / 进行中任务 / 下载历史',
    count: counts.basket,
    icon: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`,
  },
  {
    key: 'record' as EntryKey,
    // UI 三批（组6）：入口名引用 RECORD_TERMS.entry（与「桌面录制」成对同源）
    label: RECORD_TERMS.entry,
    title: '录制屏幕、窗口或标签页',
    count: 0,
    icon: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="3" fill="currentColor"/></svg>`,
  },
  {
    key: 'settings' as EntryKey,
    label: '设置',
    title: '配置扫描策略、命名模板与快捷键提示',
    count: 0,
    icon: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>`,
  },
]);

/** 当前入口挂载的组件 */
const activeComponent = computed<Component>(() => ENTRY_COMPONENTS[nav.entry]);

/**
 * 传给当前容器的子模式绑定值：
 * 只有 抓取/下载 两个容器有子模式；录制/设置返回 undefined（组件不声明该 prop，透传惰性）。
 */
const activeSubModel = computed<string | undefined>(() => {
  if (nav.entry === 'grab') return nav.grabSub;
  if (nav.entry === 'downloads') return nav.downloadsSub;
  return undefined;
});

/**
 * 一级入口选择回调（BaseSegmented 发出 string，收窄为 EntryKey）。
 * @param key 入口键
 */
function onEntrySelect(key: string): void {
  const entry = key as EntryKey;
  if (entry === nav.entry) return;
  log.debug(`切换一级入口: ${nav.entry} -> ${entry}`);
  nav.entry = entry;
}

/**
 * 容器子模式变更回调：按当前入口分发到对应停留位（随后由 watch 统一持久化）。
 * @param v 子模式键（抓取为 GrabSubKey / 下载为 DownloadsSubKey）
 */
function onSubChange(v: unknown): void {
  const sub = String(v);
  if (nav.entry === 'grab') nav.grabSub = sub as GrabSubKey;
  else if (nav.entry === 'downloads') nav.downloadsSub = sub as DownloadsSubKey;
}

/** 头部"录制中 mm:ss"角标点击：回到录制入口（原跳录屏 tab 的语义保留，文案统一为"录制"） */
function goToRecording(): void {
  log.info('点击录制角标，切回录制入口');
  nav.entry = 'record';
}

/** 全局下载条点击"已完成"：跳转 下载入口 + 历史子页签（原跳下载 tab 查看历史的语义保留） */
function goToDownloadsHistory(): void {
  log.info('点击下载条完成状态，跳转下载入口-历史子页签');
  nav.entry = 'downloads';
  nav.downloadsSub = 'history';
}

/** 抓取面板空状态点击「网站目录」：切到一级「网站」入口（网站已与抓取同级） */
function goToSites(): void {
  log.info('从抓取空状态进入一级网站入口');
  nav.entry = 'sites';
}

/**
 * 网站目录中选站打开后：切回 抓取-视频 准备一键扫描
 * （开新标签页由 SiteCatalogPanel 自身完成，此处仅做导航回切）
 */
function onSiteOpened(url: string): void {
  void url; // 站点已在新标签页打开
  log.info('已从网站目录打开站点，切回抓取-视频等待扫描');
  nav.entry = 'grab';
  nav.grabSub = 'video';
}

/**
 * 面板发出"在编辑器中打开"：统一走新标签页全屏编辑器。
 * 交 Blob 而非 rec.url：object URL 属于侧栏文档，用户关掉侧栏后就失效，
 * 由 editorLauncher 落 IndexedDB 后交键，编辑器自取（见 shared/editorHandoff.ts）。
 */
async function openInEditor(rec: { name: string; blob: Blob }) {
  try {
    await openClipsInEditor([{ name: rec.name, blob: rec.blob }]);
  } catch (e) {
    log.error('打开编辑器失败', e);
    toast.error(e instanceof Error ? e.message : '打开编辑器失败');
  }
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
  /* UI 三批（组2）：硬编码渐变端点改 token——primary 与 brand-violet，深色主题随 token 切换 */
  background: linear-gradient(135deg, var(--sp-color-primary) 0%, var(--sp-brand-violet) 100%);
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
  /* 组2：版本徽章属标注级文字，11px 保留 */
  font-size: 11px; font-weight: 600;
  letter-spacing: 0.06em; text-transform: uppercase;
  /* UI 三批（组2）：warning 硬编码色（#d97706 / rgba(245,158,11,…)）收敛为 warning token 系 */
  color: var(--sp-color-warning);
  background: var(--sp-color-warning-light);
  border: 1px solid var(--sp-color-warning);
  padding: 2px 8px;
  border-radius: 999px;
}

/* 头部右侧状态区：录制角标 + 版本徽章（UI 三批·组6：Alpha 改真实版本号） */
.app-header__status { display: flex; align-items: center; gap: 8px; }

/* 录制中全局角标（评审 P0）：复用 danger token，样式对齐 .app-badge 的胶囊形态 */
.rec-badge {
  display: inline-flex; align-items: center; gap: 6px;
  font-size: 11px; font-weight: 600;
  font-family: var(--sp-font-family);
  color: var(--sp-color-danger);
  background: var(--sp-color-danger-light);
  border: 1px solid rgba(239,68,68,0.28);
  padding: 2px 8px;
  border-radius: 999px;
  cursor: pointer;
  transition: all var(--sp-transition-fast);
}
.rec-badge:hover { border-color: var(--sp-color-danger); }
.rec-badge.is-paused { opacity: 0.75; }
.rec-badge.is-paused .rec-badge__dot { animation: none; }

/* 录制指示点：与录制面板 .rec-pulse 同样的呼吸节奏 */
.rec-badge__dot {
  width: 7px; height: 7px; border-radius: 50%;
  background: var(--sp-color-danger);
  animation: rec-badge-pulse 1.2s ease infinite;
  flex-shrink: 0;
}
@keyframes rec-badge-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.45; }
}

/* ── 一级入口导航（4 入口单行，替代原 组行 + tab 行 两级导航） ── */
.entry-nav {
  background: var(--sp-color-bg-elevated);
  border-bottom: 1px solid var(--sp-color-border);
  flex-shrink: 0;
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

/* tabpanel 包裹层：让容器（抓取/下载工作区）撑满剩余高度 */
.app-body__panel {
  flex: 1;
  display: flex;
  flex-direction: column;
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
