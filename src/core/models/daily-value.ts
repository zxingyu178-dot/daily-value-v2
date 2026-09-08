/**
 * Daily Value v2 - 日价动态计算（elapsed 模型）
 *
 * v2.3 定稿（Phase 3 前置修正，对齐 v1.20.2 实际源码 daysSince 口径）：
 *   elapsedDays = max(1, 今天与购买日期相差的完整日历天数)
 *   currentDailyValue = amount / elapsedDays
 *
 * 业务日期必须使用本地 yyyy-MM-dd（禁止用 UTC toISOString，避免正时区跨天回退），
 * 但天数差计算使用 UTC 日期编号（Date.UTC(y,m-1,d)/86400000）消除夏令时风险：
 * 欧洲 DST 切换日前后本地两个午夜间隔可能是 23/25 小时，本地时间戳差值不可靠；
 * 这里只是用 UTC 计算"日期编号"，并非把业务日期改成 UTC。
 */
import type { Bill } from '@/core/models/types';

/**
 * 将 yyyy-MM-dd 转换为稳定日历日编号。
 * 使用 Date.UTC(y, m-1, d) / 86400000 计算纯日历天数，与本地时区/DST 无关。
 */
export function dayNumber(dateStr: string): number {
  const [y, m, d] = dateStr.split('-').map(Number);
  return Math.floor(Date.UTC(y, (m || 1) - 1, d || 1) / 86400000);
}

/** 本地业务日期 yyyy-MM-dd（默认今天；date 为本地时间） */
export function localDateKey(date: Date = new Date()): string {
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${m}-${day}`;
}

/**
 * 距下一次本地午夜（下一天 00:00:00.000）的毫秒数。
 * 每次精确排到“下一次本地午夜”，触发后再重新调度，避免固定 24h interval 在 DST 23/25 小时时漂移。
 */
export function msUntilNextLocalMidnight(from: Date = new Date()): number {
  const next = new Date(from.getFullYear(), from.getMonth(), from.getDate() + 1, 0, 0, 0, 0);
  return Math.max(0, next.getTime() - from.getTime());
}

/**
 * 已使用天数（与 v1 daysSince 语义完全一致）：
 *   elapsedDays = max(1, 今天与购买日期相差的完整日历天数)
 * 例如：购买日 1 月 1 日、今天 1 月 2 日 → 1；同一天 → 1；昨天 → 1；相差 100 个日历日 → 100。
 * 注意：v1 的 diff < 1 时返回 1（当天即算 1 天），但 diff 从 0 起算，即不含当天。
 */
export function elapsedDays(startDate: string, today: string = localDateKey()): number {
  const diff = dayNumber(today) - dayNumber(startDate);
  return diff < 1 ? 1 : diff;
}

/**
 * 单笔日价：amount / elapsedDays。
 * @param today 可选，指定本地业务日期（测试"日期推进"用）；默认今天
 */
export function dailyValueOf(bill: Bill, today?: string): number {
  if (!bill.dailyValue?.enabled) return 0;
  const days = elapsedDays(bill.dailyValue.startDate, today);
  return days > 0 ? bill.amount / days : 0;
}

/** 是否参与日价计算 */
export function isDailyValueEnabled(bill: Bill): boolean {
  return Boolean(bill.dailyValue?.enabled);
}

/** 全部启用日价的账单每日成本合计 */
export function totalDailyValue(bills: Bill[], today?: string): number {
  return bills
    .filter(isDailyValueEnabled)
    .reduce((sum, b) => sum + dailyValueOf(b, today), 0);
}
