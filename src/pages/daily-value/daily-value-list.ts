/**
 * Daily Value v2 - 日价列表计算（纯函数，Phase 5）
 *
 * 规则：
 * - 日价不是资产管理：核心体验是"自己买过的物品，截至今天每天值多少钱"。
 * - 数据只能从 Bill 派生（dailyValue.enabled），禁止维护第二套数据。
 * - 日价 = amount / elapsedDays(startDate, 今天)，每天打开自动重算。
 * - 基础排序：按当前日价降序（每日成本高的在前）。
 * - 名称优先用 title（Phase 3 预留的物品名语义），缺失时回退 categoryName。
 */

import type { Bill } from '@/core/models/types';
import { elapsedDays, dailyValueOf } from '@/core/models/daily-value';

export interface DailyValueItem {
  id: string;
  /** 物品名称（title ?? categoryName） */
  name: string;
  emoji: string;
  /** 关联分类 id（图标渲染用，2.9.7） */
  categoryId: string;
  /** 原价 */
  amount: number;
  /** 账单日期（购买日期） */
  date: string;
  /** 日价起算日期 */
  startDate: string;
  /** 已使用天数 */
  elapsed: number;
  /** 当前日价（每天值多少钱） */
  daily: number;
}

/** 从账单派生日价物品列表，按当前日价降序（基础排序） */
export function computeDailyValueList(bills: Bill[], today: string): DailyValueItem[] {
  return bills
    .filter((b) => b.dailyValue?.enabled)
    .map((b) => {
      const start = b.dailyValue!.startDate;
      return {
        id: b.id,
        name: b.title || b.categoryName,
        emoji: b.categoryEmoji,
        categoryId: b.categoryId,
        amount: b.amount,
        date: b.date,
        startDate: start,
        elapsed: elapsedDays(start, today),
        daily: dailyValueOf(b, today),
      };
    })
    .sort((a, b) => b.daily - a.daily);
}
