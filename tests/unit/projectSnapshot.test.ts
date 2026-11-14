/**
 * 编辑器工程快照契约单测（自动保存 / 崩溃恢复）。
 * 覆盖：
 *  1. toPersistedMedia —— blob:/data: 这类随文档失效的 URL 必须置空，http 直链保留，入参不被就地改；
 *  2. parseProjectSnapshot —— 版本/结构不符一律拒绝恢复，可选字段给默认值；
 *  3. hasRecoverableContent / collectMaterialKeys —— 空工程不打扰用户，
 *     且素材键收集绝不能纳入 caprec_ 等他人所有的键（纳入即意味着会被回收删掉）；
 *  4. isOrphanMaterial —— 前缀、引用、TTL 三道闸门缺一不可，宁可留着也不误删。
 */
import { describe, it, expect } from 'vitest';
import {
  EDITOR_PROJECT_KEY, EDITOR_MATERIAL_PREFIX, PROJECT_SNAPSHOT_VERSION, MATERIAL_TTL_MS,
  newMaterialKey, isDocumentUrl, toPersistedMedia, parseProjectSnapshot,
  hasRecoverableContent, collectMaterialKeys, isOrphanMaterial,
  type PersistedProject,
} from '@/editor/projectSnapshot';

/** 造一份最小可用工程（各测试按需覆盖字段） */
function makeProject(over: Partial<PersistedProject> = {}): PersistedProject {
  return {
    version: PROJECT_SNAPSHOT_VERSION,
    savedAt: 1_700_000_000_000,
    tracks: [{ clips: [], locked: false, visible: true, muted: false }],
    dubs: [],
    caps: [],
    markers: [],
    audioTracks: [],
    bgVolume: 80,
    bgMuted: false,
    masterVolume: 1,
    ...over,
  };
}
/** 造一条落盘媒体条目 */
function media(over: Record<string, unknown> = {}) {
  return { id: 'c_1', url: '', name: '片段', ...over };
}

describe('newMaterialKey / 键所有权', () => {
  it('生成的键带工程自有前缀，且不与既有前缀混淆', () => {
    const k = newMaterialKey();
    expect(k.startsWith(EDITOR_MATERIAL_PREFIX)).toBe(true);
    expect(k.startsWith('caprec_')).toBe(false);
    expect(k.startsWith('editor_handoff_')).toBe(false);
  });

  it('连续生成不重复', () => {
    const keys = new Set(Array.from({ length: 200 }, () => newMaterialKey()));
    expect(keys.size).toBe(200);
  });

  it('工程槽位键不落在素材前缀下（否则会被孤儿回收当成素材删掉）', () => {
    expect(EDITOR_PROJECT_KEY.startsWith(EDITOR_MATERIAL_PREFIX)).toBe(false);
  });
});

describe('isDocumentUrl / toPersistedMedia', () => {
  it('识别随文档失效的 blob: 与 data:', () => {
    expect(isDocumentUrl('blob:chrome-extension://abc/123')).toBe(true);
    expect(isDocumentUrl('data:video/mp4;base64,AAAA')).toBe(true);
    expect(isDocumentUrl('https://example.com/a.mp4')).toBe(false);
    expect(isDocumentUrl('')).toBe(false);
    expect(isDocumentUrl(undefined)).toBe(false);
    expect(isDocumentUrl(42)).toBe(false);
  });

  it('blob: URL 落盘前置空，耐久引用原样保留', () => {
    const clip = { id: 'c_1', url: 'blob:chrome-extension://abc/123', materialKey: 'editor_mat_1', trimStart: 2 };
    const out = toPersistedMedia(clip);
    expect(out.url).toBe('');
    expect(out.materialKey).toBe('editor_mat_1');
    expect(out.trimStart).toBe(2);
  });

  it('data: URL 同样置空（体积巨大且不是耐久引用）', () => {
    expect(toPersistedMedia({ id: 'c_1', url: 'data:video/mp4;base64,AAAA' }).url).toBe('');
  });

  it('http 直链保留：恢复时靠它重抓', () => {
    const out = toPersistedMedia({ id: 'c_1', url: 'https://example.com/a.mp4', sourceUrl: 'https://example.com/a.mp4' });
    expect(out.url).toBe('https://example.com/a.mp4');
    expect(out.sourceUrl).toBe('https://example.com/a.mp4');
  });

  it('不就地改入参：自动保存与 Undo 快照共用同一批对象', () => {
    const clip = { id: 'c_1', url: 'blob:x', materialKey: 'editor_mat_1' };
    const out = toPersistedMedia(clip);
    expect(clip.url).toBe('blob:x');
    expect(out).not.toBe(clip);
  });

  it('已是空 url 的条目也返回新对象，不与运行态共享引用', () => {
    const clip = { id: 'c_1', url: '' };
    expect(toPersistedMedia(clip)).not.toBe(clip);
    expect(toPersistedMedia(clip)).toEqual(clip);
  });
});

describe('parseProjectSnapshot（拒绝半恢复）', () => {
  it('合法快照原样解析', () => {
    const p = makeProject({ dubs: [media({ materialKey: 'editor_mat_1' })] });
    const parsed = parseProjectSnapshot(p);
    expect(parsed).not.toBeNull();
    expect(parsed!.savedAt).toBe(p.savedAt);
    expect(parsed!.dubs).toHaveLength(1);
  });

  it('非对象一律 null', () => {
    for (const raw of [null, undefined, 0, '', 'x', true, []]) {
      expect(parseProjectSnapshot(raw)).toBeNull();
    }
  });

  it('版本不兼容一律 null，不按旧字段猜', () => {
    expect(parseProjectSnapshot(makeProject({ version: PROJECT_SNAPSHOT_VERSION + 1 }))).toBeNull();
    expect(parseProjectSnapshot({ ...makeProject(), version: undefined })).toBeNull();
    expect(parseProjectSnapshot({ ...makeProject(), version: '1' })).toBeNull();
  });

  it('savedAt 缺失或非有限数一律 null', () => {
    for (const savedAt of [undefined, '1700000000000', NaN, Infinity]) {
      expect(parseProjectSnapshot({ ...makeProject(), savedAt })).toBeNull();
    }
  });

  it('tracks / dubs 不是数组一律 null', () => {
    expect(parseProjectSnapshot({ ...makeProject(), tracks: {} })).toBeNull();
    expect(parseProjectSnapshot({ ...makeProject(), dubs: null })).toBeNull();
  });

  it('轨道缺 clips 数组一律 null：半恢复会错位整条时间线', () => {
    expect(parseProjectSnapshot({ ...makeProject(), tracks: [{ locked: false }] })).toBeNull();
    expect(parseProjectSnapshot({ ...makeProject(), tracks: [null] })).toBeNull();
    expect(parseProjectSnapshot({ ...makeProject(), tracks: [{ clips: {} }] })).toBeNull();
  });

  it('可选字段缺失时给默认值，不因缺字段放弃整个工程', () => {
    const parsed = parseProjectSnapshot({
      version: PROJECT_SNAPSHOT_VERSION, savedAt: 1, tracks: [], dubs: [],
    })!;
    expect(parsed).not.toBeNull();
    expect(parsed.caps).toEqual([]);
    expect(parsed.markers).toEqual([]);
    expect(parsed.audioTracks).toEqual([]);
    expect(parsed.bgVolume).toBe(80);
    expect(parsed.bgMuted).toBe(false);
    expect(parsed.masterVolume).toBe(1);
    expect(parsed.bgMusicKey).toBeUndefined();
    expect(parsed.bgMusicName).toBeUndefined();
  });

  it('可选字段类型错误时退回默认值而非塞进脏数据', () => {
    const parsed = parseProjectSnapshot({
      ...makeProject(), caps: 'x', markers: 3, audioTracks: {}, bgVolume: '80', masterVolume: null, bgMusicKey: 7, bgMusicName: {},
    })!;
    expect(parsed.caps).toEqual([]);
    expect(parsed.markers).toEqual([]);
    expect(parsed.audioTracks).toEqual([]);
    expect(parsed.bgVolume).toBe(80);
    expect(parsed.masterVolume).toBe(1);
    expect(parsed.bgMusicKey).toBeUndefined();
    expect(parsed.bgMusicName).toBeUndefined();
  });

  it('背景音乐名与键都能往返（Blob 取回后不带文件名）', () => {
    const parsed = parseProjectSnapshot(makeProject({ bgMusicKey: 'editor_mat_bg', bgMusicName: '夜曲.mp3' }))!;
    expect(parsed.bgMusicKey).toBe('editor_mat_bg');
    expect(parsed.bgMusicName).toBe('夜曲.mp3');
  });

  it('bgMuted 走真值归一，非布尔脏值不落成 truthy 对象', () => {
    expect(parseProjectSnapshot({ ...makeProject(), bgMuted: 1 })!.bgMuted).toBe(true);
    expect(parseProjectSnapshot({ ...makeProject(), bgMuted: 0 })!.bgMuted).toBe(false);
  });
});

describe('hasRecoverableContent（空工程不打扰用户）', () => {
  it('只有空轨道 → 不值得提示', () => {
    expect(hasRecoverableContent(makeProject())).toBe(false);
    expect(hasRecoverableContent(makeProject({ tracks: [] }))).toBe(false);
  });

  it('有片段 / 配音 / 字幕任一 → 值得提示', () => {
    expect(hasRecoverableContent(makeProject({ tracks: [{ clips: [media()], locked: false, visible: true, muted: false }] }))).toBe(true);
    expect(hasRecoverableContent(makeProject({ dubs: [media()] }))).toBe(true);
    expect(hasRecoverableContent(makeProject({ caps: [{ text: 'hi' }] }))).toBe(true);
  });

  it('只有标记点不算内容（没有素材可恢复）', () => {
    expect(hasRecoverableContent(makeProject({ markers: [{ id: 'm', t: 1, label: 'x' }] }))).toBe(false);
  });
});

describe('collectMaterialKeys（所有权边界）', () => {
  it('收集片段 / 配音 / 背景音乐三处的工程自有键', () => {
    const p = makeProject({
      tracks: [{ clips: [media({ materialKey: 'editor_mat_a' }), media({ materialKey: 'editor_mat_b' })], locked: false, visible: true, muted: false }],
      dubs: [media({ materialKey: 'editor_mat_c' })],
      bgMusicKey: 'editor_mat_bg',
    });
    expect(collectMaterialKeys(p).sort()).toEqual(['editor_mat_a', 'editor_mat_b', 'editor_mat_bg', 'editor_mat_c']);
  });

  it('caprec_ 录制成果与一次性交接键绝不纳入（纳入即会被回收删掉）', () => {
    const p = makeProject({
      tracks: [{ clips: [media({ materialKey: 'caprec_1' }), media({ materialKey: 'editor_handoff_1' }), media({ materialKey: 'editor_mat_a' })], locked: false, visible: true, muted: false }],
      bgMusicKey: 'caprec_bg',
    });
    expect(collectMaterialKeys(p)).toEqual(['editor_mat_a']);
  });

  it('同键多处引用只算一次；无键条目跳过', () => {
    const p = makeProject({
      tracks: [{ clips: [media({ materialKey: 'editor_mat_a' }), media({ sourceUrl: 'https://e.com/a.mp4' }), media()], locked: false, visible: true, muted: false }],
      dubs: [media({ materialKey: 'editor_mat_a' })],
      bgMusicKey: 'editor_mat_a',
    });
    expect(collectMaterialKeys(p)).toEqual(['editor_mat_a']);
  });

  it('空工程返回空数组', () => {
    expect(collectMaterialKeys(makeProject())).toEqual([]);
  });
});

describe('isOrphanMaterial（三道闸门，宁可留着也不误删）', () => {
  const now = 1_700_000_000_000;
  const old = now - MATERIAL_TTL_MS - 1;
  const kept = new Set<string>();

  it('工程自有 + 超 TTL + 无引用 → 回收', () => {
    expect(isOrphanMaterial('editor_mat_a', old, now, kept)).toBe(true);
  });

  it('非工程前缀一律不回收（录制成果 / 交接键 / 工程槽位）', () => {
    for (const key of ['caprec_1', 'editor_handoff_1', 'hls_segment_1', EDITOR_PROJECT_KEY, '']) {
      expect(isOrphanMaterial(key, old, now, kept)).toBe(false);
    }
  });

  it('前缀必须在开头，中间出现不算自有', () => {
    expect(isOrphanMaterial(`x_${EDITOR_MATERIAL_PREFIX}a`, old, now, kept)).toBe(false);
  });

  it('仍被工程引用 → 再老也不回收', () => {
    expect(isOrphanMaterial('editor_mat_a', old, now, new Set(['editor_mat_a']))).toBe(false);
  });

  it('TTL 边界严格大于：刚好到点不回收，超过一毫秒才回收', () => {
    expect(isOrphanMaterial('editor_mat_a', now - MATERIAL_TTL_MS, now, kept)).toBe(false);
    expect(isOrphanMaterial('editor_mat_a', now - MATERIAL_TTL_MS - 1, now, kept)).toBe(true);
  });

  it('新写入的素材不回收（本次会话刚导入的也走这条兜底）', () => {
    expect(isOrphanMaterial('editor_mat_a', now - 1000, now, kept)).toBe(false);
  });

  it('savedAt 缺失或非有限数 → 不回收（缺时间戳无从判断新旧）', () => {
    for (const savedAt of [undefined, null, '1699999999999', NaN, Infinity]) {
      expect(isOrphanMaterial('editor_mat_a', savedAt, now, kept)).toBe(false);
    }
  });

  it('时钟回拨（savedAt 在未来）→ 不回收', () => {
    expect(isOrphanMaterial('editor_mat_a', now + 60_000, now, kept)).toBe(false);
  });
});