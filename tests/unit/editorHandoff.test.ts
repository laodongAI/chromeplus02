/**
 * 侧栏 → 编辑器素材交接契约的纯函数单测。
 * 覆盖三件事，都是"素材悄悄丢掉"这类静默故障的源头：
 *  1. 键的所有权区分（一次性交接键可删，录制成果键绝不能删）；
 *  2. IDB 两种并存值形态的解包（裸 Blob / {savedAt,blob}），空值必须判缺失而非造 0 字节片段；
 *  3. 孤儿回收的 TTL 边界，且裸 Blob（用户长期成果）永不被交接 TTL 回收。
 */
import { describe, expect, it } from 'vitest';
import {
  EDITOR_HANDOFF_PREFIX,
  EDITOR_HANDOFF_TTL_MS,
  isTransientHandoffKey,
  resolveHandoffBlob,
  isStaleHandoff,
  type EditorHandoffEntry,
} from '@/shared/editorHandoff';

/** 造一个非空 Blob（内容无关，只关心 size > 0） */
function makeBlob(bytes = 8): Blob {
  return new Blob([new Uint8Array(bytes)], { type: 'video/webm' });
}

describe('isTransientHandoffKey：键的所有权', () => {
  it('一次性交接键可删', () => {
    expect(isTransientHandoffKey(`${EDITOR_HANDOFF_PREFIX}1700000000000_ab12cd`)).toBe(true);
    expect(isTransientHandoffKey(EDITOR_HANDOFF_PREFIX)).toBe(true);
  });

  it('录制成果键必须保留（删了等于毁掉用户已保存的录制文件）', () => {
    expect(isTransientHandoffKey('caprec_1700000000000')).toBe(false);
    expect(isTransientHandoffKey('hls_segment_0001')).toBe(false);
    expect(isTransientHandoffKey('')).toBe(false);
  });

  it('前缀必须从头匹配，不是"包含即算"', () => {
    expect(isTransientHandoffKey(`x_${EDITOR_HANDOFF_PREFIX}abc`)).toBe(false);
    // 少一个下划线就不是本契约的键
    expect(isTransientHandoffKey('editor_handoffabc')).toBe(false);
  });
});

describe('resolveHandoffBlob：IDB 值解包', () => {
  it('裸 Blob（录制成果形态）原样返回同一实例', () => {
    const blob = makeBlob();
    expect(resolveHandoffBlob(blob)).toBe(blob);
  });

  it('{savedAt,blob}（一次性交接形态）取出内层 Blob', () => {
    const blob = makeBlob(16);
    const entry: EditorHandoffEntry = { savedAt: 1_700_000_000_000, blob };
    expect(resolveHandoffBlob(entry)).toBe(blob);
  });

  it('空 Blob 判为素材缺失，绝不返回 0 字节顶替', () => {
    expect(resolveHandoffBlob(new Blob([]))).toBeNull();
    expect(resolveHandoffBlob({ savedAt: 1, blob: new Blob([]) })).toBeNull();
  });

  it('键不存在 / 值损坏一律判缺失', () => {
    expect(resolveHandoffBlob(undefined)).toBeNull();
    expect(resolveHandoffBlob(null)).toBeNull();
    expect(resolveHandoffBlob({ savedAt: 1 })).toBeNull();
    expect(resolveHandoffBlob({ blob: 'not-a-blob' })).toBeNull();
    expect(resolveHandoffBlob('editor_handoff_x')).toBeNull();
    expect(resolveHandoffBlob(42)).toBeNull();
  });
});

describe('isStaleHandoff：孤儿回收阈值', () => {
  const savedAt = 1_700_000_000_000;

  it('TTL 为 1 小时', () => {
    expect(EDITOR_HANDOFF_TTL_MS).toBe(60 * 60 * 1000);
  });

  it('刚好到阈值不算过期，超过 1ms 才算（严格大于）', () => {
    const entry: EditorHandoffEntry = { savedAt, blob: makeBlob() };
    expect(isStaleHandoff(entry, savedAt + EDITOR_HANDOFF_TTL_MS)).toBe(false);
    expect(isStaleHandoff(entry, savedAt + EDITOR_HANDOFF_TTL_MS + 1)).toBe(true);
  });

  it('刚写入的素材不过期', () => {
    expect(isStaleHandoff({ savedAt, blob: makeBlob() }, savedAt + 1000)).toBe(false);
  });

  it('裸 Blob 是用户长期成果，永不按交接 TTL 回收', () => {
    expect(isStaleHandoff(makeBlob(), savedAt + EDITOR_HANDOFF_TTL_MS * 1000)).toBe(false);
  });

  it('缺时间戳 / 时间戳非数字 / 空值：不回收（宁可留着也不误删）', () => {
    expect(isStaleHandoff(null, savedAt)).toBe(false);
    expect(isStaleHandoff(undefined, savedAt)).toBe(false);
    expect(isStaleHandoff({ blob: makeBlob() }, savedAt)).toBe(false);
    expect(isStaleHandoff({ savedAt: '1700000000000', blob: makeBlob() }, savedAt)).toBe(false);
  });

  it('时钟回拨（savedAt 在未来）不判过期', () => {
    expect(isStaleHandoff({ savedAt: savedAt + 5000, blob: makeBlob() }, savedAt)).toBe(false);
  });
});