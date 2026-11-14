<template>
  <!-- 可访问分段导航（tablist 模式）：一级入口与面板内子模式共用本组件，
       避免各处裸 div @click 实现导致键盘/读屏行为不一致 -->
  <!-- aria-label 由调用方以 attribute 透传到本根元素（aria-* 不作为 prop 声明） -->
  <div class="seg" :class="`seg--${size}`" role="tablist">
    <button
      v-for="(item, idx) in items"
      :key="item.key"
      :id="tabId(item.key)"
      type="button"
      role="tab"
      class="seg__tab"
      :class="{ 'is-active': item.key === modelValue }"
      :aria-selected="item.key === modelValue"
      :aria-controls="`${idBase}-panel`"
      :tabindex="idx === rovingIndex ? 0 : -1"
      :title="item.title || item.label"
      @click="select(item.key)"
      @keydown="onKeydown($event, idx)"
    >
      <span v-if="item.icon" class="seg__icon" v-html="item.icon"></span>
      <span class="seg__label">{{ item.label }}</span>
      <span v-if="(item.count ?? 0) > 0" class="seg__count">{{ item.count }}</span>
    </button>
  </div>
</template>

<script setup lang="ts">
/**
 * 分段导航组件（UI 二批之二）。
 * 实现要点：
 *  - role="tablist" / role="tab" / aria-selected：读屏可感知当前选中项；
 *  - roving tabindex：整个 tablist 在 Tab 键序列中只占一站，进入后用 ←/→/Home/End 切换；
 *  - 方向键切换选中后立即把焦点移到新 tab（focus 跟随选中，符合 WAI-ARIA tabs 模式）；
 *  - :focus-visible 提供可见焦点环，鼠标点击不显示、键盘操作显示。
 * 注意：modelValue 允许不在 items 中（如抓取入口展开「网站目录」覆盖层时），
 * 此时所有分段项 aria-selected=false，但 roving tabindex 仍落在首项保证键盘可达。
 */
import { computed } from 'vue';

/** 分段项定义（script setup 不允许 ES 导出，消费方按结构传入即可） */
interface SegmentedItem {
  /** 稳定键值（与 navState 的子模式键一致） */
  key: string;
  /** 展示文案 */
  label: string;
  /** 可选内联 SVG 图标（md 尺寸下显示在文案上方/左侧） */
  icon?: string;
  /** 悬停提示 */
  title?: string;
  /** 计数徽标；<=0 或缺省不显示 */
  count?: number;
}

const props = withDefaults(defineProps<{
  /** 分段项列表 */
  items: SegmentedItem[];
  /** 当前选中键（v-model） */
  modelValue: string;
  /** id 前缀：生成 `${idBase}-tab-<key>` 与面板 `${idBase}-panel` 的 aria 关联 */
  idBase: string;
  /** 尺寸：md=一级入口行（图标+文案），sm=面板内子模式行（紧凑胶囊） */
  size?: 'md' | 'sm';
}>(), {
  size: 'sm',
});

const emit = defineEmits<{ (e: 'update:modelValue', key: string): void }>();

/** 生成某分段项的元素 id（aria-controls / aria-labelledby / 焦点转移都以此定位） */
function tabId(key: string): string { return `${props.idBase}-tab-${key}`; }

/** 当前选中项下标；modelValue 不在 items 中（覆盖层态）时为 -1 */
const activeIndex = computed(() => props.items.findIndex(i => i.key === props.modelValue));

/** roving tabindex 落点：无选中项时兜底落在首项，保证 tablist 键盘可达 */
const rovingIndex = computed(() => (activeIndex.value === -1 ? 0 : activeIndex.value));

/** 点击/键盘选中某分段项：仅在值变化时向外发出更新 */
function select(key: string): void {
  if (key !== props.modelValue) emit('update:modelValue', key);
}

/**
 * tablist 键盘模型：←/→ 循环移动，Home/End 跳首尾；
 * 切换后等 DOM 更新完再把焦点移到新 tab（focus 跟随选中）。
 * @param e 键盘事件
 * @param idx 当前触发项下标
 */
function onKeydown(e: KeyboardEvent, idx: number): void {
  const len = props.items.length;
  if (!len) return;
  let next = -1;
  if (e.key === 'ArrowRight') next = (idx + 1) % len;
  else if (e.key === 'ArrowLeft') next = (idx - 1 + len) % len;
  else if (e.key === 'Home') next = 0;
  else if (e.key === 'End') next = len - 1;
  if (next < 0) return; // 非导航键：交回浏览器默认行为
  e.preventDefault();
  const key = props.items[next].key;
  select(key);
  // 用 rAF 等选中态渲染完成后再移动焦点，避免焦点落在旧 aria-selected 节点上
  requestAnimationFrame(() => {
    try { document.getElementById(tabId(key))?.focus(); } catch { /* 极端情况元素已卸载：忽略 */ }
  });
}
</script>

<style scoped>
.seg {
  display: flex;
  align-items: stretch;
  gap: 0;
  min-width: 0;
}

/* ── 通用 tab 按钮基底 ── */
.seg__tab {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  background: transparent;
  color: var(--sp-color-muted);
  font-family: var(--sp-font-family);
  cursor: pointer;
  white-space: nowrap;
  transition: all var(--sp-transition-fast);
}
.seg__tab:hover { background: var(--sp-color-surface); color: var(--sp-color-text); }
.seg__tab.is-active { color: var(--sp-color-primary); background: var(--sp-color-primary-light); }

/* 键盘可见焦点环：只在 :focus-visible（键盘聚焦）时显示，鼠标点击不打扰 */
.seg__tab:focus { outline: none; }
.seg__tab:focus-visible {
  outline: 2px solid var(--sp-color-primary);
  outline-offset: -2px;
  border-radius: var(--sp-radius-sm);
}

/* ── md：一级入口行（图标在上、文案在下，底部主色指示条） ── */
.seg--md .seg__tab {
  flex: 1;
  flex-direction: column;
  gap: 3px;
  padding: 8px 6px;
  min-width: 44px;
  border-bottom: 2px solid transparent;
}
.seg--md .seg__tab.is-active { border-bottom-color: var(--sp-color-primary); }
.seg--md .seg__label { font-size: 11px; font-weight: 600; letter-spacing: 0.01em; }

/* ── sm：面板内子模式行（横向胶囊，等宽分布） ── */
.seg--sm { gap: 2px; }
.seg--sm .seg__tab {
  flex: 1;
  gap: 4px;
  padding: 5px 6px;
  border-radius: var(--sp-radius-full);
  font-size: 11px;
  font-weight: 600;
}

/* 图标与计数徽标 */
.seg__icon { display: flex; align-items: center; justify-content: center; line-height: 0; }
.seg__count {
  font-size: 10px; font-weight: 700;
  color: white;
  background: var(--sp-color-primary);
  border-radius: 999px;
  min-width: 14px; height: 14px;
  display: flex; align-items: center; justify-content: center;
  padding: 0 3px; line-height: 1;
}
/* md 尺寸下计数徽标悬浮在右上角（与原 tab 徽标一致的视觉位置） */
.seg--md .seg__count { position: absolute; top: 4px; right: 4px; }
</style>
