<template>
  <BaseCard title="支持网站" subtitle="选择站点打开，回到「视频 / 图像 / 音频」一键扫描抓取" :padded="true">
    <div class="site-toolbar">
      <BaseSearchBar v-model="query" placeholder="搜索站点名称、域名或描述…" :hint="''" />
      <select v-model="category" class="site-cat-select" aria-label="站点分类">
        <option v-for="c in categories" :key="c" :value="c">{{ c }}</option>
      </select>
    </div>

    <div class="site-grid">
      <div v-for="s in filteredSites" :key="s.id" class="site-card" :class="{ 'is-hot': hotIds.has(s.id) }" @click="openSite(s.url)">
        <div class="site-card__head">
          <span class="site-card__name">{{ s.name }}</span>
          <span class="site-card__cat" :style="{ background: catColor(s.category).bg, color: catColor(s.category).fg }">{{ s.category }}</span>
        </div>
        <div class="site-card__desc">{{ s.desc }}</div>
        <div class="site-card__domains">{{ s.domains.join(' · ') }}</div>
        <div class="site-card__open">
          打开并抓取
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
        </div>
      </div>
      <div v-if="!filteredSites.length" class="site-empty">没有匹配的站点</div>
    </div>

    <div class="site-note">DRM / 付费版权内容无法直链下载，扩展会提示使用「录制」兜底；目录之外的通用站点同样支持嗅探。</div>
  </BaseCard>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { BaseCard, BaseButton, BaseSearchBar } from '../components/base';
import { SITE_CATALOG, SITE_CATEGORY_ORDER, type SiteCategory } from '@/data/sites';

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

const CAT_COLORS: Record<string, { bg: string; fg: string }> = {
  '综合': { bg: 'rgba(99,102,241,0.12)', fg: '#6366f1' },
  '娱乐': { bg: 'rgba(236,72,153,0.12)', fg: '#ec4899' },
  '学习': { bg: 'rgba(16,185,129,0.12)', fg: '#10b981' },
  '英语': { bg: 'rgba(245,158,11,0.12)', fg: '#d97706' },
  '音乐': { bg: 'rgba(139,92,246,0.12)', fg: '#8b5cf6' },
  '直播': { bg: 'rgba(239,68,68,0.12)', fg: '#ef4444' },
  '新闻': { bg: 'rgba(6,182,212,0.12)', fg: '#06b6d4' }
};
function catColor(c: string) { return CAT_COLORS[c] || CAT_COLORS['综合']; }

function openSite(url: string) {
  try { chrome.tabs.create({ url, active: true }); } catch { window.open(url, '_blank'); }
  emit('open-site', url);
}
void BaseButton;
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

.site-card {
  display: flex; flex-direction: column; gap: 4px;
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
.site-card.is-hot { border-left: 3px solid var(--sp-color-primary); }

.site-card__head { display: flex; align-items: center; justify-content: space-between; gap: 6px; }
.site-card__name { font-size: 13px; font-weight: 600; color: var(--sp-color-heading); }
.site-card__cat { font-size: 10px; font-weight: 600; padding: 1px 7px; border-radius: 999px; flex-shrink: 0; }
.site-card__desc { font-size: 11px; color: var(--sp-color-text-secondary); line-height: 1.45; min-height: 30px; }
.site-card__domains { font-size: 10px; color: var(--sp-color-muted); font-family: var(--sp-font-mono); }

.site-card__open {
  margin-top: 2px; font-size: 11px; font-weight: 600; color: var(--sp-color-primary);
  display: flex; align-items: center; gap: 4px;
}

.site-empty { grid-column: 1 / -1; padding: 24px; text-align: center; font-size: 12px; color: var(--sp-color-muted); }

.site-note { margin-top: 10px; font-size: 11px; color: var(--sp-color-muted); line-height: 1.5; }
</style>
