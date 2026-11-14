/**
 * Round 5 #30：外挂下载器纯逻辑单测。
 * 重点是"下发给本机进程的东西必须安全且语义正确"：URL/文件名消毒、argv 构造、
 * aria2 应答解析（它的数值字段是字符串）、通道选择规则。
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_EXTERNAL_TOOLS,
  buildAria2AddUriPayload,
  buildAria2TellStatusPayload,
  buildFfmpegArgs,
  buildM3u8DlArgs,
  buildNativeDownloadRequest,
  isSafeNativeArg,
  isSafeRemoteUrl,
  parseAria2Response,
  pickExternalTool,
  sanitizeFileName,
  type ExternalToolConfig
} from '@/core/externalTools';

const cfg = (patch: Partial<ExternalToolConfig> = {}): ExternalToolConfig => ({ ...DEFAULT_EXTERNAL_TOOLS, ...patch });

describe('isSafeRemoteUrl：本机执行前的地址闸门', () => {
  it('只放行 http/https 绝对地址', () => {
    expect(isSafeRemoteUrl('https://cdn.example.com/a.mp4')).toBe(true);
    expect(isSafeRemoteUrl('http://127.0.0.1:8080/a.m3u8')).toBe(true);
    expect(isSafeRemoteUrl('file:///C:/secret.txt')).toBe(false);
    expect(isSafeRemoteUrl('blob:https://site/uuid')).toBe(false);
    expect(isSafeRemoteUrl('chrome-extension://id/a.mp4')).toBe(false);
    expect(isSafeRemoteUrl('not a url')).toBe(false);
    expect(isSafeRemoteUrl('')).toBe(false);
  });

  it('含控制字符的地址一律拒绝（换行会被 URL 解析器吃掉，但命令行里是注入面）', () => {
    expect(isSafeRemoteUrl('https://a.com/x.mp4\n--evil')).toBe(false);
    expect(isSafeRemoteUrl('https://a.com/x.mp4\t')).toBe(false);
    expect(isSafeRemoteUrl('https://a.com/x.mp4\u0000')).toBe(false);
  });

  it('含双引号的地址拒绝：本机两套命令行解析规则对它的解释相反', () => {
    expect(isSafeRemoteUrl('https://a.com/x.mp4?a="b')).toBe(false);
  });
});

describe('isSafeNativeArg：只放行两套解析规则都能还原的参数', () => {
  it('普通参数、含空格参数、含 CRLF 的 header 都放行', () => {
    expect(isSafeNativeArg('https://a.com/v.mp4')).toBe(true);
    expect(isSafeNativeArg('name with spaces.mp4')).toBe(true);
    expect(isSafeNativeArg('Referer: https://a/b\r\n')).toBe(true);
    expect(isSafeNativeArg('a\\b\\c d')).toBe(true);
    expect(isSafeNativeArg('')).toBe(true);
    expect(isSafeNativeArg('trailing\\')).toBe(true);
  });

  it('双引号无解，含空白又以反斜杠结尾两解不同，都拒绝', () => {
    expect(isSafeNativeArg('a"b')).toBe(false);
    expect(isSafeNativeArg('a\\"b')).toBe(false);
    expect(isSafeNativeArg('a b\\')).toBe(false);
    expect(isSafeNativeArg('"')).toBe(false);
  });
});

describe('sanitizeFileName：禁止越目录写入', () => {
  it('剥掉目录部分与非法字符，保留可用名', () => {
    expect(sanitizeFileName('../../etc/passwd')).toBe('passwd');
    expect(sanitizeFileName('C:\\Users\\a\\video.mp4')).toBe('video.mp4');
    expect(sanitizeFileName('a<b>c:d"e|f?g*h.mp4')).toBe('abcdefgh.mp4');
    expect(sanitizeFileName('...hidden.mp4')).toBe('hidden.mp4');
  });

  it('空值与纯路径回退到 fallback，并限制长度', () => {
    expect(sanitizeFileName(undefined)).toBe('media');
    expect(sanitizeFileName('/', 'video')).toBe('video');
    expect(sanitizeFileName('   ', 'video')).toBe('video');
    expect(sanitizeFileName('x'.repeat(400)).length).toBeLessThanOrEqual(180);
  });
});

describe('aria2 JSON-RPC 负载', () => {
  it('无密钥时 params 首项是 URL 数组；有密钥时 token 前置', () => {
    const noToken = buildAria2AddUriPayload(cfg(), { url: 'https://a.com/v.mp4', fileName: 'v.mp4' }) as any;
    expect(noToken.method).toBe('aria2.addUri');
    expect(noToken.params[0]).toEqual(['https://a.com/v.mp4']);
    expect(noToken.params[1].out).toBe('v.mp4');

    const withToken = buildAria2AddUriPayload(cfg({ aria2Secret: 's3cret' }), { url: 'https://a.com/v.mp4' }) as any;
    expect(withToken.params[0]).toBe('token:s3cret');
    expect(withToken.params[1]).toEqual(['https://a.com/v.mp4']);
  });

  it('Referer / User-Agent 以 header 数组下发（缺了它们很多站点 403）', () => {
    const p = buildAria2AddUriPayload(cfg(), {
      url: 'https://a.com/v.mp4', referer: 'https://site/page', userAgent: 'Mozilla/5.0'
    }) as any;
    expect(p.params[1].header).toEqual(['Referer: https://site/page', 'User-Agent: Mozilla/5.0']);
    const bare = buildAria2AddUriPayload(cfg(), { url: 'https://a.com/v.mp4' }) as any;
    expect(bare.params[1].header).toBeUndefined();
  });

  it('tellStatus 只取需要的字段，避免大应答', () => {
    const p = buildAria2TellStatusPayload(cfg({ aria2Secret: 'k' }), 'gid1') as any;
    expect(p.method).toBe('aria2.tellStatus');
    expect(p.params).toEqual(['token:k', 'gid1', ['status', 'totalLength', 'completedLength', 'downloadSpeed', 'errorMessage']]);
  });
});

describe('parseAria2Response：字符串数值与错误归因', () => {
  it('result 为字符串时是 gid', () => {
    const r = parseAria2Response({ jsonrpc: '2.0', id: 'x', result: 'abc123' });
    expect(r.ok).toBe(true);
    expect(r.data).toBe('abc123');
  });

  it('状态字段是十进制字符串，进度按 total 归一化', () => {
    const r = parseAria2Response({ result: { status: 'active', totalLength: '1000', completedLength: '250', downloadSpeed: '500' } });
    expect(r.ok).toBe(true);
    const s = r.data as any;
    expect(s.progress).toBeCloseTo(0.25);
    expect(s.totalBytes).toBe(1000);
    expect(s.completedBytes).toBe(250);
    expect(s.speedBps).toBe(500);
  });

  it('totalLength 为 0（未知体积）时进度为 0 而不是 NaN', () => {
    const s = parseAria2Response({ result: { status: 'active', totalLength: '0', completedLength: '10' } }).data as any;
    expect(s.progress).toBe(0);
    expect(Number.isNaN(s.progress)).toBe(false);
  });

  it('Origin 被拒时给出可执行的修复提示，而不是原样抛 403', () => {
    const r = parseAria2Response({ error: { code: 1, message: 'Forbidden origin' } });
    expect(r.ok).toBe(false);
    expect(r.error).toContain('--rpc-origin-whitelist-required=false');
  });

  it('普通错误带上错误码；非法结构不冒充成功', () => {
    expect(parseAria2Response({ error: { code: 7, message: 'no such gid' } }).error).toContain('7');
    expect(parseAria2Response(null).ok).toBe(false);
    expect(parseAria2Response({ jsonrpc: '2.0' }).ok).toBe(false);
  });
});

describe('本机工具 argv 构造', () => {
  it('m3u8DL-RE 用 --header 传来源头，文件名已消毒', () => {
    const args = buildM3u8DlArgs({ url: 'https://a.com/index.m3u8', fileName: '../out/name.mp4', referer: 'https://site/' });
    expect(args).toContain('--input-url');
    expect(args[args.indexOf('--save-name') + 1]).toBe('name.mp4');
    expect(args).toContain('Referer:https://site/');
  });

  it('ffmpeg 的 header 必须以 CRLF 结尾（写成 LF 会被静默忽略）', () => {
    const args = buildFfmpegArgs({ url: 'https://a.com/index.m3u8', fileName: 'out.mp4', referer: 'https://site/', userAgent: 'UA' });
    const headers = args[args.indexOf('-headers') + 1];
    expect(headers.endsWith('\r\n')).toBe(true);
    expect(headers).toContain('Referer: https://site/\r\n');
    expect(headers).toContain('User-Agent: UA\r\n');
    expect(args[args.length - 1]).toBe('out.mp4');
    expect(args).toContain('-c');
  });

  it('无来源头时不产生空的 -headers 参数', () => {
    const args = buildFfmpegArgs({ url: 'https://a.com/v.mp4' });
    expect(args).not.toContain('-headers');
  });

  it('非法 URL 在构造阶段就被拦下，不会送到本机进程', () => {
    expect(buildNativeDownloadRequest(1, 'm3u8dl', { url: 'file:///C:/a' }).ok).toBe(false);
    const ok = buildNativeDownloadRequest(2, 'ffmpeg', { url: 'https://a.com/v.mp4', fileName: 'v.mp4' });
    expect(ok.ok).toBe(true);
    expect(ok.data!.reqId).toBe(2);
    expect(ok.data!.args[ok.data!.args.length - 1]).toBe('v.mp4');
  });

  it('任一 argv 无法安全表达时整体拒绝（调用方回退内置链路）', () => {
    const r = buildNativeDownloadRequest(3, 'ffmpeg', { url: 'https://a.com/v.mp4', referer: 'https://site/a"b' });
    expect(r.ok).toBe(false);
    expect(r.error).toContain('内置下载');
  });

  it('fileName 是消毒后的落盘名，不是 argv 末项；带 CRLF 的 header 能通过闸门', () => {
    const m = buildNativeDownloadRequest(4, 'm3u8dl', { url: 'https://a.com/i.m3u8', fileName: '../x/名字.mp4', referer: 'https://site/' });
    expect(m.ok).toBe(true);
    expect(m.data!.fileName).toBe('名字.mp4');
    const f = buildNativeDownloadRequest(5, 'ffmpeg', { url: 'https://a.com/i.m3u8', fileName: 'n.mp4', referer: 'https://site/', userAgent: 'UA' });
    expect(f.ok).toBe(true);
    expect(f.data!.fileName).toBe('n.mp4');
    expect(f.data!.args.every(isSafeNativeArg)).toBe(true);
  });
});

describe('pickExternalTool：通道选择保守优先', () => {
  it('总开关关闭时一律不走外挂', () => {
    expect(pickExternalTool(cfg({ enabled: false }), 'file')).toBeNull();
    expect(pickExternalTool(cfg({ enabled: false, preferForStreams: true }), 'stream')).toBeNull();
  });

  it('分段流默认不外发（内置引擎已支持加密清单与重试）', () => {
    expect(pickExternalTool(cfg({ enabled: true }), 'stream')).toBeNull();
    expect(pickExternalTool(cfg({ enabled: true, preferForStreams: true }), 'stream')).toBe('aria2');
  });

  it('本机工具选了就用它，没选则回落到 aria2', () => {
    expect(pickExternalTool(cfg({ enabled: true, nativeTool: 'off' }), 'file')).toBe('aria2');
    expect(pickExternalTool(cfg({ enabled: true, nativeTool: 'm3u8dl' }), 'file')).toBe('m3u8dl');
    expect(pickExternalTool(cfg({ enabled: true, nativeTool: 'ffmpeg', preferForStreams: true }), 'stream')).toBe('ffmpeg');
  });
});
