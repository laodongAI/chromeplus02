/**
 * 工具函数库 - 为扩展提供通用功能
 */

// 配置相关工具函数
/**
 * 加载配置数据
 * @returns {Promise<Object>} 配置对象
 */
async function loadConfig() {
  return new Promise((resolve) => {
    chrome.storage.local.get('config', (result) => {
      resolve(result.config || (window.defaultConfig ? window.defaultConfig : {}));
    });
  });
}

/**
 * 保存配置数据
 * @param {Object} config 要保存的配置对象
 * @returns {Promise<void>}
 */
async function saveConfig(config) {
  return new Promise((resolve) => {
    chrome.storage.local.set({ config }, resolve);
  });
}

/**
 * 获取当前活跃的AI模型配置
 * @param {Object} config 配置对象 
 * @returns {Object} 模型配置
 */
function getActiveAiModel(config) {
  if (!config || !config.aiModels || config.aiModels.length === 0) {
    return null;
  }
  
  // 获取设置中默认的模型ID
  const defaultModelId = config.analysis?.defaultModel || 'openai';
  
  // 找到启用的默认模型
  const defaultModel = config.aiModels.find(model => 
    model.id === defaultModelId && model.enabled);
  
  if (defaultModel) {
    return defaultModel;
  }
  
  // 如果默认模型不可用，返回第一个启用的模型
  const firstEnabledModel = config.aiModels.find(model => model.enabled);
  
  return firstEnabledModel || null;
}

/**
 * 检查URL是否匹配支持的网站
 * @param {string} url 要检查的URL
 * @param {Object} config 配置对象
 * @returns {boolean} 是否匹配
 */
function isSupportedSite(url, config) {
  console.log('[utils.js] 检查URL是否支持:', url);
  
  if (!url) {
    console.log('[utils.js] URL为空');
    return false;
  }
  
  // 标准化URL为小写
  url = url.toLowerCase();
  
  // 先进行快速检查，不依赖配置
  const quickCheckDomains = [
    'bilibili.com', 'b23.tv', 'douyin.com', 'zhihu.com', 
    'youtube.com', 'youtu.be', 'weibo.com', 'xiaohongshu.com'
  ];
  
  for (const domain of quickCheckDomains) {
    if (url.includes(domain)) {
      return true;
    }
  }
  
  // 如果快速检查失败，使用配置进行检查
  if (!config || !config.supportedSites) {
    console.log('[utils.js] 没有配置或supportedSites为空');
    return false;
  }
  
  const result = config.supportedSites.some(site => {
    if (!site.enabled) return false;
    // 跳过没有domains属性的网站
    if (!site.domains || !Array.isArray(site.domains)) return false;
    // 检查域名匹配
    return site.domains.some(domain => url.includes(domain.toLowerCase()));
  });
  
  console.log(`[utils.js] 配置匹配结果: ${result}`);
  return result;
}

/**
 * 根据URL获取网站信息
 * @param {string} url 要检查的URL
 * @param {Object} config 配置对象
 * @returns {Object|null} 网站配置信息
 */
function getSiteInfo(url, config) {
  console.log('[utils.js] 获取网站信息:', url);
  
  if (!url) {
    return null;
  }
  
  // 标准化URL为小写
  url = url.toLowerCase();
  
  // 快速检查常见域名
  const quickSiteMap = {
    'bilibili.com': { id: 'bilibili', name: '哔哩哔哩' },
    'b23.tv': { id: 'bilibili', name: '哔哩哔哩' },
    'douyin.com': { id: 'douyin', name: '抖音' },
    'zhihu.com': { id: 'zhihu', name: '知乎' },
    'youtube.com': { id: 'youtube', name: 'YouTube' },
    'youtu.be': { id: 'youtube', name: 'YouTube' },
    'weibo.com': { id: 'weibo', name: '微博' },
    'xiaohongshu.com': { id: 'xiaohongshu', name: '小红书' }
  };
  
  for (const [domain, info] of Object.entries(quickSiteMap)) {
    if (url.includes(domain)) {
      return info;
    }
  }
  
  // 如果没有快速匹配成功，使用配置进行匹配
  if (!config || !config.supportedSites) {
    return null;
  }
  // 使用配置匹配
  const site = config.supportedSites.find(site => {
    if (!site.enabled) return false;
    if (!site.domains || !Array.isArray(site.domains)) return false;
    return site.domains.some(domain => url.includes(domain.toLowerCase()));
  });
  
  if (site) {
    return site;
  } else {
    return null;
  }
}

/**
 * 获取特定网站的分析提示模板
 * @param {string} siteId 网站ID
 * @param {Object} config 配置对象
 * @returns {string} 提示模板
 */
function getPromptTemplate(siteId, config) {
  if (!siteId || !config || !config.analysis || !config.analysis.promptTemplates) {
    return '';
  }
  return config.analysis.promptTemplates[siteId.toLowerCase()] || 
         config.analysis.promptTemplates.default || 
         '请分析以下内容，给出一个结构化总结：\n\n标题：{title}\nURL：{url}\n内容：{content}\n';
}

/**
 * 格式化提示模板
 * @param {string} template 模板字符串
 * @param {Object} data 要插入的数据
 * @returns {string} 格式化后的字符串
 */
function formatPrompt(template, data) {
  if (!template) return '';
  return template.replace(/{([^}]+)}/g, (match, key) => {
    return (data && typeof data[key] !== 'undefined') ? data[key] : match;
  });
}

/**
 * 格式化文件名
 * @param {string} template 文件名模板
 * @param {Object} data 要插入的数据
 * @returns {string} 格式化后的文件名
 */
function formatFilename(template, data) {
  if (!template) return 'analysis_result';
  // 添加日期时间
  const now = new Date();
  const dateStr = `${now.getFullYear()}-${(now.getMonth()+1).toString().padStart(2, '0')}-${now.getDate().toString().padStart(2, '0')}`;
  const timeStr = `${now.getHours().toString().padStart(2, '0')}-${now.getMinutes().toString().padStart(2, '0')}`;
  const templateData = {
    ...data,
    date: dateStr,
    time: timeStr,
    datetime: `${dateStr}_${timeStr}`
  };
  // 替换模板变量
  let filename = template.replace(/{([^}]+)}/g, (match, key) => {
    return (templateData && typeof templateData[key] !== 'undefined') ? templateData[key] : match;
  });
  // 清理文件名中的非法字符
  filename = filename.replace(/[\\/:*?"<>|]/g, '_');
  return filename || 'analysis_result';
}

/**
 * 检查MCP服务状态
 * @returns {Promise<Object>} 状态对象 {status, path}
 */
async function checkMcpStatus() {
  return new Promise((resolve) => {
    fetch('http://localhost:51512/filesystem/list_allowed_directories', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ random_string: 'check' })
    })
      .then(res => res.json())
      .then(data => {
        if (Array.isArray(data.directoryList) && data.directoryList.length > 0) {
          resolve({ status: 'online', path: data.directoryList[0] });
        } else {
          resolve({ status: 'offline', path: '' });
        }
      })
      .catch(() => {
        resolve({ status: 'offline', path: '' });
      });
  });
}

// 导出工具函数
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    loadConfig,
    saveConfig,
    getActiveAiModel,
    isSupportedSite,
    getSiteInfo,
    getPromptTemplate,
    formatPrompt,
    formatFilename,
    checkMcpStatus
  };
} else {
  // 浏览器环境中全局可用
  window.utils = {
    loadConfig,
    saveConfig,
    getActiveAiModel,
    isSupportedSite, 
    getSiteInfo,
    getPromptTemplate,
    formatPrompt,
    formatFilename,
    checkMcpStatus
  };
}