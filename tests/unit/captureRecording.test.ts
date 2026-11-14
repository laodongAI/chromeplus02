/**
 * 后台录制产物交接模块的纯函数单元测试。
 * 覆盖元数据列表容量淘汰逻辑（evictOverflowMetas）：
 *  - 未超限原样保留；
 *  - 超限按"最新在前保留前 cap 条、其余淘汰"切分；
 *  - 边界：空列表 / cap 为 0。
 * 本模块导入不触发 chrome 调用（处理器注册在 init 函数内），node 环境可直接导入。
 */
import { describe, expect, it } from 'vitest';
import { evictOverflowMetas, CAPREC_MAX_STORED } from '../../src/background/captureRecording';
import type { CaptureRecordingMeta } from '../../src/messaging';

/**
 * 构造一条最小可用的元数据（仅测试关心的字段不同，其余取固定值）。
 * @param id 录制 id
 * @param createdAt 完成时刻（用于断言顺序语义）
 */
function makeMeta(id: string, createdAt: number): CaptureRecordingMeta {
  return {
    id,
    mode: 'video',
    mimeType: 'video/webm',
    fileName: `${id}.webm`,
    sizeBytes: 1024,
    durationMs: 1000,
    createdAt,
  };
}

describe('evictOverflowMetas：录制成果元数据容量淘汰', () => {
  it('未超限时全部保留、无淘汰', () => {
    const metas = [makeMeta('a', 3), makeMeta('b', 2), makeMeta('c', 1)];
    const { kept, evicted } = evictOverflowMetas(metas, 5);
    expect(kept).toEqual(metas);
    expect(evicted).toEqual([]);
  });

  it('超限时保留最新（列表前部）、淘汰最旧（列表尾部）', () => {
    // 列表约定"最新在前"：a 最新、d 最旧
    const metas = [makeMeta('a', 4), makeMeta('b', 3), makeMeta('c', 2), makeMeta('d', 1)];
    const { kept, evicted } = evictOverflowMetas(metas, 2);
    expect(kept.map((m) => m.id)).toEqual(['a', 'b']);
    expect(evicted.map((m) => m.id)).toEqual(['c', 'd']);
  });

  it('恰好等于上限时不淘汰', () => {
    const metas = [makeMeta('a', 2), makeMeta('b', 1)];
    const { kept, evicted } = evictOverflowMetas(metas, 2);
    expect(kept).toHaveLength(2);
    expect(evicted).toHaveLength(0);
  });

  it('空列表安全返回空结果', () => {
    const { kept, evicted } = evictOverflowMetas([], CAPREC_MAX_STORED);
    expect(kept).toEqual([]);
    expect(evicted).toEqual([]);
  });

  it('cap 为 0 时全部淘汰（防御边界）', () => {
    const metas = [makeMeta('a', 1)];
    const { kept, evicted } = evictOverflowMetas(metas, 0);
    expect(kept).toEqual([]);
    expect(evicted).toHaveLength(1);
  });
});
