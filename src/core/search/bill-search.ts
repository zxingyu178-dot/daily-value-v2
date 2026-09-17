/**
 * DailyValue v2.19.0 - 账单搜索（纯函数）
 *
 * 规则：
 * - 只搜索进入账本的 ordinary 账单（ledgerImpact !== 'daily-value-only'），
 *   daily-value-only（仅日价物品）不进入搜索结果（SEARCH-10）。
 * - 匹配范围：商户/名称（title ?? categoryName）、备注 note、分类名称 categoryName、金额。
 * - 金额匹配允许「25.8」命中「¥25.80」：查询文本经金额归一化后与账单金额
 *   做 0.005 元容差比较（2 位小数语义），不做字符串 includes。
 * - 搜索不依赖 IndexedDB，直接作用于 billStore.bills（内存）过滤，可与 computed 一起用。
 */
import type { Bill, BillType } from '@/core/models/types';

/** 搜索过滤条件（全部可选；同时提供时组合生效） */
export interface BillSearchFilters {
  /** 关键词（商户/备注/分类名/金额）；空/空白 = 不按关键词过滤 */
  q?: string;
  /** 类型：'all' 或省略 = 全部 */
  type?: BillType | 'all';
  /** 年份（2026）；省略 = 不限 */
  year?: number;
  /** 月份 yyyy-MM（2026-08）；省略 = 不限（与 year 同时给时年月叠加） */
  month?: string;
  /** 分类 id；'all' 或省略 = 不限 */
  categoryId?: string;
  /** 自定义区间起始 yyyy-MM-dd（含）；省略 = 不限（与 month/year 同时给时叠加） */
  dateFrom?: string;
  /** 自定义区间结束 yyyy-MM-dd（含）；省略 = 不限 */
  dateTo?: string;
}

/**
 * 统一归一化搜索文本：去除首尾空白、折叠连续空白、转小写。
 * 不做中文分词（第一版保持简单，includes 足够）。
 */
export function normalizeBillSearchText(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * 归一化金额候选：生成给文本侧「定位」用的形态。
 * 将 query 中的币种符号（¥/$/€/£/₩/฿/₹/₽/圆）与千位逗号（含全角逗号/空格）去掉后，
 * 尝试解析为数字；解析失败返回 null（表示不是金额查询）。
 */
export function parseAmountQuery(q: string): number | null {
  const cleaned = q
    .replace(/[¥￥$€£₩฿₹₽\u00a5]/g, '')
    .replace(/[,，\s]/g, '');
  if (cleaned === '') return null;
  const n = Number.parseFloat(cleaned);
  if (!Number.isFinite(n)) return null;
  return n;
}

/** 账单金额与金额查询的匹配：2 位小数容差（25.8 === 25.80） */
export function amountMatches(queryAmount: number | null, amount: number): boolean {
  if (queryAmount === null) return false;
  return Math.abs(amount - queryAmount) < 0.005;
}

/** 单个账单的文本是否命中关键词（商户/备注/分类名；全部归一化后 includes） */
function billTextMatches(bill: Bill, norm: string): boolean {
  const name = bill.title ?? bill.categoryName;
  if (normalizeBillSearchText(name).includes(norm)) return true;
  if (normalizeBillSearchText(bill.note).includes(norm)) return true;
  if (normalizeBillSearchText(bill.categoryName).includes(norm)) return true;
  return false;
}

/** 单个账单是否命中单个关键词（文本 或 金额） */
function billMatchesQuery(bill: Bill, query: string): boolean {
  const norm = normalizeBillSearchText(query);
  if (!norm) return true; // 空白查询 = 不过滤
  if (billTextMatches(bill, norm)) return true;
  return amountMatches(parseAmountQuery(norm), bill.amount);
}

/**
 * 账单搜索主函数（纯函数，可单测）：
 * - 先按口径过滤（只进账本），再按 type/year/month/categoryId 组合过滤，最后按关键词过滤。
 * - 返回结果按日期倒序（同日期按 timestamp 倒序，最近在前）。
 */
export function searchBills(bills: Bill[], filters: BillSearchFilters = {}): Bill[] {
  const { q, type = 'all', year, month, categoryId = 'all', dateFrom, dateTo } = filters;

  let list = bills.filter((b) => b.ledgerImpact !== 'daily-value-only');

  if (type && type !== 'all') list = list.filter((b) => b.type === type);
  if (year !== undefined && year !== null) {
    list = list.filter((b) => b.date.startsWith(String(year)));
  }
  if (month) list = list.filter((b) => b.date.startsWith(month));
  if (categoryId && categoryId !== 'all') {
    list = list.filter((b) => b.categoryId === categoryId);
  }
  if (dateFrom) list = list.filter((b) => b.date >= dateFrom);
  if (dateTo) list = list.filter((b) => b.date <= dateTo);
  if (q && q.trim() !== '') {
    const trimmed = q.trim();
    list = list.filter((b) => billMatchesQuery(b, trimmed));
  }

  return [...list].sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? 1 : -1;
    return b.timestamp - a.timestamp;
  });
}

/**
 * 将搜索结果按日期分组（yyyy-MM-dd 倒序），供时间线式渲染复用。
 * 每组结构：{ date, label（如「9月12日 周六」由页面层补充）, bills }
 */
export function groupSearchResults(bills: Bill[]): { date: string; bills: Bill[] }[] {
  const map = new Map<string, Bill[]>();
  for (const b of bills) {
    const list = map.get(b.date) ?? [];
    list.push(b);
    map.set(b.date, list);
  }
  return [...map.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .map(([date, list]) => ({ date, bills: list }));
}

/**
 * 组装钻取/搜索页的 Route Query（统计 → 搜索联动）：
 * 只保留有效条件（空/全量值不进 query），生成形如
 * /bill-search?q=瑞幸&year=2026&month=2026-08&category=xxx&type=expense 的结果。
 */
export function buildSearchQuery(parts: {
  q?: string;
  year?: number;
  month?: string;
  categoryId?: string;
  type?: BillType | 'all';
}): Record<string, string> {
  const query: Record<string, string> = {};
  const q = parts.q?.trim();
  if (q) query.q = q;
  if (parts.year !== undefined && parts.year !== null) query.year = String(parts.year);
  if (parts.month) query.month = parts.month;
  if (parts.categoryId && parts.categoryId !== 'all') query.category = parts.categoryId;
  if (parts.type && parts.type !== 'all') query.type = parts.type;
  return query;
}