<template>
  <div class="base-search-bar" :class="{ 'is-disabled': disabled }">
    <div class="search-wrap">
      <svg class="search-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
      </svg>
      <input ref="innerInput" class="search-input" :placeholder="placeholder" :disabled="disabled" v-model="localValue" @input="emitUpdate" />
      <button v-if="localValue" class="search-clear" @click="clearValue" type="button">
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </div>
    <span v-if="hint && showHint" class="search-hint">{{ hint }}</span>
  </div>
</template>
<script lang="ts" setup>
import { ref, watch, onMounted } from 'vue';
const props = defineProps<{ modelValue:string; placeholder?:string; disabled?:boolean; hint?:string; showHint?:boolean; inputRef?:any; }>();
const emit = defineEmits<{ (e:'update:modelValue', v:string):void }>();
const localValue = ref(props.modelValue || '');
const innerInput = ref<HTMLInputElement|null>(null);
watch(()=>props.modelValue, v => { if (v!==localValue.value) localValue.value = v||''; });
function emitUpdate() { emit('update:modelValue', localValue.value); }
function clearValue() { localValue.value=''; emit('update:modelValue',''); }
onMounted(()=>{ if(props.inputRef) { try { if(typeof props.inputRef==='object'&&'value' in props.inputRef) props.inputRef.value=innerInput.value; } catch {} } });
</script>
<style scoped>
.base-search-bar { display:flex; align-items:center; gap:8px; }
.search-wrap { position:relative; display:flex; align-items:center; }
.search-icon { position:absolute; left:8px; color:var(--sp-color-muted); pointer-events:none; flex-shrink:0; }
.search-input { padding:5px 28px 5px 26px; border:1px solid var(--sp-color-border-strong); border-radius:var(--sp-radius-md); font-size:11px; width:200px; background:var(--sp-color-bg-elevated); color:var(--sp-color-text); font-family:var(--sp-font-family); transition:all var(--sp-transition-fast); outline:none; height:28px; }
.search-input::placeholder { color:var(--sp-color-muted); }
.search-input:focus { border-color:var(--sp-color-primary); box-shadow:0 0 0 3px var(--sp-color-primary-light); }
.search-input:disabled { opacity:.5; cursor:not-allowed; }
.search-clear { position:absolute; right:7px; background:none; border:none; cursor:pointer; color:var(--sp-color-muted); display:flex; align-items:center; padding:0; transition:color var(--sp-transition-fast); }
.search-clear:hover { color:var(--sp-color-text); }
.search-hint { font-size: 11px; color:var(--sp-color-muted); font-family:var(--sp-font-mono,monospace); white-space:nowrap; }
.is-disabled .search-input { opacity:.5; }
</style>
