const RECEIVER_MISSING_REGEX = /receiving end does not exist|could not establish connection/i;
const DEFAULT_CONTENT_SCRIPTS = ['js/content.js'];

export interface SendTabMessageOptions {
  /**
   * Whether we should try to inject the legacy content script and retry
   * when Chrome reports "Receiving end does not exist".
   */
  retryOnMissing?: boolean;
  /** Custom file list for injection, defaults to the legacy bundle. */
  contentScriptFiles?: string[];
  /** Target a specific frame when sending a tab message. */
  frameId?: number;
}

export function isReceivingEndMissingError(error: unknown): boolean {
  const message = extractErrorMessage(error);
  return RECEIVER_MISSING_REGEX.test(message);
}

export async function getActiveTabId(): Promise<number | null> {
  const info = await getActiveTabInfo();
  return info?.id ?? null;
}

export interface ActiveTabInfo {
  id: number | null;
  url?: string | null;
  pendingUrl?: string | null;
}

export async function getActiveTabInfo(): Promise<ActiveTabInfo | null> {
  return new Promise((resolve) => {
    if (!chrome?.tabs?.query) {
      resolve(null);
      return;
    }
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (chrome.runtime.lastError) {
        console.warn('[sidepanel] tabs.query failed:', chrome.runtime.lastError.message);
        resolve(null);
        return;
      }
      const tab = tabs?.[0];
      if (!tab) {
        resolve({ id: null, url: null, pendingUrl: null });
        return;
      }
      resolve({ id: tab.id ?? null, url: tab.url ?? undefined, pendingUrl: (tab as chrome.tabs.Tab).pendingUrl });
    });
  });
}

export async function sendMessageToTab<T = unknown>(
  tabId: number,
  message: unknown,
  options: SendTabMessageOptions = {}
): Promise<T> {
  const { retryOnMissing = true, contentScriptFiles = DEFAULT_CONTENT_SCRIPTS } = options;
  let attemptedInjection = false;

  const exec = () =>
    new Promise<T>((resolve, reject) => {
      if (!chrome?.tabs?.sendMessage) {
        reject(new Error('Chrome tabs API 不可用'));
        return;
      }
      try {
        const cb = (response: unknown) => {
          const lastError = chrome.runtime.lastError;
          if (lastError) {
            reject(new Error(lastError.message));
            return;
          }
          resolve(response as T);
        };
        if (typeof options?.frameId === 'number') {
          (chrome.tabs.sendMessage as unknown as (
            tabId: number,
            message: unknown,
            options: { frameId: number },
            callback: (response: unknown) => void
          ) => void)(tabId, message, { frameId: options.frameId }, cb);
        } else {
          (chrome.tabs.sendMessage as unknown as (
            tabId: number,
            message: unknown,
            callback: (response: unknown) => void
          ) => void)(tabId, message, cb);
        }
      } catch (err) {
        reject(err as Error);
      }
    });

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await exec();
    } catch (error) {
      const shouldRetry =
        retryOnMissing &&
        !attemptedInjection &&
        isReceivingEndMissingError(error) &&
        contentScriptFiles.length > 0;
      if (!shouldRetry) {
        throw error;
      }
      attemptedInjection = true;
      await injectContentScripts(tabId, contentScriptFiles);
    }
  }
  throw new Error('无法与内容脚本通信');
}

export async function sendRuntimeMessage<T = unknown>(message: unknown): Promise<T> {
  return new Promise((resolve, reject) => {
    if (!chrome?.runtime?.sendMessage) {
      reject(new Error('Chrome runtime API 不可用'));
      return;
    }
    chrome.runtime.sendMessage(message, (response) => {
      const lastError = chrome.runtime.lastError;
      if (lastError) {
        reject(new Error(lastError.message));
        return;
      }
      resolve(response as T);
    });
  });
}

async function injectContentScripts(tabId: number, files: string[]): Promise<void> {
  if (!chrome?.scripting?.executeScript) {
    throw new Error('无法注入内容脚本：缺少 scripting 权限');
  }
  await new Promise<void>((resolve, reject) => {
    chrome.scripting.executeScript(
      {
        target: { tabId, allFrames: true },
        files
      },
      () => {
        const lastError = chrome.runtime.lastError;
        if (lastError) {
          reject(new Error(lastError.message));
          return;
        }
        resolve();
      }
    );
  });
}

type ErrorWithMessage = {
  message?: unknown;
};

function extractErrorMessage(error: unknown): string {
  if (!error) return '';
  if (typeof error === 'string') return error;
  if (error instanceof Error) return error.message || '';
  if (typeof error === 'object' && error !== null) {
    const candidate = (error as ErrorWithMessage).message;
    if (typeof candidate === 'string') {
      return candidate;
    }
  }
  return String(error);
}

export async function getAllFrameIds(tabId: number): Promise<number[]> {
  return new Promise((resolve) => {
    try {
      if (!chrome?.webNavigation?.getAllFrames) {
        resolve([]);
        return;
      }
      chrome.webNavigation.getAllFrames({ tabId }, (details) => {
        if (chrome.runtime.lastError) {
          resolve([]);
          return;
        }
        const ids = Array.isArray(details) ? details.map((d) => d.frameId).filter((n) => typeof n === 'number') : [];
        resolve(ids);
      });
    } catch {
      resolve([]);
    }
  });
}

/**
 * 尝试确保内容脚本已连接：
 * - 先对顶层与各子帧发送一次 GET_VIDEO_LIST 探测；
 * - 若全部失败且报 receiving end missing，则注入 content_script.js（全帧）；
 * - 再次对各帧探测一次，返回统计结果。
 */
export async function ensureContentConnected(tabId: number): Promise<{ ok: boolean; framesChecked: number; framesConnected: number; error?: string }>{
  const frames = await getAllFrameIds(tabId);
  const probe = async () => {
    let checked = 0; let connected = 0; let missingCount = 0;
    // 先探测顶层
    try {
      checked++;
      const r = await sendMessageToTab(tabId, { type: 'GET_VIDEO_LIST' });
      if (r) connected++;
    } catch (e) {
      if (isReceivingEndMissingError(e)) missingCount++;
    }
    // 再探测子帧
    for (const fid of frames) {
      try {
        checked++;
        const r = await sendMessageToTab(tabId, { type: 'GET_VIDEO_LIST' }, { frameId: fid });
        if (r) connected++;
      } catch (e) {
        if (isReceivingEndMissingError(e)) missingCount++;
      }
    }
    return { checked, connected, missingCount };
  };

  const first = await probe();
  if (first.connected > 0) {
    return { ok: true, framesChecked: first.checked, framesConnected: first.connected };
  }
  // 若探测均失败，尝试注入并重试
  try {
    await injectContentScripts(tabId, DEFAULT_CONTENT_SCRIPTS);
  } catch (e) {
    return { ok: false, framesChecked: first.checked, framesConnected: first.connected, error: (e as Error)?.message };
  }
  const second = await probe();
  return { ok: second.connected > 0, framesChecked: second.checked, framesConnected: second.connected };
}

export interface FrameInfo {
  frameId: number;
  url?: string;
  parentFrameId?: number;
}

export async function getAllFramesInfo(tabId: number): Promise<FrameInfo[]> {
  return new Promise((resolve) => {
    try {
      if (!chrome?.webNavigation?.getAllFrames) {
        resolve([]);
        return;
      }
      chrome.webNavigation.getAllFrames({ tabId }, (details) => {
        if (chrome.runtime.lastError) {
          resolve([]);
          return;
        }
        const items: FrameInfo[] = Array.isArray(details)
          ? details.map((d) => ({ frameId: d.frameId as number, url: d.url as string | undefined, parentFrameId: (typeof d.parentFrameId === 'number' ? d.parentFrameId : undefined) }))
          : [];
        resolve(items);
      });
    } catch {
      resolve([]);
    }
  });
}