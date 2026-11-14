/**
 * Chrome 扩展 API 桩（仅用于浏览器内的侧栏 UI 预览）。
 *
 * 作用：真实扩展宿主不存在时，让 dist-preview 里的 Vue 侧栏仍能渲染、
 * 交互，并返回一批固定的演示数据（标签页、视频、图片、音频、正文）。
 * 注意：这里的数据全部是假的，不代表扩展在真实页面上的抓取结果。
 */
(function () {
  'use strict';

  /** 演示用的远程地址前缀（不会真的被访问，仅用于展示域名/文件名） */
  const DEMO_HOST = 'https://static.demo.mediaplus.local';

  /** 模拟 ID 自增序号（下载任务 id 用） */
  let seq = 0;

  /** 运行时消息监听器集合（侧栏注册后由广播函数派发） */
  const runtimeListeners = [];

  /** tabs 事件监听器集合 */
  const tabEventListeners = new Map();

  /**
   * 生成一张渐变 SVG 图片的 data URI（图像面板演示数据用，无需外网）。
   * @param {string} label 图片中央文字
   * @param {string} c1 渐变起始色
   * @param {string} c2 渐变结束色
   * @param {number} w 宽
   * @param {number} h 高
   * @returns {string} data URI
   */
  function svgImage(label, c1, c2, w, h) {
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + h + '">' +
      '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">' +
      '<stop offset="0" stop-color="' + c1 + '"/><stop offset="1" stop-color="' + c2 + '"/>' +
      '</linearGradient></defs>' +
      '<rect width="100%" height="100%" fill="url(#g)"/>' +
      '<circle cx="' + Math.round(w * 0.82) + '" cy="' + Math.round(h * 0.22) + '" r="' + Math.round(h * 0.12) + '" fill="rgba(255,255,255,.35)"/>' +
      '<text x="50%" y="52%" fill="#ffffff" font-family="Segoe UI, sans-serif" font-size="' + Math.round(h * 0.16) +
      '" font-weight="700" text-anchor="middle" dominant-baseline="middle">' + label + '</text>' +
      '</svg>';
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  }

  /** 演示标签页列表（活跃标签页放在第一位） */
  const tabs = [
    {
      id: 1, active: true, highlighted: true, windowId: 1, index: 0,
      title: '【4K】城市夜景延时摄影 · B站', url: 'https://www.bilibili.com/video/BV1xx411c7mD',
      favIconUrl: 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" rx="8" fill="#fb7299"/><text x="16" y="21" font-size="14" fill="#fff" text-anchor="middle" font-family="sans-serif">B</text></svg>'),
    },
    {
      id: 2, active: false, highlighted: false, windowId: 1, index: 1,
      title: '如何高效做课堂笔记 - 知乎', url: 'https://www.zhihu.com/question/20348123',
      favIconUrl: 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" rx="8" fill="#1772f6"/><text x="16" y="21" font-size="13" fill="#fff" text-anchor="middle" font-family="sans-serif">知</text></svg>'),
    },
    {
      id: 3, active: false, highlighted: false, windowId: 1, index: 2,
      title: '音频素材库 · 免费背景音乐试听', url: 'https://www.bbc.co.uk/programmes',
      favIconUrl: 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" rx="8" fill="#2f8f46"/><text x="16" y="21" font-size="13" fill="#fff" text-anchor="middle" font-family="sans-serif">音</text></svg>'),
    },
  ];

  /** 演示视频列表（视频面板是表格，不依赖缩略图） */
  const demoVideos = [
    {
      index: 0, src: DEMO_HOST + '/video/night-city-4k.mp4', width: 3840, height: 2160,
      duration: 183.5, muted: false, visible: true, paused: false,
      directSources: [{ url: DEMO_HOST + '/video/night-city-4k.mp4', label: '4K 原始源', mimeType: 'video/mp4', extension: 'mp4' }],
      directSourceCount: 1,
    },
    {
      index: 1, src: DEMO_HOST + '/video/lecture-1080p.mp4', width: 1920, height: 1080,
      duration: 3602.0, muted: false, visible: true, paused: true,
      directSources: [{ url: DEMO_HOST + '/video/lecture-1080p.mp4', label: '1080P', mimeType: 'video/mp4', extension: 'mp4' }],
      directSourceCount: 1,
    },
    {
      index: 2, src: DEMO_HOST + '/video/demo-720p.webm', width: 1280, height: 720,
      duration: 96.4, muted: true, visible: false, paused: false,
      directSources: [{ url: DEMO_HOST + '/video/demo-720p.webm', label: 'WebM 备用源', mimeType: 'video/webm', extension: 'webm' }],
      directSourceCount: 1,
    },
    {
      index: 3, src: DEMO_HOST + '/hls/stream/index.m3u8', width: 1920, height: 1080,
      duration: 0, muted: false, visible: true, paused: false,
      directSources: [{ url: DEMO_HOST + '/hls/stream/index.m3u8', label: 'HLS(m3u8)', mimeType: 'application/vnd.apple.mpegurl', extension: 'm3u8' }],
      directSourceCount: 1,
    },
  ];

  /** 演示图片列表（图像面板用 data URI，保证离线可显示） */
  const demoImages = [
    { url: svgImage('封面 01', '#6366f1', '#a855f7', 1200, 800), width: 1200, height: 800, kind: 'img' },
    { url: svgImage('封面 02', '#0ea5e9', '#22d3ee', 1080, 1080), width: 1080, height: 1080, kind: 'img' },
    { url: svgImage('背景图', '#f59e0b', '#ef4444', 1920, 1080), width: 1920, height: 1080, kind: 'background' },
    { url: svgImage('插图 03', '#10b981', '#84cc16', 900, 600), width: 900, height: 600, kind: 'img' },
    { url: svgImage('截图 04', '#8b5cf6', '#ec4899', 1440, 900), width: 1440, height: 900, kind: 'img' },
    { url: svgImage('图标集', '#334155', '#64748b', 640, 640), width: 640, height: 640, kind: 'source' },
  ];

  /** 演示音频列表 */
  const demoAudios = [
    { url: DEMO_HOST + '/audio/episode-01.mp3', title: '第 01 讲 · 课程导论（时长 32:15）' },
    { url: DEMO_HOST + '/audio/episode-02.mp3', title: '第 02 讲 · 核心概念拆解（时长 41:08）' },
    { url: DEMO_HOST + '/audio/bgm-01.mp3', title: '背景音乐 · 轻快钢琴（时长 03:20）' },
    { url: DEMO_HOST + '/audio/bgm-02.m4a', title: '背景音乐 · 氛围电子（时长 04:05）' },
    { url: DEMO_HOST + '/audio/interview.mp3', title: '访谈录音 · 完整版（时长 58:42）' },
  ];

  /** 演示正文内容（文本面板用） */
  /** 演示正文块：与真实内容脚本同构（Markdown/归档/高亮定位都吃 blocks） */
  const demoTextBlocks = [
    { type: 'paragraph', spans: [{ text: '课堂笔记的目的不是“把老师说的都抄下来”，而是把一节课的信息压缩成以后能看懂的结构。' }] },
    { type: 'heading', level: 2, spans: [{ text: '一、课前准备' }] },
    { type: 'paragraph', spans: [{ text: '先把上一节课的三条核心结论写在本子首页，听课时带着问题去听，注意力会明显集中。' }] },
    { type: 'heading', level: 2, spans: [{ text: '二、课中记录' }] },
    { type: 'paragraph', spans: [{ text: '采用康奈尔笔记法，把页面分成“线索区、笔记区、总结区”。笔记区只写关键词与因果链，遇到例子用箭头连起来，不要整句抄写。' }] },
    { type: 'table', header: ['分区', '写什么'], rows: [['线索区', '关键词与提问'], ['笔记区', '因果链与例子'], ['总结区', '一句话结论']] },
    { type: 'heading', level: 2, spans: [{ text: '三、课后 24 小时内' }] },
    { type: 'list', ordered: true, start: 1, items: [[{ text: '遮住笔记区，只看线索区尝试复述' }], [{ text: '复述卡住的地方就是需要补的漏洞' }]] },
    { type: 'image', src: DEMO_HOST + '/image/note-layout.png', alt: '康奈尔笔记分区示意' },
    { type: 'heading', level: 2, spans: [{ text: '四、每周整理' }] },
    { type: 'paragraph', spans: [{ text: '把本周笔记的总结区汇总成一页思维导图，形成可检索的知识索引。' }] },
  ];

  const demoText = {
    title: '如何高效做课堂笔记：从记录到复习的完整方法',
    description: '本文整理了康奈尔笔记法、卡片笔记法与实际课堂演练步骤，帮助你把课堂内容沉淀成可复习的知识。',
    keywords: ['笔记方法', '学习效率', '康奈尔笔记', '复习'],
    author: '林知远',
    textContent: demoTextBlocks.map((b) => {
      if (b.type === 'table') return [b.header, ...b.rows].map((r) => r.join('  ')).join('\n');
      if (b.type === 'list') return b.items.map((it, i) => `${b.start + i}. ${it.map((s) => s.text).join('')}`).join('\n');
      if (b.type === 'image') return '';
      return (b.spans || []).map((s) => s.text).join('');
    }).filter(Boolean).join('\n\n'),
    wordCount: 312,
    meta: { source: 'preview-demo', lang: 'zh-CN' },
    blocks: demoTextBlocks,
    url: 'https://www.zhihu.com/question/20348123?utm_source=share',
    canonicalUrl: 'https://www.zhihu.com/question/20348123',
    siteName: '知乎',
    publishedAt: '2026-11-02T09:30:00+08:00',
    language: 'zh-CN',
  };

  /** 演示划词选区：锚点取自上面的正文，侧栏据此算偏移并留存 */
  const demoSelection = {
    ok: true,
    excerpt: '康奈尔笔记法',
    url: demoText.url,
    anchor: { exact: '康奈尔笔记法', prefix: '采用', suffix: '，把页面分成' },
  };

  /** 存储模拟层（用 localStorage 持久化，刷新页面后设置不丢） */
  const storageKey = '__preview_storage__';
  let storageData = {};
  try {
    storageData = JSON.parse(localStorage.getItem(storageKey) || '{}') || {};
  } catch (e) {
    storageData = {};
  }

  /** storage.onChanged 监听器集合 */
  const storageListeners = [];

  /**
   * 写入模拟存储并派发 onChanged 事件。
   * @param {Record<string, any>} items 要写入的键值
   */
  function storageSet(items) {
    const changes = {};
    Object.keys(items || {}).forEach((k) => {
      const oldValue = storageData[k];
      storageData[k] = items[k];
      changes[k] = { oldValue, newValue: items[k] };
    });
    try {
      localStorage.setItem(storageKey, JSON.stringify(storageData));
    } catch (e) {
      /* localStorage 不可用则仅保存在内存 */
    }
    storageListeners.forEach((fn) => {
      try { fn(changes, 'local'); } catch (e) { /* 忽略监听器异常 */ }
    });
  }

  /**
   * 读取模拟存储（支持 string / string[] / 带默认值对象 / null）。
   * @param {string|string[]|Record<string, any>|null} keys 查询键
   * @returns {Record<string, any>} 结果
   */
  function storageGet(keys) {
    if (keys == null) return Object.assign({}, storageData);
    if (typeof keys === 'string') return { [keys]: storageData[keys] };
    if (Array.isArray(keys)) {
      const out = {};
      keys.forEach((k) => { out[k] = storageData[k]; });
      return out;
    }
    if (typeof keys === 'object') {
      const out = {};
      Object.keys(keys).forEach((k) => {
        out[k] = storageData[k] === undefined ? keys[k] : storageData[k];
      });
      return out;
    }
    return {};
  }

  /**
   * 统一处理“回调 / Promise”两种调用风格。
   * @param {Function|null|undefined} cb 可能存在的回调
   * @param {any} value 返回值
   * @returns {Promise<any>|undefined} 无回调时返回 Promise，有回调时返回 undefined
   */
  function reply(cb, value) {
    if (typeof cb === 'function') {
      setTimeout(() => cb(value), 0);
      return undefined;
    }
    return Promise.resolve(value);
  }

  /**
   * 演示用接口捕获记录（含完整请求/响应体，模拟真实后台 NET_CAPTURE_EXPORT 返回）。
   * 覆盖场景：GET JSON 列表、POST JSON 写请求、分页接口、失败请求（404）。
   */
  const DEMO_NET_FULL = [
    {
      id: '1:1001', tabId: 1,
      url: 'https://api.demo.mediaplus.local/v1/feed/recommend?page=1&size=20',
      method: 'GET', resourceType: 'XHR', status: 200, mimeType: 'application/json',
      requestHeaders: { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
      responseHeaders: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache' },
      responseBody: JSON.stringify({
        code: 0, message: 'ok',
        data: { total: 128, list: [
          { id: 9001, title: '城市夜景延时摄影', author: '光影记录', play: 128000 },
          { id: 9002, title: '如何高效做课堂笔记', author: '学习研究所', play: 56000 }
        ] }
      }),
      startedAt: Date.now() - 52000, durationMs: 132, finished: true, hasBody: true, size: 812
    },
    {
      id: '1:1002', tabId: 1,
      url: 'https://api.demo.mediaplus.local/v1/video/9001/detail',
      method: 'GET', resourceType: 'Fetch', status: 200, mimeType: 'application/json',
      requestHeaders: { Accept: 'application/json' },
      responseHeaders: { 'Content-Type': 'application/json; charset=utf-8' },
      responseBody: JSON.stringify({ code: 0, data: { id: 9001, title: '城市夜景延时摄影', duration: 312, tags: ['延时', '夜景', '4K'], playUrl: 'https://cdn.demo.mediaplus.local/v/9001.m3u8' } }),
      startedAt: Date.now() - 48000, durationMs: 68, finished: true, hasBody: true, size: 436
    },
    {
      id: '1:1003', tabId: 1,
      url: 'https://api.demo.mediaplus.local/v1/favorite',
      method: 'POST', resourceType: 'XHR', status: 201, mimeType: 'application/json',
      requestHeaders: { 'Content-Type': 'application/json', Accept: 'application/json' },
      postData: JSON.stringify({ videoId: 9001, action: 'add' }),
      responseHeaders: { 'Content-Type': 'application/json; charset=utf-8' },
      responseBody: JSON.stringify({ code: 0, data: { favorited: true, count: 3210 } }),
      startedAt: Date.now() - 30000, durationMs: 96, finished: true, hasBody: true, size: 128
    },
    {
      id: '1:1004', tabId: 1,
      url: 'https://api.demo.mediaplus.local/v1/comment/list?videoId=9001&page=2',
      method: 'GET', resourceType: 'XHR', status: 200, mimeType: 'application/json',
      requestHeaders: { Accept: 'application/json' },
      responseHeaders: { 'Content-Type': 'application/json; charset=utf-8' },
      responseBody: JSON.stringify({ code: 0, data: { list: [{ id: 1, user: '夜行者', text: '这个镜头太稳了' }, { id: 2, user: '小舟', text: '请问用的什么设备？' }], hasMore: false } }),
      startedAt: Date.now() - 12000, durationMs: 74, finished: true, hasBody: true, size: 268
    },
    {
      id: '1:1005', tabId: 1,
      url: 'https://api.demo.mediaplus.local/v1/user/profile',
      method: 'GET', resourceType: 'Fetch', status: 404, mimeType: 'application/json',
      requestHeaders: { Accept: 'application/json' },
      responseHeaders: { 'Content-Type': 'application/json; charset=utf-8' },
      responseBody: JSON.stringify({ code: 404, message: 'user not found' }),
      startedAt: Date.now() - 6000, durationMs: 41, finished: true, hasBody: true, size: 42,
      error: undefined
    }
  ];

  /** 列表摘要（去掉请求/响应体，模拟后台 NET_CAPTURE_QUERY 的精简返回） */
  const DEMO_NET_SUMMARY = DEMO_NET_FULL.map(function (r) {
    const summary = {
      id: r.id, tabId: r.tabId, url: r.url, method: r.method, resourceType: r.resourceType,
      status: r.status, mimeType: r.mimeType, startedAt: r.startedAt, durationMs: r.durationMs,
      finished: r.finished, hasBody: !!r.responseBody, size: r.size
    };
    if (r.error) summary.error = r.error;
    return summary;
  });

  /** 侧栏 → 后台（runtime.sendMessage）的假后台路由 */
  function routeRuntimeMessage(msg) {
    const type = msg && msg.type;
    switch (type) {
      case 'PING':
        return { type: 'PONG', ok: true, version: '1.0.0-preview', capabilities: ['video', 'image', 'audio', 'text'] };
      case 'WHO_AM_I':
        return { success: true, tabId: 1, frameId: 0 };
      case 'COMPANION_STATUS':
      case 'COMPANION_RECHECK':
        return { success: true, online: false, enabled: false };
      case 'DESKTOP_OVERLAY_START':
      case 'DESKTOP_OVERLAY_STOP':
      case 'DESKTOP_OVERLAY_STATUS':
        return { success: false, error: '预览模式：桌面标注仅在安装伴生程序的真实扩展内可用', running: false };
      case 'DOWNLOAD_QUEUE_ACTION':
        return { success: true, id: 'preview-task-' + (++seq) };
      case 'DOWNLOAD_QUEUE_SNAPSHOT':
        return { success: true, tasks: [], paused: false };
      case 'GET_CAPTURED_VIDEO_SOURCES':
        return { success: true, sources: [] };
      case 'SOURCES_TREE_SCAN':
        return { success: false, error: '预览模式未接入资源目录扫描' };
      case 'SOURCES_TREE_DOWNLOAD':
        return { success: false, error: '预览模式不支持打包下载' };
      case 'SOURCES_DOWNLOAD_STATUS':
        return { success: true, taskId: msg.taskId, status: 'done', progress: 100 };
      case 'START_DOWNLOAD':
      case 'DIRECT_VIDEO_DOWNLOAD':
      case 'DIRECT_DOWNLOAD_GENERIC':
        return { success: true, id: 'preview-task-' + (++seq) };
      case 'START_HLS_DOWNLOAD':
        return { success: false, error: '预览模式不支持 HLS 合并下载' };
      case 'NET_CAPTURE_STATUS':
      case 'NET_CAPTURE_QUERY':
        // 预览：默认未开始捕获，但返回演示记录让界面有内容可看
        return { success: true, tabId: 1, active: false, count: DEMO_NET_SUMMARY.length, requests: DEMO_NET_SUMMARY };
      case 'NET_CAPTURE_START':
        return { success: true, tabId: 1, active: true, count: DEMO_NET_SUMMARY.length };
      case 'NET_CAPTURE_STOP':
        return { success: true, tabId: 1, active: false, count: DEMO_NET_SUMMARY.length };
      case 'NET_CAPTURE_DETAIL': {
        const found = DEMO_NET_FULL.find(function (r) { return r.id === msg.id; }) || DEMO_NET_FULL[0];
        return { success: true, request: found };
      }
      case 'NET_CAPTURE_EXPORT':
        return { success: true, tabId: 1, requests: DEMO_NET_FULL };
      case 'NET_CAPTURE_CLEAR':
        return { success: true, tabId: 1 };
      case 'SETTINGS_UPDATE':
        return { success: true };
      default:
        return { success: true };
    }
  }

  /** 侧栏 → 内容脚本（tabs.sendMessage）的假页面路由 */
  function routeTabMessage(msg) {
    const type = msg && msg.type;
    switch (type) {
      case 'PING':
        return { type: 'PONG', ok: true, version: '1.0.0-preview', capabilities: ['video', 'image', 'audio', 'text'], adapterId: 'preview' };
      case 'GET_VIDEO_LIST':
        return { success: true, videos: demoVideos };
      case 'REQUEST_IMAGE_LIST':
        return { success: true, items: demoImages };
      case 'REQUEST_AUDIO_LIST':
        return { success: true, items: demoAudios };
      case 'GET_TEXT_CONTENT':
        return { success: true, content: demoText };
      case 'GET_TEXT_SELECTION':
        return { success: true, content: demoSelection };
      case 'ENABLE_FEATURES':
        return { success: true };
      case 'CONTROL_VIDEO':
        return { success: true };
      case 'START_RECORD_VIDEO':
        return { success: false, error: '预览模式不执行真实录制' };
      case 'STOP_RECORD_VIDEO':
        return { success: false, error: '预览模式不执行真实录制' };
      default:
        return { success: true };
    }
  }

  /**
   * 派发一个运行时广播给已注册的侧栏监听器（用于演示跨面板状态更新）。
   * @param {any} message 消息体
   */
  function broadcast(message) {
    runtimeListeners.forEach((fn) => {
      try { fn(message, { id: 'preview' }, () => {}); } catch (e) { /* 忽略监听器异常 */ }
    });
  }

  /** chrome.tabs 桩 */
  const tabsApi = {
    query(queryInfo, cb) {
      const q = queryInfo || {};
      let list = tabs.slice();
      if (q.active) list = list.filter((t) => t.active);
      return reply(cb, list);
    },
    get(tabId, cb) {
      const t = tabs.find((x) => x.id === tabId) || tabs[0];
      return reply(cb, t);
    },
    sendMessage(tabId, msg, options, cb) {
      // 兼容 (tabId, msg, cb) 与 (tabId, msg, options, cb) 两种写法
      let callback = cb;
      if (typeof options === 'function') callback = options;
      return reply(callback, routeTabMessage(msg));
    },
    create(props, cb) {
      if (props && props.url) window.open(props.url, '_blank');
      return reply(cb, { id: 99 });
    },
    captureVisibleTab(windowId, options, cb) {
      let callback = cb;
      if (typeof windowId === 'function') callback = windowId;
      // 生成一张画布快照作为演示数据，避免未定义
      let dataUrl = '';
      try {
        const c = document.createElement('canvas');
        c.width = 480; c.height = 270;
        const g = c.getContext('2d');
        const grad = g.createLinearGradient(0, 0, 480, 270);
        grad.addColorStop(0, '#1e293b');
        grad.addColorStop(1, '#2563eb');
        g.fillStyle = grad; g.fillRect(0, 0, 480, 270);
        g.fillStyle = '#ffffff'; g.font = 'bold 20px sans-serif';
        g.fillText('camera frame preview', 120, 145);
        dataUrl = c.toDataURL('image/png');
      } catch (e) { dataUrl = ''; }
      return reply(callback, dataUrl);
    },
    onActivated: {
      addListener(fn) { tabEventListeners.set('onActivated', fn); },
      removeListener(fn) { if (tabEventListeners.get('onActivated') === fn) tabEventListeners.delete('onActivated'); },
    },
    onRemoved: {
      addListener(fn) { tabEventListeners.set('onRemoved', fn); },
      removeListener(fn) { if (tabEventListeners.get('onRemoved') === fn) tabEventListeners.delete('onRemoved'); },
    },
    onUpdated: {
      addListener(fn) { tabEventListeners.set('onUpdated', fn); },
      removeListener(fn) { if (tabEventListeners.get('onUpdated') === fn) tabEventListeners.delete('onUpdated'); },
    },
    onCreated: {
      addListener(fn) { tabEventListeners.set('onCreated', fn); },
      removeListener(fn) { if (tabEventListeners.get('onCreated') === fn) tabEventListeners.delete('onCreated'); },
    },
  };

  /** chrome.runtime 桩 */
  const runtimeApi = {
    id: 'preview-extension',
    lastError: undefined,
    getURL(p) {
      return '/' + String(p || '').replace(/^[/\\]+/, '');
    },
    sendMessage(...args) {
      // 支持 (msg) / (msg, cb) / (extId, msg, cb) 三种调用形态
      let callback;
      let msg;
      if (typeof args[0] === 'string') { msg = args[1]; callback = args[2]; }
      else { msg = args[0]; callback = args[1]; }
      return reply(callback, routeRuntimeMessage(msg));
    },
    onMessage: {
      addListener(fn) { runtimeListeners.push(fn); },
      removeListener(fn) {
        const i = runtimeListeners.indexOf(fn);
        if (i >= 0) runtimeListeners.splice(i, 1);
      },
    },
    onInstalled: { addListener() {}, removeListener() {} },
    onConnect: { addListener() {}, removeListener() {} },
    connectNative() {
      throw new Error('预览模式不支持 Native Messaging');
    },
  };

  /** chrome.storage 桩 */
  const storageApi = {
    local: {
      get(keys, cb) { return reply(cb, storageGet(keys)); },
      set(items, cb) { storageSet(items); return reply(cb, undefined); },
      remove(keys, cb) {
        const arr = Array.isArray(keys) ? keys : [keys];
        const changes = {};
        arr.forEach((k) => { changes[k] = { oldValue: storageData[k], newValue: undefined }; delete storageData[k]; });
        try { localStorage.setItem(storageKey, JSON.stringify(storageData)); } catch (e) { /* 忽略 */ }
        storageListeners.forEach((fn) => { try { fn(changes, 'local'); } catch (e) { /* 忽略 */ } });
        return reply(cb, undefined);
      },
      clear(cb) {
        storageData = {};
        try { localStorage.removeItem(storageKey); } catch (e) { /* 忽略 */ }
        return reply(cb, undefined);
      },
    },
    onChanged: {
      addListener(fn) { storageListeners.push(fn); },
      removeListener(fn) {
        const i = storageListeners.indexOf(fn);
        if (i >= 0) storageListeners.splice(i, 1);
      },
    },
  };

  /** chrome.downloads 桩 */
  const downloadsApi = {
    download(options, cb) {
      return reply(cb, 1000 + (++seq));
    },
    onChanged: { addListener() {}, removeListener() {} },
  };

  /** chrome.scripting 桩 */
  const scriptingApi = {
    executeScript(options, cb) {
      return reply(cb, [{ result: null }]);
    },
  };

  /** chrome.webNavigation 桩 */
  const webNavigationApi = {
    getAllFrames(details, cb) {
      return reply(cb, []);
    },
  };

  /** chrome.tabCapture 桩 */
  const tabCaptureApi = {
    getMediaStreamId(options, cb) {
      return reply(cb, null);
    },
  };

  /** 已知 API 集合 */
  const chromeApi = {
    runtime: runtimeApi,
    tabs: tabsApi,
    storage: storageApi,
    downloads: downloadsApi,
    scripting: scriptingApi,
    webNavigation: webNavigationApi,
    tabCapture: tabCaptureApi,
  };

  /**
   * 用 Proxy 兜底未实现的 API 命名空间（例如 chrome.i18n、chrome.sidePanel），
   * 避免页面在访问未桩化属性时直接抛错白屏。
   */
  const safeChrome = new Proxy(chromeApi, {
    get(target, prop) {
      if (prop in target) return target[prop];
      return new Proxy({}, {
        get() { return function () {}; },
      });
    },
  });

  // 暴露到全局，供 dist-preview 里的侧栏代码使用
  globalThis.chrome = safeChrome;
  // 方便调试：在控制台手动触发广播/查询桩数据
  globalThis.__preview = { broadcast, tabs, demoVideos, demoImages, demoAudios, demoText };
  console.log('[preview] chrome API 桩已注入：数据为演示用假数据');
})();
