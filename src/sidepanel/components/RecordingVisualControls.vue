<template>
  <div v-if="compositorActive" class="vfx">
    <!-- 推近聚焦：目标倍率交给合成器做指数缓动，观感是平滑推近而不是跳变 -->
    <div class="vfx__row">
      <span class="vfx__label">推近聚焦</span>
      <BaseButton size="xs" variant="secondary" :disabled="visual.zoom <= zoomBounds.min" title="拉远一档" @click="zoomOut">−</BaseButton>
      <span class="vfx__zoom">{{ visual.zoom.toFixed(2) }}×</span>
      <BaseButton size="xs" variant="secondary" :disabled="visual.zoom >= zoomBounds.max" title="推近一档" @click="zoomIn">＋</BaseButton>
      <BaseButton size="xs" variant="ghost" :disabled="visual.zoom <= zoomBounds.min" @click="resetZoom">复位</BaseButton>
      <select class="vfx__select" :value="visual.anchor" aria-label="推近锚点" @change="onAnchorChange">
        <option v-for="(label, key) in ZOOM_ANCHOR_LABELS" :key="key" :value="key">{{ label }}</option>
      </select>
    </div>

    <!-- 敏感区遮挡：在原始预览上框选，坐标归一化到源画面，推近时遮挡跟着内容走 -->
    <div class="vfx__row vfx__row--head">
      <span class="vfx__label">敏感区遮挡</span>
      <BaseButton size="xs" :variant="marking ? 'outline' : 'secondary'" @click="marking = !marking">
        {{ marking ? '退出框选' : '框选遮挡区' }}
      </BaseButton>
      <BaseButton size="xs" variant="ghost" :disabled="!visual.blurRegions.length" @click="clearBlurRegions">清空</BaseButton>
      <label class="vfx__strength">
        强度
        <input
          type="range"
          :min="BLUR_STRENGTH_MIN"
          :max="BLUR_STRENGTH_MAX"
          :value="visual.blurStrength"
          aria-label="模糊强度"
          @input="onStrengthInput"
        />
      </label>
    </div>

    <div v-show="marking || visual.blurRegions.length" class="vfx__preview-wrap">
      <div ref="stageEl" class="vfx__stage" :class="{ 'is-marking': marking }">
        <video ref="videoEl" class="vfx__video" muted playsinline autoplay></video>
        <!-- 已有遮挡区：预览是原始画面，不画框用户就不知道遮了哪里 -->
        <div
          v-for="r in visual.blurRegions"
          :key="r.id"
          class="vfx__region"
          :style="regionStyle(r)"
          :title="`遮挡区 ${Math.round(r.w * 100)}%×${Math.round(r.h * 100)}%`"
        ></div>
        <!-- 正在拖拽的草稿框 -->
        <div v-if="draft" class="vfx__region vfx__region--draft" :style="draftStyle"></div>
      </div>
      <div class="vfx__hint">
        预览是原始画面，遮挡只写进成片（敏感内容不会落盘）。在画面上拖拽即可框选；录整屏时预览里会出现侧栏自身，属正常现象。
      </div>
    </div>

    <ul v-if="visual.blurRegions.length" class="vfx__list" aria-label="遮挡区列表">
      <li v-for="(r, i) in visual.blurRegions" :key="r.id" class="vfx__list-row">
        <span>区域 {{ i + 1 }}（{{ Math.round(r.w * 100) }}%×{{ Math.round(r.h * 100) }}%）</span>
        <BaseButton size="xs" variant="ghost" :aria-label="`删除遮挡区 ${i + 1}`" @click="removeBlurRegion(r.id)">删除</BaseButton>
      </li>
    </ul>
  </div>
</template>

<script setup lang="ts">
/**
 * 录制中画面增强控制条（Round 5 #33）。
 *
 * 只在合成器已建立时出现：MediaRecorder 不能中途换视频轨，
 * 所以推近/遮挡必须在开始录制前就开启「画面增强」，这里不做「录制中临时开启」的假入口。
 */
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { BaseButton } from './base';
import {
  addBlurRegion,
  clearBlurRegions,
  compositorActive,
  previewStream,
  removeBlurRegion,
  resetZoom,
  setBlurStrength,
  setZoomAnchor,
  visual,
  zoomBounds,
  zoomIn,
  zoomOut
} from '../services/recordingStore';
import {
  BLUR_STRENGTH_MAX,
  BLUR_STRENGTH_MIN,
  ZOOM_ANCHOR_LABELS,
  normalizeBlurRegion,
  type NormRect,
  type ZoomAnchor
} from '@/core/zoomFocus';

/** 是否处于框选模式 */
const marking = ref(false);
const stageEl = ref<HTMLDivElement | null>(null);
const videoEl = ref<HTMLVideoElement | null>(null);
/** 拖拽草稿（舞台局部像素坐标） */
const draft = ref<{ x1: number; y1: number; x2: number; y2: number } | null>(null);

const draftStyle = computed(() => {
  const d = draft.value;
  if (!d) return {};
  return {
    left: `${Math.min(d.x1, d.x2)}px`,
    top: `${Math.min(d.y1, d.y2)}px`,
    width: `${Math.abs(d.x2 - d.x1)}px`,
    height: `${Math.abs(d.y2 - d.y1)}px`
  };
});

/** 归一化遮挡区 → 预览上的百分比定位 */
function regionStyle(r: NormRect): Record<string, string> {
  return { left: `${r.x * 100}%`, top: `${r.y * 100}%`, width: `${r.w * 100}%`, height: `${r.h * 100}%` };
}

function onAnchorChange(e: Event): void {
  setZoomAnchor((e.target as HTMLSelectElement).value as ZoomAnchor);
}

function onStrengthInput(e: Event): void {
  setBlurStrength(Number((e.target as HTMLInputElement).value));
}

/** 预览流挂载：previewStream 变化（开始/停止录制）时同步 srcObject */
watch(previewStream, (s) => {
  const el = videoEl.value;
  if (!el) return;
  el.srcObject = s;
  if (s) void el.play().catch(() => { /* 自动播放被拒时静默：预览不影响录制 */ });
}, { immediate: true });

/** 舞台局部坐标（拖拽可能超出舞台，交给 normalizeBlurRegion 夹取） */
function localPoint(e: PointerEvent): { x: number; y: number } {
  const rect = stageEl.value?.getBoundingClientRect();
  if (!rect) return { x: 0, y: 0 };
  return { x: e.clientX - rect.left, y: e.clientY - rect.top };
}

function onPointerDown(e: PointerEvent): void {
  if (!marking.value) return;
  e.preventDefault();
  const p = localPoint(e);
  draft.value = { x1: p.x, y1: p.y, x2: p.x, y2: p.y };
  stageEl.value?.setPointerCapture(e.pointerId);
}

function onPointerMove(e: PointerEvent): void {
  if (!draft.value) return;
  const p = localPoint(e);
  draft.value = { ...draft.value, x2: p.x, y2: p.y };
}

function onPointerUp(e: PointerEvent): void {
  const d = draft.value;
  draft.value = null;
  if (!d) return;
  stageEl.value?.releasePointerCapture(e.pointerId);
  const rect = stageEl.value?.getBoundingClientRect();
  if (!rect) return;
  const region = normalizeBlurRegion(d.x1, d.y1, d.x2, d.y2, rect.width, rect.height);
  // 过小的框（误点）直接被 normalizeBlurRegion 判为 null，不入列表
  if (region) addBlurRegion(region);
}

// 监听挂在模板 ref 上不方便（元素随 v-if 重建），用事件委托绑在舞台父级更稳：
// 这里直接在挂载后绑到 stage，卸载时解绑
let bound: HTMLDivElement | null = null;
function bindStage(): void {
  const el = stageEl.value;
  if (!el || bound === el) return;
  unbindStage();
  bound = el;
  el.addEventListener('pointerdown', onPointerDown);
  el.addEventListener('pointermove', onPointerMove);
  el.addEventListener('pointerup', onPointerUp);
  el.addEventListener('pointercancel', onPointerUp);
}
function unbindStage(): void {
  if (!bound) return;
  bound.removeEventListener('pointerdown', onPointerDown);
  bound.removeEventListener('pointermove', onPointerMove);
  bound.removeEventListener('pointerup', onPointerUp);
  bound.removeEventListener('pointercancel', onPointerUp);
  bound = null;
}

watch([compositorActive, stageEl], () => { bindStage(); }, { immediate: true, flush: 'post' });
onBeforeUnmount(unbindStage);
</script>

<style scoped>
.vfx {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 7px;
  padding: 8px 10px;
  border: 1px solid var(--sp-color-border);
  border-radius: var(--sp-radius-md);
  background: var(--sp-color-surface);
}

.vfx__row { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.vfx__row--head { margin-top: 2px; }
.vfx__label { font-size: 12px; font-weight: 600; color: var(--sp-color-text); }
.vfx__zoom {
  font-size: 12px;
  font-family: var(--sp-font-mono, monospace);
  color: var(--sp-color-text);
  min-width: 44px;
  text-align: center;
}
.vfx__select {
  font-size: 12px;
  padding: 2px 5px;
  border: 1px solid var(--sp-color-border-strong);
  border-radius: var(--sp-radius-sm);
  background: var(--sp-color-bg-elevated);
  color: var(--sp-color-text);
  cursor: pointer;
}
.vfx__strength { display: flex; align-items: center; gap: 5px; font-size: 11px; color: var(--sp-color-muted); }
.vfx__strength input { width: 78px; }

.vfx__preview-wrap { display: flex; flex-direction: column; gap: 4px; }
.vfx__stage {
  position: relative;
  width: 100%;
  border: 1px solid var(--sp-color-border-strong);
  border-radius: var(--sp-radius-sm);
  overflow: hidden;
  background: #000;
  line-height: 0;
}
.vfx__stage.is-marking { cursor: crosshair; touch-action: none; }
/* width:100% + 自动高度 → 元素矩形等于画面矩形，框选坐标无需处理 letterbox 偏移 */
.vfx__video { width: 100%; display: block; }
.vfx__region {
  position: absolute;
  border: 1px solid rgba(255, 196, 0, 0.95);
  background: rgba(255, 196, 0, 0.22);
  pointer-events: none;
}
.vfx__region--draft { border-style: dashed; background: rgba(255, 196, 0, 0.12); }
.vfx__hint { font-size: 11px; color: var(--sp-color-muted); line-height: 1.5; }

.vfx__list { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 2px; }
.vfx__list-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 11px;
  color: var(--sp-color-text-secondary, var(--sp-color-text));
}
</style>