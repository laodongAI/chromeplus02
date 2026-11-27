<template>
  <!-- UI 三批（组6）：标题改引用 terminology 常量 PANEL_TITLES.video，与分段 tab 文案三处同源 -->
  <BaseCard :title="PANEL_TITLES.video" subtitle="扫描页面中的视频资源，执行控制与录制" :padded="true">
    <div class="toolbar">
      <div class="toolbar__left">
        <BaseButton size="sm" variant="secondary" :loading="loading" @click="refreshVideoList">
          重新扫描
        </BaseButton>
        <!-- 评审（UI 二批之一）问题 6：原"重试连接"为开发者术语，改为"修复扫描"并说明预期 -->
        <BaseButton size="sm" variant="ghost" :loading="ensureBusy" :disabled="loading" @click="ensureConnectAndRefresh"
          title="页面无响应或扫描无结果时，重新注入页面脚本并再次扫描">修复扫描</BaseButton>
        <select class="frame-select" v-model="frameModeValue" @change="onFrameModeChange" :disabled="loading">
          <option value="auto">自动选择</option>
          <option value="top">主页面</option>
          <option v-for="f in frames" :key="f.frameId" :value="'f:'+f.frameId">{{ formatFrameLabel(f) }}</option>
        </select>
        <!-- Round 5 #29：嗅探之外的两条候选找回路径（回收后自动重扫列表） -->
        <MediaSweepControls @done="refreshVideoList" />
        <span class="toolbar__hint">已识别 {{ videoCount }} 个视频</span>
        <!-- 评审（UI 二批之一）问题 6：适配器/子页面数等调试信息不再常驻暴露，
             收进悬浮详情（ⓘ），普通用户无需理解这些概念 -->
        <span v-if="adapterId || frames.length" class="debug-info" :title="debugTooltip" tabindex="0" aria-label="扫描调试信息">ⓘ</span>
      </div>
      <div class="toolbar__right">
        <span v-if="error && !restrictedHint" class="status status--error">{{ error }}</span>
        <span v-else-if="loading" class="status">扫描中…</span>
        <span v-else-if="lastAction" class="status">{{ lastAction }}</span>
      </div>
    </div>

    <!-- UI 三批（组1）：受限横幅收敛到共享组件 RestrictedBanner（warning 语义唯一实现），
         删除本面板复制版 .restricted-banner/.banner-* 样式与内联 svg；
         close 事件仅清空本面板 restrictedHint 状态，受限检测业务逻辑零改动 -->
    <RestrictedBanner v-if="restrictedHint" :message="restrictedHint" @close="restrictedHint = null" />

    <!-- 全局批量控制工具栏 -->
    <div class="global-video-bar" v-if="videoCount > 0">
      <div class="global-video-bar__left">
        <BaseButton size="sm" variant="secondary" :disabled="loading || !anyRecording" :loading="globalBusy.recordAllStop" @click="stopRecordAll">停止所有录制</BaseButton>
        <BaseButton size="sm" variant="secondary" :disabled="loading" :loading="globalBusy.recordAllStart" @click="startRecordAll">批量录制</BaseButton>
        <BaseButton size="sm" variant="secondary" :disabled="loading || !hasSelection" @click="downloadSelected">下载选中</BaseButton>
        <BaseButton size="sm" variant="ghost" :disabled="!displayVideos.length" @click="exportCsv">导出CSV</BaseButton>
        <BaseButton size="sm" variant="ghost" :disabled="!displayVideos.length" @click="exportJson">导出JSON</BaseButton>
        <BaseButton size="sm" variant="ghost" :disabled="!hasSelection" @click="addSelectedToBasket">加入收集篮</BaseButton>
        <!-- 评审（UI 二批之一）问题 4：状态过滤即时生效（此前改下拉要等下次扫描才起作用） -->
        <select class="frame-select" v-model="filterDownloadStatus" @change="applyVideoFilter" :disabled="loading">
          <option value="all">全部状态</option>
          <option value="new">未下载</option>
          <option value="downloaded">已下载</option>
        </select>
        <!-- Round 5 #28：属性表达式过滤（与音频面板同一组件、同一错误口径） -->
        <ExprFilterInput
          v-model="filterExpr"
          :error="filterExprError"
          placeholder="表达式：res>=720p size>50MB"
          label="视频属性过滤表达式"
        />
      </div>
      <div class="global-video-bar__right">
        <span class="global-summary">{{ playbackSummary }}</span>
        <!-- UI 三批（组3）：emoji 播放/暂停图标（跨平台渲染不一致、读屏念法不可控）
             换为内联 stroke SVG（play 三角 / pause 双竖线，currentColor 随按钮文字色），
             svg 标记 aria-hidden 由 aria-label 提供可读名称；title 悬浮提示保留 -->
        <BaseButton size="sm" variant="ghost" :loading="globalBusy.playAll || globalBusy.pauseAll" @click="togglePlayAll" :title="allPaused ? '全部播放' : '全部暂停'" :aria-label="allPaused ? '全部播放' : '全部暂停'">
          <svg v-if="allPaused" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <polygon points="6 4 20 12 6 20 6 4"/>
          </svg>
          <svg v-else width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <line x1="8" y1="5" x2="8" y2="19"/><line x1="16" y1="5" x2="16" y2="19"/>
          </svg>
        </BaseButton>
      </div>
    </div>

    <SelectionTable
      :items="pagedVideos"
      :selected="selectedIndexes"
      row-key="index"
      :dense="true"
      :loading="loading"
      :row-class="getRowClass"
      @select-all="toggleSelectAll"
      @select-row="handleRowSelect"
    >
      <template #toolbar>
        <div class="table-status">
          <span>提示：操作按钮直接向当前标签页的内容脚本发送指令，请先确保标签页含有可播放的视频。</span>
        </div>
        <BaseSearchBar
          v-model="searchQuery"
          :inputRef="searchInputEl"
          :disabled="loading"
          placeholder="搜索视频 (Ctrl+F)"
          :hint="shortcutHint"
          :show-hint="showShortcutHints"
        />
      </template>
      <!-- 评审（UI 二批之一）问题 1：原 6 列（#/视频/规格/下载状态/录制状态/操作 240px）
           合计约 580px+，窄侧栏必然横向滚动。砍到 2 个数据列：
           "视频"列常驻 序号+来源+规格·时长+下载/录制状态徽标（原 4 列内联），
           完整地址/直链数/可见性/下载按钮折叠进"⋯"详情；"操作"列只留 播放·录制·⋯ -->
      <template #header>
        <th>视频</th>
        <th style="width: 104px;">操作</th>
      </template>
      <template #empty>
        <div class="empty-catalog-hint">
          <span>未检测到页面视频，请点击“重新扫描”再试；若页面刚加载完成，稍等片刻后重试。</span>
          <!-- UI 二批之二：网站目录不再是独立 tab，空状态提供入口链接（选站打开后回到视频子模式扫描） -->
          <button type="button" class="catalog-entry" @click="$emit('open-site-catalog')">从网站目录选择站点打开 →</button>
        </div>
      </template>
      <template #row="{ item: video }">
        <td>
          <div class="video-meta">
            <div class="video-meta__primary">#{{ (video.index ?? 0) + 1 }} {{ formatSource(video.src) }}</div>
            <div class="video-meta__secondary">
              <span>{{ formatResolution(video) }} · {{ formatDuration(video.duration) }}</span>
              <!-- Round 5 #27：封装格式 + 嗅探到的体积（未知一律不显示，不用 0 B 冒充「很小」） -->
              <BaseTag v-if="formatOf(video)" size="sm" variant="neutral">{{ formatOf(video) }}</BaseTag>
              <BaseTag v-if="sizeOf(video)" size="sm" variant="neutral">{{ sizeOf(video) }}</BaseTag>
              <!-- UI 三批（组1/组2）：状态徽标改用共享组件 BaseTag（size=sm，12px 紧凑形态），
                   删除本地 .chip/.chip--* 复制样式；录制状态徽标语义映射：
                   有 lastError → danger，其余（待命/录制中/停止中/已完成）→ info（原默认 chip 即主色） -->
              <BaseTag v-if="isDownloaded(video.src)" size="sm" variant="success">已下载</BaseTag>
              <BaseTag v-else size="sm" variant="neutral">未下载</BaseTag>
              <BaseTag size="sm" :variant="recordingStates[video.index]?.lastError ? 'danger' : 'info'">
                {{ recordingLabel(video.index) }}
              </BaseTag>
              <!-- P2-2：计时抽成独立组件，每秒 tick 只更新本元素，不再驱动整列表重渲染 -->
              <RecordingTimer v-if="recordingStates[video.index]?.recording" class="recording-hint" :started-at="recordingStates[video.index]?.startedAt ?? 0" />
            </div>
            <!-- 流媒体（YouTube 等 MSE 播放）常驻提示：不用展开"⋯"就知道为何没有直链、下一步做什么 -->
            <div v-if="isStreamVideo(video)" class="stream-hint">
              <span>流媒体播放，无直链可下载</span>
              <BaseButton
                size="sm"
                variant="ghost"
                :loading="isActionBusy(video.index, recordingStates[video.index]?.recording ? 'record-stop' : 'record-start')"
                @click="toggleRecording(video.index)"
              >{{ recordingStates[video.index]?.recording ? '停止录制' : '录制保存' }}</BaseButton>
            </div>
          </div>
          <!-- "⋯"展开的详情区：完整地址/直链数/可见性/下载（评审问题 6：调试信息收进此处） -->
          <div v-if="expandedIndex === video.index" class="row-detail">
            <div class="detail-row">
              <span class="detail-label">地址</span>
              <a v-if="video.src && !video.src.startsWith('blob:')" class="detail-url" :href="video.src" target="_blank" rel="noreferrer">{{ video.src }}</a>
              <span v-else class="detail-url muted">{{ video.src || '内联视频资源' }}</span>
            </div>
            <div class="detail-row detail-inline">
              <span>直链 {{ directSourceCount(video) }} 个</span>
              <span>{{ renderVisibility(video) }}</span>
              <span v-if="video.muted">静音</span>
            </div>
            <BaseButton size="sm" variant="secondary" :loading="isActionBusy(video.index, 'download')" @click="downloadSingle(video.index)">下载直链</BaseButton>
            <div v-if="downloadErrors[video.index]" class="download-error">{{ downloadErrors[video.index] }}</div>
          </div>
        </td>
        <td>
          <div class="row-actions" style="justify-content: flex-end;">
            <!-- UI 三批（组3）：行内 emoji 播放/暂停图标换内联 stroke SVG + aria-label
                 （序号与行首可见的 #N 展示口径一致：index+1） -->
            <BaseButton
              size="sm"
              variant="ghost"
              :disabled="loading"
              :loading="isActionBusy(video.index, playbackStates[video.index] ? 'pause' : 'play')"
              :title="playbackStates[video.index] ? '暂停播放' : '开始播放'"
              :aria-label="playbackStates[video.index] ? `暂停视频 ${video.index + 1}` : `播放视频 ${video.index + 1}`"
              @click="controlVideo(video.index, playbackStates[video.index] ? 'pause' : 'play')"
            >
              <svg v-if="!playbackStates[video.index]" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <polygon points="6 4 20 12 6 20 6 4"/>
              </svg>
              <svg v-else width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <line x1="8" y1="5" x2="8" y2="19"/><line x1="16" y1="5" x2="16" y2="19"/>
              </svg>
            </BaseButton>
            <BaseButton
              size="sm"
              :variant="recordingStates[video.index]?.recording ? 'danger' : 'secondary'"
              :disabled="loading"
              :loading="isActionBusy(video.index, recordingStates[video.index]?.recording ? 'record-stop' : 'record-start')"
              @click="toggleRecording(video.index)"
            >{{ recordingStates[video.index]?.recording ? '停止' : '录制' }}</BaseButton>
            <BaseButton
              size="sm"
              variant="ghost"
              :title="expandedIndex === video.index ? '收起详情' : '查看详情（地址/直链/下载）'"
              :aria-expanded="expandedIndex === video.index"
              @click="toggleExpandIndex(video.index)"
            >⋯</BaseButton>
          </div>
        </td>
      </template>
      <!-- 评审（UI 二批之一）问题 2：对齐图片面板的分页方案，上百条时只渲染当前页（UI 三批组6 术语同步） -->
      <template #footer>
        <div class="pager" v-if="displayVideos.length > PAGE_SIZE">
          <BaseButton size="sm" variant="ghost" :disabled="page <= 1" @click="page = 1">首页</BaseButton>
          <BaseButton size="sm" variant="ghost" :disabled="page <= 1" @click="page--">上一页</BaseButton>
          <span class="pager__info">第 {{ page }} / {{ totalPages }} 页 · 共 {{ displayVideos.length }} 条</span>
          <BaseButton size="sm" variant="ghost" :disabled="page >= totalPages" @click="page++">下一页</BaseButton>
          <BaseButton size="sm" variant="ghost" :disabled="page >= totalPages" @click="page = totalPages">末页</BaseButton>
        </div>
      </template>
    </SelectionTable>

    <!-- Round 5 #29：缓存捕捉 / 深度搜索 找回的候选地址（页面上没有播放元素，只能下载不能录制） -->
    <RecoveredMediaList :tab-id="boundTabId" :frame-id="recoveredFrameId" />

    <!-- Round 5 #30：WebRTC 远端流录制（在线通话/低延迟直播）。流可能没有对应播放元素，
         所以独立成块，不并进按 DOM index 定位的视频行 -->
    <WebRtcCaptureCard :tab-id="boundTabId" />

    <!-- 录制成果：内容脚本录制完成后交接后台落库，这里提供查看（编辑器）/下载 MP4/删除；
         修复「录制后无处查看、下载 webm 播放不了」的反馈 -->
    <CaptureRecordingList mode="video" />
  </BaseCard>
</template>

<script lang="ts">
import { computed, defineComponent, h as createVNode, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { fetchVideoSources, pickBestCandidate, triggerDirectVideoDownload, isDownloadableSource } from '../services/videoSources';
import { useListSearch } from '../composables/useListSearch';
// 评审（UI 二批之一）：分页切片/页码钳制/过滤判定/失败原因汇总统一走共享纯函数模块
import { slicePage, clampPage, matchesVideoFilter, videoFactsOf, summarizeReasons } from '../utils/listAdapt';
// 收口轮 lint 修复：移除未使用的 BaseTable / ErrorBadge 导入（组件实际用 SelectionTable）
// UI 三批（组1）：新增共享组件 RestrictedBanner（受限横幅唯一实现）与 BaseTag（状态徽标唯一实现），
// 替换本面板模板中的复制版横幅与 .chip 徽标
import { BaseButton, BaseCard, SelectionTable, BaseSearchBar, RestrictedBanner, BaseTag, ExprFilterInput } from '../components/base';
// Round 5 #27/#28：格式标签与属性过滤表达式（与音频面板同一纯模块）
import { formatLabelOf, resolutionLabelOf, sizeLabelOf } from '@/core/mediaMeta';
import { compileFilterCached } from '@/core/mediaFilter';
// 录制成果列表：内容脚本录制完成后经后台落库的产物（查看/下载 MP4/删除）
import CaptureRecordingList from '../components/CaptureRecordingList.vue';
// Round 5 #29：缓存捕捉 / 深度搜索按钮组（与音频面板共用同一组件）
import MediaSweepControls from '../components/MediaSweepControls.vue';
// Round 5 #29：回收候选地址列表（缓存捕捉 / 深度搜索 的产物，只能下载不能录制）
import RecoveredMediaList from '../components/RecoveredMediaList.vue';
// Round 5 #30：WebRTC 远端流录制卡片（开关驱动动态注入 MAIN/ISOLATED 脚本）
import WebRtcCaptureCard from '../components/WebRtcCaptureCard.vue';
// UI 三批（组6）：面板标题集中术语常量（PANEL_TITLES.video = 「视频采集」），与分段 tab 同源
import { PANEL_TITLES } from '../utils/terminology';
import { GLOBAL_SHORTCUT_HINT } from '../utils/shortcutHints';
import { useResourceCounts } from '../composables/useResourceCounts';
import { useRowHighlight } from '../composables/useRowHighlight';
import {
  MessageType,
  type VideoControlAction,
  type VideoItemDTO,
  type VideoListResponse,
  type VideoRecordingStatusMessage,
  type VideoPlaybackStatusMessage
} from '@/messaging';
import { subscribe, retryDownload, cancelDownload, startHlsDownload, type DownloadTask } from '../services/downloadQueue';
// 收口轮 lint 修复：formatDuration 用下方本地实现（含无效值兜底），移除导入避免遮蔽告警
import { exportRowsAsJSON, exportRowsAsCSV } from '../services/exportList';
import { addToBasket } from '../services/collection';
import { toast } from '../composables/useToast';
// 评审 P0（UI 第一批）：批量录制为高消耗操作，复用全局确认对话框明示并发规模，不另造
import { confirmDialog } from '../composables/useConfirm';
import { loadHistory, isDownloaded, markDownloaded } from '../services/downloadHistory';
import { loadState, saveState } from '../services/persist';
import { loadSettings } from '../services/settings';
import { getActiveTabInfo, sendMessageToTab, isReceivingEndMissingError, ensureContentConnected, getAllFramesInfo, type FrameInfo } from '../utils/chromeMessaging';
import { getRestrictedPageMessage } from '../../utils/restrictedPages';
import { isResourceUpdateFromBoundSource } from '../utils/resourceUpdate';
// P1-8：分级日志（扩展页面上下文默认 info 级）
import { createLogger } from '@/utils/logger';

/** 本模块 logger：按模块名新建（原日志无前缀） */
const log = createLogger('VideoCapturePanel');

interface RecordingState {
  recording: boolean;
  startedAt?: number;
  stopping?: boolean;
  lastFileName?: string;
  lastCompletedAt?: number;
  lastError?: string;
  mode?: 'video' | 'audio';
}

type RuntimeMessageListener = Parameters<typeof chrome.runtime.onMessage.addListener>[0];

/**
 * 录制计时局部小组件（P2-2）。
 * 旧实现：面板顶层 clock ref 每秒更新一次，仅为了刷新"已录制时长"文本，
 * 却触发整个视频列表（含所有行）重渲染。
 * 现改为独立组件：每秒 tick 只重渲染本组件自身，列表不再受影响；
 * 每个录制中的行才会挂载该组件，未录制行零开销。
 */
const RecordingTimer = defineComponent({
  name: 'RecordingTimer',
  props: {
    /** 录制开始时间戳（毫秒）；<=0 时按 0 秒显示（防御 startedAt 缺失） */
    startedAt: { type: Number, required: true }
  },
  setup(props) {
    // 组件局部时钟：仅驱动本组件重渲染，不冒泡到父级列表
    const now = ref(Date.now());
    // 定时器句柄，卸载时必须清理，防止泄漏
    let tick: number | null = null;
    onMounted(() => { tick = window.setInterval(() => { now.value = Date.now(); }, 1000); });
    onBeforeUnmount(() => { if (tick !== null) { clearInterval(tick); tick = null; } });
    // 用渲染函数输出时长文本；formatReadableDuration 为模块级函数声明（已提升），可直接复用
    // 注：vue 的 h 以 createVNode 别名导入，避免与文件内既有的局部变量 h（高度）重名
    return () => createVNode('span', formatReadableDuration(Math.max(0, Math.floor((now.value - props.startedAt) / 1000))));
  }
});

export default defineComponent({
  name: 'VideoCapturePanel',
  // UI 三批（组1）：注册共享组件 RestrictedBanner / BaseTag（Options API 需在 components 中声明）
  components: { BaseButton, BaseCard, SelectionTable, BaseSearchBar, RecordingTimer, RestrictedBanner, BaseTag, CaptureRecordingList, MediaSweepControls, RecoveredMediaList, WebRtcCaptureCard, ExprFilterInput },
  // UI 二批之二：网站目录降级为抓取空状态入口后，本面板通过该事件请求容器打开目录覆盖层
  emits: ['open-site-catalog'],
  setup() {
    const { setCount } = useResourceCounts();
    // 评审（UI 二批之一）问题 4：videos 语义为「完整扫描结果（未过滤）」。
    // 旧实现把过滤结果写回 videos，导致状态过滤是破坏性的且改下拉不会即时生效；
    // 现在过滤/排序下沉到 displayVideos computed，即时生效且可逆（放宽条件即恢复）。
    const videos = ref<VideoItemDTO[]>([]);
    const { newSet: newVideoHighlight, removedSet: removedVideoHighlight, markNew: markVideoNew, markRemoved: markVideoRemoved } = useRowHighlight({ ttlNew: 2500, ttlRemoved: 900 });
    const ephemeralRemovedVideos = reactive<Record<number, VideoItemDTO>>({});
    /** 过滤视图：完整扫描结果 + 短暂保留的"已移除"项，经条件过滤与排序派生 */
    const displayVideos = computed(() => {
      const base = videos.value.slice();
      Object.keys(ephemeralRemovedVideos).forEach(k => {
        const id = Number(k);
        if (!base.find(v => v.index === id)) base.push(ephemeralRemovedVideos[id]);
      });
      return applyVideoFilterAndSort(base);
    });

    // ── 分页渲染（评审问题 2：对齐图片面板既有方案；UI 三批组6 术语同步）──
    const PAGE_SIZE = 60; // 每页渲染行数：与图片面板一致，保持同一交互习惯
    const page = ref(1); // 当前页码（1 起）
    const totalPages = computed(() => Math.max(1, Math.ceil(displayVideos.value.length / PAGE_SIZE)));
    /** 当前页渲染切片（共享纯函数 slicePage，只渲染本页行） */
    const pagedVideos = computed(() => slicePage(displayVideos.value, page.value, PAGE_SIZE));

    // 评审（UI 二批之一）问题 1/6：当前展开"⋯"详情的行序号（单开模式）
    const expandedIndex = ref<number | null>(null);
    const currentFrameId = ref<number|null>(null);
    // 当前视频列表绑定的来源 tabId（增量更新按 tab 过滤，防后台标签页串扰）
    const boundTabId = ref<number|null>(null);
    const frameMode = ref<'auto'|'top'|'frame'>('auto');
    const frames = ref<FrameInfo[]>([]);
    const frameModeValue = ref<string>('auto');
    // Round 5 #29：回收列表的框架范围。auto/top 时不限定 frameId，让后台把该 tab 所有框架的
    // 候选一次性列出（回收到的地址没有播放元素，无法像视频行那样按 frame 定位）；
    // 只有用户显式选中某个子框架时才收窄。
    const recoveredFrameId = computed<number | null>(() =>
      frameMode.value === 'frame' ? currentFrameId.value : null);
    const loading = ref(false);
    const error = ref<string | null>(null);
    const lastAction = ref('');
    const adapterId = ref<string | null>(null);
    const busyKeys = reactive(new Set<string>());
    const recordingStates = reactive<Record<number, RecordingState>>({});
    const playbackStates = reactive<Record<number, boolean>>({});
    const selectedIndexes = reactive(new Set<number>());
    const queueTasks = ref<DownloadTask[]>([]);
    const restrictedHint = ref<string | null>(null);
    const globalBusy = reactive<Record<string, boolean>>({
      playAll: false,
      pauseAll: false,
      toggleAll: false,
      recordAllStart: false,
      recordAllStop: false
    });
    // 过滤与排序
    const minVideoWidth = ref<number>(0);
    const minVideoHeight = ref<number>(0);
    const minVideoDuration = ref<number>(0);
    const filterDownloadStatus = ref<'all'|'downloaded'|'new'>('all');
    // Round 5 #28：属性过滤表达式（size>50MB and res>=1080p），语法错误只提示不裁剪列表
    const filterExpr = ref('');
    const filterExprError = computed(() => compileFilterCached(filterExpr.value).error || '');
    const sortKey = ref<string>(''); // width|height|duration|sources
    const sortDir = ref<'asc'|'desc'>('asc');
    const searchKit = useListSearch({
      onRefresh: () => refreshVideoList(),
      selectAll: () => { toggleSelectAll(true); },
      clearSelection: () => { selectedIndexes.clear(); },
      invertSelection: () => {
        const all = displayVideos.value.map(v => resolveIndex(v.index));
        const next = new Set<number>();
        for(const idx of all){ if(!selectedIndexes.has(idx)) next.add(idx); }
        selectedIndexes.clear();
        next.forEach(i => selectedIndexes.add(i));
      },
      selectNew: () => { newVideoHighlight.forEach(i => { if(typeof i === 'number') selectedIndexes.add(resolveIndex(i)); }); }
    });
    const showShortcutHints = ref(true);
    const shortcutHint = GLOBAL_SHORTCUT_HINT;
    // P2-2：原顶层 clock ref + 每秒 timer 已移除，录制计时改由 RecordingTimer 组件局部驱动
    let removeRuntimeListener: (() => void) | null = null;

    const videoCount = computed(() => videos.value.length);
    // 全选语义：作用于完整过滤结果（displayVideos），与导出/批量下载口径一致
    const allSelected = computed(() => displayVideos.value.length > 0 && displayVideos.value.every(v => selectedIndexes.has(resolveIndex(v.index))));
    const indeterminateSelected = computed(() => selectedIndexes.size > 0 && !allSelected.value);
    const hasSelection = computed(() => selectedIndexes.size > 0);
    // 帧捕获相关状态
    const downloadErrors = reactive<Record<number, string>>({});
    const ensureBusy = ref(false);

    // 过滤/刷新后列表变短：页码越界时自动钳制到最后一页。
    // 注意：watch 注册时会立即求值 displayVideos，进而读取 minVideoWidth/minVideoHeight/
    // minVideoDuration/filterDownloadStatus/sortKey/sortDir 等过滤状态；这些 ref 必须已在
    // 上方完成初始化，否则触发 TDZ（Cannot access 'minVideoWidth' before initialization），
    // 整个视频面板会渲染失败。此处位置不可前移。
    watch(displayVideos, () => {
      page.value = clampPage(page.value, displayVideos.value.length, PAGE_SIZE);
    });

    const statusHandler: RuntimeMessageListener = (message, sender) => {
      if (!message || !message.type) return;
      if (message.type === MessageType.VIDEO_RECORDING_STATUS) {
        const payload = message as VideoRecordingStatusMessage;
        const idx = resolveIndex(payload.index);
        const prev = recordingStates[idx] || { recording: false };
        if (payload.status === 'started') {
          recordingStates[idx] = {
            recording: true,
            startedAt: payload.startedAt || Date.now(),
            stopping: false,
            lastFileName: undefined,
            lastError: undefined,
            mode: payload.mode || prev.mode || 'video'
          };
          lastAction.value = '录制中…';
          error.value = null;
          return;
        }
        if (payload.status === 'completed') {
          recordingStates[idx] = {
            recording: false,
            startedAt: undefined,
            stopping: false,
            lastFileName: payload.fileName,
            lastCompletedAt: Date.now(),
            lastError: undefined,
            mode: payload.mode || prev.mode || 'video'
          };
          lastAction.value = '录制完成，成果见下方「录制成果」列表';
          return;
        }
        if (payload.status === 'error') {
          recordingStates[idx] = {
            recording: false,
            startedAt: undefined,
            stopping: false,
            lastFileName: undefined,
            lastCompletedAt: undefined,
            lastError: payload.error || '录制失败',
            mode: prev.mode || 'video'
          };
          error.value = payload.error || '录制失败';
        }
      }
      // 播放状态
      if (message.type === MessageType.VIDEO_PLAYBACK_STATUS) {
        const play = message as VideoPlaybackStatusMessage;
        const idx = resolveIndex(play.index);
        playbackStates[idx] = !!play.playing;
      }
      // 增量资源更新（视频）
      if (message.type === MessageType.RESOURCE_UPDATE) {
        try {
          const payload: any = (message as any).payload || {};
          // tab + frame 双守卫：列表展示的是单一 tab + frame 的扫描结果（currentFrameId 为 null 表示顶层）。
          // payload 只带 frameId，tabId 取自 sender，否则后台标签页（同为顶层 frame 0）的增量会覆盖当前列表
          if (isResourceUpdateFromBoundSource(sender, payload, { tabId: boundTabId.value, frameId: currentFrameId.value }) && Array.isArray(payload.videos)) {
            const diff = payload.diff?.videos;
            if (diff?.removed?.length) {
              diff.removed.forEach((id: number) => {
                const ex = videos.value.find(v => v.index === id);
                if (ex) { ephemeralRemovedVideos[id] = { ...ex }; }
              });
              markVideoRemoved(diff.removed);
              window.setTimeout(() => { diff.removed.forEach((id: number) => { delete ephemeralRemovedVideos[id]; }); }, 900);
            }
            const incoming: VideoItemDTO[] = payload.videos;
            if (diff?.added?.length) {
              markVideoNew(diff.added.map((v: VideoItemDTO) => v.index));
            } else {
              const prevIds = new Set(videos.value.map(v=> v.index));
              const added = incoming.filter(v => !prevIds.has(v.index)).map(v => v.index);
              if (added.length) markVideoNew(added);
            }
            // 提交完整列表（未过滤），过滤视图由 displayVideos computed 自动派生
            videos.value = incoming;
            setCount('video', videos.value.length);
            lastAction.value = '自动增量更新';
          }
        } catch { /* noop */ }
      }
      if (message.type === MessageType.SETTINGS_UPDATE) {
        try {
          const payload: any = (message as any).payload || {};
          if (typeof payload.showShortcutHints === 'boolean') {
            showShortcutHints.value = payload.showShortcutHints;
          }
        } catch { /* noop */ }
      }
    };

    let saveTimer: number | null = null;
    function scheduleSave(){
      if(saveTimer) clearTimeout(saveTimer);
      saveTimer = window.setTimeout(()=>{
        saveState({ filters: { video: { minWidth: minVideoWidth.value||0, minHeight: minVideoHeight.value||0, minDuration: minVideoDuration.value||0 } } });
      }, 600);
    }

    watch(videos, (next) => {
      const validIndexes = new Set(next.map(v => resolveIndex(v.index)));
      for (const idx of Array.from(selectedIndexes)) {
        if (!validIndexes.has(idx)) {
          selectedIndexes.delete(idx);
        }
      }
    });

    onMounted(async () => {
      // 加载下载历史
      await loadHistory();
      // 恢复帧间隔
      try {
        const st = await loadState();
        if (st.filters?.video) {
          if (typeof st.filters.video.minWidth === 'number') minVideoWidth.value = st.filters.video.minWidth;
          if (typeof st.filters.video.minHeight === 'number') minVideoHeight.value = st.filters.video.minHeight;
          if (typeof st.filters.video.minDuration === 'number') minVideoDuration.value = st.filters.video.minDuration;
        }
      } catch { /* noop */ }
      // 加载显示快捷键提示设置
      try { const s = await loadSettings(); showShortcutHints.value = s.showShortcutHints; } catch { /* noop */ }
      await updateRestrictedHint();
      // 如果是受限页面，直接跳过后续操作
      if (restrictedHint.value) {
        loading.value = false;
        return;
      }
      // 开启视频相关功能：播放事件与 SPA 监听
      try {
        const info = await getActiveTabInfo();
        const tabId = info?.id;
        if (tabId) { void sendMessageToTab<any>(tabId, { type: MessageType.ENABLE_FEATURES, payload: { video: true, playbackEvents: true, spaWatchers: true } }, {}); }
      } catch { /* noop */ }
      refreshVideoList();
      // P2-2：不再启动每秒刷新全局 clock 的 timer（曾导致整列表每秒重渲染）
      if (chrome?.runtime?.onMessage?.addListener) {
        chrome.runtime.onMessage.addListener(statusHandler);
        removeRuntimeListener = () => {
          chrome.runtime.onMessage.removeListener(statusHandler);
        };
      }
      // 订阅下载队列
      const unsubscribeQueue = subscribe(tasks => { queueTasks.value = tasks; });
      
      // 监听标签页切换：自动重新检测受限状态并刷新
      const onTabActivated = async () => {
        await updateRestrictedHint();
        if (!restrictedHint.value) {
          error.value = null;
          await refreshVideoList();
        }
      };
      if (chrome?.tabs?.onActivated?.addListener) {
        chrome.tabs.onActivated.addListener(onTabActivated);
      }
      
      removeRuntimeListener = ((orig)=>{
        return () => {
          orig && orig();
          unsubscribeQueue();
          if (chrome?.tabs?.onActivated?.removeListener) {
            chrome.tabs.onActivated.removeListener(onTabActivated);
          }
        };
      })(removeRuntimeListener);
      // 注册全局快捷键
      searchKit.register();
    });
    function onFrameModeChange(){
      const v = frameModeValue.value;
      if(v==='auto'){ frameMode.value='auto'; currentFrameId.value=null; }
      else if(v==='top'){ frameMode.value='top'; currentFrameId.value=null; }
      else if(v.startsWith('f:')){ const id = Number(v.slice(2)); if(Number.isFinite(id)) { frameMode.value='frame'; currentFrameId.value=id; } }
      refreshVideoList();
    }
    /** 子页面下拉标签（评审问题 6：去掉"帧"术语，改为用户可理解的"子页面"） */
    function formatFrameLabel(f: FrameInfo){
      const id = f.frameId;
      let host = '';
      try { if(f.url){ const u = new URL(f.url); host = u.hostname.replace(/^www\./,'') + (u.pathname && u.pathname!=="/" ? ' · '+ (u.pathname.length>20 ? (u.pathname.slice(0,20)+'…') : u.pathname) : ''); } } catch { /* noop */ }
      return host ? `子页面 #${id} ${host}` : `子页面 #${id}`;
    }

    function retryTask(id: string){ retryDownload(id); }
    function cancelTask(id: string){ cancelDownload(id); }

    async function fallbackRecord(t: DownloadTask){
      const vid = videos.value.find(v => v.src === t.url || (v.directSources||[]).some(s=> s.url === t.url));
      const idx = vid ? vid.index : videos.value[0]?.index;
      if (idx == null) { lastAction.value = '未找到匹配视频用于录制'; return; }
      try { await startRecording(idx); lastAction.value = '已触发录制回退'; }
      catch { lastAction.value = '录制回退失败'; }
    }

    /** 全选/取消全选：作用于完整过滤结果（displayVideos），而非仅当前页或原始列表 */
    function toggleSelectAll(checked: boolean){
      selectedIndexes.clear();
      if(checked){ displayVideos.value.forEach(v => selectedIndexes.add(resolveIndex(v.index))); }
    }
    function handleRowSelect(index: number) {
      const idx = resolveIndex(index);
      if(selectedIndexes.has(idx)) selectedIndexes.delete(idx);
      else selectedIndexes.add(idx);
    }

    /** 「⋯」详情展开切换：单开模式，再次点击同一行收起 */
    function toggleExpandIndex(index?: number) {
      const idx = resolveIndex(index);
      expandedIndex.value = expandedIndex.value === idx ? null : idx;
    }

    /**
     * 扫描调试信息（评审问题 6）：适配器/子页面数等开发者信息收进 ⓘ 悬浮详情，
     * 不再常驻暴露在工具栏。
     */
    const debugTooltip = computed(() => {
      const parts: string[] = [];
      parts.push(`适配器: ${adapterId.value || '无'}`);
      parts.push(`子页面数: ${frames.value.length}`);
      parts.push(`扫描来源: ${currentFrameId.value == null ? '主页面' : '子页面 #' + currentFrameId.value}`);
      return parts.join(' · ');
    });

    function toggleRecording(index?: number){
      const idx = resolveIndex(index);
      const st = recordingStates[idx];
      if(st?.recording){
        stopRecording(idx);
      } else {
        startRecording(idx);
      }
    }

    onBeforeUnmount(() => {
      // P2-2：timer/clock 已移除，无需再清理全局计时器
      if (removeRuntimeListener) {
        removeRuntimeListener();
      }
      // 清理全局快捷键
      searchKit.unregister();
    });
    async function refreshVideoList() {
      loading.value = true;
      error.value = null;
      lastAction.value = '';
      try {
        const tabId = await ensureActiveTab();
        boundTabId.value = tabId;
        // 刷新帧列表（用于下拉）
        try { frames.value = await getAllFramesInfo(tabId); } catch { /* noop */ }
        let list: VideoItemDTO[] = [];
        let usedFrame: number | null = null;
        if (frameMode.value === 'top') {
          const resp = await sendMessageToTab<VideoListResponse>(tabId, { type: MessageType.GET_VIDEO_LIST });
          list = (resp?.success && Array.isArray(resp.videos)) ? resp.videos : [];
          usedFrame = null;
        } else if (frameMode.value === 'frame' && currentFrameId.value != null) {
          const resp = await sendMessageToTab<VideoListResponse>(tabId, { type: MessageType.GET_VIDEO_LIST }, { frameId: currentFrameId.value });
          list = (resp?.success && Array.isArray(resp.videos)) ? resp.videos : [];
          usedFrame = currentFrameId.value;
        } else {
          // 自动模式：先顶层，后逐帧
          let resp = await sendMessageToTab<VideoListResponse>(tabId, { type: MessageType.GET_VIDEO_LIST });
          list = (resp?.success && Array.isArray(resp.videos)) ? resp.videos : [];
          usedFrame = null;
          if (!(resp?.success) || list.length === 0) {
            try {
              const { getAllFrameIds } = await import('../utils/chromeMessaging');
              const frameIds = await getAllFrameIds(tabId);
              for (const fid of frameIds) {
                try {
                  const r = await sendMessageToTab<VideoListResponse>(tabId, { type: MessageType.GET_VIDEO_LIST }, { frameId: fid });
                  if (r?.success && Array.isArray(r.videos) && r.videos.length) {
                    list = r.videos;
                    usedFrame = fid;
                    break;
                  }
                } catch { /* noop */ }
              }
            } catch { /* noop */ }
          }
        }
        currentFrameId.value = usedFrame;
        // 发送 PING 获取适配器信息
        try {
          const pong = await sendMessageToTab<any>(tabId, { type: MessageType.PING }, usedFrame != null ? { frameId: usedFrame } : {});
          adapterId.value = pong?.adapterId || null;
        } catch { adapterId.value = null; }
        videos.value = list || [];
        setCount('video', videos.value.length);
        lastAction.value = videos.value.length ? `已更新 ${videos.value.length} 个视频` : '当前页面未检测到视频';
        // 清理已失效的视频状态
        const existing = new Set(videos.value.map(v=>v.index));
        Object.keys(playbackStates).forEach(k=>{ const i = Number(k); if(!existing.has(i)) delete playbackStates[i]; });
        Object.keys(recordingStates).forEach(k=>{ const i = Number(k); if(!existing.has(i)) delete recordingStates[i]; });
      } catch (err) {
        // 若是受限页面错误，restrictedHint 已展示，不再重复存入 error
        if (restrictedHint.value) {
          loading.value = false;
          return;
        }
        // 自动修复：若是接收端缺失，尝试注入后重试一次
        try {
          if (isReceivingEndMissingError(err)) {
            const tabId = await ensureActiveTab();
            const res = await ensureContentConnected(tabId);
            if (res.ok) {
              // 再次尝试
              const tabId2 = tabId;
              boundTabId.value = tabId2;
              try { frames.value = await getAllFramesInfo(tabId2); } catch { /* noop */ }
              let list: VideoItemDTO[] = [];
              let usedFrame: number | null = null;
              if (frameMode.value === 'top') {
                const resp = await sendMessageToTab<VideoListResponse>(tabId2, { type: MessageType.GET_VIDEO_LIST });
                list = (resp?.success && Array.isArray(resp.videos)) ? resp.videos : [];
                usedFrame = null;
              } else if (frameMode.value === 'frame' && currentFrameId.value != null) {
                const resp = await sendMessageToTab<VideoListResponse>(tabId2, { type: MessageType.GET_VIDEO_LIST }, { frameId: currentFrameId.value });
                list = (resp?.success && Array.isArray(resp.videos)) ? resp.videos : [];
                usedFrame = currentFrameId.value;
              } else {
                let resp = await sendMessageToTab<VideoListResponse>(tabId2, { type: MessageType.GET_VIDEO_LIST });
                list = (resp?.success && Array.isArray(resp.videos)) ? resp.videos : [];
                usedFrame = null;
                if (!(resp?.success) || list.length === 0) {
                  try {
                    const { getAllFrameIds } = await import('../utils/chromeMessaging');
                    const frameIds = await getAllFrameIds(tabId2);
                    for (const fid of frameIds) {
                      try {
                        const r = await sendMessageToTab<VideoListResponse>(tabId2, { type: MessageType.GET_VIDEO_LIST }, { frameId: fid });
                        if (r?.success && Array.isArray(r.videos) && r.videos.length) { list = r.videos; usedFrame = fid; break; }
                      } catch { /* noop */ }
                    }
                  } catch { /* noop */ }
                }
              }
              currentFrameId.value = usedFrame;
              try { const pong = await sendMessageToTab<any>(tabId2, { type: MessageType.PING }, usedFrame != null ? { frameId: usedFrame } : {}); adapterId.value = pong?.adapterId || null; } catch { adapterId.value = null; }
              videos.value = list || [];
              setCount('video', videos.value.length);
              lastAction.value = videos.value.length ? `已更新 ${videos.value.length} 个视频` : '当前页面未检测到视频';
              return;
            }
          }
        } catch { /* noop */ }
        // 最终失败
        videos.value = [];
        setCount('video', 0);
        // 受限页面已通过 restrictedHint 展示，不重复设置 error
        if (!restrictedHint.value) {
          error.value = toFriendlyVideoError(err);
        }
      } finally {
        loading.value = false;
      }
    }

    /**
     * 「修复扫描」入口（原"重试连接"，评审问题 6 改名）：
     * 内容脚本未注入时重新注入，成功后自动再次扫描；提示语面向用户描述结果与下一步。
     */
    async function ensureConnectAndRefresh(){
      ensureBusy.value = true; error.value=null; lastAction.value='';
      try{
        const tabId = await ensureActiveTab();
        const res = await ensureContentConnected(tabId);
        if(!res.ok){
          throw new Error(res.error || `未能连接到页面（已检查 ${res.framesChecked} 个子页面）`);
        }
        lastAction.value = `已重新连接页面（${res.framesConnected}/${res.framesChecked} 个子页面），正在扫描…`;
        log.info(`修复扫描成功：连接 ${res.framesConnected}/${res.framesChecked} 个子页面`);
        try { frames.value = await getAllFramesInfo(tabId); } catch { /* noop */ }
        await refreshVideoList();
      }catch(e:any){ error.value = e?.message || '修复扫描失败，请刷新页面后重试'; }
      finally{ ensureBusy.value=false; }
    }

    async function controlVideo(index: number, action: VideoControlAction) {
      const resolvedIndex = resolveIndex(index);
      const key = actionKey(resolvedIndex, action);
      setBusy(key, true);
      try {
        const tabId = await ensureActiveTab();
        // frameId 定向：列表来自哪个 frame 就控制哪个 frame 的视频（?? 0 = 顶层），杜绝跨 frame 同序号误控
        const response = await sendMessageToTab<{ success: boolean; error?: string }>(tabId, {
          type: MessageType.CONTROL_VIDEO,
          index: resolvedIndex,
          action
        }, { frameId: currentFrameId.value ?? 0 });
        if (!response?.success) throw new Error(response?.error || '控制失败');
        lastAction.value = describeControlAction(action);
      } catch (err) {
        error.value = toFriendlyVideoError(err);
      } finally {
        setBusy(key, false);
      }
    }

    async function startRecording(index: number) {
      const resolvedIndex = resolveIndex(index);
      const key = actionKey(resolvedIndex, 'record-start');
      setBusy(key, true);
      try {
        const tabId = await ensureActiveTab();
        const response = await sendMessageToTab<{ success: boolean; startedAt?: number; error?: string }>(tabId, {
          type: MessageType.START_RECORD_VIDEO,
          index: resolvedIndex
        }, { frameId: currentFrameId.value ?? 0 });
        if (!response?.success) throw new Error(response?.error || '开始录制失败');
        recordingStates[resolvedIndex] = {
          recording: true,
          startedAt: response.startedAt || Date.now(),
          stopping: false,
          lastFileName: undefined,
          lastError: undefined,
          mode: 'video'
        };
        lastAction.value = '已启动录制';
      } catch (err) {
        error.value = toFriendlyVideoError(err);
      } finally {
        setBusy(key, false);
      }
    }

    async function stopRecording(index: number) {
      const resolvedIndex = resolveIndex(index);
      const state = recordingStates[resolvedIndex];
      if (!state?.recording) {
        lastAction.value = '当前没有录制任务';
        return;
      }
      const key = actionKey(resolvedIndex, 'record-stop');
      setBusy(key, true);
      state.stopping = true;
      try {
        const tabId = await ensureActiveTab();
        const response = await sendMessageToTab<{ success: boolean; error?: string }>(tabId, {
          type: MessageType.STOP_RECORD_VIDEO,
          index: resolvedIndex
        }, { frameId: currentFrameId.value ?? 0 });
        if (!response?.success) throw new Error(response?.error || '停止录制失败');
        lastAction.value = '正在停止录制…';
      } catch (err) {
        error.value = toFriendlyVideoError(err);
        state.stopping = false;
      } finally {
        setBusy(key, false);
      }
    }

    function recordingLabel(index?: number) {
      const state = recordingStates[resolveIndex(index)];
      if (!state) return '待命';
      if (state.recording) return state.stopping ? '停止中…' : '录制中';
      if (state.lastError) return `失败：${state.lastError}`;
      if (state.lastFileName) return '已完成';
      return '待命';
    }

    // P2-2：recordingElapsed 已删除，录制时长展示改由 RecordingTimer 组件局部计时实现

    function formatDuration(value?: number) {
      if (!value || Number.isNaN(value)) return '--';
      return formatReadableDuration(value);
    }

    function formatResolution(video?: VideoItemDTO) {
      const label = resolutionLabelOf({ width: video?.width, height: video?.height });
      return label || '未知分辨率';
    }

    /** Round 5 #27：嗅探直链的字节数；DOM 里的 <video> 没有体积，取不到就不显示 */
    function sizeOf(video?: VideoItemDTO): string {
      if (!video) return '';
      return sizeLabelOf(videoFactsOf(video).size);
    }

    /** Round 5 #27：封装格式标签。MSE 播放既无 src 也无直链时返回空串（认不出就不显示） */
    function formatOf(video?: VideoItemDTO): string {
      if (!video) return '';
      return formatLabelOf(videoFactsOf(video)) || '';
    }

    function renderVisibility(video?: VideoItemDTO) {
      if (!video) return '状态未知';
      if (video.visible === false) return '隐藏或不可见';
      return '可见';
    }

    function formatSource(src?: string) {
      if (!src) return '内联视频资源';
      try {
        const url = new URL(src, 'https://placeholder.local');
        const name = url.pathname.split('/').filter(Boolean).pop() || url.pathname;
        const host = url.hostname.replace(/^www\./, '');
        return `${host}${name ? ' · ' + truncate(name, 32) : ''}`;
      } catch (err) {
        return truncate(src, 48);
      }
    }

    function directSourceCount(video?: VideoItemDTO) {
      if (!video) return 0;
      if (typeof video.directSourceCount === 'number') return video.directSourceCount;
      return Array.isArray(video.directSources) ? video.directSources.length : 0;
    }

    /** MSE 流媒体（YouTube 等）：src 是内存句柄而非文件地址，只能录制保存 */
    function isStreamVideo(video?: VideoItemDTO) {
      return /^(blob|mediasource):/i.test(video?.src || '');
    }

    function isActionBusy(index: number | undefined, action: string) {
      return busyKeys.has(actionKey(resolveIndex(index), action));
    }

    function setBusy(key: string, value: boolean) {
      if (value) busyKeys.add(key);
      else busyKeys.delete(key);
    }

    /**
     * 单视频直链下载。
     * 评审（UI 二批之一）问题 5：返回 {ok, error} 结果对象，
     * 供批量下载聚合统计失败数与原因；单条入口失败也会 Toast 明示原因。
     * @param index 视频序号
     */
    async function downloadSingle(index: number): Promise<{ ok: boolean; error?: string }> {
      const resolvedIndex = resolveIndex(index);
      const key = actionKey(resolvedIndex, 'download');
      setBusy(key, true);
      downloadErrors[resolvedIndex] = '';
      try {
        const { sources, meta } = await fetchVideoSources(resolvedIndex, currentFrameId.value ?? 0);
        if(!sources.length) throw new Error(meta?.error || '无直链');
        const candidate = pickBestCandidate(sources);
        if(!candidate) throw new Error('无有效直链');

        // blob/MSE 句柄与 YouTube SABR 流都取不回独立文件，直链下载必然失败
        if (!isDownloadableSource(candidate)) {
           throw new Error('该视频为流媒体（如 YouTube），无可下载直链。请用「录制保存」，或在「音频抓取」面板提取音频。');
        }

        // 分段流：HLS 走分片下载+合并链路；DASH 交给后台解析（分轨流会给出明确拒绝原因）
        if (candidate.kind === 'hls' || candidate.kind === 'dash') {
          // 经 service 入队：自动附带当前页面作为来源，「只看本页」才认得视频任务
          const resp = await startHlsDownload(candidate.url);
          if (resp?.success) {
            lastAction.value = candidate.kind === 'hls' ? '已加入 HLS 下载队列（分片下载并自动合并）' : '已加入 DASH 下载队列（解析分片后自动合并）';
            return { ok: true };
          }
          throw new Error(resp?.error || '分段流任务创建失败');
        }

        const res = await triggerDirectVideoDownload(resolvedIndex, candidate, meta||{});
        if(!res.success) {
          if (res.error && res.error.includes('SERVER_FORBIDDEN')) {
             throw new Error('服务器拒绝访问 (403)，请尝试使用录制功能');
          }
          throw new Error(res.error||'下载失败');
        }

        // 标记为已下载
        const video = videos.value.find(v => v.index === resolvedIndex);
        if (video && video.src) {
          await markDownloaded(video.src);
        }

        lastAction.value = '已触发视频下载';
        return { ok: true };
      } catch(e:any){
        const msg = String(e?.message || e);
        downloadErrors[resolvedIndex] = msg;
        error.value = msg || '直链下载失败';
        return { ok: false, error: msg };
      } finally { setBusy(key,false); }
    }

    /**
     * 批量下载选中视频（评审问题 5）：逐条等待结果并统计失败原因，
     * 完成后用 Toast 汇总「已加入 N 条，M 条失败：原因」，替代旧单行小字。
     */
    async function downloadSelected() {
      if (!selectedIndexes.size) return;
      // 只作用于过滤结果中可见的项（与导出/全选口径一致），
      // 被过滤隐藏的残留勾选不参与批量下载
      const visible = new Set(displayVideos.value.map(v => resolveIndex(v.index)));
      const indexes = Array.from(selectedIndexes).filter(idx => visible.has(idx));
      if (!indexes.length) { toast.info('选中项均不在当前过滤结果中'); return; }
      lastAction.value = `开始批量下载 ${indexes.length} 个视频`;
      let okCount = 0;
      /** 失败原因清单（去重后取前两类进 Toast） */
      const reasons: string[] = [];
      for (const idx of indexes) {
        try {
          const r = await downloadSingle(idx);
          if (r.ok) okCount++;
          else reasons.push(r.error || '未知错误');
          // 简单的间隔防止请求过快
          await new Promise(res2 => setTimeout(res2, 500));
        } catch (e) {
          log.error(`Failed to download video ${idx}`, e);
          reasons.push(String(e));
        }
      }
      const fail = reasons.length;
      lastAction.value = fail ? `已加入 ${okCount} 条，${fail} 条失败` : `已加入 ${okCount} 条`;
      if (fail) toast.error(`已加入 ${okCount} 条，${fail} 条失败：${summarizeReasons(reasons)}`);
      else if (okCount) toast.success(`已加入下载队列 ${okCount} 条`);
      else toast.info('没有可下载项');
      log.info(`批量下载完成：成功 ${okCount} 条，失败 ${fail} 条`);
    }

    async function updateRestrictedHint(){
      try {
        const info = await getActiveTabInfo();
        restrictedHint.value = getRestrictedPageMessage(info?.url || info?.pendingUrl) || null;
      } catch {
        restrictedHint.value = null;
      }
    }

    async function ensureActiveTab(): Promise<number> {
      const info = await getActiveTabInfo();
      const tabId = info?.id ?? null;
      if (!tabId) {
        restrictedHint.value = null;
        throw new Error('请先在包含视频的标签页中打开侧边栏');
      }
      const hint = getRestrictedPageMessage(info?.url || info?.pendingUrl);
      if (hint) {
        restrictedHint.value = hint;
        throw new Error(hint);
      }
      restrictedHint.value = null;
      return tabId;
    }

    function actionKey(index: number, action: string) {
      return `${index}:${action}`;
    }

    function describeControlAction(action: VideoControlAction) {
      switch (action) {
        case 'play':
          return '已触发播放';
        case 'pause':
          return '已触发暂停';
        default:
          return '已执行操作';
      }
    }

    /**
     * 过滤 + 排序的内部实现（纯派生，无副作用）。
     * 评审（UI 二批之一）问题 4：过滤条件走共享纯函数 matchesVideoFilter，
     * 结果只影响视图（displayVideos），不再写回 videos，条件可逆、即时生效。
     * @param list 待过滤列表（含短暂保留的已移除项）
     */
    function applyVideoFilterAndSort(list: VideoItemDTO[]): VideoItemDTO[] {
      const criteria = {
        minWidth: minVideoWidth.value,
        minHeight: minVideoHeight.value,
        minDuration: minVideoDuration.value,
        downloadStatus: filterDownloadStatus.value,
        query: searchKit.searchQuery.value,
        expr: filterExpr.value
      };
      const filtered = list.filter(v => matchesVideoFilter(v, criteria, isDownloaded));
      if(!sortKey.value) return filtered;
      return filtered.slice().sort((a,b)=>{
        let va:any; let vb:any;
        switch(sortKey.value){
          case 'width': va=a.width||0; vb=b.width||0; break;
          case 'height': va=a.height||0; vb=b.height||0; break;
          case 'duration': va=a.duration||0; vb=b.duration||0; break;
          case 'sources': va=a.directSourceCount||0; vb=b.directSourceCount||0; break;
          default: va=''; vb='';
        }
        if(va==vb) return 0;
        return (va>vb?1:-1) * (sortDir.value==='asc'?1:-1);
      });
    }
    function toggleSort(key: string){ if(sortKey.value!==key){ sortKey.value=key; sortDir.value='asc'; } else { sortDir.value = sortDir.value==='asc' ? 'desc' : 'asc'; } scheduleSave(); }
    /** 应用过滤（评审问题 4）：视图由 displayVideos computed 自动派生，本函数只做持久化与日志 */
    function applyVideoFilter(){ scheduleSave(); log.debug(`视频过滤条件更新: 状态=${filterDownloadStatus.value}`); }

    // ===== 全局批量控制与聚合状态 =====
    const anyRecording = computed(() => Object.values(recordingStates).some(s=>s.recording));
    const playbackSummary = computed(() => {
      const total = videoCount.value;
      if(!total) return '无视频';
      let playing = 0; let paused = 0;
      videos.value.forEach(v=>{
        const st = playbackStates[v.index];
        if(st) playing++; else paused++;
      });
      return `${playing} 播放中 / ${paused} 已暂停`;
    });

    async function batchControl(action: VideoControlAction){
      const flagMap: Record<VideoControlAction,string> = { play:'playAll', pause:'pauseAll' } as any;
      const flag = flagMap[action];
      if(flag) globalBusy[flag] = true;
      try {
        for(const v of videos.value){ await controlVideo(v.index, action); }
        lastAction.value = `批量${action}`;
      } finally { if(flag) globalBusy[flag] = false; }
    }
    function playAll(){ batchControl('play'); }
    function pauseAll(){ batchControl('pause'); }

    const allPaused = computed(() => {
      if (videos.value.length === 0) return true;
      // 只要有一个在播放，就认为不是“全暂停”，按钮应显示“暂停”
      return !videos.value.some(v => playbackStates[resolveIndex(v.index)]);
    });

    function togglePlayAll() {
      if (allPaused.value) {
        playAll();
      } else {
        pauseAll();
      }
    }

    /**
     * 批量录制入口（评审 P0：高消耗操作补确认）。
     * 先统计"尚未在录制中"的视频数量 N：
     *  - N=0 时仅提示，不弹无意义的确认框；
     *  - N>0 时弹确认框，文案明示将同时录制 N 个视频及性能限制失败风险，
     *    用户确认后才逐个启动录制。
     */
    async function startRecordAll(){
      // 待启动清单：跳过已在录制中的视频，确认框数量与实际启动数一致
      const pending = videos.value.filter(v => !recordingStates[v.index]?.recording);
      if (!pending.length) { toast.info('当前所有视频均已在录制中'); return; }
      const ok = await confirmDialog({
        title: '批量录制视频',
        message: `将同时录制 ${pending.length} 个视频，浏览器可能因性能限制导致部分录制失败或画面卡顿；建议一次不超过 3~4 个。`,
        confirmText: `开始录制 ${pending.length} 个`,
      });
      if (!ok) return;
      globalBusy.recordAllStart = true;
      try { for(const v of pending){ await startRecording(v.index); } lastAction.value='批量启动录制'; }
      finally { globalBusy.recordAllStart=false; }
    }
    async function stopRecordAll(){ globalBusy.recordAllStop = true; try { for(const v of videos.value){ if(recordingStates[v.index]?.recording) await stopRecording(v.index); } lastAction.value='批量停止录制'; } finally { globalBusy.recordAllStop=false; } }

    function getRowClass(video: VideoItemDTO) {
      return {
        'row-new': newVideoHighlight.has(video.index),
        'row-removed': removedVideoHighlight.has(video.index)
      };
    }

    // ===== 收集篮 =====
    /** 批量加入收集篮（评审问题 5）：汇总新增与"已在篮中"数量，Toast 反馈 */
    async function addSelectedToBasket() {
      const picked = displayVideos.value
        .filter(v => selectedIndexes.has(v.index))
        .map(v => ({ kind: 'video' as const, url: v.src || v.directSources?.[0]?.url || '', title: (v.src || '').split('/').pop()?.split('?')[0] || `视频${v.index}` }));
      const valid = picked.filter(i => i.url);
      const n = await addToBasket(valid);
      const skipped = valid.length - n;
      if (n > 0) toast.success(skipped > 0 ? `已加入收集篮 ${n} 项，${skipped} 项已在篮中` : `已加入收集篮 ${n} 项`);
      else toast.info('选中项均已在收集篮中');
      log.info(`加入收集篮：新增 ${n} 项，跳过 ${skipped} 项`);
    }

    // ===== 清单导出（当前筛选+排序后的列表） =====
    function exportJson() {
      exportRowsAsJSON(displayVideos.value.map(v => ({
        index: v.index, src: v.src, width: v.width, height: v.height,
        duration: v.duration, visible: v.visible, directSourceCount: v.directSourceCount ?? 0
      })), '视频清单');
    }
    function exportCsv() {
      exportRowsAsCSV(displayVideos.value, [
        { label: '序号', value: v => v.index },
        { label: '分辨率', value: v => (v.width && v.height ? `${v.width}x${v.height}` : '') },
        { label: '时长', value: v => formatDuration(v.duration) },
        { label: '直链数', value: v => v.directSourceCount ?? 0 },
        { label: '地址', value: v => v.src || '' }
      ], '视频清单');
    }

    return {
      // UI 三批（组6）：PANEL_TITLES 放入 setup 返回值，供模板绑定 :title="PANEL_TITLES.video"
      PANEL_TITLES,
      videos,
      displayVideos,
      // 评审（UI 二批之一）：分页与"⋯"详情展开所需的新增暴露
      pagedVideos,
      page,
      totalPages,
      PAGE_SIZE,
      expandedIndex,
      toggleExpandIndex,
      debugTooltip,
      exportJson,
      exportCsv,
      newVideoHighlight,
      removedVideoHighlight,
      videoCount,
      loading,
      error,
      lastAction,
      recordingStates,
      playbackStates,
      refreshVideoList,
      controlVideo,
      startRecording,
      stopRecording,
      formatResolution,
      formatDuration,
      formatSource,
      renderVisibility,
      allSelected,
      indeterminateSelected,
      hasSelection,
      toggleSelectAll,
      toggleRecording,
      directSourceCount,
      isStreamVideo,
      recordingLabel,
      isActionBusy,
      downloadSingle,
      downloadSelected,
      // 收口轮 lint 修复：模板"加入收集篮"按钮绑定 addSelectedToBasket，
      // render 上下文此前漏暴露（按钮点击无效的隐性错误），补入
      addSelectedToBasket,
      downloadErrors,
      playbackSummary,
      playAll,
      pauseAll,
      togglePlayAll,
      allPaused,
      startRecordAll,
      stopRecordAll,
      anyRecording,
      globalBusy,
      queueTasks,
      retryTask,
      cancelTask,
      minVideoWidth,
      minVideoHeight,
      minVideoDuration,
      filterDownloadStatus,
      filterExpr,
      filterExprError,
      formatOf,
      sizeOf,
      isDownloaded,
      sortKey,
      sortDir,
      toggleSort,
      applyVideoFilter,
      searchQuery: searchKit.searchQuery,
      searchInputEl: searchKit.searchInputRef,
      focusSearch: searchKit.focusSearch,
      ensureBusy,
      ensureConnectAndRefresh,
      frameMode,
      frames,
      frameModeValue,
      // Round 5 #29：回收列表按绑定 tab +（显式选中的）子框架查询
      boundTabId,
      recoveredFrameId,
      onFrameModeChange,
      formatFrameLabel,
      adapterId,
      restrictedHint,
      fallbackRecord,
      shortcutHint,
      showShortcutHints,
      getRowClass,
      selectedIndexes,
      handleRowSelect
    };
  }
});

function resolveIndex(index?: number) {
  return typeof index === 'number' && index >= 0 ? index : 0;
}

function formatReadableDuration(value: number) {
  const totalSeconds = Math.floor(value);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  if (hours > 0) {
    return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
  }
  return `${pad(minutes)}:${pad(seconds)}`;
}

function truncate(value: string, maxLength = 48) {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength)}…`;
}

function toFriendlyVideoError(err: unknown) {
  if (isReceivingEndMissingError(err)) {
    return '无法连接当前页面的内容脚本，请确认站点受支持并允许扩展运行。';
  }
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  return '视频操作失败';
}
</script>

<style scoped>
.toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 10px;
  flex-wrap: wrap;
  gap: 6px;
}

.toolbar__left {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.toolbar__hint {
  /* UI 三批（组2）：计数提示属信息性文字，11px → 12px */
  font-size: 12px;
  color: var(--sp-color-muted);
}

/* 调试信息入口（评审问题 6）：适配器/子页面等开发者信息收进 ⓘ 悬浮提示 */
.debug-info {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: var(--sp-color-bg-subtle);
  color: var(--sp-color-muted);
  font-size: 11px;
  cursor: help;
  flex-shrink: 0;
}
.debug-info:hover { background: var(--sp-color-bg-subtle-hover); color: var(--sp-color-text); }

.toolbar__right {
  display: flex;
  gap: 6px;
  align-items: center;
}

/* UI 三批（组2）：状态行文字属信息性内容，11px → 12px */
.status { color: var(--sp-color-muted); font-size: 12px; }
.status--error { color: var(--sp-color-danger); }

.frame-select {
  height: 28px;
  padding: 0 8px;
  background: var(--sp-color-surface);
  border: 1px solid var(--sp-color-border-strong);
  border-radius: var(--sp-radius-sm);
  color: var(--sp-color-text);
  font-size: 11px;
  font-family: var(--sp-font-family);
  outline: none;
  cursor: pointer;
  max-width: 160px;
}

.global-video-bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  margin-bottom: 10px;
  gap: 6px;
  padding: 8px 12px;
  background: var(--sp-color-surface);
  border: 1px solid var(--sp-color-border);
  border-radius: var(--sp-radius-md);
}

.global-video-bar__left {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  align-items: center;
}

.global-video-bar__right {
  display: flex;
  align-items: center;
  gap: 8px;
}

.global-summary {
  /* UI 三批（组2）：播放聚合状态属信息性文字，11px → 12px */
  font-size: 12px;
  color: var(--sp-color-muted);
}

.filter-select {
  height: 26px;
  padding: 0 7px;
  background: var(--sp-color-bg-elevated);
  border: 1px solid var(--sp-color-border-strong);
  border-radius: var(--sp-radius-sm);
  color: var(--sp-color-text);
  font-size: 11px;
  font-family: var(--sp-font-family);
  outline: none;
}

.table-status {
  /* UI 三批（组2）：状态/提示行属信息性文字，11px → 12px */
  font-size: 12px;
  color: var(--sp-color-muted);
}

/* UI 二批之二：空状态「网站目录」入口（网站目录从一级 tab 降级后的引导链接） */
.empty-catalog-hint { display: flex; flex-direction: column; align-items: center; gap: 6px; }
.catalog-entry {
  background: none; border: none; padding: 0;
  /* UI 三批（组2）：入口链接属信息性文字，11px → 12px */
  color: var(--sp-color-primary); font-size: 12px; font-weight: 600;
  font-family: var(--sp-font-family); cursor: pointer;
  text-decoration: underline; text-underline-offset: 2px;
  transition: color var(--sp-transition-fast);
}
.catalog-entry:hover { color: var(--sp-color-primary-hover); }
.catalog-entry:focus-visible { outline: 2px solid var(--sp-color-primary); outline-offset: 2px; border-radius: var(--sp-radius-sm); }

.empty-row {
  text-align: center;
  color: var(--sp-color-muted);
  padding: 24px;
  font-size: 12px;
}

.row-new { animation: rowNewFade 2.4s ease-in forwards; }
.row-removed { animation: rowRemovedFade 0.9s ease-out forwards; }

@keyframes rowNewFade {
  0% { background: var(--sp-color-primary-glow); }
  100% { background: transparent; }
}
@keyframes rowRemovedFade {
  0% { background: rgba(239, 68, 68, 0.3); }
  100% { background: transparent; opacity: 0; }
}

.video-meta__primary {
  /* UI 三批（组2）：行主信息（序号+来源）属信息性文字，11px → 12px，与图片面板 card-title 对齐 */
  font-size: 12px;
  font-weight: 500;
  color: var(--sp-color-heading);
  /* 窄侧栏下来源行单行省略（完整地址在"⋯"详情中查看），避免长 URL 撑破行高 */
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.video-meta__secondary {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  color: var(--sp-color-muted);
  /* UI 三批（组2）：规格/时长等元信息，11px → 12px */
  font-size: 12px;
  margin-top: 1px;
}

/* 流媒体常驻提示：说明为何没有直链，并就地给出录制入口 */
.stream-hint {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  margin-top: 4px;
  padding: 3px 6px;
  background: var(--sp-color-warning-light);
  border-radius: var(--sp-radius-sm);
  color: var(--sp-color-warning);
  font-size: 12px;
}

/* "⋯"展开的行详情：完整地址/直链数/可见性/下载（评审问题 1/6） */
.row-detail {
  margin-top: 6px;
  padding: 6px 8px;
  background: var(--sp-color-bg-subtle);
  border-radius: var(--sp-radius-sm);
  /* UI 三批（组2）：详情区（地址/直链/可见性）属信息性文字，11px → 12px */
  font-size: 12px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  align-items: flex-start;
}
.detail-row {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}
.detail-inline {
  color: var(--sp-color-muted);
  flex-wrap: wrap;
}
.detail-label {
  color: var(--sp-color-muted);
  flex-shrink: 0;
}
.detail-url {
  color: var(--sp-color-primary);
  word-break: break-all;
  min-width: 0;
}
.detail-url.muted { color: var(--sp-color-muted); }

.row-actions {
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
}

/* UI 三批（组1/组2）：原 .chip/.chip--success/.chip--ghost/.chip--danger 复制版徽标样式已删除，
   「已下载/未下载/录制状态」徽标唯一实现收敛在共享组件 BaseTag（size=sm，12px；
   原默认 chip 主色 → info 语义，chip--danger → danger 语义） */

.recording-hint {
  /* UI 三批（组2）：录制计时属元信息，11px → 12px */
  font-size: 12px;
  color: var(--sp-color-muted);
  font-family: var(--sp-font-mono, monospace);
}

/* UI 三批（组1）：原 .restricted-banner/.banner-close 复制版样式已删除，
   横幅视觉唯一实现收敛在共享组件 RestrictedBanner 内部 */

.download-error {
  /* UI 三批（组2）：下载失败原因属信息性文字，11px → 12px */
  font-size: 12px;
  color: var(--sp-color-danger);
  margin-top: 2px;
}

/* 分页控件（评审问题 2）：与图片面板同款（UI 三批组6 术语同步） */
.pager {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 8px 12px;
  background: var(--sp-color-bg-elevated);
}
.pager__info {
  /* UI 三批（组2）：分页计数属元信息，11px → 12px */
  font-size: 12px;
  color: var(--sp-color-muted);
  margin: 0 4px;
}

input[type='checkbox'] {
  width: 13px;
  height: 13px;
  accent-color: var(--sp-color-primary);
  cursor: pointer;
}
</style>
