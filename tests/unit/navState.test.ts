/**
 * UI 第二批之二（信息架构收敛）导航状态纯函数单元测试。
 * 覆盖两类可抽离逻辑：
 *  1. 旧 tab 键迁移映射与持久化状态规范化（migrateLegacyTab / normalizeNavState），
 *     保证升级后用户不会停在空白页、非法数据逐字段回退；
 *  2. 子模式与面板的对应关系判定（GRAB_SUB_PANEL_IDS / DOWNLOADS_SUB_PANEL_IDS / ENTRY_PANEL_IDS），
 *     保证每个子模式都有唯一承载面板、分段列表与覆盖层键不混淆。
 * 本模块不依赖 chrome 运行时（load/save 仅在函数体内使用），node 环境可直接导入。
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_NAV_STATE,
  DOWNLOADS_SEGMENT_SUBS,
  DOWNLOADS_SUB_PANEL_IDS,
  ENTRY_KEYS,
  ENTRY_PANEL_IDS,
  GRAB_SEGMENT_SUBS,
  GRAB_SUB_PANEL_IDS,
  isDownloadsSubKey,
  isEntryKey,
  isGrabSubKey,
  migrateLegacyTab,
  normalizeNavState,
} from '../../src/sidepanel/services/navState';

describe('migrateLegacyTab：旧版 11 个 tab 键 → 新导航状态', () => {
  // 旧版全部 tab 键清单（含 launch 型 editor），逐一断言去向
  it.each([
    ['video',     { entry: 'grab',      grabSub: 'video',   downloadsSub: 'queue' }],
    ['image',     { entry: 'grab',      grabSub: 'image',   downloadsSub: 'queue' }],
    ['audio',     { entry: 'grab',      grabSub: 'audio',   downloadsSub: 'queue' }],
    ['text',      { entry: 'grab',      grabSub: 'text',    downloadsSub: 'queue' }],
    ['sources',   { entry: 'grab',      grabSub: 'sources', downloadsSub: 'queue' }],
    ['sites',     { entry: 'sites',     grabSub: 'video',   downloadsSub: 'queue' }],
    ['downloads', { entry: 'downloads', grabSub: 'video',   downloadsSub: 'queue' }],
    ['basket',    { entry: 'downloads', grabSub: 'video',   downloadsSub: 'basket' }],
    ['screenrec', { entry: 'record',    grabSub: 'video',   downloadsSub: 'queue' }],
    ['settings',  { entry: 'settings',  grabSub: 'video',   downloadsSub: 'queue' }],
    ['editor',    { entry: 'grab',      grabSub: 'video',   downloadsSub: 'queue' }],
  ] as const)('旧键 %s 迁移到 %o', (legacy, expected) => {
    expect(migrateLegacyTab(legacy)).toEqual(expected);
  });

  it('覆盖旧版全部 11 个 tab 键（不允许有未迁移的旧键）', () => {
    const legacyKeys = ['sites', 'video', 'image', 'audio', 'text', 'downloads', 'basket', 'sources', 'screenrec', 'editor', 'settings'];
    for (const k of legacyKeys) {
      expect(migrateLegacyTab(k)).not.toBeNull();
      // 迁移结果必须落在新结构的合法键上（保证不会停在空白页）
      expect(isEntryKey(migrateLegacyTab(k)!.entry)).toBe(true);
      expect(isGrabSubKey(migrateLegacyTab(k)!.grabSub)).toBe(true);
      expect(isDownloadsSubKey(migrateLegacyTab(k)!.downloadsSub)).toBe(true);
    }
  });

  it('未识别键与非字符串输入返回 null', () => {
    expect(migrateLegacyTab('nope')).toBeNull();
    expect(migrateLegacyTab(42)).toBeNull();
    expect(migrateLegacyTab(undefined)).toBeNull();
  });
});

describe('normalizeNavState：持久化状态校验与回退', () => {
  it('合法新格式对象原样通过', () => {
    const raw = { entry: 'downloads', grabSub: 'image', downloadsSub: 'history' };
    expect(normalizeNavState(raw)).toEqual(raw);
  });

  it('单字段非法仅该字段回退默认值（部分损坏不整体丢状态）', () => {
    const fixed = normalizeNavState({ entry: 'grab', grabSub: 'bogus', downloadsSub: 'basket' });
    expect(fixed.entry).toBe('grab');
    expect(fixed.grabSub).toBe(DEFAULT_NAV_STATE.grabSub); // 非法子模式回退
    expect(fixed.downloadsSub).toBe('basket');             // 合法字段保留
  });

  it('旧格式字符串走迁移映射', () => {
    expect(normalizeNavState('screenrec')).toEqual({ entry: 'record', grabSub: 'video', downloadsSub: 'queue' });
    expect(normalizeNavState('basket')).toEqual({ entry: 'downloads', grabSub: 'video', downloadsSub: 'basket' });
  });

  it('中间版本停留位迁移：上一版 抓取-网站 分段（grabSub=sites）升级为一级网站入口', () => {
    // 用户停留在旧版「网站」分段时持久化的状态，升级后应直接落到一级网站入口
    expect(normalizeNavState({ entry: 'grab', grabSub: 'sites', downloadsSub: 'queue' }))
      .toEqual({ entry: 'sites', grabSub: 'video', downloadsSub: 'queue' });
    // downloadsSub 合法值保留
    expect(normalizeNavState({ entry: 'grab', grabSub: 'sites', downloadsSub: 'basket' }))
      .toEqual({ entry: 'sites', grabSub: 'video', downloadsSub: 'basket' });
  });

  it('无法识别的字符串 / 空值 / 非对象一律回退默认状态（绝不产生空白页）', () => {
    expect(normalizeNavState('unknown-tab')).toEqual(DEFAULT_NAV_STATE);
    expect(normalizeNavState(null)).toEqual(DEFAULT_NAV_STATE);
    expect(normalizeNavState(undefined)).toEqual(DEFAULT_NAV_STATE);
    expect(normalizeNavState(123)).toEqual(DEFAULT_NAV_STATE);
  });

  it('默认状态自身各字段全部合法', () => {
    expect(isEntryKey(DEFAULT_NAV_STATE.entry)).toBe(true);
    expect(isGrabSubKey(DEFAULT_NAV_STATE.grabSub)).toBe(true);
    expect(isDownloadsSubKey(DEFAULT_NAV_STATE.downloadsSub)).toBe(true);
  });
});

describe('子模式与面板的对应关系判定', () => {
  it('抓取：每个子模式键都有唯一承载面板名，且分段列表与子模式全集一致（网站已升为一级入口，不在抓取分段内）', () => {
    // 六个抓取子模式键全部有面板映射（含接口 network；sites 已移出）
    expect(Object.keys(GRAB_SUB_PANEL_IDS).sort()).toEqual(['audio', 'image', 'network', 'sources', 'text', 'video']);
    for (const id of Object.values(GRAB_SUB_PANEL_IDS)) expect(typeof id).toBe('string');
    // 分段列表恰为六个键，与子模式全集一致，且不含 sites
    expect([...GRAB_SEGMENT_SUBS].sort()).toEqual(['audio', 'image', 'network', 'sources', 'text', 'video']);
    expect(GRAB_SEGMENT_SUBS).not.toContain('sites');
    // 分段项与面板映射键一致（每个分段键都能解析出面板）
    for (const sub of GRAB_SEGMENT_SUBS) expect(GRAB_SUB_PANEL_IDS[sub]).toBeTruthy();
  });

  it('下载：三个子页签都有面板映射；进行中/历史共用 DownloadManagerPanel 的不同分节', () => {
    expect([...DOWNLOADS_SEGMENT_SUBS].sort()).toEqual(['basket', 'history', 'queue']);
    expect(DOWNLOADS_SUB_PANEL_IDS.basket).toBe('CollectionPanel');
    expect(DOWNLOADS_SUB_PANEL_IDS.queue).toBe('DownloadManagerPanel');
    expect(DOWNLOADS_SUB_PANEL_IDS.history).toBe('DownloadManagerPanel');
  });

  it('一级入口：五个入口都有容器/面板映射，顺序即渲染顺序（网站紧随抓取）', () => {
    expect([...ENTRY_KEYS]).toEqual(['grab', 'sites', 'downloads', 'record', 'settings']);
    expect(ENTRY_PANEL_IDS.grab).toBe('GrabWorkspace');
    expect(ENTRY_PANEL_IDS.sites).toBe('SiteCatalogPanel');
    expect(ENTRY_PANEL_IDS.downloads).toBe('DownloadsWorkspace');
    expect(ENTRY_PANEL_IDS.record).toBe('ScreenRecordPanel');
    expect(ENTRY_PANEL_IDS.settings).toBe('SettingsPanel');
  });

  it('类型守卫：合法/非法值判定准确', () => {
    expect(isEntryKey('grab')).toBe(true);
    expect(isEntryKey('sites')).toBe(true);  // 网站已是一级入口键
    expect(isEntryKey('editor')).toBe(false); // 编辑已不再是入口
    expect(isGrabSubKey('sites')).toBe(false); // 网站不再是抓取子模式
    expect(isGrabSubKey('video')).toBe(true);
    expect(isGrabSubKey('downloads')).toBe(false);
    expect(isDownloadsSubKey('queue')).toBe(true);
    expect(isDownloadsSubKey('video')).toBe(false);
  });
});
