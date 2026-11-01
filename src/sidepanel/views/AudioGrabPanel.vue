<template>
  <BaseCard title="音频抓取" subtitle="识别音频资源并补充时长/大小元数据" :padded="true">
    <div class="toolbar">
      <div class="toolbar__left">
        <BaseButton size="sm" variant="secondary" :loading="loading" @click="refreshAudioList">
          重新扫描
        </BaseButton>
        <BaseButton size="sm" variant="ghost" :loading="ensureBusy" :disabled="loading" @click="ensureConnectAndRefresh">
          重试连接
        </BaseButton>
        <BaseButton size="sm" variant="ghost" @click="handleSelectAll(!allSelected)" :disabled="items.length === 0">
          {{ allSelected ? '取消全选' : '全选' }}
        </BaseButton>
        <select class="sp-select" v-model="filterDownloadStatus" @change="applyAudioFilter" :disabled="loading">
          <option value="all">全部状态</option>
          <option value="new">未下载</option>
          <option value="downloaded">已下载</option>
        </select>
      </div>
      <div class="toolbar__right">
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

    <!-- 下载队列展示 -->


    <div class="restricted-banner" v-if="restrictedHint">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="banner-icon"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
      <span class="banner-text">{{ restrictedHint }}<em class="banner-hint">请切换到普通网页后再试。</em></span>
      <button class="banner-close" @click="restrictedHint = null" title="关闭提示">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </div>

    <SelectionTable
      :items="displayAudioItems"
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
      <template #header>
        <th>标题</th>
        <th>链接</th>
        <th style="width: 90px;">时长</th>
        <th style="width: 110px;">大小</th>
        <th style="width: 80px;">状态</th>
        <th style="width: 70px;">重复</th>
        <th style="width: 160px;">操作</th>
      </template>
      <template #empty>未在当前页面检测到音频资源</template>
      <template #row="{ item }">
        <td>
          <div class="title">{{ item.title || '未命名音频' }}</div>
          <div class="subtitle">{{ extractHost(item.url) }}</div>
        </td>
        <td class="url-cell">
          <a :href="item.url" target="_blank" rel="noreferrer">{{ item.url }}</a>
        </td>
        <td>{{ formatDuration(metaMap[item.url]?.duration) }}</td>
        <td>{{ formatSize(metaMap[item.url]?.contentLength) }}</td>
        <td>
          <span v-if="isDownloaded(item.url)" class="chip chip--success">已下载</span>
          <span v-else class="chip chip--ghost">未下载</span>
        </td>
        <td>
          <span v-if="duplicateSet.has(item.url)" class="dup-badge" title="URL+大小重复">重复</span>
        </td>
        <td>
          <div class="row-actions">
            <BaseButton size="sm" variant="secondary" @click="copyLink(item.url)">
              复制链接
            </BaseButton>
            <BaseButton size="sm" :loading="downloadingUrls.has(item.url)" @click="downloadSingle(item)">
              下载
            </BaseButton>
          </div>
        </td>
      </template>
    </SelectionTable>
  </BaseCard>
</template>

<script lang="ts">
import { computed, defineComponent, onMounted, onBeforeUnmount, reactive, ref } from 'vue';
import { BaseButton, BaseCard, BaseTable, SelectionTable, ErrorBadge, BaseSearchBar } from '../components/base';
import { GLOBAL_SHORTCUT_HINT } from '../utils/shortcutHints';
import { useListSearch } from '../composables/useListSearch';
import { useRowHighlight } from '../composables/useRowHighlight';
import { useResourceCounts } from '../composables/useResourceCounts';
import { MessageType, type AudioItemDTO } from '@/messaging';
import { addDownload, subscribe, retryDownload, cancelDownload, type DownloadTask } from '../services/downloadQueue';
import { loadHistory, isDownloaded } from '../services/downloadHistory';
import { loadState, saveState } from '../services/persist';
import { loadSettings } from '../services/settings';
import { markProcessed, isProcessed, mediaKey } from '../composables/useMediaRegistry';
import {
  getActiveTabInfo,
  sendMessageToTab,
  isReceivingEndMissingError,
  ensureContentConnected,
  getAllFramesInfo,
  getAllFrameIds,
  type FrameInfo
} from '../utils/chromeMessaging';
import { getRestrictedPageMessage } from '../utils/restrictedPages';

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
  components: { BaseButton, BaseCard, SelectionTable, BaseSearchBar },
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
    const sortKey = ref<string>(''); // duration|size|title|url
    const sortDir = ref<'asc'|'desc'>('asc');
    const searchKit = useListSearch<string>({
      onRefresh: () => refreshAudioList(),
      selectAll: () => { selected.clear(); items.value.forEach(i=> selected.add(i.url)); scheduleSave(); },
      clearSelection: () => { selected.clear(); scheduleSave(); },
      invertSelection: () => { const all = items.value.map(i=> i.url); const next = new Set<string>(); all.forEach(u=>{ if(!selected.has(u)) next.add(u); }); selected.clear(); next.forEach(u=> selected.add(u)); scheduleSave(); },
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
    const allSelected = computed(() => items.value.length > 0 && selected.size === items.value.length);
    const filteredItems = computed(()=> applyFilterAndSort(items.value));

    let saveTimer: number | null = null;
    function scheduleSave(){
      if(saveTimer) clearTimeout(saveTimer);
      saveTimer = window.setTimeout(()=>{ saveState({ selections: { audio: Array.from(selected) } }); }, 500);
    }

    let boundFrameId: number | null = null; // 当前音频列表绑定的来源 frameId（增量更新按 frame 过滤）
    async function refreshAudioList() {
      loading.value = true;
      error.value = null;
      lastAction.value = '';
      try {
        const tabId = await ensureActiveTab();
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
        items.value = response.items || [];
        selected.clear();
        setCount('audio', items.value.length);
        // 异步补充元数据
        enrichAllMetadata(items.value).catch((e) => console.warn('[audio enrich] error', e));
      } catch (err: any) {
        // 自动修复：接收端缺失时尝试注入并重试一次
        if (isReceivingEndMissingError(err)) {
          try {
            const tabId = await ensureActiveTab();
            const res = await ensureContentConnected(tabId);
            if (res.ok) {
              const retry = await sendMessageToTab<AudioListResponse>(tabId, { type: MessageType.REQUEST_AUDIO_LIST });
              if (retry?.success && Array.isArray(retry.items)) {
                items.value = retry.items;
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

    async function ensureConnectAndRefresh(){
      ensureBusy.value = true; error.value=null; lastAction.value='';
      try{
        const tabId = await ensureActiveTab();
        const res = await ensureContentConnected(tabId);
        if(!res.ok){ throw new Error(res.error || `连接失败（已检查 ${res.framesChecked} 帧）`); }
        lastAction.value = `连接成功（${res.framesConnected}/${res.framesChecked}）`;
        await refreshAudioList();
      }catch(e:any){ error.value = e?.message || '重试连接失败'; }
      finally{ ensureBusy.value=false; }
    }

    function handleSelectAll(checked: boolean) {
      if (checked) { selected.clear(); items.value.forEach((item) => selected.add(item.url)); }
      else { selected.clear(); }
      scheduleSave();
    }

    function handleRowSelect(url: string) {
      if (selected.has(url)) selected.delete(url);
      else selected.add(url);
      scheduleSave();
    }

    async function copyLink(url: string) {
      try {
        await navigator.clipboard.writeText(url);
        lastAction.value = '已复制链接';
      } catch (err) {
        error.value = '复制失败，请手动选择文本';
        console.error(err);
      }
    }

    async function downloadSingle(item: AudioItemDTO) {
      try {
        const key = mediaKey({ url: item.url, kind: 'audio', width:0, height:0 });
        if(isProcessed(key)) { lastAction.value = '已处理'; return; }
        triggerDownload(item); // queue integration
        markProcessed(key);
        lastAction.value = '已加入队列'; scheduleSave();
      } catch (err: any) {
        error.value = err?.message || '下载失败';
      }
    }

    async function downloadSelected() {
      if (!hasSelection.value) return;
      error.value = null;
      let count = 0;
      try {
        for (const url of selected) {
          const item = items.value.find((it) => it.url === url);
          if (!item) continue;
          const key = mediaKey({ url: item.url, kind: 'audio', width:0, height:0 });
          if(isProcessed(key)) continue;
          triggerDownload(item);
          markProcessed(key);
          count++;
        }
        lastAction.value = `队列新增 ${count} 条`; scheduleSave();
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

    function triggerDownload(item: AudioItemDTO) {
      // 传 undefined 让后台命名模板处理
      addDownload(item.url, undefined, 'audio', MessageType.START_DOWNLOAD);
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
        const handler: Parameters<typeof chrome.runtime.onMessage.addListener>[0] = (message) => {
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
              lastAction.value = '音频录制完成';
              // 录制产物由内容脚本自行触发下载（见 content-scripts/router.ts recorder.onstop），此处无需重复处理
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
              // frameId 守卫：忽略来自其他 frame 的自动增量，防止跨 frame 列表互相覆盖
              const updFrameId = typeof payload.frameId === 'number' ? payload.frameId : 0;
              if(updFrameId === (boundFrameId ?? 0) && Array.isArray(payload.audio)){
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
                items.value = incoming;
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

    function applyFilterAndSort(list: AudioItemDTO[]): AudioItemDTO[] {
      const filtered = list.filter(it => {
        const meta = metaMap[it.url] || {};
        if(minDuration.value && (!meta.duration || meta.duration < minDuration.value)) return false;
        if(minSize.value && (!meta.contentLength || meta.contentLength < minSize.value)) return false;
        
        // 下载状态过滤
        if (filterDownloadStatus.value !== 'all') {
          const downloaded = isDownloaded(it.url);
          if (filterDownloadStatus.value === 'downloaded' && !downloaded) return false;
          if (filterDownloadStatus.value === 'new' && downloaded) return false;
        }

        const q = searchKit.searchQuery.value.trim().toLowerCase();
        if(q){
          const titleHit = (it.title||'').toLowerCase().includes(q);
          const urlHit = it.url.toLowerCase().includes(q);
            if(!titleHit && !urlHit) return false;
        }
        return true;
      });
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
    function invertAudioSelection(){ const all = items.value.map(i=> i.url); const next = new Set<string>(); all.forEach(u=>{ if(!selected.has(u)) next.add(u); }); selected.clear(); next.forEach(u=> selected.add(u)); scheduleSave(); }
    function selectNewAudio(){ newAudioHighlight.forEach(u=> { if(typeof u === 'string') selected.add(u); }); scheduleSave(); }

    // 重复集合：同一归一化URL + contentLength >0 且出现次数>1
    const duplicateSet = computed(() => {
      const groups: Record<string, number> = {};
      items.value.forEach(i => {
        const meta = metaMap[i.url];
        const len = meta?.contentLength || 0;
        const norm = normalizeForDup(i.url);
        const key = `${norm}|${len}`;
        groups[key] = (groups[key]||0)+1;
      });
      const dup = new Set<string>();
      items.value.forEach(i => {
        const meta = metaMap[i.url];
        const len = meta?.contentLength || 0;
        const norm = normalizeForDup(i.url);
        const key = `${norm}|${len}`;
        if(groups[key] > 1) dup.add(i.url);
      });
      return dup;
    });

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
        }
      } catch(e:any){ error.value = e?.message || '音频录制操作失败'; audioRecordingBusy.value=false; }
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

    return {
      items: filteredItems,
      displayAudioItems,
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
      extractHost,
      metaMap,
      formatDuration,
      formatSize,
      duplicateSet,
      minDuration,
      minSize,
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

.table-status {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 11px;
  color: var(--sp-color-muted);
}

.status { font-size: 11px; color: var(--sp-color-muted); }
.status--error { color: var(--sp-color-danger); }

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
.restricted-banner span { flex: 1; }
.banner-close {
  background: none;
  border: none;
  cursor: pointer;
  color: var(--sp-color-warning);
  opacity: 0.6;
  padding: 0;
  display: flex;
  align-items: center;
  flex-shrink: 0;
  margin-top: 1px;
  transition: opacity var(--sp-transition-fast);
}
.banner-close:hover { opacity: 1; }
.banner-icon { flex-shrink: 0; margin-top: 1px; }
.banner-hint {
  display: block;
  font-style: normal;
  font-size: 11px;
  opacity: 0.7;
  margin-top: 2px;
}

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
  0% { background: rgba(59, 138, 255, 0.3); }
  100% { background: transparent; }
}
@keyframes rowRemovedFade {
  0% { background: rgba(239, 68, 68, 0.3); }
  100% { background: transparent; opacity: 0; }
}

.dup-badge {
  display: inline-flex;
  align-items: center;
  margin-left: 4px;
  padding: 1px 5px;
  background: var(--sp-color-warning-light);
  color: var(--sp-color-warning);
  border-radius: 999px;
  font-size: 11px;
  font-weight: 600;
  border: 1px solid rgba(245, 158, 11, 0.25);
}

.title {
  font-size: 12px;
  font-weight: 500;
  color: var(--sp-color-heading);
}

.subtitle {
  font-size: 11px;
  color: var(--sp-color-muted);
  margin-top: 1px;
}

.url-cell a {
  color: var(--sp-color-primary);
  font-size: 11px;
  word-break: break-all;
}

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
  animation: blink 1s infinite;
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

@keyframes blink { 50% { opacity: 0.5; } }
</style>
