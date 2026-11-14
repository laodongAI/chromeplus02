<template>
  <div class="expr-filter">
    <input
      class="expr-filter__input"
      type="text"
      spellcheck="false"
      autocomplete="off"
      :value="modelValue"
      :placeholder="placeholder"
      :aria-label="label"
      :aria-invalid="error ? 'true' : 'false'"
      @input="onInput"
    />
    <div v-if="error" class="expr-filter__error" role="alert">表达式有误：{{ error }}</div>
  </div>
</template>

<script setup lang="ts">
/**
 * 属性过滤表达式输入框（Round 5 #28，音视频嗅探列表共用）。
 *
 * 语法错误只在输入框下方提示、绝不参与过滤：用户是边打字边看结果的，
 * 把 `size>` 这种中间态当成「过滤掉全部」会让人误判页面没有资源。
 */
defineProps<{
  modelValue: string;
  /** compileFilterCached(...).error，空串表示合法或为空 */
  error?: string;
  placeholder?: string;
  label?: string;
}>();

const emit = defineEmits<{ (e: 'update:modelValue', value: string): void }>();

function onInput(event: Event) {
  emit('update:modelValue', (event.target as HTMLInputElement).value);
}
</script>

<style scoped>
.expr-filter {
  flex: 1 1 160px;
  min-width: 140px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.expr-filter__input {
  height: 24px;
  padding: 0 8px;
  font-size: 11px;
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  color: var(--sp-color-text);
  background: var(--sp-color-bg-elevated);
  border: 1px solid var(--sp-color-border);
  border-radius: 4px;
}

.expr-filter__input:focus {
  outline: none;
  border-color: var(--sp-color-border-hover);
}

.expr-filter__input[aria-invalid="true"] {
  border-color: var(--sp-color-danger);
  background: var(--sp-color-danger-light);
}

.expr-filter__error {
  padding: 4px 8px;
  font-size: 11px;
  line-height: 1.5;
  color: var(--sp-color-danger);
  background: var(--sp-color-danger-light);
  border-radius: 4px;
}
</style>
