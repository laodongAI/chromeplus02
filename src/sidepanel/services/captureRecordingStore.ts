/**
 * 页面录制成果存储（侧栏上下文）。
 *
 * 背景（用户反馈「录制的视频/音频下载后播放不了、无法点击查看」）：
 *  - 内容脚本录制完成后把产物分块交接后台，后台落 IndexedDB 并写元数据
 *    （见 background/captureRecording.ts）；
 *  - 本 store 在侧栏侧消费：监听就绪广播刷新列表、按 IDB 键取回 Blob 建
 *    object URL（供试听/编辑器预览）、转码下载（视频→MP4、音频→M4A，
 *    全播放器兼容；环境不支持 WebCodecs 时回退原样 webm 下载）、删除。
 *
 * 说明：
 *  - 元数据列表存 chrome.storage.local（SW 与侧栏共享），侧栏打开即恢复；
 *  - object URL 按 recordId 缓存，删除时统一 revoke，防内存泄漏。
 */

import { ref } from 'vue';
import { MessageType, type CaptureRecordingMeta } from '@/messaging';
import { idbDelete, idbGet, STORE_HLS_BLOBS } from '@/shared/blobStore';
// IDB 键前缀与后台保持单一来源（侧栏不硬编码前缀字符串）
import { CAPREC_IDB_PREFIX, CAPREC_META_STORAGE_KEY } from '@/background/captureRecording';
// 转码核心：webm→MP4 / webm→M4A（WebCodecs；不支持时回退）
import { canConvertMedia, convertAudioBlobToM4a, convertVideoBlobToMp4, triggerBlobDownload } from '@/core/mediaConvert';
// 编辑器启动（与录屏面板共用同一实现）
import { openClipsInEditor } from '../utils/editorLauncher';
import { toast } from '../composables/useToast';
// 分级日志（扩展页面上下文默认 info 级）
import { createLogger } from '@/utils/logger';

/** 本模块 logger：统一 `[captureRecordings]` 前缀 */
const log = createLogger('captureRecordings');

/** 已就绪的录制成果列表（最新在前；元数据口径，Blob 按需从 IDB 取） */
export const captureRecordings = ref<CaptureRecordingMeta[]>([]);

/** object URL 缓存（recordId → blob: URL；删除/重复取用时复用） */
const blobUrlCache = new Map<string, string>();

/** 就绪广播监听是否已安装（模块级单例，防多面板重复注册） */
let readyListenerInstalled = false;

/**
 * 从 storage.local 加载元数据列表（侧栏打开时调用；后台写入、侧栏只读）。
 */
export async function loadCaptureRecordings(): Promise<void> {
  try {
    const obj = await chrome.storage.local.get(CAPREC_META_STORAGE_KEY) as Record<string, unknown>;
    const list = obj[CAPREC_META_STORAGE_KEY];
    captureRecordings.value = Array.isArray(list) ? (list as CaptureRecordingMeta[]) : [];
    log.debug(`录制成果列表已加载：${captureRecordings.value.length} 条`);
  } catch (e) {
    log.warn('加载录制成果列表失败', e);
  }
}

/**
 * 安装就绪广播监听（CAPTURE_RECORDING_READY → 刷新列表 + 轻提示）。
 * 幂等：重复调用只注册一次。
 * 非扩展运行环境（如本地预览页无 chrome.runtime）直接跳过，
 * 与 downloadQueue / hlsBlobDownload 同款守卫，避免启动即抛 TypeError。
 */
export function installCaptureRecordingListener(): void {
  if (readyListenerInstalled) return;
  readyListenerInstalled = true;
  if (!chrome?.runtime?.onMessage?.addListener) {
    log.debug('非扩展运行环境（chrome.runtime 不可用），跳过录制就绪广播监听安装');
    return;
  }
  chrome.runtime.onMessage.addListener((msg: unknown) => {
    const m = msg as { type?: string; meta?: CaptureRecordingMeta };
    if (m?.type !== MessageType.CAPTURE_RECORDING_READY) return;
    log.info('收到录制产物就绪广播', m.meta?.id);
    void loadCaptureRecordings();
    toast.success(m.meta?.mode === 'audio' ? '录音完成，可在下方成果列表查看' : '录制完成，可在下方成果列表查看');
  });
}

/**
 * 取回录制产物 Blob（IDB 直读；侧栏与 SW 共享同一 IDB 实例）。
 * @param meta 成果元数据
 * @returns Blob；缺失时返回 null
 */
export async function getRecordingBlob(meta: CaptureRecordingMeta): Promise<Blob | null> {
  try {
    const blob = await idbGet(STORE_HLS_BLOBS, CAPREC_IDB_PREFIX + meta.id);
    if (!blob) {
      log.warn('IDB 中未找到录制产物', meta.id);
      return null;
    }
    return blob as Blob;
  } catch (e) {
    log.error('读取录制产物失败', meta.id, e);
    return null;
  }
}

/**
 * 获取成果的 object URL（缓存；供 <audio>/<video> 预览与编辑器交接）。
 * @param meta 成果元数据
 * @returns blob: URL；产物缺失时返回 null
 */
export async function getRecordingUrl(meta: CaptureRecordingMeta): Promise<string | null> {
  const cached = blobUrlCache.get(meta.id);
  if (cached) return cached;
  const blob = await getRecordingBlob(meta);
  if (!blob) return null;
  const url = URL.createObjectURL(blob);
  blobUrlCache.set(meta.id, url);
  return url;
}

/**
 * 删除一条录制成果（后台删元数据 + IDB Blob；侧栏同步清缓存与列表）。
 * @param meta 成果元数据
 */
export async function deleteRecording(meta: CaptureRecordingMeta): Promise<void> {
  try {
    await sendDeleteToBackground(meta.id);
  } catch (e) {
    // 后台不可达时侧栏兜底自删（元数据 + IDB），保证列表可清理
    log.warn('后台删除失败，侧栏兜底自删', meta.id, e);
    try {
      const list = captureRecordings.value.filter((x) => x.id !== meta.id);
      await chrome.storage.local.set({ [CAPREC_META_STORAGE_KEY]: list });
      await idbDelete(STORE_HLS_BLOBS, CAPREC_IDB_PREFIX + meta.id);
    } catch (e2) {
      log.error('兜底删除也失败', meta.id, e2);
    }
  }
  // 无论哪条路径删除成功，都刷新本地状态
  const url = blobUrlCache.get(meta.id);
  if (url) { URL.revokeObjectURL(url); blobUrlCache.delete(meta.id); }
  captureRecordings.value = captureRecordings.value.filter((x) => x.id !== meta.id);
  log.info('录制成果已删除', meta.id);
}

/**
 * 发送删除消息给后台（请求-应答族 { success }；带超时保护）。
 * @param recordId 录制 id
 */
function sendDeleteToBackground(recordId: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    try {
      chrome.runtime.sendMessage(
        { type: MessageType.CAPTURE_RECORDING_DELETE, recordId },
        (resp: unknown) => {
          void chrome.runtime.lastError;
          const r = resp as { success?: boolean; error?: string } | undefined;
          if (r?.success) resolve();
          else reject(new Error(r?.error || '后台删除失败'));
        }
      );
    } catch (e) {
      reject(e instanceof Error ? e : new Error(String(e)));
    }
  });
}

/**
 * 把文件名扩展名替换为目标扩展名（record_video_xxx.webm → record_video_xxx.mp4）。
 * @param fileName 原文件名
 * @param ext 目标扩展名（不含点）
 */
function withExtension(fileName: string, ext: string): string {
  const dot = fileName.lastIndexOf('.');
  return (dot > 0 ? fileName.slice(0, dot) : fileName) + '.' + ext;
}

/**
 * 下载录制成果（自动转码：视频→MP4、音频→M4A；环境不支持或转码失败时回退原样 webm）。
 * 转码为逐帧重编码，耗时与片长正相关；进度经 onProgress 透出供按钮展示。
 * @param meta 成果元数据
 * @param onProgress 转码进度回调 0~1（可选）
 */
export async function downloadRecordingConverted(
  meta: CaptureRecordingMeta,
  onProgress?: (ratio: number) => void
): Promise<void> {
  const blob = await getRecordingBlob(meta);
  if (!blob) {
    toast.error('录制文件不存在（可能已被清理）');
    return;
  }
  // 环境不支持 WebCodecs：直接原样下载（并提示兼容性风险）
  if (!canConvertMedia()) {
    log.warn('环境不支持 WebCodecs，原样下载 webm');
    triggerBlobDownload(blob, meta.fileName);
    toast.info('当前环境不支持转码，已按原始格式下载（webm 需 Chrome/VLC 播放）');
    return;
  }
  try {
    if (meta.mode === 'audio') {
      // 音频：转 M4A（AAC），Windows/手机默认播放器可直接打开
      toast.info('正在转换音频格式…');
      const m4a = await convertAudioBlobToM4a(blob, onProgress);
      triggerBlobDownload(m4a, withExtension(meta.fileName, 'm4a'));
    } else {
      // 视频：转 MP4（H.264/AAC）；时长用元数据兜底（webm 缺 Duration 头时）
      toast.info('正在转换视频格式，请稍候…');
      const mp4 = await convertVideoBlobToMp4(blob, {
        durationSec: meta.durationMs > 0 ? meta.durationMs / 1000 : undefined,
        onProgress,
      });
      triggerBlobDownload(mp4, withExtension(meta.fileName, 'mp4'));
    }
    toast.success('已开始下载（通用格式，任意播放器可打开）');
    log.info('转码下载完成', meta.id);
  } catch (e) {
    // 转码失败兜底：原样下载 webm，保证产物不丢
    log.error('转码失败，回退原样下载', meta.id, e);
    triggerBlobDownload(blob, meta.fileName);
    toast.error('转码失败，已按原始格式下载（webm 需 Chrome/VLC 播放）');
  }
}

/**
 * 在编辑器中打开录制成果（仅视频模式；音频无画面，编辑器不支持）。
 * @param meta 成果元数据
 */
export async function openRecordingInEditor(meta: CaptureRecordingMeta): Promise<void> {
  if (meta.mode !== 'video') {
    toast.info('音频录制不支持编辑器预览，请直接下载试听');
    return;
  }
  // 预检产物是否还在库里（可能已被超限淘汰或删除），避免打开一个空编辑器
  const blob = await getRecordingBlob(meta);
  if (!blob) {
    toast.error('录制文件不存在（可能已被清理）');
    return;
  }
  try {
    // 交 IDB 键而非 blob: URL：编辑器是独立标签页，侧栏关闭后其 blob: URL 会失效
    await openClipsInEditor([{ name: meta.fileName, idbKey: CAPREC_IDB_PREFIX + meta.id }]);
    log.info('已在编辑器中打开录制成果', meta.id);
  } catch (e) {
    log.error('打开编辑器失败', meta.id, e);
    toast.error('打开编辑器失败');
  }
}

/**
 * 毫秒时长 → mm:ss 文本（列表展示用；与录屏面板 formatDuration 口径一致，
 * 该函数为录屏 store 私有，此处按同口径实现一份模块私有版本）。
 * @param ms 毫秒
 */
export function formatRecordingDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
