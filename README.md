# ChromePlus 网页内容分析扩展（MV3）

一个基于 Manifest V3 的 Chrome 扩展，面向多站点（哔哩哔哩、抖音、YouTube、知乎等）提供页面媒体识别（视频/音频/图片）、视频快捷控制、录制与抓帧能力。当前核心聚焦“媒体识别 + 控制 + 抓取与下载”，AI 分析与 MCP 功能作为可选扩展，不作为默认能力。

> 开源友好：本项目遵循中文文档与中文注释标准；欢迎 Issue/PR 共同完善。

## 功能特性
- 多站点识别：自动识别当前页面所属站点并适配采集字段
- 侧边栏（Side Panel）：集中展示采集信息与分析入口（Vue3 构建）
- 视频控制：播放/暂停、录制（按站点差异做兼容）
- AI 分析：支持自定义模型（Moonshot/OpenAI 等），可配置提示模板
- 本地存储：与本地 MCP 文件系统服务集成，保存分析结果
- 可扩展架构：消息协议统一、服务封装清晰、测试覆盖逐步完善

## 目录结构（当前实现为主，TS/Vue 迁移在进行中）

```
chromeplus02/
├── manifest.json                # MV3 清单（指向当前 JS 实现）
├── background.js                # 后台 Service Worker：标签页管理、消息路由等
├── content_script.js            # 内容脚本：站点检测、页面信息与媒体扫描
├── sidepanel.html               # 侧边栏页面
├── sidepanel.js                 # 侧边栏逻辑：控制、录制、抓帧、列表展示
├── utils.js                     # 通用工具与配置读写
├── styles.css                   # 侧边栏样式
├── icons/                       # 扩展图标资源
├── src/                         # TypeScript + Vue3 迁移中源码（暂未接入 manifest）
├── build/                       # 构建脚本与配置
├── tests/                       # 单元测试（Vitest）
├── docs/                        # 文档：需求、架构、数据流、UI、API、测试等
├── vite.config.ts               # Vite 配置
├── package.json                 # 脚本与依赖
└── README.md                    # 本说明文档
```

## 文档总览（开发前必读）
- 需求与流程：`docs/requirements.md`
- 架构设计：`docs/architecture.md`
- 当前状态梳理：`docs/current-state.md`
- 数据与流程：`docs/data-flow.md`
- UI/交互设计：`docs/ui-design.md`
- API 使用：`docs/api-usage.md`
- 安全与权限：`docs/security.md`
- 任务跟踪（需求-设计-代码映射）：`docs/tracking.md`
- 测试策略与用例：`docs/testing.md`
- 更新日志：`docs/CHANGELOG.md`

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

## 代码模块

### background.js（旧）/ src/background（新）
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

### content_script.js（旧）/ src/content-scripts（新）
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

### utils（TS 版）
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

### MCP 服务
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

## 快速开始（开发）

```powershell
npm install
npm run dev
```

将构建产物目录作为“加载已解压的扩展”（待引入 manifest 生成脚本后，推荐加载 dist 目录）。迁移期内仍可用根目录旧版文件进行功能验证。

## 构建与测试

```powershell
npm run typecheck
npm run lint
npm run test
npm run build
```

## 迁移路线与删除旧代码的条件
- 确认 TS 版背景/内容脚本/侧边栏在目标站点上功能对等（手测清单 + 单测通过）。
- manifest 切换至 dist 产物并通过 Chrome 加载验证。
- 权限与 CSP 校验通过且未新增不必要权限。
- 完成后移除：`background.js`、`content_script.js`、`sidepanel.html`、`sidepanel.js`、`utils.js` 等旧文件，并在 CHANGELOG 标记。

## 贡献指南
- 采用中文提交信息与 PR 描述；Issue 请附重现步骤或截图。
- 代码需包含中文模块/函数 JSDoc 注释；若变更结构需更新 docs/ 与 README。
- 提交前请运行 `npm run lint && npm run test` 确保通过。

## 安全与隐私
- 遵循最小权限原则；仅在确有需要时修改 manifest 权限。
- 未经用户同意不上传任何个人信息；与第三方 API 的交互需在界面提示并由用户主动触发。

## 许可证
本项目遵循仓库内 `LICENSE` 文件所述的开源许可证。
