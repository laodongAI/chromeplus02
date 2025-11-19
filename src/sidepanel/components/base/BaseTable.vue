<template>
  <div class="base-table" :class="{ 'is-dense': dense }">
    <div v-if="$slots.toolbar" class="base-table__toolbar">
      <slot name="toolbar" />
    </div>
    <div class="base-table__container">
      <table>
        <slot />
      </table>
    </div>
    <div v-if="$slots.footer" class="base-table__footer">
      <slot name="footer" />
    </div>
  </div>
</template>

<script setup lang="ts">
withDefaults(defineProps<{ dense?: boolean }>(), {
  dense: false
});
</script>

<style scoped>
.base-table {
  width: 100%;
  border: 1px solid rgba(255, 255, 255, 0.04);
  border-radius: var(--sp-radius-md);
  background: rgba(15, 23, 38, 0.75);
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.01);
}

.base-table__toolbar,
.base-table__footer {
  padding: var(--sp-spacing-3) var(--sp-spacing-4);
  border-bottom: 1px solid rgba(255, 255, 255, 0.04);
}

.base-table__footer {
  border-bottom: none;
  border-top: 1px solid rgba(255, 255, 255, 0.04);
}

.base-table__container {
  max-height: 360px;
  overflow: auto;
}

table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}

th,
td {
  padding: var(--sp-spacing-3);
  text-align: left;
  border-bottom: 1px solid rgba(255, 255, 255, 0.04);
}

th {
  font-size: 12px;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--sp-color-muted);
}

tr:last-child td {
  border-bottom: none;
}

.is-dense th,
.is-dense td {
  padding: var(--sp-spacing-2) var(--sp-spacing-3);
}
</style>
