<template>
  <!-- UI 三批（组6）：标题改引用 terminology 常量 PANEL_TITLES.image（「图片抓取」），
       与分段 tab「图片」三处同源，消除「图像/图片」混用 -->
  <BaseCard :title="PANEL_TITLES.image" subtitle="扫描页面图片/背景与视频帧" :padded="true">
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
        <!-- 评审（UI 二批之一）问题 6：原"重试连接"为开发者术语，实际动作是重新注入页面脚本并再次扫描；
             改为"修复扫描"并用 title 说明下一步预期 -->
        <BaseButton size="sm" variant="ghost" :loading="ensureBusy" :disabled="loading" @click="ensureConnectAndRefresh"
          title="页面无响应或扫描无结果时，重新注入页面脚本并再次扫描">修复扫描</BaseButton>
        <select class="frame-select" v-model="frameModeValue" @change="onFrameModeChange" :disabled="loading">
          <option value="auto">自动选择</option>
          <option value="top">主页面</option>
          <option v-for="f in frames" :key="f.frameId" :value="'f:'+f.frameId">{{ formatFrameLabel(f) }}</option>
        </select>
        <BaseButton size="sm" variant="ghost" @click="handleSelectAll(!allSelected)" :disabled="!displayImages.length">
          {{ allSelected ? '取消全选' : '全选' }}
        </BaseButton>
        <BaseButton size="sm" variant="ghost" @click="confirmClearList" :disabled="images.length===0">清空</BaseButton>
      </div>
      <div class="toolbar__right">
        <BaseButton size="sm" variant="ghost" :disabled="!displayImages.length" @click="exportCsv">导出CSV</BaseButton>
        <BaseButton size="sm" variant="ghost" :disabled="!displayImages.length" @click="exportJson">导出JSON</BaseButton>
        <BaseButton size="sm" variant="ghost" :disabled="!hasSelection" @click="addSelectedToBasket">加入收集篮</BaseButton>
        <BaseButton size="sm" :disabled="!hasSelection" @click="downloadSelected">批量下载 ({{ selectedCount }})</BaseButton>
      </div>
    </div>

    <!-- 评审（UI 二批之一）问题 4：过滤条统一即时生效——宽高输入 300ms 防抖后自动应用，
         状态下拉 change 即时应用；移除"应用过滤"按钮，新增"重置" -->
    <div class="filter-bar">
      <label>最小宽度 <input type="number" v-model.number="minWidthInput" min="0" /></label>
      <label>最小高度 <input type="number" v-model.number="minHeightInput" min="0" /></label>
      <select v-model="filterDownloadStatus" @change="applyFilter">
        <option value="all">全部状态</option>
        <option value="new">未下载</option>
        <option value="downloaded">已下载</option>
      </select>
      <!-- 评审（UI 二批之一）问题 3：重复筛选补动作。复用 PhashDuplicateTracker 的判定结果
           （duplicateSet），隐藏时每组保留首个代表，不重算哈希 -->
      <label class="dup-toggle" title="隐藏感知哈希重复的冗余副本，每组保留第一张">
        <input type="checkbox" v-model="hideDuplicates" />隐藏重复
      </label>
      <BaseButton size="sm" variant="ghost" :disabled="!duplicateSet.size" @click="selectDuplicates">选中重复项</BaseButton>
      <BaseButton size="sm" variant="ghost" :disabled="!duplicateSet.size" @click="deselectDuplicates">取消选中重复</BaseButton>
      <BaseButton size="sm" variant="ghost" @click="resetFilter">重置</BaseButton>
    </div>

    <!-- UI 三批（组1）：受限横幅收敛到共享组件 RestrictedBanner（warning 语义唯一实现），
         删除本面板复制版 .restricted-banner/.banner-* 样式与内联 svg；
         组件默认 hint「请切换到普通网页后再试。」与原内联文案一致；
         close 事件仅清空本面板 restrictedHint 状态，受限检测业务逻辑零改动 -->
    <RestrictedBanner v-if="restrictedHint" :message="restrictedHint" @close="restrictedHint = null" />

    <!-- 列表头部：状态行 + 搜索框（沿用原 SelectionTable toolbar 的信息结构） -->
    <div class="list-toolbar">
      <div class="table-status">
        <span>已识别 {{ images.length }} 张图片</span>
        <span v-if="filteredCount !== images.length" class="status">过滤后 {{ filteredCount }} 张</span>
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
    </div>

    <!-- 评审（UI 二批之一）问题 1：表格列宽合计 550px+ 在 300-400px 侧栏必然横向滚动。
         改为卡片列表：缩略图 + 尺寸 + 状态三要素常驻，URL/哈希/类型折叠进"⋯"详情展开；
         哈希列（对终端用户无意义）从常驻区移除。
         保留原有：60/页分页、IntersectionObserver 懒加载、跨页勾选、全选/导出作用于完整过滤结果 -->
    <div class="card-list" role="list">
      <article
        v-for="img in pagedImages"
        :key="img.key"
        class="image-card"
        :class="getCardClass(img)"
        role="listitem"
      >
        <!-- UI 三批（组3）：勾选框触控目标 ≥24px——用 label 包裹 input 扩展点击命中区
             （label 关联其内部控件，点击 label 空白同样触发勾选，合法且无副作用）；
             input 本体保持 13px 视觉尺寸，label 负外边距抵消 24px 盒带来的布局位移，视觉不变 -->
        <label class="check-hit">
          <input
            type="checkbox"
            class="card-check"
            :checked="selected.has(img.key)"
            :aria-label="`选择图片 ${img.width}×${img.height}`"
            @change="handleRowSelect(img.key)"
          />
        </label>
        <div class="card-thumb" :ref="setObserverRef(img.key)">
          <img v-if="loadedMap[img.key]" :src="img.url" @load="onImgLoad(img)" decoding="async" />
          <span v-else class="thumb__placeholder">…</span>
        </div>
        <div class="card-main">
          <div class="card-title">{{ img.width }}×{{ img.height }} · {{ kindLabel(img.kind) }}</div>
          <div class="card-meta">
            <!-- UI 三批（组1/组2）：状态徽标改用共享组件 BaseTag（size=sm，12px 紧凑形态），
                 删除本地 .chip/.chip--*/.dup-badge 复制样式；「重复」统一为 warning 语义，
                 原图像无边框/音频有边框的分叉就此消除 -->
            <BaseTag v-if="isDownloaded(img.url)" size="sm" variant="success">已下载</BaseTag>
            <BaseTag v-else size="sm" variant="neutral">未下载</BaseTag>
            <BaseTag v-if="duplicateSet.has(img.key)" size="sm" variant="warning" title="感知哈希重复">重复</BaseTag>
          </div>
          <!-- "⋯"展开的详情区：完整地址 / 哈希 / 类型（原表格常驻列，现折叠） -->
          <div v-if="expandedKey === img.key" class="card-detail">
            <div class="detail-row">
              <span class="detail-label">地址</span>
              <a class="detail-url" :href="img.url" target="_blank" rel="noreferrer">{{ img.url }}</a>
            </div>
            <div class="detail-row">
              <span class="detail-label">哈希</span>
              <span class="hash">{{ img.phash ? img.phash.slice(0,16) : '等待计算' }}</span>
              <BaseButton size="sm" variant="ghost" @click="copyLink(img.url)">复制链接</BaseButton>
            </div>
          </div>
        </div>
        <div class="card-side">
          <BaseButton size="sm" :disabled="processedKeys.has(img.key) || isDownloaded(img.url)" @click="downloadSingle(img)">
            {{ isDownloaded(img.url) ? '已下载' : (processedKeys.has(img.key) ? '已加入' : '下载') }}
          </BaseButton>
          <BaseButton
            size="sm"
            variant="ghost"
            :title="expandedKey === img.key ? '收起详情' : '查看详情（地址/哈希）'"
            :aria-expanded="expandedKey === img.key"
            @click="toggleExpand(img.key)"
          >⋯</BaseButton>
        </div>
      </article>
      <div v-if="!pagedImages.length" class="empty-row">
        {{ loading ? '扫描中…' : (images.length ? '当前过滤条件下没有图片' : '未检测到图片资源') }}
        <!-- UI 二批之二：网站目录不再是独立 tab，扫描无结果时提供入口链接（仅列表为空时显示，过滤为空不打扰） -->
        <button
          v-if="!loading && !images.length"
          type="button"
          class="catalog-entry"
          @click="$emit('open-site-catalog')"
        >从网站目录选择站点打开 →</button>
      </div>
    </div>

    <!-- 分页控件（P2-2 既有能力，卡片化后原样保留）：仅当过滤结果超过单页容量时显示 -->
    <div class="pager" v-if="displayImages.length > PAGE_SIZE">
      <BaseButton size="sm" variant="ghost" :disabled="page <= 1" @click="page = 1">首页</BaseButton>
      <BaseButton size="sm" variant="ghost" :disabled="page <= 1" @click="page--">上一页</BaseButton>
      <span class="pager__info">第 {{ page }} / {{ totalPages }} 页 · 共 {{ displayImages.length }} 条</span>
      <BaseButton size="sm" variant="ghost" :disabled="page >= totalPages" @click="page++">下一页</BaseButton>
      <BaseButton size="sm" variant="ghost" :disabled="page >= totalPages" @click="page = totalPages">末页</BaseButton>
    </div>
  </BaseCard>
</template>

<script lang="ts">
// UI 三批（组1）：新增共享组件 RestrictedBanner（受限横幅唯一实现）与 BaseTag（状态徽标唯一实现），
// 替换本面板模板中的复制版横幅与 .chip/.dup-badge 徽标
import { BaseButton, BaseCard, BaseSearchBar, RestrictedBanner, BaseTag } from '../components/base';
// UI 三批（组6）：面板标题集中术语常量（PANEL_TITLES.image = 「图片抓取」），与分段 tab「图片」同源
import { PANEL_TITLES } from '../utils/terminology';
import { GLOBAL_SHORTCUT_HINT } from '../utils/shortcutHints';
import { defineComponent, onMounted, onBeforeUnmount, reactive, ref, computed, watch } from 'vue';
import { useListSearch } from '../composables/useListSearch';
import { useRowHighlight } from '../composables/useRowHighlight';
import { useResourceCounts } from '../composables/useResourceCounts';
import { buildUnifiedMediaKey, computePerceptualHash, normalizeUrlForKey } from '@/utils/mediaKeys';
// 评审（UI 二批之一）：分页切片/页码钳制/过滤判定/重复项操作/防抖统一走共享纯函数模块，
// 避免与音频/视频面板重复实现，且可被 tests/unit 直接覆盖
import {
  slicePage, clampPage, matchesImageFilter, hideRedundantDuplicates,
  collectDuplicateKeys, createDebounce, summarizeReasons, carryForwardPhash
} from '../utils/listAdapt';
import { markProcessed, isProcessed, initializeRegistry, registrySnapshot } from '../composables/useMediaRegistry';
import { loadState, saveState } from '../services/persist';
import { loadSettings } from '../services/settings';
import { addDownload, subscribe, retryDownload, cancelDownload, type DownloadTask } from '../services/downloadQueue';
import { loadHistory, isDownloaded } from '../services/downloadHistory';
import { exportRowsAsJSON, exportRowsAsCSV } from '../services/exportList';
import { addToBasket } from '../services/collection';
import { toast } from '../composables/useToast';
// 评审 P0（UI 第一批）：清空扫描结果为破坏性操作，复用全局确认对话框，不另造
import { confirmDialog } from '../composables/useConfirm';
import { startFrameCapture, stopFrameCapture, isFrameCaptureActive, getFrameIntervalSeconds, type CapturedFrame } from '../services/frameCapture';
import { getActiveTabInfo, sendMessageToTab, ensureContentConnected, getAllFramesInfo, getAllFrameIds, isReceivingEndMissingError, type FrameInfo } from '../utils/chromeMessaging';
import { getRestrictedPageMessage } from '../utils/restrictedPages';
import { isResourceUpdateFromBoundSource } from '../utils/resourceUpdate';
import { MessageType } from '@/messaging';
// P1-8：分级日志（扩展页面上下文默认 info 级）
import { createLogger } from '@/utils/logger';

/** 本模块 logger：保留原 `[ImageGrabPanel]` 前缀语义 */
const log = createLogger('ImageGrabPanel');

interface RawImageItem {
  url: string;
  width: number;
  height: number;
  kind: string;
  phash?: string;
  key: string;
}

/**
 * 感知哈希重复分组增量计数器（P2-2）。
 * 旧实现是 computed：每次图片列表变化都对全表做两遍 phash.slice(0,16) 计数，
 * 大列表下开销明显。本类改为增量维护：
 * - 内部维护「哈希前缀 -> key 集合」与「key -> 哈希前缀」两张映射；
 * - add/remove 只触碰受影响的分组，单次操作 O(1)；
 * - 重复 key（分组规模 >=2）随映射变化增量更新，调用方再同步到响应式 Set。
 * 纯逻辑类，不依赖 Vue/DOM，导出供 tests/unit 单测复用。
 */
export class PhashDuplicateTracker {
  /** 哈希前缀（前 16 位）-> 拥有该前缀的 key 集合 */
  private prefixKeys = new Map<string, Set<string>>();
  /** key -> 当前登记的哈希前缀（用于变更时先撤销旧贡献） */
  private keyPrefix = new Map<string, string>();
  /** 当前处于重复分组（规模 >=2）中的 key 集合 */
  private dups = new Set<string>();

  /**
   * 登记某个 key 的感知哈希。
   * phash 为空时等价于移除该 key 的贡献；重复调用幂等（先撤旧再登记）。
   * @param key 图片统一标识 key
   * @param phash 感知哈希十六进制串（可缺省）
   */
  add(key: string, phash?: string): void {
    this.remove(key); // 先撤销旧贡献，覆盖「哈希从无到有 / 从 A 到 B」两种变更
    if (!phash) return;
    const prefix = phash.slice(0, 16);
    let group = this.prefixKeys.get(prefix);
    if (!group) { group = new Set(); this.prefixKeys.set(prefix, group); }
    group.add(key);
    this.keyPrefix.set(key, prefix);
    if (group.size === 2) {
      // 规模 1->2：整组首次进入重复状态，补登记另一名成员
      group.forEach(k => this.dups.add(k));
    } else if (group.size > 2) {
      this.dups.add(key);
    }
  }

  /**
   * 移除某个 key 的哈希贡献（列表项被删除/换 key 时调用）。
   * @param key 图片统一标识 key
   */
  remove(key: string): void {
    this.dups.delete(key);
    const prefix = this.keyPrefix.get(key);
    if (!prefix) return;
    this.keyPrefix.delete(key);
    const group = this.prefixKeys.get(prefix);
    if (!group) return;
    group.delete(key);
    if (group.size < 2) {
      // 规模 2->1：剩余成员不再属于重复组
      group.forEach(k => this.dups.delete(k));
    }
    if (group.size === 0) this.prefixKeys.delete(prefix);
  }

  /** 判断某 key 当前是否处于重复分组 */
  isDuplicate(key: string): boolean { return this.dups.has(key); }

  /** 当前重复 key 集合的只读快照（调用方同步到响应式 Set 用） */
  duplicates(): ReadonlySet<string> { return this.dups; }

  /** 重置全部状态（列表整体清空时使用） */
  clear(): void { this.prefixKeys.clear(); this.keyPrefix.clear(); this.dups.clear(); }
}

export default defineComponent({
  name: 'ImageGrabPanel',
  // UI 三批（组1）：注册共享组件 RestrictedBanner / BaseTag（Options API 需在 components 中声明）
  components: { BaseButton, BaseCard, BaseSearchBar, RestrictedBanner, BaseTag },
  // UI 二批之二：网站目录降级为抓取空状态入口后，本面板通过该事件请求容器打开目录覆盖层
  emits: ['open-site-catalog'],
  setup() {
    const { setCount } = useResourceCounts();
    const loading = ref(false);
    const error = ref<string | null>(null);
    const lastAction = ref('');
    // 评审（UI 二批之一）问题 4：宽高过滤拆为「输入态 / 生效态」两层——
    // 输入框直接绑 minWidthInput/minHeightInput；300ms 防抖后才写入 minWidth/minHeight，
    // displayImages computed 只依赖生效态，避免逐键过滤导致列表在输入中途反复闪变。
    const minWidthInput = ref(0);
    const minHeightInput = ref(0);
    const minWidth = ref(0);
    const minHeight = ref(0);
    const kindFilter = ref<string>('');
    const filterDownloadStatus = ref<'all'|'downloaded'|'new'>('all');
    // 评审（UI 二批之一）问题 3：「隐藏重复」开关（会话级，不持久化）
    const hideDuplicates = ref(false);
    // 评审（UI 二批之一）问题 1：当前展开"⋯"详情的卡片 key（单开模式，避免窄屏堆叠过长）
    const expandedKey = ref<string | null>(null);
    const sortKey = ref<string>(''); // width|height|phash|url
    const sortDir = ref<'asc'|'desc'>('asc');
    const searchKit = useListSearch({
      onRefresh: () => refreshImages(),
      selectAll: () => { selected.clear(); displayImages.value.forEach(i => selected.add(i.key)); scheduleSave(); },
      clearSelection: () => { selected.clear(); scheduleSave(); },
      invertSelection: () => { const all = displayImages.value.map(i => i.key); const next = new Set<string>(); all.forEach(k => { if(!selected.has(k)) next.add(k); }); selected.clear(); next.forEach(k => selected.add(k)); scheduleSave(); },
      selectNew: () => { newHighlightSet.forEach(k => { if(typeof k === 'string') selected.add(k); }); scheduleSave(); }
    });
    // 评审（UI 二批之一）问题 4：images 语义调整为「完整扫描结果（未过滤）」。
    // 旧实现把过滤结果写回 images，导致过滤是破坏性的——放宽条件后图片不会回来，
    // 必须重新扫描。改为即时过滤后该缺陷会被放大（用户输入一个数字就永久丢数据），
    // 因此过滤/隐藏重复/排序全部下沉到 displayImages computed，images 只承载原始扫描结果。
    const images = ref<RawImageItem[]>([]);

    // ── 重复检测增量状态（P2-2）──
    // 替代旧 computed 全表重算：tracker 只做 O(1) 增量维护，duplicateSet 仅在变化时同步。
    // 评审（UI 二批之一）：tracker 现基于「完整扫描结果」维护（而非过滤视图），
    // 保证隐藏重复/过滤切换不会改变重复判定本身，也不会出现组规模振荡。
    const dupTracker = new PhashDuplicateTracker();
    // 响应式重复 key 集合，模板与 getCardClass 通过 duplicateSet.has 访问
    const duplicateSet = reactive(new Set<string>());
    /** 把 tracker 的增量结果同步到响应式 Set（规模仅为重复项数量，成本远低于全表重算） */
    function syncDuplicateSet() {
      duplicateSet.clear();
      dupTracker.duplicates().forEach(k => duplicateSet.add(k));
    }
    /**
     * 统一提交完整扫描结果：替换数组并按 key 差异增量更新重复检测状态。
     * 所有对 images.value 的整表替换都应经由本函数，保证 tracker 与列表一致。
     * @param next 新的完整图片列表（未过滤；过滤在 displayImages computed 中进行）
     */
    function commitImages(next: RawImageItem[]) {
      const prev = images.value;
      const prevByKey = new Map(prev.map(i => [i.key, i]));
      const changed = carryForwardPhash(next, prevByKey);
      const nextKeys = new Set(next.map(i => i.key));
      // 整表替换放在补哈希之后：避免逐项写入响应式数组触发 N 次依赖更新
      images.value = next;
      changed.forEach(it => dupTracker.add(it.key, it.phash));
      for (const it of prev) {
        if (!nextKeys.has(it.key)) dupTracker.remove(it.key);
      }
      syncDuplicateSet();
    }

    // 新增高亮集合统一封装 (UX-INCR-HINT-001)
    const { newSet: newHighlightSet, removedSet: removedHighlightSet, markNew: markImageNew, markRemoved: markImageRemoved } = useRowHighlight({ ttlNew: 2500, ttlRemoved: 900 });
    const ephemeralRemovedImages = reactive<Record<string, RawImageItem>>({});
    /**
     * 过滤视图：完整扫描结果 + 短暂保留的"已移除"项，依次经过
     * 条件过滤（matchesImageFilter）与隐藏重复（hideRedundantDuplicates），最后排序。
     * 全选/导出/分页均作用于本 computed，保持"作用于完整过滤结果"的既有语义。
     */
    const displayImages = computed(() => {
      const base = images.value.slice();
      Object.keys(ephemeralRemovedImages).forEach(k => { if (!base.find(i => i.key === k)) base.push(ephemeralRemovedImages[k]); });
      return applyFilterInternal(base);
    });
    /** 过滤后条数（状态行展示"过滤后 N 张"用） */
    const filteredCount = computed(() => displayImages.value.length);

    // ── 分页渲染（P2-2）：依赖 displayImages，必须声明在其后 ──
    const PAGE_SIZE = 60; // 每页渲染卡片数：兼顾滚动连续性与单页 DOM 规模
    const page = ref(1); // 当前页码（1 起）
    const totalPages = computed(() => Math.max(1, Math.ceil(displayImages.value.length / PAGE_SIZE)));
    /** 当前页要渲染的卡片切片：只渲染本页，避免整表重渲染（共享纯函数 slicePage） */
    const pagedImages = computed(() => slicePage(displayImages.value, page.value, PAGE_SIZE));
    // 过滤/刷新后列表变短：页码越界时自动钳制到最后一页（共享纯函数 clampPage）
    watch(displayImages, () => {
      page.value = clampPage(page.value, displayImages.value.length, PAGE_SIZE);
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
    // 全选语义：作用于完整过滤结果（displayImages），与导出/批量下载口径一致
    const allSelected = computed(() => displayImages.value.length > 0 && displayImages.value.every(i => selected.has(i.key)));

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
    let boundTabId: number | null = null; // 当前图片列表绑定的来源 tabId（增量更新按 tab 过滤，防后台标签页串扰）
    async function refreshImages() {
      loading.value = true; error.value = null; lastAction.value='';
      try {
        // 优先从页面内容脚本获取
        try {
          const tabId = await ensureActiveTab();
          if (!tabId) throw new Error('无活动标签页');
          boundTabId = tabId;
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
            // 提交完整扫描结果；过滤由 displayImages computed 即时派生（问题 4：不再破坏性过滤）
            commitImages(mapped);
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
                boundTabId = tabId;
                boundFrameId = 0; // 重试走顶层获取，绑定随之回到主页面
                // 重试一次顶层获取（简化）
                const retry = await sendMessageToTab<{ success: boolean; items?: any[]; error?: string }>(tabId, { type: MessageType.REQUEST_IMAGE_LIST });
                if (retry?.success && Array.isArray(retry.items)) {
                  const mapped2 = retry.items.map((it:any)=>({ url: it.url, width: it.width||0, height: it.height||0, kind: String(it.kind||'img'), key: buildUnifiedMediaKey({ url: it.url, width: it.width||0, height: it.height||0, kind: String(it.kind||'img') }) }));
                  commitImages(mapped2);
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
          commitImages(scanned);
        }
        setCount('image', images.value.length);
        lastAction.value = images.value.length ? `获取 ${images.value.length} 张图片` : '无图片';
        selected.clear();
        scheduleSave();
      } catch (e: any) {
        if (!restrictedHint.value) { error.value = e?.message || '扫描失败'; }
        commitImages([]); setCount('image',0); selected.clear();
      } finally { loading.value=false; }
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
        try { frames.value = await getAllFramesInfo(tabId); } catch { /* noop */ }
        await refreshImages();
      }catch(e:any){ error.value = e?.message || '修复扫描失败，请刷新页面后重试'; }
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
    /** 子页面下拉标签（评审问题 6：去掉"帧"术语，改为用户可理解的"子页面"） */
    function formatFrameLabel(f: FrameInfo){
      const id = f.frameId; let host='';
      try{ if(f.url){ const u=new URL(f.url); host = u.hostname.replace(/^www\./,'') + (u.pathname && u.pathname!=='/' ? ' · ' + (u.pathname.length>20 ? (u.pathname.slice(0,20)+'…') : u.pathname) : ''); } }catch { /* noop */ }
      return host? `子页面 #${id} ${host}` : `子页面 #${id}`;
    }

    /** 资源类型中文标签（评审问题 6：img/background/source/frame 等开发者词转用户词） */
    function kindLabel(kind: string): string {
      switch (kind) {
        case 'img': return '图片';
        case 'background': return '背景图';
        case 'source': return '响应式图';
        case 'frame': return '视频帧';
        default: return kind || '图片';
      }
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

    /**
     * 应用过滤（评审问题 4）：过滤条件全部即时生效，本函数只做提示/持久化，
     * 列表由 displayImages computed 自动派生，不再把过滤结果写回 images（避免破坏性过滤）。
     */
    function applyFilter() {
      lastAction.value = '已应用过滤';
      scheduleSave();
    }

    /** 「重置」入口：宽高/状态/隐藏重复条件全部回到默认（输入态与生效态同步重置） */
    function resetFilter() {
      minWidthInput.value = 0;
      minHeightInput.value = 0;
      minWidth.value = 0;
      minHeight.value = 0;
      filterDownloadStatus.value = 'all';
      hideDuplicates.value = false;
      applyFilter();
      log.info('过滤条件已重置');
    }

    /**
     * 过滤 + 隐藏重复 + 排序的内部实现（纯派生，无副作用）。
     * 隐藏重复复用 duplicateSet（PhashDuplicateTracker 增量判定结果），
     * 按哈希前缀分组每组保留首个代表，不重算哈希。
     * @param list 完整列表（含短暂保留的已移除项）
     */
    function applyFilterInternal(list: RawImageItem[]): RawImageItem[] {
      const criteria = {
        minWidth: minWidth.value,
        minHeight: minHeight.value,
        kind: kindFilter.value,
        downloadStatus: filterDownloadStatus.value,
        query: searchKit.searchQuery.value
      };
      let out = list.filter(i => matchesImageFilter(i, criteria, isDownloaded));
      if (hideDuplicates.value) {
        out = hideRedundantDuplicates(out, i => i.key, i => i.phash ? i.phash.slice(0, 16) : null, duplicateSet);
      }
      return sortItems(out);
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
    function toggleSort(key: string){
      if(sortKey.value!==key){ sortKey.value=key; sortDir.value='asc'; }
      else { sortDir.value = sortDir.value==='asc' ? 'desc' : 'asc'; }
      scheduleSave();
    }

    /** 全选/取消全选：作用于完整过滤结果（displayImages），而非仅当前页 */
    function handleSelectAll(checked: boolean) {
      if (checked) { selected.clear(); displayImages.value.forEach((i) => selected.add(i.key)); }
      else { selected.clear(); }
      scheduleSave();
    }

    function handleRowSelect(key: string) {
      if (selected.has(key)) selected.delete(key);
      else selected.add(key);
      scheduleSave();
    }

    /** 「⋯」详情展开切换：单开模式，再次点击同一卡片收起 */
    function toggleExpand(key: string) {
      expandedKey.value = expandedKey.value === key ? null : key;
    }

    /**
     * 选中全部重复项（评审问题 3）：把过滤结果中命中 duplicateSet 的项加入勾选，
     * 便于随后批量取消或对比查看。判定完全复用 tracker 结果，不重算哈希。
     */
    function selectDuplicates() {
      const keys = collectDuplicateKeys(displayImages.value, i => i.key, duplicateSet);
      if (!keys.length) { toast.info('当前没有可选择的重复图片（哈希可能仍在计算）'); return; }
      keys.forEach(k => selected.add(k));
      scheduleSave();
      lastAction.value = `已选中 ${keys.length} 个重复项`;
      log.info(`选中重复项 ${keys.length} 个`);
    }

    /** 取消选中全部重复项（评审问题 3）：从勾选集合移除重复命中项，保留其余选择 */
    function deselectDuplicates() {
      const keys = collectDuplicateKeys(displayImages.value, i => i.key, duplicateSet);
      keys.forEach(k => selected.delete(k));
      scheduleSave();
      lastAction.value = keys.length ? `已取消选中 ${keys.length} 个重复项` : '没有重复项处于选中状态';
      log.info(`取消选中重复项 ${keys.length} 个`);
    }

    /** 清空扫描结果列表（内部动作：提交空列表、清除选择与计数、持久化） */
    function clearList(){ commitImages([]); selected.clear(); setCount('image',0); scheduleSave(); }

    /**
     * "清空"按钮入口（评审 P0：破坏性操作补确认）：
     * 先弹确认框说明后果（清空当前扫描结果与勾选，已下载文件不受影响），
     * 确认后才执行 clearList；取消则不做任何操作。
     */
    async function confirmClearList(){
      const ok = await confirmDialog({
        title: '清空图片扫描结果',
        message: `将清空当前页面的 ${images.value.length} 条扫描结果与全部勾选（已下载的文件不受影响）；如需重新获取可再次扫描。`,
        danger: true,
        confirmText: '清空',
      });
      if (!ok) return;
      clearList();
    }

    /** 单张下载：入队成功后即时反馈；失败给出可行动提示（评审问题 5） */
    async function downloadSingle(img: RawImageItem){
      if(isProcessed(img.key)) return;
      try {
        const id = await addDownload(img.url, undefined, 'image', MessageType.DIRECT_DOWNLOAD_GENERIC);
        if (!id) throw new Error('队列创建失败');
        markProcessed(img.key); processedKeys.add(img.key);
        lastAction.value='已加入队列';
        toast.success('已加入下载队列');
      } catch (e: any) {
        log.error(`单张下载入队失败: ${img.url}`, e);
        toast.error(`加入下载队列失败：${String(e?.message || e)}`);
      }
    }

    /**
     * 批量下载（评审问题 5）：逐条等待入队结果并统计失败原因，
     * 完成后用 Toast 汇总「已加入 N 条，M 条失败：原因」，替代旧 11px 小字。
     */
    async function downloadSelected(){
      let ok = 0;
      /** 失败原因清单（用于汇总展示，去重后取前两类） */
      const reasons: string[] = [];
      for (const key of Array.from(selected)) {
        // 只作用于过滤结果中可见的项（与导出/全选口径一致），
        // 被过滤隐藏的残留勾选不参与批量下载
        const img = displayImages.value.find(i=>i.key===key);
        if(!img || isProcessed(img.key)) continue;
        try {
          const id = await addDownload(img.url, undefined, 'image', MessageType.DIRECT_DOWNLOAD_GENERIC);
          if (!id) throw new Error('队列创建失败');
          markProcessed(img.key); processedKeys.add(img.key);
          ok++;
        } catch (e: any) {
          reasons.push(String(e?.message || e));
        }
      }
      const fail = reasons.length;
      lastAction.value = fail ? `已加入 ${ok} 条，${fail} 条失败` : `已加入 ${ok} 条`;
      if (fail) toast.error(`已加入 ${ok} 条，${fail} 条失败：${summarizeReasons(reasons)}`);
      else if (ok) toast.success(`已加入下载队列 ${ok} 条`);
      else toast.info('没有可下载项（均已加入队列或已下载）');
      log.info(`批量下载完成：成功 ${ok} 条，失败 ${fail} 条`);
    }

    /**
     * 图片加载完成后计算感知哈希并增量登记重复检测（不触发全表重算）。
     * key 是不含哈希的稳定身份，此处只补 phash、绝不改 key：
     * 改 key 会让 selected / loadedMap / processedKeys 与 v-for :key 全部错位，
     * 表现为缩略图加载完就变空白、勾选与"已加入"标记凭空消失。
     */
    function onImgLoad(img: RawImageItem){
      if(!img.phash){
        try {
          img.phash = computePerceptualHash((event!.target as HTMLImageElement));
          dupTracker.add(img.key, img.phash);
          syncDuplicateSet();
        } catch (_) { /* noop */ }
      }
    }
    function copyLink(url: string){ navigator.clipboard.writeText(url).then(()=> { lastAction.value='已复制链接'; toast.success('已复制链接'); }).catch(()=> error.value='复制失败'); }

    /**
     * 接收帧捕获服务注入的图片。
     * P0-6：提升为 setup 作用域的命名函数，使 onBeforeUnmount 能以同一引用移除监听，
     * 修复切换 Tab 反复挂载导致监听器叠加的泄漏。
     */
    const onAddFrameImage = (evt: Event) => {
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
      // 新帧图片暂无哈希，登记后由 onImgLoad 补算；add 对空哈希为幂等忽略
      dupTracker.add(item.key, item.phash);
      syncDuplicateSet();
      setCount('image', images.value.length);
      // UI 三批（组6）：用户可见文案「图像」统一为「图片」（lastAction 会展示在状态行）
      lastAction.value = '新增帧图片';
    };

    /**
     * 监听标签页切换：自动重新检测受限状态并刷新。
     * P0-6：提升为 setup 作用域命名函数，保证注册/注销对称。
     */
    const onTabActivated = async () => {
      await updateRestrictedHint();
      if (!restrictedHint.value) {
        error.value = null;
        await refreshImages();
      }
    };

    // 评审（UI 二批之一）问题 4：宽高输入即时生效防抖器（300ms），
    // 连续输入只在停止后把输入态提交为生效态并应用一次过滤；
    // 组件卸载时 cancel 防止泄漏触发。
    const filterDebounce = createDebounce(() => {
      // 非法/负数输入按 0（不限制）处理，v-model.number 可能产出 NaN
      minWidth.value = Math.max(0, Math.floor(Number(minWidthInput.value) || 0));
      minHeight.value = Math.max(0, Math.floor(Number(minHeightInput.value) || 0));
      applyFilter();
    }, 300);
    watch([minWidthInput, minHeightInput], () => { filterDebounce.run(); });

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
          // 恢复持久化的宽高过滤：输入态与生效态同步写入（立即生效，无需再防抖）
          if(typeof imageFilters.minWidth === 'number'){ minWidth.value = imageFilters.minWidth; minWidthInput.value = imageFilters.minWidth; }
          if(typeof imageFilters.minHeight === 'number'){ minHeight.value = imageFilters.minHeight; minHeightInput.value = imageFilters.minHeight; }
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
        const handler: Parameters<typeof chrome.runtime.onMessage.addListener>[0] = (message, sender) => {
          if (!message || !message.type) return;
          if (message.type === MessageType.RESOURCE_UPDATE) {
            try {
              const payload: any = (message as any).payload || {};
              // tab + frame 双守卫：payload 只带 frameId，tabId 取自 sender，
              // 否则后台标签页（同为顶层 frame 0）的增量会覆盖当前列表
              if (isResourceUpdateFromBoundSource(sender, payload, { tabId: boundTabId, frameId: boundFrameId }) && Array.isArray(payload.images)) {
                const diff = payload.diff?.images;
                if (diff?.removed?.length) {
                  diff.removed.forEach((k: string) => {
                    const ex = images.value.find(i => i.key === k);
                    if (ex) { ephemeralRemovedImages[k] = { ...ex }; }
                  });
                  markImageRemoved(diff.removed);
                  window.setTimeout(() => { diff.removed.forEach((k: string) => { delete ephemeralRemovedImages[k]; }); }, 900);
                }
                const mapped: Array<{ url: string; width: number; height: number; kind: string; key: string }> = payload.images.map((it: any) => ({ url: it.url, width: it.width||0, height: it.height||0, kind: String(it.kind||'img'), key: buildUnifiedMediaKey({ url: it.url, width: it.width||0, height: it.height||0, kind: String(it.kind||'img') }) }));
                if (diff?.added?.length) {
                  const addedKeys = diff.added.map((img: any) => buildUnifiedMediaKey({ url: img.url, width: img.width||0, height: img.height||0, kind: String(img.kind||'img') }));
                  if (addedKeys.length) markImageNew(addedKeys);
                } else {
                  const prev = new Set(images.value.map(i=> i.key));
                  const added = mapped.filter(i => !prev.has(i.key)).map(i => i.key);
                  if (added.length) markImageNew(added);
                }
                // 提交完整列表（未过滤），过滤视图由 computed 自动派生
                commitImages(mapped);
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
      // 接收帧捕获服务注入的图片（P0-6：使用 setup 作用域命名引用，保证可对称移除）
      window.addEventListener('sidepanel:add-frame-image', onAddFrameImage);

      // 监听标签页切换：自动重新检测受限状态并刷新（P0-6：命名引用，可对称移除）
      if (chrome?.tabs?.onActivated?.addListener) {
        chrome.tabs.onActivated.addListener(onTabActivated);
      }
      // 注册全局快捷键（P0-6：与 onBeforeUnmount 的 searchKit.unregister 对称）
      searchKit.register();
      // 加载设置（快捷键提示开关）
      try { const s = await loadSettings(); showShortcutHints.value = s.showShortcutHints; } catch { /* noop */ }
    });

    onBeforeUnmount(()=>{
      if(unsubscribeQueue) { unsubscribeQueue(); unsubscribeQueue=null; }
      if(countdownTimer){ clearInterval(countdownTimer); countdownTimer = null; }
      if(removeRuntimeListener){ removeRuntimeListener(); removeRuntimeListener=null; }
      // P0-6 泄漏修复：移除帧图片注入监听（原实现遗漏，切 Tab 反复挂载会叠加）
      window.removeEventListener('sidepanel:add-frame-image', onAddFrameImage);
      // P0-6 泄漏修复：移除标签页激活监听（原实现遗漏）
      if (chrome?.tabs?.onActivated?.removeListener) {
        chrome.tabs.onActivated.removeListener(onTabActivated);
      }
      // P0-6 泄漏修复：注销全局快捷键（原实现遗漏，useListSearch 提供了 unregister 却从未调用）
      searchKit.unregister();
      // P0-6 泄漏修复：断开懒加载 IntersectionObserver，释放对行元素的引用
      if (io) { io.disconnect(); io = null; }
      // 评审（UI 二批之一）：取消未触发的防抖过滤，避免卸载后定时器空转
      filterDebounce.cancel();
      log.debug('卸载：已对称清理全部监听器/订阅/观察器/防抖定时器');
    });

    // 重复集合 duplicateSet 已改为 setup 顶部的响应式 Set + PhashDuplicateTracker 增量维护（P2-2）

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
    function invertImageSelection(){ const all = displayImages.value.map(i=> i.key); const next = new Set<string>(); all.forEach(k=>{ if(!selected.has(k)) next.add(k); }); selected.clear(); next.forEach(k=> selected.add(k)); scheduleSave(); }
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

    /** 卡片状态类：沿用原表格行高亮语义（重复/新增/移除），改挂到卡片容器 */
    function getCardClass(img: RawImageItem) {
      return {
        'card-duplicate': duplicateSet.has(img.key),
        'card-new': newHighlightSet.has(img.key),
        'card-removed': removedHighlightSet.has(img.key)
      };
    }

    // ===== 收集篮 =====
    /** 批量加入收集篮（评审问题 5）：汇总新增与"已在篮中"数量，Toast 反馈 */
    async function addSelectedToBasket() {
      const items = displayImages.value
        .filter(i => selected.has(i.key))
        .map(i => ({ kind: 'image' as const, url: i.url, width: i.width, height: i.height }));
      const valid = items.filter(i => i.url);
      const n = await addToBasket(valid);
      const skipped = valid.length - n;
      if (n > 0) toast.success(skipped > 0 ? `已加入收集篮 ${n} 项，${skipped} 项已在篮中` : `已加入收集篮 ${n} 项`);
      else toast.info('选中项均已在收集篮中');
      log.info(`加入收集篮：新增 ${n} 项，跳过 ${skipped} 项`);
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

    // UI 三批（组6）：PANEL_TITLES 放入 setup 返回值，供模板绑定 :title="PANEL_TITLES.image"
    return { PANEL_TITLES, displayImages, pagedImages, page, totalPages, PAGE_SIZE, images, filteredCount, exportJson, exportCsv, newHighlightSet, removedHighlightSet, loading, error, lastAction, minWidth, minHeight, minWidthInput, minHeightInput, kindFilter, filterDownloadStatus, hideDuplicates, expandedKey, sortKey, sortDir, selectedCount, hasSelection, allSelected, processedKeys, loadedMap, duplicateSet, refreshImages, handleSelectAll, handleRowSelect, toggleExpand, selectDuplicates, deselectDuplicates, resetFilter, selected, applyFilter, downloadSelected, downloadSingle, addSelectedToBasket, copyLink, kindLabel, confirmClearList, setObserverRef, toggleSort, onImgLoad, ensureBusy, ensureConnectAndRefresh, frameMode, frames, frameModeValue, onFrameModeChange, formatFrameLabel, queueTasks, retryTask, cancelTask, frameInterval, frameCaptureActive, frameToggleBusy, nextTickCountdown, toggleFrameCapture, restrictedHint, imageSearchQuery: searchKit.searchQuery, imageSearchInputEl: searchKit.searchInputRef, focusImageSearch, invertImageSelection, selectNewImages, shortcutHint, showShortcutHints, getCardClass, isDownloaded };
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
  /* UI 三批（组2）：倒计时提示属状态信息，11px → 12px（表单标注 interval-label 仍留 11px） */
  font-size: 12px;
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

/* 隐藏重复开关：与过滤条其他控件同高，accent-color 走主色 token */
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

/* 列表头部（状态行 + 搜索）：对齐原 base-table__toolbar 的视觉，复用 token */
.list-toolbar {
  padding: 8px 10px;
  border: 1px solid var(--sp-color-border);
  border-bottom: none;
  border-radius: var(--sp-radius-lg) var(--sp-radius-lg) 0 0;
  background: var(--sp-color-surface);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  flex-wrap: wrap;
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

/* UI 三批（组2）：状态行文字属信息性内容，11px → 12px */
.status { font-size: 12px; color: var(--sp-color-muted); }
.status--error { color: var(--sp-color-danger); }

/* UI 三批（组1）：原 .restricted-banner/.banner-close/.banner-icon/.banner-hint 复制版样式
   已删除，横幅视觉唯一实现收敛在共享组件 RestrictedBanner 内部 */

/* ── 卡片列表（评审问题 1）──
   窄侧栏（300-400px）下表格 6 列必然横向滚动，改为纵向卡片流：
   勾选框 + 缩略图 + 主信息（尺寸/状态）常驻，操作固定在右侧列。 */
.card-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px;
  border: 1px solid var(--sp-color-border);
  border-radius: 0 0 var(--sp-radius-lg) var(--sp-radius-lg);
  background: var(--sp-color-bg-elevated);
  max-height: 440px;
  overflow-y: auto;
}

.image-card {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 8px;
  border: 1px solid var(--sp-color-border);
  border-radius: var(--sp-radius-md);
  background: var(--sp-color-bg-card);
  transition: background var(--sp-transition-fast), border-color var(--sp-transition-fast);
}
.image-card:hover { background: var(--sp-color-surface); border-color: var(--sp-color-border-hover); }

/* 重复卡片：沿用原 duplicate-row 的浅警示底色 */
.card-duplicate { background: rgba(245, 158, 11, 0.06); }

.card-check {
  width: 13px;
  height: 13px;
  margin-top: 4px;
  flex-shrink: 0;
  accent-color: var(--sp-color-primary);
  cursor: pointer;
}

/* UI 三批（组3）：勾选命中区 ≥24px——label 包裹 input 扩展可点区，
   负外边距抵消 24px 盒的额外占位（卡片 align-items:flex-start 下视觉位置不变），
   input 本体保持上方 13px 视觉尺寸 */
.check-hit {
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 24px;
  min-height: 24px;
  margin: -4px 0;
  flex-shrink: 0;
  cursor: pointer;
}

/* 缩略图：56×56 定宽盒。评审要求说明裁切取舍——
   原表格 72×48 cover 会把竖图裁掉上下部分；卡片化后改 contain：
   完整呈现图片构图（竖图不再失真），代价是横图/竖图盒内留白边，
   用 surface 底色 + 边框让留白看起来是有意设计。 */
.card-thumb {
  width: 56px;
  height: 56px;
  flex-shrink: 0;
  border-radius: var(--sp-radius-sm);
  overflow: hidden;
  background: var(--sp-color-surface);
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--sp-color-border);
}

.card-thumb img {
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.thumb__placeholder {
  font-size: 11px;
  color: var(--sp-color-muted);
}

.card-main {
  flex: 1;
  min-width: 0; /* 允许在窄栏内收缩，URL 等长文本靠 break-all 换行而非撑破布局 */
}

.card-title {
  font-size: 12px;
  font-weight: 500;
  color: var(--sp-color-heading);
  word-break: break-all;
}

.card-meta {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 3px;
  flex-wrap: wrap;
}

/* "⋯"展开的详情区：完整地址/哈希/复制，默认折叠 */
.card-detail {
  margin-top: 6px;
  padding: 6px 8px;
  background: var(--sp-color-bg-subtle);
  border-radius: var(--sp-radius-sm);
  /* UI 三批（组2）：详情区（地址/哈希）属信息性文字，11px → 12px */
  font-size: 12px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.detail-row {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
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

.card-side {
  display: flex;
  flex-direction: column;
  gap: 4px;
  flex-shrink: 0;
  align-items: stretch;
}

.hash {
  font-family: var(--sp-font-mono, monospace);
  /* UI 三批（组2）：哈希元信息属信息性文字，11px → 12px */
  font-size: 12px;
  color: var(--sp-color-muted);
}

/* UI 三批（组1/组2）：原 .dup-badge/.chip/.chip--success/.chip--ghost 复制版徽标样式已删除，
   「已下载/未下载/重复」状态徽标唯一实现收敛在共享组件 BaseTag（size=sm，12px） */

/* UI 二批之二：空状态「网站目录」入口（网站目录从一级 tab 降级后的引导链接） */
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
  /* UI 二批之二：改为纵向 flex，容纳空状态文案下方的「网站目录」入口链接 */
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  text-align: center;
  color: var(--sp-color-muted);
  padding: 24px;
  font-size: 12px;
}

/* 卡片新增/移除高亮：沿用原表格行动画节奏 */
.card-new { animation: rowNewFade 2.4s ease-in forwards; }
.card-removed { animation: rowRemovedFade 0.9s ease-out forwards; }

/* 分页控件（P2-2） */
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

@keyframes rowNewFade {
  0% { background: var(--sp-color-primary-glow); }
  100% { background: transparent; }
}
@keyframes rowRemovedFade {
  0% { background: rgba(239, 68, 68, 0.3); }
  100% { background: transparent; opacity: 0; }
}
</style>
