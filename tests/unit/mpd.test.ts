import { describe, it, expect } from 'vitest';
import { parseMPD, pickBestDashVideo, expandTemplate } from '@/core/mpd';

const BASE = 'https://cdn.example.com/video/manifest.mpd';

const STATIC_MPD = `<?xml version="1.0" encoding="utf-8"?>
<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" type="static" mediaPresentationDuration="PT10M30S">
  <Period>
    <AdaptationSet contentType="video" mimeType="video/mp4">
      <SegmentTemplate timescale="90000" duration="540000" startNumber="1" initialization="$RepresentationID$/init.mp4" media="$RepresentationID$/seg-$Number%05d$.m4s"/>
      <Representation id="v1080" bandwidth="4000000" codecs="avc1.640028" width="1920" height="1080"/>
      <Representation id="v360" bandwidth="800000" codecs="avc1.42c01e" width="640" height="360"/>
    </AdaptationSet>
  </Period>
</MPD>`;

describe('parseMPD: 静态 MPD（$Number$ 模板）', () => {
  it('解析表示并按总时长展开分片', () => {
    const r = parseMPD(STATIC_MPD, BASE);
    expect(r.isDynamic).toBe(false);
    expect(r.durationSeconds).toBe(630);
    expect(r.videoRepresentations).toHaveLength(2);
    const best = pickBestDashVideo(r.videoRepresentations)!;
    expect(best.id).toBe('v1080');
    expect(best.width).toBe(1920);
    // 630s / (540000/90000=6s) = 105 片
    expect(best.segments).toHaveLength(105);
    expect(best.initialization).toBe('https://cdn.example.com/video/v1080/init.mp4');
    expect(best.segments[0]).toBe('https://cdn.example.com/video/v1080/seg-00001.m4s');
    expect(best.segments[104]).toBe('https://cdn.example.com/video/v1080/seg-00105.m4s');
  });

  it('音视频分轨分别归类', () => {
    const mpd = STATIC_MPD.replace('</Period>', `</Period>
    <Period><AdaptationSet contentType="audio" mimeType="audio/mp4">
      <SegmentTemplate timescale="48000" duration="960000" media="a/$Number$.m4a"/>
      <Representation id="a128" bandwidth="128000"/>
    </AdaptationSet></Period>`).replace('<Period>', '<Period>');
    // 多 Period 会进入 unsupported —— 单独测音频归类用单 Period 版本
    const single = STATIC_MPD.replace('</AdaptationSet>', `</AdaptationSet>
      <AdaptationSet contentType="audio" mimeType="audio/mp4">
        <SegmentTemplate timescale="48000" duration="960000" media="a/$Number$.m4a"/>
        <Representation id="a128" bandwidth="128000"/>
      </AdaptationSet>`);
    const r = parseMPD(single, BASE);
    expect(r.audioRepresentations).toHaveLength(1);
    expect(r.videoRepresentations).toHaveLength(2);
  });

  it('多 Period 与动态直播进入不支持/动态分支', () => {
    const multi = STATIC_MPD.replace('</Period>', '</Period><Period><AdaptationSet contentType="video"><Representation id="x" bandwidth="1"/></AdaptationSet></Period>');
    const r1 = parseMPD(multi, BASE);
    expect(r1.unsupported).toContain('多 Period（多片段节目）');
    const live = STATIC_MPD.replace('type="static"', 'type="dynamic"');
    expect(parseMPD(live, BASE).isDynamic).toBe(true);
  });

  it('SegmentBase 标记为不支持', () => {
    const mpd = `<?xml version="1.0"?><MPD type="static"><Period>
      <AdaptationSet contentType="video"><Representation id="v" bandwidth="1"><BaseURL>v.mp4</BaseURL><SegmentBase indexRange="0-100"/></Representation></AdaptationSet>
    </Period></MPD>`;
    const r = parseMPD(mpd, BASE);
    expect(r.unsupported.join()).toContain('SegmentBase');
  });
});

describe('parseMPD: SegmentTimeline（$Time$ 模板）', () => {
  it('按 S(t,d,r) 展开时间序列', () => {
    const mpd = `<?xml version="1.0"?><MPD type="static" mediaPresentationDuration="PT12S"><Period>
      <AdaptationSet contentType="video" mimeType="video/mp4">
        <SegmentTemplate timescale="1" media="s-$Time$.m4s" initialization="i.mp4">
          <SegmentTimeline><S t="0" d="4" r="2"/></SegmentTimeline>
        </SegmentTemplate>
        <Representation id="v" bandwidth="1000"/>
      </AdaptationSet>
    </Period></MPD>`;
    const r = parseMPD(mpd, BASE);
    const rep = pickBestDashVideo(r.videoRepresentations)!;
    expect(rep.segments).toHaveLength(3);
    expect(rep.segments.map(s => s.split('/').pop())).toEqual(['s-0.m4s', 's-4.m4s', 's-8.m4s']);
    expect(rep.initialization).toBe('https://cdn.example.com/video/i.mp4');
  });
});

describe('expandTemplate', () => {
  it('替换变量与 printf 补零、$$ 转义', () => {
    expect(expandTemplate('$RepresentationID$/seg-$Number%05d$.m4s', { RepresentationID: 'v1', Number: 42 })).toBe('v1/seg-00042.m4s');
    expect(expandTemplate('$Bandwidth$-$Time$', { Bandwidth: 128000, Time: 96000 })).toBe('128000-96000');
    expect(expandTemplate('a$$b', {})).toBe('a$b');
  });
});
