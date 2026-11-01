<template>
  <div class="base-table" :class="{ 'is-dense': dense }">
    <div v-if="$slots.toolbar" class="base-table__toolbar"><slot name="toolbar" /></div>
    <div class="base-table__container"><table><slot /></table></div>
    <div v-if="$slots.footer" class="base-table__footer"><slot name="footer" /></div>
  </div>
</template>
<script setup lang="ts">
withDefaults(defineProps<{ dense?: boolean }>(), { dense: false });
</script>
<style scoped>
.base-table {
  width: 100%;
  border: 1px solid var(--sp-color-border);
  border-radius: var(--sp-radius-lg);
  background: var(--sp-color-bg-elevated);
  overflow: hidden;
  box-shadow: var(--sp-shadow-sm);
}
.base-table__toolbar {
  padding: 8px 12px;
  border-bottom: 1px solid var(--sp-color-border);
  background: var(--sp-color-surface);
  display: flex; align-items: center; justify-content: space-between;
  gap: 10px; flex-wrap: wrap;
}
.base-table__footer {
  padding: 8px 12px; border-top: 1px solid var(--sp-color-border);
  background: var(--sp-color-surface);
}
.base-table__container { max-height: 440px; overflow: auto; }
.base-table__container::-webkit-scrollbar { width: 4px; height: 4px; }
.base-table__container::-webkit-scrollbar-thumb { background: var(--sp-color-border-strong); border-radius: 4px; }
table { width: 100%; border-collapse: collapse; font-size: 12px; }
th, td { padding: 8px 12px; text-align: left; border-bottom: 1px solid var(--sp-color-border); }
tbody tr { transition: background var(--sp-transition-fast); }
tbody tr:hover { background: var(--sp-color-surface); }
th {
  font-size: 11px; letter-spacing: 0.06em; text-transform: uppercase;
  color: var(--sp-color-muted); font-weight: 600;
  background: var(--sp-color-surface); position: sticky; top: 0; z-index: 10;
}
tr:last-child td { border-bottom: none; }
.is-dense th, .is-dense td { padding: 6px 10px; }
</style>
