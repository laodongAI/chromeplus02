/*
 * Vite 配置：多入口构建（后续可按需补充 popup/options 等入口）。
 * 中文说明：当前仅演示背景脚本与侧边栏入口，后续逐步加入其余部分。
 */
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

// 兼容 ESM 环境下的 __dirname
const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [vue()],
  build: {
    outDir: 'dist',
    rollupOptions: {
      input: {
        // 使用 HTML 作为多入口，便于在 Chrome 中直接加载页面
        background: resolve(__dirname, 'src/background/index.ts'),
        sidepanel: resolve(__dirname, 'src/sidepanel/index.html'),
        editor: resolve(__dirname, 'src/editor/index.html')
        // 内容脚本移至 vite.config.content.ts 单独构建
      },
      output: {
        entryFileNames: 'js/[name].js',
        chunkFileNames: 'js/[name]-[hash].js',
        assetFileNames: (asset) => {
          if (/\.css$/i.test(asset.name || '')) return 'css/[name]-[hash][extname]';
          return 'assets/[name]-[hash][extname]';
        },
        // 手动拆分公共依赖，减小各入口初始加载体积
        manualChunks: {
          'vendor-vue': ['vue'],
        }
      }
    }
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
      // vendored mux.js(UMD) 的唯一依赖垫片（Service Worker 无 window）
      'global/window': resolve(__dirname, 'src/vendor/global-window.js')
    }
  }
});
