# 网页内容分析工具 Chrome 扩展

一个 Chrome 扩展，提供对多个视频网站（B站、抖音、YouTube等）的播放、录制和AI内容分析功能，使用侧面板实现。

## 目录结构

```
chromeplus02/
├── manifest.json      // 扩展配置文件
├── background.js      // 后台脚本
├── content_script.js  // 内容注入脚本
├── sidepanel.html    // 侧面板界面
├── sidepanel.js      // 侧面板功能实现
├── styles.css        // 样式表
├── config.js         // 全局配置
├── utils.js          // 工具函数
├── mcp_init.js       // MCP服务初始化
└── README.md         // 说明文档
```

## 核心功能

### 1. 视频控制功能
- 播放/暂停视频
- 视频录制
- 录制文件保存

### 2. AI内容分析
- 多平台内容识别
- AI模型分析
- 结果本地保存

### 3. 多平台支持
- 哔哩哔哩
- 抖音
- YouTube
- 知乎
- 微博
- 小红书

## 模块说明

### background.js - 后台脚本
1. **标签页管理**
   - getCurrentTabUrl(): 获取当前标签页URL
   - getActiveBilibiliTabId(): 获取活动B站标签页ID
   - handleContentSiteInfo(): 处理网站信息

2. **AI请求代理**
   - handleProxyAiRequest(): 处理AI API请求代理
   - initialize(): 初始化扩展
   - loadConfig(): 加载配置
   - saveConfig(): 保存配置

3. **MCP服务管理**
   - checkMcpService(): 检查MCP服务状态
   - startMcpService(): 启动MCP服务
   - updateMcpStatus(): 更新MCP状态

### content_script.js - 内容脚本
1. **页面交互**
   - setupUrlChangeListener(): 设置URL变化监听
   - onUrlChange(): URL变化处理
   - updatePageInfo(): 更新页面信息

2. **视频控制**
   - playVideo(): 播放视频
   - pauseVideo(): 暂停视频
   - startRecording(): 开始录制
   - stopRecording(): 停止录制

3. **内容分析**
   - analyzeContent(): 分析页面内容
   - getBasicPageInfo(): 获取基本页面信息

### utils.js - 工具函数
1. **配置管理**
   - loadConfig(): 加载配置
   - saveConfig(): 保存配置
   - getActiveAiModel(): 获取当前活跃的AI模型

2. **站点识别**
   - isSupportedSite(): 检查URL是否为支持的网站
   - getSiteInfo(): 获取网站信息
   - getPromptTemplate(): 获取分析提示模板

3. **文件处理**
   - formatPrompt(): 格式化提示模板
   - formatFilename(): 格式化文件名
   - checkMcpStatus(): 检查MCP服务状态

### mcp_init.js - MCP服务初始化
1. **文件系统服务**
   - readFile(): 读取文件
   - writeFile(): 写入文件
   - createDirectory(): 创建目录
   - fileExists(): 检查文件存在
   - listDirectory(): 获取目录列表

2. **MCP客户端**
   - checkAvailability(): 检查服务可用性
   - saveToFile(): 保存内容到文件

## 配置说明

### 1. 基础配置 (config.js)
```javascript
{
  interface: {
    theme: 'auto',     // 主题：'light', 'dark', 'auto'
    language: 'zh-CN'  // 语言：'zh-CN', 'en-US'
  },
  recording: {
    format: 'webm',    // 录制格式：'webm', 'mp4'
    quality: 'high',   // 质量：'low', 'medium', 'high'
    autoSave: true     // 是否自动保存
  }
}
```

### 2. 站点配置
```javascript
{
  supportedSites: [
    {
      id: 'bilibili',
      name: '哔哩哔哩',
      enabled: true,
      domains: ['bilibili.com', 'b23.tv'],
      patterns: ['*://*.bilibili.com/video/*', '*://b23.tv/*']
    },
    // 其他站点配置...
  ]
}
```

### 3. AI模型配置
```javascript
{
  aiModels: [
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
  analysis: {
    defaultModel: 'moonshot',
    promptTemplates: {
      // 不同网站的分析提示模板
    }
  }
}
```

### 4. 文件存储配置
```javascript
{
  fileStorage: {
    mcpEnabled: true,  // 是否启用MCP服务
    mcpApiUrl: 'http://localhost:51512',  // MCP服务API地址
    mcpServicePath: '',  // MCP服务可执行文件路径
    mcpStatus: false,  // MCP服务运行状态
    savedPath: 'D:/mcp/mcp_result_files',  // 保存路径
    filenameTemplate: '{title}_{date}_{time}'  // 文件名模板
  }
}
```

## 权限说明

### 基础权限
- `activeTab`: 访问当前标签页
- `scripting`: 注入脚本
- `tabs`: 访问标签系统
- `sidePanel`: 创建侧面板
- `storage`: 存储数据

### 主机权限
```json
"host_permissions": [
  "*://*.bilibili.com/*",
  "*://*.douyin.com/*",
  "*://*.youtube.com/*",
  "*://*.zhihu.com/*",
  "*://*.weibo.com/*",
  "*://*.xiaohongshu.com/*",
  "https://api.moonshot.cn/*",
  "https://api.openai.com/*",
  "http://localhost:51512/*"
]
```

## 样式主题

样式主题在 styles.css 中定义，采用 B站主色调：
- 主色：#00a1d6 (B站蓝)
- 辅助色：#fb7299 (B站粉)
- 背景色：#f5f5f5
- 文字色：#333

提供了完整的响应式布局和动画效果，包括：
- 按钮悬停效果
- 通知消息动画
- 加载动画
- 状态指示器样式
