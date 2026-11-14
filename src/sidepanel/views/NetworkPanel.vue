<template>
  <BaseCard :title="PANEL_TITLES.network" subtitle="仅捕获 AJAX（XHR / Fetch）与 POST 等接口请求；图片、CSS、JS 等静态资源自动过滤">
    <!-- 捕获控制条：开始/停止、清空、导出 HAR、AI 分析 -->
    <div class="net-toolbar">
      <BaseButton size="sm" :variant="capturing ? 'danger' : 'primary'" :loading="busy" @click="toggleCapture">
        {{ capturing ? '停止捕获' : '开始捕获' }}
      </BaseButton>
      <BaseButton size="sm" variant="secondary" :disabled="!requests.length || busy" @click="clearAll">清空</BaseButton>
      <BaseButton size="sm" variant="secondary" :disabled="!requests.length" @click="exportHar">导出 HAR</BaseButton>
      <BaseButton size="sm" variant="outline" :loading="aiBusy" :disabled="!requests.length" @click="runAiAnalyze">AI 分析</BaseButton>
    </div>

    <!-- 过滤条：按请求类别切换 + URL/方法关键字搜索 -->
    <div class="net-filters">
      <BaseSegmented
        id-base="net-filter"
        aria-label="接口过滤"
        size="sm"
        :items="filterItems"
        :model-value="filterKind"
        @update:model-value="onFilterChange"
      />
      <input
        v-model="keyword"
        class="net-search"
        type="search"
        placeholder="搜索 URL / 方法"
        aria-label="搜索接口"
      />
    </div>

    <!-- 状态行：捕获开关、条数、错误提示 -->
    <p class="net-hint">
      <span class="net-hint__state" :class="{ 'is-active': capturing }">{{ capturing ? '● 捕获中' : '○ 未开始' }}</span>
      <span>共 {{ requests.length }} 条<template v-if="visibleRequests.length !== requests.length">，显示 {{ visibleRequests.length }} 条</template></span>
      <span v-if="error" class="net-hint__error">{{ error }}</span>
    </p>

    <!-- 请求列表：点击某行加载完整详情（含响应体） -->
    <ul v-if="visibleRequests.length" class="net-list" aria-label="接口请求列表">
      <li
        v-for="item in visibleRequests"
        :key="item.id"
        class="net-row"
        :class="{ 'is-selected': item.id === selectedId }"
        role="button"
        tabindex="0"
        :aria-label="`查看 ${item.method} ${item.url} 的详情`"
        @click="openDetail(item)"
        @keydown.enter.prevent="openDetail(item)"
        @keydown.space.prevent="openDetail(item)"
      >
        <span class="net-method" :class="`net-method--${item.method.toLowerCase()}`">{{ item.method }}</span>
        <span class="net-code" :class="statusClass(item)">{{ item.status || (item.error ? '失败' : '—') }}</span>
        <span class="net-url" :title="item.url">{{ shortUrl(item.url) }}</span>
        <span class="net-meta">{{ displayType(item) }}<template v-if="sizeLabel(item)"> · {{ sizeLabel(item) }}</template><template v-if="item.durationMs"> · {{ item.durationMs }}ms</template></span>
      </li>
    </ul>

    <!-- 空状态：区分「未开始」「捕获中」「过滤后无结果」三种文案 -->
    <div v-else class="net-empty">
      <div class="net-empty__icon">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 17l6-6-6-6"/><path d="M12 19h8"/></svg>
      </div>
      <p class="net-empty__text">{{ emptyText }}</p>
      <p class="net-empty__tip">捕获依赖 Chrome 调试器，页面顶部会出现调试横幅；开始前请关闭该页面的 DevTools。</p>
    </div>

    <!-- 详情面板：请求头 / 请求体 / 响应头 / 响应体（JSON 自动格式化） -->
    <div v-if="detail" class="net-detail">
      <div class="net-detail__head">
        <span class="net-method" :class="`net-method--${detail.method.toLowerCase()}`">{{ detail.method }}</span>
        <span class="net-detail__url" :title="detail.url">{{ detail.url }}</span>
        <BaseButton size="xs" variant="ghost" @click="closeDetail">关闭</BaseButton>
      </div>
      <div class="net-detail__meta">
        <span>状态：{{ detail.status || (detail.error ? detail.error : '—') }}</span>
        <span>类型：{{ detail.mimeType || detail.resourceType || '未知' }}</span>
        <span>大小：{{ sizeLabel(detail) || '—' }}</span>
        <span>耗时：{{ detail.durationMs ? `${detail.durationMs}ms` : '—' }}</span>
        <span v-if="detail.bodyTruncated" class="net-warn">响应体已截断</span>
      </div>
      <div v-for="block in detailBlocks" :key="block.title" class="net-block">
        <div class="net-block__head">
          <span class="net-block__title">{{ block.title }}</span>
          <BaseButton size="xs" variant="ghost" @click="copyText(block.text)">复制</BaseButton>
        </div>
        <pre class="net-block__body">{{ block.text }}</pre>
      </div>
    </div>

    <!-- AI 分析结果：接口用途 / 业务流程 / 可关注数据 -->
    <div v-if="aiResult" class="net-ai">
      <div class="net-block__head">
        <span class="net-block__title">AI 接口分析</span>
        <BaseButton size="xs" variant="ghost" @click="copyText(aiResult)">复制</BaseButton>
      </div>
      <pre class="net-block__body">{{ aiResult }}</pre>
    </div>
  </BaseCard>
</template>

<script setup lang="ts">
/**
 * 接口抓取面板（网络请求捕获 UI）。
 *
 * 数据链路：
 *  侧栏 ──NET_CAPTURE_START/STOP/QUERY/…──► 后台 networkCapture.ts ──CDP Network 域──► 页面
 *  后台捕获到新请求/更新时用 NET_CAPTURE_UPDATE 广播回侧栏，本面板增量更新列表。
 *
 * 抓取范围由后台统一决定：XHR / Fetch、JSONP 接口型脚本与 POST 等写请求，
 * 静态图片/CSS/JS 直接丢弃（JSONP 判定口径与后台共用 shared/netFilter.isJsonpLikeUrl），
 * 本面板只负责展示、过滤、查看详情、导出与 AI 分析。
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { BaseButton, BaseCard, BaseSegmented } from '../components/base';
import { PANEL_TITLES } from '../utils/terminology';
import { useResourceCounts } from '../composables/useResourceCounts';
import { toast } from '../composables/useToast';
import { exportBlobWithTimestamp } from '../services/exportList';
import { aiAnalyzeNetwork } from '../services/aiAssist';
import { getActiveTabId } from '../utils/chromeMessaging';
import { MessageType, type CapturedRequestDTO } from '@/messaging';
// JSONP/接口型脚本判定：与后台 networkCapture 同一口径，保证"抓到的"与"展示的"一致
import { isJsonpLikeUrl } from '@/shared/netFilter';
// P1-8：分级日志（扩展页面上下文默认 info 级）
import { createLogger } from '@/utils/logger';
// 与嗅探列表同一套大小文案，避免两个面板对同一字节数显示不同
import { sizeLabelOf } from '@/core/mediaMeta';

/** 本模块 logger：记录捕获开关、详情加载、导出与 AI 分析等关键动作 */
const log = createLogger('NetworkPanel');

/** 过滤类别：全部 / 仅 AJAX / 仅写请求 / 仅失败 */
type NetFilterKind = 'all' | 'ajax' | 'write' | 'error';

/** 资源计数上下文：把当前捕获条数同步到抓取徽标 */
const { setCount } = useResourceCounts();

/** 当前正在展示的请求摘要列表（不含响应体，避免内存与消息体积膨胀） */
const requests = ref<CapturedRequestDTO[]>([]);
/** 是否处于捕获中 */
const capturing = ref(false);
/** 捕获开关请求进行中（防重复点击） */
const busy = ref(false);
/** 错误提示文案（attach 失败 / DevTools 占用等） */
const error = ref<string | null>(null);
/** 当前绑定的标签页 ID（广播按此过滤） */
const tabId = ref<number | null>(null);
/** 过滤类别 */
const filterKind = ref<NetFilterKind>('all');
/** 搜索关键字（匹配 URL 与请求方法，忽略大小写） */
const keyword = ref('');
/** 当前选中查看详情的请求 ID */
const selectedId = ref<string | null>(null);
/** 当前请求详情（含请求头/请求体/响应头/响应体） */
const detail = ref<CapturedRequestDTO | null>(null);
/** AI 分析结果文本 */
const aiResult = ref('');
/** AI 分析进行中 */
const aiBusy = ref(false);

/** 过滤类别分段项（与 filterKind 一一对应） */
const filterItems = [
  { key: 'all', label: '全部' },
  { key: 'ajax', label: 'AJAX' },
  { key: 'write', label: '写请求' },
  { key: 'error', label: '失败' },
];

/** 判断是否为 AJAX 请求（CDP 资源类型为 XHR/Fetch，或 Script 类型的 JSONP 接口） */
function isAjax(item: CapturedRequestDTO): boolean {
  if (item.resourceType === 'XHR' || item.resourceType === 'Fetch') return true;
  // JSONP：页面用 <script> 标签发的接口（东方财富行情等站点大量使用），与后台捕获口径一致
  return item.resourceType === 'Script' && isJsonpLikeUrl(item.url);
}

/**
 * 列表行的资源类型展示名：JSONP 接口在 CDP 里类型是 Script，
 * 直接展示"Script"会让用户误以为是静态 JS 混进列表，统一改标为 JSONP。
 * @param item 捕获记录
 */
function displayType(item: CapturedRequestDTO): string {
  if (item.resourceType === 'Script' && isJsonpLikeUrl(item.url)) return 'JSONP';
  return item.resourceType || '接口';
}

/** 响应大小文案；未完成或后台没拿到字节数时返回空串（不显示 0 B 冒充「很小」） */
function sizeLabel(item?: CapturedRequestDTO | null): string {
  if (!item?.size) return '';
  return sizeLabelOf(item.size);
}

/** 判断是否为写请求（POST/PUT/PATCH/DELETE 等，非 GET/HEAD/OPTIONS） */
function isWrite(item: CapturedRequestDTO): boolean {
  const m = (item.method || 'GET').toUpperCase();
  return m !== 'GET' && m !== 'HEAD' && m !== 'OPTIONS';
}

/** 过滤 + 搜索后的列表（保持捕获顺序） */
const visibleRequests = computed<CapturedRequestDTO[]>(() => {
  const kw = keyword.value.trim().toLowerCase();
  return requests.value.filter((item) => {
    // 类别过滤
    if (filterKind.value === 'ajax' && !isAjax(item)) return false;
    if (filterKind.value === 'write' && !isWrite(item)) return false;
    if (filterKind.value === 'error' && !item.error && !(item.status && item.status >= 400)) return false;
    // 关键字过滤：URL 或方法包含即匹配
    if (kw && !item.url.toLowerCase().includes(kw) && !item.method.toLowerCase().includes(kw)) return false;
    return true;
  });
});

/** 空状态文案：根据是否捕获中/是否过滤条件区分 */
const emptyText = computed(() => {
  if (requests.value.length && !visibleRequests.value.length) return '当前过滤条件下没有匹配的接口，试着切换类别或清空搜索。';
  if (capturing.value) return '正在捕获…请在页面上触发 AJAX 或 POST 请求。';
  return '点击「开始捕获」后，页面上的 AJAX 与 POST 请求会实时出现在这里。';
});

/** 详情内容分块（请求头/请求体/响应头/响应体，JSON 自动格式化） */
const detailBlocks = computed<{ title: string; text: string }[]>(() => {
  const d = detail.value;
  if (!d) return [];
  const blocks: { title: string; text: string }[] = [];
  if (d.requestHeaders && Object.keys(d.requestHeaders).length) {
    blocks.push({ title: '请求头', text: formatHeaders(d.requestHeaders) });
  }
  if (d.postData) {
    blocks.push({ title: '请求体', text: prettyBody(d.postData, d.requestHeaders?.['Content-Type'] || d.requestHeaders?.['content-type']) });
  }
  if (d.responseHeaders && Object.keys(d.responseHeaders).length) {
    blocks.push({ title: '响应头', text: formatHeaders(d.responseHeaders) });
  }
  if (d.responseBody) {
    blocks.push({ title: '响应体', text: prettyBody(d.responseBody, d.mimeType) });
  }
  return blocks;
});

/** 把记录头对象格式化成「Key: Value」多行文本 */
function formatHeaders(headers: Record<string, string>): string {
  return Object.entries(headers).map(([k, v]) => `${k}: ${v}`).join('\n');
}

/** 尝试把 JSON 文本格式化为缩进 2 空格；非 JSON 原样返回 */
function prettyBody(text: string, mime?: string): string {
  // lint 修复：字符类内 [ { 无需反斜杠转义（no-useless-escape），语义不变
  const looksJson = /json/i.test(mime || '') || /^\s*[[{]/.test(text);
  if (!looksJson) return text;
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}

/** 状态码样式：2xx 成功、4xx/5xx 失败、其余中性 */
function statusClass(item: CapturedRequestDTO): string {
  if (item.error) return 'net-code--error';
  const s = item.status || 0;
  if (s >= 400) return 'net-code--error';
  if (s >= 200 && s < 400) return 'net-code--ok';
  return '';
}

/** 列表行 URL 缩略：去掉协议与主机前缀，只保留路径与查询（过长截断） */
function shortUrl(url: string): string {
  try {
    const u = new URL(url);
    const path = `${u.pathname}${u.search}`;
    return path.length > 70 ? `${path.slice(0, 70)}…` : path || '/';
  } catch {
    return url.length > 70 ? `${url.slice(0, 70)}…` : url;
  }
}

/** 复制文本到剪贴板（失败静默，不做打扰） */
function copyText(text: string): void {
  navigator.clipboard.writeText(text).then(() => toast.success('已复制')).catch(() => toast.error('复制失败'));
}

/** 分段过滤切换回调 */
function onFilterChange(key: string): void {
  filterKind.value = key as NetFilterKind;
  log.debug(`切换接口过滤类别: ${filterKind.value}`);
}

/** 把一条广播/查询结果写入列表（按 id 覆盖或追加），并同步计数徽标 */
function upsertRecord(rec: CapturedRequestDTO): void {
  const idx = requests.value.findIndex((r) => r.id === rec.id);
  if (idx >= 0) requests.value[idx] = rec;
  else requests.value.push(rec);
}

/** 列表变化时同步抓取徽标计数 */
watch(
  () => requests.value.length,
  (n) => setCount('network', n),
);

/**
 * 刷新当前标签页的捕获状态与列表（reset=true 时先清空旧数据）。
 * @param reset 是否在查询前清空本地列表与详情
 */
async function refresh(reset = false): Promise<void> {
  if (reset) {
    requests.value = [];
    detail.value = null;
    selectedId.value = null;
    aiResult.value = '';
  }
  try {
    const res = await sendBg<{ success?: boolean; tabId?: number; active?: boolean; requests?: CapturedRequestDTO[]; error?: string }>({
      type: MessageType.NET_CAPTURE_QUERY,
      tabId: tabId.value ?? undefined,
    });
    if (res?.tabId != null) tabId.value = res.tabId;
    capturing.value = !!res?.active;
    requests.value = Array.isArray(res?.requests) ? res.requests : [];
    setCount('network', requests.value.length);
  } catch (e) {
    log.warn('查询捕获状态失败', e);
  }
}

/** 发送消息到后台（chrome.runtime.sendMessage 的 Promise 包装） */
function sendBg<T>(message: unknown): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    try {
      chrome.runtime.sendMessage(message, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message || '后台无响应'));
          return;
        }
        resolve(response as T);
      });
    } catch (e) {
      reject(e instanceof Error ? e : new Error(String(e)));
    }
  });
}

/** 开始/停止捕获（失败时把后台错误文案显示在状态行） */
async function toggleCapture(): Promise<void> {
  if (busy.value) return;
  busy.value = true;
  error.value = null;
  try {
    if (capturing.value) {
      const res = await sendBg<{ success?: boolean; error?: string }>({ type: MessageType.NET_CAPTURE_STOP, tabId: tabId.value ?? undefined });
      if (!res?.success) throw new Error(res?.error || '停止捕获失败');
      capturing.value = false;
      toast.info('已停止捕获');
      log.info('已停止网络捕获');
    } else {
      const res = await sendBg<{ success?: boolean; tabId?: number; error?: string }>({ type: MessageType.NET_CAPTURE_START, tabId: tabId.value ?? undefined });
      if (!res?.success) throw new Error(res?.error || '启动捕获失败');
      if (res.tabId != null) tabId.value = res.tabId;
      capturing.value = true;
      requests.value = [];
      toast.success('已开始捕获接口请求');
      log.info(`已开始网络捕获 tab=${tabId.value}`);
    }
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
    log.error('切换捕获状态失败', e);
  } finally {
    busy.value = false;
  }
}

/** 清空后台与本地面板上的全部记录 */
async function clearAll(): Promise<void> {
  try {
    const res = await sendBg<{ success?: boolean; error?: string }>({ type: MessageType.NET_CAPTURE_CLEAR, tabId: tabId.value ?? undefined });
    if (!res?.success) throw new Error(res?.error || '清空失败');
    requests.value = [];
    detail.value = null;
    selectedId.value = null;
    aiResult.value = '';
    toast.info('已清空接口记录');
    log.info('已清空接口捕获记录');
  } catch (e) {
    toast.error(e instanceof Error ? e.message : '清空失败');
  }
}

/** 加载某条请求的完整详情（含响应体） */
async function openDetail(item: CapturedRequestDTO): Promise<void> {
  selectedId.value = item.id;
  try {
    const res = await sendBg<{ success?: boolean; request?: CapturedRequestDTO; error?: string }>({
      type: MessageType.NET_CAPTURE_DETAIL,
      id: item.id,
    });
    if (!res?.success || !res.request) throw new Error(res?.error || '详情不可用');
    detail.value = res.request;
    log.debug(`打开接口详情 ${item.method} ${item.url}`);
  } catch (e) {
    detail.value = { ...item };
    toast.error(e instanceof Error ? e.message : '读取详情失败');
  }
}

/** 关闭详情面板 */
function closeDetail(): void {
  detail.value = null;
  selectedId.value = null;
}

/** 导出全部记录为 HAR 1.2 文件（可在 DevTools / 抓包工具中回放查看） */
async function exportHar(): Promise<void> {
  try {
    const res = await sendBg<{ success?: boolean; requests?: CapturedRequestDTO[]; error?: string }>({
      type: MessageType.NET_CAPTURE_EXPORT,
      tabId: tabId.value ?? undefined,
    });
    if (!res?.success || !Array.isArray(res.requests)) throw new Error(res?.error || '导出失败');
    // 组装 HAR：只保留最基本的请求/响应字段，体量可控且足够回放阅读
    const har = {
      log: {
        version: '1.2',
        creator: { name: 'MediaPlus', version: '1.0.0' },
        entries: res.requests.map((r) => ({
          startedDateTime: new Date(r.startedAt).toISOString(),
          time: r.durationMs || 0,
          request: {
            method: r.method,
            url: r.url,
            httpVersion: 'HTTP/1.1',
            headers: headersToHar(r.requestHeaders),
            queryString: queryToHar(r.url),
            cookies: [],
            headersSize: -1,
            bodySize: r.postData ? r.postData.length : 0,
            ...(r.postData ? { postData: { mimeType: contentTypeOf(r.requestHeaders), text: r.postData } } : {}),
          },
          response: {
            status: r.status || 0,
            statusText: r.error || '',
            httpVersion: 'HTTP/1.1',
            headers: headersToHar(r.responseHeaders),
            cookies: [],
            content: { size: r.size || (r.responseBody ? r.responseBody.length : 0), mimeType: r.mimeType || '', text: r.responseBody || '' },
            redirectURL: '',
            headersSize: -1,
            bodySize: r.size || -1,
          },
          cache: {},
          timings: { send: 0, wait: r.durationMs || 0, receive: 0 },
        })),
      },
    };
    const blob = new Blob([JSON.stringify(har, null, 2)], { type: 'application/json;charset=utf-8' });
    exportBlobWithTimestamp(blob, '接口抓取', 'har');
    log.info(`已导出 HAR，共 ${res.requests.length} 条`);
  } catch (e) {
    toast.error(e instanceof Error ? e.message : '导出失败');
  }
}

/** HAR 头数组转换（无头时返回空数组） */
function headersToHar(headers?: Record<string, string>): { name: string; value: string }[] {
  if (!headers) return [];
  return Object.entries(headers).map(([name, value]) => ({ name, value }));
}

/** 从 URL 解析查询参数为 HAR 的 queryString 数组 */
function queryToHar(url: string): { name: string; value: string }[] {
  try {
    const u = new URL(url);
    return Array.from(u.searchParams.entries()).map(([name, value]) => ({ name, value }));
  } catch {
    return [];
  }
}

/** 取请求头里的 Content-Type（大小写不敏感），缺省按 JSON 处理 */
function contentTypeOf(headers?: Record<string, string>): string {
  if (!headers) return 'application/json';
  const key = Object.keys(headers).find((k) => k.toLowerCase() === 'content-type');
  return key ? headers[key] : 'application/json';
}

/** AI 分析捕获到的接口（接口用途 / 业务流程 / 可关注数据） */
async function runAiAnalyze(): Promise<void> {
  if (aiBusy.value) return;
  aiBusy.value = true;
  aiResult.value = '';
  try {
    // 导出接口拿完整 body（列表摘要不含响应体）
    const res = await sendBg<{ success?: boolean; requests?: CapturedRequestDTO[]; error?: string }>({
      type: MessageType.NET_CAPTURE_EXPORT,
      tabId: tabId.value ?? undefined,
    });
    if (!res?.success || !Array.isArray(res.requests) || !res.requests.length) throw new Error('暂无可分析的接口');
    const items = res.requests.slice(-20).map((r) => ({
      method: r.method,
      url: r.url,
      status: r.status,
      mimeType: r.mimeType,
      postData: r.postData,
      responseBody: r.responseBody,
    }));
    aiResult.value = await aiAnalyzeNetwork({ url: '' }, items);
    log.info(`AI 接口分析完成，输入 ${items.length} 条`);
  } catch (e) {
    aiResult.value = '⚠ ' + (e instanceof Error ? e.message : 'AI 请求失败');
    log.warn('AI 接口分析失败', e);
  } finally {
    aiBusy.value = false;
  }
}

/** 后台广播监听器：增量更新列表 / 捕获状态变更（只接受当前标签页的数据） */
const onBgMessage: Parameters<typeof chrome.runtime.onMessage.addListener>[0] = (message) => {
  const msg = message as { type?: string; tabId?: number; active?: boolean; reason?: string; request?: CapturedRequestDTO };
  if (!msg) return;
  // tabId 不匹配时忽略（例如用户在另一个标签页启动了捕获）
  if (tabId.value != null && msg.tabId != null && msg.tabId !== tabId.value) return;
  if (msg.tabId != null) tabId.value = msg.tabId;

  // 被动断开（用户点掉 Chrome 调试提示条 / DevTools 抢占 / 标签页关闭）：
  // 会话已真的没了，面板必须落到「已停止」，否则用户以为还在录。
  if (msg.type === MessageType.NET_CAPTURE_STATE) {
    const active = !!msg.active;
    if (capturing.value && !active) toast.info(`捕获已停止：${msg.reason || '调试会话已断开'}`);
    capturing.value = active;
    return;
  }

  if (msg.type !== MessageType.NET_CAPTURE_UPDATE || !msg.request) return;
  upsertRecord(msg.request);
};

/** 标签页切换监听器：清空展示并重新查询新标签页的捕获状态 */
function onTabActivated(info: chrome.tabs.TabActiveInfo): void {
  if (info.tabId === tabId.value) return;
  tabId.value = info.tabId;
  void refresh(true);
}

onMounted(async () => {
  // 先取当前标签页 ID，再查询其捕获状态与已有记录
  tabId.value = await getActiveTabId();
  await refresh(true);
  try {
    chrome.runtime.onMessage.addListener(onBgMessage);
    chrome.tabs.onActivated.addListener(onTabActivated);
  } catch (e) {
    log.warn('注册捕获监听失败', e);
  }
  log.debug(`接口抓取面板已加载 tab=${tabId.value}`);
});

onBeforeUnmount(() => {
  // 对称移除监听，避免面板卸载后仍持有引用
  try {
    chrome.runtime.onMessage.removeListener(onBgMessage);
    chrome.tabs.onActivated.removeListener(onTabActivated);
  } catch {
    /* 忽略：扩展环境关闭时可能已失效 */
  }
});
</script>

<style scoped>
.net-toolbar {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  margin-bottom: 10px;
}

.net-filters {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}

/* 搜索框：与分段行同高，占满剩余宽度 */
.net-search {
  flex: 1;
  min-width: 0;
  height: 24px;
  padding: 0 8px;
  font-family: var(--sp-font-family);
  font-size: 11px;
  color: var(--sp-color-text);
  background: var(--sp-color-bg-elevated);
  border: 1px solid var(--sp-color-border);
  border-radius: var(--sp-radius-sm);
  outline: none;
}
.net-search:focus { border-color: var(--sp-color-primary); }

.net-hint {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  margin: 0 0 8px;
  font-size: 11px;
  color: var(--sp-color-muted);
}
.net-hint__state { font-weight: 600; }
.net-hint__state.is-active { color: var(--sp-color-success); }
.net-hint__error { color: var(--sp-color-danger); }

.net-list {
  list-style: none;
  margin: 0;
  padding: 0;
  border: 1px solid var(--sp-color-border);
  border-radius: var(--sp-radius-md);
  overflow: hidden;
  max-height: 300px;
  overflow-y: auto;
  background: var(--sp-color-surface);
}

/* 单行：方法/状态/URL/类型 四段栅格 */
.net-row {
  display: grid;
  grid-template-columns: 46px 34px 1fr auto;
  align-items: center;
  gap: 6px;
  padding: 6px 8px;
  border-bottom: 1px solid var(--sp-color-border);
  cursor: pointer;
  transition: background var(--sp-transition-fast);
}
.net-row:last-child { border-bottom: none; }
.net-row:hover { background: var(--sp-color-bg-elevated); }
.net-row.is-selected { background: var(--sp-color-primary-light); }
.net-row:focus-visible { outline: 2px solid var(--sp-color-primary); outline-offset: -2px; }

.net-method {
  font-size: 10px;
  font-weight: 700;
  text-align: center;
  padding: 2px 0;
  border-radius: var(--sp-radius-xs);
  background: var(--sp-color-bg-elevated);
  color: var(--sp-color-text-secondary);
  white-space: nowrap;
}
/* 常用方法配色：写请求高亮，GET 保持中性 */
.net-method--post { background: var(--sp-color-primary-light); color: var(--sp-color-primary); }
.net-method--put, .net-method--patch { background: var(--sp-color-warning-light); color: var(--sp-color-warning); }
.net-method--delete { background: var(--sp-color-danger-light); color: var(--sp-color-danger); }

.net-code { font-size: 10px; font-weight: 600; text-align: center; color: var(--sp-color-muted); }
.net-code--ok { color: var(--sp-color-success); }
.net-code--error { color: var(--sp-color-danger); }

.net-url {
  font-size: 11px;
  color: var(--sp-color-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.net-meta { font-size: 10px; color: var(--sp-color-muted); white-space: nowrap; }

/* 空状态 */
.net-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 32px 20px;
  color: var(--sp-color-muted);
}
.net-empty__icon {
  width: 44px; height: 44px;
  border-radius: 12px;
  background: var(--sp-color-surface);
  display: flex; align-items: center; justify-content: center;
}
.net-empty__text { margin: 0; font-size: 12px; color: var(--sp-color-text-secondary); text-align: center; }
.net-empty__tip { margin: 0; font-size: 11px; color: var(--sp-color-muted); text-align: center; line-height: 1.5; }

/* 详情 */
.net-detail, .net-ai {
  margin-top: 10px;
  border: 1px solid var(--sp-color-border);
  border-radius: var(--sp-radius-md);
  overflow: hidden;
}
.net-detail__head {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 8px;
  background: var(--sp-color-bg-elevated);
  border-bottom: 1px solid var(--sp-color-border);
}
.net-detail__url {
  flex: 1;
  min-width: 0;
  font-size: 11px;
  color: var(--sp-color-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.net-detail__meta {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  padding: 5px 8px;
  font-size: 11px;
  color: var(--sp-color-muted);
  border-bottom: 1px solid var(--sp-color-border);
}
.net-warn { color: var(--sp-color-warning); }

.net-block { border-top: 1px solid var(--sp-color-border); }
.net-block:first-of-type { border-top: none; }
.net-block__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 5px 8px;
  background: var(--sp-color-bg-elevated);
  border-bottom: 1px solid var(--sp-color-border);
}
.net-block__title {
  font-size: 11px;
  font-weight: 600;
  color: var(--sp-color-text-secondary);
  letter-spacing: 0.04em;
}
.net-block__body {
  margin: 0;
  padding: 8px;
  font-family: var(--sp-font-mono, monospace);
  font-size: 11px;
  color: var(--sp-color-text);
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 220px;
  overflow-y: auto;
  background: var(--sp-color-surface);
}
</style>
