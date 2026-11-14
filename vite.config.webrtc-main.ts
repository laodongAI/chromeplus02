import { defineConfig } from 'vite';
import { contentBuildConfig } from './vite.config.content';

// WebRTC 录流的 MAIN 世界脚本：必须单文件 IIFE，且不得引用任何 chrome.* API
export default defineConfig(contentBuildConfig('webrtc-main', 'src/content-scripts/webrtc-main.ts'));