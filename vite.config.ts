import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { fileURLToPath, URL } from 'node:url';

/// <reference types="vitest" />

// Daily Value v2 - Vite 基础配置
// base 使用相对路径，保证 Capacitor WebView 从 file:// 加载资源
export default defineConfig({
  base: './',
  plugins: [vue()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2020',
  },
  server: {
    host: true,
    port: 5173,
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['src/test/setup.ts'],
    // 交付产物目录不参与单测发现，避免 handoff/_check_src 等重复/旧版 spec 混入
    exclude: ['**/node_modules/**', '**/dist/**', '**/handoff/**', '**/.delivery/**'],
    // 稳定优先（2.9.9）：多测试文件并发时，worker 内恢复的 jsdom 全局与 fake-indexeddb
    // 单例会跨文件残留状态（偶发数据串扰/超时，如 REC-18/REC-LEGACY-02 在并行下有 2 例失败）。
    // 固定按文件串行执行保证 npm test 稳定全绿；约 80s，换取确定性。
    fileParallelism: false,
  },
});
