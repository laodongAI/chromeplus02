/**
 * 配置文件 - 定义应用程序的全局配置
 */

// 默认应用配置
const defaultConfig = {
  // 界面设置
  interface: {
    theme: 'auto',  // 'light', 'dark', 'auto'
    language: 'zh-CN',  // 'zh-CN', 'en-US'
  },
  
  // 录制设置
  recording: {
    format: 'webm',  // 'webm', 'mp4'
    quality: 'high',  // 'low', 'medium', 'high'
    autoSave: true,  // 是否自动保存
  },
  
  // 支持的站点
  supportedSites: [
    {
      id: 'bilibili',
      name: '哔哩哔哩',
      enabled: true,
      icon: 'bilibili.png',
      domains: ['bilibili.com', 'b23.tv'],
      patterns: ['*://*.bilibili.com/video/*', '*://b23.tv/*']
    },
    {
      id: 'youtube',
      name: 'YouTube',
      enabled: true,
      icon: 'youtube.png',
      domains: ['youtube.com', 'youtu.be'],
      patterns: ['*://*.youtube.com/watch*', '*://youtu.be/*']
    },
    {
      id: 'douyin',
      name: '抖音',
      enabled: true,
      icon: 'douyin.png',
      domains: ['douyin.com'],
      patterns: ['*://*.douyin.com/video/*', '*://*.douyin.com/discover*']
    },
    {
      id: 'zhihu',
      name: '知乎',
      enabled: true,
      icon: 'zhihu.png',
      domains: ['zhihu.com'],
      patterns: ['*://*.zhihu.com/zvideo/*']
    },
    {
      id: 'weibo',
      name: '微博',
      enabled: true,
      icon: 'weibo.png',
      domains: ['weibo.com'],
      patterns: ['*://*.weibo.com/*']
    },
    {
      id: 'xiaohongshu',
      name: '小红书',
      enabled: true,
      icon: 'xiaohongshu.png',
      domains: ['xiaohongshu.com'],
      patterns: ['*://*.xiaohongshu.com/explore*', '*://*.xiaohongshu.com/discovery/item/*']
    }
  ],
  
  // AI模型配置
  aiModels: [
    {
      id: 'openai',
      name: 'OpenAI',
      enabled: true,
      apiUrl: 'https://api.openai.com/v1/chat/completions',
      model: 'gpt-3.5-turbo',
      temperature: 0.7,
      maxTokens: 2000,
      apiKey: ''  // 用户需要填写自己的API密钥
    },
    {
      id: 'moonshot',
      name: 'MoonShot',
      enabled: true,
      apiUrl: 'https://api.moonshot.cn/v1/chat/completions',
      model: 'moonshot-v1-8k',
      temperature: 0.7,
      maxTokens: 2000,
      apiKey: ''  // 用户需要填写自己的API密钥
    }
  ],
  
  // 分析设置
  analysis: {
    defaultModel: 'moonshot',  // 默认使用的AI模型ID
    // 提示词模板，按站点类型
    promptTemplates: {
      bilibili: '请分析以下B站视频页面内容，并提供结构化总结：\n\n标题：{title}\n上传者：{uploader}\n链接：{url}\n描述：{description}\n标签：{tags}\n播放量：{viewCount}\n点赞量：{likeCount}\n\n请提供：\n1. 视频的主要内容摘要（200字以内）\n2. 视频的关键观点或亮点（3-5条）\n3. 视频的受众分析\n4. 视频的价值评估\n\n以JSON格式返回，包含以下字段：summary, keyPoints, audience, valueAssessment',
      youtube: 'Please analyze the following YouTube video page and provide a structured summary:\n\nTitle: {title}\nUploader: {uploader}\nURL: {url}\nDescription: {description}\nTags: {tags}\nViews: {viewCount}\nLikes: {likeCount}\n\nPlease provide:\n1. A concise summary of the video (200 words or less)\n2. Key points or highlights (3-5 items)\n3. Target audience analysis\n4. Value assessment\n\nReturn in JSON format with the following fields: summary, keyPoints, audience, valueAssessment',
      douyin: '请分析以下抖音视频页面内容，并提供结构化总结：\n\n标题：{title}\n创作者：{uploader}\n链接：{url}\n描述：{description}\n话题标签：{tags}\n播放量：{viewCount}\n点赞量：{likeCount}\n\n请提供：\n1. 视频的主要内容摘要（100字以内）\n2. 视频的关键亮点（3条）\n3. 视频的传播价值分析\n4. 创作风格评估\n\n以JSON格式返回，包含以下字段：summary, keyPoints, viralValue, styleAssessment',
      zhihu: '请分析以下知乎视频页面内容，并提供结构化总结：\n\n标题：{title}\n创作者：{uploader}\n链接：{url}\n描述：{description}\n话题标签：{tags}\n播放量：{viewCount}\n点赞量：{likeCount}\n\n请提供：\n1. 视频的主要内容摘要（150字以内）\n2. 视频中的关键信息点（3-5条）\n3. 内容的知识价值评估\n4. 内容的可信度分析\n\n以JSON格式返回，包含以下字段：summary, keyPoints, knowledgeValue, credibilityAnalysis',
      default: '请分析以下视频页面内容，并提供结构化总结：\n\n标题：{title}\n创作者：{uploader}\n链接：{url}\n描述：{description}\n标签：{tags}\n播放量：{viewCount}\n点赞量：{likeCount}\n\n请提供：\n1. 视频的主要内容摘要（200字以内）\n2. 视频的关键观点或亮点（3-5条）\n3. 视频的目标受众\n4. 内容质量评估\n\n以JSON格式返回，包含以下字段：summary, keyPoints, targetAudience, qualityAssessment'
    }
  },
  
  // 文件存储设置
  fileStorage: {
    mcpEnabled: true,  // 是否启用MCP服务
    mcpApiUrl: 'http://localhost:51512',  // MCP服务API地址
    mcpServicePath: '',  // MCP服务可执行文件路径（用于自动启动）
    mcpStatus: false,  // MCP服务运行状态
    savedPath: 'D:/mcp/mcp_result_files',  // 保存路径
    filenameTemplate: '{title}_{date}_{time}'  // 文件名模板
  }
};

// 导出配置
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { defaultConfig };
} else {
  // 浏览器环境中全局可用
  window.defaultConfig = defaultConfig;
}