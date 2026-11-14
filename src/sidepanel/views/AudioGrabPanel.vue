<template>
  <!-- UI 三批（组6）：标题改引用 terminology 常量 PANEL_TITLES.audio，与分段 tab 文案三处同源 -->
  <BaseCard :title="PANEL_TITLES.audio" subtitle="识别音频资源并补充时长/大小元数据" :padded="true">
    <div class="toolbar">
      <div class="toolbar__left">
        <BaseButton size="sm" variant="secondary" :loading="loading" @click="refreshAudioList">
          重新扫描
        </BaseButton>
        <!-- 评审（UI 二批之一）问题 6：原"重试连接"为开发者术语，改为"修复扫描"并说明预期 -->
        <BaseButton size="sm" variant="ghost" :loading="ensureBusy" :disabled="loading" @click="ensureConnectAndRefresh"
          title="页面无响应或扫描无结果时，重新注入页面脚本并再次扫描">修复扫描</BaseButton>
        <!-- Round 5 #29：嗅探之外的两条候选找回路径（回收后自动重扫列表） -->
        <MediaSweepControls @done="refreshAudioList" />
        <BaseButton size="sm" variant="ghost" @click="handleSelectAll(!allSelected)" :disabled="!displayAudioItems.length">
          {{ allSelected ? '取消全选' : '全选' }}
        </BaseButton>
        <select class="sp-select" v-model="filterDownloadStatus" @change="applyAudioFilter" :disabled="loading">
          <option value="all">全部状态</option>
          <option value="new">未下载</option>
          <option value="downloaded">已下载</option>
        </select>
      </div>
      <div class="toolbar__right">
        <BaseButton size="sm" variant="ghost" :disabled="!displayAudioItems.length" @click="exportCsv">导出CSV</BaseButton>
        <BaseButton size="sm" variant="ghost" :disabled="!displayAudioItems.length" @click="exportJson">导出JSON</BaseButton>
        <BaseButton size="sm" variant="ghost" :disabled="!hasSelection" @click="addSelectedToBasket">加入收集篮</BaseButton>
        <BaseButton size="sm" :disabled="!hasSelection || bulkDownloading" :loading="bulkDownloading" @click="downloadSelected">
          下载所选 ({{ selectedCount }})
        </BaseButton>
        <div class="recording-control">
            <span v-if="audioRecording.recording" class="recording-timer">{{ recordingTimerDisplay }}</span>
            <BaseButton size="sm"
              :variant="audioRecording.recording ? 'danger' : 'secondary'"
              :disabled="loading || audioRecordingBusy"
              :loading="audioRecordingBusy"
              @click="toggleAudioRecording">
              {{ audioRecording.recording ? '停止录制' : '提取当前播放视频音频' }}
            </BaseButton>
        </div>
      </div>
    </div>

    <!-- 评审（UI 二批之一）问题 3：重复筛选补动作（与图片面板同一交互习惯；UI 三批组6 术语同步） -->
    <div class="filter-bar">
      <label class="dup-toggle" title="隐藏 URL+大小重复的冗余副本，每组保留第一条">
        <input type="checkbox" v-model="hideDuplicates" />隐藏重复
      </label>
      <!-- Round 5 #28：属性表达式，覆盖「只看 50MB 以上的 mp3」这类两个下拉表达不了的组合 -->
      <ExprFilterInput
        v-model="filterExpr"
        :error="filterExprError"
        placeholder="表达式：size>10MB format=mp3"
        label="音频属性过滤表达式"
      />
      <BaseButton size="sm" variant="ghost" :disabled="!duplicateSet.size" @click="selectDuplicates">选中重复项</BaseButton>
      <BaseButton size="sm" variant="ghost" :disabled="!duplicateSet.size" @click="deselectDuplicates">取消选中重复</BaseButton>
      <BaseButton size="sm" variant="ghost" @click="resetFilter">重置</BaseButton>
    </div>

    <!-- 下载队列展示 -->


    <!-- UI 三批（组1）：受限横幅收敛到共享组件 RestrictedBanner（warning 语义唯一实现），
         删除本面板复制版 .restricted-banner/.banner-* 样式与内联 svg；
         close 事件仅清空本面板 restrictedHint 状态，受限检测业务逻辑零改动 -->
    <RestrictedBanner v-if="restrictedHint" :message="restrictedHint" @close="restrictedHint = null" />

    <SelectionTable
      :items="pagedAudioItems"
      :selected="selected"
      row-key="url"
      :dense="true"
      :loading="loading"
      :row-class="getRowClass"
      @select-all="handleSelectAll"
      @select-row="handleRowSelect"
    >
      <template #toolbar>
        <div class="table-status">
          <span>已识别 {{ items.length }} 条音频</span>
          <span v-if="displayAudioItems.length !== items.length" class="status">过滤后 {{ displayAudioItems.length }} 条</span>
          <span v-if="error && !restrictedHint" class="status status--error">{{ error }}</span>
          <span v-else-if="loading" class="status">扫描中…</span>
          <span v-else-if="lastAction" class="status">{{ lastAction }}</span>
        </div>
        <BaseSearchBar
          v-model="audioSearchQuery"
          :inputRef="audioSearchInputEl"
          :disabled="loading"
          placeholder="搜索音频 标题/URL (Ctrl+F)"
          :hint="shortcutHint"
          :show-hint="showShortcutHints"
        />
      </template>
      <!-- 评审（UI 二批之一）问题 1：7 列（标题/链接/时长/大小/状态/重复/操作，合计约 510px+）
           在 300-400px 侧栏必然横向滚动。砍到 2 个数据列：
           "音频"列常驻标题+来源+时长/大小/状态/重复徽标（原独立列全部内联），
           URL 折叠进"⋯"详情；"操作"列保留下载与展开入口 -->
      <template #header>
        <th>音频</th>
        <th style="width: 84px;">操作</th>
      </template>
      <template #empty>
        <div class="empty-catalog-hint">
          <span>未在当前页面检测到音频资源</span>
          <!-- UI 二批之二：网站目录不再是独立 tab，空状态提供入口链接（选站打开后回到视频子模式扫描） -->
          <button type="button" class="catalog-entry" @click="$emit('open-site-catalog')">从网站目录选择站点打开 →</button>
        </div>
      </template>
      <template #row="{ item }">
        <td>
          <div class="title">{{ item.title || '未命名音频' }}</div>
          <div class="item-meta">
            <span class="subtitle">{{ extractHost(item.url) }}</span>
            <BaseTag v-if="formatOf(item)" size="sm" variant="neutral">{{ formatOf(item) }}</BaseTag>
            <span>{{ formatDuration(metaMap[item.url]?.duration) }}</span>
            <span>{{ formatSize(metaMap[item.url]?.contentLength ?? item.size) }}</span>
            <!-- UI 三批（组1/组2）：状态徽标改用共享组件 BaseTag（size=sm，12px 紧凑形态），
                 删除本地 .chip/.chip--*/.dup-badge 复制样式；「重复」统一为 warning 语义，
                 原图像无边框/音频有边框的分叉就此消除 -->
            <BaseTag v-if="isDownloaded(item.url)" size="sm" variant="success">已下载</BaseTag>
            <BaseTag v-else size="sm" variant="neutral">未下载</BaseTag>
            <BaseTag v-if="duplicateSet.has(item.url)" size="sm" variant="warning" title="URL+大小重复">重复</BaseTag>
          </div>
          <!-- "⋯"展开的详情区：完整地址 + 复制（原"链接"常驻列折叠于此） -->
          <div v-if="expandedUrl === item.url" class="row-detail">
            <a class="detail-url" :href="item.url" target="_blank" rel="noreferrer">{{ item.url }}</a>
            <BaseButton size="sm" variant="ghost" @click="copyLink(item.url)">复制链接</BaseButton>
          </div>
        </td>
        <td>
          <div class="row-actions">
            <BaseButton size="sm" :loading="downloadingUrls.has(item.url)" @click="downloadSingle(item)">
              下载
            </BaseButton>
            <BaseButton
              size="sm"
              variant="ghost"
              :title="expandedUrl === item.url ? '收起详情' : '查看详情（地址）'"
              :aria-expanded="expandedUrl === item.url"
              @click="toggleExpandUrl(item.url)"
            >⋯</BaseButton>
          </div>
        </td>
      </template>
      <!-- 评审（UI 二批之一）问题 2：对齐图片面板的分页方案（分页比虚拟化实现更稳、
           且与图片保持同一交互习惯），上百条时只渲染当前页（UI 三批组6 术语同步） -->
      <template #footer>
        <div class="pager" v-if="displayAudioItems.length > PAGE_SIZE">
          <BaseButton size="sm" variant="ghost" :disabled="page <= 1" @click="page = 1">首页</BaseButton>
          <BaseButton size="sm" variant="ghost" :disabled="page <= 1" @click="page--">上一页</BaseButton>
          <span class="pager__info">第 {{ page }} / {{ totalPages }} 页 · 共 {{ displayAudioItems.length }} 条</span>
          <BaseButton size="sm" variant="ghost" :disabled="page >= totalPages" @click="page++">下一页</BaseButton>
          <BaseButton size="sm" variant="ghost" :disabled="page >= totalPages" @click="page = totalPages">末页</BaseButton>
        </div>
      </template>
    </SelectionTable>

    <!-- 录制成果：录音完成后交接后台落库，这里提供试听/下载 M4A/删除；
         修复「录音下载后打不开（webm 兼容差）、录完无处查看」的反馈 -->
    <CaptureRecordingList mode="audio" />
  </BaseCard>
</template>

<script lang="ts">
import { computed, defineComponent, onMounted, onBeforeUnmount, reactive, ref, watch } from 'vue';
// UI 三批（组1）：新增共享组件 RestrictedBanner（受限横幅唯一实现）与 BaseTag（状态徽标唯一实现），
// 替换本面板模板中的复制版横幅与 .chip/.dup-badge 徽标
import { BaseButton, BaseCard, SelectionTable, BaseSearchBar, RestrictedBanner, BaseTag, ExprFilterInput } from '../components/base';
// 录制成果列表：录音完成后经后台落库的产物（试听/下载 M4A/删除）
import CaptureRecordingList from '../components/CaptureRecordingList.vue';
// Round 5 #29：缓存捕捉 / 深度搜索按钮组（音视频面板共用）
import MediaSweepControls from '../components/MediaSweepControls.vue';
// UI 三批（组6）：面板标题集中术语常量（PANEL_TITLES.audio = 「音频抓取」），与分段 tab 同源
import { PANEL_TITLES } from '../utils/terminology';
import { GLOBAL_SHORTCUT_HINT } from '../utils/shortcutHints';
import { useListSearch } from '../composables/useListSearch';
import { useRowHighlight } from '../composables/useRowHighlight';
import { useResourceCounts } from '../composables/useResourceCounts';
// 评审（UI 二批之一）：分页切片/页码钳制/重复集合计算/重复项操作/过滤判定统一走共享纯函数模块
import {
  slicePage, clampPage, computeDuplicateSet, collectDuplicateKeys,
  hideRedundantDuplicates, matchesAudioFilter, summarizeReasons
} from '../utils/listAdapt';
import { MessageType, type AudioItemDTO } from '@/messaging';
// Round 5 #27/#28：格式标签与属性过滤表达式（纯模块，与单测同一入口）
import { formatLabelOf } from '@/core/mediaMeta';
import { compileFilterCached } from '@/core/mediaFilter';
import { addDownload, subscribe, retryDownload, cancelDownload, type DownloadTask } from '../services/downloadQueue';
import { exportRowsAsJSON, exportRowsAsCSV } from '../services/exportList';
import { addToBasket } from '../services/collection';
import { toast } from '../composables/useToast';
import { loadHistory, isDownloaded } from '../services/downloadHistory';
import { loadState, saveState } from '../services/persist';
import { loadSettings } from '../services/settings';
import { markProcessed, isProcessed, mediaKey } from '../composables/useMediaRegistry';
// P1-8：分级日志（扩展页面上下文默认 info 级）
import { createLogger } from '@/utils/logger';
import {
  getActiveTabInfo,
  sendMessageToTab,
  isReceivingEndMissingError,
  ensureContentConnected,
  getAllFramesInfo,
  getAllFrameIds,
  sendRuntimeMessage,
  type FrameInfo
} from '../utils/chromeMessaging';
import { getRestrictedPageMessage } from '../utils/restrictedPages';
import { isResourceUpdateFromBoundSource } from '../utils/resourceUpdate';

/** 本模块 logger：保留原 `[audio enrich]` 前缀语义 */
const log = createLogger('audio enrich');

interface AudioListResponse {
  success: boolean;
  error?: string;
  items?: AudioItemDTO[];
}

interface AudioMeta {
  duration?: number; // 秒
  contentLength?: number; // 字节
  contentType?: string;
}


export default defineComponent({
  name: 'AudioGrabPanel',
  // UI 三批（组1）：注册共享组件 RestrictedBanner / BaseTag（Options API 需在 components 中声明）
  components: { BaseButton, BaseCard, SelectionTable, BaseSearchBar, RestrictedBanner, BaseTag, CaptureRecordingList, MediaSweepControls, ExprFilterInput },
  // UI 二批之二：网站目录降级为抓取空状态入口后，本面板通过该事件请求容器打开目录覆盖层
  emits: ['open-site-catalog'],
  setup() {
    const { setCount } = useResourceCounts();
    const items = ref<AudioItemDTO[]>([]);
    const { newSet: newAudioHighlight, removedSet: removedAudioHighlight, markNew: markAudioNew, markRemoved: markAudioRemoved } = useRowHighlight({ ttlNew: 2500, ttlRemoved: 900 });
    const ephemeralRemovedAudio = reactive<Record<string, AudioItemDTO>>({});
    const displayAudioItems = computed(() => {
      const base = items.value.slice();
      Object.keys(ephemeralRemovedAudio).forEach(k => { if (!base.find(i => i.url === k)) base.push(ephemeralRemovedAudio[k]); });
      return applyFilterAndSort(base);
    });
    const metaMap = reactive<Record<string, AudioMeta>>({});
    const loading = ref(false);
    const bulkDownloading = ref(false);
    const error = ref<string | null>(null);
    const lastAction = ref('');
    const selected = reactive<Set<string>>(new Set());
    const downloadingUrls = reactive<Set<string>>(new Set());
    const minDuration = ref<number>(0);
    const minSize = ref<number>(0);
    const filterDownloadStatus = ref<'all'|'downloaded'|'new'>('all');
    // Round 5 #28：属性过滤表达式（size>50MB and format=mp3）。语法错误只提示不裁剪列表
    const filterExpr = ref('');
    const filterExprError = computed(() => compileFilterCached(filterExpr.value).error || '');
    // 评审（UI 二批之一）问题 3：「隐藏重复」开关（会话级，不持久化）
    const hideDuplicates = ref(false);
    // 评审（UI 二批之一）问题 1：当前展开"⋯"详情的行 URL（单开模式，避免窄屏堆叠过长）
    const expandedUrl = ref<string | null>(null);
    const sortKey = ref<string>(''); // duration|size|title|url
    const sortDir = ref<'asc'|'desc'>('asc');
    const searchKit = useListSearch({
      onRefresh: () => refreshAudioList(),
      selectAll: () => { selected.clear(); displayAudioItems.value.forEach(i=> selected.add(i.url)); scheduleSave(); },
      clearSelection: () => { selected.clear(); scheduleSave(); },
      invertSelection: () => { const all = displayAudioItems.value.map(i=> i.url); const next = new Set<string>(); all.forEach(u=>{ if(!selected.has(u)) next.add(u); }); selected.clear(); next.forEach(u=> selected.add(u)); scheduleSave(); },
      selectNew: () => { newAudioHighlight.forEach(u=> { if(typeof u === 'string') selected.add(u); }); scheduleSave(); }
    });
    const frameMode = ref<'auto'|'top'|'frame'>('auto');
    const frames = ref<FrameInfo[]>([]);
    const frameModeValue = ref<string>('auto');
    const ensureBusy = ref(false);
    const restrictedHint = ref<string | null>(null);
    const queueTasks = ref<DownloadTask[]>([]);
    const audioRecording = reactive<{ recording: boolean; startedAt?: number; fileName?: string; error?: string; frameId?: number; videoIndex?: number }>({ recording: false });
    const audioRecordingBusy = ref(false);
    const shortcutHint = GLOBAL_SHORTCUT_HINT;
    const showShortcutHints = ref(true);
    let removeRuntimeListener: (()=>void)|null = null;
    let unsubscribeQueue: (()=>void) | null = null;

    const selectedCount = computed(() => selected.size);
    const hasSelection = computed(() => selected.size > 0);
    // 全选语义：作用于完整过滤结果（displayAudioItems），与导出/批量下载口径一致
    const allSelected = computed(() => displayAudioItems.value.length > 0 && displayAudioItems.value.every(i => selected.has(i.url)));

    // ── 分页渲染（评审问题 2：对齐图片面板既有方案；UI 三批组6 术语同步）──
    const PAGE_SIZE = 60; // 每页渲染行数：与图片面板一致，保持同一交互习惯
    const page = ref(1); // 当前页码（1 起）
    const totalPages = computed(() => Math.max(1, Math.ceil(displayAudioItems.value.length / PAGE_SIZE)));
    /** 当前页渲染切片（共享纯函数 slicePage，只渲染本页行） */
    const pagedAudioItems = computed(() => slicePage(displayAudioItems.value, page.value, PAGE_SIZE));
    // 过滤/刷新后列表变短：页码越界时自动钳制到最后一页
    watch(displayAudioItems, () => {
      page.value = clampPage(page.value, displayAudioItems.value.length, PAGE_SIZE);
    });

    let saveTimer: number | null = null;
    function scheduleSave(){
      if(saveTimer) clearTimeout(saveTimer);
      saveTimer = window.setTimeout(()=>{ saveState({ selections: { audio: Array.from(selected) } }); }, 500);
    }

    let boundFrameId: number | null = null; // 当前音频列表绑定的来源 frameId（增量更新按 frame 过滤）
    let boundTabId: number | null = null; // 当前音频列表绑定的来源 tabId（增量更新按 tab 过滤，防后台标签页串扰）

    /** 网络嗅探补充的音频（DOM 增量更新时需重新并入，否则会被全量覆盖掉） */
    const networkAudioExtras = ref<AudioItemDTO[]>([]);

    /** 把网络嗅探补充项并回 DOM 扫描结果，按 URL 去重、DOM 项优先 */
    function withNetworkAudio(domItems: AudioItemDTO[]): AudioItemDTO[] {
      if (!networkAudioExtras.value.length) return domItems;
      const seen = new Set(domItems.map(i => i.url));
      const extra = networkAudioExtras.value.filter(i => !seen.has(i.url));
      return extra.length ? [...domItems, ...extra] : domItems;
    }

    /**
     * 拉取后台网络嗅探到的音频直链并缓存为补充项。
     * DOM 扫描（content-scripts/audio.ts）只认 .mp3/.m4a 等扩展名与 <audio> 标签，
     * 而大量站点的音频地址无扩展名、仅靠 Content-Type: audio/* 判定，只有后台
     * webRequest 通道看得到。此前该通道只被视频面板消费，音频面板永远漏掉这部分。
     * @param tabId 当前标签页
     * @param domItems DOM 扫描结果（优先保留，标题更准确）
     */
    async function mergeNetworkAudio(tabId: number, domItems: AudioItemDTO[]): Promise<AudioItemDTO[]> {
      try {
        const resp = await sendRuntimeMessage<{ success?: boolean; sources?: { url: string; kind?: string; streamOnly?: boolean; mimeType?: string; extension?: string; size?: number }[] }>(
          { type: MessageType.GET_CAPTURED_VIDEO_SOURCES, tabId }
        );
        if (!resp?.success || !Array.isArray(resp.sources)) return withNetworkAudio(domItems);
        const extras: AudioItemDTO[] = [];
        const seen = new Set<string>();
        resp.sources.forEach(s => {
          // streamOnly 是 YouTube SABR 这类取不回文件的流；非 http(s) 无法下载
          if (s.kind !== 'audio' || s.streamOnly || !/^https?:/i.test(s.url || '') || seen.has(s.url)) return;
          seen.add(s.url);
          extras.push({
            url: s.url,
            title: titleFromAudioUrl(s.url),
            mimeType: s.mimeType,
            extension: s.extension,
            size: s.size,
            kind: 'audio'
          });
        });
        networkAudioExtras.value = extras;
        return withNetworkAudio(domItems);
      } catch (e) {
        log.warn('合并网络嗅探音频失败', e);
        return withNetworkAudio(domItems);
      }
    }

    /** 无标题的网络音频：用路径末段兜底，再退到主机名，避免整列显示"未命名音频" */
    function titleFromAudioUrl(url: string): string {
      try {
        const u = new URL(url);
        const last = u.pathname.split('/').filter(Boolean).pop();
        return last ? decodeURIComponent(last) : u.hostname;
      } catch {
        return url;
      }
    }

    async function refreshAudioList() {
      loading.value = true;
      error.value = null;
      lastAction.value = '';
      try {
        const tabId = await ensureActiveTab();
        boundTabId = tabId;
        // 启用音频相关功能（轻量，无需等待）
        try { void sendMessageToTab<any>(tabId, { type: MessageType.ENABLE_FEATURES, payload: { audio: true, spaWatchers: true } }); } catch { /* noop */ }
        try { frames.value = await getAllFramesInfo(tabId); } catch { /* noop */ }
        let response: AudioListResponse | undefined;
        if(frameMode.value==='top'){
          response = await sendMessageToTab<AudioListResponse>(tabId, { type: MessageType.REQUEST_AUDIO_LIST });
        } else if(frameMode.value==='frame'){
          const fid = parseSelectedFrameId();
          response = await sendMessageToTab<AudioListResponse>(tabId, { type: MessageType.REQUEST_AUDIO_LIST }, { frameId: fid! });
        } else {
          // auto: 顶层->子帧
          response = await sendMessageToTab<AudioListResponse>(tabId, { type: MessageType.REQUEST_AUDIO_LIST });
          if(!(response?.success) || !(Array.isArray(response?.items) && response!.items!.length>0)){
            const ids = await getAllFrameIds(tabId);
            for(const fid of ids){
              try{
                const r = await sendMessageToTab<AudioListResponse>(tabId, { type: MessageType.REQUEST_AUDIO_LIST }, { frameId: fid });
                if(r?.success && Array.isArray(r.items) && r.items.length){ response = r; frameMode.value='frame'; frameModeValue.value='f:'+fid; break; }
              }catch { /* noop */ }
            }
          }
        }
        if (!response?.success) throw new Error(response?.error || '扫描失败');
        // 绑定本次列表来源 frame：优先用响应自带的 frameId，其次按模式推导
        boundFrameId = typeof (response as any)?.frameId === 'number'
          ? (response as any).frameId
          : (frameMode.value === 'frame' ? (parseSelectedFrameId() ?? 0) : 0);
        items.value = await mergeNetworkAudio(tabId, response.items || []);
        selected.clear();
        setCount('audio', items.value.length);
        // 异步补充元数据
        enrichAllMetadata(items.value).catch((e) => log.warn('error', e));
      } catch (err: any) {
        // 自动修复：接收端缺失时尝试注入并重试一次
        if (isReceivingEndMissingError(err)) {
          try {
            const tabId = await ensureActiveTab();
            const res = await ensureContentConnected(tabId);
            if (res.ok) {
              boundTabId = tabId;
              boundFrameId = 0; // 重试走顶层获取，绑定随之回到主页面
              const retry = await sendMessageToTab<AudioListResponse>(tabId, { type: MessageType.REQUEST_AUDIO_LIST });
              if (retry?.success && Array.isArray(retry.items)) {
                items.value = await mergeNetworkAudio(tabId, retry.items);
                selected.clear();
                setCount('audio', items.value.length);
                enrichAllMetadata(items.value).catch(()=>{});
                return;
              }
            }
          } catch { /* noop */ }
        }
        if (!restrictedHint.value) { error.value = toFriendlyError(err); }
        items.value = [];
        selected.clear();
        setCount('audio', 0);
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
        if(!res.ok){ throw new Error(res.error || `未能连接到页面（已检查 ${res.framesChecked} 个子页面）`); }
        lastAction.value = `已重新连接页面（${res.framesConnected}/${res.framesChecked} 个子页面），正在扫描…`;
        log.info(`修复扫描成功：连接 ${res.framesConnected}/${res.framesChecked} 个子页面`);
        await refreshAudioList();
      }catch(e:any){ error.value = e?.message || '修复扫描失败，请刷新页面后重试'; }
      finally{ ensureBusy.value=false; }
    }

    /** 全选/取消全选：作用于完整过滤结果（displayAudioItems），而非仅当前页或原始列表 */
    function handleSelectAll(checked: boolean) {
      if (checked) { selected.clear(); displayAudioItems.value.forEach((item) => selected.add(item.url)); }
      else { selected.clear(); }
      scheduleSave();
    }

    /** 「⋯」详情展开切换：单开模式，再次点击同一行收起 */
    function toggleExpandUrl(url: string) {
      expandedUrl.value = expandedUrl.value === url ? null : url;
    }

    function handleRowSelect(url: string) {
      if (selected.has(url)) selected.delete(url);
      else selected.add(url);
      scheduleSave();
    }

    async function copyLink(url: string) {
      try {
        await navigator.clipboard.writeText(url);
        lastAction.value = '已复制链接'; toast.success('已复制链接');
      } catch (err) {
        error.value = '复制失败，请手动选择文本';
        log.error('复制链接失败:', err);
      }
    }

    /** 单条下载：入队成功即时反馈；失败给出可行动提示（评审问题 5） */
    async function downloadSingle(item: AudioItemDTO) {
      try {
        const key = mediaKey({ url: item.url, kind: 'audio', width:0, height:0 });
        if(isProcessed(key)) { lastAction.value = '已处理'; return; }
        const id = await triggerDownload(item); // queue integration
        if (!id) throw new Error('队列创建失败');
        markProcessed(key);
        lastAction.value = '已加入队列';
        toast.success('已加入下载队列');
        scheduleSave();
      } catch (err: any) {
        error.value = err?.message || '下载失败';
        toast.error(`加入下载队列失败：${String(err?.message || err)}`);
        log.error(`单条音频下载入队失败: ${item.url}`, err);
      }
    }

    /**
     * 批量下载（评审问题 5）：逐条等待入队结果并统计失败原因，
     * 完成后用 Toast 汇总「已加入 N 条，M 条失败：原因」，替代旧 11px 小字。
     */
    async function downloadSelected() {
      if (!hasSelection.value) return;
      error.value = null;
      let count = 0;
      /** 失败原因清单（去重后取前两类进 Toast） */
      const reasons: string[] = [];
      try {
        for (const url of Array.from(selected)) {
          // 只作用于过滤结果中可见的项（与导出/全选口径一致），
          // 被过滤隐藏的残留勾选不参与批量下载
          const item = displayAudioItems.value.find((it) => it.url === url);
          if (!item) continue;
          const key = mediaKey({ url: item.url, kind: 'audio', width:0, height:0 });
          if(isProcessed(key)) continue;
          try {
            const id = await triggerDownload(item);
            if (!id) throw new Error('队列创建失败');
            markProcessed(key);
            count++;
          } catch (e: any) {
            reasons.push(String(e?.message || e));
          }
        }
        const fail = reasons.length;
        lastAction.value = fail ? `已加入 ${count} 条，${fail} 条失败` : `已加入 ${count} 条`;
        if (fail) toast.error(`已加入 ${count} 条，${fail} 条失败：${summarizeReasons(reasons)}`);
        else if (count) toast.success(`已加入下载队列 ${count} 条`);
        else toast.info('没有可下载项（均已加入队列或已处理）');
        log.info(`批量下载完成：成功 ${count} 条，失败 ${fail} 条`);
        scheduleSave();
      } catch (err: any) {
        error.value = err?.message || '批量加入队列失败';
      }
    }

    function extractHost(url: string | undefined) {
      if (!url) return '未知来源';
      try {
        const u = new URL(url);
        return u.hostname;
      } catch {
        return '未知来源';
      }
    }

    /**
     * 触发下载入队。
     * 评审（UI 二批之一）问题 5：返回后台分配的队列任务 id（失败为空串），
     * 供单条/批量下载判断入队是否真正成功并汇总失败数。
     * @param item 音频条目
     */
    function triggerDownload(item: AudioItemDTO): Promise<string> {
      // 传 undefined 让后台命名模板处理
      return addDownload(item.url, undefined, 'audio', MessageType.START_DOWNLOAD);
    }

    function formatDuration(d?: number) {
      if (d == null || Number.isNaN(d)) return '…';
      const total = Math.floor(d);
      const m = Math.floor(total / 60);
      const s = total % 60;
      return m > 0 ? `${m}:${String(s).padStart(2, '0')}` : `${s}s`;
    }

    function formatSize(bytes?: number) {
      if (!bytes) return '…';
      const mb = bytes / (1024 * 1024);
      if (mb >= 1) return mb.toFixed(2) + 'MB';
      const kb = bytes / 1024;
      return kb.toFixed(1) + 'KB';
    }

    /** 封装格式标签（MP3/M4A/HLS…）；认不出返回空串，模板据此不渲染徽标 */
    function formatOf(item: AudioItemDTO): string {
      return formatLabelOf({ url: item.url, mimeType: item.mimeType, extension: item.extension }) || '';
    }

    async function enrichAllMetadata(list: AudioItemDTO[]) {
      const concurrency = 4;
      let i = 0;
      while (i < list.length) {
        const slice = list.slice(i, i + concurrency);
        await Promise.all(slice.map(enrichSingle));
        i += concurrency;
      }
    }

    async function enrichSingle(item: AudioItemDTO) {
      if (metaMap[item.url]) return; // 已在处理中或完成
      metaMap[item.url] = {}; // 预占位
      // HEAD 获取 content-length / type
      try {
        const headResp = await fetch(item.url, { method: 'HEAD' });
        if (headResp.ok) {
          const len = parseInt(headResp.headers.get('content-length') || '0', 10) || undefined;
          const type = headResp.headers.get('content-type') || undefined;
          metaMap[item.url] = { ...metaMap[item.url], contentLength: len, contentType: type };
        }
      } catch {
        // ignore
      }
      // duration 通过创建音频元素 (可能受 CORS 限制)
      try {
        await new Promise<void>((resolve) => {
          const audio = new Audio();
          audio.preload = 'metadata';
          const timeout = setTimeout(() => resolve(), 3500);
          audio.addEventListener('loadedmetadata', () => {
            clearTimeout(timeout);
            if (!Number.isNaN(audio.duration) && audio.duration > 0) {
              metaMap[item.url] = { ...metaMap[item.url], duration: audio.duration };
            }
            resolve();
          });
          audio.addEventListener('error', () => {
            clearTimeout(timeout);
            resolve();
          });
          audio.src = item.url;
        });
      } catch {
        // ignore
      }
    }

    onMounted(async () => {
      // 加载下载历史
      await loadHistory();
      try {
        const st = await loadState();
        if(Array.isArray(st.selections?.audio)){ selected.clear(); st.selections!.audio!.forEach(u=> selected.add(u)); }
        if(st.filters?.audio){ if(typeof st.filters.audio.minDuration==='number') minDuration.value = st.filters.audio.minDuration; if(typeof st.filters.audio.minSize==='number') minSize.value = st.filters.audio.minSize; }
      } catch { /* noop */ }
      refreshAudioList();
      await updateRestrictedHint();
      if (restrictedHint.value) { return; }
      unsubscribeQueue = subscribe(tasks => { queueTasks.value = tasks; });

      // 监听标签页切换：自动重新检测受限状态并刷新
      const onTabActivated = async () => {
        await updateRestrictedHint();
        if (!restrictedHint.value) {
          error.value = null;
          await refreshAudioList();
        }
      };
      if (chrome?.tabs?.onActivated?.addListener) {
        chrome.tabs.onActivated.addListener(onTabActivated);
      }
      // 注册全局快捷键
      searchKit.register();
      // 加载设置（快捷键提示开关）
      try { const s = await loadSettings(); showShortcutHints.value = s.showShortcutHints; } catch { /* noop */ }
      // 监听录制状态（音频模式）
      if(chrome?.runtime?.onMessage?.addListener){
        const handler: Parameters<typeof chrome.runtime.onMessage.addListener>[0] = (message, sender) => {
          if(!message || !message.type) return;
          if(message.type === MessageType.VIDEO_RECORDING_STATUS && message.mode === 'audio') {
            if(message.status === 'started'){ 
              audioRecording.recording = true; 
              audioRecording.startedAt = message.startedAt || Date.now(); 
              audioRecording.fileName = undefined; 
              audioRecording.error = undefined; 
              lastAction.value = '音频录制中…'; 
            }
            else if(message.status === 'completed'){ 
              audioRecording.recording = false;
              audioRecording.fileName = message.fileName;
              lastAction.value = '音频录制完成，成果见下方「录制成果」列表';
              // 录制产物经后台落库后出现在下方「录制成果」列表（交接链路见 content-scripts/router.ts 与 background/captureRecording.ts）
            }
            else if(message.status === 'error'){ 
              audioRecording.recording = false; 
              audioRecording.error = message.error || '音频录制失败'; 
              error.value = audioRecording.error || '音频录制失败'; 
            }
            audioRecordingBusy.value = false;
          }
          // 增量资源更新（音频）
          if(message.type === MessageType.RESOURCE_UPDATE){
            try {
              const payload: any = (message as any).payload || {};
              // tab + frame 双守卫：payload 只带 frameId，tabId 取自 sender，
              // 否则后台标签页（同为顶层 frame 0）的增量会覆盖当前列表
              if(isResourceUpdateFromBoundSource(sender, payload, { tabId: boundTabId, frameId: boundFrameId }) && Array.isArray(payload.audio)){
                const diff = payload.diff?.audio;
                if (diff?.removed?.length) {
                  diff.removed.forEach((u: string) => {
                    const ex = items.value.find(i => i.url === u);
                    if (ex) { ephemeralRemovedAudio[u] = { ...ex }; }
                  });
                  markAudioRemoved(diff.removed);
                  window.setTimeout(() => { diff.removed.forEach((u: string) => { delete ephemeralRemovedAudio[u]; }); }, 900);
                }
                const incoming: AudioItemDTO[] = payload.audio;
                if (diff?.added?.length) {
                  const addedUrls = diff.added.map((a: AudioItemDTO) => a.url);
                  if (addedUrls.length) markAudioNew(addedUrls);
                } else {
                  const prev = new Set(items.value.map(i=> i.url));
                  const added = incoming.filter(a => !prev.has(a.url)).map(a => a.url);
                  if (added.length) markAudioNew(added);
                }
                items.value = withNetworkAudio(incoming);
                setCount('audio', items.value.length);
                lastAction.value = '自动增量更新';
              }
            } catch { /* noop */ }
          }
          if(message.type === MessageType.SETTINGS_UPDATE){
            try { const payload: any = (message as any).payload || {}; if(typeof payload.showShortcutHints === 'boolean') showShortcutHints.value = payload.showShortcutHints; } catch { /* noop */ }
          }
        };
        chrome.runtime.onMessage.addListener(handler);
        removeRuntimeListener = () => chrome.runtime.onMessage.removeListener(handler);
      }
    });

    onBeforeUnmount(()=>{ if(unsubscribeQueue){ unsubscribeQueue(); unsubscribeQueue=null; } });
    onBeforeUnmount(()=>{ if(removeRuntimeListener){ removeRuntimeListener(); removeRuntimeListener=null; } });
    onBeforeUnmount(()=>{ searchKit.unregister(); });

    function onFrameModeChange(){
      const v = frameModeValue.value;
      if(v==='auto'){ frameMode.value='auto'; }
      else if(v==='top'){ frameMode.value='top'; }
      else if(v.startsWith('f:')){ const id = Number(v.slice(2)); if(Number.isFinite(id)) { frameMode.value='frame'; } }
      refreshAudioList();
    }
    function parseSelectedFrameId(): number | null { const v = frameModeValue.value; if(v.startsWith('f:')){ const id = Number(v.slice(2)); return Number.isFinite(id)? id : null; } return null; }
    function formatFrameLabel(f: FrameInfo){
      const id = f.frameId; let host='';
      try{ if(f.url){ const u=new URL(f.url); host = u.hostname.replace(/^www\./,'') + (u.pathname && u.pathname!=='/' ? ' · ' + (u.pathname.length>20 ? (u.pathname.slice(0,20)+'…') : u.pathname) : ''); } }catch { /* noop */ }
      return host? `#${id} ${host}` : `#${id}`;
    }

    /**
     * 过滤 + 隐藏重复 + 排序的内部实现（纯派生，无副作用）。
     * 评审（UI 二批之一）问题 3/4：过滤条件走共享纯函数 matchesAudioFilter；
     * 隐藏重复复用 duplicateSet 判定结果，按「归一化URL|大小」分组每组保留第一条。
     * @param list 待过滤列表（含短暂保留的已移除项）
     */
    function applyFilterAndSort(list: AudioItemDTO[]): AudioItemDTO[] {
      const criteria = {
        minDuration: minDuration.value,
        minSize: minSize.value,
        downloadStatus: filterDownloadStatus.value,
        query: searchKit.searchQuery.value,
        expr: filterExpr.value
      };
      let filtered = list.filter(it => matchesAudioFilter(it, metaMap[it.url] || {}, criteria, isDownloaded));
      if (hideDuplicates.value) {
        filtered = hideRedundantDuplicates(filtered, i => i.url, dupGroupKey, duplicateSet.value);
      }
      if(!sortKey.value) return filtered;
      return filtered.slice().sort((a,b)=>{
        let va:any; let vb:any;
        const ma = metaMap[a.url]||{}; const mb = metaMap[b.url]||{};
        switch(sortKey.value){
          case 'duration': va=ma.duration||0; vb=mb.duration||0; break;
          case 'size': va=ma.contentLength||0; vb=mb.contentLength||0; break;
          case 'title': va=(a.title||''); vb=(b.title||''); break;
          case 'url': va=a.url; vb=b.url; break;
          default: va=''; vb='';
        }
        if(va==vb) return 0;
        return (va>vb?1:-1) * (sortDir.value==='asc'?1:-1);
      });
    }
    function toggleSort(key: string){
      if(sortKey.value!==key){ sortKey.value=key; sortDir.value='asc'; }
      else { sortDir.value = sortDir.value==='asc' ? 'desc' : 'asc'; }
    }
    function applyAudioFilter(){ scheduleSave(); }

    /** 「重置」入口：清空状态过滤与隐藏重复条件（minDuration/minSize 无 UI，保持默认） */
    function resetFilter() {
      filterDownloadStatus.value = 'all';
      hideDuplicates.value = false;
      filterExpr.value = '';
      scheduleSave();
      log.info('音频过滤条件已重置');
    }

    /**
     * 选中全部重复项（评审问题 3）：把过滤结果中命中 duplicateSet 的项加入勾选。
     * 判定完全复用 duplicateSet（URL+大小分组），不重算。
     */
    function selectDuplicates() {
      const keys = collectDuplicateKeys(displayAudioItems.value, i => i.url, duplicateSet.value);
      if (!keys.length) { toast.info('当前没有可选择的重复音频（元数据可能仍在补充）'); return; }
      keys.forEach(k => selected.add(k));
      scheduleSave();
      lastAction.value = `已选中 ${keys.length} 个重复项`;
      log.info(`选中重复项 ${keys.length} 个`);
    }

    /** 取消选中全部重复项（评审问题 3）：从勾选集合移除重复命中项，保留其余选择 */
    function deselectDuplicates() {
      const keys = collectDuplicateKeys(displayAudioItems.value, i => i.url, duplicateSet.value);
      keys.forEach(k => selected.delete(k));
      scheduleSave();
      lastAction.value = keys.length ? `已取消选中 ${keys.length} 个重复项` : '没有重复项处于选中状态';
      log.info(`取消选中重复项 ${keys.length} 个`);
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
        throw new Error('请先在可播放音频的标签页中打开侧边栏');
      }
      const hint = getRestrictedPageMessage(info?.url || info?.pendingUrl);
      if (hint) {
        restrictedHint.value = hint;
        throw new Error(hint);
      }
      restrictedHint.value = null;
      return tabId;
    }

    function focusAudioSearch(){ searchKit.focusSearch(); }
    function invertAudioSelection(){ const all = displayAudioItems.value.map(i=> i.url); const next = new Set<string>(); all.forEach(u=>{ if(!selected.has(u)) next.add(u); }); selected.clear(); next.forEach(u=> selected.add(u)); scheduleSave(); }
    function selectNewAudio(){ newAudioHighlight.forEach(u=> { if(typeof u === 'string') selected.add(u); }); scheduleSave(); }

    /**
     * 重复分组键（评审问题 3）：归一化 URL + contentLength。
     * 元数据未就绪时大小按 0 参与分组——与旧实现的分组键完全一致，保持判定语义不变。
     * @param item 音频条目
     */
    function dupGroupKey(item: AudioItemDTO): string | null {
      const len = metaMap[item.url]?.contentLength || 0;
      return `${normalizeForDup(item.url)}|${len}`;
    }

    // 重复集合：同一归一化URL + contentLength >0 且出现次数>1（共享纯函数 computeDuplicateSet）
    const duplicateSet = computed(() => computeDuplicateSet(items.value, i => i.url, dupGroupKey));

    function retryTask(id: string){ retryDownload(id); }
    function cancelTask(id: string){ cancelDownload(id); }

    async function toggleAudioRecording(){
      if(audioRecordingBusy.value) return;
      audioRecordingBusy.value = true; error.value=null; lastAction.value='';
      try {
        const tabId = await ensureActiveTab();
        // 确保视频特性已启用
        try { await sendMessageToTab<any>(tabId, { type: MessageType.ENABLE_FEATURES, payload: { video:true, playbackEvents:true } }); } catch { /* noop */ }
        
        if(audioRecording.recording){
          // 停止录制：使用保存的 frameId 和 index
          const targetFrameId = audioRecording.frameId;
          const targetIndex = audioRecording.videoIndex ?? 0;
          
          let stopped = false;
          try {
             const resp = await sendMessageToTab<any>(tabId, { type: MessageType.STOP_RECORD_VIDEO, index: targetIndex }, targetFrameId != null ? { frameId: targetFrameId } : undefined);
             if(resp?.success) stopped = true;
          } catch { /* noop */ }
          
          if(!stopped) {
             // 如果定向停止失败，尝试广播（作为后备）
             const ids = await getAllFrameIds(tabId);
             for(const fid of ids){
               try {
                 const resp = await sendMessageToTab<any>(tabId, { type: MessageType.STOP_RECORD_VIDEO, index: targetIndex }, { frameId: fid });
                 if(resp?.success) { stopped = true; break; }
               } catch { /* noop */ }
             }
          }
          
          if(!stopped) throw new Error('停止音频录制失败 (未找到录制实例)');
          // 停止后，监听器会收到 completed 消息
        } else {
          // 启动录制：寻找最佳视频源
          let targetFrameId: number | undefined = undefined;
          let targetIndex = 0;
          
          // 辅助函数：在指定帧查找播放中的视频
          const findVideoInFrame = async (fid?: number) => {
            try {
              const resp = await sendMessageToTab<any>(tabId, { type: MessageType.GET_VIDEO_LIST }, fid!=null ? { frameId: fid } : undefined);
              if(resp?.success && Array.isArray(resp.videos) && resp.videos.length > 0) {
                // 优先找正在播放的
                const playing = resp.videos.find((v:any) => v.paused === false);
                if(playing) return { found: true, index: playing.index, frameId: fid };
                // 其次找可见的
                const visible = resp.videos.find((v:any) => v.visible);
                if(visible) return { found: true, index: visible.index, frameId: fid };
                // 最后返回第一个
                return { found: true, index: resp.videos[0].index, frameId: fid };
              }
            } catch { /* noop */ }
            return null;
          };

          // 1. 如果用户选定了帧，只在该帧找
          if(frameMode.value === 'frame') {
            const fid = parseSelectedFrameId();
            if(fid != null) {
               const res = await findVideoInFrame(fid);
               if(res) { targetFrameId = res.frameId; targetIndex = res.index; }
            }
          } 
          // 2. 否则（自动或顶层），先找顶层
          if(targetFrameId === undefined) {
             const res = await findVideoInFrame(0);
             if(res) { targetFrameId = res.frameId; targetIndex = res.index; }
          }
          // 3. 如果顶层没找到，且是自动模式，遍历所有帧
          if(targetFrameId === undefined && frameMode.value !== 'top') {
             const ids = await getAllFrameIds(tabId);
             for(const fid of ids) {
               if(fid === 0) continue; // 已找过
               const res = await findVideoInFrame(fid);
               if(res) { targetFrameId = res.frameId; targetIndex = res.index; break; }
             }
          }

          if (targetFrameId === undefined) {
             throw new Error('未检测到可录制的视频源，无法提取音频');
          }

          const resp = await sendMessageToTab<any>(tabId, { type: MessageType.START_RECORD_VIDEO, index: targetIndex, mode:'audio' }, targetFrameId!=null ? { frameId: targetFrameId } : undefined);
          if(!resp?.success) throw new Error(resp?.error || '启动音频录制失败');
          
          // 保存录制上下文
          audioRecording.frameId = targetFrameId;
          audioRecording.videoIndex = targetIndex;
          // 立即置位，不只依赖 VIDEO_RECORDING_STATUS 广播：侧栏面板是懒挂载的，
          // 切换子 tab 会重挂载组件并漏掉 started 事件，按钮就会停在"提取"态，
          // 而内容脚本其实已在录制，再次点击只会被回"该索引已在录制中"。
          audioRecording.recording = true;
          audioRecording.startedAt = resp?.startedAt || Date.now();
          audioRecording.error = undefined;
          lastAction.value = '音频录制中…再次点击停止并保存';
        }
      } catch(e:any){ error.value = e?.message || '音频录制操作失败'; }
      // busy 只覆盖请求往返：此前仅靠广播复位，广播一旦漏收按钮就永久禁用
      finally { audioRecordingBusy.value = false; }
    }

    // 需要一个定时器来更新计时显示
    const now = ref(Date.now());
    let timer: number | null = null;
    onMounted(() => {
      timer = window.setInterval(() => { now.value = Date.now(); }, 1000);
    });
    onBeforeUnmount(() => { if(timer) clearInterval(timer); });
    
    // 计时显示（录制中每秒更新）
    const recordingTimerDisplay = computed(() => {
       if (!audioRecording.recording || !audioRecording.startedAt) return '';
       const seconds = Math.max(0, Math.floor((now.value - audioRecording.startedAt) / 1000));
       const m = Math.floor(seconds / 60);
       const s = seconds % 60;
       return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    });

    function getRowClass(item: AudioItemDTO) {
      return {
        'duplicate-row': duplicateSet.value.has(item.url),
        'row-new': newAudioHighlight.has(item.url),
        'row-removed': removedAudioHighlight.has(item.url)
      };
    }

    // ===== 收集篮 =====
    /** 批量加入收集篮（评审问题 5）：汇总新增与"已在篮中"数量，Toast 反馈 */
    async function addSelectedToBasket() {
      const picked = displayAudioItems.value
        .filter(a => selected.has(a.url))
        .map(a => ({ kind: 'audio' as const, url: a.url, title: a.title || undefined }));
      const valid = picked.filter(i => i.url);
      const n = await addToBasket(valid);
      const skipped = valid.length - n;
      if (n > 0) toast.success(skipped > 0 ? `已加入收集篮 ${n} 项，${skipped} 项已在篮中` : `已加入收集篮 ${n} 项`);
      else toast.info('选中项均已在收集篮中');
      log.info(`加入收集篮：新增 ${n} 项，跳过 ${skipped} 项`);
    }

    // ===== 清单导出 =====
    function exportJson() {
      exportRowsAsJSON(displayAudioItems.value.map(a => ({ title: a.title || '', url: a.url })), '音频清单');
    }
    function exportCsv() {
      exportRowsAsCSV(displayAudioItems.value, [
        { label: '标题', value: a => a.title || '' },
        { label: '地址', value: a => a.url }
      ], '音频清单');
    }

    return {
      // UI 三批（组6）：PANEL_TITLES 放入 setup 返回值，供模板绑定 :title="PANEL_TITLES.audio"
      PANEL_TITLES,
      // 评审（UI 二批之一）：模板"已识别 N 条"展示原始扫描数（此前误暴露过滤结果），
      // 过滤/隐藏重复后的条数由 displayAudioItems 单独展示
      items,
      displayAudioItems,
      pagedAudioItems,
      page,
      totalPages,
      PAGE_SIZE,
      hideDuplicates,
      expandedUrl,
      toggleExpandUrl,
      selectDuplicates,
      deselectDuplicates,
      resetFilter,
      exportJson,
      exportCsv,
      newAudioHighlight,
      removedAudioHighlight,
      loading,
      error,
      lastAction,
      selectedCount,
      selected,
      hasSelection,
      allSelected,
      bulkDownloading,
      downloadingUrls,
      refreshAudioList,
      handleSelectAll,
      handleRowSelect,
      copyLink,
      downloadSingle,
      downloadSelected,
      // 收口轮 lint 修复：模板"加入收集篮"按钮绑定了本组件函数，但 render 上下文漏暴露
      // addSelectedToBasket（原为隐性运行时错误：按钮点击无效果），补入
      addSelectedToBasket,
      extractHost,
      metaMap,
      formatDuration,
      formatSize,
      duplicateSet,
      minDuration,
      minSize,
      filterExpr,
      filterExprError,
      formatOf,
      sortKey,
      sortDir,
      toggleSort,
      applyAudioFilter,
      frameMode,
      frames,
      frameModeValue,
      onFrameModeChange,
      formatFrameLabel
      ,ensureBusy
      ,ensureConnectAndRefresh
      ,queueTasks
      ,retryTask
      ,cancelTask
      ,restrictedHint
      ,audioRecording
      ,audioRecordingBusy
      ,toggleAudioRecording
      ,audioSearchQuery: searchKit.searchQuery
      ,audioSearchInputEl: searchKit.searchInputRef
      ,shortcutHint
      ,focusAudioSearch
      ,invertAudioSelection
      ,selectNewAudio
      ,showShortcutHints
      ,getRowClass
      ,isDownloaded
      ,filterDownloadStatus
      ,recordingTimerDisplay
    };
  }
});

function toFriendlyError(err: unknown) {
  if (isReceivingEndMissingError(err)) {
    return '无法连接当前页面，请确认已在受支持的网站中打开侧边栏，并允许扩展运行内容脚本。';
  }
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  return '无法获取音频列表';
}

function normalizeForDup(url: string): string {
  try {
    const u = new URL(url, 'https://placeholder.local');
    ['utm_source','utm_medium','utm_campaign','utm_id','utm_term','utm_content','timestamp','t','_t'].forEach(p=>u.searchParams.delete(p));
    return u.href;
  } catch { return url; }
}
</script>

<style scoped>
.toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
  flex-wrap: wrap;
  gap: 6px;
}

.toolbar__left, .toolbar__right {
  display: flex;
  gap: 6px;
  align-items: center;
  flex-wrap: wrap;
}

/* 过滤条（评审问题 3）：与图片面板同一布局与控件习惯（UI 三批组6 术语同步） */
.filter-bar {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 10px;
  flex-wrap: wrap;
}
.filter-bar label {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  color: var(--sp-color-muted);
}
.dup-toggle {
  cursor: pointer;
  user-select: none;
}
.dup-toggle input[type='checkbox'] {
  width: 13px;
  height: 13px;
  accent-color: var(--sp-color-primary);
  cursor: pointer;
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

.table-status {
  display: flex;
  align-items: center;
  gap: 8px;
  /* UI 三批（组2）：状态/计数属信息性文字，11px → 12px */
  font-size: 12px;
  color: var(--sp-color-muted);
  flex-wrap: wrap;
}

.status { font-size: 12px; color: var(--sp-color-muted); }
.status--error { color: var(--sp-color-danger); }

/* UI 三批（组1）：原 .restricted-banner/.banner-close/.banner-icon/.banner-hint 复制版样式
   已删除，横幅视觉唯一实现收敛在共享组件 RestrictedBanner 内部 */

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

.duplicate-row { background: rgba(245, 158, 11, 0.06); }
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

/* UI 三批（组1）：原 .dup-badge 复制版徽标样式已删除，「重复」徽标收敛到共享组件 BaseTag（warning 语义），
   原图像无边框/音频有边框的分叉就此消除 */

.title {
  font-size: 12px;
  font-weight: 500;
  color: var(--sp-color-heading);
  word-break: break-all;
}

.subtitle {
  /* UI 三批（组2）：来源域名属元信息，11px → 12px */
  font-size: 12px;
  color: var(--sp-color-muted);
  margin-top: 1px;
}

/* 行内元数据行（评审问题 1）：来源/时长/大小/状态徽标内联，替代原 5 个独立列 */
.item-meta {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 2px;
  flex-wrap: wrap;
  /* UI 三批（组2）：时长/大小等元信息，11px → 12px */
  font-size: 12px;
  color: var(--sp-color-muted);
}

/* "⋯"展开的行详情：完整地址 + 复制（原"链接"常驻列折叠于此） */
.row-detail {
  margin-top: 6px;
  padding: 6px 8px;
  background: var(--sp-color-bg-subtle);
  border-radius: var(--sp-radius-sm);
  /* UI 三批（组2）：详情区（完整地址）属信息性文字，11px → 12px */
  font-size: 12px;
  display: flex;
  align-items: center;
  gap: 6px;
}
.detail-url {
  color: var(--sp-color-primary);
  word-break: break-all;
  min-width: 0;
  flex: 1;
}

/* UI 三批（组1/组2）：原 .chip/.chip--success/.chip--ghost 复制版徽标样式已删除，
   「已下载/未下载」状态徽标唯一实现收敛在共享组件 BaseTag（size=sm，12px） */

.row-actions {
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
}

input[type='checkbox'] {
  width: 13px;
  height: 13px;
  accent-color: var(--sp-color-primary);
}

.recording-control {
  display: flex;
  align-items: center;
  gap: 6px;
}

.recording-timer {
  font-family: var(--sp-font-mono, monospace);
  font-size: 12px;
  color: var(--sp-color-danger);
  font-weight: 700;
  letter-spacing: 0.05em;
  /* UI 三批（组3）：原 blink 1s 硬切闪烁（50% 处 opacity 突变）对注视录制计时的用户
     视觉刺激过强，改为 1.6s ease-in-out 平滑渐隐渐显，保留「录制进行中」的动感提示 */
  animation: rec-timer-fade 1.6s ease-in-out infinite;
}

.sp-select {
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
}

/* UI 三批（组3）：录制计时平滑渐变关键帧（替代原 blink 硬切闪烁）：
   0%/100% 全亮、50% 降至 0.55，配合 ease-in-out 无突兀跳变 */
@keyframes rec-timer-fade {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.55; }
}
</style>
