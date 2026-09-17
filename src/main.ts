/**
 * Daily Value v2 - 应用入口
 * 启动顺序（Phase 7A-Fix 治理冷启动黑屏/闪烁）：
 *   initCore → settings.load（先应用 theme/themeColor/wallpaper）→ runMigrations
 *   → migrate 失败：挂载安全页 → 首个屏幕ready → hideSplash
 *   → migrate 成功：createApp → isReady → mount → 首个屏幕ready → hideSplash
 *   → 首屏完成后再启动 Recurring 周期生成（避免与 migration 同时抢 IDB、不阻塞首屏）。
 */
import { createApp, nextTick } from 'vue';
import { createPinia, setActivePinia } from 'pinia';

import '@/theme/base.css';
import App from '@/App.vue';
import { router } from '@/app/router';
import { initCore } from '@/core/services';
import { useSettingsStore } from '@/core/store/settings';
import { initRecurringGeneration } from '@/core/recurring/orchestration';
import { initWidgetSync } from '@/core/widget/sync';
import { initAutoBillAfterFirstScreen } from '@/feature/autobill/service/runtime';
import { applyNativeSafeArea } from '@/core/systembars';
import { runMigrations } from '@/core/migration/manager';
import '@/core/migration/register';
import MigrationFailure from '@/core/migration/MigrationFailure.vue';
import { hasV1Data } from '@/core/migration/v1-reader';
import { SplashScreen } from '@capacitor/splash-screen';

/**
 * 唯一 Pinia 实例（Phase 3 前置修正 E）：
 * bootstrap 中会在 setup 外调用 useSettingsStore()，Pinia Store 在 setup 外使用
 * 必须已有 active Pinia。这里创建唯一实例并立即 setActivePinia，bootstrap 与最终
 * createApp 共用同一个 pinia，禁止出现两套 Pinia 实例导致持久化设置/主题未生效。
 */
const pinia = createPinia();
setActivePinia(pinia);

/** 启动性能标记（供 tools/startup-frame-check.mjs 从 logcat 读取；bootRef 取 JS bundle 载入时刻） */
const bootRef = performance.now();
function perf(tag: string) {
  // eslint-disable-next-line no-console
  console.log(`[dv:perf] ${tag} ${Math.round(performance.now() - bootRef)}ms`);
}
perf('bundle-start');

/** 等待 1~2 帧，确保 WebView 已完成首屏绘制后再收掉原生 Splash，避免露出未就绪画面。 */
function raf(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

/** 主动关闭原生 Splash（launchAutoHide=false，由 JS 决定 hide 时机） */
function hideSplash() {
  void SplashScreen.hide().catch(() => undefined);
}

/** 移除 Web 首屏紫色承接层（boot-cover）：仅在真实首屏内容完成绘制后再移除，
 *  确保「原生 Splash(紫) → 承载层(紫) → 已加载首屏」全程无灰/白/黑空帧。 */
function removeBootCover() {
  const cover = document.getElementById('boot-cover');
  if (cover) {
    // 轻微淡出（静态启动图 + 柔和过渡，不做复杂动画，避免额外黑白闪烁风险）
    cover.style.transition = 'opacity 200ms ease';
    cover.style.opacity = '0';
    window.setTimeout(() => cover.remove(), 260);
  }
}

/**
 * 启动图承接层（P1 Splash 优化，不改启动时序）：
 * 若存在 public/splash/splash.png（用户替换更好启动图时放入，竖版建议 1280×1920），
 * 则作为 boot-cover 背景展示，与 Native Splash 使用同一张图，Splash→内容 过渡更柔和、不跳色；
 * 图片缺失 / 加载失败时静默回退到纯色紫承接，保持现状。
 *
 * Native Splash 侧替换流程：用新启动图覆盖 android/app/src/main/res/drawable 下
 * 各 density 目录（含 drawable-port-* 竖屏、drawable-land-* 横屏）的 splash.png，
 * 或用单张源图执行 npx capacitor-assets generate --splash 自动生成全部尺寸。
 */
function applyBootSplash() {
  const cover = document.getElementById('boot-cover');
  if (!cover) return;
  const img = new Image();
  img.onload = () => {
    cover.style.backgroundImage = `url(${img.src})`;
  };
  img.src = '/splash/splash.png';
}

/** 首屏已绘制完成 → 收掉 Splash 与 Web 承接层 */
async function firstScreenReady() {
  await nextTick();
  await raf();
  await raf();
  await raf();
  removeBootCover();
  hideSplash();
}

/** 挂载安全页（迁移未完成/异常），并确保 Splash 能正常关闭 */
async function mountSafe(result: {
  from: number;
  to: number;
  ok: boolean;
  message: string;
  done?: boolean;
}) {
  const app = createApp(MigrationFailure, { result });
  app.mount('#app');
  // eslint-disable-next-line no-console
  console.log('[dv:perf] safe-page-mount');
  await firstScreenReady();
}

async function bootstrap() {
  // 0. 启动图承接层：尽早尝试加载可替换启动图作为 boot-cover 背景（缺失时纯色紫兜底）
  applyBootSplash();
  // 1. Core 数据层 + 设置加载：theme / themeColor / wallpaper 在挂载前全部应用，
  //    避免首帧出现默认 light / dark 的「主题闪烁」
  try {
    await initCore();
    // 读取真实 Android 系统栏安全区并写入 --dv-safe-top/bottom（挂载前，避免首帧排版突变）
    applyNativeSafeArea();
    await useSettingsStore().load();
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[dv] core init failed:', err);
  }

  // 2. 数据版本检测与迁移（Phase 2 真实 v1→v2）
  let result;
  try {
    result = await runMigrations();
    // eslint-disable-next-line no-console
    console.log('[dv] migration:', result.message);
  } catch (err) {
    // 迁移抛出未预期异常：若存在 v1 数据 → 进入安全页，不得进入空 App
    // eslint-disable-next-line no-console
    console.warn('[dv] migration exception:', err);
    if (hasV1Data()) {
      await mountSafe({ from: 0, to: 0, ok: false, message: String(err), done: false });
      return;
    }
    await appMount();
    return;
  }

  // 3. 迁移失败（有 v1 数据需要升级但未完成）→ 显示安全页，不进入正常账单页面
  if (!result.ok && hasV1Data()) {
    await mountSafe(result);
    return;
  }

  // 4. 迁移成功 → 挂载主应用，等待首屏 ready 后收掉 Splash
  await appMount();
}

async function appMount() {
  const app = createApp(App);
  app.use(pinia);
  app.use(router);
  // 等初始路由（含根路由 /→/accounting 重定向与 lazy 组件）解析完成，避免首帧空白
  await router.isReady();
  app.mount('#app');
  perf('vue-mount');

  // 首屏绘制完成后收掉 Splash
  await firstScreenReady();
  perf('first-screen-ready');

  // 5. Recurring 周期生成：migration 已确认成功、首屏已完成，后台补到期 Bill，
  //    不阻塞首屏；resume/焦点触发也在此统一注册
  try {
    initRecurringGeneration();
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[dv] recurring init failed:', err);
  }

  // 6. Widget 同步：初始化 $subscribe 监听 + 首次 snapshot 推送（Phase 7B-1）
  try {
    initWidgetSync();
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[dv] widget sync init failed:', err);
  }

  // 7. 2.16.2 AutoBill Runtime：首屏 Ready 后统一注册（resume + pendingChanged 事件 +
  //    首次同步）。后台异步、失败静默；启动只弹更新日志（AutoBill 永不弹启动 Modal）。
  // 2.17.2 P0：initAutoBillAfterFirstScreen 内部先执行 Native State Reconciliation
  //    （把当前 Settings 同步到 Native：升级场景 2.17.0 关闭过总开关但 Native 残留白名单，
  //    用户不进入设置页也能自动修正 → packages=[] + Queue 清理），
  //    完成后才开始首次 Native Queue → Candidate Sync（不塞回首屏关键路径）。
  try {
    await initAutoBillAfterFirstScreen();
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[dv] autobill runtime init failed:', err);
  }
}

void bootstrap();