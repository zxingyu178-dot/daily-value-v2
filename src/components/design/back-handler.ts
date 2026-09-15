/**
 * Daily Value v2 - Android 返回键处理（Design System 内部）
 * 供 DVSheet 等全屏覆盖层使用：返回键关闭最顶层覆盖层，而非退出应用。
 *
 * 机制（依据 @capacitor/app Android 实现）：
 * - 注册常驻 backButton 监听（有监听时返回键走 JS 事件，不再触发系统默认）。
 * - 有覆盖层打开时：返回键关闭最顶层覆盖层。
 * - 无覆盖层 + 一级业务页面（统计/记账/日价，由 App 层传入谓词）：不 history.back()，
 *   执行「双 Back 退出」——第一次提示「再滑一次退出」，EXIT_WINDOW_MS 窗口内第二次真正退出。
 * - 无覆盖层 + 其它页面：canGoBack → history.back()；否则 → App.exitApp()。
 * - 非 Capacitor 环境（浏览器开发）自动降级为 no-op。
 *
 * 一级 Tab 语义（2.9.9 Back P0）：统计/记账/日价是平级 Tab，Tab 切换用 replace 不进 History，
 * 因此在一级页面上按 Back 绝不能回退到“上一个 Tab”。
 */
import { Capacitor } from '@capacitor/core';
import { toast } from '@/components/design/toast';

/** 已打开的覆盖层关闭回调栈（后进先出） */
const closeStack: Array<() => void> = [];

let ready: Promise<void> | null = null;

/* ---- 一级页面（主 Tab）双 Back 退出（2.9.9） ---- */

/** 双 Back 退出窗口（ms）：窗口内第二次 Back 才真正退出 */
export const EXIT_WINDOW_MS = 1800;

/** App 层传入的一级业务页面判断谓词（统计/记账/日价） */
let primaryRouteMatcher: (() => boolean) | null = null;

/** 是否已 armed：第一次 Back 已提示，等待第二次 Back */
let exitArmed = false;
let exitArmedAt = 0;
let exitArmedTimer: ReturnType<typeof setTimeout> | null = null;

/** 清除退出 armed 状态（路由变化 / 打开覆盖层 / Back 关闭覆盖层 / App 回前台时调用） */
export function resetExitArmed(): void {
  exitArmed = false;
  exitArmedAt = 0;
  if (exitArmedTimer) {
    clearTimeout(exitArmedTimer);
    exitArmedTimer = null;
  }
}

function showExitHint(): void {
  toast.info('再滑一次退出');
}

/**
 * 一级页面 Back：不改变路由、不 history.back()。
 * 第一次提示；EXIT_WINDOW_MS 窗口内第二次 → App.exitApp() 回桌面；超时后清除 armed。
 */
function primaryBack(): void {
  const now = Date.now();
  if (exitArmed && now - exitArmedAt <= EXIT_WINDOW_MS) {
    resetExitArmed();
    if (Capacitor.isNativePlatform()) {
      void import('@capacitor/app').then(({ App }) => App.exitApp());
    }
    return;
  }
  exitArmed = true;
  exitArmedAt = now;
  if (exitArmedTimer) clearTimeout(exitArmedTimer);
  exitArmedTimer = setTimeout(resetExitArmed, EXIT_WINDOW_MS);
  showExitHint();
}

/**
 * 无覆盖层时的 Back 分发（导出供真机 listener 与单测共用）：
 * - 一级页面 → 双 Back 退出
 * - 其它页面 → 正常 history.back()；无历史可退则 exitApp
 */
export function handleBackWhenNoOverlay(canGoBack: boolean): void {
  if (primaryRouteMatcher?.()) {
    primaryBack();
    return;
  }
  if (canGoBack) {
    window.history.back();
  } else if (Capacitor.isNativePlatform()) {
    void import('@capacitor/app').then(({ App }) => App.exitApp());
  }
  resetExitArmed();
}

async function ensurePlugin(): Promise<void> {
  if (ready) return ready;
  ready = (async () => {
    if (!Capacitor.isNativePlatform()) return;
    try {
      const { App } = await import('@capacitor/app');
      await App.addListener('backButton', ({ canGoBack }) => {
        if (closeStack.length > 0) {
          // 关闭最顶层覆盖层；用 Back 关闭覆盖层后，退出提示不应残留
          const close = closeStack.pop();
          close?.();
          resetExitArmed();
        } else if (runBackInterceptors()) {
          // 2.16.5：页面级拦截器已消费（如 AutoBill 内部 Panel 返回），不再历史回退
        } else {
          handleBackWhenNoOverlay(canGoBack);
        }
      });
      // App 回到前台（resume / 页面重新可见）：清除 armed，避免“提示后切后台再回直接退出”
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') resetExitArmed();
      });
      window.addEventListener('focus', resetExitArmed);
    } catch {
      // 无 @capacitor/app 时忽略（浏览器/降级环境）
    }
  })();
  return ready;
}

/**
 * 初始化返回键处理（幂等；应在应用启动时调用）。
 * 由 App 层传入一级业务页面判断谓词（PRIMARY_ROUTES 子集），Design System 不硬编码业务路由。
 */
export function initBackHandler(matchPrimary?: () => boolean): void {
  primaryRouteMatcher = matchPrimary ?? null;
  void ensurePlugin();
}

/** 覆盖层打开时注册：返回键优先关闭该覆盖层（保证每个 callback 在栈中唯一，杜绝 stale 残留） */
export function registerOverlayForBack(close: () => void): void {
  // 栈修改必须同步完成，插件初始化异步化但不阻塞 push，
  // 避免调用方未 await 时 register 恢复竞态把已关闭的 callback 再次压栈（P0-2）。
  // 去重：先移除已有的同 callback，再 push 到栈顶，保持各覆盖层间真正的 LIFO 层级
  const existing = closeStack.indexOf(close);
  if (existing >= 0) closeStack.splice(existing, 1);
  closeStack.push(close);
  // 2.9.9：任何覆盖层打开，都视为“离开退出窗口”——立即清除退出 armed 状态，
  // 防止「提示 → 打开 Sheet → 关掉 → 再 Back 直接退出」。
  resetExitArmed();
  void ensurePlugin();
}

/** 覆盖层关闭时注销：删除所有与该 callback 相同的项（同步，无竞态） */
export function unregisterOverlayForBack(close: () => void): void {
  for (let i = closeStack.length - 1; i >= 0; i--) {
    if (closeStack[i] === close) closeStack.splice(i, 1);
  }
}

/* ---- 页面级 Back 拦截器（2.16.5）：非 Overlay 页面（如 AutoBill 内部 Panel）接入系统 Back ---- */

/**
 * 页面级 Back 拦截器栈：handler 返回 true = 已消费本次 Back，不再执行历史回退/退出。
 * 供【内部 Panel 状态】这类不走 Browser History 的页面层级用：当内部层级偏离入口层级时消费，
 * 回到入口层级后返回 false，交还全局 history.back()/退出。
 * 优先序列：覆盖层(Overlay) > 页面拦截器 > 一级页双 Back / history.back()
 */
const backInterceptors: Array<() => boolean> = [];

/**
 * 注册页面级 Back 拦截器（返回注销函数），组件 mount 时调用。
 * 与覆盖层栈同类思想：去重 + push 栈顶，保证 LIFO。
 */
export function registerBackInterceptor(handler: () => boolean): () => void {
  const existing = backInterceptors.indexOf(handler);
  if (existing >= 0) backInterceptors.splice(existing, 1);
  backInterceptors.push(handler);
  resetExitArmed();
  void ensurePlugin();
  return () => unregisterBackInterceptor(handler);
}

/** 注销页面级 Back 拦截器：删除所有相同项（组件 unmount 时调用） */
export function unregisterBackInterceptor(handler: () => boolean): void {
  for (let i = backInterceptors.length - 1; i >= 0; i--) {
    if (backInterceptors[i] === handler) backInterceptors.splice(i, 1);
  }
}

/** 按 LIFO 运行最顶层拦截器，返回是否已消费本次 Back */
function runBackInterceptors(): boolean {
  for (let i = backInterceptors.length - 1; i >= 0; i--) {
    if (backInterceptors[i]()) return true;
  }
  return false;
}

/** 仅测试用：暴露覆盖层关闭回调栈，供去重/清理断言（生产不依赖）。 */
export const __getBackOverlayStack = (): Array<() => void> => closeStack;

/** 仅测试用：暴露页面拦截器栈，供「系统 Back 在 Panel 内先退 Panel」断言。 */
export const __getBackInterceptorStack = (): Array<() => boolean> => backInterceptors;

/** 仅测试用：暴露当前退出 armed 状态（BACK-01..03 断言）。 */
export const __getExitArmed = (): boolean => exitArmed;