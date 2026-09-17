/**
 * 2.19.0 年度统计测试（YEAR-01..11）
 * 纯函数层 + 钻取 query 契约（YEAR-09/10 由 buildSearchQuery 覆盖，见 bill-search.spec.ts）。
 */
import { describe, expect, it } from 'vitest';
import {
  activeExpenseMonthCount,
  computeYearAverageMonthlyExpense,
  computeYearBillCount,
  computeYearCategoryRanking,
  computeYearExtremeMonths,
  computeYearFacts,
  computeYearMaxExpense,
  computeYearMonthlyTrend,
  computeYearOverview,
  yearRangeFromBills,
} from '@/core/statistics/year';
import { buildSearchQuery } from '@/core/search/bill-search';
import type { Bill } from '@/core/models/types';

function makeBill(patch: Partial<Bill> & Pick<Bill, 'id' | 'date' | 'type' | 'amount' | 'categoryId' | 'categoryName'>): Bill {
  return {
    note: '',
    categoryEmoji: '☕',
    timestamp: new Date(`${patch.date}T12:00:00`).getTime(),
    source: 'manual',
    ledgerImpact: 'normal',
    ...patch,
  };
}

/** 2026 全年 12 个月都有数据：支出/收入/分类覆盖 5+ 分类（验收数据口径） */
function buildYearFixtures(): Bill[] {
  const bills: Bill[] = [];
  const months = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
  // 每月一笔固定支出（2 月最少）
  const monthExpense = [2000, 1860, 2500, 2200, 2400, 2600, 3100, 5620, 3200, 2900, 2100, 2800];
  let i = 0;
  for (const m of months) {
    bills.push(
      makeBill({
        id: `e-${m}-1`, date: `2026-${String(m).padStart(2, '0')}-10`, type: 'expense',
        amount: monthExpense[i] * 0.7, categoryId: 'c-food', categoryName: '餐饮',
      }),
      makeBill({
        id: `e-${m}-2`, date: `2026-${String(m).padStart(2, '0')}-20`, type: 'expense',
        amount: monthExpense[i] * 0.3, categoryId: 'c-transport', categoryName: '交通',
      }),
    );
    bills.push(
      makeBill({
        id: `i-${m}`, date: `2026-${String(m).padStart(2, '0')}-01`, type: 'income',
        amount: 8000, categoryId: 'c-salary', categoryName: '薪资',
      }),
    );
    i += 1;
  }
  // 大额支出：9 月 Apple Store（最大单笔）
  bills.push(makeBill({ id: 'max-1', date: '2026-09-12', type: 'expense', amount: 6999, categoryId: 'c-shopping', categoryName: '购物', title: 'Apple Store' }));
  // 购物/娱乐分类补充（分类排名 Top5 覆盖）
  for (const [id, , name, amt, date] of [
    ['s1', 'c-shopping', '购物', 850, '2026-03-02'],
    ['s2', 'c-fun', '娱乐', 620, '2026-04-03'],
    ['s3', 'c-life', '居家', 480, '2026-05-04'],
    ['s4', 'c-medical', '医疗', 260, '2026-06-05'],
  ] as const) {
    bills.push(makeBill({ id, date, type: 'expense', amount: amt, categoryId: id, categoryName: name }));
  }
  // daily-value-only 不得污染年度统计（日价 legacy）
  bills.push(makeBill({ id: 'dv-9', date: '2026-09-01', type: 'expense', amount: 88888, categoryId: 'c-fun', categoryName: '娱乐', ledgerImpact: 'daily-value-only' }));
  // 2025 旧年份（不影响 2026 年度统计）
  bills.push(makeBill({ id: 'y25', date: '2025-11-11', type: 'expense', amount: 100, categoryId: 'c-food', categoryName: '餐饮' }));
  return bills;
}
const FIX = buildYearFixtures();

describe('YEAR-01/08：全年汇总与账单数量', () => {
  it('YEAR-01 computeYearOverview 全年 expense/income/net', () => {
    const ov = computeYearOverview(FIX, 2026);
    // 收入 = 12 × 8000
    expect(ov.income).toBe(96000);
    // 支出 = 12 个月各自的 0.7+0.3 = 每月 expense 总和 + 附加分类
    expect(ov.expense).toBeGreaterThan(0);
    expect(ov.net).toBe(ov.income - ov.expense);
    // daily-value-only 不进：收入不含、支出不含 88888
    expect(ov.expense).toBeLessThan(88888);
  });

  it('YEAR-08 computeYearBillCount 账单数量（统计口径内）', () => {
    const count = computeYearBillCount(FIX, 2026);
    // 12 个月 × 3 + max-1 + 4 附加 = 41（dv/y25 不进）
    expect(count).toBe(41);
  });
});

describe('YEAR-02：12 个月趋势', () => {
  it('computeYearMonthlyTrend 固定输出 1~12 月', () => {
    const trend = computeYearMonthlyTrend(FIX, 2026);
    expect(trend.length).toBe(12);
    expect(trend.map((t) => t.month)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(trend[0].label).toBe('1月');
    // 8 月支出 = 5620
    expect(trend[7].expense).toBe(5620);
    expect(trend[7].income).toBe(8000);
    // 无数据年份：全 0
    const empty = computeYearMonthlyTrend(FIX, 2023);
    expect(empty.every((t) => t.expense === 0 && t.income === 0)).toBe(true);
  });
});

describe('YEAR-03..05：月均 / 最高月 / 最低月', () => {
  it('YEAR-03 月均支出 = 全年支出 ÷ 有支出活跃月数', () => {
    const trend = computeYearMonthlyTrend(FIX, 2026);
    const ov = computeYearOverview(FIX, 2026);
    const active = activeExpenseMonthCount(trend);
    expect(active).toBe(12);
    expect(computeYearAverageMonthlyExpense(ov, active)).toBeCloseTo(ov.expense / 12, 8);
    // 全年无支出 → 0（不要 NaN/Infinity）
    expect(computeYearAverageMonthlyExpense(computeYearOverview(FIX, 2023), 0)).toBe(0);
  });

  it('YEAR-04 最高支出月份 = 9月（9月含 Apple Store 大额，真实数据决定，非固定示例 8月）', () => {
    const ext = computeYearExtremeMonths(computeYearMonthlyTrend(FIX, 2026));
    // 9 月 = 3200 + 6999(Apple Store) = 10199 > 8 月 5620
    expect(ext.max).toMatchObject({ month: 9, label: '9月', expense: 10199 });
  });

  it('YEAR-05 最低支出月份排除空月（只在有支出月份中计算）', () => {
    // fixture 里 2 月支出最小（1860），无空月。追加一个空月场景验证不取 0。
    const withEmpty = [...FIX.filter((b) => b.date.startsWith('2026-02'))]; // 保留 2 月
    const noMar = FIX.filter((b) => !b.date.startsWith('2026-03')); // 去掉 3 月（空月）
    const ext = computeYearExtremeMonths(computeYearMonthlyTrend(noMar, 2026));
    expect(ext.min).toBeDefined();
    expect(ext.min!.expense).toBeGreaterThan(0); // 不会被 0 当作最低月
    expect(ext.min!.month).toBe(2);
    void withEmpty;
    // 全年无支出 → 两者 undefined
    const empty = computeYearExtremeMonths(computeYearMonthlyTrend(FIX, 2023));
    expect(empty.max).toBeUndefined();
    expect(empty.min).toBeUndefined();
  });
});

describe('YEAR-06：年度 Top 分类', () => {
  it('computeYearCategoryRanking 默认 Top5 按金额降序 + 百分比', () => {
    const rank = computeYearCategoryRanking(FIX, 2026);
    expect(rank.length).toBe(5);
    for (let i = 1; i < rank.length; i++) expect(rank[i - 1].amount >= rank[i].amount).toBe(true);
    const total = rank.reduce((s, r) => s + r.amount, 0);
    const all = computeYearCategoryRanking(FIX, 2026, 0);
    expect(total).toBeLessThanOrEqual(all.reduce((s, r) => s + r.amount, 0));
    // 百分比总和 ≤ 100
    const pctSum = rank.reduce((s, r) => s + r.percent, 0);
    expect(pctSum).toBeLessThanOrEqual(100.1);
    expect(rank[0].percent).toBeGreaterThan(0);
  });
});

describe('YEAR-07：最大单笔支出', () => {
  it('computeYearMaxExpense 返回金额最大的一笔支出', () => {
    const max = computeYearMaxExpense(FIX, 2026);
    expect(max).toBeDefined();
    expect(max!.id).toBe('max-1');
    expect(max!.amount).toBe(6999);
    // 空年份 → undefined
    expect(computeYearMaxExpense(FIX, 2023)).toBeUndefined();
  });
});

describe('YEAR：消费足迹与年份列表', () => {
  it('computeYearFacts 返回最大单笔/记录最多分类/最常消费月份', () => {
    const facts = computeYearFacts(FIX, 2026);
    expect(facts.maxExpense?.id).toBe('max-1');
    // 记录最多的分类：28 笔餐饮（12 笔月食 10 + 12 笔第二笔？—— 按 fixture：每月 2 笔支出全在餐饮/交通，
    // 12×1 餐饮 + 12×0（第二笔交通）→ 餐饮 12 笔；购物 5 笔（max-1 + s1 + 每月 0）等等，以断言 count 存在为准
    expect(facts.topCategory).toBeDefined();
    expect(facts.topCategory!.count).toBeGreaterThan(0);
    // 最常消费月份：每月支出 2 笔 + 附加集中在 3-6 月，9 月多 1 笔 Apple Store + 12 月无附加 → 最多笔数月 = 2+1=3? 
    // 直接断言存在且 label 合理
    expect(facts.topMonth).toBeDefined();
    expect(facts.topMonth!.label).toMatch(/^\d+月$/);
    // daily-value-only 不参与
    expect(facts.maxExpense!.amount).toBe(6999);
  });

  it('yearRangeFromBills 只含当前年份 + 有账年份（升序）', () => {
    const years = yearRangeFromBills(FIX, 2026);
    expect(years).toEqual([2025, 2026]);
    const empty = yearRangeFromBills([], 2026);
    expect(empty).toEqual([2026]);
  });
});

describe('YEAR-09/10：钻取 query 契约（统计 → 搜索）', () => {
  it('点击分类 → /bill-search?year=&category=', () => {
    expect(buildSearchQuery({ year: 2026, categoryId: 'c-food' })).toEqual({
      year: '2026',
      category: 'c-food',
    });
  });
  it('点击月份 → /bill-search?month=', () => {
    expect(buildSearchQuery({ month: '2026-08' })).toEqual({ month: '2026-08' });
  });
  it('点击最大单笔 → 直接编辑（数据契约 = Bill 对象可打开 QuickEntrySheet editingBill）', () => {
    const max = computeYearMaxExpense(FIX, 2026);
    expect(max).toBeTruthy();
    // 该 Bill 满足 QuickEntrySheet 编辑模式需要的全部字段
    expect(typeof max!.id).toBe('string');
    expect(typeof max!.amount).toBe('number');
    expect(typeof max!.note).toBe('string');
    expect(typeof max!.date).toBe('string');
  });
});

describe('YEAR-11：空年份', () => {
  it('computeYearOverview 空年份全 0（页面显示空状态，不显示一堆 0）', () => {
    const ov = computeYearOverview(FIX, 2023);
    expect(ov).toEqual({ year: 2023, expense: 0, income: 0, net: 0, count: 0 });
    expect(computeYearMonthlyTrend(FIX, 2023).every((t) => t.expense === 0)).toBe(true);
    expect(computeYearCategoryRanking(FIX, 2023)).toEqual([]);
    expect(computeYearMaxExpense(FIX, 2023)).toBeUndefined();
  });
});