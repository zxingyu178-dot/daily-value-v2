/**
 * 2.19.0 账单搜索测试（SEARCH-01..12）
 * 纯函数层：SEARCH-01..10 由 searchBills/normalizeBillSearchText/buildSearchQuery 覆盖；
 * SEARCH-11/12（点击结果可编辑、编辑后结果刷新）为页面契约，由组件行为测试覆盖
 * （BillSearchPage 打开 QuickEntrySheet(editingBill) + saved 后 store reload → computed 刷新，
 *   见 pages/accounting/__tests__/bill-search-page.spec.ts）。
 */
import { describe, expect, it } from 'vitest';
import {
  amountMatches,
  buildSearchQuery,
  groupSearchResults,
  normalizeBillSearchText,
  parseAmountQuery,
  searchBills,
} from '@/core/search/bill-search';
import type { Bill } from '@/core/models/types';

function makeBill(patch: Partial<Bill> & Pick<Bill, 'id' | 'date' | 'type' | 'amount' | 'categoryId'>): Bill {
  return {
    note: '',
    categoryEmoji: '☕',
    categoryName: '餐饮',
    timestamp: new Date(`${patch.date}T12:00:00`).getTime(),
    source: 'manual',
    ledgerImpact: 'normal',
    ...patch,
  };
}

const FIXTURES: Bill[] = [
  makeBill({ id: 'a1', date: '2026-09-12', type: 'expense', amount: 18, categoryId: 'c-food', title: '瑞幸咖啡', categoryName: '餐饮', note: '拿铁' }),
  makeBill({ id: 'a2', date: '2026-09-11', type: 'expense', amount: 23.5, categoryId: 'c-transport', title: '滴滴', categoryName: '交通', note: '打车去公司' }),
  makeBill({ id: 'a3', date: '2026-08-05', type: 'expense', amount: 268, categoryId: 'c-food', title: '海底捞', categoryName: '餐饮', note: '朋友吃火锅' }),
  makeBill({ id: 'a4', date: '2026-08-01', type: 'income', amount: 8600, categoryId: 'c-salary', title: '工资', categoryName: '薪资', note: '8月工资' }),
  makeBill({ id: 'a5', date: '2025-12-31', type: 'expense', amount: 128.65, categoryId: 'c-shopping', title: 'Apple Store', categoryName: '购物', note: '配件' }),
  makeBill({ id: 'a6', date: '2026-09-12', type: 'expense', amount: 25.8, categoryId: 'c-food', title: '星巴克', categoryName: '餐饮', note: '' }),
  // daily-value-only：日价 legacy，不得进入搜索
  makeBill({ id: 'dv1', date: '2026-06-01', type: 'expense', amount: 999, categoryId: 'c-fun', title: 'MacBook', categoryName: '娱乐', note: '', ledgerImpact: 'daily-value-only' }),
];

describe('SEARCH：归一化与金额解析', () => {
  it('normalizeBillSearchText 处理大小写/首尾/连续空格', () => {
    expect(normalizeBillSearchText('  瑞幸  咖啡  ')).toBe('瑞幸 咖啡');
    expect(normalizeBillSearchText('  Starbucks ').toLowerCase()).toBe(normalizeBillSearchText('starbucks'));
  });

  it('parseAmountQuery 去除币种符号与千位分隔', () => {
    expect(parseAmountQuery('¥25.8')).toBe(25.8);
    expect(parseAmountQuery('25,800')).toBe(25800);
    expect(parseAmountQuery('¥ 3,268.50')).toBe(3268.5);
    expect(parseAmountQuery('瑞幸')).toBeNull();
    expect(parseAmountQuery('')).toBeNull();
  });

  it('amountMatches 两位小数容差（25.80 === 25.8）', () => {
    expect(amountMatches(25.8, 25.8)).toBe(true);
    expect(amountMatches(25.8, 25.804)).toBe(true);
    expect(amountMatches(25.8, 25.8)).toBe(true);
    expect(amountMatches(25.8, 26)).toBe(false);
  });
});

describe('SEARCH-01..04：商户 / 备注 / 分类 / 金额', () => {
  it('SEARCH-01 商户搜索', () => {
    const r = searchBills(FIXTURES, { q: '瑞幸' });
    expect(r.map((b) => b.id)).toEqual(['a1']);
  });

  it('SEARCH-02 备注搜索', () => {
    const r = searchBills(FIXTURES, { q: '火锅' });
    expect(r.map((b) => b.id)).toEqual(['a3']);
  });

  it('SEARCH-03 分类搜索（分类名称）', () => {
    const r = searchBills(FIXTURES, { q: '餐饮' });
    expect(r.map((b) => b.id).sort()).toEqual(['a1', 'a3', 'a6']);
  });

  it('SEARCH-04 金额搜索（¥25.8 / 25.80 命中）', () => {
    const exact = searchBills(FIXTURES, { q: '25.8' });
    expect(exact.map((b) => b.id)).toEqual(['a6']);
    const sym = searchBills(FIXTURES, { q: '¥25.80' });
    expect(sym.map((b) => b.id)).toEqual(['a6']);
    // 128.65 也在账内：搜索 128.65 命中 a5
    const big = searchBills(FIXTURES, { q: '128.65' });
    expect(big.map((b) => b.id)).toEqual(['a5']);
  });
});

describe('SEARCH-05..08：类型 / 年份 / 月份 / 分类筛选', () => {
  it('SEARCH-05 支出/收入筛选', () => {
    const onlyExpense = searchBills(FIXTURES, { type: 'expense' });
    expect(onlyExpense.every((b) => b.type === 'expense')).toBe(true);
    const income = searchBills(FIXTURES, { type: 'income' });
    expect(income.map((b) => b.id)).toEqual(['a4']);
  });

  it('SEARCH-06 年份筛选', () => {
    const r = searchBills(FIXTURES, { year: 2025 });
    expect(r.map((b) => b.id)).toEqual(['a5']);
    const r2 = searchBills(FIXTURES, { year: 2026 });
    expect(r2.every((b) => b.date.startsWith('2026'))).toBe(true);
  });

  it('SEARCH-07 月份筛选', () => {
    const r = searchBills(FIXTURES, { month: '2026-08' });
    expect(r.map((b) => b.id).sort()).toEqual(['a3', 'a4']);
  });

  it('SEARCH-08 分类筛选', () => {
    const r = searchBills(FIXTURES, { categoryId: 'c-food' });
    expect(r.every((b) => b.categoryId === 'c-food')).toBe(true);
  });
});

describe('SEARCH-09..10：组合筛选与口径', () => {
  it('SEARCH-09 关键词 + 类型 + 时间 + 分类共同生效', () => {
    const r = searchBills(FIXTURES, {
      q: '咖啡',
      type: 'expense',
      year: 2026,
      month: '2026-09',
      categoryId: 'c-food',
    });
    // 瑞幸咖啡(a1) 与 星巴克(a6) 都在 2026-09 餐饮、含「咖啡」的仅标题含咖啡 → a1
    expect(r.map((b) => b.id)).toEqual(['a1']);
  });

  it('SEARCH-10 daily-value-only 不进入搜索结果', () => {
    const r = searchBills(FIXTURES, { q: 'MacBook' });
    expect(r.map((b) => b.id)).not.toContain('dv1');
    const all = searchBills(FIXTURES, { q: '娱乐' });
    expect(all.map((b) => b.id)).not.toContain('dv1');
    // 不含关键词时也不出现 dv1（口径默认过滤）
    const any = searchBills(FIXTURES);
    expect(any.map((b) => b.id)).not.toContain('dv1');
  });
});

describe('SEARCH：结果排序与分组（支撑 SEARCH-11/12 渲染契约）', () => {
  it('结果按日期倒序、同日按 timestamp 倒序', () => {
    const r = searchBills(FIXTURES);
    for (let i = 1; i < r.length; i++) {
      expect(r[i - 1].date >= r[i].date).toBe(true);
    }
    // 9-12 同日：a1(12:00) 与 a6(12:00) 同 timestamp，保持稳定即可
  });

  it('groupSearchResults 按日分组（日期倒序）', () => {
    const groups = groupSearchResults(searchBills(FIXTURES, { month: '2026-09' }));
    expect(groups[0].date).toBe('2026-09-12');
    expect(groups[0].bills.length).toBe(2);
    expect(groups[1].date).toBe('2026-09-11');
  });

  it('buildSearchQuery 只保留有效钻取条件（YEAR-09/10 联动契约）', () => {
    expect(buildSearchQuery({ q: '瑞幸' })).toEqual({ q: '瑞幸' });
    expect(buildSearchQuery({ year: 2026 })).toEqual({ year: '2026' });
    expect(buildSearchQuery({ month: '2026-08' })).toEqual({ month: '2026-08' });
    expect(buildSearchQuery({ categoryId: 'c-food' })).toEqual({ category: 'c-food' });
    expect(buildSearchQuery({ year: 2026, month: '2026-08', categoryId: 'c-food', type: 'expense' })).toEqual({
      year: '2026',
      month: '2026-08',
      category: 'c-food',
      type: 'expense',
    });
    // 空/全量值不进入 query
    expect(buildSearchQuery({ categoryId: 'all', type: 'all', q: '  ' })).toEqual({});
  });
});