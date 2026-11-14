/**
 * 网络请求捕获模块（XHR/Fetch、JSONP 接口与 POST 等写请求）。
 *
 * 为什么用 chrome.debugger 而不是 chrome.webRequest：
 *  - MV3 的 chrome.webRequest 在普通扩展里已拿不到响应体（只能看 URL/头/大小）；
 *  - chrome.debugger 的 Network 域可以拿到请求头、POST 请求体、响应头、响应体，
 *    是“把 AJAX 请求和返回数据完整解析出来”的唯一可行路径。
 *
 * 抓取范围（按用户需求收敛，避免把静态资源灌进列表）：
 *  - 资源类型为 XHR / Fetch 的请求（GET 也可以，例如 JSON 接口）；
 *  - 任意非 GET/HEAD/OPTIONS 的写请求（POST/PUT/PATCH/DELETE）；
 *  - Script 类型中带 JSONP 回调参数或 /api/ 等接口路径特征的请求
 *    （页面用 <script> 标签发接口，如东方财富行情 JSONP；判定口径与侧栏
 *    共用 shared/netFilter.isJsonpLikeUrl，两处同源）；
 *  - 图片、CSS、普通 JS、字体、音视频等静态资源后缀的 GET 请求一律丢弃。
 *
 * 注意：attach 期间页面顶部会显示「MediaPlus 正在调试此浏览器」横幅，这是
 * Chrome 的安全提示，无法隐藏；DevTools 已打开时 attach 会失败，需先关闭 DevTools。
 */

import { registerBgHandler } from './bus';
import { MessageType, type CapturedRequestDTO } from '@/messaging';
import { createLogger } from '@/utils/logger';
// JSONP/接口型脚本判定与静态后缀正则：与侧栏 NetworkPanel 共用同一口径（shared/netFilter）
import { STATIC_EXT_RE, isJsonpLikeUrl } from '@/shared/netFilter';
// 与 sourcesTree 共享同一次调试附加：各自 attach/detach 会互相掐断对方的会话
import { acquireDebugger, releaseDebugger, handleDebuggerDetach } from './debuggerSession';

/** 本模块 logger：记录 attach/detach、过滤统计与响应体读取失败等关键事件 */
const log = createLogger('network-capture');

/** 单标签页最多保留的记录数，超出丢弃最旧的，防止内存无限增长 */
const MAX_RECORDS_PER_TAB = 200;
/** 单个请求/响应体最大保存字节数（1MB），超出截断并标记 */
const MAX_BODY_BYTES = 1024 * 1024;

/** 内部记录：在对外 DTO 上补充跟踪字段（requestId、响应信息等） */
interface InternalRecord extends CapturedRequestDTO {
  /** CDP 的 requestId，用于把 request/response/loadingFinished 串起来 */
  requestId: string;
  /** 响应 Received 时记录的 MIME，用于判断是否读取 body */
  responseMime?: string;
  /** 是否已经尝试读取响应体（避免重复调用 getResponseBody） */
  bodyFetched?: boolean;
}

/** 单个标签页的捕获会话 */
interface TabSession {
  /** 是否正在捕获（attach 成功且未 detach） */
  active: boolean;
  /** 已捕获的记录（按时间顺序追加） */
  records: InternalRecord[];
}

/** tabId → 会话 */
const sessions = new Map<number, TabSession>();
/** `${tabId}:${requestId}` → 记录（用于事件匹配） */
const recordIndex = new Map<string, InternalRecord>();
/** debugger 事件监听是否已注册（只注册一次，避免重复） */
let listenerBound = false;

/** 判断是否属于需要捕获的请求（XHR/Fetch、JSONP 接口或写请求，且排除静态资源） */
function shouldCapture(method: string, resourceType: string, url: string): boolean {
  if (!url || url.startsWith('data:') || url.startsWith('chrome-extension://') || url.startsWith('chrome://')) return false;
  const m = (method || 'GET').toUpperCase();
  const isWrite = m !== 'GET' && m !== 'HEAD' && m !== 'OPTIONS';
  // 写请求（POST/PUT/PATCH/DELETE）无论资源类型都保留
  if (isWrite) return true;
  // GET：保留 XHR/Fetch，且 URL 不是静态资源后缀
  if (resourceType === 'XHR' || resourceType === 'Fetch') return !STATIC_EXT_RE.test(url);
  // GET + Script：页面用 <script> 标签发的 JSONP 接口（带回调参数或 /api/ 等接口路径），
  // 普通静态 JS 因命中静态后缀会被 isJsonpLikeUrl 排除
  if (resourceType === 'Script') return isJsonpLikeUrl(url);
  return false;
}

/** 判断 MIME 是否为可读文本（只有文本类才读取响应体，二进制直接跳过） */
function isTextMime(mime: string): boolean {
  if (!mime) return true; // 未声明时按文本尝试一次
  return /json|text|xml|javascript|x-www-form-urlencoded|graphql|event-stream|csv|html/i.test(mime);
}

/** 把 CDP 的 headers 对象裁剪成字符串键值（过滤 undefined） */
function normalizeHeaders(headers: unknown): Record<string, string> | undefined {
  if (!headers || typeof headers !== 'object') return undefined;
  const out: Record<string, string> = {};
  Object.entries(headers as Record<string, unknown>).forEach(([k, v]) => {
    if (v == null) return;
    out[k] = String(v);
  });
  return Object.keys(out).length ? out : undefined;
}

/** 截断超长字符串并返回是否发生截断 */
function clampText(text: string): { text: string; truncated: boolean } {
  if (text.length <= MAX_BODY_BYTES) return { text, truncated: false };
  return { text: text.slice(0, MAX_BODY_BYTES), truncated: true };
}

/** 把 sendCommand 包成 Promise（@types/chrome 只有 callback 形态） */
function sendCommand<T = any>(tabId: number, method: string, params?: Record<string, unknown>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    try {
      chrome.debugger.sendCommand({ tabId }, method, params || {}, (result: any) => {
        const err = chrome.runtime.lastError;
        if (err) { reject(new Error(err.message || String(err))); return; }
        resolve(result as T);
      });
    } catch (e) {
      reject(e instanceof Error ? e : new Error(String(e)));
    }
  });
}

/** 获取目标标签页：消息里带 tabId 优先，否则取当前活动标签页 */
async function resolveTabId(tabId?: number): Promise<number | null> {
  if (typeof tabId === 'number' && tabId > 0) return tabId;
  try {
    const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (tabs.length && tabs[0].id != null) return tabs[0].id;
    const fallback = await chrome.tabs.query({ active: true, currentWindow: true });
    if (fallback.length && fallback[0].id != null) return fallback[0].id;
  } catch (e) {
    log.warn('解析活动标签页失败', e);
  }
  return null;
}

/** 创建一条新记录并登记索引 */
function createRecord(tabId: number, requestId: string, params: any): InternalRecord {
  const req = params.request || {};
  const rec: InternalRecord = {
    id: `${tabId}:${requestId}`,
    requestId,
    tabId,
    url: String(req.url || '').split('#')[0],
    method: String(req.method || 'GET').toUpperCase(),
    resourceType: params.type,
    requestHeaders: normalizeHeaders(req.headers),
    startedAt: Math.round(Number(params.wallTime) * 1000) || Date.now(),
    finished: false,
    hasBody: false,
  };
  // 请求体：短请求直接内联；hasPostData 且无内联时异步补取
  if (typeof req.postData === 'string' && req.postData) {
    rec.postData = clampText(req.postData).text;
  }
  return rec;
}

/** 取会话；不存在则创建（未 attach 的会话不会收到事件，仅作容器） */
function ensureSession(tabId: number): TabSession {
  let s = sessions.get(tabId);
  if (!s) {
    s = { active: false, records: [] };
    sessions.set(tabId, s);
  }
  return s;
}

/** 把记录追加进会话（超上限时丢弃最旧并清理索引） */
function pushRecord(tabId: number, rec: InternalRecord): void {
  const s = ensureSession(tabId);
  s.records.push(rec);
  if (s.records.length > MAX_RECORDS_PER_TAB) {
    const dropped = s.records.shift();
    if (dropped) recordIndex.delete(`${tabId}:${dropped.requestId}`);
    log.debug('记录数达到上限，已丢弃最旧一条', dropped && dropped.id);
  }
  recordIndex.set(rec.id, rec);
}

/** 生成对外摘要（去掉响应体，避免广播/列表消息过大） */
function toSummary(rec: InternalRecord): CapturedRequestDTO {
  // 解构丢弃内部字段惯用法：void 标记为"有意不使用"，消除 no-unused-vars
  const { requestId, responseMime, bodyFetched, ...dto } = rec;
  void requestId; void responseMime; void bodyFetched;
  return { ...dto, hasBody: !!rec.responseBody };
}

/** 广播一条记录更新给侧栏（没有监听方时会 reject，静默忽略） */
function broadcast(tabId: number, rec: InternalRecord): void {
  try {
    const p = chrome.runtime.sendMessage({
      type: MessageType.NET_CAPTURE_UPDATE,
      tabId,
      request: toSummary(rec),
    });
    if (p && typeof (p as Promise<unknown>).catch === 'function') (p as Promise<unknown>).catch(() => { /* 侧栏未打开 */ });
  } catch {
    /* 忽略：侧栏未打开或消息通道关闭 */
  }
}

/** 广播捕获开关状态（背景 → 侧栏）；侧栏未打开时静默忽略 */
function broadcastState(tabId: number, active: boolean, reason?: string): void {
  try {
    const p = chrome.runtime.sendMessage({
      type: MessageType.NET_CAPTURE_STATE,
      tabId,
      active,
      reason,
    });
    if (p && typeof (p as Promise<unknown>).catch === 'function') (p as Promise<unknown>).catch(() => { /* 侧栏未打开 */ });
  } catch {
    /* 忽略：侧栏未打开或消息通道关闭 */
  }
}

/** 异步补取较大的 POST 请求体（requestWillBeSent 里没有内联 postData 时） */
async function fillPostData(tabId: number, rec: InternalRecord, hasPostData: boolean): Promise<void> {
  if (!hasPostData || rec.postData) return;
  try {
    const res = await sendCommand<{ postData?: string }>(tabId, 'Network.getRequestPostData', { requestId: rec.requestId });
    if (res && typeof res.postData === 'string') {
      const c = clampText(res.postData);
      rec.postData = c.text;
      if (c.truncated) log.debug('请求体已截断', rec.url);
      broadcast(tabId, rec);
    }
  } catch (e) {
    log.debug('读取 POST 请求体失败（可能已释放或非文本）', rec.url, e);
  }
}

/** 读取响应体并写回记录（只在文本类 MIME 上尝试） */
async function fillResponseBody(tabId: number, rec: InternalRecord, encodedLength?: number): Promise<void> {
  if (rec.bodyFetched) return;
  rec.bodyFetched = true;
  if (!isTextMime(rec.responseMime || '')) {
    // 二进制/媒体响应不解析，避免把几 MB 的 base64 塞进内存；
    // 但字节数在 loadingFinished 里已经拿到，必须留下，否则列表的「大小」列对媒体恒空
    if (typeof encodedLength === 'number' && Number.isFinite(encodedLength)) rec.size = encodedLength;
    rec.finished = true;
    broadcast(tabId, rec);
    return;
  }
  try {
    const res = await sendCommand<{ body: string; base64Encoded: boolean }>(tabId, 'Network.getResponseBody', { requestId: rec.requestId });
    if (res && typeof res.body === 'string') {
      // base64 编码的响应（如 gzip 后仍按 base64 返回）直接标记不可读，避免误解码
      if (res.base64Encoded) {
        rec.responseBody = undefined;
        rec.bodyTruncated = true;
        log.debug('响应体为 base64 编码，已跳过解析', rec.url);
      } else {
        const c = clampText(res.body);
        rec.responseBody = c.text;
        rec.bodyTruncated = c.truncated;
        rec.size = encodedLength ?? res.body.length;
      }
    }
  } catch (e) {
    // 常见原因：请求被重定向/取消、body 已被回收、预检请求无 body
    log.debug('读取响应体失败', rec.url, e);
  } finally {
    // getResponseBody 失败时上面那条赋值不会执行，但传输字节数已经拿到，补上，否则「大小」对这类请求恒空
    if (!rec.size && typeof encodedLength === 'number' && Number.isFinite(encodedLength)) rec.size = encodedLength;
    rec.finished = true;
    broadcast(tabId, rec);
  }
}

/** 处理 CDP 的 Network 事件（全局只挂一次） */
function onDebuggerEvent(source: chrome.debugger.Debuggee, method: string, params: any): void {
  const tabId = source.tabId;
  if (typeof tabId !== 'number') return;
  const s = sessions.get(tabId);
  if (!s || !s.active) return; // 未启用捕获的标签页直接忽略

  if (method === 'Network.requestWillBeSent') {
    const requestId = String(params.requestId || '');
    const existing = recordIndex.get(`${tabId}:${requestId}`);
    // 重定向：同一个 requestId 再次触发，更新状态与响应信息即可
    if (existing) {
      if (params.redirectResponse) {
        existing.status = Number(params.redirectResponse.status) || existing.status;
        existing.responseMime = params.redirectResponse.mimeType || existing.responseMime;
        existing.responseHeaders = normalizeHeaders(params.redirectResponse.headers);
        broadcast(tabId, existing);
      }
      return;
    }
    if (!shouldCapture(String(params.request?.method || 'GET'), String(params.type || ''), String(params.request?.url || ''))) {
      return;
    }
    const rec = createRecord(tabId, requestId, params);
    pushRecord(tabId, rec);
    log.info(`捕获请求 ${rec.method} ${rec.url} (${rec.resourceType || 'unknown'})`);
    broadcast(tabId, rec);
    if (params.request?.hasPostData) void fillPostData(tabId, rec, true);
    return;
  }

  if (method === 'Network.responseReceived') {
    const rec = recordIndex.get(`${tabId}:${String(params.requestId || '')}`);
    if (!rec) return;
    rec.status = Number(params.response?.status) || rec.status;
    rec.responseMime = String(params.response?.mimeType || '');
    rec.mimeType = rec.responseMime;
    rec.responseHeaders = normalizeHeaders(params.response?.headers);
    broadcast(tabId, rec);
    return;
  }

  if (method === 'Network.loadingFinished') {
    const rec = recordIndex.get(`${tabId}:${String(params.requestId || '')}`);
    if (!rec) return;
    rec.durationMs = rec.durationMs || Math.max(0, Math.round((Date.now() - rec.startedAt)));
    void fillResponseBody(tabId, rec, Number(params.encodedDataLength) || undefined);
    return;
  }

  if (method === 'Network.loadingFailed') {
    const rec = recordIndex.get(`${tabId}:${String(params.requestId || '')}`);
    if (!rec) return;
    rec.error = String(params.errorText || '请求失败');
    rec.durationMs = Math.max(0, Math.round((Date.now() - rec.startedAt)));
    rec.finished = true;
    broadcast(tabId, rec);
  }
}

/** 注册 debugger 全局事件（幂等） */
function bindDebuggerListeners(): void {
  if (listenerBound) return;
  listenerBound = true;
  chrome.debugger.onEvent.addListener((source, method, params) => {
    try {
      onDebuggerEvent(source, method, params);
    } catch (e) {
      log.error('处理 Network 事件失败', method, e);
    }
  });
  // 用户点掉 Chrome 调试提示条、DevTools 抢占、标签页关闭时会触发 detach。
  // 此时会话已真的没了：清空仲裁租约并把「已停止」广播出去，否则面板一直显示「捕获中」。
  chrome.debugger.onDetach.addListener((source, reason) => {
    const tabId = source.tabId;
    if (typeof tabId !== 'number') return;
    handleDebuggerDetach(tabId, reason);
    const s = sessions.get(tabId);
    const wasActive = !!s?.active;
    if (s) s.active = false;
    log.info(`调试器已断开 tab=${tabId} reason=${reason}`);
    if (wasActive) {
      broadcastState(tabId, false, reason === 'target_closed' ? '标签页已关闭' : '调试会话被外部断开');
    }
  });
  // 标签页关闭后清理会话，避免内存泄漏
  try {
    chrome.tabs.onRemoved.addListener((tabId) => {
      const s = sessions.get(tabId);
      if (!s) return;
      s.active = false;
      sessions.delete(tabId);
      for (const key of Array.from(recordIndex.keys())) {
        if (key.startsWith(`${tabId}:`)) recordIndex.delete(key);
      }
      log.debug(`标签页 ${tabId} 关闭，已清理捕获记录`);
    });
  } catch (e) {
    log.warn('注册 tabs.onRemoved 失败', e);
  }
}

/** 启动捕获：取得调试会话租约 + Network.enable */
async function startCapture(tabId: number): Promise<{ ok: boolean; error?: string }> {
  bindDebuggerListeners();
  const existing = sessions.get(tabId);
  if (existing?.active) return { ok: true };

  try {
    await acquireDebugger(tabId, 'network-capture');
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log.error('attach 调试器失败', tabId, msg);
    // 常见错误：DevTools 已占用同一标签页
    return {
      ok: false,
      error: msg.includes('Another debugger')
        ? '该标签页已被 DevTools 或其他调试器占用，请先关闭 DevTools 后重试'
        : `无法启动网络捕获：${msg}`,
    };
  }

  try {
    await sendCommand(tabId, 'Network.enable', {
      maxTotalBufferSize: 50 * 1024 * 1024,
      maxResourceBufferSize: 10 * 1024 * 1024,
      maxPostDataSize: 256 * 1024,
    });
  } catch (e) {
    log.warn('Network.enable 失败，将尝试继续监听', e);
  }

  const s = ensureSession(tabId);
  s.active = true;
  s.records = [];
  for (const key of Array.from(recordIndex.keys())) {
    if (key.startsWith(`${tabId}:`)) recordIndex.delete(key);
  }
  log.info(`已开始捕获网络请求 tab=${tabId}`);
  return { ok: true };
}

/**
 * 停止捕获：释放租约（保留已有记录，便于继续查看/导出）。
 * 同 tab 上 sourcesTree 仍持有租约时不会真正 detach，避免掐断对方的资源扫描。
 */
async function stopCapture(tabId: number): Promise<{ ok: boolean; error?: string }> {
  const s = sessions.get(tabId);
  if (s) s.active = false;
  await releaseDebugger(tabId, 'network-capture');
  return { ok: true };
}

/** 注册消息处理器（由 background/index.ts 调用） */
export function initNetworkCaptureHandlers(): void {
  bindDebuggerListeners();

  registerBgHandler(MessageType.NET_CAPTURE_START, async (msg: any) => {
    const tabId = await resolveTabId(msg?.tabId);
    if (tabId == null) return { success: false, error: '未找到可捕获的标签页' };
    const r = await startCapture(tabId);
    if (!r.ok) return { success: false, error: r.error };
    return { success: true, tabId, active: true, count: sessions.get(tabId)?.records.length || 0 };
  });

  registerBgHandler(MessageType.NET_CAPTURE_STOP, async (msg: any) => {
    const tabId = await resolveTabId(msg?.tabId);
    if (tabId == null) return { success: false, error: '未找到可停止的标签页' };
    const r = await stopCapture(tabId);
    if (!r.ok) return { success: false, error: r.error };
    return { success: true, tabId, active: false, count: sessions.get(tabId)?.records.length || 0 };
  });

  registerBgHandler(MessageType.NET_CAPTURE_STATUS, async (msg: any) => {
    const tabId = await resolveTabId(msg?.tabId);
    if (tabId == null) return { success: false, error: '未找到标签页' };
    const s = sessions.get(tabId);
    return { success: true, tabId, active: !!s?.active, count: s?.records.length || 0 };
  });

  registerBgHandler(MessageType.NET_CAPTURE_QUERY, async (msg: any) => {
    const tabId = await resolveTabId(msg?.tabId);
    if (tabId == null) return { success: false, error: '未找到标签页', requests: [] };
    const s = sessions.get(tabId);
    return {
      success: true,
      tabId,
      active: !!s?.active,
      requests: (s?.records || []).map(toSummary),
    };
  });

  registerBgHandler(MessageType.NET_CAPTURE_DETAIL, async (msg: any) => {
    const rec = recordIndex.get(String(msg?.id || ''));
    if (!rec) return { success: false, error: '请求记录不存在或已被清理' };
    return { success: true, request: { ...rec } as CapturedRequestDTO };
  });

  registerBgHandler(MessageType.NET_CAPTURE_EXPORT, async (msg: any) => {
    const tabId = await resolveTabId(msg?.tabId);
    if (tabId == null) return { success: false, error: '未找到标签页', requests: [] };
    const s = sessions.get(tabId);
    // 导出需要完整 body，去掉内部字段
    const requests = (s?.records || []).map((r) => {
      // 解构丢弃内部字段惯用法：void 标记为"有意不使用"，消除 no-unused-vars
      const { requestId, responseMime, bodyFetched, ...dto } = r;
      void requestId; void responseMime; void bodyFetched;
      return dto as CapturedRequestDTO;
    });
    return { success: true, tabId, requests };
  });

  registerBgHandler(MessageType.NET_CAPTURE_CLEAR, async (msg: any) => {
    const tabId = await resolveTabId(msg?.tabId);
    if (tabId == null) return { success: false, error: '未找到标签页' };
    const s = sessions.get(tabId);
    if (s) s.records = [];
    for (const key of Array.from(recordIndex.keys())) {
      if (key.startsWith(`${tabId}:`)) recordIndex.delete(key);
    }
    log.info(`已清空网络捕获记录 tab=${tabId}`);
    return { success: true, tabId };
  });

  log.info('网络请求捕获模块已初始化');
}
