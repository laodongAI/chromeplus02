<template>
  <section class="base-card" :class="{ 'base-card--padded': padded }">
    <header v-if="title || $slots.header" class="base-card__header">
      <div class="base-card__header-text">
        <div class="base-card__title-row">
          <h3 v-if="title" class="base-card__title">{{ title }}</h3>
          <slot name="badge" />
        </div>
        <p v-if="subtitle" class="base-card__subtitle">{{ subtitle }}</p>
      </div>
      <slot name="header" />
    </header>
    <div class="base-card__body"><slot /></div>
    <footer v-if="$slots.footer" class="base-card__footer"><slot name="footer" /></footer>
  </section>
</template>
<script setup lang="ts">
interface Props { title?: string; subtitle?: string; padded?: boolean; }
withDefaults(defineProps<Props>(), { padded: true });
</script>
<style scoped>
.base-card { background:transparent; display:flex; flex-direction:column; }
.base-card--padded { padding:var(--sp-spacing-4); }
.base-card__header { display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:var(--sp-spacing-4); gap:var(--sp-spacing-3); }
.base-card__header-text { flex:1; min-width:0; }
.base-card__title-row { display:flex; align-items:center; gap:8px; }
.base-card__title { margin:0; font-size:14px; font-weight:600; color:var(--sp-color-heading); letter-spacing:-.01em; }
.base-card__subtitle { margin:3px 0 0; font-size:11px; color:var(--sp-color-muted); line-height:1.4; }
.base-card__body { flex:1; }
.base-card__footer { margin-top:var(--sp-spacing-4); padding-top:var(--sp-spacing-4); border-top:1px solid var(--sp-color-border); }
</style>
