/**
 * 2.18.0 Widget V2 测试（WIDGET-V2-01..09）
 * - Snapshot version=2 / expense/income/balance / currency / light/dark / themeStyle
 * - preset accent / custom accent
 * - themeRevision 变化触发 Widget sync
 * - currency 变化触发 Widget sync
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import {
  buildWidgetSnapshotV2,
  resolveWidgetAccent,
  initWidgetSync,
} from '@/core/widget/sync';
import { useAppStore } from '@/core/store/app';
import { useSettingsStore } from '@/core/store/settings';
import { openDatabase } from '@/core/db/database';
import { IdbSettingsService } from '@/core/services/idb';

// Mock WidgetBridge：捕获 saveSnapshot 内容，避免真实 Capacitor 调用
vi.mock('@/core/widget/widget-bridge', () => ({
  WidgetBridge: {
    saveSnapshot: vi.fn(async () => ({ saved: true })),
    refreshWidgets: vi.fn(async () => undefined),
    isSupported: vi.fn(async () => ({ supported: false })),
  },
  isWidgetSupported: vi.fn(async () => true),
}));

const STORES = ['settings', 'meta'] as const;

async function resetDb(): Promise<void> {
  const db = await openDatabase();
  const tx = db.transaction(STORES, 'readwrite');
  for (const s of STORES) tx.objectStore(s).clear();
  await tx.done;
}

beforeEach(async () => {
  await resetDb();
  setActivePinia(createPinia());
  vi.clearAllMocks();
});

describe('WIDGET-V2-01/02：Snapshot 结构与汇总计算', () => {
  it('WIDGET-V2-01：buildWidgetSnapshotV2 输出 version=2 且字段齐全', () => {
    const snap = buildWidgetSnapshotV2({
      now: 1758000000000,
      monthKey: '2026-09',
      expense: 3268.5,
      income: 8600,
      balance: 5331.5,
      currency: '¥',
      resolvedTheme: 'light',
      themeStyle: 'classic',
      accentColor: '#2563eb',
    });
    expect(snap.version).toBe(2);
    expect(snap.monthKey).toBe('2026-09');
    expect(snap.generatedAt).toBe(1758000000000);
    expect(snap.currency).toBe('¥');
    expect(snap.resolvedTheme).toBe('light');
    expect(snap.themeStyle).toBe('classic');
    expect(snap.accentColor).toBe('#2563eb');
  });

  it('WIDGET-V2-02：金额四舍五入到 2 位且 balance=income-expense', () => {
    const snap = buildWidgetSnapshotV2({
      now: 1,
      monthKey: '2026-09',
      expense: 10.005,
      income: 20.004,
      balance: 9.999,
      currency: '$',
      resolvedTheme: 'dark',
      themeStyle: 'soft',
      accentColor: '#000000',
    });
    expect(snap.monthExpense).toBe(10.01);
    expect(snap.monthIncome).toBe(20.0);
    expect(snap.monthBalance).toBe(10.0);
  });
});

describe('WIDGET-V2-03/04/05：currency / resolvedTheme / themeStyle 进入 Snapshot', () => {
  it('WIDGET-V2-03：currency 进入 Snapshot', () => {
    const snap = buildWidgetSnapshotV2({
      now: 1, monthKey: '2026-09', expense: 1, income: 2, balance: 1,
      currency: '€', resolvedTheme: 'light', themeStyle: 'classic', accentColor: '#111111',
    });
    expect(snap.currency).toBe('€');
  });

  it('WIDGET-V2-04：light/dark 进入 Snapshot', () => {
    for (const rt of ['light', 'dark'] as const) {
      const snap = buildWidgetSnapshotV2({
        now: 1, monthKey: '2026-09', expense: 1, income: 2, balance: 1,
        currency: '¥', resolvedTheme: rt, themeStyle: 'classic', accentColor: '#111111',
      });
      expect(snap.resolvedTheme).toBe(rt);
    }
  });

  it('WIDGET-V2-05：themeStyle 进入 Snapshot', () => {
    for (const ts of ['classic', 'soft', 'minimal', 'glass'] as const) {
      const snap = buildWidgetSnapshotV2({
        now: 1, monthKey: '2026-09', expense: 1, income: 2, balance: 1,
        currency: '¥', resolvedTheme: 'dark', themeStyle: ts, accentColor: '#111111',
      });
      expect(snap.themeStyle).toBe(ts);
    }
  });
});

describe('WIDGET-V2-06/07：accent 解析', () => {
  it('WIDGET-V2-06：preset accent（品牌紫/海蓝/翡翠）按明暗取 primary', () => {
    expect(resolveWidgetAccent('violet', undefined, 'light')).toBe('#5b67f0');
    expect(resolveWidgetAccent('violet', undefined, 'dark')).toBe('#7c86ff');
    expect(resolveWidgetAccent('blue', undefined, 'light')).toBe('#2563eb');
    expect(resolveWidgetAccent('blue', undefined, 'dark')).toBe('#60a5fa');
    expect(resolveWidgetAccent('emerald', undefined, 'light')).toBe('#059669');
    // 未知 themeColor → 兜底品牌紫
    expect(resolveWidgetAccent('unknown' as never, undefined, 'light')).toBe('#5b67f0');
  });

  it('WIDGET-V2-07：custom accent（自定义主题色）经 deriveCustomAccent 派生 primary', () => {
    // light: 自定义 #4F8DF7 → primary 直接为该色
    expect(resolveWidgetAccent('custom', '#4F8DF7', 'light')).toBe('#4f8df7');
    // dark: 自定义向白适亮 ~30%（非原样）
    const darkPrimary = resolveWidgetAccent('custom', '#4F8DF7', 'dark');
    expect(darkPrimary).not.toBe('#4f8df7');
    expect(darkPrimary).toMatch(/^#[0-9a-f]{6}$/);
    // 非法 HEX → 回落默认（violet primary）
    expect(resolveWidgetAccent('custom', 'not-a-color', 'light')).toBe('#5b67f0');
  });
});

describe('WIDGET-V2-08/09：主题/币种变化触发 Widget sync', () => {
  it('WIDGET-V2-08：themeRevision 变化触发 syncWidgetSnapshot（含 accent 进入快照）', async () => {
    const { WidgetBridge, isWidgetSupported } = await import('@/core/widget/widget-bridge');
    const { syncWidgetSnapshot } = await import('@/core/widget/sync');
    vi.mocked(isWidgetSupported).mockResolvedValue(true);
    vi.mocked(WidgetBridge.saveSnapshot).mockResolvedValue({ saved: true });

    // 初始：currency=¥；app 设置 dark + emerald（themeRevision 自增）
    await new IdbSettingsService().update({ currency: '¥' });
    const app = useAppStore();
    await useSettingsStore().load(true);
    app.setTheme('dark');
    app.setThemeColor('emerald');

    initWidgetSync();
    await new Promise<void>((r) => setTimeout(r, 700)); // debounce 500ms

    expect(WidgetBridge.saveSnapshot).toHaveBeenCalled();
    const lastCall = vi.mocked(WidgetBridge.saveSnapshot).mock.calls[vi.mocked(WidgetBridge.saveSnapshot).mock.calls.length - 1];
    const snap = JSON.parse(lastCall?.[0].snapshot ?? '{}');
    expect(snap).toMatchObject({
      version: 2,
      currency: '¥',
      resolvedTheme: 'dark',
      themeStyle: 'classic',
      accentColor: '#34d399', // emerald dark primary
    });
    void syncWidgetSnapshot;
  });

  it('WIDGET-V2-09：currency 改变触发 Widget sync', async () => {
    const { WidgetBridge, isWidgetSupported } = await import('@/core/widget/widget-bridge');
    vi.mocked(isWidgetSupported).mockResolvedValue(true);
    vi.mocked(WidgetBridge.saveSnapshot).mockResolvedValue({ saved: true });

    await new IdbSettingsService().update({ currency: '¥' });
    await useSettingsStore().load(true);
    initWidgetSync();
    await new Promise<void>((r) => setTimeout(r, 700));
    const firstCalls = vi.mocked(WidgetBridge.saveSnapshot).mock.calls.length;

    // 改变币种
    await useSettingsStore().update({ currency: '$' });
    await new Promise<void>((r) => setTimeout(r, 700));

    expect(vi.mocked(WidgetBridge.saveSnapshot).mock.calls.length).toBeGreaterThan(firstCalls);
    const lastCall = vi.mocked(WidgetBridge.saveSnapshot).mock.calls[vi.mocked(WidgetBridge.saveSnapshot).mock.calls.length - 1];
    expect(JSON.parse(lastCall?.[0].snapshot ?? '{}').currency).toBe('$');
  });
});