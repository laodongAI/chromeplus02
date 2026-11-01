# 内部 API 参考 (Internal API Reference)

本文档描述了各模块使用的内部消息协议。

## 1. 视频模块消息

*   **`GET_VIDEO_LIST`**
    *   **Payload**: 无
    *   **Response**: `{ items: VideoItemDTO[] }`
    *   **用途**: 获取当前 Frame 的视频列表。

*   **`START_RECORD_VIDEO`**
    *   **Payload**: `{ index: number }`
    *   **用途**: 开始录制指定索引的视频。

*   **`STOP_RECORD_VIDEO`**
    *   **Payload**: `{ index: number }`
    *   **用途**: 停止录制并触发下载。

*   **`VIDEO_RECORDING_STATUS`** (Event)
    *   **Payload**: `{ index: number, status: 'started'|'completed'|'error', error?: string }`
    *   **用途**: Content Script 向 Sidepanel 广播录制状态。

## 2. 图像模块消息

*   **`REQUEST_IMAGE_LIST`**
    *   **Payload**: 无
    *   **Response**: `{ items: { url: string, width: number, height: number }[] }`
    *   **用途**: 获取页面图片资源。

## 3. 音频模块消息

*   **`REQUEST_AUDIO_LIST`**
    *   **Payload**: 无
    *   **Response**: `{ items: AudioItemDTO[] }`
    *   **用途**: 获取页面音频资源。

## 4. 通用/系统消息

*   **`ENABLE_FEATURES`**
    *   **Payload**: `{ video?: boolean, audio?: boolean, image?: boolean }`
    *   **用途**: 激活 Content Script 中特定的嗅探器模块。

*   **`CHECK_MCP_SERVICE`**
    *   **Payload**: 无
    *   **Response**: `{ available: boolean }`
    *   **用途**: 检查本地 MCP 服务状态。
