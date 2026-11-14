<template>
  <!-- UI 三批（组6）：标题引用术语表 PANEL_TITLES.sites；正文「图像」统一为「图片」 -->
  <BaseCard :title="PANEL_TITLES.sites" subtitle="选择站点打开，回到「视频 / 图片 / 音频」一键扫描抓取" :padded="true">
    <div class="site-toolbar">
      <BaseSearchBar v-model="query" placeholder="搜索站点名称、域名或描述…" :hint="''" />
      <select v-model="category" class="site-cat-select" aria-label="站点分类">
        <option v-for="c in categories" :key="c" :value="c">{{ c }}</option>
      </select>
    </div>

    <div class="site-grid">
      <!-- UI 三批（组3）：整卡可点击的 div 换成 button，卡片本身即整块可聚焦（Enter/Space 打开站点） -->
      <button type="button" v-for="s in filteredSites" :key="s.id" class="site-card" :class="{ 'is-hot': hotIds.has(s.id) }" @click="openSite(s.url)">
        <span class="site-card__head">
          <span class="site-card__name">{{ s.name }}</span>
          <!-- UI 三批（组2）：分类色不再 JS 硬编码，改为引用 --sp-cat-{stem}-{bg|fg} token，深色主题随 data-theme 自动切换 -->
          <span class="site-card__cat" :style="{ background: 'var(--sp-cat-' + catStem(s.category) + '-bg)', color: 'var(--sp-cat-' + catStem(s.category) + '-fg)' }">{{ s.category }}</span>
        </span>
        <span class="site-card__desc">{{ s.desc }}</span>
        <span class="site-card__domains">{{ s.domains.join(' · ') }}</span>
        <span class="site-card__open">
          打开并抓取
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
        </span>
      </button>
      <div v-if="!filteredSites.length" class="site-empty">没有匹配的站点</div>
    </div>

    <div class="site-note">DRM / 付费版权内容无法直链下载，扩展会提示使用「录制」兜底；目录之外的通用站点同样支持嗅探。</div>
  </BaseCard>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
// UI 三批（组1）：删除未使用的 BaseButton 死 import（模板从未渲染该组件）
import { BaseCard, BaseSearchBar } from '../components/base';
import { SITE_CATALOG, SITE_CATEGORY_ORDER, type SiteCategory } from '@/data/sites';
// UI 三批（组6）：面板标题统一引用术语表
import { PANEL_TITLES } from '../utils/terminology';

const emit = defineEmits<{ (e: 'open-site', url: string): void }>();

const query = ref('');
const category = ref<string>('全部');
const categories = ['全部', ...SITE_CATEGORY_ORDER];

const hotIds = new Set(['youtube', 'bilibili', 'douyin', 'ted', 'npr']);

const filteredSites = computed(() => {
  const q = query.value.trim().toLowerCase();
  return SITE_CATALOG.filter(s => {
    if (category.value !== '全部' && s.category !== (category.value as SiteCategory)) return false;
    if (!q) return true;
    return s.name.toLowerCase().includes(q)
      || s.desc.toLowerCase().includes(q)
      || s.domains.some(d => d.toLowerCase().includes(q));
  });
});

/**
 * UI 三批（组2）：站点分类 → tokens.css 中 --sp-cat-{stem}-{bg|fg} 的词干映射。
 * 原 JS 硬编码 CAT_COLORS 已删除：色值单一来源收敛到 token，
 * 深色主题由 [data-theme] 下同名 token 自动切换，无需 JS 感知主题。
 */
const CAT_TOKEN_STEMS: Record<string, string> = {
  '综合': 'general', '娱乐': 'entertain', '学习': 'learn', '英语': 'english',
  '音乐': 'music', '直播': 'live', '新闻': 'news',
};
/** 取分类对应 token 词干；未知分类回退「综合」（general），保证样式表达式恒有效 */
function catStem(c: string): string { return CAT_TOKEN_STEMS[c] || 'general'; }

function openSite(url: string) {
  try { chrome.tabs.create({ url, active: true }); } catch { window.open(url, '_blank'); }
  emit('open-site', url);
}
</script>

<style scoped>
.site-toolbar { display: flex; gap: 8px; margin-bottom: 12px; align-items: center; }
.site-cat-select {
  height: 28px; padding: 0 8px; flex-shrink: 0;
  background: var(--sp-color-surface);
  border: 1px solid var(--sp-color-border-strong);
  border-radius: var(--sp-radius-sm);
  color: var(--sp-color-text); font-size: 11px; font-family: var(--sp-font-family);
  outline: none; cursor: pointer;
}
.site-cat-select:focus { border-color: var(--sp-color-primary); }

.site-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(210px, 1fr));
  gap: 8px;
}

/* UI 三批（组3）：site-card 由 div 换成 button——重置 UA 默认样式并补
   text-align:left / font-family:inherit / width:100%，保持与原 div 布局一致 */
.site-card {
  display: flex; flex-direction: column; gap: 4px;
  width: 100%;
  text-align: left;
  font-family: inherit;
  appearance: none;
  -webkit-appearance: none;
  padding: 10px 12px;
  border: 1px solid var(--sp-color-border);
  border-radius: var(--sp-radius-lg);
  background: var(--sp-color-bg-elevated);
  cursor: pointer;
  transition: all var(--sp-transition-fast);
}
.site-card:hover {
  border-color: var(--sp-color-primary);
  box-shadow: var(--sp-shadow-sm);
  transform: translateY(-1px);
}
.site-card:focus-visible { outline: 2px solid var(--sp-color-primary); outline-offset: 2px; }
.site-card.is-hot { border-left: 3px solid var(--sp-color-primary); }

.site-card__head { display: flex; align-items: center; justify-content: space-between; gap: 6px; }
.site-card__name { font-size: 13px; font-weight: 600; color: var(--sp-color-heading); }
/* UI 三批（组2）：分类胶囊属纯标注文字 10px → 11px */
.site-card__cat { font-size: 11px; font-weight: 600; padding: 1px 7px; border-radius: 999px; flex-shrink: 0; }
/* UI 三批（组2）：站点描述属正文级文字 11px → 12px */
.site-card__desc { font-size: 12px; color: var(--sp-color-text-secondary); line-height: 1.45; min-height: 30px; }
/* UI 三批（组2）：域名列表属标注级文字 10px → 11px */
.site-card__domains { font-size: 11px; color: var(--sp-color-muted); font-family: var(--sp-font-mono); }

.site-card__open {
  margin-top: 2px; font-size: 11px; font-weight: 600; color: var(--sp-color-primary);
  display: flex; align-items: center; gap: 4px;
}

.site-empty { grid-column: 1 / -1; padding: 24px; text-align: center; font-size: 12px; color: var(--sp-color-muted); }

/* UI 三批（组2）：底部说明属信息性文字 11px → 12px */
.site-note { margin-top: 10px; font-size: 12px; color: var(--sp-color-muted); line-height: 1.5; }
</style>
