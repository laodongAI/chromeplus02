/**
 * 侧边栏与内容脚本/后台的统一消息协议 (MV3)。
 * 根据旧版 JS 功能补齐必要类型，避免在迁移阶段出现 any 泄漏。
 */

export enum MessageType {
  PING = 'PING',
  // 视频
  GET_VIDEO_LIST = 'GET_VIDEO_LIST',
  CONTROL_VIDEO = 'CONTROL_VIDEO',
  START_RECORD_VIDEO = 'START_RECORD_VIDEO',
  STOP_RECORD_VIDEO = 'STOP_RECORD_VIDEO',
  VIDEO_RECORDING_STATUS = 'VIDEO_RECORDING_STATUS',
  VIDEO_PLAYBACK_STATUS = 'VIDEO_PLAYBACK_STATUS',
  REQUEST_VIDEO_SOURCES = 'REQUEST_VIDEO_SOURCES',
  // 音频
  REQUEST_AUDIO_LIST = 'REQUEST_AUDIO_LIST',
  START_AUDIO_RECORD = 'START_AUDIO_RECORD',
  STOP_AUDIO_RECORD = 'STOP_AUDIO_RECORD',
  // 下载
  START_DOWNLOAD = 'START_DOWNLOAD',
  DIRECT_VIDEO_DOWNLOAD = 'DIRECT_VIDEO_DOWNLOAD',
  DOWNLOAD_QUEUE_SNAPSHOT = 'DOWNLOAD_QUEUE_SNAPSHOT',
  DOWNLOAD_PROGRESS_EVENT = 'DOWNLOAD_PROGRESS_EVENT',
  DOWNLOAD_QUEUE_ACTION = 'DOWNLOAD_QUEUE_ACTION'
}

export interface BaseMessage<T extends MessageType, P = unknown> {
  type: T;
  payload?: P;
}

// ========== 视频相关 ==========
export interface VideoItemDTO {
  index: number;
  src?: string;
  width?: number;
  height?: number;
  duration?: number;
  visible?: boolean;
  muted?: boolean;
  directSourceCount?: number;
  directSources?: { url: string; mimeType?: string; extension?: string }[];
}

export interface VideoListResponse {
  success: boolean;
  error?: string;
  videos?: VideoItemDTO[];
}

export type VideoControlAction = 'play' | 'pause' | 'toggle';

export interface VideoRecordingStatusMessage extends BaseMessage<MessageType.VIDEO_RECORDING_STATUS> {
  index: number;
  status: 'started' | 'completed' | 'error';
  mode?: 'video' | 'audio';
  startedAt?: number;
  fileName?: string;
  error?: string;
}

export interface VideoPlaybackStatusMessage extends BaseMessage<MessageType.VIDEO_PLAYBACK_STATUS> {
  index: number;
  playing: boolean;
}

// ========== 音频相关 ==========
export interface AudioItemDTO {
  url: string;
  title?: string;
}

export interface AudioListResponse {
  success: boolean;
  error?: string;
  items?: AudioItemDTO[];
}

// ========== 下载 ==========
export interface StartDownloadPayload {
  url: string;
  filename: string;
}

// 下载队列动作
export interface DownloadQueueActionMessage extends BaseMessage<MessageType.DOWNLOAD_QUEUE_ACTION> {
  action: 'add' | 'cancel' | 'retry';
  task?: { url: string; filename?: string; kind?: string };
  id?: string; // 取消/重试目标
}

export interface DownloadProgressEventMessage extends BaseMessage<MessageType.DOWNLOAD_PROGRESS_EVENT> {
  id: string; // 队列内部任务 id
  downloadId?: number;
  bytesReceived?: number;
  totalBytes?: number;
  state?: string;
  speedBps?: number;
  etaSeconds?: number;
  progress?: number;
  finished?: boolean;
  error?: string;
}

export interface DownloadQueueSnapshotMessage extends BaseMessage<MessageType.DOWNLOAD_QUEUE_SNAPSHOT> {
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
  }>;
}

export interface VideoSourceItem {
  url: string;
  mimeType?: string;
  extension?: string;
  size?: number;
  via?: string; // network | dom
}

export interface VideoSourcesResponse {
  sources: VideoSourceItem[];
  meta?: Record<string, any>;
}

// ========== Ping ==========
export interface PingMessage extends BaseMessage<MessageType.PING> {
  payload: { time: number };
}

export type AnyMessage =
  | PingMessage
  | VideoRecordingStatusMessage;

// 类型守卫（示例）
export function isVideoRecordingStatusMessage(m: unknown): m is VideoRecordingStatusMessage {
  return !!m && (m as any).type === MessageType.VIDEO_RECORDING_STATUS;
}
