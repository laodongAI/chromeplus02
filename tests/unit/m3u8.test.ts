import { describe, it, expect } from 'vitest';
import { parseM3U8, pickBestVariant } from '@/core/m3u8';
import { detectMergeType, mergeSegments } from '@/core/hlsMerge';

const BASE = 'https://example.com/live/index.m3u8';

describe('parseM3U8: master 清单', () => {
  it('解析多码率变体并解析相对地址', () => {
    const text = [
      '#EXTM3U',
      '#EXT-X-STREAM-INF:BANDWIDTH=1280000,RESOLUTION=640x360,CODECS="avc1.42e00a"',
      'v360.m3u8',
      '#EXT-X-STREAM-INF:BANDWIDTH=4128000,RESOLUTION=1920x1080',
      'https://cdn.example.com/v1080/index.m3u8',
      ''
    ].join('\n');
    const r = parseM3U8(text, BASE);
    expect(r.type).toBe('master');
    expect(r.variants).toHaveLength(2);
    expect(r.variants![0].url).toBe('https://example.com/live/v360.m3u8');
    expect(r.variants![0].bandwidth).toBe(1280000);
    expect(r.variants![0].resolution).toBe('640x360');
    expect(r.variants![0].codecs).toBe('avc1.42e00a');
    expect(r.variants![1].url).toBe('https://cdn.example.com/v1080/index.m3u8');
  });

  it('pickBestVariant 选码率最高者', () => {
    const r = parseM3U8([
      '#EXTM3U',
      '#EXT-X-STREAM-INF:BANDWIDTH=800000', 'low.m3u8',
      '#EXT-X-STREAM-INF:BANDWIDTH=5000000', 'high.m3u8',
      ''
    ].join('\n'), BASE);
    expect(pickBestVariant(r.variants!)!.url).toBe('https://example.com/live/high.m3u8');
  });
});

describe('parseM3U8: media 清单', () => {
  it('解析分片、时长与总时长', () => {
    const text = [
      '#EXTM3U',
      '#EXT-X-TARGETDURATION:6',
      '#EXT-X-MEDIA-SEQUENCE:0',
      '#EXTINF:6.006,',
      'seg0.ts',
      '#EXTINF:5.000,',
      'seg1.ts',
      '#EXT-X-ENDLIST',
      ''
    ].join('\n');
    const r = parseM3U8(text, BASE);
    expect(r.type).toBe('media');
    expect(r.segments).toHaveLength(2);
    expect(r.segments![0].url).toBe('https://example.com/live/seg0.ts');
    expect(r.segments![0].duration).toBeCloseTo(6.006);
    expect(r.segments![1].sequence).toBe(1);
    expect(r.totalDuration).toBeCloseTo(11.006);
    expect(r.isLive).toBe(false);
  });

  it('无 ENDLIST 判定为直播流', () => {
    const r = parseM3U8('#EXTM3U\n#EXTINF:4,\na.ts\n', BASE);
    expect(r.isLive).toBe(true);
  });

  it('识别 AES-128 加密与 IV', () => {
    const r = parseM3U8([
      '#EXTM3U',
      '#EXT-X-KEY:METHOD=AES-128,URI="key.bin",IV=0x1234567890abcdef1234567890abcdef',
      '#EXTINF:4,',
      'a.ts',
      '#EXT-X-ENDLIST',
      ''
    ].join('\n'), BASE);
    expect(r.keyInfo).toBeDefined();
    expect(r.keyInfo!.method).toBe('AES-128');
    expect(r.keyInfo!.uri).toBe('https://example.com/live/key.bin');
    expect(r.keyInfo!.iv).toContain('1234');
  });

  it('SAMPLE-AES 标记为不支持的加密', () => {
    const r = parseM3U8('#EXTM3U\n#EXT-X-KEY:METHOD=SAMPLE-AES,URI="k"\n#EXTINF:4,\na.ts\n#EXT-X-ENDLIST\n', BASE);
    expect(r.unsupportedEncryption).toBe(true);
  });

  it('解析 EXT-X-MAP（fMP4 初始化段）', () => {
    const r = parseM3U8([
      '#EXTM3U',
      '#EXT-X-MAP:URI="init.mp4"',
      '#EXTINF:4,',
      'seg0.m4s',
      '#EXT-X-ENDLIST',
      ''
    ].join('\n'), BASE);
    expect(r.initSegment).toBe('https://example.com/live/init.mp4');
  });

  it('解析 EXT-X-BYTERANGE（含隐式偏移延续）', () => {
    const r = parseM3U8([
      '#EXTM3U',
      '#EXTINF:4,',
      'media.bin',
      '#EXT-X-BYTERANGE:1000@0',
      'media.bin',
      '#EXT-X-BYTERANGE:500',
      'media.bin',
      '#EXT-X-ENDLIST',
      ''
    ].join('\n'), BASE);
    expect(r.segments![0].byterange).toBeUndefined();
    expect(r.segments![1].byterange).toEqual({ length: 1000, offset: 0 });
    expect(r.segments![2].byterange).toEqual({ length: 500, offset: 1000 });
  });

  it('非法内容抛错', () => {
    expect(() => parseM3U8('<html>not m3u8</html>', BASE)).toThrow();
  });
});

describe('detectMergeType (core/hlsMerge)', () => {
  it('fMP4：有 init 段或 m4s 分片', () => {
    expect(detectMergeType({ initSegment: 'https://a/init.mp4', segments: ['https://a/1.ts'] })).toBe('fmp4');
    expect(detectMergeType({ segments: ['https://a/1.m4s'] })).toBe('fmp4');
  });
  it('aac 与 ts', () => {
    expect(detectMergeType({ segments: ['https://a/1.aac', 'https://a/2.aac'] })).toBe('aac');
    expect(detectMergeType({ segments: ['https://a/1.ts'] })).toBe('ts');
  });
});

describe('mergeSegments', () => {
  it('拼接字节并给出正确的 mime/扩展名', async () => {
    const a = new Uint8Array([1, 2, 3]);
    const b = new Uint8Array([4, 5]);
    const m = mergeSegments([a, b], 'ts');
    expect(m.extension).toBe('ts');
    expect(m.mime).toBe('video/mp2t');
    const buf = new Uint8Array(await m.blob.arrayBuffer());
    expect(Array.from(buf)).toEqual([1, 2, 3, 4, 5]);
  });
});
