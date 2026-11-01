# 需求-设计-代码 追踪矩阵 (Traceability Matrix)

本文档以 UI 模块为维度，建立需求、设计与代码的映射关系。

## 1. 视频采集模块 (Video Tab)

| 需求功能 | UI 控件 | 设计模块 | 关键代码文件 |
| :--- | :--- | :--- | :--- |
| **视频扫描** | 按钮 `重新扫描` | VideoSource Service | `src/sidepanel/views/VideoCapturePanel.vue`<br>`src/sidepanel/services/videoSources.ts` |
| **视频录制** | 按钮 `录制`/`停止` | Content Recorder | `src/content-scripts/router.ts` (startRecordVideo)<br>`src/content-scripts/main.ts` |
| **批量控制** | 按钮 `批量录制`/`停止所有` | Batch Logic | `src/sidepanel/views/VideoCapturePanel.vue` (startRecordAll) |
| **Frame 选择** | 下拉框 `frame-select` | Frame Messaging | `src/sidepanel/views/VideoCapturePanel.vue`<br>`src/utils/chromeMessaging.ts` |

## 2. 图像抓取模块 (Image Tab)

| 需求功能 | UI 控件 | 设计模块 | 关键代码文件 |
| :--- | :--- | :--- | :--- |
| **图片扫描** | 按钮 `重新扫描` | Image Sniffer | `src/sidepanel/views/ImageGrabPanel.vue`<br>`src/content-scripts/images.ts` |
| **定时抓帧** | 按钮 `开始抓帧` | Frame Capture | `src/sidepanel/services/frameCapture.ts`<br>`src/sidepanel/views/ImageGrabPanel.vue` |
| **懒加载预览** | 图片列表 | IntersectionObserver | `src/sidepanel/views/ImageGrabPanel.vue` (ensureObserver) |
| **批量下载** | 按钮 `批量下载` | Download Queue | `src/sidepanel/views/ImageGrabPanel.vue`<br>`src/sidepanel/services/downloadQueue.ts` |

## 3. 音频抓取模块 (Audio Tab)

| 需求功能 | UI 控件 | 设计模块 | 关键代码文件 |
| :--- | :--- | :--- | :--- |
| **音频扫描** | 按钮 `重新扫描` | Audio Sniffer | `src/sidepanel/views/AudioGrabPanel.vue`<br>`src/content-scripts/audio.ts` |
| **音频内录** | 按钮 `提取音频` | Audio Recorder | `src/sidepanel/views/AudioGrabPanel.vue`<br>`src/content-scripts/router.ts` |

## 4. 下载管理模块 (Downloads Tab)

| 需求功能 | UI 控件 | 设计模块 | 关键代码文件 |
| :--- | :--- | :--- | :--- |
| **历史记录** | 列表视图 | History Service | `src/sidepanel/views/DownloadManagerPanel.vue`<br>`src/sidepanel/services/downloadHistory.ts` |
| **任务重试** | 按钮 `重试` | Queue Service | `src/sidepanel/services/downloadQueue.ts` |

## 5. 系统设置模块 (Settings Tab)

| 需求功能 | UI 控件 | 设计模块 | 关键代码文件 |
| :--- | :--- | :--- | :--- |
| **配置保存** | 表单输入 | Settings Service | `src/sidepanel/views/SettingsPanel.vue`<br>`src/sidepanel/services/settings.ts` |
| **文件名预览** | 预览文本 | Format Utils | `src/utils/format.ts` (formatFilename) |
