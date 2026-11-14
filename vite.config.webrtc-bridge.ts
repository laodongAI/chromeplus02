import { defineConfig } from 'vite';
import { contentBuildConfig } from './vite.config.content';

// WebRTC 录流的 ISOLATED 世界桥接脚本：只做 window.postMessage ↔ chrome 消息的转接
export default defineConfig(contentBuildConfig('webrtc-bridge', 'src/content-scripts/webrtc-bridge.ts'));