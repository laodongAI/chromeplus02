<template>
  <BaseCard title="图像抓取" subtitle="扫描页面图片/背景与视频帧" :padded="true">
    <div class="frame-capture-bar">
      <div class="frame-capture-group">
        <label class="interval-label">间隔(秒)</label>
        <input type="number" min="1" v-model.number="frameInterval" class="interval-input" />
        <BaseButton size="sm" variant="ghost" @click="toggleFrameCapture" :loading="frameToggleBusy">
          {{ frameCaptureActive ? '停止抓帧' : '开始抓帧' }}
        </BaseButton>
        <span v-if="frameCaptureActive" class="interval-hint">下次: {{ nextTickCountdown }}s</span>
      </div>
    </div>
    <div class="toolbar">
      <div class="toolbar__left">
        <BaseButton size="sm" variant="secondary" :loading="loading" @click="refreshImages">重新扫描</BaseButton>
        <BaseButton size="sm" variant="ghost" :loading="ensureBusy" :disabled="loading" @click="ensureConnectAndRefresh">重试连接</BaseButton>
        <select class="frame-select" v-model="frameModeValue" @change="onFrameModeChange" :disabled="loading">
          <option value="auto">自动选择</option>
          <option value="top">顶层窗口</option>
          <option v-for="f in frames" :key="f.frameId" :value="'f:'+f.frameId">{{ formatFrameLabel(f) }}</option>
        </select>
        <BaseButton size="sm" variant="ghost" @click="handleSelectAll(!allSelected)" :disabled="images.length===0">
          {{ allSelected ? '取消全选' : '全选' }}
        </BaseButton>
        <BaseButton size="sm" variant="ghost" @click="clearList" :disabled="images.length===0">清空</BaseButton>
      </div>
      <div class="toolbar__right">
        <BaseButton size="sm" variant="ghost" :disabled="!displayImages.length" @click="exportCsv">导出CSV</BaseButton>
        <BaseButton size="sm" variant="ghost" :disabled="!displayImages.length" @click="exportJson">导出JSON</BaseButton>
        <BaseButton size="sm" variant="ghost" :disabled="!hasSelection" @click="addSelectedToBasket">加入收集篮</BaseButton>
        <BaseButton size="sm" :disabled="!hasSelection" @click="downloadSelected">批量下载 ({{ selectedCount }})</BaseButton>
      </div>
    </div>

    <div class="filter-bar">
      <label>最小宽度 <input type="number" v-model.number="minWidth" min="0" /></label>
      <label>最小高度 <input type="number" v-model.number="minHeight" min="0" /></label>
      <select v-model="filterDownloadStatus" @change="applyFilter">
        <option value="all">全部状态</option>
        <option value="new">未下载</option>
        <option value="downloaded">已下载</option>
      </select>
      <BaseButton size="sm" variant="ghost" @click="applyFilter" :disabled="images.length===0">应用过滤</BaseButton>
    </div>

    <div class="restricted-banner" v-if="restrictedHint">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="banner-icon"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
      <span class="banner-text">{{ restrictedHint }}<em class="banner-hint">请切换到普通网页后再试。</em></span>
      <button class="banner-close" @click="restrictedHint = null" title="关闭提示">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </div>

    <!-- 下载队列展示 -->


    <SelectionTable
      :items="displayImages"
      :selected="selected"
      row-key="key"
      :dense="true"
      :loading="loading"
            :row-class="getRowClass"
      @select-all="handleSelectAll"
      @select-row="handleRowSelect"
    >
      <template #toolbar>
        <div class="table-status">
          <span>已识别 {{ images.length }} 张图片</span>
          <span v-if="error && !restrictedHint" class="status status--error">{{ error }}</span>
          <span v-else-if="loading" class="status">扫描中…</span>
          <span v-else-if="lastAction" class="status">{{ lastAction }}</span>
        </div>
        <BaseSearchBar
          v-model="imageSearchQuery"
          :inputRef="imageSearchInputEl"
          :disabled="loading"
          placeholder="搜索图片 URL/哈希 (Ctrl+F)"
          :hint="shortcutHint"
          :show-hint="showShortcutHints"
        />
      </template>
      <template #header>
        <th style="width:96px;">预览</th>
        <th style="width:120px;">哈希</th>
        <th style="width:100px;">尺寸</th>
        <th style="width:80px;">状态</th>
        <th>URL</th>
        <th style="width:160px;">操作</th>
      </template>
      <template #empty>未检测到图片资源</template>
      <template #row="{ item: img }">
        <td>
          <div class="thumb" :ref="setObserverRef(img.key)">
            <img v-if="loadedMap[img.key]" :src="img.url" @load="onImgLoad(img)" decoding="async" />
            <span v-else class="thumb__placeholder">加载中</span>
          </div>
        </td>
        <td>
          <span class="hash" :title="img.phash || '等待计算'">{{ img.phash ? img.phash.slice(0,16) : '…' }}</span>
          <span v-if="duplicateSet.has(img.key)" class="dup-badge" title="感知哈希重复">重复</span>
        </td>
        <td>{{ img.width }}×{{ img.height }}</td>
        <td>
          <span v-if="isDownloaded(img.url)" class="chip chip--success">已下载</span>
          <span v-else class="chip chip--ghost">未下载</span>
        </td>
        <td class="url-cell"><a :href="img.url" target="_blank" rel="noreferrer">{{ shorten(img.url) }}</a></td>
        <td>
          <div class="row-actions">
            <BaseButton size="sm" variant="ghost" @click="copyLink(img.url)">复制</BaseButton>
            <BaseButton size="sm" :disabled="processedKeys.has(img.key) || isDownloaded(img.url)" @click="downloadSingle(img)">
              {{ isDownloaded(img.url) ? '已下载' : (processedKeys.has(img.key) ? '已加入' : '下载') }}
            </BaseButton>
          </div>
        </td>
      </template>
    </SelectionTable>
  </BaseCard>
</template>

<script lang="ts">
import { BaseButton, BaseCard, SelectionTable, BaseSearchBar } from '../components/base';
import { GLOBAL_SHORTCUT_HINT } from '../utils/shortcutHints';
import { defineComponent, onMounted, onBeforeUnmount, reactive, ref, computed, watch } from 'vue';
import { useListSearch } from '../composables/useListSearch';
import { useRowHighlight } from '../composables/useRowHighlight';
import { useResourceCounts } from '../composables/useResourceCounts';
import { buildUnifiedMediaKey, computePerceptualHash, normalizeUrlForKey } from '../utils/mediaKeys';
import { markProcessed, isProcessed, initializeRegistry, registrySnapshot } from '../composables/useMediaRegistry';
import { loadState, saveState } from '../services/persist';
import { loadSettings } from '../services/settings';
import { addDownload, subscribe, retryDownload, cancelDownload, type DownloadTask } from '../services/downloadQueue';
import { loadHistory, isDownloaded } from '../services/downloadHistory';
import { exportRowsAsJSON, exportRowsAsCSV } from '../services/exportList';
import { addToBasket } from '../services/collection';
import { toast } from '../composables/useToast';
import { startFrameCapture, stopFrameCapture, isFrameCaptureActive, getFrameIntervalSeconds, type CapturedFrame } from '../services/frameCapture';
import { getActiveTabInfo, sendMessageToTab, ensureContentConnected, getAllFramesInfo, getAllFrameIds, isReceivingEndMissingError, type FrameInfo } from '../utils/chromeMessaging';
import { getRestrictedPageMessage } from '../utils/restrictedPages';
import { MessageType } from '@/messaging';

interface RawImageItem {
  url: string;
  width: number;
  height: number;
  kind: string;
  phash?: string;
  key: string;
}

export default defineComponent({
  name: 'ImageGrabPanel',
    components: { BaseButton, BaseCard, SelectionTable, BaseSearchBar },
  setup() {
    const { setCount } = useResourceCounts();
    const loading = ref(false);
    const error = ref<string | null>(null);
    const lastAction = ref('');
    const minWidth = ref(0);
    const minHeight = ref(0);
    const kindFilter = ref<string>('');
    const filterDownloadStatus = ref<'all'|'downloaded'|'new'>('all');
    const sortKey = ref<string>(''); // width|height|phash|url
    const sortDir = ref<'asc'|'desc'>('asc');
    const searchKit = useListSearch<string>({
      onRefresh: () => refreshImages(),
      selectAll: () => { selected.clear(); images.value.forEach(i=> selected.add(i.key)); scheduleSave(); },
      clearSelection: () => { selected.clear(); scheduleSave(); },
      invertSelection: () => { const all = images.value.map(i=> i.key); const next = new Set<string>(); all.forEach(k=>{ if(!selected.has(k)) next.add(k); }); selected.clear(); next.forEach(k=> selected.add(k)); scheduleSave(); },
      selectNew: () => { newHighlightSet.forEach(k=> { if(typeof k === 'string') selected.add(k); }); scheduleSave(); }
    });
    const images = ref<RawImageItem[]>([]);
    // 新增高亮集合统一封装 (UX-INCR-HINT-001)
    const { newSet: newHighlightSet, removedSet: removedHighlightSet, markNew: markImageNew, markRemoved: markImageRemoved } = useRowHighlight({ ttlNew: 2500, ttlRemoved: 900 });
    const ephemeralRemovedImages = reactive<Record<string, RawImageItem>>({});
    const displayImages = computed(() => {
      const base = images.value.slice();
      Object.keys(ephemeralRemovedImages).forEach(k => { if (!base.find(i => i.key === k)) base.push(ephemeralRemovedImages[k]); });
      return applyFilterInternal(base);
    });
    const selected = reactive<Set<string>>(new Set());
    const shortcutHint = GLOBAL_SHORTCUT_HINT;
    const showShortcutHints = ref(true);
    const ensureBusy = ref(false);
    const frameMode = ref<'auto'|'top'|'frame'>('auto');
    const frames = ref<FrameInfo[]>([]);
    const frameModeValue = ref<string>('auto');
    const queueTasks = ref<DownloadTask[]>([]);
    const frameInterval = ref(5);
    const frameCaptureActive = ref(false);
    const frameToggleBusy = ref(false);
    const nextTickCountdown = ref(0);
    let countdownTimer: number | null = null;
    let unsubscribeQueue: (()=>void) | null = null;
    let removeRuntimeListener: (()=>void) | null = null;
    // 统一注册表替换本地 processedKeys
    const processedKeys = reactive<Set<string>>(new Set()); // 保留用于界面响应；内部来源于 registry
    const loadedMap = reactive<Record<string, boolean>>({});
    const restrictedHint = ref<string | null>(null);

    // IntersectionObserver for lazy load
    let io: IntersectionObserver | null = null;
    const observerTargets = reactive<Record<string, Element>>({});
    function setObserverRef(key: string) {
      return (el: any) => {
        const element = (el && ('$el' in el)) ? (el.$el as Element) : (el as Element | null);
        if (!element) return; observerTargets[key] = element;
        ensureObserver(); io!.observe(el);
      };
    }
    function ensureObserver() {
      if (io) return;
      if ('IntersectionObserver' in window) {
        io = new IntersectionObserver((entries) => {
          entries.forEach((entry) => {
            if (entry.isIntersecting) {
              const el = entry.target as HTMLElement;
              const key = Object.keys(observerTargets).find(k => observerTargets[k] === el);
              if (key) {
                loadedMap[key] = true;
                io!.unobserve(el);
              }
            }
          });
        }, { rootMargin: '120px' });
      } else {
        io = { observe: (el: Element) => { const key = Object.keys(observerTargets).find(k => observerTargets[k] === el); if (key) loadedMap[key] = true; } } as any;
      }
    }

    const selectedCount = computed(() => selected.size);
    const hasSelection = computed(() => selected.size > 0);
    const allSelected = computed(() => images.value.length > 0 && selected.size === images.value.length);

    let saveTimer: number | null = null;
    function scheduleSave(){
      if(saveTimer) clearTimeout(saveTimer);
      saveTimer = window.setTimeout(async ()=>{
        await saveState({
          selections: { image: Array.from(selected) },
          filters: {
            image: {
              minWidth: minWidth.value || 0,
              minHeight: minHeight.value || 0,
              kind: kindFilter.value || '',
              frameInterval: frameInterval.value || 0
            }
          }
        });
      }, 500);
    }

    let boundFrameId: number | null = null; // 当前图片列表绑定的来源 frameId（增量更新按 frame 过滤）
    async function refreshImages() {
      loading.value = true; error.value = null; lastAction.value='';
      try {
        // 优先从页面内容脚本获取
        try {
          const tabId = await ensureActiveTab();
          if (!tabId) throw new Error('无活动标签页');
          // 启用图片功能（轻量，无需等待）
          try { void sendMessageToTab<any>(tabId, { type: MessageType.ENABLE_FEATURES, payload: { image: true, spaWatchers: true } }); } catch { /* noop */ }
          try { frames.value = await getAllFramesInfo(tabId); } catch { /* noop */ }
          let resp: { success: boolean; items?: any[]; error?: string } | undefined;
          if(frameMode.value==='top'){
            resp = await sendMessageToTab<{ success: boolean; items?: any[]; error?: string }>(tabId, { type: MessageType.REQUEST_IMAGE_LIST });
          } else if(frameMode.value==='frame'){
            const fid = parseSelectedFrameId();
            resp = await sendMessageToTab<{ success: boolean; items?: any[]; error?: string }>(tabId, { type: MessageType.REQUEST_IMAGE_LIST }, { frameId: fid! });
          } else {
            // auto: 顶层->子帧
            resp = await sendMessageToTab<{ success: boolean; items?: any[]; error?: string }>(tabId, { type: MessageType.REQUEST_IMAGE_LIST });
            if(!(resp?.success) || !(Array.isArray(resp?.items) && resp!.items!.length>0)){
              const ids = await getAllFrameIds(tabId);
              for(const fid of ids){
                try{
                  const r = await sendMessageToTab<{ success: boolean; items?: any[]; error?: string }>(tabId, { type: MessageType.REQUEST_IMAGE_LIST }, { frameId: fid });
                  if(r?.success && Array.isArray(r.items) && r.items.length){ resp = r; frameMode.value='frame'; frameModeValue.value='f:'+fid; break; }
                }catch { /* noop */ }
              }
            }
          }
          if (resp?.success && Array.isArray(resp.items)) {
            // 绑定本次列表来源 frame：优先用响应自带的 frameId，其次按模式推导
            boundFrameId = typeof (resp as any)?.frameId === 'number'
              ? (resp as any).frameId
              : (frameMode.value === 'frame' ? (parseSelectedFrameId() ?? 0) : 0);
            const mapped = resp.items.map((it:any)=>({ url: it.url, width: it.width||0, height: it.height||0, kind: String(it.kind||'img'), key: buildUnifiedMediaKey({ url: it.url, width: it.width||0, height: it.height||0, kind: String(it.kind||'img') }) }));
            images.value = applyFilterInternal(mapped);
          } else {
            throw new Error(resp?.error || '内容脚本未返回图片');
          }
        } catch (e) {
          // 自动修复：接收端缺失时尝试注入后重试一次
          if (isReceivingEndMissingError(e)) {
            try {
              const tabId = await ensureActiveTab();
              const res = await ensureContentConnected(tabId);
              if (res.ok) {
                // 重试一次顶层获取（简化）
                const retry = await sendMessageToTab<{ success: boolean; items?: any[]; error?: string }>(tabId, { type: MessageType.REQUEST_IMAGE_LIST });
                if (retry?.success && Array.isArray(retry.items)) {
                  const mapped2 = retry.items.map((it:any)=>({ url: it.url, width: it.width||0, height: it.height||0, kind: String(it.kind||'img'), key: buildUnifiedMediaKey({ url: it.url, width: it.width||0, height: it.height||0, kind: String(it.kind||'img') }) }));
                  images.value = applyFilterInternal(mapped2);
                  setCount('image', images.value.length);
                  lastAction.value = images.value.length ? `获取 ${images.value.length} 张图片` : '无图片';
                  selected.clear(); scheduleSave();
                  return;
                }
              }
            } catch { /* noop */ }
          }
          // 回退：在侧边栏自身 DOM 扫描（通常为空），保持兼容
          const scanned = scanImagesFromDom();
          images.value = applyFilterInternal(scanned);
        }
        setCount('image', images.value.length);
        lastAction.value = images.value.length ? `获取 ${images.value.length} 张图片` : '无图片';
        selected.clear();
        scheduleSave();
      } catch (e: any) {
        if (!restrictedHint.value) { error.value = e?.message || '扫描失败'; }
        images.value=[]; setCount('image',0); selected.clear();
      } finally { loading.value=false; }
    }

    async function ensureConnectAndRefresh(){
      ensureBusy.value = true; error.value=null; lastAction.value='';
      try{
        const tabId = await ensureActiveTab();
        const res = await ensureContentConnected(tabId);
        if(!res.ok){ throw new Error(res.error || `连接失败（已检查 ${res.framesChecked} 帧）`); }
        lastAction.value = `连接成功（${res.framesConnected}/${res.framesChecked}）`;
        try { frames.value = await getAllFramesInfo(tabId); } catch { /* noop */ }
        await refreshImages();
      }catch(e:any){ error.value = e?.message || '重试连接失败'; }
      finally{ ensureBusy.value=false; }
    }

    function onFrameModeChange(){
      const v = frameModeValue.value;
      if(v==='auto'){ frameMode.value='auto'; }
      else if(v==='top'){ frameMode.value='top'; }
      else if(v.startsWith('f:')){ const id = Number(v.slice(2)); if(Number.isFinite(id)) { frameMode.value='frame'; } }
      refreshImages();
    }
    function parseSelectedFrameId(): number | null { const v = frameModeValue.value; if(v.startsWith('f:')){ const id = Number(v.slice(2)); return Number.isFinite(id)? id : null; } return null; }
    function formatFrameLabel(f: FrameInfo){
      const id = f.frameId; let host='';
      try{ if(f.url){ const u=new URL(f.url); host = u.hostname.replace(/^www\./,'') + (u.pathname && u.pathname!=='/' ? ' · ' + (u.pathname.length>20 ? (u.pathname.slice(0,20)+'…') : u.pathname) : ''); } }catch { /* noop */ }
      return host? `#${id} ${host}` : `#${id}`;
    }

    function scanImagesFromDom(): RawImageItem[] {
      const results: RawImageItem[] = [];
      const seen = new Set<string>();
      const push = (url: string, w: number, h: number, kind: string) => {
        if (!url) return;
        const abs = normalizeUrlForKey(url);
        const raw: RawImageItem = { url: abs, width: w||0, height: h||0, kind, key: buildUnifiedMediaKey({ url: abs, width: w||0, height: h||0, kind }) };
        if (seen.has(raw.key)) return; seen.add(raw.key); results.push(raw);
      };
      document.querySelectorAll('img').forEach(img => { const src = (img as HTMLImageElement).currentSrc || (img as HTMLImageElement).src; if (src) push(src,(img as HTMLImageElement).naturalWidth,(img as HTMLImageElement).naturalHeight,'img'); });
      document.querySelectorAll('picture source').forEach(s=>{ const srcset = s.getAttribute('srcset'); if(!srcset) return; const first = srcset.split(',')[0].trim().split(' ')[0]; if(first) push(first,0,0,'source'); });
      document.querySelectorAll('*').forEach(el=>{ const style = getComputedStyle(el as HTMLElement); const bg = style.backgroundImage; if(bg && bg!=='none'){ const matches = bg.match(/url\(("|')?(.*?)("|')?\)/g); if(matches){ matches.forEach(m=>{ const inner = m.replace(/url\(("|')?/,'').replace(/("|')?\)$/,''); if(/^data:/i.test(inner)) return; push(inner,(el as HTMLElement).clientWidth,(el as HTMLElement).clientHeight,'background'); }); } } });
      return results;
    }

    function applyFilter() {
      images.value = applyFilterInternal(rawSource());
      setCount('image', images.value.length);
      lastAction.value = '已应用过滤';
      scheduleSave();
    }
    function applyFilterInternal(list: RawImageItem[]): RawImageItem[] {
      const q = searchKit.searchQuery.value.trim().toLowerCase();
      return sortItems(list.filter(i => {
        if(minWidth.value && i.width < minWidth.value) return false;
        if(minHeight.value && i.height < minHeight.value) return false;
        if(kindFilter.value && i.kind !== kindFilter.value) return false;
        
        // 下载状态过滤
        if (filterDownloadStatus.value !== 'all') {
          const downloaded = isDownloaded(i.url);
          if (filterDownloadStatus.value === 'downloaded' && !downloaded) return false;
          if (filterDownloadStatus.value === 'new' && downloaded) return false;
        }

        if(q){
          const urlHit = i.url.toLowerCase().includes(q);
          const hashHit = i.phash ? i.phash.toLowerCase().includes(q) : false;
          if(!urlHit && !hashHit) return false;
        }
        return true;
      }));
    }
    function sortItems(list: RawImageItem[]): RawImageItem[] {
      if(!sortKey.value) return list.slice();
      const arr = list.slice();
      arr.sort((a,b)=>{
        let va:any; let vb:any;
        switch(sortKey.value){
          case 'width': va=a.width; vb=b.width; break;
          case 'height': va=a.height; vb=b.height; break;
          case 'phash': va=a.phash||''; vb=b.phash||''; break;
          case 'url': va=a.url; vb=b.url; break;
          default: va=''; vb='';
        }
        if(va==vb) return 0;
        return (va>vb?1:-1) * (sortDir.value==='asc'?1:-1);
      });
      return arr;
    }
    function rawSource(){ return images.value; }
    function toggleSort(key: string){
      if(sortKey.value!==key){ sortKey.value=key; sortDir.value='asc'; }
      else { sortDir.value = sortDir.value==='asc' ? 'desc' : 'asc'; }
      images.value = applyFilterInternal(rawSource());
      scheduleSave();
    }

    function handleSelectAll(checked: boolean) {
      if (checked) { selected.clear(); images.value.forEach((i) => selected.add(i.key)); }
      else { selected.clear(); }
      scheduleSave();
    }

    function handleRowSelect(key: string) {
      if (selected.has(key)) selected.delete(key);
      else selected.add(key);
      scheduleSave();
    }

    function clearList(){ images.value=[]; selected.clear(); setCount('image',0); scheduleSave(); }

    async function downloadSingle(img: RawImageItem){ if(isProcessed(img.key)) return; markProcessed(img.key); processedKeys.add(img.key); // 传 undefined 让后台套用命名模板
      addDownload(img.url, undefined, 'image', 'DIRECT_DOWNLOAD_GENERIC'); lastAction.value='已加入队列'; }
    async function downloadSelected(){ let count=0; for(const key of selected){ const img = images.value.find(i=>i.key===key); if(!img || isProcessed(img.key)) continue; markProcessed(img.key); processedKeys.add(img.key); addDownload(img.url, undefined, 'image', 'DIRECT_DOWNLOAD_GENERIC'); count++; } lastAction.value = `队列新增 ${count} 条`; }

    function onImgLoad(img: RawImageItem){ if(!img.phash){ try { img.phash = computePerceptualHash((event!.target as HTMLImageElement)); img.key = buildUnifiedMediaKey(img); } catch (_) { /* noop */ } } }
    function copyLink(url: string){ navigator.clipboard.writeText(url).then(()=> { lastAction.value='已复制链接'; toast.success('已复制链接'); }).catch(()=> error.value='复制失败'); }
    function shorten(url: string){ return url.length>64 ? url.slice(0,64)+'…' : url; }

    onMounted(async ()=>{

      // 加载下载历史
      await loadHistory();
      // 初始化持久化媒体注册表并同步已处理状态
      await initializeRegistry();
      const snap = registrySnapshot();
      processedKeys.clear(); snap.processed.forEach(k=> processedKeys.add(k));
      // 加载选择与过滤
      try {
        const st = await loadState();
        if(Array.isArray(st.selections?.image)){ selected.clear(); st.selections!.image!.forEach(k=> selected.add(k)); }
        const imageFilters = st.filters?.image;
        if(imageFilters){
          if(typeof imageFilters.minWidth === 'number') minWidth.value = imageFilters.minWidth;
          if(typeof imageFilters.minHeight === 'number') minHeight.value = imageFilters.minHeight;
          if(typeof imageFilters.kind === 'string') kindFilter.value = imageFilters.kind;
          if(typeof imageFilters.frameInterval === 'number' && imageFilters.frameInterval > 0) {
            frameInterval.value = Math.max(1, Math.floor(imageFilters.frameInterval));
          }
        }
        if(!imageFilters?.frameInterval && typeof st.filters?.video?.frameInterval === 'number') {
          frameInterval.value = Math.max(1, Math.floor(st.filters.video.frameInterval));
        }
      } catch { /* noop */ }
      frameCaptureActive.value = isFrameCaptureActive();
      const currentInterval = getFrameIntervalSeconds();
      if(currentInterval > 0) {
        frameInterval.value = Math.max(1, currentInterval);
      }
      restartCountdownLoop();
      refreshImages();
      await updateRestrictedHint();
      if (restrictedHint.value) { return; }
      // 订阅下载队列
      unsubscribeQueue = subscribe(tasks => { queueTasks.value = tasks; });
      // 监听增量资源更新（图片）
      if (chrome?.runtime?.onMessage?.addListener) {
        const handler: Parameters<typeof chrome.runtime.onMessage.addListener>[0] = (message) => {
          if (!message || !message.type) return;
          if (message.type === MessageType.RESOURCE_UPDATE) {
            try {
              const payload: any = (message as any).payload || {};
              // frameId 守卫：忽略来自其他 frame 的自动增量，防止跨 frame 列表互相覆盖
              const updFrameId = typeof payload.frameId === 'number' ? payload.frameId : 0;
              if (updFrameId === (boundFrameId ?? 0) && Array.isArray(payload.images)) {
                const diff = payload.diff?.images;
                if (diff?.removed?.length) {
                  diff.removed.forEach((k: string) => {
                    const ex = images.value.find(i => i.key === k);
                    if (ex) { ephemeralRemovedImages[k] = { ...ex }; }
                  });
                  markImageRemoved(diff.removed);
                  window.setTimeout(() => { diff.removed.forEach((k: string) => { delete ephemeralRemovedImages[k]; }); }, 900);
                }
                const mapped = payload.images.map((it: any) => ({ url: it.url, width: it.width||0, height: it.height||0, kind: String(it.kind||'img'), key: buildUnifiedMediaKey({ url: it.url, width: it.width||0, height: it.height||0, kind: String(it.kind||'img') }) }));
                const filtered = applyFilterInternal(mapped);
                if (diff?.added?.length) {
                  const addedKeys = diff.added.map((img: any) => buildUnifiedMediaKey({ url: img.url, width: img.width||0, height: img.height||0, kind: String(img.kind||'img') }));
                  if (addedKeys.length) markImageNew(addedKeys);
                } else {
                  const prev = new Set(images.value.map(i=> i.key));
                  const added = filtered.filter(i => !prev.has(i.key)).map(i => i.key);
                  if (added.length) markImageNew(added);
                }
                images.value = filtered;
                setCount('image', images.value.length);
                lastAction.value = '自动增量更新';
              }
            } catch { /* noop */ }
          }
          if (message.type === MessageType.SETTINGS_UPDATE) {
            try {
              const payload: any = (message as any).payload || {};
              if (typeof payload.showShortcutHints === 'boolean') showShortcutHints.value = payload.showShortcutHints;
            } catch { /* noop */ }
          }
        };
        chrome.runtime.onMessage.addListener(handler);
        removeRuntimeListener = () => chrome.runtime.onMessage.removeListener(handler);
      }
      // 接收帧捕获服务注入的图片
      window.addEventListener('sidepanel:add-frame-image', (evt: Event) => {
        const detail = (evt as CustomEvent<CapturedFrame>).detail;
        if(!detail?.url) return;
        // 构造 RawImageItem
        const item: RawImageItem = {
          url: detail.url,
          width: detail.width||0,
            height: detail.height||0,
          kind: detail.kind,
          phash: undefined,
          key: buildUnifiedMediaKey({ url: detail.url, width: detail.width||0, height: detail.height||0, kind: detail.kind })
        };
        // 去重（key 或已存在 URL+尺寸）
        if(images.value.find(i=>i.key===item.key)) return;
        images.value.unshift(item);
        setCount('image', images.value.length);
        lastAction.value = '新增帧图像';
      });

      // 监听标签页切换：自动重新检测受限状态并刷新
      const onTabActivated = async () => {
        await updateRestrictedHint();
        if (!restrictedHint.value) {
          error.value = null;
          await refreshImages();
        }
      };
      if (chrome?.tabs?.onActivated?.addListener) {
        chrome.tabs.onActivated.addListener(onTabActivated);
      }
      // 注册全局快捷键
      searchKit.register();
      // 加载设置（快捷键提示开关）
      try { const s = await loadSettings(); showShortcutHints.value = s.showShortcutHints; } catch { /* noop */ }
    });

    onBeforeUnmount(()=>{
      if(unsubscribeQueue) { unsubscribeQueue(); unsubscribeQueue=null; }
      if(countdownTimer){ clearInterval(countdownTimer); countdownTimer = null; }
      if(removeRuntimeListener){ removeRuntimeListener(); removeRuntimeListener=null; }
    });

    // 重复集合 (基于感知哈希前16位出现次数>1)
    const duplicateSet = computed(() => {
      const counts: Record<string, number> = {};
      images.value.forEach(i => { if(i.phash){ const key = i.phash.slice(0,16); counts[key] = (counts[key]||0)+1; } });
      const dup = new Set<string>();
      images.value.forEach(i => { if(i.phash && counts[i.phash.slice(0,16)]>1) dup.add(i.key); });
      return dup;
    });

    function retryTask(id: string){ retryDownload(id); }
    function cancelTask(id: string){ cancelDownload(id); }

    function toggleFrameCapture(){
      frameToggleBusy.value = true;
      try {
        if (frameCaptureActive.value) {
          stopFrameCapture();
          frameCaptureActive.value = false;
          lastAction.value = '已停止定时抓帧';
        } else {
          const iv = Math.max(1, frameInterval.value | 0);
          startFrameCapture(iv);
          frameCaptureActive.value = true;
          lastAction.value = `开始抓帧(${iv}s)`;
        }
        restartCountdownLoop();
        scheduleSave();
      } finally {
        frameToggleBusy.value = false;
      }
    }

    function restartCountdownLoop(){
      if (countdownTimer) {
        clearInterval(countdownTimer);
        countdownTimer = null;
      }
      if (!frameCaptureActive.value) {
        nextTickCountdown.value = 0;
        return;
      }
      const interval = Math.max(1, frameInterval.value | 0);
      nextTickCountdown.value = interval;
      countdownTimer = window.setInterval(() => {
        if (!frameCaptureActive.value) {
          nextTickCountdown.value = 0;
          if (countdownTimer) {
            clearInterval(countdownTimer);
            countdownTimer = null;
          }
          return;
        }
        nextTickCountdown.value = Math.max(0, nextTickCountdown.value - 1);
        if (nextTickCountdown.value === 0) {
          nextTickCountdown.value = interval;
        }
      }, 1000);
    }

    function focusImageSearch(){ searchKit.focusSearch(); }
    function invertImageSelection(){ const all = images.value.map(i=> i.key); const next = new Set<string>(); all.forEach(k=>{ if(!selected.has(k)) next.add(k); }); selected.clear(); next.forEach(k=> selected.add(k)); scheduleSave(); }
    function selectNewImages(){ newHighlightSet.forEach(k=> { if(typeof k === 'string') selected.add(k); }); scheduleSave(); }

    watch(frameInterval, (val) => {
      const sec = Math.max(1, Math.floor(Number(val) || 1));
      if (sec !== val) {
        frameInterval.value = sec;
        return;
      }
      if (frameCaptureActive.value) {
        startFrameCapture(sec);
      }
      restartCountdownLoop();
      scheduleSave();
    });

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
        throw new Error('无活动标签页');
      }
      const hint = getRestrictedPageMessage(info?.url || info?.pendingUrl);
      if (hint) {
        restrictedHint.value = hint;
        throw new Error(hint);
      }
      restrictedHint.value = null;
      return tabId;
    }

    function getRowClass(img: RawImageItem) {
      return {
        'duplicate-row': duplicateSet.value.has(img.key),
        'row-new': newHighlightSet.has(img.key),
        'row-removed': removedHighlightSet.has(img.key)
      };
    }

    // ===== 收集篮 =====
    async function addSelectedToBasket() {
      const items = displayImages.value
        .filter(i => selected.has(i.key))
        .map(i => ({ kind: 'image' as const, url: i.url, width: i.width, height: i.height }));
      const n = await addToBasket(items.filter(i => i.url));
      if (n > 0) toast.success(`已加入收集篮 ${n} 项`);
      else toast.info('选中项均已在收集篮中');
    }

    // ===== 清单导出 =====
    function exportJson() {
      exportRowsAsJSON(displayImages.value.map(i => ({ url: i.url, width: i.width, height: i.height, kind: i.kind })), '图片清单');
    }
    function exportCsv() {
      exportRowsAsCSV(displayImages.value, [
        { label: '地址', value: i => i.url },
        { label: '宽', value: i => i.width },
        { label: '高', value: i => i.height },
        { label: '类型', value: i => i.kind },
        { label: '已下载', value: i => (isDownloaded(i.url) ? '是' : '否') }
      ], '图片清单');
    }

    return { displayImages, images, exportJson, exportCsv, newHighlightSet, removedHighlightSet, loading, error, lastAction, minWidth, minHeight, kindFilter, filterDownloadStatus, sortKey, sortDir, selectedCount, hasSelection, allSelected, processedKeys, loadedMap, duplicateSet, refreshImages, handleSelectAll, handleRowSelect, selected, applyFilter, downloadSelected, downloadSingle, copyLink, shorten, clearList, setObserverRef, toggleSort, onImgLoad, ensureBusy, ensureConnectAndRefresh, frameMode, frames, frameModeValue, onFrameModeChange, formatFrameLabel, queueTasks, retryTask, cancelTask, frameInterval, frameCaptureActive, frameToggleBusy, nextTickCountdown, toggleFrameCapture, restrictedHint, imageSearchQuery: searchKit.searchQuery, imageSearchInputEl: searchKit.searchInputRef, focusImageSearch, invertImageSelection, selectNewImages, shortcutHint, showShortcutHints, getRowClass, isDownloaded };
  }
});
</script>

<style scoped>
.frame-capture-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
  padding: 8px 12px;
  background: var(--sp-color-surface);
  border: 1px solid var(--sp-color-border);
  border-radius: var(--sp-radius-md);
}

.frame-capture-group {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.interval-label {
  font-size: 11px;
  color: var(--sp-color-muted);
}

.interval-input {
  width: 52px;
  height: 26px;
  padding: 0 7px;
  background: var(--sp-color-bg-elevated);
  border: 1px solid var(--sp-color-border-strong);
  border-radius: var(--sp-radius-sm);
  color: var(--sp-color-text);
  font-size: 11px;
  font-family: var(--sp-font-family);
  outline: none;
  text-align: center;
}

.interval-hint {
  font-size: 11px;
  color: var(--sp-color-success);
  font-family: var(--sp-font-mono, monospace);
}

.toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 10px;
  flex-wrap: wrap;
  gap: 6px;
}

.toolbar__left, .toolbar__right {
  display: flex;
  gap: 6px;
  align-items: center;
  flex-wrap: wrap;
}

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

.filter-bar input[type=number] {
  width: 52px;
  height: 26px;
  padding: 0 7px;
  background: var(--sp-color-bg-elevated);
  border: 1px solid var(--sp-color-border-strong);
  border-radius: var(--sp-radius-sm);
  color: var(--sp-color-text);
  font-size: 11px;
  font-family: var(--sp-font-family);
  outline: none;
  text-align: center;
}

.filter-bar select {
  height: 26px;
  padding: 0 7px;
  background: var(--sp-color-surface);
  border: 1px solid var(--sp-color-border-strong);
  border-radius: var(--sp-radius-sm);
  color: var(--sp-color-text);
  font-size: 11px;
  font-family: var(--sp-font-family);
  outline: none;
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

.thumb {
  width: 72px;
  height: 48px;
  border-radius: var(--sp-radius-sm);
  overflow: hidden;
  background: var(--sp-color-surface);
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--sp-color-border);
}

.thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.thumb__placeholder {
  font-size: 11px;
  color: var(--sp-color-muted);
}

.hash {
  font-family: var(--sp-font-mono, monospace);
  font-size: 11px;
  color: var(--sp-color-muted);
}

.dup-badge {
  display: inline-flex;
  align-items: center;
  padding: 1px 5px;
  background: var(--sp-color-warning-light);
  color: var(--sp-color-warning);
  border-radius: 999px;
  font-size: 11px;
  font-weight: 600;
  margin-left: 3px;
}

.chip {
  display: inline-flex;
  align-items: center;
  padding: 2px 7px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 600;
}

.chip--success { background: var(--sp-color-success-light); color: var(--sp-color-success); }
.chip--ghost { background: var(--sp-color-bg-subtle); color: var(--sp-color-muted); }

.url-cell {
  font-size: 11px;
  color: var(--sp-color-primary);
  word-break: break-all;
  max-width: 140px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
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
</style>
