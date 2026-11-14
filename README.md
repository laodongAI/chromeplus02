# ChromePlus 网页内容分析扩展（MV3）

一个基于 Manifest V3 的 Chrome 扩展，面向多站点（哔哩哔哩、抖音、YouTube、知乎等）提供页面媒体识别（视频/音频/图片）、视频快捷控制、录制与抓帧能力。当前核心聚焦"媒体识别 + 控制 + 抓取与下载"，AI 分析与 MCP 功能作为可选扩展，不作为默认能力。

> 开源友好：本项目遵循中文文档与中文注释标准；欢迎 Issue/PR 共同完善。

## ✨ 功能特性

### 核心功能
- 🎬 **视频采集**：识别并控制页面视频，支持录制与抓帧；HLS/m3u8 分片解析并合并为 MP4
- 🖼️ **图像抓取**：扫描页面图片，支持预览、复制与批量下载
- 🎵 **音频抓取**：提取音频资源，进行单个或批量下载
- 📝 **文本抽取**：提取页面正文、元数据与结构化信息
- 📡 **接口抓取**：基于 chrome.debugger 只捕获 AJAX（XHR/Fetch）与 POST 等写请求，图片/CSS/JS 等静态资源自动过滤；支持请求详情、HAR 导出与 AI 分析
- 📦 **Sources下载**：浏览和下载页面资源文件，保持目录结构
- 📥 **下载管理**：统一下载队列，支持并发控制、进度显示、错误重试
- 🖥️ **录屏与标注**：录制标签页/整个屏幕/摄像头；录制中可用页内画笔（荧光笔/橡皮擦/白板背景，H 隐藏工具栏、空格切操作/绘制），Windows 下还可开启覆盖整个桌面的透明标注层（在任意应用窗口上画）
- ✂️ **编辑器**：对录制视频裁剪、混音，经 WebCodecs（H.264/AAC）导出真 MP4
- 🤖 **AI 助手**（可选）：对页面文本或捕获的接口请求做一键总结分析
- ⚡ **极速下载**（可选）：伴生程序桥接本地 yt-dlp（1700+ 站点），失败自动回退内置下载链路

### 平台支持
- 哔哩哔哩（bilibili.com）
- 抖音（douyin.com）
- YouTube（youtube.com）
- 知乎（zhihu.com）
- 微博（weibo.com）
- 小红书（xiaohongshu.com）
- NPR（npr.org）
- 以及更多通用网站

### 技术特性
- ⚡ **高性能**：并发下载、智能缓存、内存优化
- 🛡️ **可靠性**：错误重试、状态恢复、资源清理
- 🎨 **现代UI**：Vue3 + TypeScript，响应式设计
- 🔧 **可扩展**：模块化架构，消息协议统一

## 📁 目录结构

```
chromeplus02/
├── manifest.json                # MV3 清单
├── src/                         # TypeScript + Vue3 源码
│   ├── background/              # 后台服务
│   │   ├── index.ts            # 入口
│   │   ├── bus.ts              # 消息总线（registerBgHandler）
│   │   ├── downloads.ts        # 下载队列管理
│   │   ├── capture.ts          # 媒体网络嗅探
│   │   ├── networkCapture.ts   # 接口捕获（chrome.debugger，仅 XHR/Fetch 与写请求）
│   │   ├── hls.ts              # HLS/m3u8 分片下载
│   │   ├── companion.ts        # 伴生程序桥接（极速下载 + 桌面标注控制）
│   │   └── sourcesDownload.ts  # Sources下载
│   ├── content-scripts/        # 内容脚本
│   │   ├── router.ts           # 消息路由
│   │   ├── audio.ts            # 音频扫描
│   │   ├── images.ts           # 图片扫描
│   │   ├── annotate.ts         # 页内画笔覆盖层（录屏标注）
│   │   ├── sources.ts          # 资源扫描
│   │   └── sourcesTree.ts      # 资源树获取
│   ├── core/                   # 媒体处理核心（m3u8/mpd 解析、TS 重封装、WebCodecs MP4 导出）
│   ├── editor/                 # 视频编辑器页面（裁剪/混音/导出）
│   ├── sidepanel/              # 侧边栏
│   │   ├── views/              # 视图组件（含 NetworkPanel 接口面板、ScreenRecordPanel 录屏面板）
│   │   ├── components/         # 基础组件
│   │   ├── composables/        # 组合式函数
│   │   └── services/           # 服务层
│   ├── messaging/              # 消息协议
│   ├── services/               # 全局服务
│   └── utils/                  # 工具函数（含分级日志 logger）
├── companion/                  # Windows 伴生程序（可选：yt-dlp 极速下载 + 桌面透明标注层）
│   ├── host.ps1 / host.bat     # Native Messaging Host
│   ├── overlay/overlay.ps1     # 桌面级透明标注画布（全局热键、点击穿透）
│   └── install.bat             # 安装器（install.bat <扩展ID>）
├── tools/                      # 预览服务器（chrome-stub 模拟 Chrome API，8898 端口）
├── docs/                       # 文档
├── dist/                       # 构建产物
├── tests/                      # 测试
└── build/                      # 构建脚本
```

## 🚀 快速开始

### 安装依赖
```bash
pnpm install    # 项目使用 pnpm（含 lockfile）；esbuild 构建脚本已在 pnpm-workspace.yaml 中放行
```

### 开发模式
```bash
npm run dev
```

### 构建生产版本
```bash
npm run build   # tsc 类型检查 + 侧栏/编辑器构建 + content.js 构建 + postbuild 拷贝
```

### 无 Chrome 环境预览
```bash
node tools/preview-server.cjs   # 访问 http://localhost:8898/（根路径），chrome-stub 会模拟 Chrome API 并注入演示数据
```

### 加载扩展
1. 打开 Chrome 浏览器
2. 访问 `chrome://extensions/`
3. 开启"开发者模式"
4. 点击"加载已解压的扩展程序"
5. 选择 `dist` 目录

## 📖 使用指南

### 视频采集
1. 打开包含视频的页面
2. 点击扩展图标打开侧边栏
3. 切换到"视频采集"标签
4. 点击"重新扫描"识别视频
5. 使用播放/暂停/录制等功能

### 图像抓取
1. 打开包含图片的页面
2. 切换到"图像抓取"标签
3. 点击"扫描图片"
4. 选择要下载的图片
5. 点击"下载选中"

### Sources下载
1. 打开要下载资源的页面
2. 切换到"Sources下载"标签
3. 点击"扫描资源目录"
4. 浏览目录树，选择文件或目录
5. 点击"下载并打包"
6. 等待zip文件下载完成

**注意**：使用Sources下载时，页面会显示"正在调试此浏览器"提示，这是正常现象。

### 接口抓取（网络请求捕获）
1. 切换到"接口"标签，点击"开始捕获"（依赖 chrome.debugger，页面顶部会出现调试横幅，开始前请先关闭该页 DevTools）
2. 只捕获 AJAX（XHR/Fetch）与 POST/PUT/PATCH/DELETE 写请求；图片、CSS、JS 等静态资源自动过滤
3. 点击某条请求查看请求头/请求体/响应头/响应体（JSON 自动格式化），支持过滤、搜索、清空、导出 HAR 与 AI 分析

### 录屏与标注
1. 切换到"录制"标签，选择标签页/整个屏幕/摄像头来源后点击"开始录制"
2. 录制中可用控制栏按钮：**画笔**（页内覆盖层：荧光笔/橡皮擦/文字/图形，白板/黑板背景；`H` 隐藏工具栏、空格切换操作/绘制）、**桌面标注**（Windows，需安装伴生程序：覆盖整个桌面的透明画布，可在任意应用窗口上画，`Ctrl+Alt+T` 隐藏工具栏、`Ctrl+Alt+D` 切换操作/绘制、`Ctrl+Alt+Q` 退出）
3. 停止录制后自动保存；录制中开启的画笔与桌面标注会自动关闭
4. 录制的视频可在编辑器中裁剪、混音并导出为真 MP4（WebCodecs H.264/AAC，不支持时回退 MediaRecorder）

### 伴生程序（可选增强）
极速下载（yt-dlp）与桌面标注层依赖 Windows 伴生程序，安装与使用说明见 [companion/README.md](companion/README.md)。

## 🔧 开发指南

### 代码规范
```bash
npm run lint        # 代码检查
npm run typecheck   # 类型检查
npm run test        # 运行测试
```

### 技术栈
- **框架**：Vue 3 (Composition API)
- **语言**：TypeScript
- **构建**：Vite
- **测试**：Vitest + Playwright
- **代码规范**：ESLint + Prettier

### 架构设计
- **消息驱动**：统一的消息协议（MessageType）
- **模块化**：清晰的职责分离
- **类型安全**：完整的TypeScript类型定义
- **可测试**：单元测试和集成测试

## 📚 文档

详细文档请查看 `docs/` 目录：
- [功能实现总结](docs/implementation-summary.md)
- [项目优化报告](docs/project-optimization.md)
- [产品功能分析](docs/product-analysis.md)
- [UI改进说明](docs/ui-improvements.md)
- [Sources下载指南](docs/sources-download-guide.md)
- [架构设计](docs/architecture.md)
- [需求文档](docs/requirements.md)

## 🔐 权限说明

### 基础权限
- `tabs` - 访问标签系统
- `activeTab` - 访问当前标签页
- `scripting` - 注入脚本
- `storage` - 存储数据
- `sidePanel` - 创建侧面板
- `downloads` - 下载文件
- `webRequest` - 监听网络请求
- `webNavigation` - 导航事件
- `debugger` - 访问DevTools数据（用于Sources下载）

### 主机权限
支持所有网站（`<all_urls>`）以及特定平台的API访问。

## 🤝 贡献指南

- 采用中文提交信息与 PR 描述
- Issue 请附重现步骤或截图
- 代码需包含中文注释
- 提交前运行 `npm run lint && npm run test`

## 📝 更新日志

版本更新历史参见 Git 提交记录（`git log --oneline`）。

## 📄 许可证

本项目遵循仓库内 `LICENSE` 文件所述的开源许可证。

## 🌟 致谢

感谢所有贡献者和用户的支持！

---

**当前版本**: 1.0.0  
**最后更新**: 2026-11-03
