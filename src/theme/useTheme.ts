/**
 * Daily Value v2 - useTheme 组合式函数
 * 统一主题切换入口（页面禁止自行定义颜色/动画，一律走 Theme 系统）。
 * 切换结构：useTheme → appStore(setTheme) → document[data-theme] + CSS 变量。
 * 持久化在 Phase 1 Core Layer 接入 settingsStore。
 */
import { computed } from 'vue';
import { useAppStore } from '@/core/store/app';

export function useTheme() {
  const app = useAppStore();

  /** 当前主题（auto/light/dark） */
  const theme = computed(() => app.theme);
  /** 实际生效主题（auto 已解析为 light/dark） */
  const resolvedTheme = computed(() => app.resolvedTheme);

  function switchTheme(value: 'auto' | 'light' | 'dark') {
    app.setTheme(value);
  }

  return { theme, resolvedTheme, switchTheme };
}
