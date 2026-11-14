/**
 * HLS AES-128 分片解密回归测试。
 * 重点：crypto.subtle.decrypt 必须收到 { name, iv }，且隐式 IV 按媒体序号大端推导。
 */
import { describe, it, expect } from 'vitest';
import { decryptSegment, HLS_INIT_INDEX, type HlsTaskMeta } from '@/background/hls';

const KEY_BYTES = new Uint8Array([
  0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07,
  0x08, 0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x0e, 0x0f
]);
const PLAINTEXT = new TextEncoder().encode('mpeg-ts segment payload / 你好，分片');

function makeMeta(overrides: Partial<HlsTaskMeta> = {}): HlsTaskMeta {
  return {
    playlistUrl: 'https://example.com/index.m3u8',
    segments: ['https://example.com/0.ts', 'https://example.com/1.ts'],
    sequences: [7, 8],
    byteranges: [undefined, undefined],
    mergeType: 'ts',
    segTotal: 2,
    ...overrides
  };
}

async function importKey(): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', KEY_BYTES, 'AES-CBC', false, ['encrypt', 'decrypt']);
}

/** 用给定 IV 加密，模拟服务端产出的密文分片 */
async function encryptWith(iv: Uint8Array, key: CryptoKey): Promise<ArrayBuffer> {
  return crypto.subtle.encrypt({ name: 'AES-CBC', iv }, key, PLAINTEXT);
}

/** 媒体序号的 128 位大端表示（HLS 规范规定的隐式 IV） */
function sequenceIv(seq: number): Uint8Array {
  const iv = new Uint8Array(16);
  new DataView(iv.buffer).setUint32(12, seq >>> 0);
  return iv;
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

describe('decryptSegment：显式 IV', () => {
  it('使用 EXT-X-KEY 的 IV 属性还原明文', async () => {
    const key = await importKey();
    const iv = new Uint8Array(16).fill(0x5a);
    const cipher = await encryptWith(iv, key);
    const meta = makeMeta({ keyInfo: { method: 'AES-128', uri: 'https://example.com/key', iv: toHex(iv) } });
    const out = await decryptSegment(cipher, key, meta, 0);
    expect(new Uint8Array(out)).toEqual(PLAINTEXT);
  });

  it('兼容 0x 前缀的 IV 写法', async () => {
    const key = await importKey();
    const iv = sequenceIv(1234567);
    const cipher = await encryptWith(iv, key);
    const meta = makeMeta({ keyInfo: { method: 'AES-128', uri: 'https://example.com/key', iv: `0x${toHex(iv)}` } });
    const out = await decryptSegment(cipher, key, meta, 0);
    expect(new Uint8Array(out)).toEqual(PLAINTEXT);
  });
});

describe('decryptSegment：隐式 IV（无 IV 属性时按媒体序号）', () => {
  it('用分片自身的媒体序号而非数组下标', async () => {
    const key = await importKey();
    // sequences[0] = 7：若实现误用下标 0，解密结果会是乱码并因填充校验抛错
    const cipher = await encryptWith(sequenceIv(7), key);
    const out = await decryptSegment(cipher, key, makeMeta(), 0);
    expect(new Uint8Array(out)).toEqual(PLAINTEXT);
  });

  it('第二个分片用自己的序号 8', async () => {
    const key = await importKey();
    const cipher = await encryptWith(sequenceIv(8), key);
    const out = await decryptSegment(cipher, key, makeMeta(), 1);
    expect(new Uint8Array(out)).toEqual(PLAINTEXT);
  });

  it('初始化段沿用首个分片的序号', async () => {
    const key = await importKey();
    const cipher = await encryptWith(sequenceIv(7), key);
    const out = await decryptSegment(cipher, key, makeMeta(), HLS_INIT_INDEX);
    expect(new Uint8Array(out)).toEqual(PLAINTEXT);
  });
});

describe('decryptSegment：非法输入', () => {
  it('IV 长度不足 16 字节时明确报错，而不是把错误 IV 传给 WebCrypto', async () => {
    const key = await importKey();
    const meta = makeMeta({ keyInfo: { method: 'AES-128', uri: 'https://example.com/key', iv: '00112233' } });
    await expect(decryptSegment(new ArrayBuffer(16), key, meta, 0)).rejects.toThrow('IV 长度异常');
  });
});