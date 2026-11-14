/**
 * 嗅探条目展示元信息单测（Round 5 #27）。
 * 核心约定：字段未知时必须返回 undefined/''，UI 才能显示「—」而不是 0 —— 把未知渲染成
 * 「0 B / 0×0」会让用户误判成空文件，这是本模块存在的唯一理由，故逐条钉住。
 */
import { describe, it, expect } from 'vitest';
import {
  formatLabelOf, heightTier, parseResolutionString, resolutionLabelOf,
  sizeLabelOf, durationLabelOf, searchableTextOf,
} from '@/core/mediaMeta';

describe('formatLabelOf', () => {
  it('显式扩展名 > URL 扩展名 > Content-Type', () => {
    expect(formatLabelOf({ url: 'https://a.com/x.mp3', extension: 'm4a' })).toBe('M4A');
    expect(formatLabelOf({ url: 'https://a.com/x.mp3' })).toBe('MP3');
    expect(formatLabelOf({ url: 'https://a.com/play/1', mimeType: 'audio/mpeg' })).toBe('MP3');
  });

  it('扩展名大小写与前导点都归一', () => {
    expect(formatLabelOf({ url: 'https://a.com/x.MP4' })).toBe('MP4');
    expect(formatLabelOf({ url: 'https://a.com/x', extension: '.FLAC' })).toBe('FLAC');
  });

  it('流媒体清单带协议名，用户能区分「一个文件」和「一条流」', () => {
    expect(formatLabelOf({ url: 'https://a.com/index.m3u8' })).toBe('HLS');
    expect(formatLabelOf({ url: 'https://a.com/manifest.mpd' })).toBe('DASH');
    expect(formatLabelOf({ url: 'https://a.com/x', mimeType: 'application/vnd.apple.mpegurl' })).toBe('HLS');
  });

  it('opus 不被 ogg 吞掉（两者 MIME 互为子串）', () => {
    expect(formatLabelOf({ url: 'https://a.com/x', mimeType: 'audio/opus' })).toBe('OPUS');
    expect(formatLabelOf({ url: 'https://a.com/x', mimeType: 'audio/ogg' })).toBe('OGG');
  });

  it('认不出的签名直链返回 undefined，不编造格式', () => {
    expect(formatLabelOf({ url: 'https://cdn.example.com/s/9f3a1c?token=x' })).toBeUndefined();
    expect(formatLabelOf({ url: 'https://a.com/x', mimeType: 'application/octet-stream' })).toBeUndefined();
    expect(formatLabelOf({ url: '' })).toBeUndefined();
  });
});

describe('heightTier / parseResolutionString / resolutionLabelOf', () => {
  it('档位按垂直分辨率归档', () => {
    expect(heightTier(2160)).toBe('4K');
    expect(heightTier(2880)).toBe('4K');
    expect(heightTier(1440)).toBe('2K');
    expect(heightTier(1080)).toBe('1080P');
    expect(heightTier(360)).toBe('360P');
  });

  it('高度未知/非法不给档位', () => {
    for (const bad of [undefined, 0, -1, NaN, Infinity]) expect(heightTier(bad)).toBeUndefined();
  });

  it('解析 RESOLUTION 属性，畸形值返回 null 而不是抛', () => {
    expect(parseResolutionString('1920x1080')).toEqual({ width: 1920, height: 1080 });
    expect(parseResolutionString(' 1280 × 720 ')).toEqual({ width: 1280, height: 720 });
    for (const bad of [undefined, '', '1920', 'x', 'axb', '0x0', '1920x0']) {
      expect(parseResolutionString(bad)).toBeNull();
    }
  });

  it('宽+高给全量，只有高给档位，都没有给 undefined', () => {
    expect(resolutionLabelOf({ width: 1920, height: 1080 })).toBe('1920×1080 1080P');
    expect(resolutionLabelOf({ height: 480 })).toBe('480P');
    expect(resolutionLabelOf({ width: 1920 })).toBeUndefined();
    expect(resolutionLabelOf({})).toBeUndefined();
  });
});

describe('sizeLabelOf / durationLabelOf', () => {
  it('体积按 1024 进制，未知与非法给空串', () => {
    expect(sizeLabelOf(0)).toBe('0 B');
    expect(sizeLabelOf(512)).toBe('512 B');
    expect(sizeLabelOf(1536)).toBe('1.5 KB');
    expect(sizeLabelOf(1024 ** 2)).toBe('1 MB');
    expect(sizeLabelOf(1024 ** 3 * 2.5)).toBe('2.5 GB');
    expect(sizeLabelOf(1024 ** 4 * 120)).toBe('120 TB');
    for (const bad of [undefined, -1, NaN]) expect(sizeLabelOf(bad)).toBe('');
  });

  it('时长不足一小时省略小时位', () => {
    expect(durationLabelOf(0)).toBe('0:00');
    expect(durationLabelOf(65)).toBe('1:05');
    expect(durationLabelOf(3600)).toBe('1:00:00');
    expect(durationLabelOf(3661)).toBe('1:01:01');
    expect(durationLabelOf(59.6)).toBe('1:00');
    for (const bad of [undefined, -1, NaN]) expect(durationLabelOf(bad)).toBe('');
  });
});

describe('searchableTextOf', () => {
  it('把标题/地址/格式/清晰度/类型拼成一条小写文本供裸词匹配', () => {
    const text = searchableTextOf({
      url: 'https://Bilibili.com/v.m3u8', title: '周杰倫 MV',
      kind: 'hls', width: 1280, height: 720
    });
    expect(text).toContain('周杰倫 mv');
    expect(text).toContain('bilibili.com/v.m3u8');
    expect(text).toContain('hls');
    expect(text).toContain('1280×720 720p');
  });

  it('字段缺失时不写出 undefined 字样，也不留多余空格', () => {
    expect(searchableTextOf({ url: 'https://a.com/x' })).toBe('https://a.com/x');
  });
});
