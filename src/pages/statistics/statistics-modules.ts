/**
 * Daily Value v2 - 统计模块数据（纯函数，2.12.0）
 *
 * 所有模块数据只从 Bill 派生，输入 statBills() 后的 Bill[] + activeYM + today，输出纯数据。
 * - 口径：仅 statBills()（ledgerImpact !== 'daily-value-only'），daily-value-only 一律不进入任何模块。
 * - 当前月（activeYM === today 所在月）只统计到今天；历史月统计整月。
 * - 禁止 Infinity%/NaN%/NaN；所有金额 round2 后返回。
 * - 每个模块同时输出图表序列与底部摘要。
 */
import type { Bill } from '@/core/models/types';
import { statBills } from './statistics';

export interface ChartThemeUsage {
  expense: string;
  income: string;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function daysInMonth(ym: string): number {
  const [y, m] = ym.split('-').map(Number);
  return new Date(y, m, 0).getDate();
}

function dayOfMonth(date: string): number {
  return Number(date.slice(8, 10));
}

/** 该月应统计的天数：当前月只到「今天」，历史月完整月份。今天为 31 日时即整月。 */
export function elapsedMonthDays(activeYM: string, today: string): number {
  if (activeYM === today.slice(0, 7)) return dayOfMonth(today);
  const days = daysInMonth(activeYM);
  return Number.isFinite(days) && days > 0 ? days : 0;
}

/** 过滤出当月账单（已按 statBills 口径） */
function monthBills(stat: Bill[], activeYM: string): Bill[] {
  return stat.filter((b) => b.date.startsWith(activeYM));
}

/** 按天初始化数组 [1..N] */
function dayArray(n: number): number[] {
  const out: number[] = [];
  for (let i = 1; i <= n; i += 1) out.push(i);
  return out;
}

function sumFor(fn: (b: Bill) => boolean): (bills: Bill[]) => number {
  return (list: Bill[]) => {
    let total = 0;
    for (const b of list) if (fn(b)) total += b.amount;
    return total;
  };
}

/* =====================================================================
 * 1) 每日花费趋势（折线）— 每日支出，无支出日 = 0
 * ===================================================================== */
export interface DailyExpenseTrendPoint {
  /** 日期标签（1~N） */
  day: number;
  label: string;
  amount: number;
}
export interface DailyExpenseTrendValue {
  points: DailyExpenseTrendPoint[];
  /** 本月总支出 */
  total: number;
  /** 日均支出 = total / 已过天数 */
  dailyAverage: number;
  /** 最高消费日（按天合计最大；无支出为 null） */
  highestDay: { label: string; amount: number } | null;
  /** 是否有任何支出 */
  hasData: boolean;
}
export function computeDailyExpenseTrend(
  bills: Bill[],
  activeYM: string,
  today: string,
): DailyExpenseTrendValue {
  const nodes = elapsedMonthDays(activeYM, today);
  const expenses = monthBills(statBills(bills), activeYM).filter((b) => b.type === 'expense');
  const byDay = new Map<number, number>();
  for (const b of expenses) {
    const d = dayOfMonth(b.date);
    byDay.set(d, (byDay.get(d) ?? 0) + b.amount);
  }
  const points: DailyExpenseTrendPoint[] = dayArray(nodes).map((d) => ({
    day: d,
    label: String(d),
    amount: round2(byDay.get(d) ?? 0),
  }));
  const total = round2(expenses.reduce((s, b) => s + b.amount, 0));
  const hasData = expenses.length > 0;
  let highestDay: DailyExpenseTrendValue['highestDay'] = null;
  let bestDay = 0;
  let bestAmount = 0;
  for (const [d, amt] of byDay) {
    if (amt > bestAmount || (amt === bestAmount && d > bestDay)) {
      bestDay = d;
      bestAmount = amt;
    }
  }
  if (hasData) highestDay = { label: `${bestDay}日`, amount: round2(bestAmount) };
  return {
    points,
    total,
    dailyAverage: round2(nodes > 0 ? total / nodes : 0),
    highestDay,
    hasData,
  };
}

/* =====================================================================
 * 2) 收入 / 支出对比（柱状）— 按天分组，缺失 = 0
 * ===================================================================== */
export interface IncomeExpenseComparePoint {
  day: number;
  label: string;
  expense: number;
  income: number;
}
export interface IncomeExpenseCompareValue {
  points: IncomeExpenseComparePoint[];
  totalExpense: number;
  totalIncome: number;
  /** 结余 = income - expense */
  balance: number;
  hasData: boolean;
}
export function computeIncomeExpenseCompare(
  bills: Bill[],
  activeYM: string,
  today: string,
): IncomeExpenseCompareValue {
  const nodes = elapsedMonthDays(activeYM, today);
  const month = monthBills(statBills(bills), activeYM);
  const byDay = new Map<number, { expense: number; income: number }>();
  for (const b of month) {
    const d = dayOfMonth(b.date);
    const cur = byDay.get(d) ?? { expense: 0, income: 0 };
    if (b.type === 'expense') cur.expense += b.amount;
    else if (b.type === 'income') cur.income += b.amount;
    byDay.set(d, cur);
  }
  const points: IncomeExpenseComparePoint[] = dayArray(nodes).map((d) => {
    const v = byDay.get(d) ?? { expense: 0, income: 0 };
    return { day: d, label: String(d), expense: round2(v.expense), income: round2(v.income) };
  });
  const totalExpense = round2(sumFor((b) => b.type === 'expense')(month));
  const totalIncome = round2(sumFor((b) => b.type === 'income')(month));
  const hasData = month.length > 0;
  return { points, totalExpense, totalIncome, balance: round2(totalIncome - totalExpense), hasData };
}

/* =====================================================================
 * 3) 分类支出排行（横向柱状）— 前 N + 剩余合并「其他」
 * ===================================================================== */
export interface CategoryRankingRow {
  categoryId: string;
  title: string;
  /** 图标：builtin 用 iconValue / 快照 emoji 兜底 */
  emoji: string;
  amount: number;
  /** 占当月总支出的百分比（前6+其他 合计 100） */
  percent: number;
  /** 是否为「其他」汇总行 */
  isOther: boolean;
}
export interface CategoryRankingValue {
  rows: CategoryRankingRow[];
  /** 参与排行的分类数（含被合并进「其他」的数量） */
  categoryCount: number;
  /** 本月总支出 */
  total: number;
  hasData: boolean;
}
export const CATEGORY_RANKING_MAX = 6;
export function computeCategoryRanking(
  bills: Bill[],
  activeYM: string,
  _today: string,
  maxRows: number = CATEGORY_RANKING_MAX,
): CategoryRankingValue {
  const expenses = monthBills(statBills(bills), activeYM).filter((b) => b.type === 'expense');
  const byCat = new Map<string, CategoryRankingRow>();
  let total = 0;
  for (const b of expenses) {
    total += b.amount;
    const cur = byCat.get(b.categoryId);
    if (cur) {
      cur.amount += b.amount;
    } else {
      byCat.set(b.categoryId, {
        categoryId: b.categoryId,
        title: b.categoryName,
        emoji: b.categoryEmoji,
        amount: b.amount,
        percent: 0,
        isOther: false,
      });
    }
  }
  const hasData = expenses.length > 0;
  if (!hasData) {
    return { rows: [], categoryCount: 0, total: 0, hasData: false };
  }
  const sorted = [...byCat.values()].sort((a, b) => b.amount - a.amount);
  const head = sorted.slice(0, maxRows);
  const rest = sorted.slice(maxRows);
  const restTotal = round2(rest.reduce((s, r) => s + r.amount, 0));
  const headPercents = head.map((r) =>
    total > 0 ? Math.round((r.amount / total) * 100) : 0,
  );
  const rows: CategoryRankingRow[] = head.map((r, i) => ({
    ...r,
    amount: round2(r.amount),
    percent: headPercents[i],
  }));
  if (rest.length > 0) {
    // 「其他」占比 = 100 - 前6占比合计，保证前6+其他 合计恒为 100%
    const headSum = headPercents.reduce((s, p) => s + p, 0);
    rows.push({
      categoryId: '__other__',
      title: '其他',
      emoji: '',
      amount: restTotal,
      percent: Math.max(0, 100 - headSum),
      isOther: true,
    });
  }
  return {
    rows,
    categoryCount: sorted.length,
    total: round2(total),
    hasData: true,
  };
}

/* =====================================================================
 * 4) 累计消费趋势（折线）— 逐日累计
 * ===================================================================== */
export interface CumulativeExpensePoint {
  day: number;
  label: string;
  cumulative: number;
}
export interface CumulativeExpenseValue {
  points: CumulativeExpensePoint[];
  /** 当前累计支出 */
  total: number;
  /** 月内最高单日新增 */
  highestDay: { label: string; amount: number } | null;
  /** 当前月已过天数 */
  days: number;
  /** 日均斜率 = total / days（简单说明，不单独成卡） */
  dailyAverage: number;
  hasData: boolean;
}
export function computeCumulativeExpense(
  bills: Bill[],
  activeYM: string,
  today: string,
): CumulativeExpenseValue {
  const nodes = elapsedMonthDays(activeYM, today);
  const expenses = monthBills(statBills(bills), activeYM).filter((b) => b.type === 'expense');
  const byDay = new Map<number, number>();
  let total = 0;
  for (const b of expenses) {
    const d = dayOfMonth(b.date);
    const prev = byDay.get(d) ?? 0;
    byDay.set(d, prev + b.amount);
    total += b.amount;
  }
  const points: CumulativeExpensePoint[] = [];
  let run = 0;
  for (const d of dayArray(nodes)) {
    run += byDay.get(d) ?? 0;
    points.push({ day: d, label: String(d), cumulative: round2(run) });
  }
  const hasData = expenses.length > 0;
  let bestDay = 0;
  let bestAmount = 0;
  for (const [d, amt] of byDay) {
    if (amt > bestAmount || (amt === bestAmount && d > bestDay)) {
      bestDay = d;
      bestAmount = amt;
    }
  }
  return {
    points,
    total: round2(total),
    highestDay: hasData ? { label: `${bestDay}日`, amount: round2(bestAmount) } : null,
    days: nodes,
    dailyAverage: round2(nodes > 0 ? total / nodes : 0),
    hasData,
  };
}