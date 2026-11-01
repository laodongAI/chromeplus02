import { reactive } from 'vue';

interface Options { ttl?: number; ttlNew?: number; ttlRemoved?: number }
type RowId = string | number;

/**
 * 行高亮辅助：支持新增与移除两类瞬时高亮集合，分别有独立 TTL。
 * 统一使用 string|number ID，避免泛型与 reactive Set 组合的 TS 误报。
 */
export function useRowHighlight(options?: Options) {
  // 兼容旧 ttl 参数（作为新增 TTL）
  const ttlNew = typeof options?.ttlNew === 'number'
    ? Math.max(200, options.ttlNew)
    : (typeof options?.ttl === 'number' ? Math.max(200, options.ttl) : 2500);
  const ttlRemoved = typeof options?.ttlRemoved === 'number' ? Math.max(200, options.ttlRemoved) : 900;
  const newSet = reactive(new Set<RowId>());
  const removedSet = reactive(new Set<RowId>());

  function markNew(items: RowId[] | RowId) {
    const arr = Array.isArray(items) ? items : [items];
    arr.forEach(id => {
      if (!newSet.has(id)) {
        newSet.add(id);
        window.setTimeout(() => newSet.delete(id), ttlNew);
      }
    });
  }

  function markRemoved(items: RowId[] | RowId) {
    const arr = Array.isArray(items) ? items : [items];
    arr.forEach(id => {
      if (!removedSet.has(id)) {
        removedSet.add(id);
        window.setTimeout(() => removedSet.delete(id), ttlRemoved);
      }
    });
  }

  return { newSet, removedSet, markNew, markRemoved, ttlNew, ttlRemoved };
}
