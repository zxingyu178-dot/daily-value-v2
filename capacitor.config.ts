import type { CapacitorConfig } from '@capacitor/cli';

// Daily Value v2 - Capacitor 配置
// appId 必须与 v1 保持一致（com.dailyvalue.app），保证覆盖升级数据目录不变
const config: CapacitorConfig = {
  appId: 'com.dailyvalue.app',
  appName: '每日的价值',
  webDir: 'dist',
  // WebView 加载期的兜底背景：与 Native Splash / 深色主题统一，避免冷启动黑帧
  backgroundColor: '#5B67F0',
  plugins: {
    SplashScreen: {
      // 冷启动 Splash 由 JS 主动隐藏（bootstrap 首屏 ready 后 hide），避免黑/白闪烁
      launchAutoHide: false,
      // 关键：launchShowDuration=0 让 @capacitor/splash-screen 走「原生 Android 12 系统 Splash」，
      // 不再安装 keepOnScreen + pre-draw 阻塞（否则 WebView 在整个 Splash 期间无法绘制，
      // hide() 一收就裸机呈现首帧 → 中间灰帧）。由系统 Splash 在 App 首个真帧就绪时无缝交叉淡出。
      launchShowDuration: 0,
      launchFadeOutDuration: 150,
      // 与 Native Launch 背景一致（styles.xml windowSplashScreenBackground）
      backgroundColor: '#5B67F0',
      androidScaleType: 'CENTER_CROP',
      showSpinner: false,
    },
    // 注：不再配置 SystemBars —— 本工程未安装 @capacitor/status-bar，其 insetsHandling:'css'
    // 并不真正注入 env(safe-area-inset-*)。Android 安全区统一由 MainActivity + 原生 JS 桥在
    // window.DailyValueSafeArea 提供，写入 --dv-safe-top/bottom，页面统一消费（Phase 7A-Fix3）。
  },
};

export default config;
