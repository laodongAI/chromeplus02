import { describe, it, expect } from 'vitest';
import { classifyNetworkMedia, extFromUrl } from '@/utils/mediaType';

describe('extFromUrl', () => {
  it('提取路径扩展名并忽略 query/hash', () => {
    expect(extFromUrl('https://a.com/v/video.mp4?start=0')).toBe('mp4');
    expect(extFromUrl('https://a.com/v/video.MP4#t=1')).toBe('mp4');
    expect(extFromUrl('https://a.com/live/index.m3u8?token=x')).toBe('m3u8');
  });

  it('无扩展名返回 undefined', () => {
    expect(extFromUrl('https://a.com/play/123')).toBeUndefined();
    expect(extFromUrl('')).toBeUndefined();
  });
});

describe('classifyNetworkMedia', () => {
  it('按扩展名识别视频', () => {
    expect(classifyNetworkMedia('https://a.com/v.mp4').kind).toBe('video');
    expect(classifyNetworkMedia('https://a.com/v.webm?x=1').kind).toBe('video');
    expect(classifyNetworkMedia('https://a.com/seg.ts').kind).toBe('video');
    expect(classifyNetworkMedia('https://a.com/seg.m4s').kind).toBe('video');
  });

  it('按扩展名识别音频', () => {
    expect(classifyNetworkMedia('https://a.com/a.mp3').kind).toBe('audio');
    expect(classifyNetworkMedia('https://a.com/a.flac?x=1').kind).toBe('audio');
    expect(classifyNetworkMedia('https://a.com/a.m4a').kind).toBe('audio');
  });

  it('识别 HLS / DASH 清单', () => {
    expect(classifyNetworkMedia('https://a.com/index.m3u8').kind).toBe('hls');
    expect(classifyNetworkMedia('https://a.com/manifest.mpd').kind).toBe('dash');
  });

  it('扩展名缺失时按 Content-Type 识别', () => {
    expect(classifyNetworkMedia('https://a.com/play/123', 'application/vnd.apple.mpegurl').kind).toBe('hls');
    expect(classifyNetworkMedia('https://a.com/play/123', 'application/dash+xml').kind).toBe('dash');
    expect(classifyNetworkMedia('https://a.com/play/123', 'video/mp4').kind).toBe('video');
    expect(classifyNetworkMedia('https://a.com/play/123', 'audio/mp4').kind).toBe('audio');
  });

  it('扩展名优先于 Content-Type', () => {
    const r = classifyNetworkMedia('https://a.com/a.mp3', 'video/mp4');
    expect(r.kind).toBe('audio');
    expect(r.extension).toBe('mp3');
  });

  it('非媒体资源返回 null', () => {
    expect(classifyNetworkMedia('https://a.com/api/data', 'application/json').kind).toBeNull();
    expect(classifyNetworkMedia('https://a.com/page.html').kind).toBeNull();
  });

  it('从 Content-Type 推断扩展名', () => {
    expect(classifyNetworkMedia('https://a.com/stream/1', 'application/vnd.apple.mpegurl').extension).toBe('m3u8');
    expect(classifyNetworkMedia('https://a.com/stream/1', 'video/mp4').extension).toBe('mp4');
  });

  // 实测 YouTube 播放页：媒体请求为 POST /videoplayback?sabr=1，响应 application/vnd.yt-ump，
  // URL 无扩展名。旧规则两条都不命中 → kind=null → 后台整条丢弃，面板显示"未检测到"。
  it('识别 YouTube SABR/UMP 流为只能录制的视频', () => {
    const url = 'https://rr2---sn-a5meknzk.googlevideo.com/videoplayback?expire=1794341003&sabr=1&rn=5';
    const r = classifyNetworkMedia(url, 'application/vnd.yt-ump');
    expect(r.kind).toBe('video');
    expect(r.streamOnly).toBe(true);
    // 拿不到 Content-Type 时按端点兜底
    expect(classifyNetworkMedia(url).streamOnly).toBe(true);
  });

  it('YouTube 渐进式 mp4 仍可直链，不标记 streamOnly', () => {
    const r = classifyNetworkMedia('https://rr2---sn-x.googlevideo.com/videoplayback?itag=18', 'video/mp4');
    expect(r.kind).toBe('video');
    expect(r.streamOnly).toBeUndefined();
  });

  it('相似域名与非媒体响应不误判为 YouTube 流', () => {
    expect(classifyNetworkMedia('https://notgooglevideo.com/videoplayback').kind).toBeNull();
    expect(classifyNetworkMedia('https://googlevideo.com.evil.com/videoplayback').kind).toBeNull();
    expect(classifyNetworkMedia('https://a.com/videoplayback', 'application/json').kind).toBeNull();
  });
});
