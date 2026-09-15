/**
 * Daily Value v2 - 自动记账 候选生命周期共享逻辑（2.15.0 Gate A）
 *
 * 纯函数：候选 → 正式 Bill 的分派规则（分类解析/快照/默认值）。
 * IdbAutoBillService 与 MemoryAutoBillService 共用，保证两条实现语义一致。
 */
import type { AutoBillCandidate, Bill, BillType, Category } from '@/core/models/types';
import { dayKey } from '@/feature/autobill/domain/hash';

/** 近邻去重时间窗口（2.16.1 Gate C）：10 分钟内 同源+同额+同商户 视为同一笔 */
export const NEAR_DEDUPE_WINDOW_MS = 10 * 60 * 1000;

/** 收支默认分类偏好（不存在时兜底第一个分类） */
const EXPENSE_PREFERRED = 'c-food';
const INCOME_PREFERRED = 'c-salary';

/**
 * 解析分类：优先候选推荐 id；不可用（缺失/不存在）时按收支类型取默认偏好分类；
 * 全部不可用时返回第一个分类（历史快照兜底，绝不静默新建分类）。
 */
export function resolveCategory(
  categories: Category[],
  suggestCategoryId?: string,
  type: BillType = 'expense',
): Category | undefined {
  if (suggestCategoryId) {
    const hit = categories.find((c) => c.id === suggestCategoryId);
    if (hit) return hit;
  }
  const preferred = type === 'income' ? INCOME_PREFERRED : EXPENSE_PREFERRED;
  const pref = categories.find((c) => c.id === preferred);
  if (pref) return pref;
  return categories[0];
}

/** 候选 → 正式 Bill（source='notification'；商户名进备注；交易日本地化） */
export function buildBillFromCandidate(
  candidate: AutoBillCandidate,
  category: Category | undefined,
): Bill {
  return {
    id: `nb-${candidate.id}`, // 与候选 id 一一对应，防重复
    type: candidate.type,
    amount: candidate.amount,
    categoryId: category?.id ?? 'c-food',
    categoryEmoji: category?.emoji ?? '🧾',
    categoryName: category?.name ?? '未分类',
    note: candidate.merchant || candidate.sourceApp,
    date: dayKey(candidate.transactionTime),
    timestamp: candidate.transactionTime,
    source: 'notification',
    ledgerImpact: 'normal',
  };
}