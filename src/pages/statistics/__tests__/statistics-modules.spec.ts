/**
 * 2.12.0 统计模块 — 纯函数测试（statistics-modules.ts）
 * 覆盖 4 模块数据口径：
 * - 当前月只统计到今天 / 历史月统计整月的天数
 * - 每日花费趋势：无支出日 = 0；摘要（总支出/日均/最高消费日）
 * - 收入支出对比：按天分组、缺失 = 0；摘要（支出/收入/结余）
 * - 分类支出排行：降序、前6、剩余合并「其他」、占比合计 100%
 * - 累计消费趋势：逐日累计递增；摘要（当前累计/最高单日新增/日均斜率）
 * - daily-value-only 一律不混入；无 Infinity/NaN
 */
import { describe, expect, it } from 'vitest';
import type { Bill } from '@/core/models/types';
import {
  computeDailyExpenseTrend,
  computeIncomeExpenseCompare,
  computeCategoryRanking,
  computeCumulativeExpense,
  elapsedMonthDays,
} from '../statistics-modules';

/** 今天是 2026-09-11 所在的月 = "2026-09"；测试用固定 today */
const TODAY = '2026-09-11';
const YM = '2026-09';
const HIST_YM = '2026-08';

function bill(over: Partial<Bill>, date?: string): Bill {
  return {
    id: over.id ?? Math.random().toString(36).slice(2),
    type: 'expense',
    amount: 0,
    categoryId: 'c-food',
    categoryEmoji: '🍚',
    categoryName: '餐饮',
    note: '',
    date: date ?? `${YM}-01`,
    timestamp: Date.now(),
    source: 'manual',
    ledgerImpact: 'normal',
    ...over,
  } as Bill;
}

describe('elapsedMonthDays 天数口径', () => {
  it('当前月 = 今天的日数（9/11 → 11）', () => {
    expect(elapsedMonthDays(YM, TODAY)).toBe(11);
  });
  it('历史月 = 完整月份天数（8月 → 31）', () => {
    expect(elapsedMonthDays(HIST_YM, TODAY)).toBe(31);
  });
  it('2月平年 = 28', () => {
    expect(elapsedMonthDays('2026-02', TODAY)).toBe(28);
  });
});

describe('每日花费趋势', () => {
  it('当前月：生成 1..N 点，无支出日 = 0', () => {
    const v = computeDailyExpenseTrend(
      [bill({ amount: 400, date: `${YM}-01` }), bill({ amount: 600, date: `${YM}-05` })],
      YM,
      TODAY,
    );
    expect(v.points).toHaveLength(11);
    expect(v.points[0]).toEqual({ day: 1, label: '1', amount: 400 });
    expect(v.points[4]).toEqual({ day: 5, label: '5', amount: 600 });
    expect(v.points[1].amount).toBe(0); // 2日无支出
    expect(v.total).toBe(1000);
    // 日均 = round2(1000/11)
    expect(v.dailyAverage).toBe(90.91);
  });
  it('历史月：统计整月（8月 → 31 点）', () => {
    const v = computeDailyExpenseTrend(
      [bill({ amount: 100 }, `${HIST_YM}-05`), bill({ amount: 20 }, `${HIST_YM}-05`)],
      HIST_YM,
      TODAY,
    );
    expect(v.points).toHaveLength(31);
    expect(v.total).toBe(120);
  });
  it('最高消费日：按“当天合计”而非最大单笔', () => {
    const v = computeDailyExpenseTrend(
      [
        bill({ amount: 30, date: `${YM}-18` }),
        bill({ amount: 300, date: `${YM}-18` }),
        bill({ amount: 80, date: `${YM}-18` }), // 当天 410
        bill({ amount: 400, date: `${YM}-10` }), // 单笔 400
      ],
      YM,
      TODAY,
    );
    expect(v.highestDay).toEqual({ label: '18日', amount: 410 });
  });
  it('daily-value-only 不混入（金额不算入 + 判定无数据）', () => {
    const v = computeDailyExpenseTrend(
      [bill({ ledgerImpact: 'daily-value-only', amount: 9999 })],
      YM,
      TODAY,
    );
    expect(v.total).toBe(0);
    expect(v.hasData).toBe(false);
  });
  it('无数据：hasData=false，highestDay=null', () => {
    const v = computeDailyExpenseTrend([], YM, TODAY);
    expect(v.hasData).toBe(false);
    expect(v.highestDay).toBeNull();
    expect(v.total).toBe(0);
  });
});

describe('收入 / 支出对比', () => {
  it('按天分组收入与支出，缺失类型 = 0，结余 = 收入-支出', () => {
    const v = computeIncomeExpenseCompare(
      [
        bill({ type: 'expense', amount: 410, date: `${YM}-01` }),
        bill({ type: 'income', amount: 200, date: `${YM}-01` }),
        bill({ type: 'income', amount: 100, date: `${YM}-01` }),
        bill({ type: 'expense', amount: 50, date: `${YM}-05` }),
      ],
      YM,
      TODAY,
    );
    expect(v.points[0]).toEqual({ day: 1, label: '1', expense: 410, income: 300 });
    expect(v.points[4]).toEqual({ day: 5, label: '5', expense: 50, income: 0 });
    expect(v.points[1].expense).toBe(0); // 2日无支出
    expect(v.points[1].income).toBe(0);
    expect(v.totalExpense).toBe(460);
    expect(v.totalIncome).toBe(300);
    expect(v.balance).toBe(-160);
    expect(v.hasData).toBe(true);
  });
  it('daily-value-only 不混入', () => {
    const v = computeIncomeExpenseCompare(
      [bill({ ledgerImpact: 'daily-value-only', type: 'income', amount: 9999 })],
      YM,
      TODAY,
    );
    expect(v.totalIncome).toBe(0);
    expect(v.hasData).toBe(false);
  });
  it('无数据：hasData=false', () => {
    expect(computeIncomeExpenseCompare([], YM, TODAY).hasData).toBe(false);
  });
});

describe('分类支出排行', () => {
  const mk = (cat: string, name: string, emoji: string, amt: number, day = 1) =>
    bill({ categoryId: cat, categoryName: name, categoryEmoji: emoji, amount: amt, date: `${YM}-${String(day).padStart(2, '0')}` });
  it('按金额降序 + 前 6；超过 6 个合并「其他」且占比合计 100%', () => {
    const cats = Array.from({ length: 8 }, (_, i) => mk(`c-${i}`, `分类${i}`, '🍎', (i + 1) * 10));
    const v = computeCategoryRanking(cats, YM, TODAY);
    // 金额 i*10 → 排序最大 = 80（c-7）；前6为 80..30
    expect(v.rows).toHaveLength(7); // 6 + 其他
    expect(v.rows[0].title).toBe('分类7');
    expect(v.rows[0].amount).toBe(80);
    expect(v.rows[v.rows.length - 1].title).toBe('其他');
    expect(v.rows[v.rows.length - 1].isOther).toBe(true);
    const sumPct = v.rows.reduce((s, r) => s + r.percent, 0);
    expect(sumPct).toBe(100);
    expect(v.categoryCount).toBe(8);
    expect(v.total).toBe(360);
  });
  it('分类数 ≤6：不出现「其他」行，占比合计 100', () => {
    const v = computeCategoryRanking(
      [mk('a', 'A', '🍎', 100), mk('b', 'B', '🍊', 300)],
      YM,
      TODAY,
    );
    expect(v.rows).toHaveLength(2);
    expect(v.rows.some((r) => r.isOther)).toBe(false);
    expect(v.rows.reduce((s, r) => s + r.percent, 0)).toBe(100);
    expect(v.rows[0].title).toBe('B');
  });
  it('daily-value-only 不混入；无支出 → hasData=false', () => {
    expect(
      computeCategoryRanking([mk('a', 'A', '🍎', 100, 1)], YM, TODAY, 6).rows.some((r) => r.title === 'A'),
    ).toBe(true);
    const v = computeCategoryRanking(
      [bill({ categoryId: 'x', categoryName: '日价', categoryEmoji: '🏷', amount: 100, ledgerImpact: 'daily-value-only' })],
      YM,
      TODAY,
    );
    expect(v.hasData).toBe(false);
    expect(v.rows).toHaveLength(0);
  });
  it('金额不溢出计算：共享同一分类聚合到一行', () => {
    const v = computeCategoryRanking(
      [mk('a', 'A', '🍎', 100, 1), mk('a', 'A', '🍎', 50, 2)],
      YM,
      TODAY,
    );
    expect(v.rows[0].amount).toBe(150);
    expect(v.rows).toHaveLength(1);
    expect(v.categoryCount).toBe(1);
  });
});

describe('累计消费趋势', () => {
  it('逐日累计递增；摘要（当前累计/最高单日新增/日均斜率）', () => {
    const v = computeCumulativeExpense(
      [
        bill({ amount: 100, date: `${YM}-01` }),
        bill({ amount: 50, date: `${YM}-01` }), // 同日合计150
        bill({ amount: 30, date: `${YM}-03` }),
      ],
      YM,
      TODAY,
    );
    expect(v.points).toHaveLength(11);
    expect(v.points[0].cumulative).toBe(150);
    expect(v.points[1].cumulative).toBe(150); // 2日无新增
    expect(v.points[2].cumulative).toBe(180);
    expect(v.points[10].cumulative).toBe(180);
    expect(v.total).toBe(180);
    expect(v.highestDay).toEqual({ label: '1日', amount: 150 });
    expect(v.days).toBe(11);
    // 日均斜率 = round2(180/11)
    expect(v.dailyAverage).toBe(16.36);
  });
  it('历史月统计整月', () => {
    const v = computeCumulativeExpense([bill({ amount: 100 }, `${HIST_YM}-01`)], HIST_YM, TODAY);
    expect(v.points).toHaveLength(31);
    expect(v.total).toBe(100);
  });
  it('无数据：hasData=false，highestDay=null', () => {
    const v = computeCumulativeExpense([], YM, TODAY);
    expect(v.hasData).toBe(false);
    expect(v.highestDay).toBeNull();
  });
  it('无 NaN/Infinity（全零仍为有限数）', () => {
    const v = computeDailyExpenseTrend([], YM, TODAY);
    expect(Number.isFinite(v.dailyAverage)).toBe(true);
    const c = computeCumulativeExpense([], YM, TODAY);
    expect(Number.isFinite(c.dailyAverage)).toBe(true);
  });
});