<template>
  <span v-if="code" class="error-badge" :class="'error-'+(code || 'unknown')" :title="tooltip">
    {{ label }}
  </span>
</template>

<script lang="ts" setup>
import { computed } from 'vue';

interface Props { code?: string; raw?: string }
const props = defineProps<Props>();

function mapCode(c?: string){
  switch(c){
    case 'DRM': return 'DRM受限';
    case 'CORS': return '跨域';
    case 'PERMISSION': return '权限';
    case 'NO_RESOURCE': return '缺失';
    case 'NETWORK': return '网络';
    case 'INTERRUPTED': return '中断';
    case 'UNKNOWN': return '未知';
    default: return c ? c : '错误';
  }
}
function hint(c?: string, raw?: string){
  const tail = raw ? `: ${raw}` : '';
  switch(c){
    case 'DRM': return 'DRM 保护，尝试录制回退'+tail;
    case 'CORS': return '跨域限制，可用录制或同源代理'+tail;
    case 'PERMISSION': return '权限/403 受限，需登录或授权'+tail;
    case 'NO_RESOURCE': return '资源不存在或失效'+tail;
    case 'NETWORK': return '网络失败，可重试'+tail;
    case 'INTERRUPTED': return '下载中断，可重试'+tail;
    case 'UNKNOWN': return '未知错误'+tail;
    default: return (c || '错误') + tail;
  }
}

const label = computed(()=> mapCode(props.code));
const tooltip = computed(()=> hint(props.code, props.raw));
</script>

<style scoped>
.error-badge { display:inline-block; padding:0 6px; line-height:18px; font-size:11px; border-radius:4px; background:#5b1f24; color:#ffb4b4; cursor:help; user-select:none; }
.error-badge.error-NETWORK { background:#402317; color:#ffcfb4; }
.error-badge.error-CORS { background:#3d1f40; color:#f2b4ff; }
.error-badge.error-DRM { background:#2e1f5b; color:#d4c3ff; }
.error-badge.error-PERMISSION { background:#5b3d1f; color:#ffd9b4; }
.error-badge.error-NO_RESOURCE { background:#3b4a55; color:#cdd9e5; }
.error-badge.error-INTERRUPTED { background:#5b1f24; color:#ffb4b4; }
</style>