<template>
  <label class="form-field">
    <div class="form-field__label-row">
      <span class="form-field__label">{{ label }}</span>
      <span v-if="meta" class="form-field__meta">{{ meta }}</span>
    </div>
    <slot />
    <p v-if="hint" class="form-field__hint">{{ hint }}</p>
  </label>
</template>

<script setup lang="ts">
interface Props {
  label: string;
  hint?: string;
  meta?: string;
}

defineProps<Props>();
</script>

<style scoped>
.form-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 14px;
  color: var(--sp-color-text);
}

.form-field__label-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  color: var(--sp-color-muted);
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.form-field__label {
  font-weight: 600;
}

.form-field__meta {
  font-size: 11px;
  color: var(--sp-color-muted);
}

.form-field__hint {
  margin: 0;
  font-size: 12px;
  color: var(--sp-color-muted);
}

:slotted(input),
:slotted(select),
:slotted(textarea) {
  width: 100%;
  padding: 10px 12px;
  border-radius: var(--sp-radius-sm);
  border: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(15, 23, 38, 0.65);
  color: var(--sp-color-heading);
  font-family: var(--sp-font-family);
}
</style>
