/**
 * 音频标题清洗与格式覆盖单测（抓取深审 T2-C 之一）。
 * 缺陷背景：
 *  1. AUDIO_EXT 漏 .flac/.opus，DOM 通道扫不到无损与 Opus 音频（只能靠网络嗅探补）；
 *  2. 标题兜底 document.title、锚文本直接采纳 → 整页音频都叫"下载"或站点名，列表不可用。
 * 手法：cleanAudioTitle / audioTitleFromUrl 为纯函数直接测；
 *       isAudioUrl 仅在扩展名未命中时才读 document.baseURI，故桩一个最小 document。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { cleanAudioTitle, audioTitleFromUrl, isAudioUrl } from '@/content-scripts/audio';

beforeEach(() => {
  vi.stubGlobal('document', { baseURI: 'https://example.com/list' });
});

describe('isAudioUrl：扩展名覆盖', () => {
  it.each(['mp3', 'm4a', 'aac', 'wav', 'ogg', 'flac', 'opus'])('.%s 被识别为音频', (ext) => {
    expect(isAudioUrl(`https://cdn.example.com/track.${ext}`)).toBe(true);
  });

  it('带查询串的后缀仍被识别（正则要求后缀位于 ? 或串尾）', () => {
    expect(isAudioUrl('https://cdn.example.com/track.flac?token=abc')).toBe(true);
    expect(isAudioUrl('https://cdn.example.com/track.opus?v=2')).toBe(true);
  });

  it('非音频后缀不误判', () => {
    expect(isAudioUrl('https://cdn.example.com/page.html')).toBe(false);
    expect(isAudioUrl('https://cdn.example.com/video.mp4')).toBe(false);
    expect(isAudioUrl('')).toBe(false);
  });

  it('无后缀但查询参数带 MIME 提示时识别为音频', () => {
    expect(isAudioUrl('https://cdn.example.com/stream?type=audio/mpeg')).toBe(true);
    expect(isAudioUrl('https://cdn.example.com/stream?mime=flac')).toBe(true);
    expect(isAudioUrl('https://cdn.example.com/stream?mime=opus')).toBe(true);
    expect(isAudioUrl('https://cdn.example.com/stream?type=video/mp4')).toBe(false);
  });
});

describe('cleanAudioTitle：候选优先级与噪声剔除', () => {
  const url = 'https://cdn.example.com/audio/jay_chou-qing_hua_ci.mp3';

  it('按顺序取第一个有效候选', () => {
    expect(cleanAudioTitle(['青花瓷', '下载'], url)).toBe('青花瓷');
    expect(cleanAudioTitle([null, undefined, '  ', '晴天'], url)).toBe('晴天');
  });

  it.each(['下载', '点击下载', '播放', '点击播放', '立即播放', '试听', '更多', '音频', 'MP3', 'Download', 'PLAY', '▶', '。。。'])(
    '纯按钮文案/符号「%s」被跳过，退到 URL 文件名', (noise) => {
      expect(cleanAudioTitle([noise], url)).toBe('jay chou-qing hua ci');
    });

  it('噪声判定是整串精确匹配，不子串误伤有效标题', () => {
    expect(cleanAudioTitle(['播放列表：周杰伦精选'], url)).toBe('播放列表：周杰伦精选');
    expect(cleanAudioTitle(['下载说明与曲目介绍'], url)).toBe('下载说明与曲目介绍');
    expect(cleanAudioTitle(['Music Review: 2026 年度盘点'], url)).toBe('Music Review: 2026 年度盘点');
  });

  it('折叠空白、去零宽字符、去首尾空白', () => {
    expect(cleanAudioTitle(['  青花瓷   \n  周杰伦  '], url)).toBe('青花瓷 周杰伦');
    expect(cleanAudioTitle(['青\u200b花\ufeff瓷'], url)).toBe('青花瓷');
  });

  it('尾部标点不影响噪声判定（"下载。"同样是按钮文案）', () => {
    expect(cleanAudioTitle(['下载。'], url)).toBe('jay chou-qing hua ci');
    expect(cleanAudioTitle(['Play!'], url)).toBe('jay chou-qing hua ci');
  });

  it('全部候选无效时退到 URL 文件名，而不是整页标题', () => {
    expect(cleanAudioTitle([], url)).toBe('jay chou-qing hua ci');
    expect(cleanAudioTitle([null, undefined, ''], url)).toBe('jay chou-qing hua ci');
  });

  it('超长候选被截到 200 字，避免把简介当标题', () => {
    const long = '曲'.repeat(500);
    expect(cleanAudioTitle([long], url)).toHaveLength(200);
  });

  it('有效候选优先于文件名，即使文件名更像曲名', () => {
    expect(cleanAudioTitle(['现场版'], url)).toBe('现场版');
  });
});

describe('audioTitleFromUrl：文件名兜底', () => {
  it('去扩展名、下划线转空格、解码百分号编码', () => {
    expect(audioTitleFromUrl('https://cdn.example.com/a/%E9%9D%92%E8%8A%B1%E7%93%B7.flac')).toBe('青花瓷');
    expect(audioTitleFromUrl('https://cdn.example.com/a/01_-_track_name.opus')).toBe('01 - track name');
  });

  it('保留音轨序号（用户可能按序号排序，不做过度清洗）', () => {
    expect(audioTitleFromUrl('https://cdn.example.com/a/03%20Song.mp3')).toBe('03 Song');
  });

  it('查询串与 fragment 不进入标题', () => {
    expect(audioTitleFromUrl('https://cdn.example.com/a/song.mp3?token=x#t=10')).toBe('song');
  });

  it('data:/blob: 无有意义文件名，返回空串交由 UI 落到「未命名音频」', () => {
    expect(audioTitleFromUrl('data:audio/mpeg;base64,AAAA')).toBe('');
    expect(audioTitleFromUrl('blob:https://example.com/1234-5678')).toBe('');
  });

  it('文件名即便是泛词也照实给出（事实证据优先于黑名单，好过一排「未命名音频」）', () => {
    expect(audioTitleFromUrl('https://cdn.example.com/a/download.mp3')).toBe('download');
    expect(audioTitleFromUrl('https://cdn.example.com/audio.mp3')).toBe('audio');
    expect(audioTitleFromUrl('https://cdn.example.com/a/song.mp3')).toBe('song');
  });

  it('无路径 / 非法 URL 不抛异常', () => {
    expect(audioTitleFromUrl('https://cdn.example.com/')).toBe('');
    expect(() => audioTitleFromUrl('http://')).not.toThrow();
  });
});