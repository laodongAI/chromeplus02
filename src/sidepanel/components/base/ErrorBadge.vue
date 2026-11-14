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
/* UI 三批（组2）：全部错误码徽章色收进 tokens.css 的 --sp-err-* 系列，
   深色模式由 [data-theme='dark'] 整体随动，组件内不再硬编码十六进制色。
   字号 11px 保留：错误码徽章属"纯标注性文字"（组2 允许 11px 的唯一档）。 */
.error-badge { display:inline-block; padding:0 6px; line-height:18px; font-size:11px; border-radius:4px; background:var(--sp-err-bg); color:var(--sp-err-fg); cursor:help; user-select:none; }
.error-badge.error-NETWORK { background:var(--sp-err-network-bg); color:var(--sp-err-network-fg); }
.error-badge.error-CORS { background:var(--sp-err-cors-bg); color:var(--sp-err-cors-fg); }
.error-badge.error-DRM { background:var(--sp-err-drm-bg); color:var(--sp-err-drm-fg); }
.error-badge.error-PERMISSION { background:var(--sp-err-permission-bg); color:var(--sp-err-permission-fg); }
.error-badge.error-NO_RESOURCE { background:var(--sp-err-noresource-bg); color:var(--sp-err-noresource-fg); }
.error-badge.error-INTERRUPTED { background:var(--sp-err-interrupt-bg); color:var(--sp-err-interrupt-fg); }
</style>