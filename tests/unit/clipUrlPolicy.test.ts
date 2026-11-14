/**
 * P0-7 编辑器消息注入面收紧的单元测试。
 * 覆盖 EditorApp.vue 模块级导出的纯函数：URL 白名单校验与带体积上限的抓取。
 */
import { describe, expect, it, vi, afterEach } from 'vitest';
import {
  isAllowedClipUrl,
  fetchClipBlobCapped,
  MAX_REMOTE_CLIP_BYTES,
} from '../../src/editor/EditorApp.vue';

describe('isAllowedClipUrl：片段 URL 白名单校验', () => {
  it('放行 http/https 远程地址', () => {
    expect(isAllowedClipUrl('http://example.com/a.mp4')).toBe(true);
    expect(isAllowedClipUrl('https://cdn.example.com/video.mp4?x=1')).toBe(true);
    // 协议大小写混写会被 URL 解析器规范化，同样应放行
    expect(isAllowedClipUrl('HTTPS://example.com/a.mp4')).toBe(true);
  });

  it('拒绝 data:/file:/chrome-extension:/javascript:/blob: 等危险方案', () => {
    expect(isAllowedClipUrl('data:video/mp4;base64,AAAA')).toBe(false);
    expect(isAllowedClipUrl('file:///C:/secret.mp4')).toBe(false);
    expect(isAllowedClipUrl('chrome-extension://abcdefg/src/editor/index.html')).toBe(false);
    expect(isAllowedClipUrl('javascript:alert(1)')).toBe(false);
    expect(isAllowedClipUrl('blob:chrome-extension://abcdefg/uuid')).toBe(false);
  });

  it('blob: 无例外：即便来源是本扩展也拒绝（跨文档必然失效，本地素材走 IDB 键）', () => {
    expect(isAllowedClipUrl('blob:chrome-extension://abcdefg/uuid-1')).toBe(false);
    expect(isAllowedClipUrl('blob:https://example.com/uuid-1')).toBe(false);
    expect(isAllowedClipUrl('blob:null/uuid-1')).toBe(false);
  });

  it('非字符串、空串、非法 URL 一律拒绝', () => {
    expect(isAllowedClipUrl(undefined)).toBe(false);
    expect(isAllowedClipUrl(null)).toBe(false);
    expect(isAllowedClipUrl(123)).toBe(false);
    expect(isAllowedClipUrl('')).toBe(false);
    expect(isAllowedClipUrl('not a url')).toBe(false);
  });
});

describe('fetchClipBlobCapped：带体积上限的抓取', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /** 构造一个最小化的可读流响应体，按分片吐出数据 */
  function fakeBody(chunks: Uint8Array[]) {
    let i = 0;
    return {
      getReader: () => ({
        read: async () => (i < chunks.length ? { done: false, value: chunks[i++] } : { done: true, value: undefined }),
        cancel: vi.fn(async () => {}),
      }),
    };
  }

  it('Content-Length 预判超限时直接拒绝，不读取响应体', async () => {
    vi.stubGlobal('fetch', async () => ({
      ok: true,
      headers: { get: (k: string) => (k === 'content-length' ? String(MAX_REMOTE_CLIP_BYTES + 1) : null) },
      body: null,
    }));
    await expect(fetchClipBlobCapped('https://example.com/big.mp4', 1024)).rejects.toThrow(/体积上限/);
  });

  it('流式读取累计超限时报错并取消剩余读取', async () => {
    const cancelSpy = vi.fn(async () => {});
    vi.stubGlobal('fetch', async () => ({
      ok: true,
      headers: { get: () => null },
      body: {
        getReader: () => ({
          read: async () => ({ done: false, value: new Uint8Array(64) }), // 永不结束的流
          cancel: cancelSpy,
        }),
      },
    }));
    await expect(fetchClipBlobCapped('https://example.com/endless.mp4', 100)).rejects.toThrow(/体积上限/);
    expect(cancelSpy).toHaveBeenCalled();
  });

  it('正常体积内完整返回 Blob', async () => {
    const part1 = new Uint8Array([1, 2, 3]);
    const part2 = new Uint8Array([4, 5]);
    vi.stubGlobal('fetch', async () => ({
      ok: true,
      headers: { get: (k: string) => (k === 'content-type' ? 'video/webm' : null) },
      body: fakeBody([part1, part2]),
    }));
    const blob = await fetchClipBlobCapped('https://example.com/ok.webm', 1024);
    expect(blob.size).toBe(5);
    expect(blob.type).toBe('video/webm');
  });

  it('HTTP 非 2xx 响应时抛错', async () => {
    vi.stubGlobal('fetch', async () => ({
      ok: false,
      status: 404,
      headers: { get: () => null },
      body: null,
    }));
    await expect(fetchClipBlobCapped('https://example.com/missing.mp4', 1024)).rejects.toThrow('HTTP 404');
  });
});
