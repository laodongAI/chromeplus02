# 任务跟踪与需求-设计-代码映射

> 本表用于跟踪开发进度，并建立“需求 → 设计/UI → 代码模块”的双向映射，保证实现闭环。已对重复/重叠任务进行合并，避免状态漂移。

## 1. 需求与映射表

| 需求ID | 功能项ID | UI项ID | 代码模块 | 状态 | 备注 |
|---|---|---|---|---|---|
| R-VID-DET-001 | F-VID-LIST | U-VID-LIST | `router.ts`(稳定索引扫描)、`VideoCapturePanel.vue`(渲染) | 已完成(增强) | WeakMap 稳定 ID，避免 DOM 重排索引漂移 |
| R-AUD-DET-001 | F-AUD-LIST | U-AUD-LIST | `audio.ts`(扫描增强)、`AudioGrabPanel.vue`(列表/下载) | 已完成(增强) | 支持 preload/link/JSON-LD AudioObject/MusicRecording 解析与去重 |
| R-IMG-DET-001 | F-IMG-LIST | U-IMG-LIST | `images.ts`(扫描)、`ImageGrabPanel.vue`(渲染/下载) | 已完成(基础) | 支持 `<img>/<picture>/background/og:image/twitter:image` |
| R-VID-CTRL-001 | F-VID-CTRL | U-VID-ITEM | `router.ts`(稳定控制)、`VideoCapturePanel.vue`(按钮) | 已完成(增强) | 控制使用稳定 ID；播放/暂停合并为动态按钮 |
| R-VID-REC-001 | F-VID-REC | U-VID-ITEM | `sidepanel.js`(录制/仅音轨) | 已完成(基础) | 支持视频+音频录制与仅音轨录制，状态展示待补 |
| R-VID-FRAME-001 | F-VID-FRAME | U-VID-ITEM | `sidepanel.js`(抓帧)、`content_script.js`(画布) | 已完成(基础) | 已支持抓帧与截图，失败回退/命名模板待补 |
| R-DL-LIST-001 | F-DL-BATCH | U-BATCH | `downloads.ts`(后台队列)、`downloadQueue.ts`(订阅 UI) | 已完成 | 并发控制+任务快照+进度事件稳定运行 |
| DL-PROGRESS-AGG-001 | F-DL-PROG | U-STATUS | `downloads.ts`(监听广播)+`GlobalDownloadBar.vue`(聚合)+`Video/Audio/ImagePanel`(展示) | 已完成(增强) | 合并原 R-DL-PROG-001 与 UX-PROGRESS-OVERLAY-001：进度/速率/ETA/错误统计/暂停/继续/重试 |
| SET-NAMING-TEMPLATE-001 | F-SET-NAME | U-SETTINGS | `SettingsPanel.vue`(表单+预览+保存/重置)、`downloads.ts`(模板应用)、`format.ts` | 已完成(增强) | 合并原 R-SET-NAME-001 与 FE-TEMPLATE-NAMING-001；后台既有队列任务重命名待实现 |
| R-SET-AUTO-001 | F-SET-BASE | U-SETTINGS | `SettingsPanel.vue`(autoScan/concurrency)、`downloads.ts`(并发调节)、`settings.ts` | 已完成 | 自动扫描与并发上限持久化+消息驱动后台刷新 |
| DL-ERROR-RECOVERY-001 | F-ERR-HINT | U-STATUS | `downloads.ts`(分类+自动重试)、`downloadQueue.ts`(errorCode+重试计数)、`Image/Audio/VideoCapturePanel.vue`(ErrorBadge) | 已完成(基础) | 合并原 R-ERR-HINT-001 与 FE-RETRY-STRATEGY-001；剩余：聚合视图/高级重试策略/错误过滤 |

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
| FE-TXT-EXTRACT-001 | 文字抽取 | 抽取正文、标题、副标题、标签、作者信息 | `content-scripts/text.ts`, `sidepanel/views/TextPanel.vue` | P0 | 已完成(基础) | 支持多站点 DOM+结构化数据聚合，已集成至侧边栏 |
| FE-DATA-STRUCT-001 | 结构化数据抓取 | 解析 JSON-LD / microdata / meta | `content-scripts/meta.ts` | P1 | 未开始 | 统一数据模型供导出/AI 分析 |
| FE-INCR-SCAN-001 | 增量扫描 | 监听 DOM 变化自动更新资源清单 | `content-scripts/router.ts`(MutationObserver)、`messaging/index.ts`(RESOURCE_UPDATE)、`Video/Audio/ImagePanels`(消费更新) | P1 | 进行中 | 自动扫描推送 + 侧栏实时消费 |
| FE-BATCH-ACTION-001 | 批量操作执行 | 对选中资源执行批量下载/复制 | `sidepanel/services/batch.ts` | P0 | 未开始 | 与复选框选择联动 |
| DL-ERROR-RECOVERY-001 | 下载错误分类与恢复 | 分类+提示+自动/人工重试整合 | `downloads.ts`,`downloadQueue.ts`,`Image/Audio/VideoPanels` | P2 | 进行中(增强) | 已实现分类+网络/中断自动重试；待补：失败聚合统计与策略配置 |
| FE-AUDIO-EXTRACT-002 | 音频轨提取增强 | 支持从 HLS/DASH 中分离音频轨 | `content-scripts/media.ts` | P1 | 未开始 | 使用 MSE Track 信息 |
| FE-RECORD-TOGGLE-001 | 录制单按钮切换 | 用一个按钮表示录制状态与计时 | `VideoCapturePanel.vue` | P0 | 已完成 | 已合并开始/停止为单按钮 + 基础时长展示 |
| FE-FRAME-MOVE-001 | 抓帧功能迁移 | 视频抓帧迁移至图片面板 | `ImageGrabPanel.vue` | P0 | 已完成 | UI 与状态持久化同步 |
| FE-DIRECT-DL-MERGE-001 | 下载按钮合并 | 去掉独立下载列并整合 | `VideoCapturePanel.vue` | P0 | 已完成 | 已整合至操作列 |
| SET-NAMING-TEMPLATE-001 | 文件命名模板体系 | 变量/预览/非法字符/后台重命名 | `SettingsPanel.vue`,`downloads.ts`,`format.ts`,`services/naming.ts` | P1 | 已完成 | 前后端均已实现，支持动态重命名队列任务 |
| FE-EXPORT-JSON-001 | 数据导出 | 将资源清单导出为 JSON/CSV | `services/export.ts` | P2 | 未开始 | 批量分析准备 |
| FE-LOCAL-DB-001 | 持久化缓存 | IndexedDB 缓存扫描结果与标记 | `services/storage.ts` | P2 | 未开始 | 减少重复扫描开销 |
| FE-TASK-CENTER-001 | 统一任务中心 | 全局下载/录制任务管理面板 | `sidepanel/views/TaskCenter.vue` | P1 | 未开始 | 解决任务分散问题 |
| FE-SMART-FALLBACK-001 | 智能兜底策略 | 失败自动转录制/自动模式提示 | `VideoCapturePanel.vue` | P2 | 未开始 | 提升成功率 |
| FE-COLLECTION-BASKET-001 | 资源暂存区 | 跨页面资源收集篮 | `services/collection.ts` | P2 | 未开始 | 批量操作增强 |

### 4.2 交互体验 (Interaction & UX)

| 交互ID | 名称 | 描述 | 影响区域 | 优先级 | 状态 | 备注 |
|--------|------|------|---------|--------|------|------|
| UX-TABLE-SELECTION-001 | 视频表复选框 | 行选择+表头全选 | `VideoCapturePanel.vue` | P0 | 已完成 | 为批量操作打基础 |
| UX-MULTI-TAB-001 | 侧栏分组/标签页 | 按资源类型分标签页或折叠 | `SidePanelApp.vue` | P1 | 未开始 | 降低信息密度 |
| UX-KEYBOARD-SHORTCUT-001 | 快捷键体系 | 播放/录制/抓帧/全选快捷键 | 全局 | P2 | 未开始 | 可自定义映射 |
| （合并至 DL-PROGRESS-AGG-001） | 下载进度聚合 | 顶部统一进度条与剩余时间 | `GlobalDownloadBar.vue` | P1 | 已合并 | 参见 DL-PROGRESS-AGG-001 |
| UX-ERROR-TAXONOMY-001 | 错误分类提示 | 统一错误类型与解决建议 | 全局 | P1 | 已完成(基础) | 分类+徽章完成；剩余：与重试次数聚合统计、全局错误过滤/跳转 |
| UX-INLINE-FILTER-001 | 行内筛选器 | 分辨率/时长/大小即时过滤 | 视频/图片面板 | P2 | 未开始 | 与存储持久化 |
| UX-INCR-HINT-001 | 增量变更提示 | 新增/失效资源高亮淡入淡出 | 各资源列表 | P2 | 进行中(增强) | 已封装 useRowHighlight；剩余：失效/移除淡出动画 + TTL/颜色可配置 |
| UX-QUEUE-DISPLAY-001 | 悬浮/抽屉式队列 | 优化下载队列展示，避免挤占列表 | `components/DownloadDrawer.vue` | P1 | 未开始 | 解决空间冲突 |
| UX-REC-INDICATOR-001 | 全局录制感知 | 扩展图标/顶部红点提示录制中 | `GlobalStatusBar.vue` | P1 | 未开始 | 防止误关页面 |
| UX-EMPTY-GUIDE-001 | 空状态引导 | 丰富空状态下的操作指引/演示 | 各面板 Empty Slot | P2 | 未开始 | 提升新手体验 |

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
| UI-SEARCH-HINT-STD-001 | 搜索提示规范 | 统一三面板搜索占位与快捷键提示文案 | Video/Image/Audio Panels | P1 | 已完成 | 占位与提示文案统一，使用全局 hint 常量 |
| UI-SEARCH-COMP-EXTRACT-001 | 搜索栏组件抽取 | 抽取 BaseSearchBar 组件统一样式/宽度/布局 | BaseSearchBar | P1 | 已完成 | 封装输入+hint slot+禁用态，三面板已集成 |
| UI-SHORTCUT-HELP-001 | 快捷键提示展现 | 统一快捷键提示位置与可配置显隐 | 全局 | P2 | 已完成 | SettingsPanel 开关 + 面板监听 SETTINGS_UPDATE 动态更新 |
| UI-SHORTCUT-CUSTOM-001 | 快捷键自定义能力 | 预留用户自定义映射与重置默认 | useListSearch/SettingsPanel | P2 | 未开始 | 保存至持久化设置 |
| UI-SHORTCUT-HELP-TOGGLE-001 | 快捷键提示显隐开关 | 设置中控制各面板搜索栏快捷键提示显示 | SettingsPanel, Video/Image/Audio Panels | P2 | 已完成 | chrome.storage 持久化 + SETTINGS_UPDATE 动态应用 |
| UI-TOOLBAR-STD-001 | 标准化工具栏 | 封装 FilterToolbar 统一搜索/筛选 | `components/base/FilterToolbar.vue` | P1 | 未开始 | 减少重复代码 |
| UI-ROW-OPTIMIZE-001 | 列表行视觉降噪 | 优化信息层级，折叠次要操作 | `SelectionTable` slots | P2 | 未开始 | 提升阅读效率 |

### 4.4 AI 集成 (智能化规划)

| AIID | 名称 | 描述 | 模块 | 优先级 | 状态 | 备注 |
|------|------|------|------|--------|------|------|
| AI-AUTO-TAG-001 | 自动标签 | 使用模型为资源生成标签 | `services/aiTag.ts` | P2 | 未开始 | 支持手动校正 |
| AI-SUMMARY-001 | 视频/文本摘要 | 生成短摘要与关键帧说明 | `services/aiSummary.ts` | P2 | 未开始 | 控制 token 预算 |
| AI-QUALITY-SCORE-001 | 质量/可读性评分 | 给文本/视频生成评分指标 | `services/aiScore.ts` | P3 | 未开始 | 指标配置可调 |
| AI-DATA-NORMALIZE-001 | 元数据规范化 | 模型辅助清洗站点差异字段 | `services/aiNormalize.ts` | P3 | 未开始 | 映射到统一结构 |

### 4.5 文档工程 (Documentation)

| 文档ID | 名称 | 描述 | 对应文件 | 状态 | 备注 |
|--------|------|------|---------|------|------|
| DOC-REQ-001 | 需求规格说明书 | 基于 UI 模块反向生成的详细需求文档 | `docs/requirements.md` | 已完成 | 包含输入/控件与逻辑描述 |
| DOC-ARCH-001 | 架构设计文档 | 系统架构、数据流与组件关系图 | `docs/architecture.md` | 已完成 | 包含 Mermaid 图表 |
| DOC-TRACE-001 | 需求追踪矩阵 | UI 控件 -> 设计模块 -> 代码文件的映射 | `docs/traceability.md` | 已完成 | 确保实现闭环 |
| DOC-API-001 | API 参考文档 | 内部消息通信协议与接口定义 | `docs/api-reference.md` | 已完成 | 消息类型与 Payload 定义 |

### 4.6 状态变更记录

| 变更时间 | 项 | 动作 | 说明 |
|----------|----|------|------|
| 2025-11-19 | FE-FRAME-MOVE-001 | 完成 | 抓帧 UI 从视频迁移至图片面板 |
| 2025-11-19 | UX-TABLE-SELECTION-001 | 完成 | 视频表增加复选框与全选 |
| 2025-11-19 | FE-RECORD-TOGGLE-001 | 完成 | 录制按钮合并为单一切换，动态标签与样式 |
| 2025-11-19 | FE-DIRECT-DL-MERGE-001 | 完成 | 下载列移除并整合到操作列 |
| 2025-11-19 | FE-AUDIO-EXTRACT-BASE-001 | 完成 | 基础音频提取（侧栏音频面板触发仅音轨录制） |
| 2025-11-19 | ENG-PERF-BUNDLE-001 | 完成 | SidePanel 异步 + vendor 拆分；入口 sidepanel.js 4.92kB，首屏加载体积显著下降 |
| 2025-11-19 | DL-ERROR-RECOVERY-001 | 合并 | 整合错误分类 + 自动/人工重试；网络/中断自动重试 2 次 + ErrorBadge 展示 |
| 2025-11-19 | DL-PROGRESS-AGG-001 | 合并 | 整合原 R-DL-PROG-001 与 UX-PROGRESS-OVERLAY-001：聚合条与顶部进度统一 |
| 2025-11-19 | SET-NAMING-TEMPLATE-001 | 合并 | 统一命名模板体系：前端保存/预览完成 + 后台待实现重命名逻辑 |
| 2025-11-19 | R-AUD-DET-001 | 完成 | 扩展音频扫描：支持 link preload 和 JSON-LD AudioObject/MusicRecording 的解析与去重 |
| 2025-11-19 | FE-INCR-SCAN-001 | 已完成(批处理增强) | 增量扫描 + 350ms 聚合节流 + diff added/removed TTL 高亮 |
| 2025-11-19 | UX-KEYBOARD-SHORTCUT-001 | 已完成(初版) | 视频/图片/音频面板统一快捷键：Ctrl+A/D/F/Shift+I/N/R |
| 2025-11-19 | UX-INLINE-FILTER-001 | 进行中 | 三面板已加入搜索框（视频 host/path、图片 URL/哈希、音频 标题/URL）；后续抽象 composable 与高级过滤 |
| 2025-11-19 | UX-INCR-HINT-001 | 开始 | 新增高亮动画应用于图片/视频/音频面板 (row-new + fade) |
| 2025-11-19 | UX-INCR-HINT-001 | 增强 | 封装 useRowHighlight 统一新增行高亮逻辑与 TTL，便于后续失效/移除动画扩展 |
| 2025-11-19 | R-DL-LIST-001 | 完成 | 实现中央并发控制、任务快照和进度事件 |
| 2025-11-19 | DL-PROGRESS-AGG-001 | 完成 | 聚合条增强：进度百分比+速率+ETA+错误统计+暂停/继续+失败重试（统一来源） |
| 2025-11-19 | SET-NAMING-TEMPLATE-001 | 完成 | 命名模板支持自动/立即保存与重置默认；后台重命名剩余待实现 |
| 2025-11-19 | R-SET-AUTO-001 | 完成 | 设置面板：并发与自动扫描参数持久化并消息通知后台 |
| 2025-11-19 | UI-SEARCH-COMP-EXTRACT-001 | 开始 | 抽取 BaseSearchBar 统一样式与快捷键提示，占位文本规范化 |
| 2025-11-19 | UI-SEARCH-HINT-STD-001 | 开始 | 三面板快捷键提示与占位统一，准备设置面板显隐开关 |
| 2025-11-19 | UI-SEARCH-COMP-EXTRACT-001 | 完成 | BaseSearchBar 在视频/图片/音频三面板落地，统一输入与提示区域 |
| 2025-11-19 | UI-SEARCH-HINT-STD-001 | 完成 | 统一占位与快捷键提示文案，集中常量管理 |
| 2025-11-19 | UI-SHORTCUT-HELP-TOGGLE-001 | 完成 | SettingsPanel 增加“显示快捷键提示”开关，持久化并向各面板广播 SETTINGS_UPDATE |
| 2025-11-20 | UI-VID-CTRL-MERGE-001 | 完成 | 视频控制：合并播放/暂停为单一动态按钮，移除切换功能 |

> 更新流程：每次功能/交互/视觉改动合并后在对应表格更新“状态”字段，并追加一条“状态变更记录”行；合并任务需在备注注明来源，禁止遗漏，保障路线图透明。已于 2025-11-19 补充快捷键与搜索功能进度。
