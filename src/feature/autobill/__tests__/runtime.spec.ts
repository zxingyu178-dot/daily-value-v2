/**
 * 2.16.2 LIVE-01..06：AutoBill Runtime 实时同步
 * - pendingChanged 事件 → 立即同步 → 候选生成（事件驱动，不轮询）
 * - 连续触发多个事件 → 串行同步（不并发、不重复建候选、无未处理 rejection）
 * - App resume → 同步（App 级唯一监听）
 * - dispose 后不再响应事件
 * - Native pendingChanged 只带计数；真实内容经 pull 拉取
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { openDatabase } from '@/core/db/database';
import { IdbAutoBillService, IdbCategoryService, IdbSettingsService } from '@/core/services/idb';
import { useAutoBillStore } from '@/core/store/autobill';

const STORES = ['bills', 'categories', 'settings', 'meta', 'recurringRules', 'autoBillCandidates'] as const;

/** 捕获 Native Model 事件回调（通知 → pendingChanged 产生） */
let pendingCb: ((p: { pendingCount: number }) => void) | null = null;
/** 捕获 resume 回调 */
let resumeCb: (() => void) | null = null;

vi.mock('@/feature/autobill/service/notification-bridge', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/feature/autobill/service/notification-bridge')>();
  return {
    ...mod,
    addAutoBillPendingChangedListener: vi.fn((cb) => {
      pendingCb = cb;
      return () => {
        pendingCb = null;
      };
    }),
    pullPendingNativeNotifications: vi.fn(async () => mockPullRecords),
    ackPendingNativeNotifications: vi.fn(async () => undefined),
  };
});

vi.mock('@capacitor/app', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@capacitor/app')>();
  return {
    ...mod,
    App: {
      ...(mod as { App?: object }).App,
      addListener: vi.fn(async (eventName: string, cb: () => void) => {
        if (eventName === 'resume') resumeCb = cb;
        return { remove: () => undefined };
      }),
    },
  };
});

let mockPullRecords: unknown[] = [];

const ALIPAY_RECORD = {
  id: 'n1',
  packageName: 'com.eg.android.AlipayGphone',
  postTime: new Date('2026-09-15T11:00:00+08:00').getTime(),
  capturedAt: new Date('2026-09-15T11:00:00+08:00').getTime(),
  title: '付款成功',
  text: '星巴克',
  bigText: '¥35',
  subText: '',
};

async function resetDb(): Promise<void> {
  const db = await openDatabase();
  const tx = db.transaction(STORES, 'readwrite');
  for (const s of STORES) tx.objectStore(s).clear();
  await tx.done;
  const catSvc = new IdbCategoryService();
  if ((await catSvc.list()).length === 0) {
    await catSvc.add({ name: '餐饮', emoji: '🍚', builtin: true, sort: 1 });
  }
  await new IdbSettingsService().update({ autoBillEnabled: true });
}

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 60));
}

beforeEach(async () => {
  await resetDb();
  mockPullRecords = [];
  pendingCb = null;
  resumeCb = null;
  setActivePinia(createPinia());
  vi.clearAllMocks();
});

describe('LIVE-01/05：pendingChanged 事件 → 实时同步 → 候选生成（事件驱动）', () => {
  it('事件到达后自动同步：Native 拉取 → 候选 1 笔 → Store 刷新', async () => {
    mockPullRecords = [ALIPAY_RECORD];
    const { initAutoBillRuntime } = await import('@/feature/autobill/service/runtime');
    const runtime = initAutoBillRuntime();

    expect(pendingCb).not.toBeNull();
    pendingCb!({ pendingCount: 1 }); // 支付宝通知到达 → Native 事件
    await flush();

    const candidates = await new IdbAutoBillService().listCandidates('WAIT_CONFIRM');
    expect(candidates).toHaveLength(1);
    expect(candidates[0].amount).toBe(35);
    expect(useAutoBillStore().pendingCount).toBe(1); // Pinia 已刷新，页面自动响应
    runtime.dispose();
  });

  it('LIVE-05 Native 同 notificationKey 只保留一条 → 只生成一笔候选', async () => {
    // 原生 upsert 保证同 key 只一条；Web 事件只是通知，真实内容拉取只有 1 条
    mockPullRecords = [{ ...ALIPAY_RECORD, title: '交易提醒', text: '你有一笔35元的支出', bigText: '' }];
    const { initAutoBillRuntime } = await import('@/feature/autobill/service/runtime');
    const runtime = initAutoBillRuntime();
    pendingCb!({ pendingCount: 1 });
    await flush();
    expect(await useAutoBillStore().pendingCount).toBe(1);
    runtime.dispose();
  });

  it('LIVE-04 连续 3 个事件：串行同步，只生成 1 笔候选，无未处理 rejection', async () => {
    mockPullRecords = [ALIPAY_RECORD];
    const { initAutoBillRuntime } = await import('@/feature/autobill/service/runtime');
    const runtime = initAutoBillRuntime();

    // 连发 3 次（native 连续更新：支付成功 → 交易提醒 → 商户通知）
    pendingCb!({ pendingCount: 1 });
    pendingCb!({ pendingCount: 1 });
    pendingCb!({ pendingCount: 1 });
    await flush();

    expect(await new IdbAutoBillService().countWaitConfirm()).toBe(1); // 不重复建
    expect(useAutoBillStore().pendingCount).toBe(1);
    runtime.dispose();
  });
});

describe('LIVE-03：App resume → 自动同步（App 级唯一监听）', () => {
  it('resume 触发后拉取并生成候选', async () => {
    mockPullRecords = [ALIPAY_RECORD];
    const { initAutoBillRuntime } = await import('@/feature/autobill/service/runtime');
    const runtime = initAutoBillRuntime();

    // resume 监听经动态 import(@capacitor/app) 注册，需等一拍
    await new Promise<void>((r) => setTimeout(r, 0));
    await new Promise<void>((r) => setTimeout(r, 0));
    expect(resumeCb).not.toBeNull();
    resumeCb!(); // 从支付宝完成支付返回 App
    await flush();

    expect(await new IdbAutoBillService().countWaitConfirm()).toBe(1);
    runtime.dispose();
  });
});

describe('dispose 后不再响应事件 / 事件只带计数', () => {
  it('dispose() 后 pendingChanged 不再同步', async () => {
    mockPullRecords = [ALIPAY_RECORD];
    const { initAutoBillRuntime } = await import('@/feature/autobill/service/runtime');
    const runtime = initAutoBillRuntime();
    runtime.dispose();

    expect(pendingCb).toBeNull(); // 已移除事件监听
    await flush();
    expect(await new IdbAutoBillService().countWaitConfirm()).toBe(0);
  });
});