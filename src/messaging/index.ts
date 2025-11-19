/**
 * 消息协议定义（Content/Background/Sidepanel/Popup 通用）。
 * 注意：避免魔法字符串，统一从此处导入常量。
 */

export enum MessageType {
  // 握手
  PING = 'PING',
  PONG = 'PONG',
  // 功能开关
  ENABLE_FEATURES = 'ENABLE_FEATURES',
  // 设置更新
  SETTINGS_UPDATE = 'SETTINGS_UPDATE',
  // 音频
  REQUEST_AUDIO_LIST = 'REQUEST_AUDIO_LIST',
  // 图片
  REQUEST_IMAGE_LIST = 'REQUEST_IMAGE_LIST',
  START_DOWNLOAD = 'START_DOWNLOAD',
  // 视频基础
  GET_VIDEO_LIST = 'GET_VIDEO_LIST',
  CONTROL_VIDEO = 'CONTROL_VIDEO',
  START_RECORD_VIDEO = 'START_RECORD_VIDEO',
  STOP_RECORD_VIDEO = 'STOP_RECORD_VIDEO',
  VIDEO_RECORDING_STATUS = 'VIDEO_RECORDING_STATUS',
  VIDEO_PLAYBACK_STATUS = 'VIDEO_PLAYBACK_STATUS',
  REQUEST_VIDEO_SOURCES = 'REQUEST_VIDEO_SOURCES',
  DIRECT_VIDEO_DOWNLOAD = 'DIRECT_VIDEO_DOWNLOAD',
  // 下载队列扩展
  DOWNLOAD_QUEUE_ACTION = 'DOWNLOAD_QUEUE_ACTION',
  DOWNLOAD_QUEUE_SNAPSHOT = 'DOWNLOAD_QUEUE_SNAPSHOT',
  DOWNLOAD_PROGRESS_EVENT = 'DOWNLOAD_PROGRESS_EVENT'
  , RESOURCE_UPDATE = 'RESOURCE_UPDATE'
}

export interface PongMessage {
  type: MessageType.PONG;
  ok: true;
  version: string;
  capabilities: string[];
  adapterId?: string | null;
  frameId?: number;
}

export interface PingMessage {
  type: MessageType.PING;
}

export interface EnableFeaturesMessage {
  type: MessageType.ENABLE_FEATURES;
  payload: {
    video?: boolean;
    image?: boolean;
    audio?: boolean;
    playbackEvents?: boolean;
    spaWatchers?: boolean;
  };
}

export interface StartDownloadPayload {
  url: string;
  filename?: string;
}

export interface DownloadQueueActionMessage {
  type: MessageType.DOWNLOAD_QUEUE_ACTION;
  action: 'add' | 'cancel' | 'retry' | 'pause_all' | 'resume_all' | 'retry_failed_all';
  task?: { url: string; filename?: string; kind?: string };
  id?: string;
}

export interface DownloadProgressEventMessage {
  type: MessageType.DOWNLOAD_PROGRESS_EVENT;
  id: string;
  downloadId?: number;
  bytesReceived?: number;
  totalBytes?: number;
  state?: string;
  speedBps?: number;
  etaSeconds?: number;
  progress?: number;
  finished?: boolean;
  error?: string;
  errorCode?: string; // 统一错误枚举：DRM | CORS | PERMISSION | NO_RESOURCE | NETWORK | INTERRUPTED | UNKNOWN
}

export interface DownloadQueueSnapshotMessage {
  type: MessageType.DOWNLOAD_QUEUE_SNAPSHOT;
  tasks: Array<{
    id: string;
    url: string;
    fileName?: string;
    kind?: string;
    status: string;
    progress?: number;
    error?: string;
    downloadId?: number;
    bytesReceived?: number;
    totalBytes?: number;
    speedBps?: number;
    etaSeconds?: number;
    errorCode?: string;
    retries?: number;
  }>;
  paused?: boolean; // 队列是否被全局暂停
}

export interface AudioItemDTO {
  url: string;
  title?: string;
}

export interface ImageItemDTO {
  url: string;
  width?: number;
  height?: number;
  kind?: string; // img|source|background
}

export type VideoControlAction = 'play' | 'pause' | 'toggle';

export interface VideoSourceCandidate {
  url: string;
  label?: string;
  mimeType?: string;
  extension?: string;
}

export interface VideoItemDTO {
  index: number;
  src?: string;
  width?: number;
  height?: number;
  duration?: number;
  muted?: boolean;
  visible?: boolean;
  directSources?: VideoSourceCandidate[];
  directSourceCount?: number;
}

export interface VideoListResponse {
  success: boolean;
  error?: string;
  videos?: VideoItemDTO[];
}

export interface VideoRecordingStatusMessage {
  type: MessageType.VIDEO_RECORDING_STATUS;
  status: 'started' | 'completed' | 'error';
  index?: number;
  startedAt?: number;
  duration?: number;
  fileName?: string;
  error?: string;
  mode?: 'video' | 'audio';
}

export interface VideoPlaybackStatusMessage {
  type: MessageType.VIDEO_PLAYBACK_STATUS;
  index: number;
  playing: boolean;
}

export interface VideoSourcesResponse {
  sources: { url: string; mimeType?: string; extension?: string; size?: number; via?: string }[];
  meta?: Record<string, any>;
}

// ===== 设置更新 =====
export interface SettingsUpdateMessage {
  type: MessageType.SETTINGS_UPDATE;
  payload: {
    namingTemplate?: string;
    autoScan?: boolean;
    maxConcurrent?: number;
  };
}

export interface ResourceUpdateMessage {
  type: MessageType.RESOURCE_UPDATE;
  payload: {
    images?: { url: string; width?: number; height?: number; kind?: string }[];
    audio?: { url: string; title?: string }[];
    videos?: { index: number; src?: string; width?: number; height?: number; duration?: number; muted?: boolean; visible?: boolean }[];
  };
}
