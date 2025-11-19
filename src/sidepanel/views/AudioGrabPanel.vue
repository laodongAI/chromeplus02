<template>
  <BaseCard title="音频抓取" subtitle="识别音频资源并补充时长/大小元数据" padded>
    <div class="toolbar">
      <div class="toolbar__left">
        <BaseButton size="sm" variant="secondary" :loading="loading" @click="refreshAudioList">
          重新扫描
        </BaseButton>
        <BaseButton size="sm" variant="ghost" :loading="ensureBusy" :disabled="loading" @click="ensureConnectAndRefresh">
          重试连接
        </BaseButton>
        <BaseButton size="sm" variant="ghost" @click="toggleSelectAll" :disabled="items.length === 0">
          {{ allSelected ? '取消全选' : '全选' }}
        </BaseButton>
      </div>
      <div class="toolbar__right">
        <BaseButton size="sm" :disabled="!hasSelection || bulkDownloading" :loading="bulkDownloading" @click="downloadSelected">
          下载所选 ({{ selectedCount }})
        </BaseButton>
            <BaseButton size="sm"
              :variant="audioRecording.recording ? 'danger' : 'secondary'"
              :disabled="loading || audioRecordingBusy"
              :loading="audioRecordingBusy"
              @click="toggleAudioRecording">
              {{ audioRecording.recording ? '停止音频录制' : '提取当前播放视频音频' }}
            </BaseButton>
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
          <div class="dq-actions">
            <BaseButton size="sm" variant="ghost" v-if="t.status==='error' || t.status==='canceled'" @click="retryTask(t.id)">重试</BaseButton>
            <BaseButton size="sm" variant="ghost" v-if="t.status==='pending' || t.status==='running'" @click="cancelTask(t.id)">取消</BaseButton>
          </div>
        </li>
      </ul>
    </div>

    <div class="restricted-banner" v-if="restrictedHint">
      {{ restrictedHint }}
    </div>

    <BaseTable :dense="true">
      <template #toolbar>
        <div class="table-status">
          <span>已识别 {{ items.length }} 条音频</span>
          <span v-if="error" class="status status--error">{{ error }}</span>
          <span v-else-if="loading" class="status">扫描中…</span>
          <span v-else-if="lastAction" class="status">{{ lastAction }}</span>
        </div>
      </template>
      <thead>
        <tr>
          <th style="width: 40px;"></th>
          <th>标题</th>
          <th>链接</th>
          <th style="width: 90px;">时长</th>
          <th style="width: 110px;">大小</th>
          <th style="width: 70px;">重复</th>
          <th style="width: 160px;">操作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-if="!loading && items.length === 0">
          <td colspan="7" class="empty-row">未在当前页面检测到音频资源</td>
        </tr>
        <tr v-for="item in items" :key="item.url" :class="{ 'duplicate-row': duplicateSet.has(item.url), 'row-new': newAudioHighlight.has(item.url) }">
          <td>
            <input type="checkbox" :checked="isSelected(item.url)" @change="onSelectChange(item.url, $event)" />
          </td>
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
        </tr>
      </tbody>
    </BaseTable>
  </BaseCard>
</template>

<script lang="ts">
import { computed, defineComponent, onMounted, onBeforeUnmount, reactive, ref } from 'vue';
import { BaseButton, BaseCard, BaseTable } from '../components/base';
import { useResourceCounts } from '../composables/useResourceCounts';
import { MessageType, type AudioItemDTO } from '@/messaging';
import { addDownload, subscribe, retryDownload, cancelDownload, type DownloadTask } from '../services/downloadQueue';
import { loadState, saveState } from '../services/persist';
import { markProcessed, isProcessed, mediaKey } from '../composables/useMediaRegistry';
import {
  getActiveTabInfo,
  sendMessageToTab,
  sendRuntimeMessage,
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
  components: { BaseButton, BaseCard, BaseTable },
  setup() {
    const { setCount } = useResourceCounts();
    const items = ref<AudioItemDTO[]>([]);
    const newAudioHighlight = reactive(new Set<string>()); // 新增高亮集合
    const metaMap = reactive<Record<string, AudioMeta>>({});
    const loading = ref(false);
    const bulkDownloading = ref(false);
    const error = ref<string | null>(null);
    const lastAction = ref('');
    const selected = reactive<Set<string>>(new Set());
    const downloadingUrls = reactive<Set<string>>(new Set());
    const minDuration = ref<number>(0);
    const minSize = ref<number>(0);
    const sortKey = ref<string>(''); // duration|size|title|url
    const sortDir = ref<'asc'|'desc'>('asc');
    const frameMode = ref<'auto'|'top'|'frame'>('auto');
    const frames = ref<FrameInfo[]>([]);
    const frameModeValue = ref<string>('auto');
    const ensureBusy = ref(false);
    const restrictedHint = ref<string | null>(null);
    const queueTasks = ref<DownloadTask[]>([]);
    const audioRecording = reactive<{ recording: boolean; startedAt?: number; fileName?: string; error?: string }>({ recording: false });
    const audioRecordingBusy = ref(false);
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

    async function refreshAudioList() {
      loading.value = true;
      error.value = null;
      lastAction.value = '';
      try {
        const tabId = await ensureActiveTab();
        // 启用音频相关功能（轻量，无需等待）
        try { void sendMessageToTab<any>(tabId, { type: MessageType.ENABLE_FEATURES, payload: { audio: true, spaWatchers: true } }); } catch {}
        try { frames.value = await getAllFramesInfo(tabId); } catch {}
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
              }catch{}
            }
          }
        }
        if (!response?.success) throw new Error(response?.error || '扫描失败');
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
          } catch {}
        }
        error.value = toFriendlyError(err);
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

    function isSelected(url: string) { return selected.has(url); }

    function onSelectChange(url: string, event: Event) {
      const checked = (event.target as HTMLInputElement).checked;
      if (checked) selected.add(url); else selected.delete(url);
      scheduleSave();
    }

    function toggleSelectAll() {
      if (allSelected.value) { selected.clear(); }
      else { selected.clear(); items.value.forEach((item) => selected.add(item.url)); }
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
      const filename = buildFilename(item);
      addDownload(item.url, filename, 'audio', MessageType.START_DOWNLOAD);
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
      try {
        const st = await loadState();
        if(Array.isArray(st.selections?.audio)){ selected.clear(); st.selections!.audio!.forEach(u=> selected.add(u)); }
        if(st.filters?.audio){ if(typeof st.filters.audio.minDuration==='number') minDuration.value = st.filters.audio.minDuration; if(typeof st.filters.audio.minSize==='number') minSize.value = st.filters.audio.minSize; }
      } catch {}
      refreshAudioList();
      void updateRestrictedHint();
      unsubscribeQueue = subscribe(tasks => { queueTasks.value = tasks; });
      // 监听录制状态（音频模式）
      if(chrome?.runtime?.onMessage?.addListener){
        const handler: Parameters<typeof chrome.runtime.onMessage.addListener>[0] = (message) => {
          if(!message || !message.type) return;
          if(message.type === MessageType.VIDEO_RECORDING_STATUS && message.mode === 'audio') {
            if(message.status === 'started'){ audioRecording.recording = true; audioRecording.startedAt = message.startedAt || Date.now(); audioRecording.fileName = undefined; audioRecording.error = undefined; lastAction.value = '音频录制中…'; }
            else if(message.status === 'completed'){ audioRecording.recording = false; audioRecording.fileName = message.fileName; lastAction.value = '音频录制完成'; }
            else if(message.status === 'error'){ audioRecording.recording = false; audioRecording.error = message.error || '音频录制失败'; error.value = audioRecording.error || '音频录制失败'; }
            audioRecordingBusy.value = false;
          }
          // 增量资源更新（音频）
          if(message.type === MessageType.RESOURCE_UPDATE){
            try {
              const payload: any = (message as any).payload || {};
              if(Array.isArray(payload.audio)){
                const prev = new Set(items.value.map(i=> i.url));
                const incoming: AudioItemDTO[] = payload.audio;
                incoming.forEach(a=> { if(!prev.has(a.url)) { newAudioHighlight.add(a.url); window.setTimeout(()=> newAudioHighlight.delete(a.url), 2500); } });
                items.value = incoming;
                setCount('audio', items.value.length);
                lastAction.value = '自动增量更新';
              }
            } catch { /* noop */ }
          }
        };
        chrome.runtime.onMessage.addListener(handler);
        removeRuntimeListener = () => chrome.runtime.onMessage.removeListener(handler);
      }
    });

    onBeforeUnmount(()=>{ if(unsubscribeQueue){ unsubscribeQueue(); unsubscribeQueue=null; } });
    onBeforeUnmount(()=>{ if(removeRuntimeListener){ removeRuntimeListener(); removeRuntimeListener=null; } });

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
      try{ if(f.url){ const u=new URL(f.url); host = u.hostname.replace(/^www\./,'') + (u.pathname && u.pathname!=='/' ? ' · ' + (u.pathname.length>20 ? (u.pathname.slice(0,20)+'…') : u.pathname) : ''); } }catch{}
      return host? `#${id} ${host}` : `#${id}`;
    }

    function applyFilterAndSort(list: AudioItemDTO[]): AudioItemDTO[] {
      const filtered = list.filter(it => {
        const meta = metaMap[it.url] || {};
        if(minDuration.value && (!meta.duration || meta.duration < minDuration.value)) return false;
        if(minSize.value && (!meta.contentLength || meta.contentLength < minSize.value)) return false;
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

    function renderTaskStatus(t: DownloadTask){
      switch(t.status){
        case 'pending': return t.retries && t.retries>0 ? `排队(重试${t.retries})` : '排队';
        case 'running': { const pct = typeof t.progress === 'number' ? Math.round(t.progress*100) : undefined; const base = pct!=null ? `下载中 ${pct}%` : '下载中'; return t.retries && t.retries>0 ? `${base}·重试${t.retries}` : base; }
        case 'completed': return '完成';
        case 'error': return '失败';
        case 'canceled': return '已取消';
        default: return t.status;
      }
    }
    function retryTask(id: string){ retryDownload(id); }
    function cancelTask(id: string){ cancelDownload(id); }

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
        case 'DRM': return base + ' — 音频资源受 DRM 保护，可尝试录制方式'+tail;
        case 'CORS': return base + ' — 跨域限制，需同源获取或使用录制'+tail;
        case 'PERMISSION': return base + ' — 权限/403，可能需要登录或授权'+tail;
        case 'NO_RESOURCE': return base + ' — 资源不存在或失效'+tail;
        case 'NETWORK': return base + ' — 网络失败，可重试'+tail;
        case 'INTERRUPTED': return base + ' — 下载被中断，可重试'+tail;
        default: return base + tail;
      }
    }

    async function toggleAudioRecording(){
      if(audioRecordingBusy.value) return;
      audioRecordingBusy.value = true; error.value=null; lastAction.value='';
      try {
        const tabId = await ensureActiveTab();
        // 确保视频特性已启用
        try { await sendMessageToTab<any>(tabId, { type: MessageType.ENABLE_FEATURES, payload: { video:true, playbackEvents:true } }); } catch {}
        if(audioRecording.recording){
          const resp = await sendMessageToTab<any>(tabId, { type: MessageType.STOP_RECORD_VIDEO, index:0 });
          if(!resp?.success) throw new Error(resp?.error || '停止音频录制失败');
        } else {
          const resp = await sendMessageToTab<any>(tabId, { type: MessageType.START_RECORD_VIDEO, index:0, mode:'audio' });
          if(!resp?.success) throw new Error(resp?.error || '启动音频录制失败');
        }
      } catch(e:any){ error.value = e?.message || '音频录制操作失败'; audioRecordingBusy.value=false; }
    }

    return {
      items: filteredItems,
      newAudioHighlight,
      loading,
      error,
      lastAction,
      selectedCount,
      hasSelection,
      allSelected,
      bulkDownloading,
      downloadingUrls,
      refreshAudioList,
      toggleSelectAll,
      isSelected,
      onSelectChange,
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
      ,renderTaskStatus
      ,retryTask
      ,cancelTask
      ,restrictedHint
      ,audioRecording
      ,audioRecordingBusy
      ,toggleAudioRecording
      ,mapErrorCode
      ,renderErrorHint
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

function buildFilename(item: AudioItemDTO): string {
  const title = item.title?.replace(/[\\/:*?"<>|]/g, '_') || 'audio_capture';
  const ext = inferExtension(item.url);
  const stamp = new Date().toISOString().replace(/[:T]/g, '-').split('.')[0];
  return `${title}_${stamp}.${ext}`;
}

function inferExtension(url?: string): string {
  if (!url) return 'mp3';
  const match = url.match(/\.([a-z0-9]{2,4})(?:\?|$)/i);
  if (match) return match[1].toLowerCase();
  return 'mp3';
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
  margin-bottom: var(--sp-spacing-4);
  flex-wrap: wrap;
  gap: var(--sp-spacing-3);
}

.toolbar__left,
.toolbar__right {
  display: flex;
  gap: var(--sp-spacing-3);
  align-items: center;
}

.table-status {
  display: flex;
  justify-content: space-between;
  gap: var(--sp-spacing-3);
  color: var(--sp-color-muted);
}

/* 下载队列样式（简版） */
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
.restricted-banner { margin-bottom: var(--sp-spacing-4); padding:10px 12px; border-radius:6px; background: rgba(248,186,34,0.15); color:#8a5300; font-size:13px; }

.status {
  color: var(--sp-color-muted);
}

.status--error {
  color: var(--sp-color-danger);
}

.empty-row {
  text-align: center;
  color: var(--sp-color-muted);
  padding: var(--sp-spacing-4);
}
.duplicate-row { background: rgba(255,196,102,0.15); }
.row-new { animation: rowNewFade 2.4s ease-in forwards; }
@keyframes rowNewFade { 0% { background: rgba(79,156,255,0.55); } 60% { background: rgba(79,156,255,0.25); } 100% { background: transparent; } }
.dup-badge { display:inline-block; padding:2px 4px; background:#ffc465; color:#7a4b00; border-radius:4px; font-size:10px; line-height:1; }

.title {
  font-weight: 600;
  color: var(--sp-color-heading);
}

.subtitle {
  font-size: 12px;
  color: var(--sp-color-muted);
}

.url-cell a {
  color: var(--sp-color-primary);
  word-break: break-all;
}

.row-actions {
  display: flex;
  gap: var(--sp-spacing-2);
  flex-wrap: wrap;
}

input[type='checkbox'] {
  width: 16px;
  height: 16px;
}
</style>
