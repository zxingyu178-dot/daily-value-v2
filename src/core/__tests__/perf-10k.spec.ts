/**
 * 2.19.0 性能验证（10,000 Bills fixture，正常中端机器不应明显卡顿）
 * - SEARCH-PERF-01：关键词搜索单次过滤耗时（10k 级别）
 * - SEARCH-PERF-02：分类筛选 + 组合筛选耗时
 * - YEAR-PERF-01：年度统计纯函数（overview/trend/rank 等）合计耗时
 * - 阈值宽松（防 CI 抖动）：单次 < 200ms；整套年度计算 < 500ms —— 目标是「无卡顿」，非极限 benchmark。
 * - fixture 只存在于测试内存，不写入正式用户数据库。
 */
import { describe, expect, it } from 'vitest';
import type { Bill } from '@/core/models/types';
import { groupSearchResults, searchBills } from '@/core/search/bill-search';
import {
  computeYearCategoryRanking,
  computeYearExtremeMonths,
  computeYearFacts,
  computeYearMonthlyTrend,
  computeYearOverview,
} from '@/core/statistics/year';

/** 生成 10,000 笔跨 2019-2026 年的账单（多分类 / 收入+支出 / 少量 daily-value-only） */
function buildLargeFixture(count = 10000): Bill[] {
  const cats = [
    ['c-food', '餐饮', '☕'], ['c-transport', '交通', '🚕'], ['c-shopping', '购物', '🛍️'],
    ['c-fun', '娱乐', '🎮'], ['c-life', '居家', '🏠'], ['c-medical', '医疗', '💊'],
    ['c-salary', '薪资', '💰'],
  ] as const;
  const bills: Bill[] = [];
  const base = new Date('2026-09-12T10:00:00').getTime();
  for (let i = 0; i < count; i++) {
    const year = 2019 + ((i * 7) % 8); // 2019~2026
    const month = (i % 12) + 1;
    const day = (i % 27) + 1;
    const date = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const [categoryId, categoryName, categoryEmoji] = cats[i % cats.length];
    bills.push({
      id: `perf-${i}`,
      type: i % 5 === 0 ? 'income' : 'expense',
      amount: 8.5 + (i % 9000),
      categoryId,
      categoryEmoji,
      categoryName,
      title: `商户${i % 89}号店`,
      note: `备注关键词${i % 37} 瑞幸${i % 3 === 0 ? '咖啡' : ''}`,
      date,
      timestamp: base - i * 3600_000,
      source: 'manual',
      ledgerImpact: i % 97 === 0 ? 'daily-value-only' : 'normal',
    });
  }
  return bills;
}

const BILLS = buildLargeFixture();

function timed(fn: () => unknown): number {
  const t0 = performance.now();
  fn();
  return performance.now() - t0;
}

describe('10k Bills 性能（SEARCH-PERF / YEAR-PERF）', () => {
  it('SEARCH-PERF-01 关键词搜索单次 < 200ms', () => {
    expect(BILLS.length).toBe(10000);
    const t = timed(() => searchBills(BILLS, { q: '瑞幸咖啡' }));
    expect(t).toBeLessThan(200);
    const t2 = timed(() => searchBills(BILLS, { q: '128.90' }));
    expect(t2).toBeLessThan(200);
  });

  it('SEARCH-PERF-02 分类筛选 + 组合筛选 < 200ms', () => {
    const t = timed(() => searchBills(BILLS, { categoryId: 'c-food' }));
    expect(t).toBeLessThan(200);
    const t2 = timed(() => searchBills(BILLS, { q: '商户', type: 'expense', year: 2026, categoryId: 'c-shopping' }));
    expect(t2).toBeLessThan(200);
  });

  it('SEARCH-PERF-03 结果按日分组 < 200ms', () => {
    const t = timed(() => groupSearchResults(searchBills(BILLS, { year: 2026, categoryId: 'c-food' })));
    expect(t).toBeLessThan(200);
  });

  it('YEAR-PERF-01 年度纯函数整套 < 500ms', () => {
    const t = timed(() => {
      const ov = computeYearOverview(BILLS, 2026);
      const trend = computeYearMonthlyTrend(BILLS, 2026);
      computeYearExtremeMonths(trend);
      computeYearCategoryRanking(BILLS, 2026, 5);
      computeYearFacts(BILLS, 2026, trend);
      return ov;
    });
    expect(t).toBeLessThan(500);
  });
});