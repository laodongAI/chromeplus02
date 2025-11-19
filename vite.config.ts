/*
 * Vite 配置：多入口构建（后续可按需补充 popup/options 等入口）。
 * 中文说明：当前仅演示背景脚本与侧边栏入口，后续逐步加入其余部分。
 */
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { resolve } from 'path';

export default defineConfig({
  plugins: [vue()],
  build: {
    outDir: 'dist',
    rollupOptions: {
      input: {
        // 使用 HTML 作为多入口，便于在 Chrome 中直接加载页面
        background: resolve(__dirname, 'src/background/index.ts'),
        sidepanel: resolve(__dirname, 'src/sidepanel/index.html'),
        // 内容脚本单独作为 Rollup 入口，供 manifest 引用
        content: resolve(__dirname, 'src/content-scripts/main.ts')
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
      '@': resolve(__dirname, 'src')
    }
  }
});
