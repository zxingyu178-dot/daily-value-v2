/**
 * Vitest 全局测试环境配置
 * - fake-indexeddb：为数据层测试提供内存 IndexedDB
 * - Vue Test Utils：卸载组件挂载树，避免测试间污染
 */
import 'fake-indexeddb/auto';
import { afterEach } from 'vitest';
import { enableAutoUnmount } from '@vue/test-utils';

// jsdom 未实现 matchMedia；appStore.resolvedTheme 在 auto 主题下会调用，需最小 polyfill
if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

enableAutoUnmount(afterEach);
