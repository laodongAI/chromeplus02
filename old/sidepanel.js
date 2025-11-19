// 检查utils是否已加载
if (!window.utils) {
  console.warn('Utils库未预加载，尝试手动加载');
  
  // 创建utils.js的脚本标签
  const script = document.createElement('script');
  script.src = 'utils.js';
  script.onerror = () => {
    console.warn('加载utils.js失败，将启用最小后备 utils');
    
    // 创建一个基本的utils对象作为后备
    window.utils = {
      isSupportedSite: (url, config) => {
        if (!url || !config || !config.supportedSites) return false;
        return config.supportedSites.some(site => {
          if (!site.enabled) return false;
          return site.domains.some(domain => url.includes(domain));
        });
      },
      getSiteInfo: (url, config) => {
        if (!url || !config || !config.supportedSites) return null;
        return config.supportedSites.find(site => {
          if (!site.enabled) return false;
          return site.domains.some(domain => url.includes(domain));
        });
      },
      loadConfig: async () => {
        return new Promise((resolve) => {
          chrome.storage.local.get('config', (result) => {
            resolve(result.config || window.defaultConfig || {});
          });
        });
      },
      saveConfig: async (config) => {
        return new Promise((resolve) => {
          chrome.storage.local.set({ config }, resolve);
        });
      }
    };
  };
  document.head.appendChild(script);
}

let mediaRecorder = null;
let recordedChunks = [];
let activeTabId = null;
let currentSite = null;
let lastCheckedTabId = null;
let isRecording = false;
let recordingStartTime = null;
let statusPollInterval = null;
let lastClickedButton = null;
let analysisResult = null;

// Feature toggle: temporarily disable MCP-related functionality across UI and network layers.
const MCP_FEATURE_ENABLED = false;

// 用于兜底的最小配置，避免因缺少字段导致的 UI 崩溃
const minimalDefaultConfig = {
  interface: {
    theme: 'light',
    language: 'zh-CN'
  },
  recording: {
    format: 'webm',
    quality: 'high',
    autoSave: false
  },
  supportedSites: [
    {
      name: 'Bilibili',
      enabled: true,
      domains: ['bilibili.com', 'b23.tv'],
      patterns: ['*://*.bilibili.com/video/*', '*://b23.tv/*']
    }
  ],
  aiModels: [
    {
      id: 'moonshot',
      name: 'MoonShot',
      enabled: true,
      apiKey: '',
      apiUrl: 'https://api.moonshot.cn/v1/chat/completions',
      model: 'moonshot-v1-8k',
      temperature: 0.7,
      maxTokens: 1500
    },
    {
      id: 'openai',
      name: 'OpenAI',
      enabled: false,
      apiKey: '',
      apiUrl: 'https://api.openai.com/v1/chat/completions',
      model: 'gpt-3.5-turbo',
      temperature: 0.7,
      maxTokens: 1500
    }
  ],
  analysis: {
    defaultModel: 'moonshot',
    promptTemplates: {
      bilibili: `请分析以下B站视频信息，给出一个结构化总结，包括视频主题、关键内容、类型、风格等：\n\n标题：{title}\n发布者：{uploader}\nURL：{url}\n视频描述：{description}\n标签：{tags}\n观看次数：{viewCount}\n点赞次数：{likeCount}\n`
    }
  },
  fileStorage: {
    mcpEnabled: true,
    mcpStatus: 'unknown',
    savedPath: 'D:\\mcp\\mcp_result_files',
    filenameTemplate: '{siteName}_{title}_{date}',
    autoSave: false,
    mcpApiUrl: 'http://localhost:8888'
  }
};

let defaultConfigPromise = null;
function ensureDefaultConfigLoaded() {
  if (window.defaultConfig) {
    return Promise.resolve(window.defaultConfig);
  }
  if (defaultConfigPromise) {
    return defaultConfigPromise;
  }
  defaultConfigPromise = new Promise((resolve) => {
    const script = document.createElement('script');
    script.src = 'config.js';
    script.onload = () => {
      resolve(window.defaultConfig || minimalDefaultConfig);
    };
    script.onerror = () => {
      console.warn('加载config.js失败，将使用内置默认配置');
      resolve(minimalDefaultConfig);
    };
    document.head.appendChild(script);
  });
  return defaultConfigPromise;
}

// 配置相关变量
let config = null;
let configProfiles = [];
let currentProfileIndex = 0;

// 当前页面扫描到的视频列表（满足 R-VID-DET-001 的结果缓存）
let currentVideoList = [];
// 新增：视频选择与下载去重集合
const selectedVideos = new Set();
const downloadedVideos = new Set();
const videosState = {}; // {index:{playing:boolean}}
const videoRecordingState = {};
const videoDownloadState = {};
const audioRecordingState = {};
const audioValidationCache = new Map();
let hasPlayableVideo = false;

// 初始化并获取活动标签页
document.addEventListener('DOMContentLoaded', async () => {
  try {
    const baseConfig = await ensureDefaultConfigLoaded();
    config = ensureConfigStructure(JSON.parse(JSON.stringify(baseConfig)));
    window.appConfig = JSON.parse(JSON.stringify(config));

    configProfiles.push({
      name: '默认配置',
      isDefault: true,
      config: JSON.parse(JSON.stringify(config))
    });

    await loadConfigProfiles();
  } catch (error) {
    console.error('加载默认配置失败，将使用兜底配置:', error);
    config = ensureConfigStructure(JSON.parse(JSON.stringify(minimalDefaultConfig)));
    window.appConfig = JSON.parse(JSON.stringify(config));
    configProfiles = [{
      name: '默认配置',
      isDefault: true,
      config: JSON.parse(JSON.stringify(config))
    }];
  }

  await getActiveContentTabId(true); // 强制刷新活动标签页ID
  await loadConfig();
  updateUI();
  setupEventListeners();
  initializeTabNavigation();
  if (MCP_FEATURE_ENABLED) {
    checkMcpStatus();
  } else {
    markMcpFeatureDisabled();
  }
  updateAiModelSelector();
  updateProfileSelector();
  
  // 开始监听标签页变化
  startTabChangeMonitoring();

  // MCP 设置：填充与绑定事件（容错存在，即使元素不存在也安全）
  if (MCP_FEATURE_ENABLED) {
    try {
      await fillMcpSettingsFromStorage();
      const testBtn = document.getElementById('testMcpButton');
      if (testBtn) testBtn.addEventListener('click', testMcpConnection);
      const saveBtn = document.getElementById('saveSettingsButton');
      if (saveBtn) saveBtn.addEventListener('click', saveMcpSettingsPart);
    } catch (e) {
      console.warn('初始化 MCP 设置失败:', e);
    }
  }

  // 初始化时尝试刷新一次视频列表
  try {
    await refreshVideoList();
  } catch (e) {
    console.warn('初始化刷新视频列表失败:', e);
  }

  // 绑定新合并的播放/暂停按钮
  const playPauseBtn = document.getElementById('playPauseToggleButton');
  if (playPauseBtn) {
    playPauseBtn.addEventListener('click', () => {
      if (!currentVideoList.length) return;
      // 简单：控制第一个视频的 toggle
      controlVideo(0, 'toggle');
    });
  }

  // 绑定新合并的录制按钮
  const recordToggleBtn = document.getElementById('recordToggleButton');
  if (recordToggleBtn) {
    recordToggleBtn.addEventListener('click', () => {
      if (!currentVideoList.length) return;
      // 若有任意视频正在录制，停止第一个录制中的；否则开始录制第一个视频
      const activeIndex = Object.keys(videoRecordingState).find(i => videoRecordingState[i]?.recording);
      if (activeIndex !== undefined) {
        stopVideoRecordingByIndex(parseInt(activeIndex, 10));
      } else {
        startVideoRecordingByIndex(0);
      }
    });
  }

  // 刷新按钮
  const refreshVideoBtn = document.getElementById('refreshVideoButton');
  if (refreshVideoBtn) refreshVideoBtn.addEventListener('click', () => refreshVideoList());

  // 批量操作相关绑定
  const masterCb = document.getElementById('videoMasterCheckbox');
  if (masterCb) masterCb.addEventListener('change', () => {
    selectedVideos.clear();
    if (masterCb.checked) {
      currentVideoList.forEach((_, i) => selectedVideos.add(i));
    }
    renderVideoTableBody();
  });
  const selAllBtn = document.getElementById('videoSelectAllBtn');
  if (selAllBtn) selAllBtn.addEventListener('click', () => {
    currentVideoList.forEach((_, i) => selectedVideos.add(i));
    renderVideoTableBody();
  });
  const invertBtn = document.getElementById('videoInvertSelectionBtn');
  if (invertBtn) invertBtn.addEventListener('click', () => {
    const newSet = new Set();
    currentVideoList.forEach((_, i) => { if (!selectedVideos.has(i)) newSet.add(i); });
    selectedVideos.clear();
    newSet.forEach(i => selectedVideos.add(i));
    renderVideoTableBody();
  });
  const clearBtn = document.getElementById('videoClearSelectionsBtn');
  if (clearBtn) clearBtn.addEventListener('click', () => {
    selectedVideos.clear();
    renderVideoTableBody();
  });
  const batchDownloadBtn = document.getElementById('videoBatchDownloadBtn');
  if (batchDownloadBtn) batchDownloadBtn.addEventListener('click', async () => {
    for (const idx of Array.from(selectedVideos)) {
      if (!downloadedVideos.has(idx)) {
        await downloadOriginalVideo(idx);
        downloadedVideos.add(idx);
      }
    }
    renderVideoTableBody();
  });
  const batchRemoveBtn = document.getElementById('videoBatchRemoveBtn');
  if (batchRemoveBtn) batchRemoveBtn.addEventListener('click', () => {
    // 简化：仅取消选择，不真正移除 DOM 视频对象
    selectedVideos.clear();
    renderVideoTableBody();
  });
});

// ==================== 视频列表与控制（R-VID-DET-001 / R-VID-CTRL-001） ==================== //
async function refreshVideoList() {
  const badge = document.getElementById('videoCountBadge');
  try {
    const tabId = await getActiveContentTabId(true);
    if (!tabId) {
      currentVideoList = [];
      hasPlayableVideo = false;
      if (badge) badge.textContent = '0';
      renderVideoTableBody();
      syncMediaAvailabilityUI();
      return;
    }
    const videos = await sendMessageToContent(tabId, { type: 'GET_VIDEO_LIST' });
    currentVideoList = Array.isArray(videos?.videos) ? videos.videos : [];
    hasPlayableVideo = currentVideoList.length > 0;
    if (badge) badge.textContent = String(currentVideoList.length || 0);
    renderVideoTableBody();
    syncMediaAvailabilityUI();
  } catch (e) {
    console.error('刷新视频列表失败:', e);
    currentVideoList = [];
    hasPlayableVideo = false;
    if (badge) badge.textContent = '0';
    renderVideoTableBody();
    syncMediaAvailabilityUI();
    updateGlobalVideoToolbar();
  }
}

function renderVideoTableBody() {
  const tbody = document.getElementById('videoTableBody');
  if (!tbody) return;
  tbody.innerHTML = '';

  if (!currentVideoList.length) {
    const empty = document.createElement('tr');
    empty.className = 'media-empty-row';
    empty.innerHTML = '<td colspan="6"><div class="media-empty-hint">当前页面没有可控制的视频。</div></td>';
    tbody.appendChild(empty);
    return;
  }

  currentVideoList.forEach((v, idx) => {
    const tr = document.createElement('tr');
    tr.className = 'video-row';

    // 选择复选框
    const tdCheck = document.createElement('td');
    tdCheck.className = 'col-checkbox';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.dataset.index = String(idx);
    cb.checked = selectedVideos.has(idx);
    cb.addEventListener('change', () => {
      if (cb.checked) selectedVideos.add(idx); else selectedVideos.delete(idx);
      updateVideoBatchBar();
    });
    tdCheck.appendChild(cb);

    // 索引
    const tdIndex = document.createElement('td');
    const state = videosState[idx] || {};
    tdIndex.textContent = '#' + idx + (state.playing ? ' ▶' : '');

    // 尺寸
    const tdSize = document.createElement('td');
    const sizeText = (v.width && v.height) ? `${v.width}x${v.height}` : '';
    tdSize.textContent = sizeText;

    // 时长
    const tdDur = document.createElement('td');
    tdDur.textContent = v.duration ? formatSeconds(v.duration) : '';

    // 直链信息
    const tdSources = document.createElement('td');
    const directSources = Array.isArray(v.directSources) ? v.directSources : [];
    const directCount = typeof v.directSourceCount === 'number' ? v.directSourceCount : directSources.length;
    if (directCount > 0) {
      const label = document.createElement('span');
      label.textContent = '直链 ' + directCount;
      tdSources.appendChild(label);
      if (directSources[0]) {
        const copyBtn = document.createElement('button');
        copyBtn.type = 'button';
        copyBtn.className = 'source-chip';
        copyBtn.textContent = '复制首链';
        copyBtn.title = directSources[0].url;
        copyBtn.addEventListener('click', () => copyDirectLink(directSources[0].url));
        tdSources.appendChild(copyBtn);
      }
    } else {
      tdSources.textContent = '无';
    }

    // 操作列
    const tdActions = document.createElement('td');
    tdActions.className = 'col-actions';

    // 播放/暂停按钮（简单：仅调用对应动作，不追踪状态）
    const playBtn = document.createElement('button');
    playBtn.className = 'btn btn-xs';
    playBtn.textContent = '播放';
    playBtn.addEventListener('click', () => controlVideo(idx, 'play'));
    tdActions.appendChild(playBtn);

    const pauseBtn = document.createElement('button');
    pauseBtn.className = 'btn btn-xs';
    pauseBtn.textContent = '暂停';
    pauseBtn.addEventListener('click', () => controlVideo(idx, 'pause'));
    tdActions.appendChild(pauseBtn);
    // 播放/暂停单按钮
    const togglePlayBtn = document.createElement('button');
    togglePlayBtn.className = 'btn btn-xs';
    togglePlayBtn.textContent = state.playing ? '暂停' : '播放';
    togglePlayBtn.addEventListener('click', () => {
      if (state.playing) {
        controlVideoWithState(idx, 'pause');
      } else {
        controlVideoWithState(idx, 'play');
      }
    });
    tdActions.appendChild(togglePlayBtn);

    // 录制切换按钮
    const recordState = videoRecordingState[idx];
    const recordBtn = document.createElement('button');
    recordBtn.className = 'btn btn-xs';
    recordBtn.textContent = recordState?.recording ? '停止录制' : '录制';
    recordBtn.addEventListener('click', () => {
      if (videoRecordingState[idx]?.recording) {
        stopVideoRecordingByIndex(idx);
      } else {
        startVideoRecordingByIndex(idx);
      }
    });
    tdActions.appendChild(recordBtn);

    // 音频提取按钮
    const audioState = audioRecordingState[idx];
    const audioBtn = document.createElement('button');
    audioBtn.className = 'btn btn-xs';
    audioBtn.textContent = audioState?.recording ? '停止音频' : '音频';
    audioBtn.addEventListener('click', () => {
      if (audioRecordingState[idx]?.recording) {
        stopAudioRecordingByIndex(idx);
      } else {
        startAudioRecordingByIndex(idx);
      }
    });
    tdActions.appendChild(audioBtn);

    // 下载按钮（已下载禁用）
    const dlState = videoDownloadState[idx];
    const downloadBtn = document.createElement('button');
    downloadBtn.className = 'btn btn-xs';
    downloadBtn.textContent = dlState?.downloading ? '下载中…' : (downloadedVideos.has(idx) ? '已下载' : '下载');
    downloadBtn.disabled = !!dlState?.downloading || downloadedVideos.has(idx);
    downloadBtn.addEventListener('click', () => {
      if (downloadedVideos.has(idx)) return;
      downloadOriginalVideo(idx).then(() => {
        downloadedVideos.add(idx);
        renderVideoTableBody();
      });
    });
    tdActions.appendChild(downloadBtn);

    tr.appendChild(tdCheck);
    tr.appendChild(tdIndex);
    tr.appendChild(tdSize);
    tr.appendChild(tdDur);
    tr.appendChild(tdSources);
    tr.appendChild(tdActions);
    tbody.appendChild(tr);
  });

  updateVideoBatchBar();
}

function updateVideoBatchBar() {
  const bar = document.getElementById('videoBatchActions');
  const countEl = document.getElementById('videoSelectedCount');
  if (!bar || !countEl) return;
  const count = selectedVideos.size;
  countEl.textContent = String(count);
  bar.style.display = count > 0 ? '' : 'none';
  const master = document.getElementById('videoMasterCheckbox');
  if (master) master.checked = count > 0 && count === currentVideoList.length;
}

function syncMediaAvailabilityUI() {
  // 更新：使用新合并按钮ID
  const targetButtons = ['playPauseToggleButton', 'recordToggleButton', 'recordAudioButton', 'captureFrameButton'];
  targetButtons.forEach((id) => {
    const button = document.getElementById(id);
    if (!button) return;
    if (!hasPlayableVideo) {
      if (button.dataset.mediaDisabled === 'true') return;
      button.dataset.mediaDisabled = 'true';
      button.dataset.prevDisabled = button.disabled ? 'true' : 'false';
      button.disabled = true;
    } else if (button.dataset.mediaDisabled === 'true') {
      button.disabled = button.dataset.prevDisabled === 'true';
      delete button.dataset.mediaDisabled;
      delete button.dataset.prevDisabled;
    }
  });

  const hint = document.getElementById('mediaAvailabilityHint');
  if (hint) {
    hint.style.display = hasPlayableVideo ? 'none' : 'block';
  }
}

function formatSeconds(sec) {
  if (!sec || !isFinite(sec)) return '';
  const s = Math.floor(sec);
  const m = Math.floor(s / 60);
  const r = s % 60;
  if (m <= 0) return `${r}s`;
  return `${m}m${r.toString().padStart(2, '0')}s`;
}

function formatElapsed(startedAt) {
  if (!startedAt) return '';
  const diff = Math.max(0, Date.now() - startedAt);
  const totalSeconds = Math.floor(diff / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}m${seconds.toString().padStart(2, '0')}s` : `${seconds}s`;
}

async function controlVideo(index, action) {
  try {
    const tabId = await getActiveContentTabId(false);
    if (!tabId) {
      showNotification('未找到可控制的视频标签页', 'warning');
      return;
    }
    await sendMessageToContent(tabId, { type: 'CONTROL_VIDEO', index, action });
  } catch (e) {
    console.error('控制视频失败:', e);
    showNotification('控制视频失败: ' + (e?.message || e), 'error');
  }
}

async function startVideoRecordingByIndex(index) {
  try {
    const tabId = await getActiveContentTabId(false);
    if (!tabId) {
      showNotification('未找到可录制的视频标签页', 'warning');
      return;
    }
    const res = await sendMessageToContent(tabId, { type: 'START_RECORD_VIDEO', index });
    if (res?.success) {
      videoRecordingState[index] = {
        recording: true,
        startedAt: res.startedAt || Date.now(),
        stopping: false
      };
      renderVideoTableBody();
      showNotification(`开始录制视频 #${index}`, 'success');
    } else {
      showNotification('录制失败: ' + (res?.error || '未知错误'), 'error');
    }
  } catch (error) {
    console.error('开始录制异常:', error);
    showNotification('录制失败: ' + (error?.message || error), 'error');
  }
}

async function stopVideoRecordingByIndex(index) {
  const state = videoRecordingState[index];
  if (!state || !state.recording) {
    showNotification('该视频当前没有录制任务', 'info');
    return;
  }
  videoRecordingState[index].stopping = true;
  renderVideoTableBody();
  try {
    const tabId = await getActiveContentTabId(false);
    if (!tabId) {
      showNotification('未找到可录制的视频标签页', 'warning');
      videoRecordingState[index].stopping = false;
      renderVideoTableBody();
      return;
    }
    const res = await sendMessageToContent(tabId, { type: 'STOP_RECORD_VIDEO', index });
    if (!res?.success) {
      videoRecordingState[index].stopping = false;
      renderVideoList();
      showNotification('停止录制失败: ' + (res?.error || '未知错误'), 'error');
    } else {
      showNotification('录制停止中，请稍候保存文件', 'info');
    }
  } catch (error) {
    videoRecordingState[index].stopping = false;
    renderVideoTableBody();
    console.error('停止录制异常:', error);
    showNotification('停止录制失败: ' + (error?.message || error), 'error');
  }
}

async function startAudioRecordingByIndex(index) {
  try {
    const tabId = await getActiveContentTabId(false);
    if (!tabId) {
      showNotification('未找到可录制的标签页', 'warning');
      return;
    }
    const res = await sendMessageToContent(tabId, { type: 'START_AUDIO_RECORD', index });
    if (res?.success) {
      audioRecordingState[index] = {
        recording: true,
        startedAt: res.startedAt || Date.now(),
        stopping: false
      };
      renderVideoTableBody();
      showNotification(`开始提取音频 #${index}`, 'success');
    } else {
      showNotification('提取音频失败: ' + (res?.error || '未知错误'), 'error');
    }
  } catch (error) {
    console.error('开始音频录制异常:', error);
    showNotification('提取音频失败: ' + (error?.message || error), 'error');
  }
}

async function stopAudioRecordingByIndex(index) {
  const state = audioRecordingState[index];
  if (!state || !state.recording) {
    showNotification('该视频当前没有音频提取任务', 'info');
    return;
  }
  audioRecordingState[index].stopping = true;
  renderVideoList();
  try {
    const tabId = await getActiveContentTabId(false);
    if (!tabId) {
      showNotification('未找到可录制的标签页', 'warning');
      audioRecordingState[index].stopping = false;
      renderVideoTableBody();
      return;
    }
    const res = await sendMessageToContent(tabId, { type: 'STOP_AUDIO_RECORD', index });
    if (!res?.success) {
      audioRecordingState[index].stopping = false;
      renderVideoList();
      showNotification('停止提取失败: ' + (res?.error || '未知错误'), 'error');
    } else {
      showNotification('音频处理中，请稍候保存文件', 'info');
    }
  } catch (error) {
    audioRecordingState[index].stopping = false;
    renderVideoTableBody();
    console.error('停止音频录制异常:', error);
    showNotification('停止提取失败: ' + (error?.message || error), 'error');
  }
}

async function downloadOriginalVideo(index) {
  const activeState = videoDownloadState[index];
  if (activeState?.downloading) {
    showNotification('该视频已在下载队列中', 'info');
    return;
  }
  videoDownloadState[index] = { downloading: true };
  renderVideoList();

  try {
    const tabId = await getActiveContentTabId(false);
    if (!tabId) {
      throw new Error('未找到可下载的视频标签页');
    }

    const realtime = await requestVideoSources(index, tabId);
    let sources = realtime.sources;
    if (!Array.isArray(sources) || !sources.length) {
      const cached = currentVideoList[index]?.directSources;
      if (Array.isArray(cached) && cached.length) {
        sources = cached;
      }
    }

    if (!sources || !sources.length) {
      throw new Error('未找到可下载的直链，建议使用录制功能');
    }

    const candidate = pickDownloadCandidate(sources);
    if (!candidate) {
      throw new Error('未获取到可用直链');
    }

    const fileName = buildVideoDownloadFileName(index, candidate, realtime.meta || {});
    const response = await sendRuntimeMessage({
      type: 'DIRECT_VIDEO_DOWNLOAD',
      payload: {
        url: candidate.url,
        fileName
      }
    });

    if (!response?.success) {
      throw new Error(response?.error || '触发下载失败');
    }

    showNotification(`已开始下载视频 #${index}`, 'success');
  } catch (error) {
    console.error('下载原视频失败:', error);
    showNotification('下载失败: ' + (error?.message || error), 'error');
  } finally {
    delete videoDownloadState[index];
    renderVideoTableBody();
  }
}

async function requestVideoSources(index, tabId) {
  try {
    const response = await sendMessageToContent(tabId, { type: 'REQUEST_VIDEO_SOURCES', index });
    const domSources = Array.isArray(response?.sources) ? response.sources : [];
    const networkSources = await fetchCapturedVideoSources(tabId);
    const merged = dedupeVideoSources([...networkSources, ...domSources]);
    return {
      sources: merged,
      meta: response?.meta || {}
    };
  } catch (error) {
    console.warn('实时获取视频源失败:', error);
    return { sources: [], meta: {} };
  }
}

async function fetchCapturedVideoSources(tabId) {
  if (!tabId) return [];
  try {
    const response = await sendRuntimeMessage({ type: 'GET_CAPTURED_VIDEO_SOURCES', tabId });
    if (!response || response.success === false) return [];
    const sources = Array.isArray(response.sources) ? response.sources : [];
    return sources.map((item) => ({
      url: item.url,
      mimeType: item.mimeType,
      extension: item.extension,
      size: item.size,
      via: item.via || 'network'
    }));
  } catch (error) {
    console.warn('获取捕获视频源失败:', error);
    return [];
  }
}

function dedupeVideoSources(sources) {
  const seen = new Set();
  return sources.filter((source) => {
    if (!source || !source.url) return false;
    const key = source.url.split('#')[0];
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function pickDownloadCandidate(sources) {
  if (!Array.isArray(sources) || !sources.length) return null;
  const priority = ['mp4', 'webm', 'mkv', 'mov', 'm3u8', 'flv', 'ts'];
  const weighted = sources.map((source) => {
    const ext = (source.extension || '').toLowerCase();
    const weight = priority.indexOf(ext);
    return { source, weight: weight === -1 ? priority.length : weight };
  });
  weighted.sort((a, b) => a.weight - b.weight);
  return weighted[0]?.source || sources[0];
}

function buildVideoDownloadFileName(index, candidate, meta = {}) {
  const template = config?.fileStorage?.filenameTemplate || '{siteName}_{title}_{date}_{index}';
  const now = new Date();
  const isoDate = now.toISOString().split('T')[0];
  const isoTime = now.toISOString().split('T')[1].replace(/[:.]/g, '-').slice(0, 6);
  const fallbackSrc = currentVideoList[index]?.src || '';
  const fallbackTitle = extractNameFromUrl(fallbackSrc) || `video_${index}`;
  const data = {
    siteName: meta.siteName || currentSite?.name || 'site',
    title: meta.title || fallbackTitle,
    date: isoDate,
    time: isoTime,
    index
  };
  const baseName = window.utils?.formatFilename
    ? window.utils.formatFilename(template, data)
    : `${data.siteName}_${data.title}_${isoDate}`;
  const extension = (candidate?.extension || guessExtensionFromMimeType(candidate?.mimeType) || guessExtensionFromUrl(candidate?.url) || 'mp4')
    .replace(/\./g, '')
    .toLowerCase();
  return `${baseName}.${extension || 'mp4'}`;
}

function extractNameFromUrl(url = '') {
  if (!url) return '';
  try {
    const clean = url.split('?')[0].split('#')[0];
    const lastSegment = clean.substring(clean.lastIndexOf('/') + 1);
    return lastSegment.replace(/\.[a-z0-9]{2,5}$/i, '') || '';
  } catch (error) {
    return '';
  }
}

function guessExtensionFromMimeType(mime = '') {
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

function guessExtensionFromUrl(url = '') {
  if (!url) return '';
  try {
    const clean = url.split('?')[0].split('#')[0];
    const match = clean.match(/\.([a-z0-9]{2,5})$/i);
    return match ? match[1].toLowerCase() : '';
  } catch (error) {
    return '';
  }
}

function formatSourceChipLabel(source) {
  if (!source || !source.url) return '链接';
  try {
    const urlObj = new URL(source.url);
    const host = urlObj.hostname.replace(/^www\./i, '');
    const ext = (source.extension || guessExtensionFromUrl(source.url) || '').toUpperCase();
    return ext ? `${host} · ${ext}` : host;
  } catch (_) {
    return source.label || '链接';
  }
}

function copyDirectLink(url) {
  if (!url) return;
  const successMessage = '已复制视频直链';
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url)
        .then(() => showNotification(successMessage, 'success'))
        .catch(() => copyDirectLinkFallback(url, successMessage));
    } else {
      copyDirectLinkFallback(url, successMessage);
    }
  } catch (error) {
    copyDirectLinkFallback(url, successMessage);
  }
}

function copyDirectLinkFallback(text, successMessage) {
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    showNotification(ok ? successMessage : '复制失败', ok ? 'success' : 'error');
  } catch (error) {
    showNotification('复制失败: ' + (error?.message || error), 'error');
  }
}

// ==================== 图像扫描与表格渲染（R-IMG-DET-001） ==================== //
let currentImageList = [];
const selectedImages = new Set();
const downloadedImages = new Set();
const processedMediaKeys = new Set(); // 统一去重集合（视频/音频/图片共享）
// 统一媒体去重与标识策略：type|normalizedUrl|WxH|hashPrefix
function buildUnifiedMediaKey(obj = {}) {
  const norm = normalizeUrlForKey(obj.url || '');
  const type = obj.kind || (obj.mime ? 'audio' : 'media');
  const w = obj.width || 0;
  const h = obj.height || 0;
  const hashPrefix = obj.phash ? String(obj.phash).slice(0, 8) : '';
  return `${type}|${norm}|${w}x${h}|${hashPrefix}`;
}

function normalizeUrlForKey(raw='') {
  try {
    const u = new URL(raw, document.baseURI);
    // 去掉常见追踪参数
    ['utm_source','utm_medium','utm_campaign','utm_id','utm_term','utm_content','timestamp','t','_t'].forEach(p=>u.searchParams.delete(p));
    return u.href;
  } catch(_) { return raw; }
}

function buildImageKey(item){
  return buildUnifiedMediaKey(item);
}

async function refreshImageList() {
  const badge = document.getElementById('imageCountBadge');
  try {
    currentImageList = scanImagesFromDom();
    applyImageFilter();
    if (badge) badge.textContent = String(currentImageList.length);
    renderImageTableBody();
  } catch(e){
    console.warn('扫描图片失败:', e);
    currentImageList = [];
    if (badge) badge.textContent = '0';
    renderImageTableBody();
  }
}

function scanImagesFromDom() {
  const results = [];
  const seen = new Set();
  const push = (url, w, h, kind) => {
    if (!url) return;
    const abs = normalizeUrlForKey(url);
    const key = abs + '|' + w + 'x' + h;
    if (seen.has(key)) return;
    seen.add(key);
    results.push({ url: abs, width: w, height: h, kind });
  };
  // <img>
  document.querySelectorAll('img').forEach(img => {
    const src = img.currentSrc || img.src;
    if (!src) return;
    push(src, img.naturalWidth, img.naturalHeight, 'img');
  });
  // <picture><source>
  document.querySelectorAll('picture source').forEach(s => {
    const srcset = s.srcset || s.getAttribute('srcset');
    if (!srcset) return;
    const first = srcset.split(',')[0].trim().split(' ')[0];
    if (first) push(first, 0, 0, 'source');
  });
  // CSS 背景图
  document.querySelectorAll('*').forEach(el => {
    const style = getComputedStyle(el);
    const bg = style.backgroundImage;
    if (bg && bg !== 'none') {
      const matches = bg.match(/url\(("|')?(.*?)("|')?\)/g);
      if (matches) {
        matches.forEach(m=>{
          const inner = m.replace(/url\(("|')?/, '').replace(/("|')?\)$/,'');
          if (/^data:/i.test(inner)) return; // 跳过dataURL背景
          push(inner, el.clientWidth, el.clientHeight, 'background');
        });
      }
    }
  });
  return results;
}

function applyImageFilter() {
  const minWEl = document.getElementById('minImageWidth');
  const minHEl = document.getElementById('minImageHeight');
  const minW = minWEl ? parseInt(minWEl.value||'0',10) : 0;
  const minH = minHEl ? parseInt(minHEl.value||'0',10) : 0;
  currentImageList = currentImageList.filter(i => {
    const wOK = !minW || (i.width||0) >= minW;
    const hOK = !minH || (i.height||0) >= minH;
    return wOK && hOK;
  });
}

function renderImageTableBody() {
  const tbody = document.getElementById('imageTableBody');
  if (!tbody) return;
  tbody.innerHTML = '';
  if (!currentImageList.length) {
    const tr = document.createElement('tr');
    tr.className='media-empty-row';
    tr.innerHTML='<td colspan="6"><div class="media-empty-hint">暂无图片资源，点击“重新识别”扫描。</div></td>';
    tbody.appendChild(tr); return;
  }
  ensureImageLazyObserver();
  currentImageList.forEach((img, idx) => {
    const tr = document.createElement('tr');
    // 复选框
    const tdCheck = document.createElement('td');
    tdCheck.className='col-checkbox';
    const cb = document.createElement('input');
    cb.type='checkbox';
    cb.checked = selectedImages.has(idx);
    cb.addEventListener('change', ()=>{ if(cb.checked) selectedImages.add(idx); else selectedImages.delete(idx); updateImageBatchBar(); });
    tdCheck.appendChild(cb);
    // 预览
    const tdPreview = document.createElement('td');
    const holder = document.createElement('div'); holder.className='img-holder'; holder.style.width='80px'; holder.style.height='45px'; holder.style.background='#eee'; holder.textContent='加载中';
    const imageEl = new Image(); imageEl.loading='lazy'; imageEl.decoding='async'; imageEl.style.maxWidth='80px'; imageEl.style.maxHeight='45px';
    // 哈希单元占位先创建，加载后填充
    const hashCell = document.createElement('td'); hashCell.className='phash-cell'; hashCell.textContent='...'; hashCell.title='等待加载计算哈希';
    imageEl.addEventListener('load', ()=>{ holder.textContent=''; holder.appendChild(imageEl); try { img.phash = computePerceptualHash(imageEl); hashCell.textContent = img.phash.slice(0,16); hashCell.title = img.phash; } catch(_) { hashCell.textContent='(哈希失败)'; } });
    // 懒加载：使用 data-src 并让观察器设置 src
    imageEl.dataset.src = img.url; holder.__lazyImage = imageEl; imageLazyObserver.observe(holder);
    tdPreview.appendChild(holder);
    // 尺寸
    const tdSize = document.createElement('td'); tdSize.textContent = (img.width||0) + 'x' + (img.height||0);
    // URL
    const tdUrl = document.createElement('td');
    const short = img.url.length>60 ? img.url.slice(0,60)+'…' : img.url; tdUrl.textContent = short; tdUrl.title = img.url;
    // 操作
    const tdActions = document.createElement('td'); tdActions.className='col-actions';
    const copyBtn = document.createElement('button'); copyBtn.className='btn btn-xs'; copyBtn.textContent='复制'; copyBtn.addEventListener('click',()=>copyDirectLink(img.url)); tdActions.appendChild(copyBtn);
    const downloadBtn = document.createElement('button'); downloadBtn.className='btn btn-xs';
    const key = buildImageKey(img); const duplicated = processedMediaKeys.has(key) || downloadedImages.has(idx);
    downloadBtn.textContent = duplicated ? '已处理' : '下载'; downloadBtn.disabled = duplicated;
    downloadBtn.addEventListener('click',()=>{ if(downloadBtn.disabled) return; processedMediaKeys.add(key); downloadedImages.add(idx); triggerImageDownload(img.url); renderImageTableBody(); });
    tdActions.appendChild(downloadBtn);
    tr.appendChild(tdCheck); tr.appendChild(tdPreview); tr.appendChild(hashCell); tr.appendChild(tdSize); tr.appendChild(tdUrl); tr.appendChild(tdActions);
    tbody.appendChild(tr);
  });
  updateImageBatchBar();
}

function updateImageBatchBar(){
  const bar = document.getElementById('imageBatchActions');
  const countEl = document.getElementById('imageSelectedCount');
  if(!bar||!countEl) return; const c = selectedImages.size; countEl.textContent=String(c); bar.style.display = c>0 ? '' : 'none';
  const master = document.getElementById('imageMasterCheckbox'); if(master) master.checked = c>0 && c===currentImageList.length;
}

function triggerImageDownload(url){
  try { chrome.runtime.sendMessage({ type:'DIRECT_DOWNLOAD_GENERIC', url }); } catch(e){ console.warn('触发图片下载失败', e); }
  showNotification('开始下载图片', 'success');
}

// 绑定图像相关事件（在 DOMContentLoaded 补充）
document.addEventListener('DOMContentLoaded', ()=>{
  const refreshBtn = document.getElementById('refreshImageButton'); if(refreshBtn) refreshBtn.addEventListener('click', refreshImageList);
  const applyFilterBtn = document.getElementById('applyImageFilterBtn'); if(applyFilterBtn) applyFilterBtn.addEventListener('click', ()=>{ applyImageFilter(); renderImageTableBody(); });
  const master = document.getElementById('imageMasterCheckbox'); if(master) master.addEventListener('change', ()=>{ selectedImages.clear(); if(master.checked) currentImageList.forEach((_,i)=>selectedImages.add(i)); renderImageTableBody(); });
  const selAll = document.getElementById('imageSelectAllBtn'); if(selAll) selAll.addEventListener('click', ()=>{ currentImageList.forEach((_,i)=>selectedImages.add(i)); renderImageTableBody(); });
  const invert = document.getElementById('imageInvertSelectionBtn'); if(invert) invert.addEventListener('click', ()=>{ const ns=new Set(); currentImageList.forEach((_,i)=>{ if(!selectedImages.has(i)) ns.add(i); }); selectedImages.clear(); ns.forEach(i=>selectedImages.add(i)); renderImageTableBody(); });
  const clearBtn = document.getElementById('imageClearSelectionsBtn'); if(clearBtn) clearBtn.addEventListener('click', ()=>{ selectedImages.clear(); renderImageTableBody(); });
  const batchDl = document.getElementById('imageBatchDownloadBtn'); if(batchDl) batchDl.addEventListener('click', ()=>{ Array.from(selectedImages).forEach(i=>{ const img=currentImageList[i]; if(!img) return; const k=buildImageKey(img); if(processedMediaKeys.has(k)) return; processedMediaKeys.add(k); downloadedImages.add(i); triggerImageDownload(img.url); }); renderImageTableBody(); });
  const batchRemove = document.getElementById('imageBatchRemoveBtn'); if(batchRemove) batchRemove.addEventListener('click', ()=>{ selectedImages.clear(); renderImageTableBody(); });
  const galleryClear = document.getElementById('clearImageGalleryButton'); if(galleryClear) galleryClear.addEventListener('click', ()=>{ currentImageList=[]; selectedImages.clear(); renderImageTableBody(); const badge=document.getElementById('imageCountBadge'); if(badge) badge.textContent='0'; });

  // 单次视频帧抓取按钮
  const captureFrameBtn = document.getElementById('captureFrameButton');
  if (captureFrameBtn) captureFrameBtn.addEventListener('click', async () => {
    const frame = await captureVideoFrameViaInjection();
    if (frame) {
      appendFrameImage(frame);
    } else {
      showNotification('未找到可抓取的视频帧', 'warning');
    }
  });

  // 定时抓帧切换按钮
  const frameToggleBtn = document.getElementById('frameCaptureToggleButton');
  if (frameToggleBtn) frameToggleBtn.addEventListener('click', toggleFrameCaptureInterval);
});

// ==================== 定时视频帧抓取调度（任务12部分实现） ==================== //
let frameCaptureTimer = null;
let frameCaptureActive = false;

function toggleFrameCaptureInterval() {
  if (frameCaptureActive) {
    stopFrameCaptureInterval();
  } else {
    startFrameCaptureInterval();
  }
}

function startFrameCaptureInterval() {
  const intervalInput = document.getElementById('frameIntervalInput');
  const btn = document.getElementById('frameCaptureToggleButton');
  const seconds = intervalInput ? Math.max(1, parseInt(intervalInput.value||'5',10)) : 5;
  frameCaptureActive = true;
  if (btn) { btn.textContent = '停止定时抓帧'; btn.classList.add('active'); }
  scheduleNextFrame(seconds);
  showNotification(`已开始定时抓帧（每 ${seconds}s）`, 'success');
}

function stopFrameCaptureInterval() {
  frameCaptureActive = false;
  if (frameCaptureTimer) clearTimeout(frameCaptureTimer);
  frameCaptureTimer = null;
  const btn = document.getElementById('frameCaptureToggleButton');
  if (btn) { btn.textContent = '开始定时抓帧'; btn.classList.remove('active'); }
  showNotification('已停止定时抓帧', 'info');
}

function scheduleNextFrame(seconds) {
  if (!frameCaptureActive) return;
  frameCaptureTimer = setTimeout(async () => {
    const frame = await captureVideoFrameViaInjection();
    if (frame) appendFrameImage(frame);
    scheduleNextFrame(seconds);
  }, seconds * 1000);
}

async function captureVideoFrameViaInjection() {
  try {
    const tabId = await getActiveContentTabId(false);
    if (!tabId) return null;
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        try {
          const video = document.querySelector('video');
          if (!video || video.readyState < 2) return null;
          const w = video.videoWidth, h = video.videoHeight;
          if (!w || !h) return null;
          const canvas = document.createElement('canvas');
          canvas.width = w; canvas.height = h;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(video, 0, 0, w, h);
          const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
          return { url: dataUrl, width: w, height: h, kind: 'frame', timestamp: Date.now() };
        } catch (e) { return null; }
      }
    });
    return result;
  } catch (e) {
    console.warn('抓取视频帧失败，尝试可见标签页截图回退:', e);
    try {
      const dataUrl = await chrome.tabs.captureVisibleTab(undefined, { format: 'jpeg', quality: 80 });
      return { url: dataUrl, width: 0, height: 0, kind: 'tab-shot', timestamp: Date.now() };
    } catch (e2) {
      console.warn('截图回退也失败:', e2);
      return null;
    }
  }
}

function appendFrameImage(frame) {
  // 使用统一媒体 Key（哈希稍后在懒加载阶段生成）
  const key = buildUnifiedMediaKey(frame);
  if (processedMediaKeys.has(key)) return;
  processedMediaKeys.add(key);
  currentImageList.unshift({ url: frame.url, width: frame.width, height: frame.height, kind: frame.kind });
  const badge = document.getElementById('imageCountBadge'); if (badge) badge.textContent = String(currentImageList.length);
  renderImageTableBody();
}

// ==================== MCP 设置管理（侧边栏本地） ==================== //
function markMcpFeatureDisabled(customMessage) {
  const statusEl = document.getElementById('mcpStatus');
  if (statusEl) {
    statusEl.textContent = customMessage || '已关闭';
    statusEl.className = 'status-badge status-offline';
    statusEl.title = 'MCP 功能已暂时关闭';
  }

  const pathEl = document.getElementById('mcpPath');
  if (pathEl) {
    pathEl.style.display = 'block';
    pathEl.textContent = 'MCP 功能已暂时关闭';
  }

  const testBtn = document.getElementById('testMcpButton');
  if (testBtn) {
    testBtn.disabled = true;
    testBtn.title = 'MCP 功能已暂时关闭';
  }

  const saveBtn = document.getElementById('saveButton');
  if (saveBtn) {
    saveBtn.disabled = true;
    saveBtn.title = '保存功能暂不可用（MCP 已关闭）';
  }
}

async function readStoredConfig() {
  return new Promise((resolve) => {
    try {
      chrome.storage.local.get('config', (res) => {
        resolve(res?.config || {});
      });
    } catch (e) {
      resolve({});
    }
  });
}

async function writeStoredConfig(cfg) {
  return new Promise((resolve) => {
    try {
      chrome.storage.local.set({ config: cfg }, resolve);
    } catch (e) {
      resolve();
    }
  });
}

async function fillMcpSettingsFromStorage() {
  if (!MCP_FEATURE_ENABLED) {
    markMcpFeatureDisabled();
    return;
  }
  const cfg = await readStoredConfig();
  const input = document.getElementById('mcpApiUrlInput');
  const status = document.getElementById('mcpStatus');
  const path = document.getElementById('mcpPath');
  const url = (cfg?.fileStorage?.mcpApiUrl) || 'http://localhost:8888';
  if (input) input.value = url;
  // 显示最近状态（如有）
  if (typeof cfg?.fileStorage?.mcpStatus === 'boolean') {
    setMcpStatusBadge(cfg.fileStorage.mcpStatus, cfg?.fileStorage?.savedPath || '', status, path);
  }
}

function setMcpStatusBadge(isOnline, savedPath, statusEl, pathEl) {
  if (!MCP_FEATURE_ENABLED) {
    markMcpFeatureDisabled();
    return;
  }
  try {
    statusEl = statusEl || document.getElementById('mcpStatus');
    pathEl = pathEl || document.getElementById('mcpPath');
    if (!statusEl) return;
    statusEl.textContent = isOnline ? '在线' : '离线';
    statusEl.className = 'status-badge ' + (isOnline ? 'online' : 'offline');
    if (pathEl) {
      if (isOnline && savedPath) {
        pathEl.style.display = '';
        pathEl.textContent = '保存路径: ' + savedPath;
      } else {
        pathEl.style.display = 'none';
        pathEl.textContent = '';
      }
    }
  } catch (_) {}
}

async function saveMcpSettingsPart() {
  if (!MCP_FEATURE_ENABLED) {
    markMcpFeatureDisabled();
    return;
  }
  const input = document.getElementById('mcpApiUrlInput');
  if (!input) return;
  const url = (input.value || '').trim();
  const cfg = await readStoredConfig();
  cfg.fileStorage = cfg.fileStorage || {};
  cfg.fileStorage.mcpApiUrl = url || 'http://localhost:8888';
  await writeStoredConfig(cfg);
  // 通知后台立即检查一次状态（使用新的配置）
  try { chrome.runtime.sendMessage({ type: 'CHECK_MCP_SERVICE' }); } catch (_) {}
}

async function testMcpConnection() {
  if (!MCP_FEATURE_ENABLED) {
    markMcpFeatureDisabled();
    return;
  }
  const input = document.getElementById('mcpApiUrlInput');
  const status = document.getElementById('mcpStatus');
  const path = document.getElementById('mcpPath');
  const raw = (input && input.value) ? input.value.trim() : 'http://localhost:8888';
  const base = raw.replace(/\/$/, '');
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(`${base}/status`, { method: 'GET', headers: { 'Content-Type': 'application/json' }, signal: controller.signal });
    clearTimeout(timer);
    if (res.ok) {
      const data = await res.json().catch(() => ({}));
      setMcpStatusBadge(true, data?.savedPath || '', status, path);
      showNotification('MCP 服务在线', 'success');
    } else {
      setMcpStatusBadge(false, '', status, path);
      showNotification('MCP 服务不可用: ' + res.status, 'warning');
    }
  } catch (e) {
    setMcpStatusBadge(false, '', status, path);
    showNotification('无法连接 MCP 服务: ' + (e?.message || e), 'error');
  }
}

// 设置所有事件监听器
function setupEventListeners() {
  // 兼容旧代码：已弃用的按钮ID不再绑定，避免运行时报错
  const analyzeBtn = document.getElementById('analyzeButton');
  const saveBtn = document.getElementById('saveButton');
  if (analyzeBtn) analyzeBtn.addEventListener('click', analyzeContent);
  if (saveBtn) saveBtn.addEventListener('click', saveAnalysisResult);
  
  // 设置面板
  document.getElementById('settingsButton').addEventListener('click', toggleSettingsPanel);
  document.getElementById('saveSettingsButton').addEventListener('click', saveSettings);
  
  // AI模型选择器
  const modelSelector = document.getElementById('aiModelSelector');
  if (modelSelector) {
    modelSelector.addEventListener('change', handleModelChange);
  }
  
  // 配置文件选择器
  const profileSelector = document.getElementById('profileSelector');
  if (profileSelector) {
    profileSelector.addEventListener('change', handleProfileChange);
  }
  
  // 配置文件管理按钮
  const addProfileBtn = document.getElementById('addProfileButton');
  const deleteProfileBtn = document.getElementById('deleteProfileButton');
  const saveProfileBtn = document.getElementById('saveProfileButton');
  
  if (addProfileBtn) {
    addProfileBtn.addEventListener('click', addNewProfile);
  }
  
  if (deleteProfileBtn) {
    deleteProfileBtn.addEventListener('click', deleteCurrentProfile);
  }
  
  if (saveProfileBtn) {
    saveProfileBtn.addEventListener('click', saveCurrentProfile);
  }
  
  // 添加和删除模型按钮
  const addModelBtn = document.getElementById('addModelButton');
  const deleteModelBtn = document.getElementById('deleteModelButton');
  
  if (addModelBtn) {
    addModelBtn.addEventListener('click', addNewModel);
  }
  
  if (deleteModelBtn) {
    deleteModelBtn.addEventListener('click', deleteCurrentModel);
  }
  
  // 添加配置文件管理相关事件监听器
  const configProfileSelector = document.getElementById('configProfileSelector');
  if (configProfileSelector) {
    configProfileSelector.addEventListener('change', async (event) => {
      const profileId = event.target.value;
      await switchConfigProfile(profileId);
      await updateUI();
    });
  }
  
  const addProfileButton = document.getElementById('addProfileButton');
  if (addProfileButton) {
    addProfileButton.addEventListener('click', addNewProfile);
  }
  
  const deleteProfileButton = document.getElementById('deleteProfileButton');
  if (deleteProfileButton) {
    deleteProfileButton.addEventListener('click', deleteCurrentProfile);
  }

  // 音频资源：刷新列表
  const refreshAudioBtn = document.getElementById('refreshAudioButton');
  if (refreshAudioBtn) {
    refreshAudioBtn.addEventListener('click', refreshAudioList);
  }

  // 音频提取
  const recordAudioBtn = document.getElementById('recordAudioButton');
  const stopAudioBtn = document.getElementById('stopAudioButton');
  if (recordAudioBtn) recordAudioBtn.addEventListener('click', startAudioRecording);
  if (stopAudioBtn) stopAudioBtn.addEventListener('click', stopAudioRecording);

  // 图像抓取
  const captureFrameBtn = document.getElementById('captureFrameButton');
  const captureTabBtn = document.getElementById('captureTabButton');
  if (captureFrameBtn) captureFrameBtn.addEventListener('click', captureCurrentVideoFrame);
  if (captureTabBtn) captureTabBtn.addEventListener('click', captureVisibleTabImage);

  // 视频清单刷新按钮（如有），否则在初始化时自动刷新
  const refreshVideoBtn = document.getElementById('refreshVideoButton');
  if (refreshVideoBtn) {
    refreshVideoBtn.addEventListener('click', refreshVideoList);
  }
}

// 初始化标签页导航
function initializeTabNavigation() {
  const tabButtons = Array.from(document.querySelectorAll('.tab-button[data-tab-target]'));
  const tabPanes = Array.from(document.querySelectorAll('.tab-pane'));
  if (!tabButtons.length || !tabPanes.length) return;

  const storageKey = 'cpSidepanelActiveTab';

  const setActiveTab = (targetId) => {
    if (!targetId || !document.getElementById(targetId)) {
      targetId = tabButtons[0]?.dataset?.tabTarget;
      if (!targetId) return;
    }

    tabButtons.forEach((button) => {
      const active = button.dataset.tabTarget === targetId;
      button.classList.toggle('active', active);
      button.setAttribute('aria-selected', active ? 'true' : 'false');
    });

    tabPanes.forEach((pane) => {
      const active = pane.id === targetId;
      pane.classList.toggle('active', active);
      pane.setAttribute('aria-hidden', active ? 'false' : 'true');
    });

    try {
      window.localStorage.setItem(storageKey, targetId);
    } catch (_) {
      /* 忽略存储失败 */
    }
  };

  tabButtons.forEach((button) => {
    button.addEventListener('click', () => setActiveTab(button.dataset.tabTarget));
  });

  let defaultTarget = tabButtons[0]?.dataset?.tabTarget;
  try {
    const stored = window.localStorage.getItem(storageKey);
    if (stored && document.getElementById(stored)) {
      defaultTarget = stored;
    }
  } catch (_) {
    /* 忽略读取失败 */
  }

  setActiveTab(defaultTarget);
}

// 获取活动内容标签页ID（强制刷新）
async function getActiveContentTabId(forceRefresh = false) {
  try {
    // 如果强制刷新或没有缓存的标签页ID，则重新请求
    if (forceRefresh || !activeTabId) {
      console.log('请求新的活动标签页ID');
      
      // 获取当前活动标签页
      const queryOptions = { active: true, currentWindow: true };
      const tabs = await chrome.tabs.query(queryOptions);
      
      if (tabs && tabs.length > 0) {
        const tab = tabs[0];
        
        // 检查是否为支持的网站
        if (tab.url && window.utils && window.utils.isSupportedSite(tab.url, config)) {
          activeTabId = tab.id;
          console.log('获取到支持的网站标签页ID:', activeTabId, 'URL:', tab.url);
          
          // 更新当前网站类型
          currentSite = window.utils.getSiteInfo(tab.url, config);
          console.log('当前网站类型:', currentSite?.name);
          
          return activeTabId;
        } else {
          console.log('当前标签页不是支持的网站:', tab.url);
          return null;
        }
      } else {
        console.error('没有找到活动标签页');
        return null;
      }
    } else {
      // 验证缓存的标签页是否仍然存在且是支持的网站
      try {
        const tab = await chrome.tabs.get(activeTabId);
        if (tab && tab.url && window.utils && window.utils.isSupportedSite(tab.url, config)) {
          return activeTabId;
        } else {
          // 不是支持的网站，重新获取
          console.log('缓存的标签页不是支持的网站，重新获取');
          return getActiveContentTabId(true); 
        }
      } catch (error) {
        // 标签页可能已关闭，重新获取
        console.log('缓存的标签页可能已关闭，重新获取');
        return getActiveContentTabId(true);
      }
    }
  } catch (error) {
    console.error('获取活动内容标签页失败:', error);
    return null;
  }
}

// 封装一个向内容脚本发送消息并返回 Promise 的工具函数
async function sendMessageToContent(tabId, payload) {
  return new Promise((resolve, reject) => {
    try {
      chrome.tabs.sendMessage(tabId, payload, (response) => {
        if (chrome.runtime.lastError) {
          return reject(new Error(chrome.runtime.lastError.message));
        }
        if (!response) {
          return resolve(null);
        }
        if (response.success === false && response.error) {
          return reject(new Error(response.error));
        }
        resolve(response);
      });
    } catch (e) {
      reject(e);
    }
  });
}

async function sendRuntimeMessage(message) {
  return new Promise((resolve, reject) => {
    try {
      chrome.runtime.sendMessage(message, (response) => {
        if (chrome.runtime.lastError) {
          return reject(new Error(chrome.runtime.lastError.message));
        }
        resolve(response || null);
      });
    } catch (error) {
      reject(error);
    }
  });
}

// 检查是否为支持的网站
function isSupportedSite(url) {
  if (window.utils) {
    return window.utils.isSupportedSite(url, config);
  }
  
  if (!url || !config || !config.supportedSites) return false;
  
  for (const site of config.supportedSites) {
    if (!site.enabled) continue;
    
    // 检查域名
    for (const domain of site.domains) {
      if (url.includes(domain)) {
        // 如果有patterns属性进行进一步检查，没有则直接返回true
        if (site.patterns && Array.isArray(site.patterns) && site.patterns.length > 0) {
          for (const pattern of site.patterns) {
            const regexPattern = pattern.replace(/\*/g, '.*');
            const regex = new RegExp(regexPattern);
            if (regex.test(url)) {
              return true;
            }
          }
        } else {
          return true; // 没有patterns属性但域名匹配
        }
      }
    }
  }
  
  return false;
}

// 获取网站类型
function getSiteType(url) {
  if (window.utils) {
    return window.utils.getSiteInfo(url, config);
  }
  
  if (!url || !config || !config.supportedSites) return null;
  
  for (const site of config.supportedSites) {
    if (!site.enabled) continue;
    
    for (const domain of site.domains) {
      if (url.includes(domain)) {
        return site;
      }
    }
  }
  
  return null;
}

// 获取当前站点类型（使用已缓存的 currentSite，避免异步依赖）
function getCurrentSiteType() {
  return currentSite || null;
}

// 向标签页注入脚本
async function injectScript(func, forceFresh = true) {
  try {
    console.log('注入脚本到页面，强制刷新:', forceFresh);
    
    // 如果强制刷新，则获取最新的活动标签页ID
    if (forceFresh) {
      activeTabId = await getActiveContentTabId(true);
    } else if (!activeTabId) {
      activeTabId = await getActiveContentTabId();
    }
    
    if (!activeTabId) {
      showNotification('未找到支持的网站标签页', 'error');
      return false;
    }

    // ==================== 音频资源扫描与下载 ==================== //

    async function refreshAudioList() {
      try {
        const listEl = document.getElementById('audioList');
        if (listEl) listEl.innerHTML = '<li>扫描中...</li>';

        // 确保 activeTabId
        activeTabId = await getActiveContentTabId(true);
        if (!activeTabId) {
          if (listEl) listEl.innerHTML = '<li>未找到支持的网站标签页</li>';
          return;
        }

        // 优先尝试通过内容脚本获取（适用于已注入的网站）
        let items = await requestAudioListViaMessage(activeTabId);
        if (!items || items.length === 0) {
          // 回退：直接在页面上下文扫描（适用于未注入的网站，只要有 scripting 权限）
          items = await injectScript(() => {
            try {
              const results = [];
              const seen = new Set();
              const push = (url, title) => {
                try {
                  if (!url) return;
                  const abs = new URL(url, document.baseURI).href;
                  if (seen.has(abs)) return;
                  seen.add(abs);
                  results.push({ url: abs, title: title || '' });
                } catch (_) {}
              };
              document.querySelectorAll('audio').forEach((a) => {
                const src = a.getAttribute('src');
                const title = a.getAttribute('title') || a.getAttribute('aria-label') || document.title;
                if (src) push(src, title);
                a.querySelectorAll('source').forEach((s) => {
                  const ssrc = s.getAttribute('src');
                  if (ssrc) push(ssrc, title);
                });
              });
              const audioExt = /(\.mp3|\.m4a|\.aac|\.wav|\.ogg)(\?|#|$)/i;
              document.querySelectorAll('a[href]').forEach((link) => {
                const href = link.getAttribute('href');
                if (href && audioExt.test(href)) {
                  const txt = (link.textContent || '').trim() || link.getAttribute('download') || link.getAttribute('title') || '';
                  push(href, txt);
                }
              });
              document.querySelectorAll('meta[property="og:audio"], meta[name="og:audio"]').forEach((m) => {
                const content = m.getAttribute('content');
                if (content) push(content, document.title);
              });
              return results;
            } catch (e) {
              return [];
            }
          }, false);
        }

        renderAudioList(items || []);
      } catch (e) {
        console.error('刷新音频列表失败:', e);
        showNotification('刷新音频列表失败: ' + (e?.message || e), 'error');
      }
    }

    function requestAudioListViaMessage(tabId) {
      return new Promise((resolve) => {
        try {
          chrome.tabs.sendMessage(tabId, { type: 'REQUEST_AUDIO_LIST' }, (res) => {
            if (chrome.runtime.lastError) {
              console.warn('通过消息请求音频列表失败:', chrome.runtime.lastError.message);
              resolve(null);
            } else if (res && res.success) {
              resolve(res.items || []);
            } else {
              resolve(null);
            }
          });
        } catch (err) {
          console.warn('消息请求异常:', err);
          resolve(null);
        }
      });
    }

    function renderAudioList(items) {
      const listEl = document.getElementById('audioList');
      const countEl = document.getElementById('audioCount');
      if (!listEl) return;
      listEl.innerHTML = '';
      if (!items || items.length === 0) {
        listEl.innerHTML = '<li>未发现音频链接</li>';
        if (countEl) countEl.textContent = '(0)';
        return;
      }
      if (countEl) countEl.textContent = `(${items.length})`;
      items.forEach((it, idx) => {
        const li = document.createElement('li');
        li.className = 'audio-item';
        const title = it.title && it.title.trim() ? it.title.trim() : it.url;
        li.innerHTML = `
          <span class="audio-title" title="${title}">${title}</span>
          <button class="small-button" data-act="copy" data-idx="${idx}">复制链接</button>
          <button class="small-button" data-act="download" data-idx="${idx}">下载</button>
        `;
        listEl.appendChild(li);
      });
      listEl.querySelectorAll('button[data-idx]').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          const idx = parseInt(e.currentTarget.getAttribute('data-idx'), 10);
          const act = e.currentTarget.getAttribute('data-act') || 'download';
          const it = items[idx];
          if (!it || !it.url) return;
          if (act === 'copy') copyAudioLink(it.url);
          else downloadAudio(it.url, it.title);
        });
      });
    }

    function downloadAudio(url, title) {
      try {
        const defaultFilename = (title || document.title || 'audio').replace(/[\\/:*?"<>|]/g, '_') + '.mp3';
        chrome.downloads.download({ url, filename: defaultFilename, saveAs: true }, (downloadId) => {
          if (chrome.runtime.lastError) {
            console.error('下载失败:', chrome.runtime.lastError.message);
            showNotification('下载失败: ' + chrome.runtime.lastError.message, 'error');
          } else {
            showNotification('已开始下载（ID: ' + downloadId + '）', 'success');
          }
        });
      } catch (e) {
        console.error('触发下载异常:', e);
        showNotification('触发下载异常: ' + (e?.message || e), 'error');
      }
    }
    
    // 尝试检查标签页的有效性
    try {
      const tab = await chrome.tabs.get(activeTabId);
      if (!tab || !tab.url || !isSupportedSite(tab.url)) {
        showNotification('页面已更改，请刷新后重试', 'warning');
        activeTabId = await getActiveContentTabId(true);
        if (!activeTabId) return false;
      }
      
      // 更新当前网站类型
      currentSite = getSiteType(tab.url);
    } catch (tabError) {
      console.error('标签页检查失败:', tabError);
      activeTabId = await getActiveContentTabId(true);
      if (!activeTabId) return false;
    }
    
    console.log('执行注入脚本到标签页:', activeTabId, '网站类型:', currentSite?.name);
    const result = await chrome.scripting.executeScript({
      target: { tabId: activeTabId },
      func: func,
    });
    
    return result && result[0] ? result[0].result : null;
  } catch (error) {
    console.error('脚本注入失败:', error);
    showNotification('操作失败: ' + error.message, 'error');
    return false;
  }
}

// ==================== 音频资源扫描与下载（全局） ==================== //
async function refreshAudioList() {
  try {
    const listEl = document.getElementById('audioList');
    if (listEl) listEl.innerHTML = '<li>扫描中...</li>';

    // 确保 activeTabId
    activeTabId = await getActiveContentTabId(true);
    if (!activeTabId) {
      if (listEl) listEl.innerHTML = '<li>未找到支持的网站标签页</li>';
      return;
    }

    // 优先尝试通过内容脚本获取
    let items = await requestAudioListViaMessage(activeTabId);
    if (!items || items.length === 0) {
      // 回退：直接在页面上下文扫描（无需依赖已注入的内容脚本）
      items = await injectScript(() => {
        try {
          const results = [];
          const seen = new Set();
          const push = (url, title) => {
            try {
              if (!url) return;
              const abs = new URL(url, document.baseURI).href;
              if (seen.has(abs)) return;
              seen.add(abs);
              results.push({ url: abs, title: title || '' });
            } catch (_) {}
          };
          document.querySelectorAll('audio').forEach((a) => {
            const src = a.getAttribute('src');
            const title = a.getAttribute('title') || a.getAttribute('aria-label') || document.title;
            if (src) push(src, title);
            a.querySelectorAll('source').forEach((s) => {
              const ssrc = s.getAttribute('src');
              if (ssrc) push(ssrc, title);
            });
          });
          const audioExt = /(\.mp3|\.m4a|\.aac|\.wav|\.ogg)(\?|#|$)/i;
          document.querySelectorAll('a[href]').forEach((link) => {
            const href = link.getAttribute('href');
            if (href && audioExt.test(href)) {
              const txt = (link.textContent || '').trim() || link.getAttribute('download') || link.getAttribute('title') || '';
              push(href, txt);
            }
          });
          document.querySelectorAll('meta[property="og:audio"], meta[name="og:audio"]').forEach((m) => {
            const content = m.getAttribute('content');
            if (content) push(content, document.title);
          });
          return results;
        } catch (e) {
          return [];
        }
      }, false);
    }

    const annotatedItems = await annotateAudioItems(items || []);
    renderAudioList(annotatedItems);
  } catch (e) {
    console.error('刷新音频列表失败:', e);
    showNotification('刷新音频列表失败: ' + (e?.message || e), 'error');
  }
}

function requestAudioListViaMessage(tabId) {
  return new Promise((resolve) => {
    try {
      chrome.tabs.sendMessage(tabId, { type: 'REQUEST_AUDIO_LIST' }, (res) => {
        if (chrome.runtime.lastError) {
          console.warn('通过消息请求音频列表失败:', chrome.runtime.lastError.message);
          resolve(null);
        } else if (res && res.success) {
          resolve(res.items || []);
        } else {
          resolve(null);
        }
      });
    } catch (err) {
      console.warn('消息请求异常:', err);
      resolve(null);
    }
  });
}

function renderAudioList(items) {
  const listEl = document.getElementById('audioList');
  const countEl = document.getElementById('audioCount');
  if (!listEl) return;
  listEl.innerHTML = '';
  if (!items || items.length === 0) {
    const empty = document.createElement('li');
    empty.className = 'audio-empty';
    empty.textContent = '未发现音频链接';
    listEl.appendChild(empty);
    if (countEl) countEl.textContent = '0';
    return;
  }
  if (countEl) countEl.textContent = String(items.length);
  items.forEach((it, idx) => {
    const li = document.createElement('li');
    li.className = 'audio-item';

    const row = document.createElement('div');
    row.className = 'audio-row';

    const main = document.createElement('div');
    main.className = 'audio-row-main';
    const titleText = it.title && it.title.trim() ? it.title.trim() : it.url;
    const titleEl = document.createElement('span');
    titleEl.className = 'audio-title';
    titleEl.textContent = titleText;
    titleEl.title = titleText;

    const urlEl = document.createElement('span');
    urlEl.className = 'audio-url';
    urlEl.textContent = shortenUrl(it.url);
    urlEl.title = it.url;

    main.appendChild(titleEl);
    main.appendChild(urlEl);

    const actions = document.createElement('div');
    actions.className = 'audio-row-actions';

    const meta = buildAudioStatusMeta(it.validation);
    const statusEl = document.createElement('span');
    statusEl.className = `audio-status ${meta.className}`;
    statusEl.textContent = meta.text;
    statusEl.title = meta.tooltip;

    const copyBtn = document.createElement('button');
    copyBtn.className = 'small-button';
    copyBtn.dataset.act = 'copy';
    copyBtn.dataset.idx = idx;
    copyBtn.textContent = '复制';

    const downloadBtn = document.createElement('button');
    downloadBtn.className = 'small-button';
    downloadBtn.dataset.act = 'download';
    downloadBtn.dataset.idx = idx;
    downloadBtn.textContent = '下载';
    if (it.validation && !it.validation.ok) {
      downloadBtn.disabled = true;
      downloadBtn.title = meta.tooltip || '该音频链接暂不可下载';
    }

    actions.appendChild(statusEl);
    actions.appendChild(copyBtn);
    actions.appendChild(downloadBtn);

    row.appendChild(main);
    row.appendChild(actions);
    li.appendChild(row);
    listEl.appendChild(li);
  });

  listEl.querySelectorAll('button[data-idx]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      const idx = parseInt(e.currentTarget.getAttribute('data-idx'), 10);
      const act = e.currentTarget.getAttribute('data-act') || 'download';
      const it = items[idx];
      if (!it || !it.url) return;
      if (act === 'copy') {
        copyAudioLink(it.url);
      } else if (act === 'download') {
        if (it.validation && !it.validation.ok) {
          showNotification(it.validation.reason || '该音频链接无法直接下载', 'warning');
          return;
        }
        downloadAudio(it.url, it.title);
      }
    });
  });
}

function downloadAudio(url, title) {
  try {
    const defaultFilename = (title || document.title || 'audio').replace(/[\\/:*?"<>|]/g, '_') + '.mp3';
    chrome.downloads.download({ url, filename: defaultFilename, saveAs: true }, (downloadId) => {
      if (chrome.runtime.lastError) {
        console.error('下载失败:', chrome.runtime.lastError.message);
        showNotification('下载失败: ' + chrome.runtime.lastError.message, 'error');
      } else {
        showNotification('已开始下载（ID: ' + downloadId + '）', 'success');
      }
    });
  } catch (e) {
    console.error('触发下载异常:', e);
    showNotification('触发下载异常: ' + (e?.message || e), 'error');
  }
}

function copyAudioLink(url) {
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url)
        .then(() => showNotification('已复制音频链接', 'success'))
        .catch(() => fallbackCopy(url));
    } else {
      fallbackCopy(url);
    }
  } catch (_) {
    fallbackCopy(url);
  }
}

function fallbackCopy(text) {
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    showNotification(ok ? '已复制音频链接' : '复制失败', ok ? 'success' : 'error');
  } catch (e) {
    console.warn('复制失败:', e);
    showNotification('复制失败: ' + (e?.message || e), 'error');
  }
}

//==================== 视频控制功能 ====================//

// 播放视频
async function playVideo() {
  if (!hasPlayableVideo) {
    showNotification('当前页面没有可播放的视频', 'warning');
    return;
  }
  await injectScript(() => {
    // B站视频元素选择器
    const videoSelectors = [
      'video.bilibili-player-video',      // 标准B站播放器
      '.bpx-player-video-wrap video',     // BPX播放器
      '.bilibili-player-area video',      // 旧版播放器
      '.player-wrap video',               // 移动版播放器
      'video'                             // 默认选择任何视频
    ];
    
    // 尝试多种选择器获取视频元素
    let video = null;
    for (const selector of videoSelectors) {
      video = document.querySelector(selector);
      if (video) break;
    }
    
    if (video) {
      // 尝试找到播放按钮并点击，如果直接操作视频失败的话
      const playBtnSelectors = [
        '.bilibili-player-video-btn-start',
        '.bpx-player-ctrl-play',
        '.bilibili-player-iconfont-start'
      ];
      
      const playVideoDirectly = () => {
        return video.play()
          .then(() => {
            console.log('视频开始播放');
            return true;
          })
          .catch(error => {
            console.error('直接播放失败:', error);
            return false;
          });
      };
      
      const clickPlayButton = () => {
        for (const btnSelector of playBtnSelectors) {
          const playBtn = document.querySelector(btnSelector);
          if (playBtn && !playBtn.classList.contains('video-state-pause')) {
            playBtn.click();
            console.log('已点击播放按钮');
            return true;
          }
        }
        return false;
      };
      
      // 优先尝试直接播放，失败再尝试点击按钮
      if (!playVideoDirectly()) {
        if (clickPlayButton()) {
          return true;
        } else {
          console.error('无法找到有效的播放按钮');
          return false;
        }
      }
      return true;
    } else {
      console.error('页面上没有找到视频元素');
      return false;
    }
  });
  showNotification('正在播放视频', 'info');
}

// 暂停视频
async function pauseVideo() {
  if (!hasPlayableVideo) {
    showNotification('当前页面没有可暂停的视频', 'warning');
    return;
  }
  await injectScript(() => {
    // B站视频元素选择器
    const videoSelectors = [
      'video.bilibili-player-video',
      '.bpx-player-video-wrap video',
      '.bilibili-player-area video',
      '.player-wrap video',
      'video'
    ];
    
    // 尝试多种选择器获取视频元素
    let video = null;
    for (const selector of videoSelectors) {
      video = document.querySelector(selector);
      if (video) break;
    }
    
    if (video) {
      // 尝试找到暂停按钮并点击
      const pauseBtnSelectors = [
        '.bilibili-player-video-btn-start',
        '.bpx-player-ctrl-play',
        '.bilibili-player-iconfont-pause'
      ];
      
      const pauseVideoDirectly = () => {
        if (!video.paused) {
          video.pause();
          console.log('视频已暂停');
          return true;
        }
        return false;
      };
      
      const clickPauseButton = () => {
        for (const btnSelector of pauseBtnSelectors) {
          const pauseBtn = document.querySelector(btnSelector);
          if (pauseBtn && pauseBtn.classList.contains('video-state-pause')) {
            pauseBtn.click();
            console.log('已点击暂停按钮');
            return true;
          }
        }
        return false;
      };
      
      // 优先尝试直接暂停，失败再尝试点击按钮
      if (!pauseVideoDirectly()) {
        if (clickPauseButton()) {
          return true;
        } else {
          console.warn('无法找到有效的暂停按钮');
          return false;
        }
      }
      return true;
    } else {
      console.error('页面上没有找到视频元素');
      return false;
    }
  });
  showNotification('视频已暂停', 'info');
}

//==================== 视频录制功能 ====================//

// 开始录制
async function startRecording() {
  if (!hasPlayableVideo) {
    showNotification('当前页面没有可录制的视频', 'warning');
    return;
  }
  if (isRecording) {
    showNotification('已经在录制中，请先停止当前录制', 'warning');
    return;
  }
  
  const success = await injectScript(() => {
    // B站视频元素选择器
    const videoSelectors = [
      'video.bilibili-player-video',
      '.bpx-player-video-wrap video',
      '.bilibili-player-area video',
      '.player-wrap video',
      'video'
    ];
    
    // 尝试多种选择器获取视频元素
    let video = null;
    for (const selector of videoSelectors) {
      video = document.querySelector(selector);
      if (video) break;
    }
    
    if (!video) {
      console.error('页面上没有找到视频元素');
      return false;
    }

    // 如果视频已暂停，自动开始播放
    if (video.paused) {
      video.play().catch(err => console.error('自动播放失败:', err));
    }

    // 尝试捕获视频和音频流
    try {
      const stream = video.captureStream();
      if (!stream.active) {
        console.error('捕获的流不活跃');
        return false;
      }

      // 检查并记录流的轨道状态
      const videoTracks = stream.getVideoTracks();
      const audioTracks = stream.getAudioTracks();
      console.log(`捕获的视频轨道: ${videoTracks.length}, 音频轨道: ${audioTracks.length}`);
      
      if (videoTracks.length === 0) {
        console.error('没有视频轨道可供录制');
        return false;
      }

      // 设置录制选项
      const options = {
        mimeType: 'video/webm;codecs=vp9,opus'
      };
      
      // 检查浏览器兼容性
      if (!MediaRecorder.isTypeSupported(options.mimeType)) {
        options.mimeType = 'video/webm;codecs=vp8,opus';
        
        if (!MediaRecorder.isTypeSupported(options.mimeType)) {
          options.mimeType = 'video/webm';
          
          if (!MediaRecorder.isTypeSupported(options.mimeType)) {
            console.error('浏览器不支持WebM录制');
            return false;
          }
        }
      }
      
      // 初始化 MediaRecorder
      const recorder = new MediaRecorder(stream, options);
      window.recordedChunks = []; // 初始化全局变量

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          console.log('接收到数据块:', event.data.size, 'bytes');
          window.recordedChunks.push(event.data);
        } else {
          console.warn('接收到空数据块');
        }
      };

      recorder.onstop = () => {
        if (window.recordedChunks.length === 0) {
          console.error('没有录制到数据块');
          return;
        }

        const blob = new Blob(window.recordedChunks, { 
          type: options.mimeType
        });
        console.log('录制完成，视频大小:', Math.round(blob.size/1024/1024*100)/100, 'MB');

        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        
        // 获取视频标题作为文件名
        let fileName = 'bilibili_recording';
        try {
          // 尝试多种可能的标题选择器
          const titleSelectors = [
            'h1.video-title',                  // 标准视频标题
            '.bpx-player-video-title',         // BPX播放器标题
            '.media-title',                    // 媒体中心标题
            '.multi-page-title',               // 多P视频标题
            '.video-area .title',              // 通用视频区域标题
            '.tit',                            // 短标题
            'title'                            // 页面标题
          ];
          
          let titleElement = null;
          for (const selector of titleSelectors) {
            titleElement = document.querySelector(selector);
            if (titleElement) break;
          }
          
          if (titleElement) {
            fileName = titleElement.textContent || titleElement.innerText || document.title;
            // 清理文件名
            fileName = fileName.trim()
                             .replace(/哔哩哔哩/g, '')
                             .replace(/bilibili/gi, '')
                             .replace(/_+/g, '_')
                             .replace(/\s+/g, '_')
                             .replace(/[\/\\:*?"<>|]/g, '_');
          }
        } catch (err) {
          console.error('获取视频标题失败:', err);
        }
        
        const now = new Date();
        const timestamp = now.toISOString().replace(/[:.]/g, '-').slice(0, 19);
        a.download = `${fileName}_${timestamp}.webm`;
        a.click();
        URL.revokeObjectURL(url);
        return true;
      };

      recorder.onerror = (error) => {
        console.error('MediaRecorder 错误:', error.message || error);
        return false;
      };

      try {
        recorder.start(1000); // 每秒触发一次 ondataavailable
        window.mediaRecorder = recorder; // 保存 recorder 实例以便后续控制
        console.log('录制已开始');
        return true;
      } catch (startError) {
        console.error('开始录制失败:', startError);
        return false;
      }
    } catch (captureError) {
      console.error('捕获流失败:', captureError);
      return false;
    }
  });
  
  if (success) {
    isRecording = true;
    document.getElementById('recordButton').disabled = true;
    document.getElementById('stopButton').disabled = false;
    showNotification('开始录制视频', 'success');
  } else {
    showNotification('录制失败，请检查视频页面', 'error');
  }
}

// ==================== 音频录制功能（仅音轨） ==================== //
async function startAudioRecording() {
  if (!hasPlayableVideo) {
    showNotification('当前页面没有可提取音频的视频', 'warning');
    return;
  }
  if (isRecording) {
    showNotification('已有录制任务在进行，请先停止', 'warning');
    return;
  }
  const ok = await injectScript(() => {
    const videos = document.querySelectorAll('video');
    const video = videos && videos[0];
    if (!video) return false;
    try {
      const stream = video.captureStream();
      const audioTracks = stream.getAudioTracks();
      if (audioTracks.length === 0) return false;
      const onlyAudio = new MediaStream();
      audioTracks.forEach(t => onlyAudio.addTrack(t));
      const typeList = [
        'audio/webm;codecs=opus',
        'audio/webm',
        'audio/ogg;codecs=opus',
        'audio/ogg'
      ];
      let mimeType = '';
      for (const t of typeList) { if (MediaRecorder.isTypeSupported(t)) { mimeType = t; break; } }
      if (!mimeType) return false;
      const rec = new MediaRecorder(onlyAudio, { mimeType });
      window.__audioChunks = [];
      rec.ondataavailable = (e) => { if (e.data && e.data.size) window.__audioChunks.push(e.data); };
      rec.onstop = () => {
        try {
          const blob = new Blob(window.__audioChunks, { type: mimeType });
          const a = document.createElement('a');
          a.href = URL.createObjectURL(blob);
          const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
          a.download = (document.title || 'audio') + '_' + ts + (mimeType.includes('ogg') ? '.ogg' : '.webm');
          a.click();
          setTimeout(() => URL.revokeObjectURL(a.href), 30000);
        } catch (_) {}
      };
      rec.start(500);
      window.__audioRec = rec;
      return true;
    } catch (_) { return false; }
  });
  if (ok) {
    isRecording = true;
    const b1 = document.getElementById('recordAudioButton');
    const b2 = document.getElementById('stopAudioButton');
    if (b1) b1.disabled = true;
    if (b2) b2.disabled = false;
    showNotification('开始录制音频', 'success');
  } else {
    showNotification('未找到可录制的音频轨', 'error');
  }
}

async function stopAudioRecording() {
  await injectScript(() => {
    try {
      if (window.__audioRec && window.__audioRec.state !== 'inactive') {
        window.__audioRec.stop();
        return true;
      }
      return false;
    } catch (_) { return false; }
  });
  isRecording = false;
  const b1 = document.getElementById('recordAudioButton');
  const b2 = document.getElementById('stopAudioButton');
  if (b1) b1.disabled = false;
  if (b2) b2.disabled = true;
  showNotification('音频录制已停止', 'info');
}

// ==================== 图像抓取功能 ==================== //
async function captureCurrentVideoFrame() {
  if (!hasPlayableVideo) {
    showNotification('当前页面没有可抓取画面的视频', 'warning');
    return;
  }
  try {
    const dataUrl = await injectScript(() => {
      try {
        const v = document.querySelector('video');
        if (!v || v.readyState < 2) return null;
        const c = document.createElement('canvas');
        c.width = v.videoWidth || 1280; c.height = v.videoHeight || 720;
        const ctx = c.getContext('2d');
        ctx.drawImage(v, 0, 0, c.width, c.height);
        return c.toDataURL('image/png');
      } catch (_) { return null; }
    });
    if (!dataUrl) { showNotification('未获取到视频帧', 'warning'); return; }
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    chrome.downloads.download({ url: dataUrl, filename: `frame_${ts}.png`, saveAs: true });
  } catch (e) {
    showNotification('抓取视频帧失败: ' + (e?.message || e), 'error');
  }
}

async function captureVisibleTabImage() {
  try {
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const dataUrl = await chrome.tabs.captureVisibleTab(undefined, { format: 'png' });
    chrome.downloads.download({ url: dataUrl, filename: `screencap_${ts}.png`, saveAs: true });
  } catch (e) {
    showNotification('页面截图失败: ' + (e?.message || e), 'error');
  }
}

// 停止录制
async function stopRecording() {
  try {
    // 停止录制
    await injectScript(() => {
      if (window.mediaRecorder && window.mediaRecorder.state !== 'inactive') {
        window.mediaRecorder.stop();
        window.mediaRecorder.stream.getTracks().forEach(track => track.stop());
        return true;
      }
      return false;
    });

    // 同时暂停视频播放
    await pauseVideo();

    isRecording = false;
    document.getElementById('recordButton').disabled = false;
    document.getElementById('stopButton').disabled = true;
    showNotification('录制已停止，视频将自动下载', 'success');
  } catch (error) {
    console.error('停止录制失败:', error);
    showNotification('停止录制失败: ' + error.message, 'error');
  }
}

//==================== AI分析功能 ====================//

// 分析B站内容
async function analyzeContent() {
  const activeTabId = await getActiveTabId();
  if (!activeTabId) {
    showNotification('无法获取当前标签页', 'error');
    return;
  }
  
  try {
    // 获取页面信息
    const response = await chrome.tabs.sendMessage(activeTabId, { type: 'GET_PAGE_INFO' });
    if (!response || !response.success) {
      throw new Error(response?.error || '获取页面信息失败');
    }
    
    const { siteId, pageInfo } = response.data;
    
    // 加载配置获取模板和AI模型设置
    const config = await loadConfig();
    const promptTemplate = getPromptTemplate(siteId, config) || config.analysis?.promptTemplates?.default || '';
    const activeModel = getActiveAiModel(config);
    
    if (!activeModel || !activeModel.enabled || !activeModel.apiKey) {
      throw new Error('请先配置并启用AI模型');
    }
    
    // 使用模板生成提示词
    const prompt = formatPrompt(promptTemplate, pageInfo);
    
    // 显示加载状态
    showAnalysisLoading();
    
    // 发送AI请求
    const aiResponse = await chrome.runtime.sendMessage({
      type: 'PROXY_AI_REQUEST',
      data: {
        url: activeModel.apiUrl,
        apiKey: activeModel.apiKey,
        prompt: prompt
      }
    });
    
    if (!aiResponse || !aiResponse.success) {
      throw new Error(aiResponse?.error || 'AI分析请求失败');
    }
    
    // 显示分析结果
    showAnalysisResult(aiResponse.result);
    
  } catch (error) {
    console.error('内容分析错误:', error);
    showNotification(error.message, 'error');
    hideAnalysisLoading();
  }
}

// 获取页面内容
async function getPageContent() {
  try {
    console.log('开始获取页面内容...');
    
    // 强制刷新标签页ID，确保获取当前页面
    activeTabId = null;
    const tabId = await getActiveContentTabId(true);
    
    if (!tabId) {
      throw new Error('未找到有效的B站标签页');
    }
    
    // 注入脚本强制要求最新内容
    const result = await injectScript(() => {
      // 获取当前页面的URL和BV号，用于检测页面变化
      const currentUrl = window.location.href;
      const currentBvid = window.location.pathname.match(/\/video\/([^/?]+)/)?.[1] || '';
      
      // 浏览器控制台可以看到当前分析的是哪个视频
      console.log(`获取页面内容: ${currentUrl} (BV: ${currentBvid})`);
      
      // 获取标题，尝试多种选择器
      const titleSelectors = [
        'h1.video-title',                  // 标准视频标题
        '.bpx-player-video-title',         // BPX播放器标题
        '.media-title',                    // 媒体中心标题
        '.multi-page-title',               // 多P视频标题
        '.video-area .title',              // 通用视频区域标题
        '.tit',                            // 短标题
        'title'                            // 页面标题
      ];
      
      let videoTitle = '';
      for (const selector of titleSelectors) {
        const titleElement = document.querySelector(selector);
        if (titleElement) {
          videoTitle = titleElement.textContent || titleElement.innerText;
          break;
        }
      }
      
      // 处理页面标题，去除B站后缀
      const title = document.title
                   .replace(/_哔哩哔哩_bilibili$/, '')
                   .replace(/_bilibili$/, '')
                   .replace(/_哔哩哔哩弹幕视频网$/, '')
                   .replace(/ - 哔哩哔哩$/, '')
                   .trim();
      
      // 获取视频信息
      let videoInfo = {};
      const videoSelectors = [
        'video.bilibili-player-video',
        '.bpx-player-video-wrap video',
        '.bilibili-player-area video',
        '.player-wrap video',
        'video'
      ];
      
      let video = null;
      for (const selector of videoSelectors) {
        video = document.querySelector(selector);
        if (video) break;
      }
      
      if (video) {
        videoInfo = {
          duration: video.duration,
          currentTime: video.currentTime,
          paused: video.paused,
          muted: video.muted,
          volume: video.volume,
          width: video.videoWidth,
          height: video.videoHeight
        };
      }
      
      // 获取UP主信息，尝试多种选择器
      const uploaderSelectors = [
        '.up-name',                        // 标准UP主名称
        'a.up-name',                       // 可点击的UP主
        '.author .name',                   // 作者名称
        '.up-info .username',              // UP信息中的用户名
        '.upname',                         // 简单UP名
        'a.username',                      // 用户名链接
        '.user-name'                       // 用户名
      ];
      
      let uploader = '';
      for (const selector of uploaderSelectors) {
        const uploaderElement = document.querySelector(selector);
        if (uploaderElement) {
          uploader = uploaderElement.textContent || uploaderElement.innerText;
          break;
        }
      }
      
      // 获取视频描述
      const descriptionSelectors = [
        '.desc-info',                      // 标准描述信息
        '.video-desc',                     // 视频描述
        '.info .desc',                     // 信息中的描述
        '.summary',                        // 摘要
        '.video-description',              // 视频描述
        '.desc'                            // 简单描述
      ];
      
      let description = '';
      for (const selector of descriptionSelectors) {
        const descElement = document.querySelector(selector);
        if (descElement) {
          description = descElement.textContent || descElement.innerText;
          break;
        }
      }
      
      // 获取视频标签，尝试多种选择器
      const tagSelectors = [
        '.tag-link',                       // 标准标签链接
        '.video-tag .tag',                 // 视频标签
        '.tag-list .tag',                  // 标签列表中的标签
        '.tag-area .tag',                  // 标签区域中的标签
        '.tags a'                          // 简单标签链接
      ];
      
      let tags = [];
      for (const selector of tagSelectors) {
        const tagElements = document.querySelectorAll(selector);
        if (tagElements && tagElements.length > 0) {
          tags = Array.from(tagElements).map(tag => tag.textContent || tag.innerText);
          break;
        }
      }
      
      // 获取弹幕
      const danmakuSelectors = [
        '.bilibili-player-danmaku',        // 标准弹幕容器
        '.danmaku-item',                   // 弹幕项
        '.danmaku-content',                // 弹幕内容
        '.bpx-player-dm-container'         // BPX播放器弹幕容器
      ];
      
      let danmakus = [];
      for (const selector of danmakuSelectors) {
        const elements = document.querySelectorAll(selector);
        if (elements && elements.length > 0) {
          danmakus = Array.from(elements).map(item => item.textContent || item.innerText).slice(0, 100);
          break;
        }
      }
      
      // 获取视频统计信息
      const viewCountSelectors = [
        '.view-count',                     // 标准播放量
        '.view span',                      // 查看量
        '.video-data .view',               // 视频数据中的播放量
        '.play-count',                     // 播放数
        '.info-text .view'                 // 信息文本中的播放量
      ];
      
      let viewCount = '';
      for (const selector of viewCountSelectors) {
        const countElement = document.querySelector(selector);
        if (countElement) {
          viewCount = countElement.textContent || countElement.innerText;
          break;
        }
      }
      
      const likeCountSelectors = [
        '.like-count',                     // 标准点赞量
        '.like span',                      // 点赞数
        '.video-data .like',               // 视频数据中的点赞量
        '.ops .like .info-text',           // 操作中的点赞数
        '.info-text .like'                 // 信息文本中的点赞量
      ];
      
      let likeCount = '';
      for (const selector of likeCountSelectors) {
        const countElement = document.querySelector(selector);
        if (countElement) {
          likeCount = countElement.textContent || countElement.innerText;
          break;
        }
      }
      
      // 获取视频分区
      const categorySelectors = [
        '.a-crumbs .b-crumb',              // 面包屑
        '.head-con .series',               // 系列
        '.video-category',                 // 视频分类
        '.category'                        // 分类
      ];
      
      let category = '';
      for (const selector of categorySelectors) {
        const categoryElement = document.querySelector(selector);
        if (categoryElement) {
          category = categoryElement.textContent || categoryElement.innerText;
          break;
        }
      }
      
      // 收集页面上的额外数据
      const extraData = {
        bvid: currentBvid,
        pubdate: document.querySelector('.pubdate')?.textContent || '',
        favCount: document.querySelector('.collect .info-text')?.textContent || '',
        coinCount: document.querySelector('.coin .info-text')?.textContent || '',
        shareCount: document.querySelector('.share .info-text')?.textContent || '',
        category: category
      };
      
      return {
        url: currentUrl,
        title: title,
        videoTitle: videoTitle || title,
        uploader: uploader,
        description: description,
        tags: tags,
        videoInfo: videoInfo,
        danmakus: danmakus,
        viewCount: viewCount,
        likeCount: likeCount,
        extraData: extraData,
        bodyText: document.body.innerText.substring(0, 5000) // 限制文本长度
      };
    }, true); // 强制刷新
    
    console.log('页面内容获取成功');
    return result;
  } catch (error) {
    console.error('获取页面内容失败:', error);
    showNotification('获取内容失败: ' + error.message, 'error');
    return null;
  }
}

// 使用AI分析内容
async function analyzeWithAI(pageData) {
  try {
    // 获取当前激活的AI模型
    const activeModel = window.utils ? window.utils.getActiveAiModel(config) : null;
    
    // 检查是否有可用的AI模型
    if (!activeModel || !activeModel.apiKey) {
      showNotification('请先在设置中配置AI模型密钥', 'warning');
      throw new Error('未配置AI模型密钥');
    }
    
    // 根据不同网站类型构建不同的提示词
    let promptTemplate = '';
    let siteType = (currentSite && currentSite.name) || '未知网站';
    
    // 通用数据字段
    const commonData = {
      title: pageData.title || pageData.videoTitle || '未知标题',
      url: pageData.url || '未知URL',
      description: pageData.description || '',
      tags: (pageData.tags && pageData.tags.length > 0) ? pageData.tags.join(', ') : '无标签',
      author: pageData.uploader || pageData.author || pageData.creator || '未知作者',
      likeCount: pageData.likeCount || '未知',
      viewCount: pageData.viewCount || '未知'
    };
    
    // 根据网站类型构建不同的提示词
    switch (siteType) {
      case '哔哩哔哩':
        promptTemplate = `
请分析以下哔哩哔哩视频页面内容，并提供一个结构化的摘要信息：

标题: ${commonData.title}
UP主: ${commonData.author}
视频链接: ${commonData.url}
视频描述: ${commonData.description}
标签: ${commonData.tags}
观看数: ${commonData.viewCount}
点赞数: ${commonData.likeCount}

请提供：
1. 视频的主要内容概括（100字以内）
2. 视频的核心观点或亮点（3-5点）
3. 视频的目标受众
4. 视频内容的分类和标签
5. 视频的质量评估

将结果格式化为易读的结构。
`;
        break;
        
      case '知乎':
        promptTemplate = `
请分析以下知乎内容，并提供一个结构化的摘要信息：

标题: ${commonData.title}
作者: ${commonData.author}
链接: ${commonData.url}
内容描述: ${commonData.description}
标签/话题: ${commonData.tags}
赞同数: ${commonData.likeCount}
浏览数: ${commonData.viewCount}

请提供：
1. 内容的主要观点概括（100字以内）
2. 核心论点和支持证据（3-5点）
3. 讨论的价值和意义
4. 内容的逻辑性和完整性评估
5. 相关领域和应用场景

将结果格式化为易读的结构。
`;
        break;
        
      case '抖音':
        promptTemplate = `
请分析以下抖音视频内容，并提供一个结构化的摘要信息：

标题/描述: ${commonData.title}
创作者: ${commonData.author}
链接: ${commonData.url}
标签: ${commonData.tags}
点赞数: ${commonData.likeCount}
播放量: ${commonData.viewCount}

请提供：
1. 视频的主要内容概括（50字以内）
2. 视频的创意点或吸引力（2-3点）
3. 目标受众群体
4. 传播价值分析
5. 内容类型和风格特点

将结果格式化为易读的结构。
`;
        break;
        
      case '微博':
        promptTemplate = `
请分析以下微博内容，并提供一个结构化的摘要信息：

内容: ${commonData.title}
作者: ${commonData.author}
链接: ${commonData.url}
话题标签: ${commonData.tags}
点赞数: ${commonData.likeCount}

请提供：
1. 微博内容的主要观点或信息（50字以内）
2. 引起的社会关注点或讨论焦点
3. 表达的情感倾向和态度
4. 传播影响分析
5. 相关背景信息补充（如果有）

将结果格式化为易读的结构。
`;
        break;
        
      case '小红书':
        promptTemplate = `
请分析以下小红书笔记内容，并提供一个结构化的摘要信息：

标题: ${commonData.title}
博主: ${commonData.author}
链接: ${commonData.url}
描述: ${commonData.description}
标签: ${commonData.tags}
点赞数: ${commonData.likeCount}
收藏/浏览数: ${commonData.viewCount}

请提供：
1. 笔记的主要内容概括（80字以内）
2. 内容的核心推荐或观点（3-4点）
3. 实用性和参考价值评估
4. 适合的目标受众
5. 内容风格和展示特点

将结果格式化为易读的结构。
`;
        break;
        
      case 'YouTube':
        promptTemplate = `
请分析以下YouTube视频内容，并提供一个结构化的摘要信息：

标题: ${commonData.title}
创作者: ${commonData.author}
链接: ${commonData.url}
描述: ${commonData.description}
标签: ${commonData.tags}
点赞数: ${commonData.likeCount}
观看数: ${commonData.viewCount}

请提供：
1. 视频的主要内容概括（100字以内）
2. 视频的核心观点或亮点（3-5点）
3. 视频的目标受众和适用场景
4. 制作质量和专业度评估
5. 内容分类和相关领域

将结果格式化为易读的结构。
`;
        break;
        
      default:
        // 尝试从config中获取提示词模板
        if (window.utils && currentSite && currentSite.id) {
          promptTemplate = window.utils.getPromptTemplate(currentSite.id, config);
          if (promptTemplate) {
            promptTemplate = window.utils.formatPrompt(promptTemplate, commonData);
          }
        }
        
        // 如果没有找到模板，使用通用提示词
        if (!promptTemplate) {
          promptTemplate = `
请分析以下网页内容，并提供一个结构化的摘要信息：

标题: ${commonData.title}
作者/创建者: ${commonData.author}
链接: ${commonData.url}
描述: ${commonData.description}
标签/主题: ${commonData.tags}
互动数据: 点赞 ${commonData.likeCount}, 浏览 ${commonData.viewCount}
网站类型: ${siteType}

请提供：
1. 内容的主要观点或信息概括（100字以内）
2. 核心要点或亮点（3-5点）
3. 内容的价值和意义
4. 适合的目标受众
5. 内容质量和可信度评估

将结果格式化为易读的结构。
`;
        }
    }
    
    console.log(`正在使用 ${activeModel.name} 发送AI请求到: ${activeModel.apiUrl}`);
    console.log(`分析网站类型: ${siteType}`);
    
    try {
      // 尝试通过Fetch API直接请求
      const response = await fetch(activeModel.apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${activeModel.apiKey}`
        },
        body: JSON.stringify({
          model: activeModel.model,
          messages: [
            {
              role: "system",
              content: "你是一个专业内容分析助手，负责分析各类网站的内容并提供结构化摘要。"
            },
            {
              role: "user",
              content: promptTemplate
            }
          ],
          max_tokens: 1000,
          temperature: 0.7
        })
      });
      
      if (!response.ok) {
        const errorText = await response.text().catch(() => '无错误详情');
        console.error('API响应错误:', response.status, errorText);
        throw new Error(`AI请求失败: ${response.status} ${response.statusText}`);
      }
      
      const data = await response.json();
      return data.choices[0].message.content;
    } catch (fetchError) {
      console.error('直接请求AI API失败:', fetchError);
      
      // 使用后备方案：通过background.js中转请求
      try {
        console.log('尝试通过background.js中转请求...');
        const response = await chrome.runtime.sendMessage({
          type: "PROXY_AI_REQUEST",
          data: {
            url: activeModel.apiUrl,
            apiKey: activeModel.apiKey,
            modelName: activeModel.model,
            prompt: promptTemplate
          }
        });
        
        if (response.success && response.result) {
          return response.result;
        } else {
          throw new Error(response.error || '通过background代理请求失败');
        }
      } catch (proxyError) {
        console.error('代理请求也失败:', proxyError);
        
        // 使用备用的离线分析
        console.log('尝试使用离线分析作为备份...');
        return generateOfflineAnalysis(pageData, siteType);
      }
    }
  } catch (error) {
    console.error('AI分析失败:', error);
    throw error; // 向上层抛出错误以便显示通知
  }
}

// 离线分析（当API不可用时的备用方案）
function generateOfflineAnalysis(pageData, siteType) {
  console.log('使用本地分析生成基本摘要');
  
  const title = pageData.videoTitle || pageData.title || '未知标题';
  const author = pageData.uploader || pageData.author || '未知作者';
  const viewCount = pageData.viewCount || '未知';
  const likeCount = pageData.likeCount || '未知';
  
  return `
# ${siteType}内容分析（离线生成）

## 基本信息
- 标题: ${title}
- 作者/创建者: ${author}
- 观看/浏览数: ${viewCount}
- 点赞/互动数: ${likeCount}

## 内容概括
由于API连接问题，无法生成详细分析。这是基于本地数据的简要概括。

## 内容分类
${getDefaultCategory(pageData, siteType)}

*注: 此分析是在AI API无法连接时本地生成的基础分析，不包含AI辅助内容*
`;
}

// 根据标题和标签生成默认分类
function getDefaultCategory(pageData, siteType) {
  const tags = pageData.tags || [];
  const title = (pageData.videoTitle || pageData.title || '').toLowerCase();
  
  // 根据网站类型应用不同规则
  if (siteType === '哔哩哔哩' || siteType === 'YouTube') {
    // 视频网站分类
    if (tags.some(t => t.includes('教程') || t.includes('教学') || t.includes('how') || t.includes('tutorial'))) {
      return '教程/知识分享';
    } else if (tags.some(t => t.includes('游戏') || t.includes('game'))) {
      return '游戏视频';
    } else if (tags.some(t => t.includes('音乐') || t.includes('MV') || t.includes('music'))) {
      return '音乐视频';
    } else if (tags.some(t => t.includes('动画') || t.includes('番剧') || t.includes('anime'))) {
      return '动画/番剧';
    } else if (tags.some(t => t.includes('娱乐') || t.includes('搞笑') || t.includes('funny'))) {
      return '娱乐/搞笑视频';
    } else if (tags.some(t => t.includes('科技') || t.includes('数码') || t.includes('tech'))) {
      return '科技/数码';
    } else {
      return '其他类型视频';
    }
  } else if (siteType === '知乎') {
    // 知乎内容分类
    if (tags.some(t => t.includes('科技') || t.includes('技术'))) {
      return '科技/技术讨论';
    } else if (tags.some(t => t.includes('教育') || t.includes('学习'))) {
      return '教育/学习资源';
    } else if (tags.some(t => t.includes('职场') || t.includes('工作'))) {
      return '职场/工作经验';
    } else if (tags.some(t => t.includes('生活') || t.includes('日常'))) {
      return '生活方式/日常';
    } else if (tags.some(t => t.includes('情感') || t.includes('关系'))) {
      return '情感/人际关系';
    } else {
      return '知识分享/问答';
    }
  } else if (siteType === '小红书') {
    // 小红书内容分类
    if (tags.some(t => t.includes('美食') || t.includes('食谱'))) {
      return '美食/烹饪';
    } else if (tags.some(t => t.includes('穿搭') || t.includes('服饰'))) {
      return '时尚/穿搭';
    } else if (tags.some(t => t.includes('美妆') || t.includes('护肤'))) {
      return '美妆/护肤';
    } else if (tags.some(t => t.includes('旅行') || t.includes('旅游'))) {
      return '旅行/探店';
    } else if (tags.some(t => t.includes('家居') || t.includes('装修'))) {
      return '家居/装修';
    } else {
      return '生活方式/分享';
    }
  } else {
    // 通用内容分类
    if (tags.some(t => t.includes('资讯') || t.includes('新闻'))) {
      return '新闻/资讯';
    } else if (tags.some(t => t.includes('教育') || t.includes('学习'))) {
      return '教育/学习';
    } else if (tags.some(t => t.includes('娱乐') || t.includes('搞笑'))) {
      return '娱乐/休闲';
    } else if (tags.some(t => t.includes('生活') || t.includes('日常'))) {
      return '生活/日常';
    } else {
      return '一般内容';
    }
  }
}

// 显示分析结果
function displayAnalysisResult(result) {
  const resultPlaceholder = document.querySelector('.result-placeholder');
  const resultContent = document.querySelector('.result-content');
  
  resultPlaceholder.style.display = 'none';
  resultContent.style.display = 'block';
  resultContent.textContent = result;
}

// 保存分析结果
async function saveAnalysisResult() {
  if (!analysisResult) {
    showNotification('没有可保存的分析结果', 'warning');
    return;
  }

  if (!MCP_FEATURE_ENABLED) {
    showNotification('MCP 功能已暂时关闭，无法保存本地文件', 'info');
    return;
  }

  if (!window.mcp || !window.mcp.client) {
    showNotification('未检测到MCP客户端，无法保存文件', 'error');
    return;
  }
  
  try {
    showNotification('正在保存分析结果...', 'info');
    
    // 检查MCP服务可用性
    const storage = await chrome.storage.local.get('mcpServiceAvailable');
    if (!storage.mcpServiceAvailable) {
      await window.mcp.client.checkAvailability();
      if (!window.mcp.client.isAvailable) {
        showNotification('MCP服务不可用，无法保存文件', 'error');
        return;
      }
    }
    
    // 添加BV号作为文件名前缀（如果存在）
    let bvPrefix = '';
    if (analysisResult.bvid) {
      bvPrefix = `${analysisResult.bvid}_`;
    }
    
    // 清理文件名
    const fileName = (analysisResult.title || '未知视频')
                   .trim()
                   .replace(/[\/\\:*?"<>|]/g, '_')
                   .substring(0, 50); // 限制长度
    
    // 创建完整文件名
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const fullFileName = `${bvPrefix}${fileName}_${timestamp}.txt`;
    
    // 准备保存内容
    const contentToSave = 
      `标题: ${analysisResult.title}\n` +
      `BV号: ${analysisResult.bvid || '未知'}\n` + 
      `URL: ${analysisResult.url}\n` +
      `分析时间: ${new Date(analysisResult.timestamp).toLocaleString()}\n\n` +
      `分析结果:\n${analysisResult.content}`;
    
    // 使用MCP客户端保存
    const result = await window.mcp.client.saveToFile(fullFileName, contentToSave);
    
    if (result && result.success) {
      showNotification(`分析结果已保存到: ${result.path}`, 'success');
    } else {
      showNotification('文件保存失败', 'error');
    }
  } catch (error) {
    console.error('保存分析结果失败:', error);
    showNotification('保存失败: ' + error.message, 'error');
  }
}

//==================== 设置与配置 ====================//

// 更新AI模型选择器
function updateAiModelSelector() {
  const modelSelector = document.getElementById('aiModelSelector');
  if (!modelSelector) return;
  if (!config) return;
  if (!Array.isArray(config.aiModels)) {
    config.aiModels = [];
  }
  if (!config.analysis || typeof config.analysis !== 'object') {
    config.analysis = { defaultModel: config.aiModels[0]?.id || '', promptTemplates: {} };
  }
  const defaultModelId = config.analysis.defaultModel || config.aiModels[0]?.id || '';
  
  // 清空现有选项
  modelSelector.innerHTML = '';
  
  // 添加所有模型选项
  if (config.aiModels && config.aiModels.length > 0) {
    config.aiModels.forEach((model, index) => {
      const option = document.createElement('option');
      option.value = index;
      option.textContent = model.name || model.id || `模型${index + 1}`;
      option.selected = !!defaultModelId && model.id === defaultModelId;
      modelSelector.appendChild(option);
    });
  } else {
    // 如果没有模型，添加默认选项
    const option = document.createElement('option');
    option.value = 0;
    option.textContent = '未配置模型';
    modelSelector.appendChild(option);
  }
  
  // 更新当前模型信息显示
  updateActiveModelInfo();
}

// 更新当前模型信息显示
function updateActiveModelInfo() {
  if (!config || !Array.isArray(config.aiModels) || config.aiModels.length === 0) return;
  
  const activeModel = window.utils ? window.utils.getActiveAiModel(config) : config.aiModels[0];
  const keyInput = document.getElementById('aiModelKey');
  const urlInput = document.getElementById('aiModelUrl');
  const nameInput = document.getElementById('aiModelName');
  
  if (activeModel) {
    if (keyInput) keyInput.value = activeModel.apiKey || '';
    if (urlInput) urlInput.value = activeModel.apiUrl || '';
    if (nameInput) nameInput.value = activeModel.model || '';
  }
}

// 处理模型选择变更
function handleModelChange(event) {
  const selectedIndex = parseInt(event.target.value);
  if (isNaN(selectedIndex)) return;
  if (!config) return;
  if (!Array.isArray(config.aiModels)) {
    config.aiModels = [];
  }
  if (!config.analysis || typeof config.analysis !== 'object') {
    config.analysis = { defaultModel: '', promptTemplates: {} };
  }
  
  // 更新默认模型ID
  if (config.aiModels[selectedIndex]) {
    config.analysis.defaultModel = config.aiModels[selectedIndex].id;
  }
  
  // 更新UI显示
  updateActiveModelInfo();
}

// 显示/隐藏设置面板
function toggleSettingsPanel() {
  const settingsPanel = document.getElementById('settingsPanel');
  const settingsBtn = document.getElementById('settingsBtn');
  
  if (settingsPanel.style.display === 'none' || !settingsPanel.style.display) {
    settingsPanel.style.display = 'block';
    settingsBtn.classList.add('active');
    // 确保配置面板显示正确的配置
    updateSettingsUI();
  } else {
    settingsPanel.style.display = 'none';
    settingsBtn.classList.remove('active');
  }
}

// 更新设置UI以反映当前配置
async function updateSettingsUI() {
  // 更新网站支持状态
  const supportedSitesEl = document.getElementById('supportedSites');
  if (supportedSitesEl && config.supportedSites) {
    supportedSitesEl.innerHTML = '';
    
    config.supportedSites.forEach(site => {
      const siteToggle = document.createElement('div');
      siteToggle.className = 'site-toggle';
      
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.id = `site-${site.id}`;
      checkbox.checked = site.enabled;
      checkbox.addEventListener('change', (e) => {
        site.enabled = e.target.checked;
        saveSettings();
      });
      
      const label = document.createElement('label');
      label.htmlFor = `site-${site.id}`;
      label.textContent = site.name;
      
      siteToggle.appendChild(checkbox);
      siteToggle.appendChild(label);
      supportedSitesEl.appendChild(siteToggle);
    });
  }
  
  // 更新配置文件选择器
  await updateConfigProfileSelector();
  
  // 更新AI模型选择器
  updateAiModelSelector();
  
  // 更新模型特定设置
  updateActiveModelInfo();
}

// 更新配置文件选择器
async function updateConfigProfileSelector() {
  const profileSelectorEl = document.getElementById('configProfileSelector');
  if (!profileSelectorEl) return;
  
  // 获取配置文件列表
  const profiles = await loadConfigProfiles();
  
  // 清空选择器
  profileSelectorEl.innerHTML = '';
  
  // 添加配置文件选项
  profiles.forEach(profile => {
    const option = document.createElement('option');
    option.value = profile.id;
    option.textContent = profile.name;
    option.selected = profile.isActive;
    profileSelectorEl.appendChild(option);
  });
}

function updateProfileSelector() {
  return updateConfigProfileSelector();
}

// 保存设置
function saveSettings() {
  // 获取用户界面设置
  const themeSelect = document.getElementById('themeSelect');
  if (themeSelect) {
    config.interface.theme = themeSelect.value;
  }
  
  const langSelect = document.getElementById('langSelect');
  if (langSelect) {
    config.interface.language = langSelect.value;
  }
  
  // 获取录制设置
  const formatSelect = document.getElementById('formatSelect');
  if (formatSelect) {
    config.recording.format = formatSelect.value;
  }
  
  const qualitySelect = document.getElementById('qualitySelect');
  if (qualitySelect) {
    config.recording.quality = qualitySelect.value;
  }
  
  const autoSaveCheck = document.getElementById('autoSaveCheck');
  if (autoSaveCheck) {
    config.recording.autoSave = autoSaveCheck.checked;
  }
  
  // 获取AI分析设置
  const aiModelSelect = document.getElementById('aiModelSelect');
  if (aiModelSelect) {
    if (!config.analysis || typeof config.analysis !== 'object') {
      config.analysis = { defaultModel: config.aiModels?.[0]?.id || '', promptTemplates: {} };
    }
    config.analysis.currentModel = aiModelSelect.value;
  }
  
  // 保存配置到本地存储
  chrome.storage.local.set({ 'appConfig': config }, function() {
    console.log('设置已保存');
    showNotification('设置已保存', 'success');
    
    // 隐藏设置面板
    const settingsPanel = document.getElementById('settingsPanel');
    if (settingsPanel) {
      settingsPanel.style.display = 'none';
    }
    
    const settingsBtn = document.getElementById('settingsBtn');
    if (settingsBtn) {
      settingsBtn.classList.remove('active');
    }
  });
}

// 添加新模型
function addNewModel() {
  if (!config) return;
  if (!Array.isArray(config.aiModels)) {
    config.aiModels = [];
  }
  // 创建新模型对象
  const newModel = {
    name: `新模型 ${config.aiModels.length + 1}`,
    apiKey: '',
    apiUrl: 'https://api.moonshot.cn/v1/chat/completions',
    model: 'moonshot-v1-8k',
    active: false
  };
  
  // 添加到模型列表
  config.aiModels.push(newModel);
  
  // 更新UI
  updateAiModelSelector();
  
  // 选择新添加的模型
  const modelSelector = document.getElementById('aiModelSelector');
  modelSelector.value = config.aiModels.length - 1;
  handleModelChange({ target: modelSelector });
  
  showNotification('已添加新模型，请配置并保存', 'info');
}

// 删除当前模型
function deleteCurrentModel() {
  if (!config || !Array.isArray(config.aiModels)) {
    return;
  }
  const selectedIndex = config.activeModelIndex;
  
  // 确保至少保留一个模型
  if (config.aiModels.length <= 1) {
    showNotification('至少需要保留一个模型', 'warning');
    return;
  }
  
  // 删除选中的模型
  config.aiModels.splice(selectedIndex, 1);
  
  // 更新激活索引
  if (selectedIndex >= config.aiModels.length) {
    config.activeModelIndex = config.aiModels.length - 1;
  }
  
  // 确保有一个模型被标记为active
  let hasActive = false;
  config.aiModels.forEach(model => {
    if (model.active) hasActive = true;
  });
  
  if (!hasActive && config.aiModels.length > 0) {
    config.aiModels[config.activeModelIndex].active = true;
  }
  
  // 更新UI
  updateAiModelSelector();
  showNotification('已删除模型', 'info');
}

// 加载配置
function loadConfig() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['appConfig', 'config'], function(result) {
      const baseConfig = window.appConfig || window.defaultConfig || minimalDefaultConfig;

      if (result.appConfig) {
        // 兼容旧存储结构：与 window.appConfig 合并（若不存在则与内置默认合并）
        config = mergeConfig(baseConfig, result.appConfig);
        console.log('已加载保存的配置(appConfig):', config);
      } else if (result.config) {
        // 新存储键：也合并默认值，避免缺字段
        config = mergeConfig(baseConfig, result.config);
        console.log('已加载保存的配置(config):', config);
      } else {
        // 使用内置默认
        config = JSON.parse(JSON.stringify(baseConfig));
        console.log('使用默认配置(内置):', config);
      }

      config = ensureConfigStructure(config);

      // 更新界面显示
      updateUIByConfig();
      
      if (MCP_FEATURE_ENABLED) {
        checkMcpStatus();
      }
      
      resolve(config);
    });
  });
}

// 合并配置，保留用户修改的设置
function mergeConfig(defaultConfig, savedConfig) {
  const merged = JSON.parse(JSON.stringify(defaultConfig));
  
  // 递归合并对象
  function deepMerge(target, source) {
    for (const key in source) {
      if (source.hasOwnProperty(key)) {
        if (source[key] !== null && typeof source[key] === 'object' && !Array.isArray(source[key])) {
          // 如果是对象，递归合并
          if (!target[key]) target[key] = {};
          deepMerge(target[key], source[key]);
        } else {
          // 基本类型或数组直接替换
          target[key] = source[key];
        }
      }
    }
    return target;
  }
  
  return deepMerge(merged, savedConfig);
}

// 确保配置具备关键字段，防止 UI 引用空对象
function ensureConfigStructure(rawConfig) {
  const fallback = window.appConfig || window.defaultConfig || minimalDefaultConfig;
  let safeConfig = rawConfig && typeof rawConfig === 'object'
    ? rawConfig
    : JSON.parse(JSON.stringify(fallback));

  if (!safeConfig.interface) {
    safeConfig.interface = JSON.parse(JSON.stringify(fallback.interface || minimalDefaultConfig.interface));
  }

  if (!safeConfig.recording) {
    safeConfig.recording = JSON.parse(JSON.stringify(fallback.recording || minimalDefaultConfig.recording));
  }

  const fallbackModels = (fallback.aiModels && Array.isArray(fallback.aiModels) ? fallback.aiModels : minimalDefaultConfig.aiModels) || [];
  if (!Array.isArray(safeConfig.aiModels) || safeConfig.aiModels.length === 0) {
    safeConfig.aiModels = JSON.parse(JSON.stringify(fallbackModels));
  } else {
    safeConfig.aiModels = safeConfig.aiModels.map((model, idx) => {
      const sourceModel = model && typeof model === 'object' ? model : {};
      const fallbackModel = fallbackModels.find(m => m.id === sourceModel.id) || fallbackModels[idx] || fallbackModels[0] || {};
      const mergedModel = Object.assign({}, fallbackModel || {}, sourceModel);
      if (!mergedModel.id) mergedModel.id = fallbackModel?.id || `model_${idx}`;
      if (typeof mergedModel.enabled !== 'boolean') mergedModel.enabled = true;
      return mergedModel;
    });
  }

  if (!safeConfig.analysis || typeof safeConfig.analysis !== 'object') {
    safeConfig.analysis = JSON.parse(JSON.stringify(fallback.analysis || minimalDefaultConfig.analysis));
  }

  if (!safeConfig.analysis.promptTemplates || typeof safeConfig.analysis.promptTemplates !== 'object') {
    safeConfig.analysis.promptTemplates = JSON.parse(JSON.stringify(
      (fallback.analysis && fallback.analysis.promptTemplates) || minimalDefaultConfig.analysis.promptTemplates
    ));
  }

  const hasValidDefault = safeConfig.aiModels.some(model => model.id === safeConfig.analysis.defaultModel);
  if (!safeConfig.analysis.defaultModel || !hasValidDefault) {
    safeConfig.analysis.defaultModel = safeConfig.aiModels[0]?.id || fallback.analysis?.defaultModel || 'default-model';
  }

  if (!safeConfig.fileStorage || typeof safeConfig.fileStorage !== 'object') {
    safeConfig.fileStorage = JSON.parse(JSON.stringify(fallback.fileStorage || minimalDefaultConfig.fileStorage));
  }
  if (!safeConfig.fileStorage.mcpApiUrl) {
    safeConfig.fileStorage.mcpApiUrl = fallback.fileStorage?.mcpApiUrl || minimalDefaultConfig.fileStorage.mcpApiUrl;
  }
  if (!safeConfig.fileStorage.mcpStatus) {
    safeConfig.fileStorage.mcpStatus = 'unknown';
  }
  if (typeof safeConfig.fileStorage.mcpEnabled !== 'boolean') {
    safeConfig.fileStorage.mcpEnabled = safeConfig.fileStorage.mcpEnabled !== false;
  }

  if (!MCP_FEATURE_ENABLED) {
    safeConfig.fileStorage.mcpEnabled = false;
    safeConfig.fileStorage.mcpStatus = 'disabled';
  }

  return safeConfig;
}

// 根据配置更新UI
function updateUIByConfig() {
  // 如果站点不支持，显示提示
  const supported = !!getCurrentSiteType();
  const unsupportedEl = document.getElementById('unsupportedSiteMessage');
  const controlsEl = document.getElementById('contentControls');
  if (unsupportedEl) unsupportedEl.style.display = supported ? 'none' : 'block';
  if (controlsEl) controlsEl.style.display = supported ? 'flex' : 'none';
}

// 检查MCP服务状态并更新UI
async function checkMcpStatus() {
  if (!MCP_FEATURE_ENABLED) {
    markMcpFeatureDisabled();
    return;
  }
  const mcpStatusEl = document.getElementById('mcpStatus');
  if (!mcpStatusEl) return;

  // 确保配置存在
  if (!config) {
    try { config = await new Promise((r) => chrome.storage.local.get(['config','appConfig'], x => r(x.config || x.appConfig || {}))); } catch (_) {}
  }
  if (!config.fileStorage) config.fileStorage = {};

  mcpStatusEl.textContent = '检查中...';
  mcpStatusEl.className = 'status-badge status-checking';

  const maxRetries = 2;
  let retryCount = 0;
  let success = false;
  const base = (config.fileStorage.mcpApiUrl) || 'http://localhost:8888';

  while (retryCount <= maxRetries && !success) {
    try {
      if (retryCount > 0) {
        mcpStatusEl.textContent = `重试 ${retryCount}/${maxRetries}...`;
        await new Promise(resolve => setTimeout(resolve, 1000));
      }

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5000);
      const response = await fetch(`${base.replace(/\/$/, '')}/status`, {
        method: 'GET', headers: { 'Content-Type': 'application/json' }, signal: controller.signal
      });
      clearTimeout(timer);

      if (response.ok) {
        const data = await response.json().catch(() => ({}));
        const isAvailable = data?.status === 'online';

        mcpStatusEl.textContent = isAvailable ? '在线' : '离线';
        mcpStatusEl.className = `status-badge ${isAvailable ? 'status-online' : 'status-offline'}`;

        const mcpPathEl = document.getElementById('mcpPath');
        if (mcpPathEl) {
          if (isAvailable) {
            config.fileStorage.mcpEnabled = true;
            config.fileStorage.mcpStatus = 'online';
            config.fileStorage.savedPath = data?.savedPath || config.fileStorage.savedPath || '';
            mcpPathEl.textContent = `保存路径: ${config.fileStorage.savedPath}`;
            mcpPathEl.title = config.fileStorage.savedPath;
            mcpPathEl.style.display = 'block';
          } else {
            config.fileStorage.mcpStatus = 'offline';
            mcpPathEl.textContent = '未连接到MCP服务';
            mcpPathEl.style.display = 'block';
          }
        }
        success = true;
      } else {
        throw new Error(`MCP服务响应错误: ${response.status}`);
      }
    } catch (error) {
      const errorMsg = error?.message || String(error);
      const isNetworkError = error?.name === 'AbortError' || /Failed to fetch|NetworkError/i.test(errorMsg);
      console.warn(`MCP服务检查错误 (尝试 ${retryCount + 1}/${maxRetries + 1}):`, errorMsg);
      if (isNetworkError) {
        retryCount = maxRetries + 1;
      } else {
        retryCount++;
      }
      if (retryCount > maxRetries) {
        mcpStatusEl.textContent = '离线';
        mcpStatusEl.className = 'status-badge status-offline';
        const mcpPathEl = document.getElementById('mcpPath');
        if (mcpPathEl) {
          config.fileStorage.mcpStatus = 'offline';
          mcpPathEl.textContent = `连接失败: ${errorMsg || '无法连接到MCP服务'}`;
          mcpPathEl.style.display = 'block';
        }
      }
    }
  }

  const saveButton = document.getElementById('saveButton');
  if (saveButton) {
    const isAvailable = config.fileStorage.mcpStatus === 'online';
    saveButton.disabled = !isAvailable;
    saveButton.title = isAvailable ? '保存分析结果到文件' : '无法保存：MCP服务未连接';
  }

  try { await chrome.storage.local.set({ bilibiliExtConfig: config }); } catch (_) {}
}

// ==================== 音频资源扫描与下载（侧边栏外部触发） ==================== //
async function refreshAudioList() {
  try {
    const listEl = document.getElementById('audioList');
    if (listEl) listEl.innerHTML = '<li>扫描中...</li>';

    activeTabId = await getActiveContentTabId(true);
    if (!activeTabId) {
      if (listEl) listEl.innerHTML = '<li>未找到支持的网站标签页</li>';
      return;
    }

    let items = await requestAudioListViaMessage(activeTabId);
    if (!items || items.length === 0) {
      // 回退：直接在页面上下文扫描（允许非匹配站点）
      items = await injectScript(() => {
        try {
          const results = [];
          const seen = new Set();
          const push = (url, title) => {
            try {
              if (!url) return;
              const abs = new URL(url, document.baseURI).href;
              if (seen.has(abs)) return;
              seen.add(abs);
              results.push({ url: abs, title: title || '' });
            } catch (_) {}
          };
          document.querySelectorAll('audio').forEach((a) => {
            const src = a.getAttribute('src');
            const title = a.getAttribute('title') || a.getAttribute('aria-label') || document.title;
            if (src) push(src, title);
            a.querySelectorAll('source').forEach((s) => {
              const ssrc = s.getAttribute('src');
              if (ssrc) push(ssrc, title);
            });
          });
          const audioExt = /(\.mp3|\.m4a|\.aac|\.wav|\.ogg)(\?|#|$)/i;
          document.querySelectorAll('a[href]').forEach((link) => {
            const href = link.getAttribute('href');
            if (href && audioExt.test(href)) {
              const txt = (link.textContent || '').trim() || link.getAttribute('download') || link.getAttribute('title') || '';
              push(href, txt);
            }
          });
          document.querySelectorAll('meta[property="og:audio"], meta[name="og:audio"]').forEach((m) => {
            const content = m.getAttribute('content');
            if (content) push(content, document.title);
          });
          return results;
        } catch (e) { return []; }
      }, false);
    }
    renderAudioList(items || []);
  } catch (e) {
    console.error('刷新音频列表失败:', e);
    showNotification('刷新音频列表失败: ' + (e?.message || e), 'error');
  }
}

function requestAudioListViaMessage(tabId) {
  return new Promise((resolve) => {
    try {
      chrome.tabs.sendMessage(tabId, { type: 'REQUEST_AUDIO_LIST' }, (res) => {
        if (chrome.runtime.lastError) {
          resolve(null);
        } else if (res && res.success) {
          resolve(res.items || []);
        } else {
          resolve(null);
        }
      });
    } catch (_) { resolve(null); }
  });
}

async function annotateAudioItems(items) {
  if (!Array.isArray(items) || items.length === 0) return [];
  const annotated = [];
  for (const item of items) {
    let validation = { ok: false, reason: '未验证' };
    try {
      validation = await validateAudioSource(item.url);
    } catch (error) {
      validation = { ok: false, reason: error?.message || '验证失败' };
    }
    annotated.push({ ...item, validation });
  }
  return annotated;
}

async function validateAudioSource(url) {
  if (!url) throw new Error('缺少音频链接');
  if (audioValidationCache.has(url)) {
    return audioValidationCache.get(url);
  }
  const response = await sendRuntimeMessage({ type: 'VALIDATE_AUDIO_URL', url });
  if (!response) throw new Error('验证失败');
  if (response.success === false) throw new Error(response.error || '验证失败');
  const detail = response.detail || {};
  const normalized = {
    ok: !!detail.ok,
    status: detail.status || 0,
    contentType: detail.contentType || '',
    contentLength: detail.contentLength || 0,
    viaRange: !!detail.viaRange,
    reason: detail.reason || ''
  };
  audioValidationCache.set(url, normalized);
  return normalized;
}

function buildAudioStatusMeta(validation) {
  if (!validation) {
    return {
      text: '待检测',
      className: 'pending',
      tooltip: '尚未验证该音频链接'
    };
  }
  if (validation.ok) {
    const parts = [];
    if (validation.status) parts.push(`HTTP ${validation.status}`);
    if (validation.contentType) parts.push(validation.contentType);
    if (validation.contentLength) parts.push(formatBytes(validation.contentLength));
    return {
      text: '可下载',
      className: 'ok',
      tooltip: parts.join(' · ') || '服务器已通过验证'
    };
  }
  const fallback = validation.status ? `HTTP ${validation.status}` : '服务器拒绝';
  return {
    text: '受限',
    className: 'blocked',
    tooltip: validation.reason || fallback
  };
}

function shortenUrl(url = '') {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./i, '');
    const path = parsed.pathname.length > 24 ? `…${parsed.pathname.slice(-24)}` : parsed.pathname;
    return `${host}${path}`;
  } catch (_) {
    return url;
  }
}

function formatBytes(byteSize = 0) {
  if (!byteSize || byteSize <= 0) return '';
  const mb = byteSize / (1024 * 1024);
  if (mb >= 1) return `${mb.toFixed(2)} MB`;
  const kb = byteSize / 1024;
  return `${kb.toFixed(1)} KB`;
}

// ==================== 音频资源表格与过滤（任务9） ==================== //
let currentAudioList = [];
const selectedAudios = new Set();
const downloadedAudios = new Set();

function isLikelyAudioUrl(url='') {
  return /(\.mp3|\.m4a|\.aac|\.wav|\.ogg|\.flac)(\?|#|$)/i.test(url);
}

function scanAudioFromDom() {
  const results = [];
  const seen = new Set();
  const push = (url, title, mime, via) => {
    if (!url) return;
    const abs = normalizeUrlForKey(url);
    if (seen.has(abs)) return;
    seen.add(abs);
    results.push({ url: abs, title: title || '', mime: mime || '', via: via || 'dom' });
  };
  // <audio> tags
  document.querySelectorAll('audio').forEach(a => {
    const src = a.currentSrc || a.src || a.getAttribute('src');
    const title = a.getAttribute('title') || a.getAttribute('aria-label') || document.title;
    if (src) push(src, title, a.getAttribute('type') || '', 'audio');
    a.querySelectorAll('source').forEach(s => {
      const ssrc = s.src || s.getAttribute('src');
      if (ssrc) push(ssrc, title, s.type || '', 'source');
    });
  });
  // <a> links
  document.querySelectorAll('a[href]').forEach(link => {
    const href = link.getAttribute('href');
    if (href && isLikelyAudioUrl(href)) {
      const txt = (link.textContent || '').trim() || link.getAttribute('download') || link.getAttribute('title') || '';
      push(href, txt, '', 'link');
    }
  });
  // meta og:audio
  document.querySelectorAll('meta[property="og:audio"], meta[name="og:audio"]').forEach(m => {
    const content = m.getAttribute('content');
    if (content) push(content, document.title, '', 'meta');
  });
  return results.filter(r => r.url && isLikelyAudioUrl(r.url));
}

async function refreshAudioTable() {
  const countEl = document.getElementById('audioCount');
  try {
    currentAudioList = scanAudioFromDom();
    if (countEl) countEl.textContent = String(currentAudioList.length);
    renderAudioTableBody();
    // 异步补充音频元数据后刷新
    enrichAudioMetadataBatch(currentAudioList).then(()=>{ renderAudioTableBody(); });
  } catch(e){
    console.warn('扫描音频失败:', e);
    currentAudioList = [];
    if (countEl) countEl.textContent = '0';
    renderAudioTableBody();
  }
}

function buildAudioKey(a){ return buildUnifiedMediaKey(a); }

function renderAudioTableBody() {
  const tbody = document.getElementById('audioTableBody');
  if (!tbody) return;
  tbody.innerHTML='';
  if (!currentAudioList.length) {
    const tr = document.createElement('tr');
    tr.className='media-empty-row';
    tr.innerHTML='<td colspan="6"><div class="media-empty-hint">暂无音频资源，点击“刷新列表”扫描。</div></td>';
    tbody.appendChild(tr); return;
  }
  currentAudioList.forEach((a, idx) => {
    const tr=document.createElement('tr');
    // checkbox
    const tdCheck=document.createElement('td'); tdCheck.className='col-checkbox';
    const cb=document.createElement('input'); cb.type='checkbox'; cb.checked=selectedAudios.has(idx); cb.addEventListener('change',()=>{ if(cb.checked) selectedAudios.add(idx); else selectedAudios.delete(idx); updateAudioBatchBar();});
    tdCheck.appendChild(cb);
    // title
    const tdTitle=document.createElement('td'); tdTitle.textContent=(a.title||shortenUrl(a.url)).slice(0,40);
    // type
    const tdType=document.createElement('td'); tdType.textContent=(a.mime||guessExtensionFromUrl(a.url)||'音频');
    // duration
    const meta = audioMetadataMap.get(a.url);
    const tdDuration=document.createElement('td'); tdDuration.textContent = meta && meta.duration? formatSeconds(meta.duration) : '…'; tdDuration.title = meta && meta.duration? ('秒: '+meta.duration) : '等待元数据';
    // size/status
    const tdSize=document.createElement('td');
    const key=buildAudioKey(a); const done=processedMediaKeys.has(key) || downloadedAudios.has(idx);
    const sizeLabel = meta && meta.contentLength ? formatBytes(meta.contentLength) : (done ? '已处理' : '待处理');
    tdSize.textContent = sizeLabel;
    // actions
    const tdActions=document.createElement('td'); tdActions.className='col-actions';
    const copyBtn=document.createElement('button'); copyBtn.className='btn btn-xs'; copyBtn.textContent='复制'; copyBtn.addEventListener('click',()=>copyAudioLink(a.url)); tdActions.appendChild(copyBtn);
    const dlBtn=document.createElement('button'); dlBtn.className='btn btn-xs'; dlBtn.textContent = done ? '已下载' : '下载'; dlBtn.disabled=done; dlBtn.addEventListener('click',()=>{ if(dlBtn.disabled) return; triggerAudioDownload(a.url,a.title); processedMediaKeys.add(key); downloadedAudios.add(idx); renderAudioTableBody();}); tdActions.appendChild(dlBtn);
    tr.appendChild(tdCheck); tr.appendChild(tdTitle); tr.appendChild(tdType); tr.appendChild(tdDuration); tr.appendChild(tdSize); tr.appendChild(tdActions); tbody.appendChild(tr);
  });
  updateAudioBatchBar();
}

function updateAudioBatchBar(){
  const bar=document.getElementById('audioBatchActions');
  const countEl=document.getElementById('audioSelectedCount');
  if(!bar||!countEl) return; const c=selectedAudios.size; countEl.textContent=String(c); bar.style.display=c>0?'':'none';
  const master=document.getElementById('audioMasterCheckbox'); if(master) master.checked = c>0 && c===currentAudioList.length;
}

function triggerAudioDownload(url,title){
  try { chrome.runtime.sendMessage({ type:'DIRECT_DOWNLOAD_GENERIC', url, fileName:(title||'audio')+'.mp3' }); } catch(e){ console.warn('触发音频下载失败', e); }
  showNotification('开始下载音频', 'success');
}

// 音频元数据采集
const audioMetadataMap = audioMetadataMap || new Map();
function enrichAudioMetadataBatch(list){
  const limit = 5; let idx = 0;
  function next(){ if(idx>=list.length) return Promise.resolve(); const slice = list.slice(idx, idx+limit); idx+=limit; return Promise.all(slice.map(enrichSingleAudio)).then(next); }
  return next();
}
function enrichSingleAudio(item){
  if(!item || !item.url || audioMetadataMap.get(item.url)) return Promise.resolve();
  return Promise.race([
    new Promise(async resolve => {
      try {
        const controller = new AbortController(); const timer = setTimeout(()=>controller.abort(),5000);
        const res = await fetch(item.url, { method:'HEAD', signal: controller.signal }); clearTimeout(timer);
        let contentLength=0, contentType=''; if(res && res.ok){ contentLength = parseInt(res.headers.get('content-length')||'0',10)||0; contentType = res.headers.get('content-type')||''; }
        let duration=0; try { const audio = new Audio(); audio.preload='metadata'; audio.src=item.url; audio.addEventListener('loadedmetadata',()=>{ duration=audio.duration||0; audioMetadataMap.set(item.url,{duration,contentLength,contentType}); resolve(); }); audio.addEventListener('error',()=>{ audioMetadataMap.set(item.url,{duration:0,contentLength,contentType}); resolve(); }); setTimeout(()=>{ audioMetadataMap.set(item.url,{duration:duration||0,contentLength,contentType}); resolve(); },4000); } catch(_) { audioMetadataMap.set(item.url,{duration:0,contentLength,contentType}); resolve(); }
      } catch(_) { audioMetadataMap.set(item.url,{duration:0,contentLength:0,contentType:''}); resolve(); }
    }),
    new Promise(r=> setTimeout(r,6000))
  ]);
}

// 事件绑定（DOMContentLoaded 已有监听，下方追加）
document.addEventListener('DOMContentLoaded',()=>{
  const refreshBtn=document.getElementById('refreshAudioButton'); if(refreshBtn) refreshBtn.addEventListener('click', refreshAudioTable);
  const master=document.getElementById('audioMasterCheckbox'); if(master) master.addEventListener('change',()=>{ selectedAudios.clear(); if(master.checked) currentAudioList.forEach((_,i)=>selectedAudios.add(i)); renderAudioTableBody();});
  const selAll=document.getElementById('audioSelectAllBtn'); if(selAll) selAll.addEventListener('click',()=>{ currentAudioList.forEach((_,i)=>selectedAudios.add(i)); renderAudioTableBody();});
  const invert=document.getElementById('audioInvertSelectionBtn'); if(invert) invert.addEventListener('click',()=>{ const ns=new Set(); currentAudioList.forEach((_,i)=>{ if(!selectedAudios.has(i)) ns.add(i); }); selectedAudios.clear(); ns.forEach(i=>selectedAudios.add(i)); renderAudioTableBody();});
  const clearBtn=document.getElementById('audioClearSelectionsBtn'); if(clearBtn) clearBtn.addEventListener('click',()=>{ selectedAudios.clear(); renderAudioTableBody();});
  const batchDl=document.getElementById('audioBatchDownloadBtn'); if(batchDl) batchDl.addEventListener('click',()=>{ Array.from(selectedAudios).forEach(i=>{ const a=currentAudioList[i]; if(!a) return; const k=buildAudioKey(a); if(processedMediaKeys.has(k)) return; processedMediaKeys.add(k); downloadedAudios.add(i); triggerAudioDownload(a.url,a.title); }); renderAudioTableBody(); });
  const batchRemove=document.getElementById('audioBatchRemoveBtn'); if(batchRemove) batchRemove.addEventListener('click',()=>{ selectedAudios.clear(); renderAudioTableBody();});
});

function copyAudioLink(url) {
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url)
        .then(() => showNotification('已复制音频链接', 'success'))
        .catch(() => fallbackCopy(url));
    } else { fallbackCopy(url); }
  } catch (_) { fallbackCopy(url); }
}

function fallbackCopy(text) {
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.focus(); ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    showNotification(ok ? '已复制音频链接' : '复制失败', ok ? 'success' : 'error');
  } catch (e) {
    showNotification('复制失败: ' + (e?.message || e), 'error');
  }
}

//==================== 通用UI功能 ====================//

// 通知功能
function showNotification(message, type = 'info') {
  let container = document.getElementById('toastContainer');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toastContainer';
    container.className = 'toast-container';
    document.body.appendChild(container);
  }

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  container.appendChild(toast);

  // 触发过渡效果
  requestAnimationFrame(() => {
    toast.classList.add('visible');
  });

  const hideToast = () => {
    toast.classList.remove('visible');
    setTimeout(() => toast.remove(), 200);
  };

  const timer = setTimeout(hideToast, 3500);
  toast.addEventListener('click', () => {
    clearTimeout(timer);
    hideToast();
  });
}

// 显示加载中动画
function showLoading(message = '处理中...') {
  const resultPlaceholder = document.querySelector('.result-placeholder');
  const loadingEl = document.createElement('div');
  loadingEl.className = 'loading';
  
  resultPlaceholder.innerHTML = '';
  resultPlaceholder.appendChild(loadingEl);
  resultPlaceholder.appendChild(document.createTextNode(message));
  resultPlaceholder.style.display = 'block';
  
  const resultContent = document.querySelector('.result-content');
  resultContent.style.display = 'none';
}

// 隐藏加载中动画
function hideLoading() {
  const resultPlaceholder = document.querySelector('.result-placeholder');
  resultPlaceholder.innerHTML = '点击"分析内容"开始AI分析...';
}

// 开始监听标签页变化
function startTabChangeMonitoring() {
  // 监听标签页更新
  chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (tabId === activeTabId && changeInfo.url) {
      console.log('当前标签页URL已更改:', changeInfo.url);
      // 强制更新UI
      setTimeout(() => {
        activeTabId = null;  // 清除缓存的标签页ID
        analysisResult = null; // 清除之前的分析结果
        updateUI();
      }, 500); // 延迟半秒更新UI
    }
  });
  
  // 监听标签页切换
  chrome.tabs.onActivated.addListener((activeInfo) => {
    console.log('标签页激活变化:', activeInfo.tabId);
    // 只有当前没有缓存ID或当前缓存ID与活动ID不同时才更新
    if (!activeTabId || activeTabId !== activeInfo.tabId) {
      setTimeout(() => {
        activeTabId = null;
        updateUI();
      }, 500);
    }
  });
  
  // 周期性检查当前页面
  setInterval(async () => {
    if (activeTabId) {
      try {
        const tab = await chrome.tabs.get(activeTabId);
        if (tab && tab.url && tab.url.includes('bilibili.com')) {
          // 如果页面内容有变化（例如切换了视频）
          updatePageInfo(tab);
        } else {
          // 不是B站页面，重新获取
          activeTabId = null;
          updateUI();
        }
      } catch (error) {
        // 标签页可能已关闭
        activeTabId = null;
        updateUI();
      }
    } else {
      updateUI();
    }
  }, 5000); // 每5秒检查一次
}

// 更新页面信息
async function updatePageInfo(tab) {
  if (!tab || !tab.url || !tab.url.includes('bilibili.com')) return;
  
  const title = tab.title.replace(/ - 哔哩哔哩$/, '')
                         .replace(/_哔哩哔哩_bilibili$/, '')
                         .replace(/_bilibili$/, '')
                         .replace(/_哔哩哔哩弹幕视频网$/, '')
                         .trim();
  
  const infoPanelText = document.querySelector('.info-panel p')?.textContent || '';
  const currentTitle = infoPanelText.replace('当前页面: ', '').replace(/\.\.\.$/g, '');
  
  // 如果标题明显变化，说明视频切换了
  if (title && currentTitle && !title.includes(currentTitle) && !currentTitle.includes(title)) {
    console.log('检测到页面内容变化，正在更新UI...');
    activeTabId = tab.id;
    analysisResult = null; // 清除之前的分析结果
    updateUI();
  }
}

// 更新UI状态
async function updateUI() {
  try {
    // 强制获取最新的标签页ID
    const tabId = await getActiveContentTabId(true);
    const isBilibiliTab = tabId !== null;
    
    // 更新按钮状态
    const buttons = document.querySelectorAll('.action-button:not(#saveSettingsButton)');
    
    buttons.forEach(button => {
      if (button.id === 'stopButton' && !isRecording) {
        button.disabled = true;
      } else if (button.id === 'saveButton') {
        button.disabled = !analysisResult;
      } else {
        button.disabled = !isBilibiliTab;
      }
    });
    
    // 更新页面信息
    if (!isBilibiliTab) {
      showNotification('请访问哔哩哔哩网站以使用此扩展', 'warning');
      
      // 清空页面信息显示
      if (document.querySelector('.info-panel p')) {
        document.querySelector('.info-panel p').textContent = '未打开B站页面';
      }
    } else {
      try {
        const tab = await chrome.tabs.get(tabId);
        if (tab) {
          // 处理标题，移除B站后缀
          const title = tab.title
                         .replace(/ - 哔哩哔哩$/, '')
                         .replace(/_哔哩哔哩_bilibili$/, '')
                         .replace(/_bilibili$/, '')
                         .replace(/_哔哩哔哩弹幕视频网$/, '')
                         .trim();
                         
          // 获取BV号
          const bvid = tab.url.match(/\/video\/([^/?]+)/)?.[1] || '';
          const displayTitle = title.length > 30 ? title.substring(0, 30) + '...' : title;
          
          if (document.querySelector('.info-panel p')) {
            document.querySelector('.info-panel p').textContent = 
              `当前页面: ${displayTitle}${bvid ? ` (${bvid})` : ''}`;
          }
        }
      } catch (error) {
        console.error('获取标签页信息失败:', error);
      }
    }
    
    // 更新分析结果区域
    const resultContent = document.querySelector('.result-content');
    const resultPlaceholder = document.querySelector('.result-placeholder');
    
    if (!analysisResult) {
      // 没有分析结果时显示提示信息
      if (resultContent) resultContent.style.display = 'none';
      if (resultPlaceholder) {
        resultPlaceholder.style.display = 'block';
        resultPlaceholder.innerHTML = '点击"分析内容"开始AI分析...';
      }
    } else {
      // 有分析结果时显示内容
      if (resultContent) {
        resultContent.style.display = 'block';
        resultContent.textContent = analysisResult.content;
      }
      if (resultPlaceholder) {
        resultPlaceholder.style.display = 'none';
      }
    }
  } catch (error) {
    console.error('更新UI状态失败:', error);
  }
}

// 获取当前站点类型
function getCurrentSiteType() {
  if (!config || !config.sites) return null;
  
  return new Promise((resolve) => {
    // 获取当前活动标签页的URL
    chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
      if (tabs.length === 0) {
        resolve(null);
        return;
      }
      
      const currentUrl = tabs[0].url;
      
      // 遍历配置中的站点
      for (const siteId in config.sites) {
        const site = config.sites[siteId];
        
        // 如果站点未启用，跳过
        if (!site.enabled) continue;
        
        // 检查URL是否匹配站点模式
        if (site.urlPatterns && site.urlPatterns.length > 0) {
          for (const pattern of site.urlPatterns) {
            const regex = new RegExp(pattern);
            if (regex.test(currentUrl)) {
              resolve({
                id: siteId,
                name: site.name,
                icon: site.icon,
                domain: site.domain
              });
              return;
            }
          }
        }
      }
      
      // 未匹配到支持的站点
      resolve(null);
    });
  });
}

// 根据站点类型更新UI
function updateUIBySiteType() {
  // 获取当前站点类型
  getCurrentSiteType().then(siteType => {
    console.log('当前站点类型:', siteType);
    
    const unsupportedSiteMessage = document.getElementById('unsupported-site-message');
    const controlsContainer = document.getElementById('controls-container');
    
    if (!siteType) {
      // 如果不是支持的站点，显示提示信息，隐藏控制面板
      unsupportedSiteMessage.style.display = 'block';
      controlsContainer.style.display = 'none';
      
      // 更新站点图标和名称
      document.getElementById('site-icon').src = 'icons/default.png';
      document.getElementById('site-name').textContent = '不支持的站点';
      return;
    }
    
    // 支持的站点，隐藏提示信息，显示控制面板
    unsupportedSiteMessage.style.display = 'none';
    controlsContainer.style.display = 'block';
    
    // 更新站点图标和名称
    document.getElementById('site-icon').src = siteType.icon || 'icons/default.png';
    document.getElementById('site-name').textContent = siteType.name;
    
    // 保存当前站点类型
    currentSiteType = siteType;
    
    // 更新特定站点的UI元素
    updateSiteSpecificUI(siteType.id);
  });
}

// 更新特定站点的UI元素
function updateSiteSpecificUI(siteId) {
  // 确保siteId有效
  if (!siteId || !config.sites[siteId]) return;
  
  // 获取特定站点的配置
  const siteConfig = config.sites[siteId];
  
  // 示例：根据站点类型显示或隐藏某些功能按钮
  const analyzeButton = document.getElementById('analyzeButton') || document.getElementById('analyze-button');
  const analysisCard = document.getElementById('aiAnalysisCard');
  const analysisDisabledCard = document.getElementById('aiDisabledCard');
  const enableAnalysis = Array.isArray(siteConfig.features) && siteConfig.features.includes('ai_analysis');

  if (analyzeButton) {
    analyzeButton.style.display = enableAnalysis ? 'inline-block' : 'none';
  }
  if (analysisCard) {
    analysisCard.style.display = enableAnalysis ? '' : 'none';
  }
  if (analysisDisabledCard) {
    analysisDisabledCard.style.display = enableAnalysis ? 'none' : '';
  }
  
  // 可以根据需要添加更多特定站点的UI更新
}

// 加载配置文件列表
async function loadConfigProfiles() {
  return new Promise((resolve) => {
    chrome.storage.local.get('configProfiles', (result) => {
      // 如果没有存储的配置文件，创建一个默认的
      if (!result.configProfiles || !Array.isArray(result.configProfiles) || result.configProfiles.length === 0) {
        const defaultProfiles = [{
          id: 'default',
          name: '默认配置',
          isActive: true,
          config: config || window.defaultConfig || {}
        }];
        chrome.storage.local.set({ configProfiles: defaultProfiles });
        resolve(defaultProfiles);
      } else {
        resolve(result.configProfiles);
      }
    });
  });
}

// 保存配置文件列表
async function saveConfigProfiles(profiles) {
  return new Promise((resolve) => {
    chrome.storage.local.set({ configProfiles: profiles }, () => {
      resolve();
    });
  });
}

// 获取活动配置文件
async function getActiveConfigProfile() {
  const profiles = await loadConfigProfiles();
  const activeProfile = profiles.find(profile => profile.isActive);
  return activeProfile || profiles[0] || null;
}

// 切换配置文件
async function switchConfigProfile(profileId) {
  const profiles = await loadConfigProfiles();
  // 设置所有配置文件为非活动
  profiles.forEach(profile => {
    profile.isActive = (profile.id === profileId);
  });
  
  // 保存更新后的配置文件列表
  await saveConfigProfiles(profiles);
  
  // 加载选中的配置文件
  const activeProfile = profiles.find(profile => profile.id === profileId);
  if (activeProfile) {
    config = activeProfile.config;
    // 保存当前配置到本地存储
    await saveConfig(config);
    // 更新UI
    updateSettingsUI();
  }
  
  return activeProfile;
}

// 添加新配置文件
async function addNewProfile() {
  const profileName = prompt('请输入新配置文件名称:');
  if (!profileName) return;
  
  const profiles = await loadConfigProfiles();
  
  // 创建随机ID
  const profileId = 'profile_' + Date.now();
  
  // 复制当前配置
  const newProfile = {
    id: profileId,
    name: profileName,
    isActive: false,
    config: JSON.parse(JSON.stringify(config))
  };
  
  // 添加到配置文件列表
  profiles.push(newProfile);
  
  // 保存配置文件列表
  await saveConfigProfiles(profiles);
  
  // 更新UI
  await updateConfigProfileSelector();
  
  showNotification(`已添加新配置文件: ${profileName}`, 'success');
}

// 删除当前配置文件
async function deleteCurrentProfile() {
  const profiles = await loadConfigProfiles();
  
  // 不允许删除最后一个配置文件
  if (profiles.length <= 1) {
    showNotification('无法删除唯一的配置文件', 'error');
    return;
  }
  
  // 获取当前选中的配置文件
  const configProfileSelector = document.getElementById('configProfileSelector');
  const currentProfileId = configProfileSelector.value;
  
  // 获取配置文件名称
  const currentProfile = profiles.find(p => p.id === currentProfileId);
  if (!currentProfile) return;
  
  // 确认删除
  const confirmed = confirm(`确定要删除配置文件 "${currentProfile.name}" 吗?`);
  if (!confirmed) return;
  
  // 从列表中移除
  const newProfiles = profiles.filter(p => p.id !== currentProfileId);
  
  // 如果删除的是当前活动的配置文件，则激活第一个配置文件
  if (currentProfile.isActive && newProfiles.length > 0) {
    newProfiles[0].isActive = true;
  }
  
  // 保存配置文件列表
  await saveConfigProfiles(newProfiles);
  
  // 加载新的活动配置文件
  const activeProfile = newProfiles.find(p => p.isActive) || newProfiles[0];
  if (activeProfile) {
    config = activeProfile.config;
    await saveConfig(config);
  }
  
  // 更新UI
  await updateConfigProfileSelector();
  updateSettingsUI();
  
  showNotification(`已删除配置文件: ${currentProfile.name}`, 'info');
}

// 修改页面信息更新处理函数
function handlePageInfoUpdate(data) {
  const { url, siteInfo, pageInfo } = data;
  
  // 更新网站信息显示
  const infoPanel = document.querySelector('.info-panel');
  if (infoPanel) {
    if (siteInfo) {
      infoPanel.innerHTML = `
        <p>当前页面: ${siteInfo.name || '未知网站'}</p>
        <p>标题: ${pageInfo?.title || '无标题'}</p>
        <p>作者: ${pageInfo?.uploader || '未知'}</p>
        <p class="version">v1.0</p>
      `;
      // 启用分析按钮
      document.querySelector('#analyzeButton')?.removeAttribute('disabled');
    } else {
      infoPanel.innerHTML = `
        <p>当前页面: 不支持的网站</p>
        <p class="version">v1.0</p>
      `;
      // 禁用分析按钮
      document.querySelector('#analyzeButton')?.setAttribute('disabled', 'true');
    }
  }
}

function handleVideoRecordingStatus(message) {
  const index = typeof message.index === 'number' ? message.index : null;
  if (index === null) return;

  const mode = message.mode === 'audio' ? 'audio' : 'video';
  const stateMap = mode === 'audio' ? audioRecordingState : videoRecordingState;
  const label = mode === 'audio' ? '音频' : '视频';

  if (message.status === 'started') {
    stateMap[index] = {
      recording: true,
      startedAt: message.startedAt || Date.now(),
      stopping: false
    };
    renderVideoTableBody();
    return;
  }

  if (message.status === 'completed') {
    delete stateMap[index];
    renderVideoTableBody();
    const fileInfo = message.fileName ? `，已保存 ${message.fileName}` : '';
    showNotification(`${label} #${index} 录制完成${fileInfo}`, 'success');
    return;
  }

  if (message.status === 'error') {
    delete stateMap[index];
    renderVideoTableBody();
    const err = message.error ? `: ${message.error}` : '';
    showNotification(`${label} #${index} 录制失败${err}`, 'error');
    return;
  }
}

// 监听来自background的消息
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'PAGE_INFO_UPDATED') {
    handlePageInfoUpdate(message.data);
  } else if (message.type === 'VIDEO_RECORDING_STATUS') {
    handleVideoRecordingStatus(message);
  }
});