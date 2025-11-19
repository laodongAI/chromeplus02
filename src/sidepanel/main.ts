/**
 * 侧边栏入口：挂载 Vue 应用。
 * 后续：将原有 DOM 操作迁移为 Vue 组件状态与事件。
 */
import { createApp } from 'vue';
import SidePanelApp from './SidePanelApp.vue';
import './styles/tokens.css';

createApp(SidePanelApp).mount(document.getElementById('app') || document.body);

console.log('[sidepanel:main] Vue 侧边栏入口初始化');
