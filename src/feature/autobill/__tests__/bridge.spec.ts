/**
 * 2.15.1 Gate B - 通知桥安全兜底测试（JSDOM / 浏览器环境）
 * 非 Android（JSDOM）环境：
 * - getAccessStatus 返回安全默认值（granted=false），绝不抛异常
 * - pullPendingNativeNotifications 返回空数组，不抛异常
 * - syncEnabledPackagesToNative 静默成功
 * - 权限闭环常量映射（应用名 → 包名）正确
 */
import { describe, expect, it, beforeEach } from 'vitest';
import {
  getAccessStatus,
  openNotificationAccessSettings,
  pullPendingNativeNotifications,
  syncEnabledPackagesToNative,
  isNativeCapacityAvailable,
  APP_PACKAGE_MAP,
} from '@/feature/autobill/service/notification-bridge';

beforeEach(async () => {
  // 清理 settings 默认态（服务端默认 autoBillAllowedApps = ['支付宝','微信支付']）
  const { openDatabase } = await import('@/core/db/database');
  const db = await openDatabase();
  const tx = db.transaction(['settings', 'meta', 'autoBillCandidates'], 'readwrite');
  for (const s of ['settings', 'meta', 'autoBillCandidates'] as const) tx.objectStore(s).clear();
  await tx.done;
});

describe('通知桥：非 Android 安全兜底（jsdom）', () => {
  it('isNativeCapacityAvailable = false（浏览器/JSDOM 无原生能力）', () => {
    expect(isNativeCapacityAvailable()).toBe(false);
  });

  it('getAccessStatus 安全默认：granted=false / connected=false / pendingCount=0（不抛异常）', async () => {
    const s = await getAccessStatus();
    expect(s.granted).toBe(false);
    expect(s.connected).toBe(false);
    expect(s.pendingCount).toBe(0);
  });

  it('openNotificationAccessSettings → false（无法打开），不抛异常', async () => {
    expect(await openNotificationAccessSettings()).toBe(false);
  });

  it('pullPendingNativeNotifications → 空数组且不抛异常', async () => {
    const records = await pullPendingNativeNotifications();
    expect(Array.isArray(records)).toBe(true);
    expect(records).toHaveLength(0);
  });

  it('syncEnabledPackagesToNative 静默成功（不抛异常）', async () => {
    await expect(syncEnabledPackagesToNative()).resolves.toBeUndefined();
  });
});

describe('权限闭环：应用名 → 包名映射（隐私第一行防线）', () => {
  it('支付宝 / 微信支付 映射正确（判定必须用 packageName，不是中文名）', () => {
    expect(APP_PACKAGE_MAP['支付宝']).toBe('com.eg.android.AlipayGphone');
    expect(APP_PACKAGE_MAP['微信支付']).toBe('com.tencent.mm');
  });
});