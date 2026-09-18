/**
 * DailyValue v2.20.0 Gate B - 日价详情 / 曲线 / 里程碑（纯函数，Bill 派生）
 *
 * 规则：
 * - 不新增第二套数据库：详情/曲线/里程碑全部从 Bill.dailyValue 动态推导。
 * - 日价 = amount / elapsedDays(startDate, 今天)（elapsed 模型，与 daily-value.ts 一致）。
 * - 曲线不生成「每天几千个点」：当天数超过 maxPoints 时均匀采样（80~120 点内），
 *   但始终包含 第 1 天 与 今天，并尽量保留 7/30/100/365… 里程碑节点。
 * - 里程碑只做两种纯数学事实：使用天数节点（7/30/100/365…）与日价目标节点
 *   （按原价从 ¥100/¥50/¥20/¥10/¥5/¥1 中选 3~5 个），禁止预测寿命/回本等文案。
 * - 边界：购买当天、amount=0、未来 startDate（脏数据）、10 年以上、Bill 已删除、
 *   dailyValue 已关闭，均返回可渲染的安全值（不抛错、不 NaN）。
 */
import type { Bill } from '@/core/models/types';
import { dayNumber, elapsedDays, localDateKey } from '@/core/models/daily-value';

/** 日价详情（页面 Hero 数据源） */
export interface DailyValueDetail {
  /** 原 Bill（可为 undefined = 项目不存在/已删除） */
  bill: Bill | undefined;
  /** 是否可展示详情（Bill 存在且 dailyValue.enabled） */
  ok: boolean;
  name: string;
  emoji: string;
  categoryId: string;
  categoryName: string;
  /** 原价 */
  amount: number;
  /** 购买日期 yyyy-MM-dd */
  date: string;
  /** 日价起算日期 */
  startDate: string;
  /** 已使用天数（今天口径） */
  elapsed: number;
  /** 当前日价 = amount / elapsed */
  current: number;
}

/** 曲线采样点 */
export interface DailyValueCurvePoint {
  /** 第 N 天（1 起） */
  day: number;
  /** 该天日期 yyyy-MM-dd */
  date: string;
  /** 展示 label（「第1天」「第7天」…） */
  label: string;
  /** 当日日价 value = amount / day */
  value: number;
}

/** 使用时间里程碑（纯数学事实） */
export interface UsageMilestone {
  /** 目标天数（7 / 30 / 100 / 365…） */
  target: number;
  /** 是否已达到 */
  achieved: boolean;
  /** 已使用天数 */
  elapsed: number;
  /** 距达成还差的天数（已达成 = 0） */
  remaining: number;
}

/** 日价目标节点（amount / targetDailyValue = 达成所需天数） */
export interface DailyPriceMilestone {
  /** 目标日价（¥x / 天） */
  target: number;
  /** 达成所需天数 = ceil(amount / target) */
  requiredDays: number;
  /** 是否已达成（elapsed >= requiredDays） */
  achieved: boolean;
  /** 距达成还差天数（已达成 = 0） */
  remainingDays: number;
}

const USAGE_TARGETS = [7, 30, 100, 365, 730, 1095, 1460, 1825];
const PRICE_TARGETS = [100, 50, 20, 10, 5, 1];
/** 曲线最大采样点数（长周期均匀采样时用） */
export const CURVE_MAX_POINTS = 100;

/**
 * 计算日价详情。Bill 缺失或 dailyValue 未启用 → ok=false（页面渲染「不存在」）。
 * 未来 startDate（脏数据）也安全：elapsedDays 口径 max(1, …)，elapsed >= 1。
 */
export function computeDailyValueDetail(bill: Bill | undefined, today: string = localDateKey()): DailyValueDetail {
  if (!bill || !bill.dailyValue?.enabled) {
    return {
      bill,
      ok: false,
      name: bill?.title || bill?.categoryName || '',
      emoji: bill?.categoryEmoji ?? '',
      categoryId: bill?.categoryId ?? '',
      categoryName: bill?.categoryName ?? '',
      amount: bill?.amount ?? 0,
      date: bill?.date ?? '',
      startDate: bill?.dailyValue?.startDate ?? bill?.date ?? '',
      elapsed: 0,
      current: 0,
    };
  }
  const startDate = bill.dailyValue.startDate;
  const elapsed = elapsedDays(startDate, today);
  return {
    bill,
    ok: true,
    name: bill.title || bill.categoryName || '日价物品',
    emoji: bill.categoryEmoji,
    categoryId: bill.categoryId,
    categoryName: bill.categoryName,
    amount: bill.amount,
    date: bill.date,
    startDate,
    elapsed,
    current: elapsed > 0 ? bill.amount / elapsed : 0,
  };
}

/** 起算日期 + 天数 → 业务日期（本地日历） */
function dayDate(startDate: string, day: number): string {
  const [y, m, d] = startDate.split('-').map(Number);
  const dt = new Date(y, (m || 1) - 1, (d || 1) + day - 1);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

/** 幂等采样：给定目标天数序列，去重升序并确保首尾 */
function dedupeSorted(days: number[]): number[] {
  const set = new Set(days.filter((d) => Number.isFinite(d) && d >= 1));
  return [...set].sort((a, b) => a - b);
}

/**
 * 构建日价下降曲线（第 1 天 → 今天，value = amount / day）。
 * - 总天数 <= maxPoints：逐日。
 * - 长周期：均匀采样 + 里程碑节点（7/30/100/…）+ 首尾，总点数 <= maxPoints + 里程碑数。
 * - amount = 0 时所有点 value = 0（安全）。
 */
export function buildDailyValueCurve(
  bill: Bill | undefined,
  today: string = localDateKey(),
  maxPoints: number = CURVE_MAX_POINTS,
): DailyValueCurvePoint[] {
  const detail = computeDailyValueDetail(bill, today);
  if (!detail.ok) return [];
  const totalDays = Math.max(1, detail.elapsed);
  const amount = detail.amount;
  const safeMax = Math.max(8, Math.min(120, Math.floor(maxPoints) || CURVE_MAX_POINTS));

  let days: number[];
  if (totalDays <= safeMax) {
    days = dedupeSorted([1, totalDays, ...range(2, totalDays)]);
  } else {
    // 均匀采样：步长保证 <= safeMax 个点
    const step = totalDays / safeMax;
    const sampled: number[] = [];
    for (let d = 1; d <= totalDays; d += step) sampled.push(Math.round(d));
    // 里程碑关键节点（7/30/100/365…当日存在时尽量保留）
    const keep = USAGE_TARGETS.filter((t) => t <= totalDays);
    days = dedupeSorted([1, totalDays, ...sampled, ...keep]);
  }
  return days.map((d) => {
    const value = d > 0 ? amount / d : amount;
    return {
      day: d,
      date: dayDate(detail.startDate, d),
      label: `第${d}天`,
      value: Math.round(value * 100) / 100,
    };
  });
}

function range(from: number, to: number): number[] {
  const out: number[] = [];
  for (let i = from; i <= to; i++) out.push(i);
  return out;
}

/**
 * 使用时间里程碑（7/30/100/365/730…，<= 实际天数 的窗口内）。
 * 已达成高亮；未达成给出剩余天数。
 */
export function computeUsageMilestones(
  startDate: string,
  today: string = localDateKey(),
): UsageMilestone[] {
  const elapsed = Math.max(1, elapsedDays(startDate, today));
  const targets = USAGE_TARGETS.filter((t) => t <= Math.max(365, elapsed * 4));
  return targets.map((target) => ({
    target,
    achieved: elapsed >= target,
    elapsed,
    remaining: elapsed >= target ? 0 : Math.max(0, target - elapsed),
  }));
}

/**
 * 日价目标节点：按原价自动选择 3~5 个有意义的节点。
 * - 从 ¥100/¥50/¥20/¥10/¥5/¥1 中取 小于等于原价 的前 4 个（示例口径：MacBook 6088 → 100/50/20/10）。
 * - requiredDays = ceil(amount / target)；achieved = elapsed >= requiredDays。
 * - amount <= 0 或无日价 → 空数组（安全）。
 */
export function computeDailyPriceMilestones(
  amount: number,
  elapsed: number,
): DailyPriceMilestone[] {
  if (!Number.isFinite(amount) || amount <= 0) return [];
  const safeElapsed = Math.max(0, Math.floor(elapsed) || 0);
  const candidates = PRICE_TARGETS.filter((t) => amount >= t).slice(0, 4);
  return candidates.map((target) => {
    const requiredDays = Math.max(1, Math.ceil(amount / target));
    return {
      target,
      requiredDays,
      achieved: safeElapsed >= requiredDays,
      remainingDays: safeElapsed >= requiredDays ? 0 : Math.max(0, requiredDays - safeElapsed),
    };
  });
}

/** 从日价目标节点中取「下一站」（第一个未达成的；全部达成返回 undefined） */
export function nextPriceMilestone(milestones: DailyPriceMilestone[]): DailyPriceMilestone | undefined {
  return milestones.find((m) => !m.achieved);
}

/**
 * 最近里程碑摘要（详情页 Hero 下方突出信息）：
 * - 已达成：已使用 N 天 / 已降到 ¥X/天以内
 * - 下一站：下一 ¥Y/天，还需 M 天
 * 全部纯数学事实。返回 null 表示无任何节点可展示（如金额过小无目标）。
 */
export function buildMilestoneSummary(
  detail: DailyValueDetail,
  milestones: DailyPriceMilestone[],
): { achievedText: string; nextText: string | null } | null {
  if (!detail.ok) return null;
  const achieved = milestones.filter((m) => m.achieved);
  const next = nextPriceMilestone(milestones);
  const achievedText =
    achieved.length > 0
      ? `已使用 ${detail.elapsed} 天，日价已经降到 ¥${achieved[achieved.length - 1].target}/天以内`
      : `已使用 ${detail.elapsed} 天`;
  const nextText = next
    ? `下一站 ¥${next.target}/天，还需 ${next.remainingDays} 天`
    : null;
  return { achievedText, nextText };
}

/** UTC 日期编号差值（供测试断言使用天数日期推进） */
export function utcDayDiff(a: string, b: string): number {
  return dayNumber(b) - dayNumber(a);
}