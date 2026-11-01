/**
 * Sources面板目录下载管理器
 * 支持下载页面资源文件并保持目录结构，打包成zip
 */

// 动态导入JSZip，避免在background中直接导入导致问题
let JSZip: any = null;
async function getJSZip() {
  if (!JSZip) {
    JSZip = (await import('jszip')).default;
  }
  return JSZip;
}

export interface SourceFile {
  path: string; // 相对路径，保持目录结构
  url: string; // 完整URL
  content?: string | ArrayBuffer; // 文件内容
  size?: number;
  type?: string; // 文件类型
}

interface DownloadTask {
  id: string;
  files: SourceFile[];
  status: 'pending' | 'downloading' | 'packing' | 'completed' | 'error';
  progress: number;
  error?: string;
  zipBlob?: Blob;
}

const downloadTasks = new Map<string, DownloadTask>();

/**
 * 创建新的下载任务
 */
export function createDownloadTask(files: SourceFile[]): string {
  const id = `sources_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const task: DownloadTask = {
    id,
    files,
    status: 'pending',
    progress: 0
  };
  downloadTasks.set(id, task);
  return id;
}

/**
 * 开始下载任务
 * @param id 任务ID
 * @param onProgress 进度回调函数
 */
export async function startDownloadTask(id: string, onProgress?: (progress: number) => void): Promise<void> {
  const task = downloadTasks.get(id);
  if (!task) throw new Error('任务不存在');

  task.status = 'downloading';
  task.progress = 0;

  try {
    // 文件内容已经在扫描时获取，直接使用（跳过下载阶段，直接进入打包）
    task.progress = 0.8;
    if (onProgress) onProgress(0.8);

    // 打包成zip
    task.status = 'packing';
    task.progress = 0.8;
    if (onProgress) onProgress(0.8);
    
    const JSZipClass = await getJSZip();
    const zip = new JSZipClass();

    let packedCount = 0;
    const totalToPack = task.files.filter(f => f.content).length;

    for (const file of task.files) {
      if (file.content) {
        try {
          // 确保路径使用正斜杠，并清理路径
          const zipPath = file.path.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+/g, '/');
          if (zipPath) {
            if (file.content instanceof ArrayBuffer) {
              zip.file(zipPath, file.content);
            } else {
              zip.file(zipPath, file.content);
            }
            packedCount++;
            // 更新打包进度
            const packingProgress = 0.8 + (packedCount / totalToPack) * 0.15;
            task.progress = Math.min(packingProgress, 0.95);
            if (onProgress) onProgress(task.progress);
          }
        } catch (e) {
          console.warn(`[sourcesDownload] Error packing file ${file.path}:`, e);
        }
      }
    }

    const zipBlob = await zip.generateAsync({ 
      type: 'blob', 
      compression: 'DEFLATE',
      compressionOptions: { level: 6 } // 平衡压缩率和速度
    });
    task.zipBlob = zipBlob;
    task.status = 'completed';
    task.progress = 1;
    if (onProgress) onProgress(1);

    // 触发下载
    const fileName = `sources_${Date.now()}.zip`;
    const url = URL.createObjectURL(zipBlob);
    await chrome.downloads.download({
      url,
      filename: fileName,
      saveAs: false
    });

    // 清理
    setTimeout(() => {
      URL.revokeObjectURL(url);
    }, 10000);

  } catch (e) {
    task.status = 'error';
    task.error = e instanceof Error ? e.message : String(e);
    throw e;
  }
}

/**
 * 获取任务状态
 */
export function getTaskStatus(id: string): DownloadTask | undefined {
  return downloadTasks.get(id);
}

/**
 * 清理旧任务
 */
export function cleanupOldTasks(): void {
  const now = Date.now();
  const oneHour = 60 * 60 * 1000;
  const maxTasks = 100; // 最多保留100个任务
  
  // 如果任务数量超过限制，删除最旧的
  if (downloadTasks.size > maxTasks) {
    const sortedTasks = Array.from(downloadTasks.entries())
      .sort((a, b) => {
        const timeA = a[1].id.includes('_') ? parseInt(a[1].id.split('_')[1]) || 0 : 0;
        const timeB = b[1].id.includes('_') ? parseInt(b[1].id.split('_')[1]) || 0 : 0;
        return timeA - timeB;
      });
    
    // 删除最旧的任务
    const toDelete = sortedTasks.slice(0, downloadTasks.size - maxTasks);
    toDelete.forEach(([id]) => downloadTasks.delete(id));
    return;
  }

  // 清理超过1小时的已完成任务
  for (const [id, task] of downloadTasks.entries()) {
    if (task.status === 'completed' || task.status === 'error') {
      if (task.id && task.id.includes('_')) {
        const timestamp = parseInt(task.id.split('_')[1]);
        if (timestamp && (now - timestamp) > oneHour) {
          downloadTasks.delete(id);
          // 清理zipBlob以释放内存
          if (task.zipBlob) {
            task.zipBlob = undefined;
          }
        }
      }
    }
  }
}

/**
 * 初始化清理任务
 * 说明：SW 中 setInterval 会在挂起后丢失，改用 chrome.alarms 周期清理
 */
export function initSourcesDownloadCleanup(): void {
  try {
    chrome.alarms.create('bg-sources-cleanup', { periodInMinutes: 10 });
    chrome.alarms.onAlarm.addListener((alarm) => {
      if (alarm?.name === 'bg-sources-cleanup') cleanupOldTasks();
    });
  } catch { /* noop */ }
}
