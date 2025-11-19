# 架构设计（MV3）

## 1. 模块与职责
- `manifest.json`：声明 MV3 权限、背景脚本（Service Worker）、侧边栏入口与内容脚本注入范围。
- `background.js`（Service Worker）：
  - 生命周期与全局事件监听，处理跨页面逻辑与下载监听（可扩展）。
  - 统一消息路由（可拓展为消息分发中心）。
- `content_script.js`（内容脚本）：
  - 在目标站点 DOM 中扫描媒体资源（视频/音频/图片），执行页面上下文操作（播放/暂停/抓帧等）。
  - 响应侧边栏消息，返回识别结果。
- `sidepanel.html / sidepanel.js`（侧边栏 UI）：
  - 提供资源扫描、列表化展示、单个/批量操作；统一的通知与进度展示。
  - 通过 `chrome.tabs.sendMessage` 与内容脚本交互，必要时用 `chrome.scripting.executeScript` 注入函数。
  - 针对视频列表，负责发起“开始/停止录制”“下载原视频”“提取音频”等操作请求，并实时显示状态。
- `utils.js`：通用工具、配置读写（`chrome.storage.local`）、站点匹配等。

## 2. 关键数据
- 媒体条目：
  - 视频：`{index, src/currentSrc, width, height, duration, muted}`
  - 音频：`{url, title}`
  - 图片：`{url, width?, height?, type?}`
- 设置项（持久化至 `chrome.storage.local`）：
  - 自动扫描开关、命名模板、下载并发上限、默认录制封装/质量等。

## 3. 通信与流程
- 侧边栏 → 内容脚本：扫描请求、播放/暂停、录制/抓帧、复制/下载执行。
- 内容脚本 → 侧边栏：识别结果、操作反馈。
- 侧边栏 → 内容脚本新增控制：
  - `START_RECORD_VIDEO` / `STOP_RECORD_VIDEO`：对指定 `videoIndex` 使用 `captureStream()` + `MediaRecorder` 录制整段并回传 Blob。
  - `DOWNLOAD_VIDEO_SOURCE`：请求内容脚本返回可用的视频源 URL 列表；可回退到背景脚本请求。
  - `START_AUDIO_RECORD` / `STOP_AUDIO_RECORD`：仅录制音轨并回传音频 Blob。
- 内容脚本 → 侧边栏：
  - 返回录制状态（开始/结束/失败原因）、可用视频源直链、音频提取结果。
- 侧边栏 → 后台：
  - 触发 `chrome.downloads.download`（可在侧边栏直接调用，也可委托后台统一处理，并监听下载进度）。

## 4. 使用的 Chrome API
- `tabs`/`scripting`：脚本注入与页面上下文执行。
- `sidePanel`：侧边栏 UI 宿主。
- `downloads`：文件下载与进度事件。
- `storage`：设置项与配置持久化。

## 5. 约束与回退
- DRM/EME：`captureStream()` 可能不可用 → 降级为 `captureVisibleTab` 或直链下载。
- CORS/跨域画布：`canvas` 导出受限 → 尽量使用下载直链或标签页截图。
- 音频/视频录制需用户手势触发，录制中断时需回传原因并在 UI 中提示。

## 6. 未来演进方向（概要）
- 分层更清晰：
  - 背景层：事件监听、消息路由、（可选）AI 代理与下载监听。
  - 内容层：站点识别、页面信息与媒体提取、视频控制。
  - UI 层：侧边栏 Vue 组件化（播放控制、媒体列表、设置等）。
  - 工具与服务层：配置、站点注册表、命名模板、权限审计等。
- 消息协议类型化：在 TypeScript 迁移阶段，引入统一的 `MessageType` 枚举与请求/响应结构，避免魔法字符串。
- 站点适配器：为 B 站 / YouTube / 抖音 / 知乎 等站点抽象“站点适配器”，封装选择器与解析逻辑，降低 DOM 变动带来的影响。
