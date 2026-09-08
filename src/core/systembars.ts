/**
 * Daily Value v2 - Android System Bar 安全区 / 系统栏明暗（Phase 7A-Fix3）
 *
 * 背景：CSS `env(safe-area-inset-*)` 在本工程为 0（v7 未注册可注入 insets 的插件，且未 enableEdgeToEdge）。
 * 方案：MainActivity 真正 edge-to-edge 后，经注入的 JS 桥 `window.DailyValueSafeArea`
 * 读取真实 WindowInsets（CSS px），写入 `--dv-safe-top / --dv-safe-bottom`，页面统一消费；
 * 系统栏图标明暗随主题同步（dark → 深色图标）。
 *
 * 桌面/其他平台桥不存在时静默回退 0，不影响构建与 Web 预览。
 */

interface SafeAreaBridge {
  getSafeArea(): string; // "top,bottom"（CSS px）
  setAppearance(dark: boolean): void;
}

declare global {
  interface Window {
    DailyValueSafeArea?: SafeAreaBridge;
  }
}

/** 是否为 Capacitor 原生 WebView（Android）。桥缺失时返回 false。 */
function nativeSafeArea(): SafeAreaBridge | undefined {
  return typeof window !== 'undefined' ? window.DailyValueSafeArea : undefined;
}

/**
 * 从原生读取 top/bottom inset（CSS px）并写入全局 CSS 变量。任何异常/缺失都静默回退 0。
 * 由 bootstrap 在挂载前调用一次 —— 一次取值、全局生效，页面不再各自测。
 */
export function applyNativeSafeArea(): boolean {
  const b = nativeSafeArea();
  if (!b) return false;
  try {
    const [top, bottom] = b
      .getSafeArea()
      .split(',')
      .map((s) => Number.parseFloat(s) || 0);
    const root = document.documentElement;
    root.style.setProperty('--dv-safe-top', `${top}px`);
    root.style.setProperty('--dv-safe-bottom', `${bottom}px`);
    return true;
  } catch {
    return false;
  }
}

/** 随主题同步系统栏明暗（dark=true → 深色图标，用于浅色主题）。 */
export function syncSystemBarAppearance(dark: boolean): void {
  const b = nativeSafeArea();
  if (!b) return;
  try {
    b.setAppearance(dark);
  } catch {
    /* 桥调用失败忽略 */
  }
}