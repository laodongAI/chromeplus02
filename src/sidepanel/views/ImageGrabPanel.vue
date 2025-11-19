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
        <BaseButton size="sm" variant="ghost" @click="toggleSelectAll" :disabled="images.length===0">
          {{ allSelected ? '取消全选' : '全选' }}
        </BaseButton>
        <BaseButton size="sm" variant="ghost" @click="clearList" :disabled="images.length===0">清空</BaseButton>
      </div>
      <div class="toolbar__right">
        <BaseButton size="sm" :disabled="!hasSelection" @click="downloadSelected">批量下载 ({{ selectedCount }})</BaseButton>
      </div>
    </div>

    <div class="filter-bar">
      <label>最小宽度 <input type="number" v-model.number="minWidth" min="0" /></label>
      <label>最小高度 <input type="number" v-model.number="minHeight" min="0" /></label>
      <BaseButton size="sm" variant="ghost" @click="applyFilter" :disabled="images.length===0">应用过滤</BaseButton>
    </div>

    <div class="restricted-banner" v-if="restrictedHint">
      {{ restrictedHint }}
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

    <BaseTable :dense="true">
      <template #toolbar>
        <div class="table-status">
          <span>已识别 {{ images.length }} 张图片</span>
          <span v-if="error" class="status status--error">{{ error }}</span>
          <span v-else-if="loading" class="status">扫描中…</span>
          <span v-else-if="lastAction" class="status">{{ lastAction }}</span>
        </div>
      </template>
      <thead>
        <tr>
          <th style="width:40px;"></th>
          <th style="width:96px;">预览</th>
          <th style="width:120px;">哈希</th>
          <th style="width:100px;">尺寸</th>
          <th>URL</th>
          <th style="width:160px;">操作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-if="!loading && images.length===0">
          <td colspan="6" class="empty-row">未检测到图片资源</td>
        </tr>
        <tr v-for="img in images" :key="img.key" :class="{ 'duplicate-row': duplicateSet.has(img.key) }">
          <td><input type="checkbox" :checked="isSelected(img.key)" @change="onSelectChange(img.key, $event)" /></td>
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
          <td class="url-cell"><a :href="img.url" target="_blank" rel="noreferrer">{{ shorten(img.url) }}</a></td>
          <td>
            <div class="row-actions">
              <BaseButton size="sm" variant="ghost" @click="copyLink(img.url)">复制</BaseButton>
              <BaseButton size="sm" :disabled="processedKeys.has(img.key)" @click="downloadSingle(img)">
                {{ processedKeys.has(img.key) ? '已处理' : '下载' }}
              </BaseButton>
            </div>
          </td>
        </tr>
      </tbody>
    </BaseTable>
  </BaseCard>
</template>

<script lang="ts">
import { BaseButton, BaseCard, BaseTable } from '../components/base';
import { defineComponent, onMounted, onBeforeUnmount, reactive, ref, computed, watch } from 'vue';
import { useResourceCounts } from '../composables/useResourceCounts';
import { buildUnifiedMediaKey, computePerceptualHash, normalizeUrlForKey } from '../utils/mediaKeys';
import { markProcessed, isProcessed, mediaKey, initializeRegistry, registrySnapshot } from '../composables/useMediaRegistry';
import { loadState, saveState } from '../services/persist';
import { addDownload, subscribe, retryDownload, cancelDownload, type DownloadTask } from '../services/downloadQueue';
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
  components: { BaseButton, BaseCard, BaseTable },
  setup() {
    const { setCount } = useResourceCounts();
    const loading = ref(false);
    const error = ref<string | null>(null);
    const lastAction = ref('');
    const minWidth = ref(0);
    const minHeight = ref(0);
    const kindFilter = ref<string>('');
    const sortKey = ref<string>(''); // width|height|phash|url
    const sortDir = ref<'asc'|'desc'>('asc');
    const images = ref<RawImageItem[]>([]);
    const selected = reactive<Set<string>>(new Set());
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

    async function refreshImages() {
      loading.value = true; error.value = null; lastAction.value='';
      try {
        // 优先从页面内容脚本获取
        try {
          const tabId = await ensureActiveTab();
          if (!tabId) throw new Error('无活动标签页');
          // 启用图片功能（轻量，无需等待）
          try { void sendMessageToTab<any>(tabId, { type: MessageType.ENABLE_FEATURES, payload: { image: true, spaWatchers: true } }); } catch {}
          try { frames.value = await getAllFramesInfo(tabId); } catch {}
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
                }catch{}
              }
            }
          }
          if (resp?.success && Array.isArray(resp.items)) {
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
            } catch {}
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
        error.value = e?.message || '扫描失败'; images.value=[]; setCount('image',0); selected.clear();
      } finally { loading.value=false; }
    }

    async function ensureConnectAndRefresh(){
      ensureBusy.value = true; error.value=null; lastAction.value='';
      try{
        const tabId = await ensureActiveTab();
        const res = await ensureContentConnected(tabId);
        if(!res.ok){ throw new Error(res.error || `连接失败（已检查 ${res.framesChecked} 帧）`); }
        lastAction.value = `连接成功（${res.framesConnected}/${res.framesChecked}）`;
        try { frames.value = await getAllFramesInfo(tabId); } catch {}
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
      try{ if(f.url){ const u=new URL(f.url); host = u.hostname.replace(/^www\./,'') + (u.pathname && u.pathname!=='/' ? ' · ' + (u.pathname.length>20 ? (u.pathname.slice(0,20)+'…') : u.pathname) : ''); } }catch{}
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
      return sortItems(list.filter(i => (!minWidth.value || i.width >= minWidth.value) && (!minHeight.value || i.height >= minHeight.value) && (!kindFilter.value || i.kind===kindFilter.value)));
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

    function isSelected(key: string){ return selected.has(key); }
    function onSelectChange(key: string, evt: Event){ const checked = (evt.target as HTMLInputElement).checked; if(checked) selected.add(key); else selected.delete(key); scheduleSave(); }
    function toggleSelectAll(){ if(allSelected.value){ selected.clear(); } else { selected.clear(); images.value.forEach(i=>selected.add(i.key)); } scheduleSave(); }
    function clearList(){ images.value=[]; selected.clear(); setCount('image',0); scheduleSave(); }

    async function downloadSingle(img: RawImageItem){ if(isProcessed(img.key)) return; const filename = buildImageFilename(img); markProcessed(img.key); processedKeys.add(img.key); addDownload(img.url, filename, 'image', 'DIRECT_DOWNLOAD_GENERIC'); lastAction.value='已加入队列'; }
    async function downloadSelected(){ let count=0; for(const key of selected){ const img = images.value.find(i=>i.key===key); if(!img || isProcessed(img.key)) continue; const filename = buildImageFilename(img); markProcessed(img.key); processedKeys.add(img.key); addDownload(img.url, filename, 'image', 'DIRECT_DOWNLOAD_GENERIC'); count++; } lastAction.value = `队列新增 ${count} 条`; }

    function onImgLoad(img: RawImageItem){ if(!img.phash){ try { img.phash = computePerceptualHash((event!.target as HTMLImageElement)); img.key = buildUnifiedMediaKey(img); } catch(_){} } }
    function copyLink(url: string){ navigator.clipboard.writeText(url).then(()=> lastAction.value='已复制链接').catch(()=> error.value='复制失败'); }
    function shorten(url: string){ return url.length>64 ? url.slice(0,64)+'…' : url; }
    function buildImageFilename(img: RawImageItem){ const base = (img.url.split('/').pop()||'image').replace(/[\/:*?"<>|]/g,'_'); return `${base}_${img.width}x${img.height}.png`; }

    onMounted(async ()=>{ 
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
      } catch {}
      frameCaptureActive.value = isFrameCaptureActive();
      const currentInterval = getFrameIntervalSeconds();
      if(currentInterval > 0) {
        frameInterval.value = Math.max(1, currentInterval);
      }
      restartCountdownLoop();
      refreshImages();
      void updateRestrictedHint();
      // 订阅下载队列
      unsubscribeQueue = subscribe(tasks => { queueTasks.value = tasks; });
      // 监听增量资源更新（图片）
      if (chrome?.runtime?.onMessage?.addListener) {
        const handler: Parameters<typeof chrome.runtime.onMessage.addListener>[0] = (message) => {
          if (!message || !message.type) return;
          if (message.type === MessageType.RESOURCE_UPDATE) {
            try {
              const payload: any = (message as any).payload || {};
              if (Array.isArray(payload.images)) {
                const mapped = payload.images.map((it: any) => ({ url: it.url, width: it.width||0, height: it.height||0, kind: String(it.kind||'img'), key: buildUnifiedMediaKey({ url: it.url, width: it.width||0, height: it.height||0, kind: String(it.kind||'img') }) }));
                images.value = applyFilterInternal(mapped);
                setCount('image', images.value.length);
                lastAction.value = '自动增量更新';
              }
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
        case 'DRM': return base + ' — 图像资源受 DRM/保护策略限制，可尝试截图方式'+tail;
        case 'CORS': return base + ' — 跨域限制，需同源获取或使用截图'+tail;
        case 'PERMISSION': return base + ' — 权限/403，可能需要登录或授权'+tail;
        case 'NO_RESOURCE': return base + ' — 资源不存在或失效'+tail;
        case 'NETWORK': return base + ' — 网络失败，可重试'+tail;
        case 'INTERRUPTED': return base + ' — 下载被中断，可重试'+tail;
        default: return base + tail;
      }
    }

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

    return { images, loading, error, lastAction, minWidth, minHeight, kindFilter, sortKey, sortDir, selectedCount, hasSelection, allSelected, processedKeys, loadedMap, duplicateSet, refreshImages, toggleSelectAll, isSelected, onSelectChange, applyFilter, downloadSelected, downloadSingle, copyLink, shorten, clearList, setObserverRef, toggleSort, onImgLoad, ensureBusy, ensureConnectAndRefresh, frameMode, frames, frameModeValue, onFrameModeChange, formatFrameLabel, queueTasks, renderTaskStatus, retryTask, cancelTask, frameInterval, frameCaptureActive, frameToggleBusy, nextTickCountdown, toggleFrameCapture, restrictedHint, mapErrorCode, renderErrorHint };
  }
});
</script>

<style scoped>
.frame-capture-bar { margin-bottom: var(--sp-spacing-4); display:flex; flex-wrap:wrap; }
.frame-capture-group { display:flex; gap: var(--sp-spacing-3); align-items:center; }
.interval-input { width:80px; }
.interval-hint { font-size:12px; color: var(--sp-color-muted); }
.toolbar { display:flex; justify-content:space-between; flex-wrap:wrap; gap:var(--sp-spacing-3); margin-bottom:var(--sp-spacing-4); }
.toolbar__left, .toolbar__right { display:flex; gap:var(--sp-spacing-3); align-items:center; }
.filter-bar { display:flex; gap:var(--sp-spacing-3); flex-wrap:wrap; align-items:center; margin-bottom:var(--sp-spacing-3); }
.table-status { display:flex; gap:var(--sp-spacing-3); flex-wrap:wrap; color:var(--sp-color-muted); font-size:13px; }
.empty-row { text-align:center; padding:var(--sp-spacing-4); color:var(--sp-color-muted); }
.thumb { width:80px; height:45px; background:#eee; display:flex; align-items:center; justify-content:center; font-size:11px; color:#666; overflow:hidden; border-radius:4px; }
.thumb img { max-width:80px; max-height:45px; object-fit:cover; }
.row-actions { display:flex; gap:var(--sp-spacing-2); flex-wrap:wrap; }
.hash { font-family:monospace; font-size:11px; color:var(--sp-color-muted); }
.url-cell a { color: var(--sp-color-primary); word-break: break-all; }
input[type='checkbox'] { width:16px; height:16px; }
.duplicate-row { background: rgba(255,196,102,0.15); }
.dup-badge { display:inline-block; margin-left:4px; padding:2px 4px; background:#ffc465; color:#7a4b00; border-radius:4px; font-size:10px; line-height:1; }

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
</style>
