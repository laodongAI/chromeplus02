# Current State Overview

## Manifest
- name: 网页内容分析工具
- version: 1.0.0
- permissions: tabs, activeTab, scripting, storage, sidePanel
- host_permissions: bilibili, b23, douyin, youtube, youtu.be, zhihu, weibo, xiaohongshu, moonshot API, openai API, local MCP service
- background: service_worker -> background.js (module)
- side_panel: sidepanel.html
- content_scripts: utils.js + content_script.js on supported sites

## Modules
### background.js
Responsibilities:
- Tab lifecycle tracking (onUpdated, onActivated, onRemoved)
- Active site (Bilibili) tab resolution logic with multi-fallback
# 当前实现状态概览

## Manifest
- name：网页内容分析工具
- version：1.0.0
- permissions：tabs, activeTab, scripting, storage, sidePanel, downloads
- host_permissions：bilibili、b23、douyin、youtube、youtu.be、zhihu、weibo、xiaohongshu、Moonshot/OpenAI API、本地 MCP 服务。
- background：service_worker → `background.js`（模块）。
- side_panel：`sidepanel.html`。
- content_scripts：`utils.js` + `content_script.js`（在支持站点注入）。

## 模块现状
### background.js
职责：
- 监听标签页生命周期（`onUpdated/onActivated/onRemoved`），根据 URL 维护“活动站点标签页”信息。
- 通过 `runtime.onMessage` 充当消息路由中心，处理：
  - 获取当前 URL / 活动标签页信息；
  - 站点信息更新（CONTENT_SITE_INFO 缓存）；
  - 配置读取/保存；
  - 可选的 AI 代理请求与 MCP 状态检查（已降级为非主路径）。

观察与问题：
- 职责较多：标签管理、配置、AI 代理、MCP 检测混在一起，后续可拆分为独立模块。
- 部分监听逻辑存在历史遗留（如重复 onActivated 的情况），已在最近重构中做了收敛，但仍建议持续审查。

### content_script.js
职责：
- 站点检测：使用 `SUPPORTED_SITES` 与 `quickCheckSite` 判断当前页是否属于支持站点（B 站 / YouTube / 抖音 / 知乎 / 微博 / 小红书等）。
- 页面信息抽取：根据站点使用选择器读取标题、作者、播放量等信息，并回传给后台或侧边栏。
- 视频控制：提供播放/暂停等辅助函数（包括多种选择器与 iframe 适配）。
- 媒体扫描：扫描页面中的音频 URL（`<audio>/<source>/<a>` 直链、`og:audio` 等），作为侧边栏音频列表的数据来源之一。

观察与问题：
- 文件体积较大，包含站点列表、选择器、控制逻辑等多块内容，后续适合拆分为“站点适配器 + 通用视频控制 + 媒体扫描”几个模块。
- 与 `config.js`、`utils.js` 在“支持站点”与配置读写上有一定重复，需逐步收敛为单一信息源。

### sidepanel.html / sidepanel.js
职责：
- 作为主要交互界面，提供：
  - 视频播放/暂停与录制（视频+音频 / 仅音频）；
  - 视频帧抓取与页面截图；
  - 音频资源列表的刷新、复制与下载；
  - 配置加载/保存与通知展示。
- 通过 `chrome.tabs` 与 `chrome.scripting` 注入函数到页面上下文执行媒体相关操作；通过 `chrome.runtime.sendMessage` 与内容脚本通信。

观察与问题：
- `sidepanel.js` 当前仍是一个较大的单文件，混合了 UI 状态管理、标签页解析、脚本注入、录制逻辑、配置管理等职责，是未来 Vue 迁移的首要拆分目标。
- 媒体列表（视频/图片）部分仍在规划中，目前已实现的是音频列表与部分视频控制功能，需按 `docs/tracking.md` 中的任务继续补齐。

### utils.js
职责：
- 基本配置的读取与写入（基于 `chrome.storage.local`）。
- 通用的站点匹配与辅助函数（如快速判断是否支持站点）。
- 部分与 MCP 状态、文件命名相关的工具逻辑。

观察与问题：
- 与 `content_script.js`、`config.js` 在站点与配置层面存在一定重叠，后续会在 TypeScript 迁移时拆分为更细的工具/服务模块。

### config.js
职责：
- 提供默认配置（界面行为、录制选项、支持站点列表、AI 模型、分析模板、文件存储配置等）。

观察：
- 与 `content_script.js`、`utils.js` 之间存在重复定义，建议在后续重构阶段将其收敛为单一“配置来源”，并在 TS 中加上类型约束。

### mcp_init.js
职责：
- 与本地 MCP 服务交互，提供简单的文件系统读写能力（列目录、保存分析结果等）。

观察：
- 目前作为可选能力存在，未来可统一到“持久化/文件服务”层；同时需要结合安全文档，严格限制可写入路径。

## 数据与流程（当前）
1. 内容脚本在支持站点加载后检测站点信息，并在必要时将 `CONTENT_SITE_INFO` 发送给后台，后台缓存于内存与 `storage.local`。
2. 用户打开侧边栏后，`sidepanel.js` 解析当前活动标签页，注入控制/录制函数或通过消息与内容脚本交互，实现播放/暂停、录制、抓帧与音频扫描等功能。
3. 部分场景下，侧边栏会通过后台脚本代理访问 AI/MCP 服务，但这些逻辑当前已降级为可选扩展路径，不影响核心“媒体识别与下载”体验。

## Chrome API 使用总结（简版）
- tabs：查询/监听标签页，用于获取当前活动页面并作为注入目标。
- runtime：消息传递，用于 background / content_script / sidepanel 之间交互。
- scripting：在页面上下文执行控制/录制等函数。
- storage：持久化配置与站点缓存。
- sidePanel：提供侧边栏宿主页面。
- downloads：触发文件下载，后续可扩展进度监听。

## 当前痛点与风险（更新版）
- JS 文件体积大且职责混杂，后续在不影响功能的前提下，适合通过 TS + 模块化拆分来提升可维护性。
- 站点检测与配置在多个文件中重复，存在“信息源不统一”的风险，需要逐步收敛。
- 消息协议仍以字符串常量为主，缺少统一枚举与结构定义，易出现前后端对不上号的情况。
- Manifest 中的 host_permissions 略偏宽泛，部分站点仍处于“预留待适配”状态，需要进一步按实际使用情况收缩。

## 近期改进机会
- 以 `docs/tracking.md` 中的任务为导向，优先补齐视频/图片清单与批量下载功能，让文档中的媒体流程闭环真正落地。
- 在保持现有 JS 功能稳定的前提下，逐步为关键数据结构与消息类型补充 JSDoc 与类型定义，为将来的 TypeScript 迁移铺路。
- 对 `manifest.json` 的权限与域名做一次梳理，将未使用的域名标记为可移除候选项，并在 `docs/security.md` 中同步记录。
1. Confirm AI model usage scenario scope (only Moonshot + optional OpenAI?).
2. Validate necessity of every host permission.
3. Draft message protocol spec (see migration-plan).
4. Start Phase 0 migration (tooling scaffold) after docs complete.
