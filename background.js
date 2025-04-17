/**
 * 后台脚本 - 处理扩展的后台逻辑，管理配置和与内容脚本通信
 */

// ==================== 全局变量 ====================
// 缓存当前活动标签页的 URL
const tabUrls = new Map();
let config = null;
let activeBilibiliTabId = null;
let mcpStatus = { online: false, savedPath: '' };

// ==================== 辅助函数 ====================
// 检查当前URL是否是哔哩哔哩网站
function isBilibiliUrl(url) {
  return url && url.includes('bilibili.com');
}

// 检查MCP服务可用性
async function checkMcpServiceAvailability() {
  try {
    const response = await self.fetch('http://localhost:51512/filesystem/list_allowed_directories', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ random_string: "check" })
    });
    
    return response.ok;
  } catch (error) {
    console.error('MCP服务检查失败:', error);
    return false;
  }
}

// 向页面发送MCP服务状态
async function sendMcpStatus() {
  const isAvailable = await checkMcpServiceAvailability();
  await chrome.storage.local.set({ mcpServiceAvailable: isAvailable });
  return isAvailable;
}

// ==================== 标签页监听与管理 ====================
// 监听标签页更新事件
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.url) {
    console.log(`标签页 ${tabId} URL 更新为:`, changeInfo.url);
    tabUrls.set(tabId, changeInfo.url);
    
    // 如果是B站，则更新活动B站标签页ID
    if (isBilibiliUrl(changeInfo.url)) {
      activeBilibiliTabId = tabId;
      chrome.storage.local.set({ lastBilibiliTabId: tabId });
    }
  } else if (tab.url) {
    console.log(`标签页 ${tabId} URL 当前为:`, tab.url);
    tabUrls.set(tabId, tab.url);
    
    // 如果是B站，则更新活动B站标签页ID
    if (isBilibiliUrl(tab.url)) {
      activeBilibiliTabId = tabId;
      chrome.storage.local.set({ lastBilibiliTabId: tabId });
    }
  }
});

// 向活动标签页注入utils.js
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  try {
    await chrome.scripting.executeScript({
      target: { tabId: activeInfo.tabId },
      files: ['utils.js']
    });
    console.log('成功注入Utils库到活动标签页');
  } catch (error) {
    console.error('注入Utils库失败:', error);
  }
});
// 监听标签页激活事件
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  try {
    const tab = await chrome.tabs.get(activeInfo.tabId);
    if (tab && isBilibiliUrl(tab.url)) {
      activeBilibiliTabId = activeInfo.tabId;
      chrome.storage.local.set({ lastBilibiliTabId: activeInfo.tabId });
    }
  } catch (error) {
    console.error('获取标签页信息失败:', error);
  }
});

// 监听标签页关闭事件
chrome.tabs.onRemoved.addListener((tabId) => {
  console.log(`标签页 ${tabId} 已关闭`);
  tabUrls.delete(tabId);
  
  // 如果关闭的是当前活动的B站标签页，则清除活动B站标签页ID
  if (activeBilibiliTabId === tabId) {
    activeBilibiliTabId = null;
  }
});

// ==================== URL 和标签页管理函数 ====================
// 获取当前活动标签页的 URL
async function getCurrentTabUrl(tabId) {
  try {
    const tab = await chrome.tabs.get(tabId);
    if (tab && tab.url) {
      // 缓存 URL
      tabUrls.set(tabId, tab.url);
      console.log("后台: 从标签页获取 URL:", tab.url);
      return tab.url;
    } else {
      console.log("后台: 标签页存在但未找到 URL");
    }
  } catch (tabError) {
    console.error("后台: 获取标签页错误:", tabError);
  }

  // 如果无法直接获取标签页，尝试查询当前活动标签页
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tabs && tabs.length > 0 && tabs[0].url) {
      const activeUrl = tabs[0].url;
      console.log("后台: 从活动标签页获取 URL:", activeUrl);
      return activeUrl;
    }
  } catch (queryError) {
    console.error("后台: 查询标签页错误:", queryError);
  }

  // 如果无法获取标签页的 URL，尝试从缓存中获取
  const cachedUrl = tabUrls.get(tabId);
  if (cachedUrl) {
    console.log("后台: 从缓存获取 URL:", cachedUrl);
    return cachedUrl;
  }

  // 最后尝试从存储中获取最后一个B站标签页
  try {
    const storage = await chrome.storage.local.get('lastBilibiliTabId');
    if (storage.lastBilibiliTabId) {
      const lastTab = await chrome.tabs.get(storage.lastBilibiliTabId);
      if (lastTab && lastTab.url) {
        console.log("后台: 从存储获取最后的B站标签页URL:", lastTab.url);
        return lastTab.url;
      }
    }
  } catch (storageError) {
    console.error("后台: 从存储获取URL错误:", storageError);
  }

  return null;
}

// 获取活动B站标签页ID
async function getActiveBilibiliTabId() {
  // 如果已有缓存的活动B站标签页，则直接返回
  if (activeBilibiliTabId !== null) {
    try {
      const tab = await chrome.tabs.get(activeBilibiliTabId);
      if (tab && isBilibiliUrl(tab.url)) {
        return activeBilibiliTabId;
      }
    } catch (error) {
      console.error("无法获取当前活动B站标签页:", error);
      activeBilibiliTabId = null;
    }
  }
  
  // 尝试查找当前活动的B站标签页
  try {
    const tabs = await chrome.tabs.query({});
    for (const tab of tabs) {
      if (isBilibiliUrl(tab.url)) {
        if (tab.active) {
          activeBilibiliTabId = tab.id;
          return tab.id;
        }
      }
    }
    
    // 如果没有活动的B站标签页，返回第一个B站标签页
    for (const tab of tabs) {
      if (isBilibiliUrl(tab.url)) {
        activeBilibiliTabId = tab.id;
        return tab.id;
      }
    }
  } catch (error) {
    console.error("查询B站标签页错误:", error);
  }
  
  // 从存储中获取最后使用的B站标签页
  try {
    const storage = await chrome.storage.local.get('lastBilibiliTabId');
    if (storage.lastBilibiliTabId) {
      try {
        const tab = await chrome.tabs.get(storage.lastBilibiliTabId);
        if (tab && isBilibiliUrl(tab.url)) {
          activeBilibiliTabId = tab.id;
          return tab.id;
        }
      } catch (tabError) {
        console.error("从存储获取B站标签页错误:", tabError);
      }
    }
  } catch (storageError) {
    console.error("读取存储错误:", storageError);
  }
  
  return null;
}

// ==================== 消息处理 ====================
// 处理来自content script或side panel的消息
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('收到消息:', message.type);
  
  switch (message.type) {
    case "GET_CURRENT_URL":
      handleGetCurrentUrl(sender, sendResponse);
      break;
      
    case "GET_ACTIVE_BILIBILI_TAB":
      handleGetActiveBilibiliTab(sendResponse);
      break;
      
    case "CHECK_MCP_SERVICE":
      handleCheckMcpService(sendResponse);
      break;
      
    case "PROXY_AI_REQUEST":
      handleProxyAiRequest(message.data, sendResponse);
      break;
      
    case "GET_CONFIG":
      sendResponse({ success: true, config });
      break;
      
    case "SAVE_CONFIG":
      if (message.config) {
        config = message.config;
        saveConfig();
        sendResponse({ success: true });
      } else {
        sendResponse({ success: false, error: '无效的配置数据' });
      }
      break;
      
    case "CONTENT_SITE_INFO":
      // 处理内容脚本发送的网站信息
      handleContentSiteInfo(message.data, sender);
      sendResponse({ success: true });
      break;
      
    default:
      sendResponse({ success: false, error: "未知的消息类型" });
  }
  
  // 返回true表示将异步响应消息
  return true;
});

// 处理AI API请求代理
async function handleProxyAiRequest(data, sendResponse) {
  try {
    console.log('正在代理AI请求到:', data.url);
    
    // 添加超时处理
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000); // 30秒超时
    
    try {
      const response = await fetch(data.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${data.apiKey}`
        },
        body: JSON.stringify({
          model: "moonshot-v1-8k", // 使用官方文档中提供的正确模型名称
          messages: [
            {
              role: "system", 
              content: "你是一个专业视频内容分析助手，负责分析B站视频页面内容。"
            },
            {
              role: "user",
              content: data.prompt
            }
          ],
          max_tokens: 1000,
          temperature: 0.7
        }),
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);
      
      if (!response.ok) {
        const errorText = await response.text().catch(() => '无错误详情');
        console.error('API响应错误:', response.status, errorText);
        throw new Error(`API请求失败: ${response.status} ${response.statusText} - ${errorText}`);
      }
      
      const responseData = await response.json();
      console.log('API请求成功，收到回复');
      
      sendResponse({
        success: true,
        result: responseData.choices[0].message.content
      });
    } catch (fetchError) {
      clearTimeout(timeoutId);
      
      // 检查是否是网络错误
      if (fetchError.name === 'TypeError' && fetchError.message === 'Failed to fetch') {
        console.error('网络错误: 可能是CORS或DNS问题', fetchError);
        throw new Error('网络连接错误: 无法连接到AI服务器');
      }
      
      // 检查是否超时
      if (fetchError.name === 'AbortError') {
        console.error('请求超时', fetchError);
        throw new Error('AI请求超时');
      }
      
      // 其他错误
      throw fetchError;
    }
  } catch (error) {
    console.error('代理AI请求失败:', error);
    sendResponse({
      success: false,
      error: error.message || '代理请求失败'
    });
  }
}

// 处理获取当前URL的请求
async function handleGetCurrentUrl(sender, sendResponse) {
  try {
    const url = await getCurrentTabUrl(sender.tab?.id);
    sendResponse({ success: true, url: url });
  } catch (error) {
    console.error("获取当前URL错误:", error.message);
    sendResponse({ success: false, error: error.message });
  }
}

// 处理获取活动B站标签页的请求
async function handleGetActiveBilibiliTab(sendResponse) {
  try {
    const tabId = await getActiveBilibiliTabId();
    sendResponse({ success: true, tabId: tabId });
  } catch (error) {
    console.error("获取活动B站标签页错误:", error.message);
    sendResponse({ success: false, error: error.message });
  }
}

// 处理检查MCP服务的请求
async function handleCheckMcpService(sendResponse) {
  try {
    const isAvailable = await sendMcpStatus();
    sendResponse({ success: true, available: isAvailable });
  } catch (error) {
    console.error("检查MCP服务错误:", error.message);
    sendResponse({ success: false, error: error.message });
  }
}

// 处理内容脚本发送的网站信息
function handleContentSiteInfo(data, sender) {
  if (!data) return;
  
  const tabId = sender.tab?.id;
  if (!tabId) return;
  
  console.log(`标签页 ${tabId} 网站信息:`, data.siteInfo ? data.siteInfo.id : '不支持的网站');
  
  // 存储标签页的网站信息
  tabUrls.set(tabId, {
    url: data.url,
    siteInfo: data.siteInfo,
    supported: data.supported
  });
  
  // 如果是B站，更新活动B站标签页ID
  if (data.siteInfo && data.siteInfo.id === 'bilibili') {
    activeBilibiliTabId = tabId;
    chrome.storage.local.set({ lastBilibiliTabId: tabId });
  }
  
  // 如果是抖音，也记录下来
  if (data.siteInfo && data.siteInfo.id === 'douyin') {
    chrome.storage.local.set({ lastDouyinTabId: tabId });
  }
}

// ==================== 初始化 ====================
// 初始化：从存储中加载最后使用的B站标签页
chrome.storage.local.get('lastBilibiliTabId', async (result) => {
  if (result.lastBilibiliTabId) {
    try {
      const tab = await chrome.tabs.get(result.lastBilibiliTabId);
      if (tab && isBilibiliUrl(tab.url)) {
        activeBilibiliTabId = tab.id;
        console.log("从存储中恢复了最后使用的B站标签页:", tab.id);
      }
    } catch (error) {
      console.error("恢复最后使用的B站标签页错误:", error);
    }
  }
  
  // 检查MCP服务状态并存储
  sendMcpStatus();
});

// 初始化扩展
async function initialize() {
  console.log('初始化扩展...');
  
  // 加载配置
  await loadConfig();
  
  // 检查MCP服务状态
  await checkMcpStatus();
  
  // 从本地存储中获取上次使用的B站标签ID
  chrome.storage.local.get('activeBilibiliTabId', (result) => {
    if (result && result.activeBilibiliTabId) {
      activeBilibiliTabId = result.activeBilibiliTabId;
      console.log('已加载上次使用的B站标签ID:', activeBilibiliTabId);
    }
  });
  
  // 创建扩展侧边面板
  chrome.sidePanel.setOptions({
    enabled: true,
    path: 'sidepanel.html',
    tabId: -1
  });
  
  // 每5分钟检查一次MCP服务状态
  setInterval(checkMcpStatus, 5 * 60 * 1000);
}

// 加载配置
async function loadConfig() {
  const result = await chrome.storage.local.get('config');
  if (result.config) {
    return result.config;
  } else {
    // 默认配置
    const defaultConfig = {
      fileStorage: {
        mcpEnabled: true,
        mcpApiUrl: 'http://localhost:3000/api',
        mcpServicePath: '',
        mcpStatus: false,
        savedPath: '',
        filenameTemplate: '{title}_{date}_{time}'
      },
      interface: {
        theme: 'auto',
        language: 'zh-CN',
      },
      recording: {
        format: 'webm',
        quality: 'high',
        autoSave: true,
      },
      // 其他默认配置
      aiModels: [
        {
          id: 'moonshot',
          name: 'MoonShot',
          enabled: true,
          apiUrl: 'https://api.moonshot.cn/v1/chat/completions',
          model: 'moonshot-v1-8k',
          temperature: 0.7,
          maxTokens: 2000,
          apiKey: ''
        },
        {
          id: 'openai',
          name: 'OpenAI',
          enabled: true,
          apiUrl: 'https://api.openai.com/v1/chat/completions',
          model: 'gpt-3.5-turbo',
          temperature: 0.7,
          maxTokens: 2000,
          apiKey: ''
        }
      ]
    };
    
    await chrome.storage.local.set({ config: defaultConfig });
    return defaultConfig;
  }
}

// 保存配置
function saveConfig() {
  chrome.storage.local.set({ config }, () => {
    if (chrome.runtime.lastError) {
      console.error('保存配置失败:', chrome.runtime.lastError);
    } else {
      console.log('配置已保存');
    }
  });
}

// 检查MCP服务状态
async function checkMcpStatus() {
  try {
    const response = await fetch('http://localhost:8888/status', {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json'
      }
    });
    
    if (response.ok) {
      const data = await response.json();
      mcpStatus = {
        online: true,
        savedPath: data.savedPath || ''
      };
      console.log('MCP服务在线，保存路径:', mcpStatus.savedPath);
    } else {
      mcpStatus = { online: false, savedPath: '' };
      console.log('MCP服务离线');
    }
  } catch (error) {
    mcpStatus = { online: false, savedPath: '' };
    console.log('MCP服务离线:', error.message);
  }
}

// 识别网站类型
function getSiteInfo(url) {
  if (!url) return null;
  
  // bilibili
  if (url.match(/bilibili\.com\/video/) || 
      url.match(/b23\.tv\//) || 
      url.match(/bilibili\.com\/bangumi/)) {
    return { 
      id: 'bilibili', 
      name: '哔哩哔哩', 
      icon: 'https://www.bilibili.com/favicon.ico',
      domain: 'bilibili.com'
    };
  }
  
  // youtube
  if (url.match(/youtube\.com\/watch/) || 
      url.match(/youtu\.be\//)) {
    return { 
      id: 'youtube', 
      name: 'YouTube', 
      icon: 'https://www.youtube.com/favicon.ico',
      domain: 'youtube.com'
    };
  }
  
  // 抖音
  if (url.match(/douyin\.com\/video/) || 
      url.match(/douyin\.com\/discover\?modal_id=/) ||
      url.match(/www\.douyin\.com\/@[\w-]+\/[\w-]+/)) {
    return { 
      id: 'douyin', 
      name: '抖音', 
      icon: 'https://www.douyin.com/favicon.ico',
      domain: 'douyin.com'
    };
  }
  
  // 知乎
  if (url.match(/zhihu\.com\/question/) || 
      url.match(/zhihu\.com\/answer/)) {
    return { 
      id: 'zhihu', 
      name: '知乎', 
      icon: 'https://www.zhihu.com/favicon.ico',
      domain: 'zhihu.com'
    };
  }
  
  return null;
}

// 检查MCP服务状态
async function checkMcpService() {
  try {
    const config = await loadConfig();
    const mcpApiUrl = config.fileStorage.mcpApiUrl || 'http://localhost:3000/api';
    
    console.log('Checking MCP service status...');
    const response = await self.fetch(`${mcpApiUrl}/status`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json'
      }
    });
    
    if (response.ok) {
      const data = await response.json();
      console.log('MCP service status:', data);
      
      if (data.status === 'online') {
        // 更新保存路径
        if (data.savedPath) {
          config.fileStorage.savedPath = data.savedPath;
        }
        
        // 更新MCP状态
        updateMcpStatus(true, config);
        return true;
      } else {
        updateMcpStatus(false, config);
        return false;
      }
    } else {
      console.warn('MCP service returned non-OK status:', response.status);
      updateMcpStatus(false, config);
      return false;
    }
  } catch (error) {
    console.error('Error checking MCP service:', error);
    const config = await loadConfig();
    updateMcpStatus(false, config);
    return false;
  }
}

// 更新MCP状态
async function updateMcpStatus(isOnline, config) {
  if (!config) {
    config = await loadConfig();
  }
  
  config.fileStorage.mcpStatus = isOnline;
  
  // 保存配置
  await chrome.storage.local.set({ config: config });
  
  // 向所有标签页广播状态更新
  chrome.tabs.query({}, function(tabs) {
    tabs.forEach(tab => {
      chrome.tabs.sendMessage(tab.id, { type: 'MCP_STATUS_UPDATED', status: isOnline })
        .catch(err => console.log(`无法发送消息到标签页 ${tab.id}:`, err));
    });
  });
  
  console.log('MCP status updated:', isOnline);
  return config;
}

// 尝试启动MCP服务
async function startMcpService() {
  try {
    const config = await loadConfig();
    
    if (!config.fileStorage.mcpEnabled) {
      console.log('MCP service is disabled in config, not starting');
      return false;
    }
    
    const mcpApiUrl = config.fileStorage.mcpApiUrl || 'http://localhost:3000/api';
    
    console.log('Attempting to start MCP service...');
    
    if (config.fileStorage.mcpServicePath) {
      // 发送启动请求到服务API
      const response = await self.fetch(`${mcpApiUrl}/start`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          servicePath: config.fileStorage.mcpServicePath
        })
      });
      
      if (response.ok) {
        const data = await response.json();
        console.log('MCP service start response:', data);
        
        // 启动成功后再次检查状态
        setTimeout(() => checkMcpService(), 2000);
        return true;
      } else {
        console.error('Failed to start MCP service:', response.statusText);
        return false;
      }
    } else {
      console.warn('MCP service path not configured, cannot start automatically');
      return false;
    }
  } catch (error) {
    console.error('Error starting MCP service:', error);
    return false;
  }
}

// 插件安装或更新时初始化
chrome.runtime.onInstalled.addListener(async (details) => {
  console.log('Extension installed or updated:', details.reason);
  
  // 加载配置
  const config = await loadConfig();
  
  // 检查MCP服务状态
  const isOnline = await checkMcpService();
  
  // 如果服务不在线且已启用MCP，尝试启动
  if (!isOnline && config.fileStorage.mcpEnabled) {
    console.log('MCP service is offline, attempting to start...');
    await startMcpService();
  }
});

// 启动初始化
initialize();
