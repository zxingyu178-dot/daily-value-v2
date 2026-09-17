/**
 * DailyValue v2.19.0 - 年度统计（纯函数，Bill 派生）
 *
 * 规则：
 * - 口径严格跟随月统计：只统计 normal 账单（ledgerImpact !== 'daily-value-only'），
 *   daily-value-only（日价 legacy）不得污染年度消费（YEAR-11 / 口径同 statistics.ts）。
 * - 支出 = type==='expense'；收入 = type==='income'；结余 = income - expense。
 * - 不维护第二套年度统计数据库，全部实时从 Bill 派生。
 * - 年份输入为 4 位数字（2026）；返回结构与页面展示解耦，便于单测。
 */
import type { Bill } from '@/core/models/types';

/** 年度总览 */
export interface YearOverview {
  year: number;
  /** 全年支出 */
  expense: number;
  /** 全年收入 */
  income: number;
  /** 结余 = income - expense */
  net: number;
  /** 全年账单条数（统计口径内） */
  count: number;
}

/** 年度趋势单月点 */
export interface YearTrendPoint {
  month: number; // 1-12
  label: string; // 「1月」
  expense: number;
  income: number;
}

/** 年度趋势（12 月） */
export type YearMonthlyTrend = YearTrendPoint[];

/** 全年最大/最小支出月（只在有支出数据的月份中计算，空月不参与） */
export interface YearExtremeMonths {
  /** 最大支出月（12 个月中 expense 最大；全年无支出为 undefined） */
  max: { month: number; label: string; expense: number } | undefined;
  /** 最小支出月（只在有支出的月份中取最小；全年无支出为 undefined） */
  min: { month: number; label: string; expense: number } | undefined;
}

/** 年度分类排名条目 */
export interface YearCategoryRank {
  categoryId: string;
  name: string;
  emoji: string;
  amount: number;
  /** 占全年支出百分比（0-100，1 位小数） */
  percent: number;
  /** 该分类支出笔数 */
  count: number;
}

/** 年度「消费足迹」事实 */
export interface YearFacts {
  /** 全年最大的一笔支出（无支出为 undefined） */
  maxExpense: Bill | undefined;
  /** 记录最多的分类（按笔数；并列取第一个；无数据为 undefined） */
  topCategory: { categoryId: string; name: string; emoji: string; count: number } | undefined;
  /** 最常消费月份（按支出笔数；无数据为 undefined） */
  topMonth: { month: number; label: string; count: number } | undefined;
}

/** 过滤出进入统计的账单（与月统计同一口径） */
function yearStatBills(bills: Bill[], year: number): Bill[] {
  const prefix = `${year}`;
  return bills.filter((b) => b.ledgerImpact !== 'daily-value-only' && b.date.startsWith(prefix));
}

/** 全年 expense / income / net / count */
export function computeYearOverview(bills: Bill[], year: number): YearOverview {
  let expense = 0;
  let income = 0;
  let count = 0;
  for (const b of yearStatBills(bills, year)) {
    if (b.type === 'expense') expense += b.amount;
    else if (b.type === 'income') income += b.amount;
    count += 1;
  }
  return { year, expense, income, net: income - expense, count };
}

/** 全年 12 个月支出/收入趋势（固定 1~12 月，无数据月为 0） */
export function computeYearMonthlyTrend(bills: Bill[], year: number): YearMonthlyTrend {
  const monthly = new Map<number, { expense: number; income: number }>();
  for (const b of yearStatBills(bills, year)) {
    const m = Number(b.date.slice(5, 7));
    const cur = monthly.get(m) ?? { expense: 0, income: 0 };
    if (b.type === 'expense') cur.expense += b.amount;
    else if (b.type === 'income') cur.income += b.amount;
    monthly.set(m, cur);
  }
  const out: YearMonthlyTrend = [];
  for (let i = 1; i <= 12; i++) {
    const d = monthly.get(i) ?? { expense: 0, income: 0 };
    out.push({ month: i, label: `${i}月`, expense: d.expense, income: d.income });
  }
  return out;
}

/** 有支出数据的月份数（供月均支出口径使用，空月不稀释） */
export function activeExpenseMonthCount(trend: YearMonthlyTrend): number {
  return trend.filter((t) => t.expense > 0).length;
}

/**
 * 月均支出：全年支出 ÷ 有支出的活跃月数。
 * 口径：空月（无任何支出）不参与平均，避免被 0 拉低；
 * 全年没有任何支出时返回 0。
 */
export function computeYearAverageMonthlyExpense(
  overview: YearOverview,
  activeMonths: number,
): number {
  if (activeMonths <= 0) return 0;
  return overview.expense / activeMonths;
}

/** 全年最高/最低支出月（最低只在有支出数据月份中计算） */
export function computeYearExtremeMonths(trend: YearMonthlyTrend): YearExtremeMonths {
  const withExpense = trend.filter((t) => t.expense > 0);
  if (withExpense.length === 0) return { max: undefined, min: undefined };
  let max = withExpense[0];
  let min = withExpense[0];
  for (const t of withExpense) {
    if (t.expense > max.expense) max = t;
    if (t.expense < min.expense) min = t;
  }
  const shape = (t: YearTrendPoint) => ({ month: t.month, label: t.label, expense: t.expense });
  return { max: shape(max), min: shape(min) };
}

/** 全年分类支出排名（默认 Top N，按金额降序；无支出返回空数组） */
export function computeYearCategoryRanking(
  bills: Bill[],
  year: number,
  limit = 5,
): YearCategoryRank[] {
  const byCat = new Map<string, YearCategoryRank>();
  let total = 0;
  for (const b of yearStatBills(bills, year)) {
    if (b.type !== 'expense') continue;
    total += b.amount;
    const cur = byCat.get(b.categoryId);
    if (cur) {
      cur.amount += b.amount;
      cur.count += 1;
    } else {
      byCat.set(b.categoryId, {
        categoryId: b.categoryId,
        name: b.categoryName,
        emoji: b.categoryEmoji,
        amount: b.amount,
        percent: 0,
        count: 1,
      });
    }
  }
  const list = [...byCat.values()].sort((a, b) => b.amount - a.amount);
  for (const s of list) {
    s.percent = total > 0 ? Math.round((s.amount / total) * 1000) / 10 : 0;
  }
  return limit > 0 ? list.slice(0, limit) : list;
}

/** 全年最大的一笔支出（无支出返回 undefined） */
export function computeYearMaxExpense(bills: Bill[], year: number): Bill | undefined {
  let max: Bill | undefined;
  for (const b of yearStatBills(bills, year)) {
    if (b.type !== 'expense') continue;
    if (!max || b.amount > max.amount) max = b;
  }
  return max;
}

/** 全年账单条数（统计口径内） */
export function computeYearBillCount(bills: Bill[], year: number): number {
  return yearStatBills(bills, year).length;
}

/**
 * 年度「消费足迹」事实（只从真实数据算确定事实，不生成伪 AI 文案）：
 * - 最大单笔支出
 * - 记录最多的分类（按笔数）
 * - 最常消费月份（按支出笔数）
 */
export function computeYearFacts(
  bills: Bill[],
  year: number,
  trend?: YearMonthlyTrend,
): YearFacts {
  const list = yearStatBills(bills, year);
  const maxExpense = computeYearMaxExpense(list, year);

  const byCat = new Map<string, { categoryId: string; name: string; emoji: string; count: number }>();
  const byMonth = new Map<number, number>();
  for (const b of list) {
    const cur = byCat.get(b.categoryId);
    if (cur) cur.count += 1;
    else byCat.set(b.categoryId, { categoryId: b.categoryId, name: b.categoryName, emoji: b.categoryEmoji, count: 1 });
    if (b.type === 'expense') {
      const m = Number(b.date.slice(5, 7));
      byMonth.set(m, (byMonth.get(m) ?? 0) + 1);
    }
  }
  let topCategory: YearFacts['topCategory'];
  for (const v of byCat.values()) {
    if (!topCategory || v.count > topCategory.count) topCategory = v;
  }
  let topMonth: YearFacts['topMonth'];
  for (const [m, count] of byMonth) {
    if (!topMonth || count > topMonth.count) topMonth = { month: m, label: `${m}月`, count };
  }
  void trend; // 保留参数以便未来基于趋势做「最早/最晚」，当前版本不使用
  return { maxExpense, topCategory, topMonth };
}

/**
 * 年份列表：有账年份 + 当前年份（去重升序）。
 * 只从实际 Bill 推导，不生成 2000~2100 空范围。
 */
export function yearRangeFromBills(bills: Bill[], currentYear: number): number[] {
  const set = new Set<number>([currentYear]);
  for (const b of bills) {
    if (b.ledgerImpact === 'daily-value-only') continue;
    const y = Number(b.date.slice(0, 4));
    if (Number.isFinite(y)) set.add(y);
  }
  return [...set].sort((a, b) => a - b);
}