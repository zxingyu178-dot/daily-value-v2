/**
 * Daily Value v2 - 数据同步边界测试（Phase 7B-0）
 *
 * 验证 generator 写 IDB 后，orchestration 层强制 billStore.load(true)，
 * 使 Accounting / Statistics / DailyValue 的 Pinia computed 立即响应。
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { openDatabase } from '@/core/db/database';
import { services } from '@/core/services';
import { useBillStore } from '@/core/store/bill';
import { runRecurringAndSync } from '@/core/recurring/orchestration';
import type { RecurringRule } from '@/core/models/types';

const STORES = ['bills', 'categories', 'settings', 'meta', 'recurringRules'] as const;

async function resetDb() {
  const db = await openDatabase();
  const tx = db.transaction(STORES, 'readwrite');
  for (const s of STORES) tx.objectStore(s).clear();
  await tx.done;
  const tx2 = db.transaction('categories', 'readwrite');
  for (const c of [
    { id: 'c-life', name: '生活', emoji: '🏠', builtin: true, sort: 5 },
    { id: 'c-food', name: '餐饮', emoji: '🍚', builtin: true, sort: 1 },
  ]) {
    tx2.store.put(c);
  }
  await tx2.done;
  localStorage.clear();
}

type RuleInput = Omit<
  RecurringRule,
  'id' | 'createdAt' | 'updatedAt' | 'lastGeneratedDate' | 'nextOccurrence'
>;

function baseRule(): RuleInput {
  return {
    enabled: true,
    type: 'expense',
    amount: 100,
    categoryId: 'c-food',
    categoryEmoji: '🍚',
    categoryName: '餐饮',
    note: '周期账单',
    frequency: 'monthly',
    interval: 1,
    day: 1,
    month: 1,
    startDate: '2026-08-01',
    time: '09:00',
  };
}

function at(y: number, m: number, d: number, hh = 12, mm = 0): Date {
  return new Date(y, m - 1, d, hh, mm, 0, 0);
}

describe('SYNC 数据同步边界（Phase 7B-0）', () => {
  beforeEach(async () => {
    setActivePinia(createPinia());
    await resetDb();
  });

  it('SYNC-01 billStore.loaded=true 时 generator 生成后 billStore.normalBills 立即包含新 Bill', async () => {
    const billStore = useBillStore();
    // 预先 load → loaded=true（模拟 Accounting 页面已挂载并 load 过）
    await billStore.load();
    expect(billStore.loaded).toBe(true);
    expect(billStore.normalBills).toHaveLength(0);

    // 新建已到期规则
    await services.recurringRules.add({
      ...baseRule(),
      frequency: 'daily',
      startDate: '2026-08-01',
      time: '09:00',
      amount: 10,
    });

    // 同步流程：generator 写 IDB → runRecurringAndSync 发现 generated>0 → billStore.load(true)
    const result = await runRecurringAndSync(at(2026, 8, 5, 12));
    expect(result.totalGenerated).toBe(5); // 08-01 ~ 08-05

    // billStore 已自动 reload（loaded 仍为 true，但 bills 已更新）
    expect(billStore.normalBills.length).toBe(5);
    expect(billStore.normalBills.every((b) => b.source === 'recurring')).toBe(true);
  });

  it('SYNC-02 Accounting 场景：不重启 App，新建 due recurring rule 后 monthSummary 立即更新', async () => {
    const billStore = useBillStore();
    // Accounting 页面已挂载，billStore 已 load（loaded=true，不会自动 reload）
    await billStore.load();
    const ym = '2026-08';
    expect(billStore.monthSummary(ym).expense).toBe(0);

    // 新建已到期规则（8月，金额 50，daily from 08-01）
    await services.recurringRules.add({
      ...baseRule(),
      frequency: 'daily',
      startDate: '2026-08-01',
      time: '09:00',
      amount: 50,
    });

    // 不重启 App → 同步流程
    await runRecurringAndSync(at(2026, 8, 3, 12));

    // Accounting 的 summary computed 从 billStore.bills 派生，load(true) 后立即更新
    const summary = billStore.monthSummary(ym);
    expect(summary.expense).toBe(150); // 3 days * 50
    expect(summary.income).toBe(0);
    expect(summary.net).toBe(-150);
  });

  it('SYNC-03 Statistics 场景：旧 billStore 数据 → generator 生成 → normalBills 立即更新', async () => {
    const billStore = useBillStore();
    // Statistics 页面已使用旧 billStore
    await billStore.load();
    expect(billStore.normalBills).toHaveLength(0);

    // 添加一条手动账单（模拟旧数据）
    await billStore.add({
      type: 'expense',
      amount: 200,
      categoryId: 'c-food',
      categoryEmoji: '🍚',
      categoryName: '餐饮',
      date: '2026-08-01',
      timestamp: at(2026, 8, 1, 10).getTime(),
      source: 'manual',
      ledgerImpact: 'normal',
      note: '',
    });
    expect(billStore.normalBills).toHaveLength(1);

    // 新建已到期规则
    await services.recurringRules.add({
      ...baseRule(),
      frequency: 'daily',
      startDate: '2026-08-01',
      time: '09:00',
      amount: 30,
    });

    // generator 生成 → 同步 → billStore reload
    await runRecurringAndSync(at(2026, 8, 3, 12));

    // Statistics 的 overview computed 从 billStore.bills 派生，load(true) 后立即更新
    const all = billStore.normalBills;
    expect(all.length).toBe(4); // 1 manual + 3 recurring
    expect(all.filter((b) => b.source === 'recurring')).toHaveLength(3);
    const summary = billStore.monthSummary('2026-08');
    expect(summary.expense).toBe(290); // 200 manual + 3*30 recurring
  });
});
