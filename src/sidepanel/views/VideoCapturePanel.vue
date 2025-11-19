<template>
  <BaseCard title="视频采集" subtitle="扫描页面中的视频资源，执行控制与录制" padded>
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
        <span v-if="error" class="status status--error">{{ error }}</span>
        <span v-else-if="loading" class="status">扫描中…</span>
        <span v-else-if="lastAction" class="status">{{ lastAction }}</span>
      </div>
    </div>

    <div class="restricted-banner" v-if="restrictedHint">
      {{ restrictedHint }}
    </div>

    <!-- 全局批量控制工具栏 -->
    <div class="global-video-bar" v-if="videoCount > 0">
      <div class="global-video-bar__left">
        <BaseButton size="sm" variant="ghost" :disabled="loading" @click="playAll" :loading="globalBusy.playAll">播放全部</BaseButton>
        <BaseButton size="sm" variant="ghost" :disabled="loading" @click="pauseAll" :loading="globalBusy.pauseAll">暂停全部</BaseButton>
        <BaseButton size="sm" variant="ghost" :disabled="loading" @click="toggleAll" :loading="globalBusy.toggleAll">切换全部</BaseButton>
        <BaseButton size="sm" variant="ghost" :disabled="loading || anyRecording" @click="startRecordAll" :loading="globalBusy.recordAllStart">批量录制</BaseButton>
        <BaseButton size="sm" variant="danger" :disabled="!anyRecording" @click="stopRecordAll" :loading="globalBusy.recordAllStop">停止全部录制</BaseButton>
      </div>
      <div class="global-video-bar__right">
        <span class="global-summary">{{ playbackSummary }}</span>
      </div>
    </div>

    <!-- 下载队列展示 -->
    <div class="download-queue" v-if="queueTasks.length">
      <div class="download-queue__header">下载队列 ({{ queueTasks.length }})</div>
      <ul class="download-queue__list">
        <li v-for="t in queueTasks" :key="t.id" class="dq-item" :class="'dq-'+t.status">
          <span class="dq-name" :title="t.fileName || t.url">{{ (t.fileName || t.url).slice(0,48) }}<span v-if="(t.fileName||t.url).length>48">…</span></span>
          <span class="dq-status">{{ renderTaskStatus(t) }}</span>
          <span class="dq-progress" v-if="t.status==='running'">
            <span class="bar"><span class="bar__inner" :style="{ width: ((t.progress||0)*100)+'%' }"></span></span>
          </span>
          <span v-if="t.status==='error'" class="dq-error" :title="renderErrorHint(t)">{{ mapErrorCode(t.errorCode) }}</span>
          <span v-if="canOfferFallback(t)" class="dq-fallback">
            <BaseButton size="sm" variant="ghost" @click="fallbackRecord(t)">录制回退</BaseButton>
          </span>
          <div class="dq-actions">
            <BaseButton size="sm" variant="ghost" v-if="t.status==='error' || t.status==='canceled'" @click="retryTask(t.id)">重试</BaseButton>
            <BaseButton size="sm" variant="ghost" v-if="t.status==='pending' || t.status==='running'" @click="cancelTask(t.id)">取消</BaseButton>
          </div>
        </li>
      </ul>
    </div>

    <BaseTable :dense="true">
      <template #toolbar>
        <div class="table-status">
          <span>提示：操作按钮直接向当前标签页的内容脚本发送指令，请先确保标签页含有可播放的视频。</span>
        </div>
      </template>
      <thead>
        <tr>
          <th class="checkbox-col">
            <input
              type="checkbox"
              class="table-checkbox"
              :checked="allSelected"
              :indeterminate="indeterminateSelected"
              @change="handleSelectAllChange"
              :disabled="loading || videos.length === 0"
            />
          </th>
          <th style="width: 40px;">#</th>
          <th>视频</th>
          <th style="width: 140px;">规格</th>
          <th style="width: 180px;">状态</th>
          <th style="width: 340px;">操作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-if="!loading && videos.length === 0">
          <td colspan="6" class="empty-row">尚未识别到可控视频，请在含视频的页面中点击“重新扫描”。</td>
        </tr>
        <tr v-for="video in videos" :key="video.index" :class="{ 'row-new': newVideoHighlight.has(video.index) }">
          <td class="checkbox-cell">
            <input
              type="checkbox"
              class="table-checkbox"
              :checked="isRowSelected(video.index)"
              :disabled="loading"
              @change="handleRowSelectChange(video.index, $event)"
            />
          </td>
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
            <div class="row-actions">
              <BaseButton
                size="sm"
                variant="secondary"
                :disabled="loading"
                :loading="isActionBusy(video.index, 'play')"
                @click="controlVideo(video.index, 'play')"
              >播放</BaseButton>
              <BaseButton
                size="sm"
                variant="ghost"
                :disabled="loading"
                :loading="isActionBusy(video.index, 'pause')"
                @click="controlVideo(video.index, 'pause')"
              >暂停</BaseButton>
              <BaseButton
                size="sm"
                variant="ghost"
                :disabled="loading"
                :loading="isActionBusy(video.index, 'toggle')"
                @click="controlVideo(video.index, 'toggle')"
              >切换</BaseButton>
              <BaseButton
                size="sm"
                :variant="recordingStates[video.index]?.recording ? 'danger' : 'secondary'"
                :disabled="loading"
                :loading="isActionBusy(video.index, recordingStates[video.index]?.recording ? 'record-stop' : 'record-start')"
                @click="toggleRecording(video.index)"
              >{{ recordingStates[video.index]?.recording ? '停止录制' : '开始录制' }}</BaseButton>
              <BaseButton
                size="sm"
                variant="ghost"
                :loading="isActionBusy(video.index, 'download')"
                @click="downloadOriginal(video.index)"
              >直链下载</BaseButton>
            </div>
            <div v-if="downloadErrors[video.index]" class="download-error" :title="downloadErrors[video.index]">下载失败</div>
          </td>
        </tr>
      </tbody>
    </BaseTable>
  </BaseCard>
</template>

<script lang="ts">
import { computed, defineComponent, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { fetchVideoSources, pickBestCandidate, triggerDirectVideoDownload } from '../services/videoSources';
import { BaseButton, BaseCard, BaseTable } from '../components/base';
import { useResourceCounts } from '../composables/useResourceCounts';
import {
  MessageType,
  type VideoControlAction,
  type VideoItemDTO,
  type VideoListResponse,
  type VideoRecordingStatusMessage,
  type VideoPlaybackStatusMessage
} from '@/messaging';
import { subscribe, retryDownload, cancelDownload, type DownloadTask } from '../services/downloadQueue';
import { loadState, saveState } from '../services/persist';
import { getActiveTabInfo, sendMessageToTab, isReceivingEndMissingError, ensureContentConnected, getAllFramesInfo, type FrameInfo } from '../utils/chromeMessaging';
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
  components: { BaseButton, BaseCard, BaseTable },
  setup() {
    const { setCount } = useResourceCounts();
    const videos = ref<VideoItemDTO[]>([]);
    const newVideoHighlight = reactive(new Set<number>()); // 新增高亮集合
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
    const sortKey = ref<string>(''); // width|height|duration|sources
    const sortDir = ref<'asc'|'desc'>('asc');
    const clock = ref(Date.now());
    let timer: number | null = null;
    let removeRuntimeListener: (() => void) | null = null;

    const videoCount = computed(() => videos.value.length);
    const allSelected = computed(() => videoCount.value > 0 && videos.value.every(v => selectedIndexes.has(resolveIndex(v.index))));
    const indeterminateSelected = computed(() => selectedIndexes.size > 0 && !allSelected.value);
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
          if (Array.isArray(payload.videos)) {
            const prevIds = new Set(videos.value.map(v=> v.index));
            const incoming: VideoItemDTO[] = payload.videos;
            const filteredSorted = applyVideoFilterAndSort(incoming);
            filteredSorted.forEach(v=> { if(!prevIds.has(v.index)) { newVideoHighlight.add(v.index); window.setTimeout(()=> newVideoHighlight.delete(v.index), 2500); } });
            videos.value = filteredSorted;
            setCount('video', videos.value.length);
            lastAction.value = '自动增量更新';
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
      // 恢复帧间隔
      try {
        const st = await loadState();
        if (st.filters?.video) {
          if (typeof st.filters.video.minWidth === 'number') minVideoWidth.value = st.filters.video.minWidth;
          if (typeof st.filters.video.minHeight === 'number') minVideoHeight.value = st.filters.video.minHeight;
          if (typeof st.filters.video.minDuration === 'number') minVideoDuration.value = st.filters.video.minDuration;
        }
      } catch {}
      void updateRestrictedHint();
      // 开启视频相关功能：播放事件与 SPA 监听
      try {
        const info = await getActiveTabInfo();
        const tabId = info?.id;
        if (tabId) { void sendMessageToTab<any>(tabId, { type: MessageType.ENABLE_FEATURES, payload: { video: true, playbackEvents: true, spaWatchers: true } }, {}); }
      } catch {}
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
      removeRuntimeListener = ((orig)=>{
        return () => { orig && orig(); unsubscribeQueue(); };
      })(removeRuntimeListener);
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
      try { if(f.url){ const u = new URL(f.url); host = u.hostname.replace(/^www\./,'') + (u.pathname && u.pathname!=="/" ? ' · '+ (u.pathname.length>20 ? (u.pathname.slice(0,20)+'…') : u.pathname) : ''); } } catch {}
      return host ? `#${id} ${host}` : `#${id}`;
    }
    function renderTaskStatus(t: DownloadTask){
      switch(t.status){
        case 'pending': return t.retries && t.retries>0 ? `排队(重试${t.retries})` : '排队';
        case 'running': {
          const pct = typeof t.progress === 'number' ? Math.round(t.progress*100) : undefined;
          const base = pct!=null ? `下载中 ${pct}%` : '下载中';
          return t.retries && t.retries>0 ? `${base}·重试${t.retries}` : base;
        }
        case 'completed': return '完成';
        case 'error': return '失败';
        case 'canceled': return '已取消';
        default: return t.status;
      }
    }
    function retryTask(id: string){ retryDownload(id); }
    function cancelTask(id: string){ cancelDownload(id); }

    function canOfferFallback(t: DownloadTask){
      if (t.status !== 'error') return false;
      if (t.kind !== 'video') return false;
      return t.errorCode === 'DRM' || t.errorCode === 'CORS' || t.errorCode === 'PERMISSION';
    }
    async function fallbackRecord(t: DownloadTask){
      const vid = videos.value.find(v => v.src === t.url || (v.directSources||[]).some(s=> s.url === t.url));
      const idx = vid ? vid.index : videos.value[0]?.index;
      if (idx == null) { lastAction.value = '未找到匹配视频用于录制'; return; }
      try { await startRecording(idx); lastAction.value = '已触发录制回退'; }
      catch { lastAction.value = '录制回退失败'; }
    }

    function mapErrorCode(code?: string){
      switch(code){
        case 'DRM': return 'DRM受限';
        case 'CORS': return '跨域';
        case 'PERMISSION': return '权限';
        case 'NO_RESOURCE': return '缺失';
        case 'NETWORK': return '网络';
        case 'INTERRUPTED': return '中断';
        case 'UNKNOWN': return '未知';
        default: return '错误';
      }
    }
    function renderErrorHint(t: DownloadTask){
      if (!t.errorCode) return t.error || '未知错误';
      const base = mapErrorCode(t.errorCode);
      const tail = t.error ? `: ${t.error}` : '';
      switch(t.errorCode){
        case 'DRM': return base + ' — 视频资源受 DRM 保护，可尝试录制方式'+tail;
        case 'CORS': return base + ' — 跨域限制，需同源获取或使用录制'+tail;
        case 'PERMISSION': return base + ' — 权限/403，可能需要登录或授权'+tail;
        case 'NO_RESOURCE': return base + ' — 资源不存在或失效'+tail;
        case 'NETWORK': return base + ' — 网络失败，可重试'+tail;
        case 'INTERRUPTED': return base + ' — 下载被中断，可重试'+tail;
        default: return base + tail;
      }
    }

    function toggleSelectAll(checked: boolean){
      selectedIndexes.clear();
      if(checked){ videos.value.forEach(v => selectedIndexes.add(resolveIndex(v.index))); }
    }
    function handleSelectAllChange(event: Event){
      const target = event.target as HTMLInputElement | null;
      if(!target) return;
      toggleSelectAll(target.checked);
    }
    function isRowSelected(rawIndex?: number){
      return selectedIndexes.has(resolveIndex(rawIndex));
    }
    function handleRowSelectChange(rawIndex: number | undefined, event: Event){
      const target = event.target as HTMLInputElement | null;
      if(!target) return;
      const idx = resolveIndex(rawIndex);
      if(target.checked){ selectedIndexes.add(idx); }
      else { selectedIndexes.delete(idx); }
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
    });
    async function refreshVideoList() {
      loading.value = true;
      error.value = null;
      lastAction.value = '';
      try {
        const tabId = await ensureActiveTab();
        // 刷新帧列表（用于下拉）
        try { frames.value = await getAllFramesInfo(tabId); } catch {}
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
                } catch {}
              }
            } catch {}
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
        // 自动修复：若是接收端缺失，尝试注入后重试一次
        try {
          if (isReceivingEndMissingError(err)) {
            const tabId = await ensureActiveTab();
            const res = await ensureContentConnected(tabId);
            if (res.ok) {
              // 再次尝试
              const tabId2 = tabId;
              try { frames.value = await getAllFramesInfo(tabId2); } catch {}
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
                      } catch {}
                    }
                  } catch {}
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
        } catch {}
        // 最终失败
        videos.value = [];
        setCount('video', 0);
        error.value = toFriendlyVideoError(err);
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
        try { frames.value = await getAllFramesInfo(tabId); } catch {}
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

    async function downloadOriginal(index: number) {
      const resolvedIndex = resolveIndex(index);
      const key = actionKey(resolvedIndex, 'download');
      setBusy(key, true);
      downloadErrors[resolvedIndex] = '';
      try {
        const { sources, meta } = await fetchVideoSources(resolvedIndex, currentFrameId.value ?? undefined);
        if(!sources.length) throw new Error('无直链');
        const candidate = pickBestCandidate(sources);
        if(!candidate) throw new Error('无有效直链');
        const res = await triggerDirectVideoDownload(resolvedIndex, candidate, meta||{});
        if(!res.success) throw new Error(res.error||'下载失败');
        lastAction.value = '已触发视频下载';
      } catch(e:any){
        downloadErrors[resolvedIndex] = e?.message || String(e);
        error.value = '直链下载失败';
      } finally { setBusy(key,false); }
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
        case 'toggle':
          return '已切换播放状态';
        default:
          return '已执行操作';
      }
    }

    function applyVideoFilterAndSort(list: VideoItemDTO[]): VideoItemDTO[] {
      const filtered = list.filter(v => {
        if(minVideoWidth.value && (!v.width || v.width < minVideoWidth.value)) return false;
        if(minVideoHeight.value && (!v.height || v.height < minVideoHeight.value)) return false;
        if(minVideoDuration.value && (!v.duration || v.duration < minVideoDuration.value)) return false;
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
      const flagMap: Record<VideoControlAction,string> = { play:'playAll', pause:'pauseAll', toggle:'toggleAll' } as any;
      const flag = flagMap[action];
      if(flag) globalBusy[flag] = true;
      try {
        for(const v of videos.value){ await controlVideo(v.index, action); }
        lastAction.value = `批量${action}`;
      } finally { if(flag) globalBusy[flag] = false; }
    }
    function playAll(){ batchControl('play'); }
    function pauseAll(){ batchControl('pause'); }
    function toggleAll(){ batchControl('toggle'); }
    async function startRecordAll(){ globalBusy.recordAllStart = true; try { for(const v of videos.value){ if(!recordingStates[v.index]?.recording) await startRecording(v.index); } lastAction.value='批量启动录制'; } finally { globalBusy.recordAllStart=false; } }
    async function stopRecordAll(){ globalBusy.recordAllStop = true; try { for(const v of videos.value){ if(recordingStates[v.index]?.recording) await stopRecording(v.index); } lastAction.value='批量停止录制'; } finally { globalBusy.recordAllStop=false; } }

    return {
      videos,
      newVideoHighlight,
      videoCount,
      loading,
      error,
      lastAction,
      recordingStates,
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
      handleSelectAllChange,
      handleRowSelectChange,
      isRowSelected,
      toggleRecording,
      directSourceCount,
      recordingLabel,
      recordingElapsed,
      isActionBusy,
      downloadOriginal,
      downloadErrors,
      playbackSummary,
      playAll,
      pauseAll,
      toggleAll,
      startRecordAll,
      stopRecordAll,
      anyRecording,
      globalBusy
      ,queueTasks
      ,renderTaskStatus
      ,retryTask
      ,cancelTask
      ,minVideoWidth
      ,minVideoHeight
      ,minVideoDuration
      ,sortKey
      ,sortDir
      ,toggleSort
      ,applyVideoFilter
      ,ensureBusy
      ,ensureConnectAndRefresh
      ,frameMode
      ,frames
      ,frameModeValue
      ,onFrameModeChange
      ,formatFrameLabel
      ,adapterId
      ,restrictedHint
      ,mapErrorCode
      ,renderErrorHint
      ,canOfferFallback
      ,fallbackRecord
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
  margin-bottom: var(--sp-spacing-4);
  flex-wrap: wrap;
  gap: var(--sp-spacing-3);
}

.toolbar__left {
  display: flex;
  align-items: center;
  gap: var(--sp-spacing-3);
}

.toolbar__hint {
  font-size: 13px;
  color: var(--sp-color-muted);
}

.toolbar__right {
  display: flex;
  gap: var(--sp-spacing-3);
  align-items: center;
}

.status {
  color: var(--sp-color-muted);
  font-size: 13px;
}

.status--error {
  color: var(--sp-color-danger);
}

.global-video-bar { display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; margin-bottom: var(--sp-spacing-4); gap: var(--sp-spacing-3); }
.global-video-bar__left { display:flex; gap: var(--sp-spacing-2); flex-wrap:wrap; }
.global-video-bar__right { display:flex; align-items:center; }
.global-summary { font-size:12px; color: var(--sp-color-muted); }
.download-queue { border:1px solid var(--sp-color-border); border-radius:6px; padding:8px 10px; margin-bottom: var(--sp-spacing-4); background: var(--sp-color-bg-subtle); }
.download-queue__header { font-size:12px; font-weight:600; margin-bottom:6px; color: var(--sp-color-heading); }
.download-queue__list { list-style:none; margin:0; padding:0; display:flex; flex-direction:column; gap:4px; max-height:180px; overflow:auto; }
.dq-item { display:flex; align-items:center; gap:8px; font-size:12px; }
.dq-name { flex:1; word-break:break-all; }
.dq-status { width:52px; text-align:center; }
.dq-progress { flex:0 0 100px; }
.dq-error { color: var(--sp-color-danger); font-size:11px; }
.dq-actions { display:flex; gap:4px; }
.bar { position:relative; display:block; width:100%; height:6px; background:#ddd; border-radius:3px; overflow:hidden; }
.bar__inner { position:absolute; top:0; left:0; bottom:0; background: var(--sp-color-primary); width:0; transition: width .3s; }
.dq-running .dq-status { color: var(--sp-color-primary); }
.dq-completed .dq-status { color: var(--sp-color-success, #16a34a); }
.dq-error .dq-status { color: var(--sp-color-danger); }
.dq-canceled .dq-status { color: var(--sp-color-muted); }

.checkbox-col,
.checkbox-cell {
  width: 42px;
  text-align: center;
}

.checkbox-cell {
  padding: var(--sp-spacing-2);
}

.table-checkbox {
  width: 16px;
  height: 16px;
  cursor: pointer;
}

.table-status {
  color: var(--sp-color-muted);
  font-size: 13px;
}

.empty-row {
  text-align: center;
  color: var(--sp-color-muted);
  padding: var(--sp-spacing-4);
}
.row-new { animation: rowNewFade 2.4s ease-in forwards; }
@keyframes rowNewFade { 0% { background: rgba(79,156,255,0.55); } 60% { background: rgba(79,156,255,0.25); } 100% { background: transparent; } }

.video-meta__primary {
  font-weight: 600;
  color: var(--sp-color-heading);
  word-break: break-all;
}

.video-meta__secondary {
  display: flex;
  gap: var(--sp-spacing-2);
  flex-wrap: wrap;
  color: var(--sp-color-muted);
  font-size: 12px;
}

.row-actions {
  display: flex;
  gap: var(--sp-spacing-2);
  flex-wrap: wrap;
  margin-bottom: var(--sp-spacing-2);
}

.status-badges {
  display: flex;
  gap: var(--sp-spacing-2);
  align-items: center;
  flex-wrap: wrap;
}

.chip {
  display: inline-flex;
  align-items: center;
  padding: 4px 8px;
  border-radius: 999px;
  background: rgba(79, 156, 255, 0.15);
  color: var(--sp-color-primary);
  font-size: 12px;
}

.chip--danger {
  background: rgba(248, 113, 113, 0.15);
  color: var(--sp-color-danger);
}

.recording-hint {
  font-size: 12px;
  color: var(--sp-color-muted);
}

.restricted-banner {
  margin-bottom: var(--sp-spacing-4);
  padding: 10px 12px;
  border-radius: 6px;
  background: rgba(248, 186, 34, 0.15);
  color: #8a5300;
  font-size: 13px;
}

@media (max-width: 720px) {
  .toolbar {
    flex-direction: column;
    align-items: flex-start;
  }

  .row-actions {
    flex-direction: column;
    align-items: stretch;
  }
}
</style>
