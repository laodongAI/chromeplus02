/**
 * IndexedDB 共享存储（Service Worker 与侧边栏同源共享）。
 * 用途：
 *  1. HLS 分片缓存（断点续传 / SW 重启恢复 / 暂停续下）
 *  2. 最终合并 Blob 的 SW→侧边栏交接（SW 中没有 URL.createObjectURL，
 *     大文件经 data: URL 不可靠，统一走 IDB 交接后由侧边栏触发保存）
 * 手写极简封装，避免额外依赖。
 */

const DB_NAME = 'chromeplus02-media';
const DB_VERSION = 1;
export const STORE_HLS_SEGMENTS = 'hls-segments';
export const STORE_HLS_BLOBS = 'hls-blobs';

const STORES = [STORE_HLS_SEGMENTS, STORE_HLS_BLOBS];

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    try {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        for (const s of STORES) {
          if (!db.objectStoreNames.contains(s)) db.createObjectStore(s);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error('IndexedDB 打开失败'));
    } catch (e) {
      reject(e instanceof Error ? e : new Error(String(e)));
    }
  });
  return dbPromise;
}

async function withStore<T>(storeName: string, mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest): Promise<T> {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    try {
      const tx = db.transaction(storeName, mode);
      const req = fn(tx.objectStore(storeName));
      req.onsuccess = () => resolve(req.result as T);
      req.onerror = () => reject(req.error || new Error('IndexedDB 操作失败'));
    } catch (e) {
      reject(e instanceof Error ? e : new Error(String(e)));
    }
  });
}

export function idbPut(storeName: string, key: string, value: ArrayBuffer | Blob | unknown): Promise<void> {
  return withStore<void>(storeName, 'readwrite', (s) => s.put(value as any, key));
}

export function idbGet<T = unknown>(storeName: string, key: string): Promise<T | undefined> {
  return withStore<T | undefined>(storeName, 'readonly', (s) => s.get(key));
}

export function idbDelete(storeName: string, key: string): Promise<void> {
  return withStore<void>(storeName, 'readwrite', (s) => s.delete(key));
}

export async function idbGetAllKeys(storeName: string): Promise<string[]> {
  const keys = await withStore<IDBValidKey[]>(storeName, 'readonly', (s) => s.getAllKeys());
  return (keys || []).map(String);
}

export async function idbDeleteByPrefix(storeName: string, prefix: string): Promise<void> {
  const keys = await idbGetAllKeys(storeName);
  await Promise.all(keys.filter(k => k.startsWith(prefix)).map(k => idbDelete(storeName, k)));
}
