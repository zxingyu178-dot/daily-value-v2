/**
 * 日价列表计算测试（Phase 5）
 * - 只统计 dailyValue.enabled 的账单（normal+dailyValue 与 daily-value-only 均进入日价）
 * - 日价 = amount / elapsedDays(startDate, 今天)，每天自动重算
 * - 名称优先 title，回退 categoryName
 * - 基础排序：当前日价降序
 */
import { describe, it, expect } from 'vitest';
import { computeDailyValueList } from '@/pages/daily-value/daily-value-list';
import type { Bill } from '@/core/models/types';

function makeBill(over: Partial<Bill>): Bill {
  return {
    id: Math.random().toString(36).slice(2),
    type: 'expense',
    amount: 100,
    categoryId: 'c',
    categoryEmoji: '📦',
    categoryName: '默认',
    note: '',
    date: '2026-08-01',
    timestamp: 1787000000000,
    source: 'manual',
    ledgerImpact: 'normal',
    ...over,
  } as Bill;
}

const TODAY = '2026-08-22';

describe('computeDailyValueList', () => {
  it('只统计 dailyValue.enabled 的账单（普通账单不计入）', () => {
    const normal = makeBill({ dailyValue: undefined });
    const dvOn = makeBill({ dailyValue: { enabled: true, mode: 'elapsed', startDate: '2026-08-01' } });
    const list = computeDailyValueList([normal, dvOn], TODAY);
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe(dvOn.id);
  });

  it('daily-value-only 的账单同样进入日价列表（不进入账单/统计由 ledgerImpact 控制）', () => {
    const dvOnly = makeBill({
      ledgerImpact: 'daily-value-only',
      dailyValue: { enabled: true, mode: 'elapsed', startDate: '2026-08-01' },
    });
    const list = computeDailyValueList([dvOnly], TODAY);
    expect(list).toHaveLength(1);
  });

  it('日价 = amount / elapsedDays，已使用天数随 today 动态变化', () => {
    const bill = makeBill({
      amount: 300,
      dailyValue: { enabled: true, mode: 'elapsed', startDate: '2026-08-01' },
    });
    // 8-22 与 8-01 相差 21 个日历日 → elapsed 21 → 日价 300/21
    const list = computeDailyValueList([bill], TODAY);
    expect(list[0].elapsed).toBe(21);
    expect(list[0].daily).toBeCloseTo(300 / 21, 6);
  });

  it('购买当天 elapsedDays = 1（不出现除以 0）', () => {
    const bill = makeBill({
      amount: 50,
      dailyValue: { enabled: true, mode: 'elapsed', startDate: TODAY },
    });
    const list = computeDailyValueList([bill], TODAY);
    expect(list[0].elapsed).toBe(1);
    expect(list[0].daily).toBe(50);
  });

  it('名称优先用 title，回退 categoryName', () => {
    const withTitle = makeBill({
      title: 'MacBook',
      categoryName: '数码',
      dailyValue: { enabled: true, mode: 'elapsed', startDate: '2026-08-01' },
    });
    const withoutTitle = makeBill({
      categoryName: '餐饮',
      dailyValue: { enabled: true, mode: 'elapsed', startDate: '2026-08-01' },
    });
    const list = computeDailyValueList([withTitle, withoutTitle], TODAY);
    const byId = new Map(list.map((i) => [i.id, i]));
    expect(byId.get(withTitle.id)?.name).toBe('MacBook');
    expect(byId.get(withoutTitle.id)?.name).toBe('餐饮');
  });

  it('基础排序：当前日价降序', () => {
    const cheap = makeBill({
      amount: 20,
      dailyValue: { enabled: true, mode: 'elapsed', startDate: '2026-08-01' }, // 20/21 ≈ 0.95
    });
    const expensive = makeBill({
      amount: 2000,
      dailyValue: { enabled: true, mode: 'elapsed', startDate: '2026-08-01' }, // 2000/21 ≈ 95.2
    });
    const list = computeDailyValueList([cheap, expensive], TODAY);
    expect(list[0].id).toBe(expensive.id);
    expect(list[1].id).toBe(cheap.id);
  });
});
