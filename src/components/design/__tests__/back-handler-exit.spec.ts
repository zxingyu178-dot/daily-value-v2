/**
 * 2.9.9 Back 语义回归（BACK-01..05）
 * 主页面（一级 Tab）Back：不 history.back()，执行「双 Back 退出」（提示 → 窗口内第二次退出）。
 * - BACK-01：一级页面第一次 Back → 不离开当前路由、出现「再滑一次退出」提示、armed
 * - BACK-02：窗口内第二次 Back → 真正退出（exitApp）
 * - BACK-03：超时后再 Back → 只再次提示，不退出
 * - BACK-04：非一级页面（Settings 等）Back → 正常 history.back，不出现退出提示
 * - BACK-05：打开覆盖层（register）清除 armed；路由变化（resetExitArmed）也清除
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  initBackHandler,
  handleBackWhenNoOverlay,
  resetExitArmed,
  registerOverlayForBack,
  unregisterOverlayForBack,
  __getExitArmed,
  EXIT_WINDOW_MS,
} from '@/components/design/back-handler';
import { toasts, dismiss } from '@/components/design/toast';

const mocks = vi.hoisted(() => ({
  exitApp: vi.fn(),
  addListener: vi.fn().mockResolvedValue({ remove: vi.fn() }),
}));

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => true },
}));
vi.mock('@capacitor/app', () => ({
  App: { addListener: mocks.addListener, exitApp: mocks.exitApp },
}));

function clearToasts(): void {
  for (const t of [...toasts.value]) dismiss(t.id);
}

function hasHint(): boolean {
  return toasts.value.some((t) => t.message === '再滑一次退出');
}

describe('2.9.9 Back 双退出语义（BACK-01..05）', () => {
  let historyBackSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    resetExitArmed();
    clearToasts();
    mocks.exitApp.mockClear();
    historyBackSpy = vi.spyOn(window.history, 'back').mockImplementation(() => {});
  });

  afterEach(() => {
    resetExitArmed();
    historyBackSpy.mockRestore();
    vi.useRealTimers();
  });

  it('BACK-01 一级页面第一次 Back：停留当前路由 + 提示「再滑一次退出」+ armed（不 history.back）', () => {
    initBackHandler(() => true);
    handleBackWhenNoOverlay(true);
    expect(__getExitArmed()).toBe(true);
    expect(hasHint()).toBe(true);
    expect(historyBackSpy).not.toHaveBeenCalled();
  });

  it('BACK-02 一级页面窗口内第二次 Back：真正退出（exitApp）并清除 armed', async () => {
    initBackHandler(() => true);
    handleBackWhenNoOverlay(true);
    handleBackWhenNoOverlay(true);
    // exitApp 经动态 import 调用：等 microtask 完成
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
    expect(mocks.exitApp).toHaveBeenCalledTimes(1);
    expect(__getExitArmed()).toBe(false);
  });

  it('BACK-03 第一次 Back 后超过窗口再 Back：只再次提示，不退出', () => {
    vi.useFakeTimers();
    initBackHandler(() => true);
    handleBackWhenNoOverlay(true);
    expect(__getExitArmed()).toBe(true);
    // 超过窗口：armed 自动清除
    vi.advanceTimersByTime(EXIT_WINDOW_MS + 200);
    expect(__getExitArmed()).toBe(false);
    // 再次 Back：重新提示，不退出
    handleBackWhenNoOverlay(true);
    expect(hasHint()).toBe(true);
    expect(mocks.exitApp).not.toHaveBeenCalled();
    expect(__getExitArmed()).toBe(true);
  });

  it('BACK-04 非一级页面（Settings 等）：Back 正常 history.back，无退出提示', () => {
    initBackHandler(() => false);
    handleBackWhenNoOverlay(true);
    expect(historyBackSpy).toHaveBeenCalledTimes(1);
    expect(hasHint()).toBe(false);
    expect(__getExitArmed()).toBe(false);
  });

  it('BACK-05 打开覆盖层 / 路由变化都会清除 armed（提示后不可直接退出）', () => {
    initBackHandler(() => true);
    handleBackWhenNoOverlay(true);
    expect(__getExitArmed()).toBe(true);

    // 打开任意 Overlay（registerOverlayForBack）→ armed 立即清除
    const cb = () => {};
    registerOverlayForBack(cb);
    expect(__getExitArmed()).toBe(false);

    // 路由变化（watch route.path → resetExitArmed）再回来重新提示
    handleBackWhenNoOverlay(true);
    expect(__getExitArmed()).toBe(true);
    resetExitArmed();
    expect(__getExitArmed()).toBe(false);

    unregisterOverlayForBack(cb);
  });
});