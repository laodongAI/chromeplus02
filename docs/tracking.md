# 任务跟踪与需求-设计-代码映射

> 本表用于跟踪开发进度，并建立“需求 → 设计/UI → 代码模块”的双向映射，保证实现闭环。

## 1. 需求与映射表

| 需求ID | 功能项ID | UI项ID | 代码模块 | 状态 | 备注 |
|---|---|---|---|---|---|
| R-VID-DET-001 | F-VID-LIST | U-VID-LIST | `router.ts`(稳定索引扫描)、`VideoCapturePanel.vue`(渲染) | 已完成(增强) | WeakMap 稳定 ID，避免 DOM 重排索引漂移 |
| R-AUD-DET-001 | F-AUD-LIST | U-AUD-LIST | `audio.ts`(扫描增强)、`AudioGrabPanel.vue`(列表/下载) | 进行中(增强) | 增加 preload/link/JSON-LD AudioObject 解析与去重 |
| R-IMG-DET-001 | F-IMG-LIST | U-IMG-LIST | `images.ts`(扫描)、`ImageGrabPanel.vue`(渲染/下载) | 已完成(基础) | 支持 `<img>/<picture>/background/og:image/twitter:image` |
| R-VID-CTRL-001 | F-VID-CTRL | U-VID-ITEM | `router.ts`(稳定控制)、`VideoCapturePanel.vue`(按钮) | 已完成(增强) | 控制使用稳定 ID；多视频播放/暂停不再错位 |
| R-VID-REC-001 | F-VID-REC | U-VID-ITEM | `sidepanel.js`(录制/仅音轨) | 已完成(基础) | 支持视频+音频录制与仅音轨录制，状态展示待补 |
| R-VID-FRAME-001 | F-VID-FRAME | U-VID-ITEM | `sidepanel.js`(抓帧)、`content_script.js`(画布) | 已完成(基础) | 已支持抓帧与截图，失败回退/命名模板待补 |
| R-DL-LIST-001 | F-DL-BATCH | U-BATCH | `downloads.ts`(后台队列)、`downloadQueue.ts`(订阅 UI) | 进行中 | 中央并发+任务快照+进度事件搭建中 |
| R-DL-PROG-001 | F-DL-PROG | U-STATUS | `downloads.ts`(监听广播)+`Video/Audio/ImagePanel`(展示)+`GlobalDownloadBar.vue`(聚合) | 进行中(聚合条基础) | 队列快照+进度事件 + 全局聚合进度/速率/ETA |
| R-SET-NAME-001 | F-SET-NAME | U-SETTINGS | `SettingsPanel.vue`(表单+预览)、`downloads.ts`(模板应用)、`format.ts` | 进行中 | 表单/变量预览已加入，后台使用模板命名 |
| R-SET-AUTO-001 | F-SET-BASE | U-SETTINGS | `SettingsPanel.vue`(autoScan/concurrency)、`downloads.ts`(并发调节) | 进行中 | 并发/自动扫描设置存储与消息更新 |
| R-ERR-HINT-001 | F-ERR-HINT | U-STATUS | `downloads.ts`(分类)、`downloadQueue.ts`(传递 errorCode)、`Image/Audio/VideoCapturePanel.vue`(徽章+提示) | 进行中 | 后台 errorCode 分类 + 前端错误类型徽章与解决建议；后续补重试策略与统一聚合 |

## 2. 开发任务列表（Backlog）

1. 视频清单与逐项控制（扫描、渲染、索引控制播放/暂停/抓帧）。
2. 图片清单（扫描 `<img>/<picture>/og:image`、缩略图、单/批下载）。
3. 批量下载队列（并发控制、进度条、失败重试、取消）。
4. 下载进度显示（监听 `downloads.onChanged` 并回传侧边栏）。
5. 设置面板增强（自动扫描、命名模板、默认封装/质量、并发上限）。
6. 音频识别增强（`preload`、`JSON-LD`、更多格式/来源）。
7. 失败回退策略统一化（DRM/CORS/403 提示与替代路径）。

## 3. 验收记录（示例）

- [ ] B站视频页：识别 1+ 视频，逐项控制正常，录制/抓帧成功保存。
- [ ] YouTube 视频页：识别视频+音频清单，能下载音频直链（如可得）。
- [ ] 图文页面（知乎）：识别图片清单，批量下载成功且命名正确。

## 4. V2 改进路线（功能 / 交互 / 视觉）

> 目标：在保持 MV3 兼容与性能可控的前提下，扩展“多类型精准抓取 + 智能语义处理 + 高效批量操作”能力，并统一交互与视觉规范。

### 4.1 功能改进 (Feature Enhancements)

| 功能ID | 名称 | 描述 | 代码模块(预期) | 优先级 | 状态 | 备注 |
|--------|------|------|---------------|--------|------|------|
| FE-TXT-EXTRACT-001 | 文字抽取 | 抽取正文、标题、副标题、标签、作者信息 | `content-scripts/text.ts`, `sidepanel/views/TextPanel.vue` | P0 | 未开始 | 支持多站点 DOM+结构化数据聚合 |
| FE-DATA-STRUCT-001 | 结构化数据抓取 | 解析 JSON-LD / microdata / meta | `content-scripts/meta.ts` | P1 | 未开始 | 统一数据模型供导出/AI 分析 |
| FE-INCR-SCAN-001 | 增量扫描 | 监听 DOM 变化自动更新资源清单 | `content-scripts/router.ts`(MutationObserver)、`messaging/index.ts`(RESOURCE_UPDATE)、`Video/Audio/ImagePanels`(消费更新) | P1 | 进行中 | 自动扫描推送 + 侧栏实时消费 |
| FE-BATCH-ACTION-001 | 批量操作执行 | 对选中资源执行批量下载/复制 | `sidepanel/services/batch.ts` | P0 | 未开始 | 与复选框选择联动 |
| FE-RETRY-STRATEGY-001 | 下载失败重试策略 | 基于错误类型分类重试/降级 | `downloads.ts`(自动重试),`downloadQueue.ts`(重试显示),`Image/Audio/VideoPanels`(状态标识) | P2 | 进行中 | NETWORK/INTERRUPTED 自动重试≤2次; 其他人工重试 |
| FE-AUDIO-EXTRACT-002 | 音频轨提取增强 | 支持从 HLS/DASH 中分离音频轨 | `content-scripts/media.ts` | P1 | 未开始 | 使用 MSE Track 信息 |
| FE-RECORD-TOGGLE-001 | 录制单按钮切换 | 用一个按钮表示录制状态与计时 | `VideoCapturePanel.vue` | P0 | 进行中 | 替换开始/停止双按钮 |
| FE-FRAME-MOVE-001 | 抓帧功能迁移 | 视频抓帧迁移至图片面板 | `ImageGrabPanel.vue` | P0 | 已完成 | UI 与状态持久化同步 |
| FE-DIRECT-DL-MERGE-001 | 下载按钮合并 | 去掉独立下载列并整合 | `VideoCapturePanel.vue` | P0 | 未开始 | 与操作列合并，留出批量位置 |
| FE-TEMPLATE-NAMING-001 | 文件命名模板 | 变量+预览+非法字符清理 | `services/naming.ts` | P1 | 进行中 | `{site,title,date,time,datetime,index}` 支持，后台重命名待处理任务 |
| FE-EXPORT-JSON-001 | 数据导出 | 将资源清单导出为 JSON/CSV | `services/export.ts` | P2 | 未开始 | 批量分析准备 |
| FE-LOCAL-DB-001 | 持久化缓存 | IndexedDB 缓存扫描结果与标记 | `services/storage.ts` | P2 | 未开始 | 减少重复扫描开销 |

### 4.2 交互体验 (Interaction & UX)

| 交互ID | 名称 | 描述 | 影响区域 | 优先级 | 状态 | 备注 |
|--------|------|------|---------|--------|------|------|
| UX-TABLE-SELECTION-001 | 视频表复选框 | 行选择+表头全选 | `VideoCapturePanel.vue` | P0 | 已完成 | 为批量操作打基础 |
| UX-MULTI-TAB-001 | 侧栏分组/标签页 | 按资源类型分标签页或折叠 | `SidePanelApp.vue` | P1 | 未开始 | 降低信息密度 |
| UX-KEYBOARD-SHORTCUT-001 | 快捷键体系 | 播放/录制/抓帧/全选快捷键 | 全局 | P2 | 未开始 | 可自定义映射 |
| UX-PROGRESS-OVERLAY-001 | 下载进度聚合 | 顶部统一进度条与剩余时间 | `GlobalDownloadBar.vue` | P1 | 进行中(增强) | 已接入：完成数/速率/剩余时间 + 错误统计 + 暂停/继续 + 重试失败 |
| UX-ERROR-TAXONOMY-001 | 错误分类提示 | 统一错误类型与解决建议 | 全局 | P1 | 进行中 | 已显示分类徽章；后续聚合与重试策略 |
| UX-INLINE-FILTER-001 | 行内筛选器 | 分辨率/时长/大小即时过滤 | 视频/图片面板 | P2 | 未开始 | 与存储持久化 |
| UX-INCR-HINT-001 | 增量变更提示 | 新增/失效资源高亮淡入淡出 | 各资源列表 | P2 | 进行中 | 已为图片/视频/音频面板实现新增高亮动画 |

### 4.3 视觉与一致性 (Visual & UI Consistency)

| 视觉ID | 名称 | 描述 | 影响组件 | 优先级 | 状态 | 备注 |
|--------|------|------|---------|--------|------|------|
| UI-COLOR-SYSTEM-001 | 颜色系统规范 | 定义主/辅/语义色与暗色方案 | `styles/` | P1 | 未开始 | Token + CSS vars |
| UI-TABLE-DENSITY-001 | 表格密度/间距 | 行高、内边距、字体统一 | BaseTable | P1 | 未开始 | 可切换紧凑模式 |
| UI-BUTTON-STATES-001 | 按钮状态一致性 | hover/active/disabled/loading 统一 | BaseButton | P1 | 未开始 | 语义颜色对齐 |
| UI-TYPOGRAPHY-001 | 字体层级系统 | 标题/正文/辅助/代码字号行高 | 全局 | P2 | 未开始 | 访问性对比度评估 |
| UI-ICONOGRAPHY-001 | 图标规范 | 操作统一使用矢量图标 | BaseButton/Icon | P2 | 未开始 | 加速识别效率 |
| UI-SPACING-GRID-001 | 间距栅格 | 统一 4/8/16 间距与布局栅格 | 布局/各面板 | P2 | 未开始 | 设计 Token 化 |
| UI-STATE-BADGES-001 | 状态徽标统一 | 录制/错误/完成/禁用样式统一 | 状态标记 | P1 | 未开始 | 颜色+图标组合 |

### 4.4 AI 集成 (智能化规划)

| AIID | 名称 | 描述 | 模块 | 优先级 | 状态 | 备注 |
|------|------|------|------|--------|------|------|
| AI-AUTO-TAG-001 | 自动标签 | 使用模型为资源生成标签 | `services/aiTag.ts` | P2 | 未开始 | 支持手动校正 |
| AI-SUMMARY-001 | 视频/文本摘要 | 生成短摘要与关键帧说明 | `services/aiSummary.ts` | P2 | 未开始 | 控制 token 预算 |
| AI-QUALITY-SCORE-001 | 质量/可读性评分 | 给文本/视频生成评分指标 | `services/aiScore.ts` | P3 | 未开始 | 指标配置可调 |
| AI-DATA-NORMALIZE-001 | 元数据规范化 | 模型辅助清洗站点差异字段 | `services/aiNormalize.ts` | P3 | 未开始 | 映射到统一结构 |

### 4.5 维护与工程 (Engineering)

| ENGID | 名称 | 描述 | 模块 | 优先级 | 状态 | 备注 |
|-------|------|------|------|--------|------|------|
| ENG-TEST-COVERAGE-001 | 单测覆盖率提升 | 关键服务/解析逻辑 70%+ 覆盖 | `tests/` | P1 | 未开始 | 先媒体解析和下载队列 |
| ENG-LINT-RULES-001 | ESLint/Prettier 细化 | 增加可访问性/复杂度限制规则 | 配置 | P2 | 未开始 | 保持风格统一 |
| ENG-PERF-BUNDLE-001 | 侧栏包体优化 | 拆分懒加载，减小初始体积 | 构建配置 | P2 | 已完成 | 异步组件+vendor 分包，首屏仅 ~0.56kB 入口 |
| ENG-STORAGE-ABSTRACTION-001 | 存储抽象统一 | IndexedDB + chrome.storage 封装 | `services/storage.ts` | P1 | 未开始 | 便于落地缓存策略 |
| ENG-DOC-AUTO-001 | 文档自动生成 | 基于注释生成 API/数据结构文档 | CI | P3 | 未开始 | 结合 Typedoc |

### 4.6 状态变更记录

| 变更时间 | 项 | 动作 | 说明 |
|----------|----|------|------|
| 2025-11-19 | FE-FRAME-MOVE-001 | 完成 | 抓帧 UI 从视频迁移至图片面板 |
| 2025-11-19 | UX-TABLE-SELECTION-001 | 完成 | 视频表增加复选框与全选 |
| 2025-11-19 | FE-RECORD-TOGGLE-001 | 完成 | 录制按钮合并为单一切换，动态标签与样式 |
| 2025-11-19 | FE-DIRECT-DL-MERGE-001 | 完成 | 下载列移除并整合到操作列 |
| 2025-11-19 | FE-AUDIO-EXTRACT-BASE-001 | 完成 | 基础音频提取（侧栏音频面板触发仅音轨录制） |
| 2025-11-19 | ENG-PERF-BUNDLE-001 | 完成 | SidePanel 异步 + vendor 拆分；入口 sidepanel.js 4.92kB，首屏加载体积显著下降 |
| 2025-11-19 | R-SET-NAME-001 | 开始 | 设置面板：命名模板字段与实时预览实现，后台接收 SETTINGS_UPDATE |
| 2025-11-19 | R-SET-AUTO-001 | 开始 | 设置面板：并发与自动扫描字段持久化并驱动后台并发调整 |
| 2025-11-19 | FE-TEMPLATE-NAMING-001 | 开始 | 建立命名变量服务与后台队列重命名逻辑 |
| 2025-11-19 | R-ERR-HINT-001 | 开始 | 后台加入错误分类 (errorCode) 与侧栏三面板错误徽章显示 |
| 2025-11-19 | FE-RETRY-STRATEGY-001 | 开始 | 引入自动重试策略（网络/中断 2 次），UI 显示重试计数 |
| 2025-11-19 | R-AUD-DET-001 | 进行中 | 扩展音频扫描：link preload + JSON-LD AudioObject/MusicRecording |
| 2025-11-19 | R-DL-PROG-001 | 进行中 | 新增 `GlobalDownloadBar.vue` 聚合进度/速率/ETA 显示 |
| 2025-11-19 | UX-PROGRESS-OVERLAY-001 | 开始 | 顶部全局下载进度条基础版本接入 |
| 2025-11-19 | FE-INCR-SCAN-001 | 进行中 | 引入 gatherResources 差异检测 + MutationObserver/History 自动推送 RESOURCE_UPDATE |
| 2025-11-19 | UX-INCR-HINT-001 | 开始 | 新增高亮动画应用于图片/视频/音频面板 (row-new + fade) |

> 更新流程：每次功能/交互/视觉改动合并后在对应表格更新“状态”字段，并追加一条“状态变更记录”行；禁止遗漏，以保障路线图透明。
