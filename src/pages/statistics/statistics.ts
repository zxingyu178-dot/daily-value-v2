/**
 * Daily Value v2 - 统计计算（纯函数，Phase 4）
 *
 * 规则：
 * - 统计数据只能从 Bill 派生，禁止维护第二套统计数据库。
 * - 仅统计 normal 账单（ledgerImpact !== 'daily-value-only'），与记账时间线口径一致。
 * - 颜色产品规则：支出=绿色，收入=红色（图表数据由页面层着色，本模块只出数据）。
 */

import type { Bill } from '@/core/models/types';

export interface StatOverview {
  /** 月支出 */
  expense: number;
  /** 月收入 */
  income: number;
  /** 结余 = 收入 - 支出 */
  net: number;
}

export interface CategoryShare {
  categoryId: string;
  name: string;
  emoji: string;
  amount: number;
  /** 占当月总支出的百分比（0-100，保留 1 位小数） */
  percent: number;
}

export interface TrendPoint {
  /** yyyy-MM */
  ym: string;
  /** 展示标签，如「8月」 */
  label: string;
  expense: number;
  income: number;
}

/** 过滤出进入统计的账单（普通账本口径） */
export function statBills(bills: Bill[]): Bill[] {
  return bills.filter((b) => b.ledgerImpact !== 'daily-value-only');
}

/** 某月支出 / 收入 / 结余 */
export function computeOverview(bills: Bill[], ym: string): StatOverview {
  let expense = 0;
  let income = 0;
  for (const b of statBills(bills)) {
    if (!b.date.startsWith(ym)) continue;
    if (b.type === 'expense') expense += b.amount;
    else if (b.type === 'income') income += b.amount;
  }
  return { expense, income, net: income - expense };
}

/** 某月分类支出占比（按金额降序；无支出返回空数组） */
export function computeCategoryShare(bills: Bill[], ym: string): CategoryShare[] {
  const byCat = new Map<string, CategoryShare>();
  let total = 0;
  for (const b of statBills(bills)) {
    if (b.type !== 'expense' || !b.date.startsWith(ym)) continue;
    total += b.amount;
    const cur = byCat.get(b.categoryId);
    if (cur) {
      cur.amount += b.amount;
    } else {
      byCat.set(b.categoryId, {
        categoryId: b.categoryId,
        name: b.categoryName,
        emoji: b.categoryEmoji,
        amount: b.amount,
        percent: 0,
      });
    }
  }
  const list = [...byCat.values()].sort((a, b) => b.amount - a.amount);
  for (const s of list) {
    s.percent = total > 0 ? Math.round((s.amount / total) * 1000) / 10 : 0;
  }
  return list;
}

/** 最近 N 个月的消费趋势（含当前月，旧 → 新） */
export function computeMonthlyTrend(bills: Bill[], months: number): TrendPoint[] {
  const now = new Date();
  const cur = now.getFullYear() * 12 + now.getMonth();
  const keys: string[] = [];
  for (let i = months - 1; i >= 0; i--) {
    const v = cur - i;
    const y = Math.floor(v / 12);
    const m = (v % 12) + 1;
    keys.push(`${y}-${String(m).padStart(2, '0')}`);
  }
  const acc = new Map<string, { expense: number; income: number }>();
  for (const b of statBills(bills)) {
    const ym = b.date.slice(0, 7);
    if (!keys.includes(ym)) continue;
    const cur2 = acc.get(ym) ?? { expense: 0, income: 0 };
    if (b.type === 'expense') cur2.expense += b.amount;
    else if (b.type === 'income') cur2.income += b.amount;
    acc.set(ym, cur2);
  }
  return keys.map((ym) => {
    const [, m] = ym.split('-').map(Number);
    const d = acc.get(ym) ?? { expense: 0, income: 0 };
    return { ym, label: `${m}月`, ...d };
  });
}

/** 某月最大单笔支出（无支出返回 undefined） */
export function computeMaxExpense(bills: Bill[], ym: string): Bill | undefined {
  let max: Bill | undefined;
  for (const b of statBills(bills)) {
    if (b.type !== 'expense' || !b.date.startsWith(ym)) continue;
    if (!max || b.amount > max.amount) max = b;
  }
  return max;
}

/** 包含端点（minYM ~ maxYM，均为 yyyy-MM）的月份列表 */
export function monthRange(minYM: string, maxYM: string): string[] {
  const [y1, m1] = minYM.split('-').map(Number);
  const [y2, m2] = maxYM.split('-').map(Number);
  const start = y1 * 12 + (m1 - 1);
  const end = y2 * 12 + (m2 - 1);
  const out: string[] = [];
  for (let v = start; v <= end; v++) {
    const y = Math.floor(v / 12);
    const m = (v % 12) + 1;
    out.push(`${y}-${String(m).padStart(2, '0')}`);
  }
  return out;
}

/* =====================================================================
 * 2.10.0 自定义日期区间统计（docs 第十一~十七节）
 * 只进统计口径：Bill.ledgerImpact === 'normal'（daily-value-only 不进入区间收支）。
 * 业务日期直接用 yyyy-MM-dd 字符串比较（本地 Calendar 语义，两端都包含），
 * 禁止 toISOString().slice(0,10) 参与业务日期比较。
 * 纯函数 → 可单测，也方便后续复用。
 * ===================================================================== */

export interface DateRangeSummary {
  /** 区间支出 */
  expense: number;
  /** 区间收入 */
  income: number;
  /** 结余 = income - expense */
  balance: number;
  /** 计入区间的账单条数 */
  count: number;
}

/**
 * 自定义日期区间汇总：startDate <= bill.date <= endDate（两端包含）。
 * 仅统计 ledgerImpact === 'normal' 的账单。
 */
export function summarizeBillsByDateRange(
  bills: Bill[],
  startDate: string,
  endDate: string,
): DateRangeSummary {
  let expense = 0;
  let income = 0;
  let count = 0;
  for (const b of bills) {
    if (b.ledgerImpact !== 'normal') continue; // daily-value-only 不得进入区间收支
    if (b.date < startDate || b.date > endDate) continue;
    if (b.type === 'expense') expense += b.amount;
    else if (b.type === 'income') income += b.amount;
    count += 1;
  }
  return { expense, income, balance: income - expense, count };
}
