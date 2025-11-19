/**
 * 内容脚本 - 在支持的网站上提取页面内容
 */

// ==================== 常量定义 ====================
// 支持的网站列表 - 确保与background.js和config.js保持一致
const SUPPORTED_SITES = [
  {
    id: 'bilibili',
    name: '哔哩哔哩',
    enabled: true,
    domains: ['bilibili.com', 'b23.tv'],
    patterns: ['*://*.bilibili.com/video/*', '*://b23.tv/*']
  },
  {
    id: 'youtube',
    name: 'YouTube',
    enabled: true,
    domains: ['youtube.com', 'youtu.be'],
    patterns: ['*://*.youtube.com/watch*', '*://youtu.be/*']
  },
  {
    id: 'zhihu',
    name: '知乎',
    enabled: true,
    domains: ['zhihu.com'],
    patterns: ['*://*.zhihu.com/question/*', '*://*.zhihu.com/zvideo/*']
  },
  {
    id: 'douyin',
    name: '抖音',
    enabled: true,
    domains: ['douyin.com'],
    patterns: ['*://*.douyin.com/video/*', '*://*.douyin.com/discover*']
  },
  {
    id: 'weibo',
    name: '微博',
    enabled: true,
    domains: ['weibo.com'],
    patterns: ['*://*.weibo.com/*']
  },
  {
    id: 'xiaohongshu',
    name: '小红书',
    enabled: true,
    domains: ['xiaohongshu.com'],
    patterns: ['*://*.xiaohongshu.com/explore/*']
  },
  {
    id: 'npr',
    name: 'NPR',
    enabled: true,
    domains: ['npr.org'],
    patterns: ['*://*.npr.org/*']
  }
];

// 全局变量
let config = null;
let siteInfo = null;

// 初始化
async function initialize() {
  console.log('内容脚本初始化');
  
  setupUrlChangeListener();
  await updatePageInfo();
  
  // 监听来自扩展的消息
  chrome.runtime.onMessage.addListener(handleMessage);
  
  // 监听窗口消息
  setupWindowMessageListener();
}

// 设置窗口消息监听器，处理iframe通信
function setupWindowMessageListener() {
  window.addEventListener('message', (event) => {
    console.log('收到窗口消息:', event.data);
    
    // 确保消息有效且有action属性
    if (!event.data || !event.data.action) {
      return;
    }
    
    // 处理不同类型的action
    switch (event.data.action) {
      case 'playVideo':
        console.log('收到播放视频消息');
        const video = document.querySelector('video');
        if (video) {
          console.log('尝试播放视频元素');
          video.play()
            .then(() => console.log('通过消息播放视频成功'))
            .catch(err => console.error('通过消息播放视频失败:', err));
        } else {
          console.log('未找到视频元素，尝试点击播放按钮');
          const playBtn = document.querySelector('.xgplayer-play') || 
                          document.querySelector('[class*="play"]') ||
                          document.querySelector('[aria-label*="播放"]');
          if (playBtn) {
            playBtn.click();
          }
        }
        break;
        
      case 'pauseVideo':
        console.log('收到暂停视频消息');
        const videoToPause = document.querySelector('video');
        if (videoToPause) {
          console.log('尝试暂停视频元素');
          videoToPause.pause();
        } else {
          console.log('未找到视频元素，尝试点击暂停按钮');
          const pauseBtn = document.querySelector('.xgplayer-pause') || 
                           document.querySelector('[class*="pause"]') ||
                           document.querySelector('[aria-label*="暂停"]');
          if (pauseBtn) {
            pauseBtn.click();
          }
        }
        break;
        
      // 可以添加其他消息类型处理
    }
  });
  
  console.log('已设置窗口消息监听器');
}

// 快速检查网站类型（不依赖配置）
function quickCheckSite(url) {
  if (!url) return null;
  
  // 转换为小写，便于匹配
  const lowercaseUrl = url.toLowerCase();
  
  for (const site of SUPPORTED_SITES) {
    if (site.domains.some(domain => lowercaseUrl.includes(domain.toLowerCase()))) {
      return site;
    }
  }
  
  return null;
}

// 加载配置
async function loadConfiguration() {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: 'GET_CONFIG' }, (response) => {
      if (chrome.runtime.lastError) {
        console.error('加载配置失败:', chrome.runtime.lastError);
        
        // 通信失败时使用内部默认配置
        config = { supportedSites: SUPPORTED_SITES };
        console.log('使用内部默认配置');
        
      } else if (response && response.config) {
        config = response.config;
        console.log('已加载配置，支持的网站数量:', 
                   config.supportedSites ? config.supportedSites.length : 0);
                   
        // 如果配置中的supportedSites为空，使用内部默认配置
        if (!config.supportedSites || config.supportedSites.length === 0) {
          console.log('配置中没有支持的网站，使用内部默认配置');
          config.supportedSites = SUPPORTED_SITES;
        }
      } else {
        // 没有返回配置时使用内部默认配置
        config = { supportedSites: SUPPORTED_SITES };
        console.log('后台未返回配置，使用内部默认配置');
      }
      
      // 获取当前网站信息
      const url = window.location.href;
      
      // 如果快速检测没有找到网站信息，使用配置再次检测
      if (!siteInfo) {
        siteInfo = getSiteInfo(url, config);
      }
      
      console.log('当前网站:', siteInfo ? siteInfo.id : '不支持的网站', 
                 '当前URL:', url.substring(0, 100) + (url.length > 100 ? '...' : ''));
                 
      // 发送状态消息到侧边栏
      try {
        chrome.runtime.sendMessage({
          type: 'CONTENT_SITE_INFO',
          data: {
            url: url,
            siteInfo: siteInfo,
            supported: !!siteInfo
          }
        });
      } catch (e) {
        console.error('发送网站信息到后台失败:', e);
      }
      
      resolve();
    });
  });
}

// 处理来自扩展的消息
function handleMessage(message, sender, sendResponse) {
  if (!message || !message.type) {
    sendResponse({ success: false, error: '无效的消息' });
    return;
  }
  
  switch (message.type) {
    case 'GET_PAGE_INFO':
      getPageInfo().then(sendResponse);
      return true; // 异步响应
    
    case 'REQUEST_AUDIO_LIST': {
      try {
        const items = scanAudioUrls();
        sendResponse({ success: true, items });
      } catch (e) {
        sendResponse({ success: false, error: e?.message || String(e) });
      }
      return true;
    }
    
    // 获取当前页面的视频列表（用于侧边栏展示）
    case 'GET_VIDEO_LIST': {
      try {
        const videos = scanVideoElements();
        sendResponse({ success: true, videos });
      } catch (e) {
        sendResponse({ success: false, error: e?.message || String(e) });
      }
      return true;
    }
    
    // 按索引控制某一个视频的播放/暂停
    case 'CONTROL_VIDEO': {
      try {
        const { index, action } = message || {};
        const ok = controlVideoByIndex(index, action);
        sendResponse({ success: ok, index });
      } catch (e) {
        sendResponse({ success: false, error: e?.message || String(e) });
      }
      return true;
    }
      
    case 'PLAY_VIDEO':
      playVideo().then(sendResponse);
      return true;
      
    case 'PAUSE_VIDEO':
      pauseVideo().then(sendResponse);
      return true;
      
    case 'ANALYZE_CONTENT':
      analyzeContent().then(sendResponse);
      return true;
    
    case 'START_RECORD_VIDEO': {
      startVideoRecordingSession(message.index)
        .then(sendResponse)
        .catch((err) => {
          console.error('开始录制失败:', err);
          sendResponse({ success: false, error: err?.message || String(err) });
        });
      return true;
    }
    
    case 'STOP_RECORD_VIDEO': {
      stopVideoRecordingSession(message.index)
        .then(sendResponse)
        .catch((err) => {
          console.error('停止录制失败:', err);
          sendResponse({ success: false, error: err?.message || String(err) });
        });
      return true;
    }

    case 'START_AUDIO_RECORD': {
      startAudioRecordingSession(message.index)
        .then(sendResponse)
        .catch((err) => {
          console.error('开始音频录制失败:', err);
          sendResponse({ success: false, error: err?.message || String(err) });
        });
      return true;
    }

    case 'STOP_AUDIO_RECORD': {
      stopAudioRecordingSession(message.index)
        .then(sendResponse)
        .catch((err) => {
          console.error('停止音频录制失败:', err);
          sendResponse({ success: false, error: err?.message || String(err) });
        });
      return true;
    }

    case 'REQUEST_VIDEO_SOURCES': {
      try {
        const { index } = message || {};
        const sources = getVideoSourceCandidatesByIndex(index);
        sendResponse({
          success: true,
          sources,
          meta: {
            siteName: siteInfo?.name || '',
            siteId: siteInfo?.id || '',
            title: document.title || '',
            pageUrl: window.location.href
          }
        });
      } catch (err) {
        console.error('获取视频源失败:', err);
        sendResponse({ success: false, error: err?.message || String(err) });
      }
      return true;
    }
      
    default:
      sendResponse({ success: false, error: '未知的消息类型' });
      return false;
  }
}

// 扫描页面中的所有 video 元素，提取基础信息
// 该函数用于满足 R-VID-DET-001：识别页面内所有 <video> 元素
function scanVideoElements() {
  const list = [];
  try {
    const videos = document.querySelectorAll('video');
    let idx = 0;
    videos.forEach((v) => {
      try {
        const rect = v.getBoundingClientRect();
        const src = v.currentSrc || v.src || '';
        const directSources = collectVideoSourceCandidates(v);
        list.push({
          index: idx,
          src,
          width: v.videoWidth || rect.width || 0,
          height: v.videoHeight || rect.height || 0,
          duration: isFinite(v.duration) ? v.duration : 0,
          muted: !!v.muted,
          visible: rect.width > 0 && rect.height > 0,
          directSources,
          directSourceCount: directSources.length
        });
        idx += 1;
      } catch (_) {
        // 单个元素失败不影响整体
      }
    });
  } catch (e) {
    console.error('扫描视频元素失败:', e);
  }
  return list;
}

function resolveDownloadableUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') return '';
  const trimmed = rawUrl.trim();
  if (!trimmed) return '';
  if (/^(blob:|data:|mediasource:|javascript:|chrome-extension:)/i.test(trimmed)) {
    return '';
  }
  try {
    const absolute = new URL(trimmed, document.baseURI).href;
    if (!/^https?:/i.test(absolute)) return '';
    return absolute;
  } catch (error) {
    return '';
  }
}

function guessExtensionFromUrl(url = '') {
  try {
    const sanitized = url.split('?')[0].split('#')[0] || '';
    const lastSegment = sanitized.substring(sanitized.lastIndexOf('/') + 1);
    const match = lastSegment.match(/\.([a-z0-9]{2,5})$/i);
    return match ? match[1].toLowerCase() : '';
  } catch (error) {
    return '';
  }
}

function guessMimeFromUrl(url = '') {
  const ext = guessExtensionFromUrl(url);
  switch (ext) {
    case 'mp4':
      return 'video/mp4';
    case 'webm':
      return 'video/webm';
    case 'mkv':
      return 'video/x-matroska';
    case 'mov':
      return 'video/quicktime';
    case 'm3u8':
      return 'application/vnd.apple.mpegurl';
    case 'ts':
      return 'video/mp2t';
    case 'flv':
      return 'video/x-flv';
    default:
      return '';
  }
}

function guessExtensionFromMime(mime = '') {
  if (!mime) return '';
  const lower = mime.toLowerCase();
  if (lower.includes('mp4')) return 'mp4';
  if (lower.includes('webm')) return 'webm';
  if (lower.includes('matroska') || lower.includes('mkv')) return 'mkv';
  if (lower.includes('quicktime') || lower.includes('mov')) return 'mov';
  if (lower.includes('mpegurl') || lower.includes('m3u8')) return 'm3u8';
  if (lower.includes('mp2t') || lower.includes('ts')) return 'ts';
  if (lower.includes('flv')) return 'flv';
  return '';
}

function collectVideoSourceCandidates(video) {
  if (!video) return [];
  const results = [];
  const seen = new Set();
  const pushCandidate = (rawUrl, label, mimeType) => {
    const normalized = resolveDownloadableUrl(rawUrl);
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    const inferredMime = mimeType || guessMimeFromUrl(normalized) || '';
    const extension = guessExtensionFromUrl(normalized) || guessExtensionFromMime(inferredMime) || '';
    results.push({
      url: normalized,
      label: label || 'source',
      mimeType: inferredMime,
      extension
    });
  };

  try {
    pushCandidate(video.currentSrc, 'currentSrc');
    pushCandidate(video.src, 'src');
    pushCandidate(video.getAttribute('src'), 'attr:src');
    pushCandidate(video.getAttribute('data-src'), 'data-src');
    pushCandidate(video.getAttribute('data-url'), 'data-url');

    const sourceNodes = video.querySelectorAll('source');
    sourceNodes.forEach((node, idx) => {
      const nodeSrc = node.src || node.getAttribute('src');
      const nodeType = node.type || node.getAttribute('type') || '';
      pushCandidate(nodeSrc, nodeType || `source#${idx}`, nodeType);
      if (node.dataset && node.dataset.src) {
        pushCandidate(node.dataset.src, nodeType || `data-source#${idx}`, nodeType);
      }
    });
  } catch (error) {
    console.warn('收集视频源失败:', error);
  }

  return results;
}

function getVideoSourceCandidatesByIndex(index) {
  const video = getVideoElementByIndex(index);
  if (!video) return [];
  return collectVideoSourceCandidates(video);
}

// 根据索引控制指定 video 的播放或暂停
// 该函数用于满足 R-VID-CTRL-001：对选中视频执行播放/暂停
function controlVideoByIndex(index, action) {
  try {
    const videos = document.querySelectorAll('video');
    if (!videos.length) return false;
    const target = videos[index] || videos[0];
    if (!target) return false;
    if (action === 'play') {
      target.play().catch((e) => {
        console.warn('播放视频失败:', e);
      });
    } else if (action === 'pause') {
      target.pause();
    } else if (action === 'toggle') {
      if (target.paused) {
        target.play().catch((e) => {
          console.warn('播放视频失败:', e);
        });
      } else {
        target.pause();
      }
    }
    return true;
  } catch (e) {
    console.error('控制视频失败:', e);
    return false;
  }
}

function getVideoElementByIndex(index) {
  const videos = document.querySelectorAll('video');
  if (!videos.length) return null;
  if (typeof index === 'number' && index >= 0 && index < videos.length) {
    return videos[index];
  }
  return videos[0];
}

const recordingSessionKey = '__cpRecordSession';

function getActiveRecordingSession() {
  return window[recordingSessionKey] || null;
}

function setActiveRecordingSession(session) {
  window[recordingSessionKey] = session;
}

function clearActiveRecordingSession() {
  window[recordingSessionKey] = null;
}

function notifyRecordingStatus(payload) {
  try {
    chrome.runtime.sendMessage({
      type: 'VIDEO_RECORDING_STATUS',
      ...payload
    });
  } catch (error) {
    console.warn('发送录制状态失败:', error);
  }
}

function pickSupportedMimeType(candidates) {
  for (const candidate of candidates) {
    if (MediaRecorder.isTypeSupported(candidate)) {
      return candidate;
    }
  }
  return '';
}

function sanitizeFileName(name) {
  return (name || 'video')
    .trim()
    .replace(/[\/:*?"<>|]/g, '_')
    .replace(/\s+/g, '_')
    .substring(0, 80) || 'video';
}

function buildRecordingFileName(mode) {
  const baseTitle = sanitizeFileName(document.title || 'video');
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const suffix = mode === 'audio' ? '_audio' : '_record';
  const ext = mode === 'audio' ? '.webm' : '.webm';
  return `${baseTitle}_${timestamp}${suffix}${ext}`;
}

async function startVideoRecordingSession(index = 0) {
  return startRecordingSession({ index, mode: 'video' });
}

async function startAudioRecordingSession(index = 0) {
  return startRecordingSession({ index, mode: 'audio' });
}

async function startRecordingSession({ index = 0, mode = 'video' } = {}) {
  const activeSession = getActiveRecordingSession();
  if (activeSession && activeSession.recorder && activeSession.recorder.state === 'recording') {
    throw new Error('已有录制任务进行中');
  }
  const video = getVideoElementByIndex(index);
  if (!video) {
    throw new Error('未找到可录制的视频');
  }
  if (video.paused) {
    try {
      await video.play();
    } catch (e) {
      console.warn('自动播放失败:', e);
    }
  }
  const capture = video.captureStream || video.mozCaptureStream;
  if (!capture) {
    throw new Error('该视频不支持捕获流');
  }
  let stream;
  try {
    stream = capture.call(video);
  } catch (err) {
    throw new Error('捕获视频流失败: ' + (err?.message || err));
  }
  if (!stream) {
    throw new Error('无法获取视频流');
  }
  let targetStream = stream;
  let mimeCandidates;
  if (mode === 'audio') {
    const audioTracks = stream.getAudioTracks ? stream.getAudioTracks() : [];
    if (!audioTracks || !audioTracks.length) {
      throw new Error('未找到可用的音频轨道');
    }
    targetStream = new MediaStream();
    audioTracks.forEach((track) => targetStream.addTrack(track));
    mimeCandidates = [
      'audio/webm;codecs=opus',
      'audio/webm',
      'audio/ogg;codecs=opus'
    ];
  } else {
    mimeCandidates = [
      'video/webm;codecs=vp9,opus',
      'video/webm;codecs=vp8,opus',
      'video/webm'
    ];
  }

  const mimeType = pickSupportedMimeType(mimeCandidates);
  if (!mimeType) {
    throw new Error('浏览器不支持所需的录制格式');
  }
  const recorder = new MediaRecorder(targetStream, { mimeType });
  const chunks = [];
  const session = {
    recorder,
    chunks,
    mimeType,
    index,
    mode,
    startedAt: Date.now()
  };
  recorder.ondataavailable = (event) => {
    if (event.data && event.data.size > 0) {
      chunks.push(event.data);
    }
  };
  recorder.onerror = (event) => {
    console.error('记录器错误:', event?.error || event);
    notifyRecordingStatus({ status: 'error', index, error: event?.error?.message || event?.message || '录制出错' });
    clearActiveRecordingSession();
  };
  recorder.onstop = async () => {
    await finalizeRecordingSession(session);
  };
  recorder.start(1000);
  setActiveRecordingSession(session);
  notifyRecordingStatus({ status: 'started', index, startedAt: session.startedAt, mode: session.mode });
  return { success: true, startedAt: session.startedAt };
}

async function stopVideoRecordingSession(index = 0) {
  const session = getActiveRecordingSession();
  if (!session || !session.recorder) {
    throw new Error('当前没有录制任务');
  }
  if (typeof index === 'number' && session.index !== index) {
    console.warn('尝试停止的录制与当前索引不匹配，仍将停止当前录制');
  }
  if (session.recorder.state === 'inactive') {
    return { success: true };
  }
  session.recorder.stop();
  return { success: true };
}

async function stopAudioRecordingSession(index = 0) {
  return stopVideoRecordingSession(index);
}

async function finalizeRecordingSession(session) {
  clearActiveRecordingSession();
  if (!session.chunks || !session.chunks.length) {
    notifyRecordingStatus({ status: 'error', index: session.index, error: '没有录制到有效内容' });
    return;
  }
  try {
    const blob = new Blob(session.chunks, { type: session.mimeType || 'video/webm' });
    const buffer = await blob.arrayBuffer();
    const duration = Date.now() - (session.startedAt || Date.now());
    const fileName = buildRecordingFileName(session.mode);
    chrome.runtime.sendMessage({
      type: 'VIDEO_RECORDING_BLOB',
      payload: {
        index: session.index,
        mode: session.mode,
        buffer,
        mimeType: session.mimeType,
        fileName,
        duration,
        size: blob.size
      }
    });
    notifyRecordingStatus({ status: 'completed', index: session.index, fileName, duration, size: blob.size, mode: session.mode });
  } catch (error) {
    console.error('处理录制结果失败:', error);
    notifyRecordingStatus({ status: 'error', index: session.index, error: error?.message || '处理录制结果失败' });
  }
}

// 扫描页面中的音频资源链接（audio/src/source/a[href] 以及 og:audio）
function scanAudioUrls() {
  try {
    const results = [];
    const seen = new Set();
    const visitedJson = new WeakSet();

    const push = (url, title) => {
      try {
        if (!url) return;
        const abs = new URL(url, document.baseURI).href;
        if (seen.has(abs)) return;
        seen.add(abs);
        results.push({ url: abs, title: title || '' });
      } catch (_) { /* ignore invalid URL */ }
    };

    // audio 标签
    document.querySelectorAll('audio').forEach((a) => {
      const src = a.getAttribute('src');
      const title = a.getAttribute('title') || a.getAttribute('aria-label') || document.title;
      if (src) push(src, title);
      a.querySelectorAll('source').forEach((s) => {
        const ssrc = s.getAttribute('src');
        if (ssrc) push(ssrc, title);
      });
    });

    // a 标签中直接链接到音频文件
    const audioExt = /(\.mp3|\.m4a|\.aac|\.wav|\.ogg)(\?|#|$)/i;
    document.querySelectorAll('a[href]').forEach((link) => {
      const href = link.getAttribute('href');
      if (href && audioExt.test(href)) {
        const txt = (link.textContent || '').trim() || link.getAttribute('download') || link.getAttribute('title') || '';
        push(href, txt);
      }
    });

    // meta og:audio
    document.querySelectorAll('meta[property="og:audio"], meta[name="og:audio"], meta[property="og:audio:secure_url"], meta[name="og:audio:secure_url"]').forEach((m) => {
      const content = m.getAttribute('content');
      if (content) push(content, document.title);
    });

    // link rel audio/preload
    document.querySelectorAll('link[rel="alternate"][type^="audio/"] , link[rel="preload"][as="audio"], link[rel="preload"][as="audio/mpeg"]').forEach((link) => {
      const href = link.getAttribute('href');
      if (href) {
        const label = link.getAttribute('title') || link.getAttribute('type') || link.getAttribute('rel') || 'audio-link';
        push(href, label);
      }
    });

    const pickCandidateFromJson = (data, label) => {
      if (data === null || data === undefined) return;
      if (typeof data === 'string') {
        if (/^https?:/i.test(data) || audioExt.test(data)) {
          push(data, label || 'json');
        }
        return;
      }
      if (typeof data !== 'object') return;
      if (visitedJson.has(data)) return;
      visitedJson.add(data);
      if (Array.isArray(data)) {
        data.forEach((item, idx) => pickCandidateFromJson(item, `${label || 'json'}[${idx}]`));
        return;
      }
      const preferredKeys = ['contenturl', 'downloadurl', 'streamurl', 'audiourl', 'src', 'url', 'file', 'mp3'];
      Object.entries(data).forEach(([key, value]) => {
        const lowerKey = key.toLowerCase();
        if (preferredKeys.includes(lowerKey) || /audio|mp3|stream/i.test(lowerKey)) {
          pickCandidateFromJson(value, `${label || 'json'}.${key}`);
        } else if (typeof value === 'object') {
          pickCandidateFromJson(value, `${label || 'json'}.${key}`);
        }
      });
    };

    // data-play-props / data-audio attributes (常见于 NPR 页面)
    document.querySelectorAll('[data-play-props]').forEach((el, idx) => {
      const raw = el.getAttribute('data-play-props');
      if (!raw) return;
      try {
        const data = JSON.parse(raw);
        pickCandidateFromJson(data, `data-play-props#${idx}`);
      } catch (error) {
        console.debug('解析 data-play-props 失败:', error);
      }
    });

    document.querySelectorAll('[data-audio], [data-audio-url], [data-audio-src]').forEach((el, idx) => {
      const attrNames = ['data-audio', 'data-audio-url', 'data-audio-src'];
      attrNames.forEach((attr) => {
        const raw = el.getAttribute(attr);
        if (!raw) return;
        try {
          if (/^[\[{]/.test(raw.trim())) {
            pickCandidateFromJson(JSON.parse(raw), `${attr}#${idx}`);
          } else {
            push(raw, attr);
          }
        } catch (error) {
          push(raw, attr);
        }
      });
    });

    // JSON-LD 中的音频链接
    document.querySelectorAll('script[type="application/ld+json"]').forEach((script, idx) => {
      const text = script.textContent || script.innerText;
      if (!text) return;
      try {
        const json = JSON.parse(text);
        pickCandidateFromJson(json, `ld+json#${idx}`);
      } catch (error) {
        // ignore invalid json
      }
    });

    return results;
  } catch (e) {
    console.error('扫描音频链接失败:', e);
    return [];
  }
}

// 获取页面信息
async function getPageInfo() {
  try {
    if (!siteInfo) {
      return { success: false, error: '不支持的网站' };
    }
    
    const pageData = {};
    
    // 根据网站ID提取相应内容
    switch (siteInfo.id.toLowerCase()) {
      case 'bilibili':
        pageData.title = document.querySelector('h1.video-title')?.textContent?.trim() || '';
        pageData.uploader = document.querySelector('.up-name')?.textContent?.trim() || '';
        pageData.url = window.location.href;
        pageData.description = document.querySelector('.desc-info')?.textContent?.trim() || '';
        pageData.viewCount = document.querySelector('.view.item')?.textContent?.trim() || '';
        pageData.likeCount = document.querySelector('.like.item')?.textContent?.trim() || '';
        pageData.danmuCount = document.querySelector('.dm.item')?.textContent?.trim() || '';
        pageData.publishTime = document.querySelector('.pubdate-text')?.textContent?.trim() || '';
        pageData.tags = Array.from(document.querySelectorAll('.tag-link')).map(tag => tag.textContent.trim());
        break;
        
      case 'youtube':
        pageData.title = document.querySelector('h1.ytd-watch-metadata')?.textContent?.trim() || '';
        pageData.uploader = document.querySelector('#owner #channel-name')?.textContent?.trim() || '';
        pageData.url = window.location.href;
        pageData.description = document.querySelector('#description-inline-expander')?.textContent?.trim() || '';
        pageData.viewCount = document.querySelector('.view-count')?.textContent?.trim() || '';
        const likeButton = document.querySelector('button.yt-spec-button-shape-next--icon-button yt-formatted-string');
        pageData.likeCount = likeButton ? likeButton.textContent.trim() : '';
        pageData.publishTime = document.querySelector('#info-strings yt-formatted-string')?.textContent?.trim() || '';
        break;
        
      case 'douyin':
        pageData.title = document.querySelector('.VVX0yR36')?.textContent?.trim() || 
                         document.querySelector('.A1XYTxI5')?.textContent?.trim() || 
                         document.querySelector('.aQoncqRg')?.textContent?.trim() || '';
        pageData.uploader = document.querySelector('.yy3pFu0l a')?.textContent?.trim() || 
                            document.querySelector('.vCiuzZmL a')?.textContent?.trim() || '';
        pageData.url = window.location.href;
        pageData.description = document.querySelector('.HbzKJxgD')?.textContent?.trim() || 
                               document.querySelector('.EgRysJvN')?.textContent?.trim() || '';
        pageData.viewCount = document.querySelector('.CE7XkkTw')?.textContent?.trim() || '';
        pageData.likeCount = document.querySelector('.xm7LxYwy button:first-child')?.getAttribute('aria-label')?.replace(/\D/g, '') || '';
        pageData.commentCount = document.querySelector('.xm7LxYwy button:nth-child(2)')?.getAttribute('aria-label')?.replace(/\D/g, '') || '';
        pageData.publishTime = document.querySelector('.aQoncqRg')?.textContent?.trim() || '';
        pageData.tags = Array.from(document.querySelectorAll('.pFyasgy8')).map(tag => tag.textContent.trim());
        break;
        
      case 'zhihu':
        if (window.location.href.includes('/answer/')) {
          pageData.title = document.querySelector('.QuestionHeader-title')?.textContent?.trim() || '';
          pageData.uploader = document.querySelector('.AuthorInfo-name')?.textContent?.trim() || '';
          pageData.url = window.location.href;
          pageData.description = document.querySelector('.RichContent-inner')?.textContent?.trim() || '';
          pageData.viewCount = document.querySelector('.NumberBoard-itemValue')?.textContent?.trim() || '';
          pageData.publishTime = document.querySelector('.ContentItem-time')?.textContent?.trim() || '';
        }
        break;
        
      // 可根据需要添加其他网站
      default:
        pageData.title = document.title;
        pageData.url = window.location.href;
        pageData.content = document.body.textContent.substr(0, 5000); // 限制内容长度
    }
    
    // 返回提取的信息
    return { 
      success: true, 
      data: {
        siteId: siteInfo.id,
        pageInfo: pageData
      }
    };
  } catch (error) {
    console.error('获取页面信息错误:', error);
    return { success: false, error: error.message };
  }
}

// 播放视频
async function playVideo() {
  try {
    if (!siteInfo) {
      return { success: false, error: '不支持的网站' };
    }
    
    let video = null;
    
    // 根据网站获取视频元素
    switch (siteInfo.id.toLowerCase()) {
      case 'bilibili':
        console.log('尝试控制B站视频播放');
        // 尝试多种B站视频选择器
        video = document.querySelector('video.bilibili-player-video') || 
                document.querySelector('.bpx-player-video-wrap video') ||
                document.querySelector('.bilibili-player-area video') ||
                document.querySelector('.player-wrap video') ||
                document.querySelector('video');
                
        console.log('B站视频元素查找结果:', video ? '找到视频元素' : '未找到视频元素');
                
        // 如果没有找到视频元素，尝试点击播放按钮
        if (!video) {
          const playBtn = document.querySelector('.bilibili-player-video-btn-start') ||
                         document.querySelector('.bpx-player-ctrl-play') ||
                         document.querySelector('.bilibili-player-iconfont-start') ||
                         document.querySelector('.squirtle-video-start') ||
                         document.querySelector('.bilibili-player-dm-tip-wrap');
                         
          console.log('B站播放按钮查找结果:', playBtn ? '找到播放按钮' : '未找到播放按钮');
                         
          if (playBtn) {
            playBtn.click();
            console.log('已点击B站播放按钮');
            
            // 点击后再次尝试获取视频元素
            setTimeout(() => {
              const videoAfterClick = document.querySelector('video.bilibili-player-video') ||
                                     document.querySelector('.bpx-player-video-wrap video') ||
                                     document.querySelector('.bilibili-player-area video') ||
                                     document.querySelector('.player-wrap video') ||
                                     document.querySelector('video');
                                     
              if (videoAfterClick) {
                console.log('点击后找到B站视频元素，尝试播放');
                videoAfterClick.play()
                  .then(() => console.log('B站视频播放成功'))
                  .catch(err => console.error('B站视频播放失败:', err));
              }
            }, 500);
            
            return { success: true, message: '已尝试点击B站播放按钮' };
          }
        } else {
          // 尝试直接调用play方法并处理可能的Promise
          console.log('找到B站视频元素，尝试调用play()方法');
          try {
            const playPromise = video.play();
            if (playPromise !== undefined) {
              playPromise
                .then(() => console.log('B站视频播放成功'))
                .catch(err => {
                  console.error('B站视频播放失败:', err);
                  // 如果直接播放失败，尝试点击播放按钮
                  const playBtn = document.querySelector('.bilibili-player-video-btn-start') ||
                                document.querySelector('.bpx-player-ctrl-play') ||
                                document.querySelector('.bilibili-player-iconfont-start');
                  if (playBtn) {
                    console.log('尝试点击B站播放按钮');
                    playBtn.click();
                  }
                });
            }
          } catch (e) {
            console.error('B站视频播放异常:', e);
          }
        }
        break;
        
      case 'youtube':
        video = document.querySelector('video.html5-main-video');
        break;
        
      case 'douyin':
        // 先查找是否在iframe中或处理iframe中的视频
        if (handleDouyinIframeVideo('playVideo')) {
          console.log('已处理抖音iframe视频播放');
          return { success: true, message: '已尝试在iframe中播放视频' };
        }

        // 打印页面中所有视频元素，帮助调试
        const allVideos = document.querySelectorAll('video');
        console.log('页面中视频元素数量:', allVideos.length);
        if (allVideos.length > 0) {
          console.log('第一个视频元素类名:', allVideos[0].className);
          console.log('第一个视频元素父元素:', allVideos[0].parentElement?.className || '无父元素');
        }

        // 抖音视频元素选择器 - 增强版
        const douyinSelectors = [
          'video.xgplayer-video',
          '.tiktok-web-player video',
          '.player-container video',
          '.swiper-slide-active video',
          'video[src*="douyin"]',
          'xg-video video'
        ];
        
        // 尝试找到视频元素
        let videoFound = false;
        for (const selector of douyinSelectors) {
          const videos = document.querySelectorAll(selector);
          console.log(`选择器 ${selector} 找到 ${videos.length} 个视频元素`);
          
          for (const video of videos) {
            try {
              if (video) {
                video.play();
                console.log('成功播放视频元素', video);
                videoFound = true;
                return true;
              }
            } catch (e) {
              console.error(`尝试播放视频时出错: ${e.message}`);
            }
          }
        }
        
        // 如果没有找到视频元素，尝试点击播放按钮
        if (!videoFound) {
          console.log('未找到视频元素，尝试点击播放按钮');
          
          const playButtonSelectors = [
            '.xgplayer-play',
            '.xgplayer-play-img',
            '.xgplayer-icon-play',
            '.play-button',
            '[data-e2e="play-icon"]',
            '.video-play-btn'
          ];
          
          for (const selector of playButtonSelectors) {
            const playButton = document.querySelector(selector);
            if (playButton) {
              playButton.click();
              console.log('点击了播放按钮', selector);
              return true;
            }
          }
          
          // 尝试点击视频容器
          const containerSelectors = [
            '.xgplayer',
            '.video-container',
            '.player-container',
            '.swiper-slide-active',
            '[data-e2e="feed-video"]'
          ];
          
          for (const selector of containerSelectors) {
            const container = document.querySelector(selector);
            if (container) {
              container.click();
              console.log('点击了视频容器', selector);
              return true;
            }
          }
          
          // 检查是否在iframe中，如果是，向父页面发送消息
          if (window !== window.top) {
            console.log('在iframe中，向父页面发送播放消息');
            window.parent.postMessage({ action: 'playVideo' }, '*');
            return true;
          }
          
          console.error('无法找到抖音视频或播放按钮');
          return false;
        }
        break;
        
      case 'zhihu':
        // 知乎视频播放
        let zhihuVideo = document.querySelector('.ZVideoItem video');
        if (zhihuVideo) {
          zhihuVideo.play();
          return true;
        }
        break;
        
      // 其他站点...
      
      default:
        console.error('不支持的站点类型:', siteInfo.id);
        return false;
    }
    
    if (video) {
      video.play();
      return { success: true };
    } else {
      return { success: false, error: '未找到视频元素' };
    }
  } catch (error) {
    console.error('播放视频错误:', error);
    return { success: false, error: error.message };
  }
}

// 暂停视频
async function pauseVideo() {
  try {
    if (!siteInfo) {
      return { success: false, error: '不支持的网站' };
    }
    
    let video = null;
    
    // 根据网站获取视频元素
    switch (siteInfo.id.toLowerCase()) {
      case 'bilibili':
        console.log('尝试暂停B站视频');
        // 尝试多种B站视频选择器
        video = document.querySelector('video.bilibili-player-video') || 
                document.querySelector('.bpx-player-video-wrap video') ||
                document.querySelector('.bilibili-player-area video') ||
                document.querySelector('.player-wrap video') ||
                document.querySelector('video');
                
        console.log('B站视频元素查找结果:', video ? '找到视频元素' : '未找到视频元素');
                
        // 如果没有找到视频元素，尝试点击暂停按钮
        if (!video) {
          const pauseBtn = document.querySelector('.bilibili-player-video-btn-start.video-state-pause') ||
                          document.querySelector('.bpx-player-ctrl-play.bpx-player-ctrl-paused') ||
                          document.querySelector('.bilibili-player-iconfont-pause') ||
                          document.querySelector('.squirtle-video-pause');
                          
          console.log('B站暂停按钮查找结果:', pauseBtn ? '找到暂停按钮' : '未找到暂停按钮');
                          
          if (pauseBtn) {
            pauseBtn.click();
            console.log('已点击B站暂停按钮');
            return { success: true, message: '已尝试点击B站暂停按钮' };
          }
        } else {
          // 尝试直接调用pause方法
          console.log('找到B站视频元素，尝试调用pause()方法');
          try {
            video.pause();
            console.log('B站视频暂停成功');
          } catch (e) {
            console.error('B站视频暂停异常:', e);
            // 如果直接暂停失败，尝试点击暂停按钮
            const pauseBtn = document.querySelector('.bilibili-player-video-btn-start.video-state-pause') ||
                           document.querySelector('.bpx-player-ctrl-play.bpx-player-ctrl-paused') ||
                           document.querySelector('.bilibili-player-iconfont-pause');
            if (pauseBtn) {
              console.log('尝试点击B站暂停按钮');
              pauseBtn.click();
            }
          }
        }
        break;
        
      case 'youtube':
        video = document.querySelector('video.html5-main-video');
        break;
        
      case 'douyin':
        // 先查找是否在iframe中或处理iframe中的视频
        if (handleDouyinIframeVideo('pauseVideo')) {
          console.log('已处理抖音iframe视频暂停');
          return { success: true, message: '已尝试在iframe中暂停视频' };
        }
        
        // 打印页面中所有视频元素，帮助调试
        const allVideosForPause = document.querySelectorAll('video');
        console.log('页面中视频元素数量:', allVideosForPause.length);
        if (allVideosForPause.length > 0) {
          console.log('第一个视频元素类名:', allVideosForPause[0].className);
          console.log('第一个视频元素父元素:', allVideosForPause[0].parentElement?.className || '无父元素');
        }
        
        // 抖音视频元素选择器 - 增强版
        const douyinSelectorsForPause = [
          'video.xgplayer-video',
          '.tiktok-web-player video',
          '.player-container video',
          '.swiper-slide-active video',
          'video[src*="douyin"]',
          'xg-video video'
        ];
        
        // 尝试找到视频元素
        let videoFoundForPause = false;
        for (const selector of douyinSelectorsForPause) {
          const videosForPause = document.querySelectorAll(selector);
          console.log(`选择器 ${selector} 找到 ${videosForPause.length} 个视频元素`);
          
          for (const video of videosForPause) {
            try {
              if (video) {
                video.pause();
                console.log('成功暂停视频元素', video);
                videoFoundForPause = true;
                return true;
              }
            } catch (e) {
              console.error(`尝试暂停视频时出错: ${e.message}`);
            }
          }
        }
        
        // 如果没有找到视频元素，尝试点击暂停按钮
        if (!videoFoundForPause) {
          console.log('未找到视频元素，尝试点击暂停按钮');
          
          const pauseButtonSelectors = [
            '.xgplayer-pause',
            '.xgplayer-pause-img',
            '.xgplayer-icon-pause',
            '.pause-button',
            '[data-e2e="pause-icon"]',
            '.video-pause-btn'
          ];
          
          for (const selector of pauseButtonSelectors) {
            const pauseButton = document.querySelector(selector);
            if (pauseButton) {
              pauseButton.click();
              console.log('点击了暂停按钮', selector);
              return true;
            }
          }
          
          // 尝试点击视频容器
          const containerSelectors = [
            '.xgplayer',
            '.video-container',
            '.player-container',
            '.swiper-slide-active',
            '[data-e2e="feed-video"]'
          ];
          
          for (const selector of containerSelectors) {
            const container = document.querySelector(selector);
            if (container) {
              container.click();
              console.log('点击了视频容器', selector);
              return true;
            }
          }
          
          // 检查是否在iframe中，如果是，向父页面发送消息
          if (window !== window.top) {
            console.log('在iframe中，向父页面发送暂停消息');
            window.parent.postMessage({ action: 'pauseVideo' }, '*');
            return true;
          }
          
          console.error('无法找到抖音视频或暂停按钮');
          return false;
        }
        break;
        
      case 'zhihu':
        // 知乎视频暂停
        let zhihuVideo = document.querySelector('.ZVideoItem video');
        if (zhihuVideo) {
          zhihuVideo.pause();
          return true;
        }
        break;
        
      // 其他站点...
      
      default:
        console.error('不支持的站点类型:', siteInfo.id);
        return false;
    }
    
    if (video) {
      video.pause();
      return { success: true };
    } else {
      return { success: false, error: '未找到视频元素' };
    }
  } catch (error) {
    console.error('暂停视频错误:', error);
    return { success: false, error: error.message };
  }
}

// 分析页面内容
async function analyzeContent() {
  try {
    // 获取页面信息
    const pageInfoResult = await getPageInfo();
    
    if (!pageInfoResult.success) {
      return pageInfoResult;
    }
    
    // 页面信息提取成功
    const { siteId, pageInfo } = pageInfoResult.data;
    
    // 获取页面文本内容（例如评论、描述等）
    let textContent = '';
    
    // 根据网站获取文本内容
    switch (siteId.toLowerCase()) {
      case 'bilibili':
        // 获取视频描述
        textContent += '视频描述: ' + (pageInfo.description || '无描述') + '\n\n';
        
        // 获取评论
        const comments = Array.from(document.querySelectorAll('.reply-item')).slice(0, 10); // 限制评论数量
        if (comments.length > 0) {
          textContent += '热门评论:\n';
          comments.forEach((comment, index) => {
            const username = comment.querySelector('.user-name')?.textContent?.trim() || '匿名用户';
            const content = comment.querySelector('.reply-content')?.textContent?.trim() || '';
            textContent += `${index + 1}. ${username}: ${content}\n`;
          });
        }
        break;
        
      case 'youtube':
        // 获取视频描述
        textContent += '视频描述: ' + (pageInfo.description || '无描述') + '\n\n';
        
        // 获取评论 (YouTube需要滚动加载评论，可能不完整)
        const ytComments = Array.from(document.querySelectorAll('ytd-comment-renderer')).slice(0, 10);
        if (ytComments.length > 0) {
          textContent += '热门评论:\n';
          ytComments.forEach((comment, index) => {
            const username = comment.querySelector('#author-text')?.textContent?.trim() || '匿名用户';
            const content = comment.querySelector('#content')?.textContent?.trim() || '';
            textContent += `${index + 1}. ${username}: ${content}\n`;
          });
        }
        break;
        
      default:
        // 对于其他网站，获取一般内容
        const paragraphs = Array.from(document.querySelectorAll('p')).slice(0, 20);
        textContent = paragraphs.map(p => p.textContent.trim()).join('\n\n');
    }
    
    // 将文本内容添加到页面信息中
    pageInfo.textContent = textContent;
    
    return { 
      success: true, 
      data: {
        siteId,
        pageInfo
      }
    };
  } catch (error) {
    console.error('分析内容错误:', error);
    return { success: false, error: error.message };
  }
}

// 根据URL获取网站信息
function getSiteInfo(url, config) {
  console.log('开始检查网站信息. URL:', url);
  
  if (!url) {
    console.error('URL为空');
    return null;
  }
  
  // 首先尝试使用快速检测方法
  const quickResult = quickCheckSite(url);
  if (quickResult) {
    console.log('通过快速检测找到网站:', quickResult.id);
    return quickResult;
  }
  
  // 如果快速检测失败，尝试使用配置
  if (!config || !config.supportedSites || !Array.isArray(config.supportedSites)) {
    console.error('配置无效或supportedSites不是数组');
    return null;
  }
  
  // 标准化URL以便更好地匹配
  const normalizedUrl = url.toLowerCase();
  
  // 遍历所有支持的网站
  for (const site of config.supportedSites) {
    if (!site.enabled) {
      continue;
    }
    
    if (!site.domains || !Array.isArray(site.domains)) {
      continue;
    }
    
    // 检查域名匹配
    for (const domain of site.domains) {
      if (normalizedUrl.includes(domain.toLowerCase())) {
        console.log(`找到匹配的网站: ${site.id || site.name}, 匹配域名: ${domain}`);
        return site;
      }
    }
  }
  
  console.warn('没有找到匹配的网站');
  return null;
}

// 处理抖音iframe内的视频
function handleDouyinIframeVideo(action) {
  console.log('尝试处理抖音iframe内的视频，操作:', action);
  
  // 查找所有iframe元素
  const iframes = document.querySelectorAll('iframe');
  console.log('页面中iframe数量:', iframes.length);
  
  if (iframes.length === 0) {
    return false;
  }
  
  // 尝试给每个iframe注入脚本
  let success = false;
  
  // 发送消息给父页面
  try {
    window.parent.postMessage({ action: action }, '*');
    console.log('已向父页面发送消息:', action);
    success = true;
  } catch (e) {
    console.error('向父页面发送消息失败', e);
  }
  
  // 尝试直接操作每个iframe
  Array.from(iframes).forEach((iframe, index) => {
    try {
      console.log(`处理第${index+1}个iframe:`, iframe.src || 'iframe无src属性');
      
      // 尝试访问iframe内容
      const iframeDocument = iframe.contentDocument || iframe.contentWindow?.document;
      if (iframeDocument) {
        console.log('成功访问iframe文档');
        
        // 查找iframe内的视频元素
        const iframeVideo = iframeDocument.querySelector('video');
        if (iframeVideo) {
          console.log('在iframe中找到视频元素');
          
          if (action === 'playVideo') {
            iframeVideo.play()
              .then(() => console.log('iframe视频播放成功'))
              .catch(err => console.error('iframe视频播放失败:', err));
          } else if (action === 'pauseVideo') {
            iframeVideo.pause();
            console.log('iframe视频暂停成功');
          }
          
          success = true;
        } else {
          console.log('iframe中未找到视频元素');
          
          // 尝试点击iframe中的播放/暂停按钮
          const btnSelector = action === 'playVideo' 
            ? '.xgplayer-play, [class*="play"], [aria-label*="播放"]'
            : '.xgplayer-pause, [class*="pause"], [aria-label*="暂停"]';
            
          const button = iframeDocument.querySelector(btnSelector);
          if (button) {
            console.log(`在iframe中找到${action === 'playVideo' ? '播放' : '暂停'}按钮`);
            button.click();
            success = true;
          }
          
          // 如果没有找到按钮，尝试点击视频容器
          if (!button) {
            const container = iframeDocument.querySelector('.xgplayer, [class*="player"], [class*="video"]');
            if (container) {
              console.log('尝试点击iframe中的视频容器');
              container.click();
              success = true;
            }
          }
        }
      } else {
        console.log('无法访问iframe内容，可能是跨域限制');
      }
    } catch (e) {
      console.error(`处理iframe ${index+1} 失败:`, e);
    }
  });
  
  return success;
}

// 新增：更新页面信息的函数
async function updatePageInfo() {
  const url = window.location.href;
  const config = await loadConfiguration();
  const site = getSiteInfo(url, config);
  
  console.log('发送页面更新信息:', {
    url: url,
    siteInfo: site,
    supported: !!site
  });
  
  try {
    chrome.runtime.sendMessage({
      type: 'PAGE_INFO_UPDATED',
      data: {
        url: url,
        siteInfo: site,
        supported: !!site,
        pageInfo: await getBasicPageInfo(site)
      }
    });
  } catch (e) {
    console.error('发送页面信息失败:', e);
  }
}

// 新增：获取基本页面信息
async function getBasicPageInfo(site) {
  if (!site) return null;
  
  const pageData = {};
  
  switch (site.id.toLowerCase()) {
    case 'bilibili':
      pageData.title = document.querySelector('h1.video-title')?.textContent?.trim() || '';
      pageData.uploader = document.querySelector('.up-name')?.textContent?.trim() || '';
      break;
      
    case 'douyin':
      pageData.title = document.querySelector('.VVX0yR36, .aQoncqRg')?.textContent?.trim() || '';
      pageData.uploader = document.querySelector('.yy3pFu0l a, .vCiuzZmL a')?.textContent?.trim() || '';
      break;
      
    // 其他网站...
  }
  
  pageData.url = window.location.href;
  return pageData;
}

// 添加URL变化监听
function setupUrlChangeListener() {
  let lastUrl = window.location.href;

  // 监听 History API 变化
  const pushState = window.history.pushState;
  window.history.pushState = function() {
    pushState.apply(history, arguments);
    onUrlChange();
  };

  const replaceState = window.history.replaceState;
  window.history.replaceState = function() {
    replaceState.apply(history, arguments);
    onUrlChange();
  };

  window.addEventListener('popstate', onUrlChange);

  // 使用 MutationObserver 监听 DOM 变化
  const observer = new MutationObserver(() => {
    if (window.location.href !== lastUrl) {
      lastUrl = window.location.href;
      onUrlChange();
    }
  });

  observer.observe(document.querySelector('head'), {
    childList: true,
    subtree: true
  });
}

// URL变化处理
async function onUrlChange() {
  console.log('URL已变化，更新页面信息');
  await updatePageInfo();
}

// 启动初始化
console.log('内容脚本初始化中...');
initialize();