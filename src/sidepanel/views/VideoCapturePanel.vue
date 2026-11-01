<template>
  <BaseCard title="视频采集" subtitle="扫描页面中的视频资源，执行控制与录制" :padded="true">
    <div class="toolbar">
      <div class="toolbar__left">
        <BaseButton size="sm" variant="secondary" :loading="loading" @click="refreshVideoList">
          重新扫描
        </BaseButton>
        <BaseButton size="sm" variant="ghost" :loading="ensureBusy" :disabled="loading" @click="ensureConnectAndRefresh">
          重试连接
        </BaseButton>
        <select class="frame-select" v-model="frameModeValue" @change="onFrameModeChange" :disabled="loading">
          <option value="auto">自动选择</option>
          <option value="top">顶层窗口</option>
          <option v-for="f in frames" :key="f.frameId" :value="'f:'+f.frameId">{{ formatFrameLabel(f) }}</option>
        </select>
        <span class="toolbar__hint">已识别 {{ videoCount }} 个视频</span>
        <span class="toolbar__hint" v-if="adapterId">适配器: {{ adapterId }}</span>
        <span class="toolbar__hint" v-if="frames && frames.length">帧: {{ frames.length }}</span>
      </div>
      <div class="toolbar__right">
        <span v-if="error && !restrictedHint" class="status status--error">{{ error }}</span>
        <span v-else-if="loading" class="status">扫描中…</span>
        <span v-else-if="lastAction" class="status">{{ lastAction }}</span>
      </div>
    </div>

    <div class="restricted-banner" v-if="restrictedHint">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="banner-icon"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
      <span class="banner-text">{{ restrictedHint }}<em class="banner-hint">请切换到普通网页后再试。</em></span>
      <button class="banner-close" @click="restrictedHint = null" title="关闭提示">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </div>

    <!-- 全局批量控制工具栏 -->
    <div class="global-video-bar" v-if="videoCount > 0">
      <div class="global-video-bar__left">
        <BaseButton size="sm" variant="secondary" :disabled="loading || !anyRecording" :loading="globalBusy.recordAllStop" @click="stopRecordAll">停止所有录制</BaseButton>
        <BaseButton size="sm" variant="secondary" :disabled="loading" :loading="globalBusy.recordAllStart" @click="startRecordAll">批量录制</BaseButton>
        <BaseButton size="sm" variant="secondary" :disabled="loading || !hasSelection" @click="downloadSelected">下载选中</BaseButton>
        <select class="frame-select" v-model="filterDownloadStatus" :disabled="loading">
          <option value="all">全部状态</option>
          <option value="new">未下载</option>
          <option value="downloaded">已下载</option>
        </select>
      </div>
      <div class="global-video-bar__right">
        <span class="global-summary">{{ playbackSummary }}</span>
        <BaseButton size="sm" variant="ghost" :loading="globalBusy.playAll || globalBusy.pauseAll" @click="togglePlayAll" :title="allPaused ? '全部播放' : '全部暂停'">
          {{ allPaused ? '▶' : '⏸' }}
        </BaseButton>
      </div>
    </div>

    <SelectionTable
      :items="displayVideos"
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
      <template #header>
        <th style="width: 40px;">#</th>
        <th>视频</th>
        <th style="width: 100px;">规格</th>
        <th style="width: 80px;">下载状态</th>
        <th style="width: 120px;">录制状态</th>
        <th style="width: 240px;">操作</th>
      </template>
      <template #empty>尚未识别到可控视频，请在含视频的页面中点击“重新扫描”。</template>
      <template #row="{ item: video }">
        <td>#{{ (video.index ?? 0) + 1 }}</td>
        <td>
          <div class="video-meta">
            <div class="video-meta__primary">{{ formatSource(video.src) }}</div>
            <div class="video-meta__secondary">
              <span>{{ renderVisibility(video) }}</span>
              <span v-if="video.muted">静音</span>
              <span v-if="directSourceCount(video) > 0">直链 {{ directSourceCount(video) }}</span>
            </div>
          </div>
        </td>
        <td>
          <div>{{ formatResolution(video) }}</div>
          <div class="video-meta__secondary">{{ formatDuration(video.duration) }}</div>
        </td>
        <td>
          <span v-if="isDownloaded(video.src)" class="chip chip--success">已下载</span>
          <span v-else class="chip chip--ghost">未下载</span>
        </td>
        <td>
          <div class="status-badges">
            <span class="chip" :class="{ 'chip--danger': recordingStates[video.index]?.lastError }">
              {{ recordingLabel(video.index) }}
            </span>
            <span v-if="recordingStates[video.index]?.recording" class="recording-hint">
              {{ recordingElapsed(video.index) }}
            </span>
          </div>
        </td>
        <td>
          <div class="row-actions" style="justify-content: flex-end;">
            <BaseButton
              size="sm"
              :variant="playbackStates[video.index] ? 'ghost' : 'secondary'"
              :disabled="loading"
              :loading="isActionBusy(video.index, playbackStates[video.index] ? 'pause' : 'play')"
              @click="controlVideo(video.index, playbackStates[video.index] ? 'pause' : 'play')"
            >{{ playbackStates[video.index] ? '暂停' : '播放' }}</BaseButton>
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
              :loading="isActionBusy(video.index, 'download')"
              @click="downloadSingle(video.index)"
            >下载</BaseButton>
          </div>
          <div v-if="downloadErrors[video.index]" class="download-error" :title="downloadErrors[video.index]">下载失败</div>
        </td>
      </template>
    </SelectionTable>
  </BaseCard>
</template>

<script lang="ts">
import { computed, defineComponent, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { fetchVideoSources, pickBestCandidate, triggerDirectVideoDownload } from '../services/videoSources';
import { useListSearch } from '../composables/useListSearch';
import { BaseButton, BaseCard, BaseTable, SelectionTable, ErrorBadge, BaseSearchBar } from '../components/base';
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
import { subscribe, retryDownload, cancelDownload, type DownloadTask } from '../services/downloadQueue';
import { loadHistory, isDownloaded, markDownloaded } from '../services/downloadHistory';
import { loadState, saveState } from '../services/persist';
import { loadSettings } from '../services/settings';
import { getActiveTabInfo, sendMessageToTab, sendRuntimeMessage, isReceivingEndMissingError, ensureContentConnected, getAllFramesInfo, type FrameInfo } from '../utils/chromeMessaging';
import { getRestrictedPageMessage } from '../utils/restrictedPages';

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

export default defineComponent({
  name: 'VideoCapturePanel',
  components: { BaseButton, BaseCard, SelectionTable, BaseSearchBar },
  setup() {
    const { setCount } = useResourceCounts();
    const videos = ref<VideoItemDTO[]>([]);
    const { newSet: newVideoHighlight, removedSet: removedVideoHighlight, markNew: markVideoNew, markRemoved: markVideoRemoved } = useRowHighlight({ ttlNew: 2500, ttlRemoved: 900 });
    const ephemeralRemovedVideos = reactive<Record<number, VideoItemDTO>>({});
    const displayVideos = computed(() => {
      const base = videos.value.slice();
      Object.keys(ephemeralRemovedVideos).forEach(k => {
        const id = Number(k);
        if (!base.find(v => v.index === id)) base.push(ephemeralRemovedVideos[id]);
      });
      return base;
    });
    const currentFrameId = ref<number|null>(null);
    const frameMode = ref<'auto'|'top'|'frame'>('auto');
    const frames = ref<FrameInfo[]>([]);
    const frameModeValue = ref<string>('auto');
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
    const sortKey = ref<string>(''); // width|height|duration|sources
    const sortDir = ref<'asc'|'desc'>('asc');
    const searchKit = useListSearch<number>({
      onRefresh: () => refreshVideoList(),
      selectAll: () => { toggleSelectAll(true); },
      clearSelection: () => { selectedIndexes.clear(); },
      invertSelection: () => {
        const all = videos.value.map(v => resolveIndex(v.index));
        const next = new Set<number>();
        for(const idx of all){ if(!selectedIndexes.has(idx)) next.add(idx); }
        selectedIndexes.clear();
        next.forEach(i => selectedIndexes.add(i));
      },
      selectNew: () => { newVideoHighlight.forEach(i => { if(typeof i === 'number') selectedIndexes.add(resolveIndex(i)); }); }
    });
    const showShortcutHints = ref(true);
    const shortcutHint = GLOBAL_SHORTCUT_HINT;
    const clock = ref(Date.now());
    let timer: number | null = null;
    let removeRuntimeListener: (() => void) | null = null;

    const videoCount = computed(() => videos.value.length);
    const allSelected = computed(() => videoCount.value > 0 && videos.value.every(v => selectedIndexes.has(resolveIndex(v.index))));
    const indeterminateSelected = computed(() => selectedIndexes.size > 0 && !allSelected.value);
    const hasSelection = computed(() => selectedIndexes.size > 0);
    // 帧捕获相关状态
    const downloadErrors = reactive<Record<number, string>>({});
    const ensureBusy = ref(false);

    const statusHandler: RuntimeMessageListener = (message) => {
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
          lastAction.value = '录制完成，已触发下载';
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
          // frameId 守卫：列表展示的是单一 frame 的扫描结果（currentFrameId 为 null 表示顶层），
          // 忽略来自其他 frame 的自动增量，防止跨 frame 列表互相覆盖（逐帧合并待后续版本）
          const updFrameId = typeof payload.frameId === 'number' ? payload.frameId : 0;
          if (updFrameId === (currentFrameId.value ?? 0) && Array.isArray(payload.videos)) {
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
            const filteredSorted = applyVideoFilterAndSort(incoming);
            if (diff?.added?.length) {
              markVideoNew(diff.added.map((v: VideoItemDTO) => v.index));
            } else {
              const prevIds = new Set(videos.value.map(v=> v.index));
              const added = filteredSorted.filter(v => !prevIds.has(v.index)).map(v => v.index);
              if (added.length) markVideoNew(added);
            }
            videos.value = filteredSorted;
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
      timer = window.setInterval(() => {
        clock.value = Date.now();
      }, 1000);
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
    function formatFrameLabel(f: FrameInfo){
      const id = f.frameId;
      let host = '';
      try { if(f.url){ const u = new URL(f.url); host = u.hostname.replace(/^www\./,'') + (u.pathname && u.pathname!=="/" ? ' · '+ (u.pathname.length>20 ? (u.pathname.slice(0,20)+'…') : u.pathname) : ''); } } catch { /* noop */ }
      return host ? `#${id} ${host}` : `#${id}`;
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

    function toggleSelectAll(checked: boolean){
      selectedIndexes.clear();
      if(checked){ videos.value.forEach(v => selectedIndexes.add(resolveIndex(v.index))); }
    }
    function handleRowSelect(index: number) {
      const idx = resolveIndex(index);
      if(selectedIndexes.has(idx)) selectedIndexes.delete(idx);
      else selectedIndexes.add(idx);
    }

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
      if (timer !== null) {
        clearInterval(timer);
      }
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
        videos.value = applyVideoFilterAndSort(list || []);
        setCount('video', videos.value.length);
        lastAction.value = videos.value.length ? `已更新 ${videos.value.length} 个视频` : '当前页面没有可控视频';
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
              videos.value = applyVideoFilterAndSort(list || []);
              setCount('video', videos.value.length);
              lastAction.value = videos.value.length ? `已更新 ${videos.value.length} 个视频` : '当前页面没有可控视频';
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

    async function ensureConnectAndRefresh(){
      ensureBusy.value = true; error.value=null; lastAction.value='';
      try{
        const tabId = await ensureActiveTab();
        const res = await ensureContentConnected(tabId);
        if(!res.ok){
          throw new Error(res.error || `连接失败（已检查 ${res.framesChecked} 帧）`);
        }
        lastAction.value = `连接成功（${res.framesConnected}/${res.framesChecked}）`;
        try { frames.value = await getAllFramesInfo(tabId); } catch { /* noop */ }
        await refreshVideoList();
      }catch(e:any){ error.value = e?.message || '重试连接失败'; }
      finally{ ensureBusy.value=false; }
    }

    async function controlVideo(index: number, action: VideoControlAction) {
      const resolvedIndex = resolveIndex(index);
      const key = actionKey(resolvedIndex, action);
      setBusy(key, true);
      try {
        const tabId = await ensureActiveTab();
        const response = await sendMessageToTab<{ success: boolean; error?: string }>(tabId, {
          type: MessageType.CONTROL_VIDEO,
          index: resolvedIndex,
          action
        }, { frameId: currentFrameId.value ?? undefined });
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
        }, { frameId: currentFrameId.value ?? undefined });
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
        }, { frameId: currentFrameId.value ?? undefined });
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

    function recordingElapsed(index?: number) {
      const state = recordingStates[resolveIndex(index)];
      if (!state?.recording || !state.startedAt) return '';
      const seconds = Math.max(0, Math.floor((clock.value - state.startedAt) / 1000));
      return formatReadableDuration(seconds);
    }

    function formatDuration(value?: number) {
      if (!value || Number.isNaN(value)) return '--';
      return formatReadableDuration(value);
    }

    function formatResolution(video?: VideoItemDTO) {
      const w = video?.width || 0;
      const h = video?.height || 0;
      if (!w || !h) return '未知分辨率';
      return `${w}×${h}`;
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

    function isActionBusy(index: number | undefined, action: string) {
      return busyKeys.has(actionKey(resolveIndex(index), action));
    }

    function setBusy(key: string, value: boolean) {
      if (value) busyKeys.add(key);
      else busyKeys.delete(key);
    }

    async function downloadSingle(index: number) {
      const resolvedIndex = resolveIndex(index);
      const key = actionKey(resolvedIndex, 'download');
      setBusy(key, true);
      downloadErrors[resolvedIndex] = '';
      try {
        const { sources, meta } = await fetchVideoSources(resolvedIndex, currentFrameId.value ?? undefined);
        if(!sources.length) throw new Error('无直链');
        const candidate = pickBestCandidate(sources);
        if(!candidate) throw new Error('无有效直链');

        // Check for blob URL
        if (candidate.url.startsWith('blob:')) {
           throw new Error('Blob 视频无法直接下载，请使用录制功能');
        }

        // 分段流提示：HLS/DASH 直链只是播放清单，直接下载无法得到完整视频
        if (candidate.kind === 'hls' || candidate.kind === 'dash') {
          if (candidate.kind === 'hls') {
            // HLS：走分片下载+合并链路（队列内展示进度）
            const resp: any = await sendRuntimeMessage({ type: MessageType.START_HLS_DOWNLOAD, payload: { url: candidate.url } });
            if (resp?.success) {
              lastAction.value = '已加入 HLS 下载队列（分片下载并自动合并）';
              return;
            }
            throw new Error(resp?.error || 'HLS 任务创建失败');
          }
          lastAction.value = '该视频为 DASH 分段流，暂不支持直链下载，建议使用录制';
          return;
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
      } catch(e:any){
        downloadErrors[resolvedIndex] = e?.message || String(e);
        error.value = e?.message || '直链下载失败';
      } finally { setBusy(key,false); }
    }

    async function downloadSelected() {
      if (!selectedIndexes.size) return;
      const indexes = Array.from(selectedIndexes);
      lastAction.value = `开始批量下载 ${indexes.length} 个视频`;
      
      for (const idx of indexes) {
        try {
          await downloadSingle(idx);
          // 简单的间隔防止请求过快
          await new Promise(r => setTimeout(r, 500));
        } catch (e) {
          console.error(`Failed to download video ${idx}`, e);
        }
      }
      lastAction.value = '批量下载完成';
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

    function applyVideoFilterAndSort(list: VideoItemDTO[]): VideoItemDTO[] {
      const filtered = list.filter(v => {
        if(minVideoWidth.value && (!v.width || v.width < minVideoWidth.value)) return false;
        if(minVideoHeight.value && (!v.height || v.height < minVideoHeight.value)) return false;
        if(minVideoDuration.value && (!v.duration || v.duration < minVideoDuration.value)) return false;
        
        // 下载状态过滤
        if (filterDownloadStatus.value !== 'all') {
          const downloaded = isDownloaded(v.src);
          if (filterDownloadStatus.value === 'downloaded' && !downloaded) return false;
          if (filterDownloadStatus.value === 'new' && downloaded) return false;
        }

        if(searchKit.searchQuery.value){
          const q = searchKit.searchQuery.value.trim().toLowerCase();
          if(q){
            let hit = false;
            if(v.src){
              try {
                const u = new URL(v.src, 'https://placeholder.local');
                const host = u.hostname.replace(/^www\./,'');
                const path = u.pathname;
                if(host.toLowerCase().includes(q) || path.toLowerCase().includes(q)) hit = true;
              } catch { if(v.src.toLowerCase().includes(q)) hit = true; }
            }
            if(!hit && Array.isArray(v.directSources)){
              for(const ds of v.directSources){ if(ds.url && ds.url.toLowerCase().includes(q)){ hit=true; break; } }
            }
            if(!hit) return false;
          }
        }
        return true;
      });
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
    function toggleSort(key: string){ if(sortKey.value!==key){ sortKey.value=key; sortDir.value='asc'; } else { sortDir.value = sortDir.value==='asc' ? 'desc' : 'asc'; } videos.value = applyVideoFilterAndSort(videos.value); scheduleSave(); }
    function applyVideoFilter(){ videos.value = applyVideoFilterAndSort(videos.value); scheduleSave(); }

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

    async function startRecordAll(){ globalBusy.recordAllStart = true; try { for(const v of videos.value){ if(!recordingStates[v.index]?.recording) await startRecording(v.index); } lastAction.value='批量启动录制'; } finally { globalBusy.recordAllStart=false; } }
    async function stopRecordAll(){ globalBusy.recordAllStop = true; try { for(const v of videos.value){ if(recordingStates[v.index]?.recording) await stopRecording(v.index); } lastAction.value='批量停止录制'; } finally { globalBusy.recordAllStop=false; } }

    function getRowClass(video: VideoItemDTO) {
      return {
        'row-new': newVideoHighlight.has(video.index),
        'row-removed': removedVideoHighlight.has(video.index)
      };
    }

    return {
      videos,
      displayVideos,
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
      recordingLabel,
      recordingElapsed,
      isActionBusy,
      downloadSingle,
      downloadSelected,
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
  font-size: 11px;
  color: var(--sp-color-muted);
}

.toolbar__right {
  display: flex;
  gap: 6px;
  align-items: center;
}

.status { color: var(--sp-color-muted); font-size: 11px; }
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
  font-size: 11px;
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
  font-size: 11px;
  color: var(--sp-color-muted);
}

.empty-row {
  text-align: center;
  color: var(--sp-color-muted);
  padding: 24px;
  font-size: 12px;
}

.row-new { animation: rowNewFade 2.4s ease-in forwards; }
.row-removed { animation: rowRemovedFade 0.9s ease-out forwards; }

@keyframes rowNewFade {
  0% { background: rgba(59, 138, 255, 0.3); }
  100% { background: transparent; }
}
@keyframes rowRemovedFade {
  0% { background: rgba(239, 68, 68, 0.3); }
  100% { background: transparent; opacity: 0; }
}

.video-meta__primary {
  font-size: 11px;
  font-weight: 500;
  color: var(--sp-color-heading);
  word-break: break-all;
}

.video-meta__secondary {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  color: var(--sp-color-muted);
  font-size: 11px;
  margin-top: 1px;
}

.row-actions {
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
}

.status-badges {
  display: flex;
  gap: 4px;
  align-items: center;
  flex-wrap: wrap;
}

.chip {
  display: inline-flex;
  align-items: center;
  padding: 2px 7px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 600;
  background: rgba(59, 138, 255, 0.10);
  color: var(--sp-color-primary);
}

.chip--success { background: var(--sp-color-success-light); color: var(--sp-color-success); }
.chip--ghost { background: var(--sp-color-bg-subtle); color: var(--sp-color-muted); }
.chip--danger { background: var(--sp-color-danger-light); color: var(--sp-color-danger); }

.recording-hint {
  font-size: 11px;
  color: var(--sp-color-muted);
  font-family: var(--sp-font-mono, monospace);
}

.restricted-banner {
  display: flex;
  align-items: flex-start;
  gap: 7px;
  margin-bottom: 10px;
  padding: 8px 10px;
  border-radius: var(--sp-radius-md);
  background: var(--sp-color-warning-light);
  border: 1px solid rgba(245, 158, 11, 0.25);
  color: var(--sp-color-warning);
  font-size: 11px;
  line-height: 1.4;
}

.restricted-banner span {
  flex: 1;
}

.banner-close {
  background: none;
  border: none;
  cursor: pointer;
  color: var(--sp-color-warning);
  opacity: 0.6;
  padding: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  margin-top: 1px;
  transition: opacity var(--sp-transition-fast);
}

.banner-close:hover {
  opacity: 1;
}

.download-error {
  font-size: 11px;
  color: var(--sp-color-danger);
  margin-top: 2px;
}

input[type='checkbox'] {
  width: 13px;
  height: 13px;
  accent-color: var(--sp-color-primary);
  cursor: pointer;
}
</style>
