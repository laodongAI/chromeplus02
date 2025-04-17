// 检查utils是否已加载
if (!window.utils) {
  console.error('Utils库未加载，尝试手动加载');
  
  // 创建utils.js的脚本标签
  const script = document.createElement('script');
  script.src = 'utils.js';
  script.onerror = () => {
    console.error('加载utils.js失败');
    
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

// 配置相关变量
let config = null;
let configProfiles = [];
let currentProfileIndex = 0;

// 初始化并获取活动标签页
document.addEventListener('DOMContentLoaded', async () => {
  // 加载配置
  if (window.defaultConfig) {
    // 使用config.js中的默认配置作为基础
    config = JSON.parse(JSON.stringify(window.defaultConfig));
    
    // 初始化配置文件
    configProfiles.push({
      name: '默认配置',
      isDefault: true,
      config: JSON.parse(JSON.stringify(config))
    });
    
    // 从本地存储加载已保存的配置文件
    await loadConfigProfiles();
  } else {
    console.error('配置未加载，使用默认配置');
    config = {
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
        autoSave: false
      }
    };
    
    // 初始化仅有的默认配置文件
    configProfiles.push({
      name: '默认配置',
      isDefault: true,
      config: JSON.parse(JSON.stringify(config))
    });
  }
  
  await getActiveContentTabId(true); // 强制刷新活动标签页ID
  await loadConfig();
  updateUI();
  setupEventListeners();
  checkMcpStatus();
  updateAiModelSelector();
  updateProfileSelector();
  
  // 开始监听标签页变化
  startTabChangeMonitoring();
});

// 设置所有事件监听器
function setupEventListeners() {
  // 播放/暂停按钮
  document.getElementById('playButton').addEventListener('click', playVideo);
  document.getElementById('pauseButton').addEventListener('click', pauseVideo);
  
  // 录制按钮
  document.getElementById('recordButton').addEventListener('click', startRecording);
  document.getElementById('stopButton').addEventListener('click', stopRecording);
  
  // AI分析按钮
  document.getElementById('analyzeButton').addEventListener('click', analyzeContent);
  document.getElementById('saveButton').addEventListener('click', saveAnalysisResult);
  
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

//==================== 视频控制功能 ====================//

// 播放视频
async function playVideo() {
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
    const promptTemplate = getPromptTemplate(siteId, config) || config.analysis.promptTemplates.default;
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
  
  // 清空现有选项
  modelSelector.innerHTML = '';
  
  // 添加所有模型选项
  if (config.aiModels && config.aiModels.length > 0) {
    config.aiModels.forEach((model, index) => {
      const option = document.createElement('option');
      option.value = index;
      option.textContent = model.name;
      option.selected = model.id === config.analysis.defaultModel;
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
  if (!config.aiModels || config.aiModels.length === 0) return;
  
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
    chrome.storage.local.get(['appConfig'], function(result) {
      if (result.appConfig) {
        // 合并已保存的配置与默认配置
        config = mergeConfig(window.appConfig, result.appConfig);
        console.log('已加载保存的配置:', config);
      } else {
        // 使用默认配置
        config = window.appConfig;
        console.log('使用默认配置:', config);
      }
      
      // 更新界面显示
      updateUIByConfig();
      
      // 检查MCP状态
      checkMcpStatus();
      
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

// 根据配置更新UI
function updateUIByConfig() {
  // 如果站点不支持，显示提示
  if (!getCurrentSiteType()) {
    document.getElementById('unsupportedSiteMessage').style.display = 'block';
    document.getElementById('contentControls').style.display = 'none';
  } else {
    document.getElementById('unsupportedSiteMessage').style.display = 'none';
    document.getElementById('contentControls').style.display = 'flex';
  }
}

// 检查MCP服务状态并更新UI
async function checkMcpStatus() {
  const mcpStatusEl = document.getElementById('mcpStatus');
  if (!mcpStatusEl) return;
  
  mcpStatusEl.textContent = '检查中...';
  mcpStatusEl.className = 'status-badge status-checking';
  
  // 最大重试次数
  const maxRetries = 2;
  let retryCount = 0;
  let success = false;
  
  while (retryCount <= maxRetries && !success) {
    try {
      // 如果不是第一次尝试，延迟一段时间再重试
      if (retryCount > 0) {
        mcpStatusEl.textContent = `重试 ${retryCount}/${maxRetries}...`;
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
      
      // 使用utils中的方法检查MCP状态
      if (window.utils) {
        console.log(`正在检查MCP服务状态 (尝试 ${retryCount + 1}/${maxRetries + 1})...`);
        const mcpStatus = await window.utils.checkMcpStatus();
        const isAvailable = mcpStatus.status === 'online';
        
        mcpStatusEl.textContent = isAvailable ? '在线' : '离线';
        mcpStatusEl.className = `status-badge ${isAvailable ? 'status-online' : 'status-offline'}`;
        
        // 显示连接信息或错误信息
        const mcpPathEl = document.getElementById('mcpPath');
        if (mcpPathEl) {
          if (isAvailable) {
            config.fileStorage.mcpEnabled = true;
            config.fileStorage.mcpStatus = 'online';
            config.fileStorage.savedPath = mcpStatus.path || config.fileStorage.savedPath;
            
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
        // 如果没有window.utils，直接尝试请求MCP API
        console.log(`直接检查MCP服务 (尝试 ${retryCount + 1}/${maxRetries + 1})...`);
        const response = await fetch('http://localhost:51512/filesystem/list_allowed_directories', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ random_string: "check" })
        });
        
        if (response.ok) {
          const data = await response.json();
          const isAvailable = Array.isArray(data.directoryList) && data.directoryList.length > 0;
          
          mcpStatusEl.textContent = isAvailable ? '在线' : '离线';
          mcpStatusEl.className = `status-badge ${isAvailable ? 'status-online' : 'status-offline'}`;
          
          // 显示连接信息或错误信息
          const mcpPathEl = document.getElementById('mcpPath');
          if (mcpPathEl) {
            if (isAvailable) {
              config.fileStorage.mcpEnabled = true;
              config.fileStorage.mcpStatus = 'online';
              config.fileStorage.savedPath = data.directoryList[0] || '';
              
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
      }
    } catch (error) {
      console.error(`MCP服务检查错误 (尝试 ${retryCount + 1}/${maxRetries + 1}):`, error);
      retryCount++;
      
      if (retryCount > maxRetries) {
        // 最后一次尝试失败，标记为离线
        mcpStatusEl.textContent = '离线';
        mcpStatusEl.className = 'status-badge status-offline';
        
        // 显示错误信息
        const mcpPathEl = document.getElementById('mcpPath');
        if (mcpPathEl) {
          config.fileStorage.mcpStatus = 'offline';
          mcpPathEl.textContent = `连接失败: ${error.message || '无法连接到MCP服务'}`;
          mcpPathEl.style.display = 'block';
        }
      }
    }
  }
  
  // 更新保存按钮状态
  const saveButton = document.getElementById('saveButton');
  if (saveButton) {
    const isAvailable = config.fileStorage.mcpStatus === 'online';
    saveButton.disabled = !isAvailable;
    saveButton.title = isAvailable ? 
      '保存分析结果到文件' : 
      '无法保存：MCP服务未连接';
  }
  
  // 保存配置
  try {
    await chrome.storage.local.set({ bilibiliExtConfig: config });
  } catch (configError) {
    console.error('保存MCP状态到配置失败:', configError);
  }
}

//==================== 通用UI功能 ====================//

// 通知功能
function showNotification(message, type = 'info') {
  // 创建通知容器如果它不存在
  let notification = document.getElementById('notification');
  if (!notification) {
    notification = document.createElement('div');
    notification.id = 'notification';
    document.body.appendChild(notification);
  }
  
  // 设置通知样式
  notification.className = `notification ${type}`;
  notification.textContent = message;
  notification.style.display = 'block';
  
  // 3秒后自动隐藏
  setTimeout(() => {
    notification.style.display = 'none';
  }, 3000);
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
  const analyzeButton = document.getElementById('analyze-button');
  
  // 检查站点是否支持AI分析功能
  if (siteConfig.features && siteConfig.features.includes('ai_analysis')) {
    analyzeButton.style.display = 'inline-block';
  } else {
    analyzeButton.style.display = 'none';
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

// 监听来自background的消息
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'PAGE_INFO_UPDATED') {
    handlePageInfoUpdate(message.data);
  }
});