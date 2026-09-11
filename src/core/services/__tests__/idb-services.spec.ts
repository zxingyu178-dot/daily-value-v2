import { describe, it, expect, beforeEach } from 'vitest';
import { openDatabase } from '@/core/db/database';
import {
  IdbBillService,
  IdbCategoryService,
  IdbSettingsService,
  IdbRecurringRuleService,
} from '@/core/services/idb';
import type { Bill, Category, RecurringRule, Settings, StatisticsModuleId } from '@/core/models/types';

/** 重置测试数据（清空各 store，保留数据库连接） */
const TEST_STORES = ['bills', 'categories', 'settings', 'meta', 'recurringRules'] as const;

async function resetDb(): Promise<void> {
  const db = await openDatabase();
  const tx = db.transaction(TEST_STORES, 'readwrite');
  for (const store of TEST_STORES) {
    tx.objectStore(store).clear();
  }
  await tx.done;
  localStorage.clear();
}

function makeBill(over: Partial<Bill> = {}): Omit<Bill, 'id'> {
  return {
    type: 'expense',
    amount: 25,
    categoryId: 'c-food',
    categoryEmoji: '🍚',
    categoryName: '餐饮',
    note: '午饭',
    date: '2026-08-21',
    timestamp: 1787310000000,
    source: 'manual',
    ledgerImpact: 'normal',
    ...over,
  };
}

const cat: Omit<Category, 'id'> = {
  name: '餐饮',
  emoji: '🍚',
  builtin: true,
  sort: 1,
};

describe('IdbBillService', () => {
  beforeEach(resetDb);

  it('add 后能 list / get', async () => {
    const s = new IdbBillService();
    const created = await s.add(makeBill());
    expect(created.id).toBeTruthy();
    const list = await s.list();
    expect(list).toHaveLength(1);
    expect((await s.get(created.id))?.amount).toBe(25);
  });

  it('listByMonth 按月份过滤', async () => {
    const s = new IdbBillService();
    await s.add(makeBill({ date: '2026-08-01' }));
    await s.add(makeBill({ date: '2026-07-15' }));
    expect((await s.listByMonth('2026-08')).length).toBe(1);
    expect((await s.listByMonth('2026-07')).length).toBe(1);
  });

  it('listByMonth 排除 daily-value-only（不进入月度账本）', async () => {
    const s = new IdbBillService();
    await s.add(makeBill({ date: '2026-08-01', amount: 100 }));
    await s.add(
      makeBill({
        date: '2026-08-02',
        amount: 10000,
        ledgerImpact: 'daily-value-only',
        dailyValue: { enabled: true, mode: 'elapsed', startDate: '2026-01-01' },
      }),
    );
    expect((await s.list()).length).toBe(2); // 全部可读（含日价模块所需）
    expect((await s.listByMonth('2026-08')).length).toBe(1); // 账本口径排除日价
  });

  it('update 合并字段', async () => {
    const s = new IdbBillService();
    const created = await s.add(makeBill());
    await s.update(created.id, { note: '晚餐' });
    expect((await s.get(created.id))?.note).toBe('晚餐');
  });

  it('remove 删除', async () => {
    const s = new IdbBillService();
    const created = await s.add(makeBill());
    await s.remove(created.id);
    expect(await s.get(created.id)).toBeUndefined();
  });
});

describe('IdbCategoryService', () => {
  beforeEach(resetDb);

  it('add/list/get/remove', async () => {
    const s = new IdbCategoryService();
    const created = await s.add(cat);
    expect((await s.list()).length).toBe(1);
    expect((await s.get(created.id))?.name).toBe('餐饮');
    await s.remove(created.id);
    expect(await s.get(created.id)).toBeUndefined();
  });
});

describe('IdbSettingsService', () => {
  beforeEach(resetDb);

  it('默认设置', async () => {
    const s = new IdbSettingsService();
    const settings = await s.get();
    expect(settings.currency).toBe('¥');
    expect(settings.theme).toBe('auto');
    // 2.12.0：旧用户无 statisticsModules 字段时自动回落到全部开启
    expect(settings.statisticsModules).toEqual(['daily-expense-trend', 'income-expense-compare', 'category-ranking', 'cumulative-expense']);
  });

  it('update 持久化并保留未改动字段', async () => {
    const s = new IdbSettingsService();
    await s.update({ theme: 'dark' });
    const settings: Settings = await s.get();
    expect(settings.theme).toBe('dark');
    expect(settings.currency).toBe('¥');
  });

  it('MOD-01/02 我的统计模块：添加/移除经真实 IndexedDB 持久化，重启读回一致', async () => {
    const s = new IdbSettingsService();
    const all: StatisticsModuleId[] = ['daily-expense-trend', 'income-expense-compare', 'category-ranking', 'cumulative-expense'];
    // 只保留前两个
    await s.update({ statisticsModules: all.slice(0, 2) });
    let settings = await s.get();
    expect(settings.statisticsModules).toEqual(all.slice(0, 2));
    // 再添加一个
    await s.update({ statisticsModules: all.slice(0, 3) });
    settings = await s.get();
    expect(settings.statisticsModules).toEqual(all.slice(0, 3));
    // 全清 → 回到空数组
    await s.update({ statisticsModules: [] });
    settings = await s.get();
    expect(settings.statisticsModules).toEqual([]);
    // 不回调其余字段
    expect(settings.theme).toBe('auto');
  });

  it('墙纸 plain DTO 经真实 IndexedDB 持久化后完整一致（读回包含全部参数）', async () => {
    const plainWallpaper: NonNullable<Settings['wallpaper']> = {
      image: 'data:image/jpeg;base64,WALLPAPERDTO',
      blur: 6,
      overlay: 0.45,
    };
    const s = new IdbSettingsService();
    await s.update({ wallpaper: plainWallpaper });

    // 重新读取（真实 IndexedDB 路径，非 mock service），验证 wallpaper 完整一致
    const settings = await s.get();
    expect(settings.wallpaper).toEqual(plainWallpaper);

    // 移除壁纸：显式写入 undefined 覆盖旧值
    await s.update({ wallpaper: { ...plainWallpaper } }); // 先再确认一次可覆盖对象
    const reSet = await s.get();
    expect(reSet.wallpaper).toEqual(plainWallpaper);
  });

  it('墙纸移除后读回为空（不再残留旧值）', async () => {
    const s = new IdbSettingsService();
    await s.update({
      wallpaper: { image: 'data:image/jpeg;base64,W', blur: 4, overlay: 0.25 },
    });
    await s.update({ wallpaper: undefined });
    const settings = await s.get();
    expect(settings.wallpaper).toBeUndefined();
  });
});

describe('IdbRecurringRuleService', () => {
  beforeEach(resetDb);

  it('add/list/remove', async () => {
    const s = new IdbRecurringRuleService();
    const rule: Omit<RecurringRule, 'id' | 'createdAt'> = {
      enabled: true,
      type: 'expense',
      amount: 100,
      categoryId: 'c-food',
      categoryEmoji: '🍚',
      categoryName: '餐饮',
      note: '房租',
      frequency: 'monthly',
      interval: 1,
      day: 1,
      startDate: '2026-08-01',
      time: '09:00',
    };
    const created = await s.add(rule);
    expect((await s.list()).length).toBe(1);
    await s.remove(created.id);
    expect((await s.list()).length).toBe(0);
  });
});
