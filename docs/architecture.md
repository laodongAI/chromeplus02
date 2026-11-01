# 系统架构设计 (System Architecture)

## 1. 架构概览
本项目基于 **Chrome Manifest V3** 标准，采用 **Vue 3** 构建侧边栏 UI，通过 **Message Passing** 机制与后台服务和内容脚本进行通信。

```mermaid
graph TD
    subgraph UI [Sidepanel (Vue 3)]
        Nav[Tab Navigation]
        VideoPanel[VideoCapturePanel]
        ImagePanel[ImageGrabPanel]
        AudioPanel[AudioGrabPanel]
        DownloadPanel[DownloadManagerPanel]
        SettingsPanel[SettingsPanel]
    end

    subgraph Background [Service Worker]
        MsgRouter[Message Router]
        Downloader[Download Manager]
        Storage[Chrome Storage]
    end

    subgraph Content [Content Scripts]
        Router[Event Router]
        Sniffer[Media Sniffer]
        Recorder[Media Recorder]
        Capture[Frame Capture]
    end

    Nav --> VideoPanel
    Nav --> ImagePanel
    Nav --> AudioPanel
    Nav --> DownloadPanel
    Nav --> SettingsPanel

    VideoPanel <-->|Msg: GET_VIDEO_LIST / START_RECORD| Content
    ImagePanel <-->|Msg: REQUEST_IMAGE_LIST| Content
    AudioPanel <-->|Msg: REQUEST_AUDIO_LIST| Content
    
    UI <-->|Msg: DOWNLOAD_ACTION| Background
    Content -->|DOM Events| WebPage[Web Page]
```

## 2. 模块详细设计

### 2.1 视频采集模块 (Video Module)
*   **视图组件**: `src/sidepanel/views/VideoCapturePanel.vue`
*   **核心服务**: `src/sidepanel/services/videoSources.ts`
*   **通信协议**:
    *   发送 `GET_VIDEO_LIST` 获取视频数据。
    *   发送 `START_RECORD_VIDEO` / `STOP_RECORD_VIDEO` 控制录制。
    *   接收 `VIDEO_RECORDING_STATUS` 更新 UI 状态。
*   **数据流**: Content Script 扫描 DOM -> 返回 `VideoItemDTO[]` -> Vue 渲染列表 -> 用户操作 -> 发送指令 -> Content Script 执行。

### 2.2 图像抓取模块 (Image Module)
*   **视图组件**: `src/sidepanel/views/ImageGrabPanel.vue`
*   **核心服务**: `src/sidepanel/services/frameCapture.ts`
*   **功能逻辑**:
    *   **静态扫描**: 发送 `REQUEST_IMAGE_LIST` 获取页面图片。
    *   **动态抓帧**: 前端定时器 (`setInterval`) -> 调用 `captureVisibleTab` 或发送指令截取 `<video>` 画面 -> 生成 Base64/Blob -> 添加到列表。
    *   **懒加载**: 使用 `IntersectionObserver` 监听列表滚动，按需加载图片预览。

### 2.3 音频抓取模块 (Audio Module)
*   **视图组件**: `src/sidepanel/views/AudioGrabPanel.vue`
*   **核心服务**: 无独立服务文件，逻辑内聚于组件。
*   **功能逻辑**:
    *   **扫描**: 发送 `REQUEST_AUDIO_LIST`。
    *   **内录**: 利用 `chrome.tabCapture` (如果可用) 或 Content Script 中的 `MediaRecorder` 录制音频流。

### 2.4 下载管理模块 (Download Module)
*   **视图组件**: `src/sidepanel/views/DownloadManagerPanel.vue`
*   **核心服务**: 
    *   `src/sidepanel/services/downloadQueue.ts`: 内存中的下载队列管理。
    *   `src/sidepanel/services/downloadHistory.ts`: 基于 `chrome.storage` 的持久化历史记录。
    *   `src/background/downloads.ts`: 实际调用 `chrome.downloads` API 的后台逻辑。

### 2.5 设置模块 (Settings Module)
*   **视图组件**: `src/sidepanel/views/SettingsPanel.vue`
*   **核心服务**: `src/sidepanel/services/settings.ts`
*   **持久化**: 自动同步 `ExtensionSettings` 对象到 `chrome.storage.sync`。

## 3. 关键技术点

### 3.1 跨 Frame 通信
由于现代网页常使用 `iframe` 嵌套视频，系统实现了 `frameId` 识别机制。
*   **Sidepanel**: 获取所有 Frame 列表 (`getAllFramesInfo`)。
*   **Messaging**: 发送消息时指定 `{ frameId: targetId }`，确保指令准确送达目标 iframe 中的 Content Script。

### 3.2 智能录制状态同步
为了实现“视频暂停即暂停录制” (FR-04)，Content Script 维护了 `ActiveRecording` 状态机，并监听 DOM 元素的 `play`, `pause`, `ended` 事件，实时同步 `MediaRecorder` 的状态。

### 3.3 资源去重与高亮
*   **去重**: 使用 URL 或感知哈希 (pHash) 生成唯一 Key (`useMediaRegistry.ts`)。
*   **高亮**: 使用 `useRowHighlight` Composable，对比新旧列表，为新增资源添加短暂的高亮动画。
