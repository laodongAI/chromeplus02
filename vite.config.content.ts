import { defineConfig, type UserConfig } from 'vite';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * 内容脚本构建配置工厂。
 *
 * 为什么每个入口单独构建：内容脚本必须是 IIFE（无外部依赖、无 import），
 * 而 Rollup 不允许多入口 + IIFE 共存（共享模块会被拆成 chunk，产生 import 语句）。
 * 所以每个脚本各跑一次构建，各自把依赖内联进单文件。
 */
export function contentBuildConfig(entryName: string, entryFile: string): UserConfig {
  return {
    build: {
      outDir: 'dist',
      emptyOutDir: false, // 不要清空，因为主构建先运行
      rollupOptions: {
        input: {
          [entryName]: resolve(__dirname, entryFile)
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
  };
}

export default defineConfig(contentBuildConfig('content', 'src/content-scripts/main.ts'));