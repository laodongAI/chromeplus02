import { defineConfig } from 'vite';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  build: {
    outDir: 'dist',
    emptyOutDir: false, // 不要清空，因为主构建先运行
    rollupOptions: {
      input: {
        content: resolve(__dirname, 'src/content-scripts/main.ts')
      },
      output: {
        entryFileNames: 'js/[name].js',
        format: 'iife', // 强制打包为立即执行函数，无外部依赖
        extend: true,
        inlineDynamicImports: true // 内联所有动态导入
      }
    }
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src')
    }
  },
  define: {
    'process.env': {} // 防止某些库引用 process
  }
});
