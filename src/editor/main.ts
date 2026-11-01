import { createApp } from 'vue';
import EditorApp from './EditorApp.vue';
import '../sidepanel/styles/tokens.css';

createApp(EditorApp).mount(document.getElementById('app') || document.body);
