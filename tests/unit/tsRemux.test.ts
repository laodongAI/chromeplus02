/**
 * TS→MP4 转封装回归测试。
 * 用真实 MPEG-TS 样本驱动 vendored mux.js，验证产物是可解析的 MP4 而非 null。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { remuxTsToMp4, canRemux, REMUX_MAX_BYTES, REMUX_OVER_LIMIT_CODE } from '@/core/tsRemux';

/** ffmpeg 生成的 H.264/AAC MPEG-TS 样本（64x48，0.5s），仅用于验证封装结构 */
const sample = new Uint8Array(readFileSync(resolve(__dirname, '../fixtures/h264-sample.mpegts')));

/** 读取 MP4 顶层 box 类型序列 */
function topLevelBoxes(bytes: Uint8Array): string[] {
  const boxes: string[] = [];
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let off = 0;
  while (off + 8 <= bytes.byteLength) {
    const size = view.getUint32(off);
    const type = String.fromCharCode(...bytes.subarray(off + 4, off + 8));
    boxes.push(type);
    if (size < 8) break;
    off += size;
  }
  return boxes;
}

describe('remuxTsToMp4：真实 TS 样本端到端', () => {
  it('产出以 ftyp 开头、含 moov 与媒体数据的 MP4', async () => {
    const out = await remuxTsToMp4(sample);
    expect(out).not.toBeNull();
    const bytes = out!;
    expect(bytes.byteLength).toBeGreaterThan(1000);
    const boxes = topLevelBoxes(bytes);
    expect(boxes[0]).toBe('ftyp');
    expect(boxes).toContain('moov');
    // 媒体数据必须在 moov 之后，否则播放器拿不到索引
    expect(boxes.indexOf('moov')).toBeLessThan(boxes.length - 1);
    expect(boxes.some(b => b === 'moof' || b === 'mdat')).toBe(true);
  });

  it('只有一个 moov：多次 data 事件不重复写入初始化段', async () => {
    const out = await remuxTsToMp4(sample);
    expect(topLevelBoxes(out!).filter(b => b === 'moov')).toHaveLength(1);
  });

  it('空输入返回 null，由调用方回退朴素 .ts 合并', async () => {
    expect(await remuxTsToMp4(new Uint8Array(0))).toBeNull();
  });
});

describe('canRemux：内存上限判定', () => {
  it('样本体积在限额内且转封装器可加载', async () => {
    expect(await canRemux(sample.byteLength)).toBe(true);
  });

  it('超过上限返回 false（错误码常量供调用方打日志）', async () => {
    expect(await canRemux(REMUX_MAX_BYTES + 1)).toBe(false);
    expect(REMUX_OVER_LIMIT_CODE).toBe('REMUX_OVER_LIMIT');
  });
});