/**
 * 2.15.1 Gate B / 2.17.0 - 通知桥安全兜底测试（JSDOM / 浏览器环境）
 * 非 Android（JSDOM）环境：
 * - getAccessStatus 返回安全默认值（granted=false），绝不抛异常
 * - pullPendingNativeNotifications 返回空数组，不抛异常
 * - syncEnabledPackagesToNative 静默成功
 * - 2.17.0：来源 whitelist 判定改由 Source Registry 派生（包名反查，杜绝中文名判定）
 */
import { describe, expect, it, beforeEach } from 'vitest';
import {
  getAccessStatus,
  openNotificationAccessSettings,
  pullPendingNativeNotifications,
  syncEnabledPackagesToNative,
  isNativeCapacityAvailable,
  isAllowedSourcePackage,
  isAllowedSourceApp,
} from '@/feature/autobill/service/notification-bridge';

beforeEach(async () => {
  // 清理 settings 默认态（服务端默认 autoBillEnabledSources 缺省 → Registry 默认 支付宝+微信）
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

describe('2.17.0 来源白名单：包名 / 中文名均经 Registry 判定（隐私第一行防线）', () => {
  it('默认开启来源：支付宝/微信包名均允许；未知包名拒绝', async () => {
    expect(await isAllowedSourcePackage('com.eg.android.AlipayGphone')).toBe(true);
    expect(await isAllowedSourcePackage('com.tencent.mm')).toBe(true);
    expect(await isAllowedSourcePackage('com.example.evil')).toBe(false);
  });

  it('关闭来源后：该来源包名被拒绝（WECHAT-06 语义：Native 白名单不包含关闭来源）', async () => {
    const { IdbSettingsService } = await import('@/core/services/idb');
    await new IdbSettingsService().update({ autoBillEnabledSources: ['alipay'] });
    expect(await isAllowedSourcePackage('com.tencent.mm')).toBe(false);
    expect(await isAllowedSourcePackage('com.eg.android.AlipayGphone')).toBe(true);
  });

  it('中文来源名兼容判定（旧入口 handleIncomingNotification 语义）', async () => {
    expect(await isAllowedSourceApp('支付宝')).toBe(true);
    expect(await isAllowedSourceApp('微信支付')).toBe(true);
    expect(await isAllowedSourceApp('未知应用')).toBe(false);
  });
});