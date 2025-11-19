<template>
  <section class="base-card" :class="{ 'base-card--padded': padded }">
    <header v-if="title || $slots.header" class="base-card__header">
      <div>
        <h3 v-if="title" class="base-card__title">{{ title }}</h3>
        <p v-if="subtitle" class="base-card__subtitle">{{ subtitle }}</p>
      </div>
      <slot name="header" />
    </header>
    <div class="base-card__body">
      <slot />
    </div>
    <footer v-if="$slots.footer" class="base-card__footer">
      <slot name="footer" />
    </footer>
  </section>
</template>

<script setup lang="ts">
interface Props {
  title?: string;
  subtitle?: string;
  padded?: boolean;
}

withDefaults(defineProps<Props>(), {
  padded: true
});
</script>

<style scoped>
.base-card {
  background: linear-gradient(135deg, rgba(24, 34, 53, 0.95), rgba(20, 28, 44, 0.9));
  border: 1px solid rgba(255, 255, 255, 0.05);
  border-radius: var(--sp-radius-lg);
  box-shadow: var(--sp-shadow-card);
  display: flex;
  flex-direction: column;
}

.base-card--padded {
  padding: var(--sp-spacing-5);
}

.base-card__header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: var(--sp-spacing-4);
}

.base-card__title {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  color: var(--sp-color-heading);
}

.base-card__subtitle {
  margin: 4px 0 0;
  font-size: 13px;
  color: var(--sp-color-muted);
}

.base-card__body {
  flex: 1;
}

.base-card__footer {
  margin-top: var(--sp-spacing-4);
  padding-top: var(--sp-spacing-4);
  border-top: 1px solid rgba(255, 255, 255, 0.05);
}
</style>
