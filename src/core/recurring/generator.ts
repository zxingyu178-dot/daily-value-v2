/**
 * Daily Value v2 - 周期记账生成器（Phase 7A）
 *
 * 定位：RecurringRule 不是独立账本，到期生成普通 Bill（source='recurring'），
 * 正常进入记账时间线 / 月汇总 / 统计；所有统计仍只从 Bill 派生。
 *
 * 生成模型（不依赖后台准点运行）：
 *   每类周期规则，App bootstrap / resume 时执行：
 *     检查 enabled RecurringRule → 计算截至当前本地时间所有 due occurrence
 *     → 生成缺失 Bill → 更新 nextOccurrence / lastGeneratedDate。
 *   即使用户很久没打开，再次打开也能补齐期间应产生的周期账单。
 *
 * 幂等：
 *   Bill 使用确定性 id：recur-{ruleId}-{date}-{time}。生成前先用该 id 查库，
 *   已存在则跳过；即使 bootstrap/resume/重启/连续执行多次也不会重复生成。
 *
 * 本地日历语义：
 *   全部 occurrence 日期都用本地 yyyy-MM-dd 日历运算（new Date(y,m-1,d+…)），
 *   不用 UTC/toISOString 决定业务日期；月/年用日历算法（非 30*24h / 365*24h），
 *   DST 下「每天 08:00」仍保持本地 08:00。
 *
 * 保护：
 *   单规则一次 catch-up 最多补 MAX_CATCHUP_PER_RULE（365）条，
 *   超过则 stop 并留下诊断（diagnosed），避免误配/恶性循环刷库。
 */
import { services } from '@/core/services';
import type { Bill, RecurringRule } from '@/core/models/types';
import { dayNumber, localDateKey } from '@/core/models/daily-value';

/** 单规则单次 catch-up 保护上限 */
export const MAX_CATCHUP_PER_RULE = 365;
/** 确定性 Bill id 前缀 */
export const RECURRING_BILL_PREFIX = 'recur';

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function parseDate(dateStr: string): { y: number; m: number; d: number } {
  const [y, m, d] = dateStr.split('-').map(Number);
  return { y, m, d };
}

function toDateStr(y: number, m: number, d: number): string {
  return `${y}-${pad2(m)}-${pad2(d)}`;
}

/** startDate 对应的本地星期（JS getDay(): 0=周日~6=周六） */
function startDateWeekday(rule: RecurringRule): number {
  const { y, m, d } = parseDate(rule.startDate);
  return new Date(y, m - 1, d).getDay();
}

/** weekly 的 day 是否合法（JS weekday 0-6 整数）。旧版本可能写入 day=24 等非法值。 */
export function isWeeklyDayInvalid(rule: RecurringRule): boolean {
  if (rule.frequency !== 'weekly') return false;
  const d = rule.day;
  return !(Number.isInteger(d) && d >= 0 && d <= 6);
}

/**
 * 解析 weekly 实际生效的星期：非法（非 0-6 整数）回退到 startDate 对应的 weekday。
 * 旧 generator 长期按「startDate 起的每 7 天」执行，此回退最接近旧行为，
 * 保证 UI 显示与 generator 执行一致（都落到 startDate 当天/每 7 天）。
 */
export function resolveWeeklyDay(rule: RecurringRule): number {
  return isWeeklyDayInvalid(rule) ? startDateWeekday(rule) : rule.day;
}

/** HH:mm 合法格式（00:00 ~ 23:59） */
const HHMM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/** sanitize 兼容的输入子集（覆盖编辑器 RecurringRuleInput 与完整 RecurringRule） */
type SanitizableRule = Pick<RecurringRule, 'frequency' | 'startDate'> &
  Partial<Pick<RecurringRule, 'interval' | 'enabled' | 'day' | 'month' | 'time'>>;

/**
 * 统一规范化 RecurringRule 输入（编辑器 / 历史数据 / 手动构造）。
 * 每个字段经钳制与校验，杜绝非法值让 generator 生成 2026-09-00 之类业务日期。
 * 原则：不改变合法规则的语义；只把非法值规范化到安全默认。返回新对象，不修改入参。
 */
export function sanitizeRecurringRule<T extends SanitizableRule>(rule: T): T {
  const out = { ...rule } as T;
  // interval：非有限/非整数 → 1；否则钳到 1..999
  out.interval = Number.isFinite(rule.interval) ? Math.min(999, Math.max(1, Math.round(rule.interval as number))) : 1;
  // enabled：非 boolean → 安全默认 false（不意外生成）
  out.enabled = typeof rule.enabled === 'boolean' ? rule.enabled : false;
  const day = Number(rule.day);
  const month = rule.month == null ? undefined : Number(rule.month);
  switch (rule.frequency) {
    case 'weekly': {
      // JS weekday：0-6 整数；非法回退 startDate weekday（保持旧每 7 天节奏语义）
      const wd = Number.isInteger(day) && day >= 0 && day <= 6 ? day : startDateWeekday(rule as unknown as RecurringRule);
      out.day = Number.isInteger(wd) && wd >= 0 && wd <= 6 ? wd : 0;
      break;
    }
    case 'monthly':
      // 1-31；超出目标月天数由 clampDay 在生成期落到当月最后一天
      out.day = Number.isFinite(day) ? Math.min(31, Math.max(1, Math.round(day))) : 1;
      break;
    case 'yearly':
      out.month = Number.isFinite(month) ? Math.min(12, Math.max(1, Math.round(month as number))) : undefined;
      out.day = Number.isFinite(day) ? Math.min(31, Math.max(1, Math.round(day))) : 1;
      break;
    default: // daily：day 无意义但规范化防 NaN 入库
      out.day = Number.isFinite(day) ? Math.max(1, Math.round(day)) : 1;
  }
  // time：非法 HH:mm → 安全默认 00:00（任一日期都有 00:00 时刻）
  out.time = typeof rule.time === 'string' && HHMM_RE.test(rule.time) ? rule.time : '00:00';
  return out;
}

/** 当月天数（m 为 1-12） */
export function daysInMonth(y: number, m: number): number {
  return new Date(y, m, 0).getDate();
}

/** 是否闰年 */
export function isLeapYear(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

/** 将 day 钳制到 [1, y/m 月天数]（防 0/负 / 超限；31 → 2 月 28/29；12-31 → 无溢位） */
export function clampDay(y: number, m: number, day: number): number {
  return Math.max(1, Math.min(day, daysInMonth(y, m)));
}

/** 日历加天数（自动跨月/年；Date 本地时间语义，DST 安全） */
function addCalendarDays(dateStr: string, days: number): string {
  const { y, m, d } = parseDate(dateStr);
  return localDateKey(new Date(y, m - 1, d + days));
}

/** rule 第 idx 个 occurrence 的日期 yyyy-MM-dd（0 起） */
export function occurrenceDate(rule: RecurringRule, idx: number): string {
  const { y: sy, m: sm, d: sd } = parseDate(rule.startDate);
  const interval = Math.max(1, rule.interval);
  switch (rule.frequency) {
    case 'daily':
      return addCalendarDays(rule.startDate, idx * interval);
    case 'weekly': {
      // 语义：从 startDate 当天或之后，找第一个 rule.day（JS getDay()，0=周日~6=周六）作为 occurrence 0，
      // 后续每 interval*7 天一个。startDate 的星期不必等于 rule.day。
      // 非法 day（旧数据）由 resolveWeeklyDay 回退到 startDate 的星期，避免映射成别的 weekday。
      const startDow = new Date(sy, sm - 1, sd).getDay();
      const delta = (resolveWeeklyDay(rule) - startDow + 7) % 7;
      const first = addCalendarDays(rule.startDate, delta);
      return addCalendarDays(first, idx * interval * 7);
    }
    case 'monthly': {
      const totalMonths = (sm - 1) + idx * interval;
      const y = sy + Math.floor(totalMonths / 12);
      const m = (totalMonths % 12) + 1;
      const day = clampDay(y, m, rule.day);
      return toDateStr(y, m, day);
    }
    case 'yearly': {
      const m = rule.month ?? sm;
      const y = sy + idx * interval;
      const day = clampDay(y, m, rule.day);
      return toDateStr(y, m, day);
    }
  }
}

/** occurrence 的本地时间戳（ms） */
function occurrenceTimestamp(dateStr: string, time: string): number {
  const { y, m, d } = parseDate(dateStr);
  const parts = time.split(':');
  const hh = Number(parts[0]) || 0;
  const mm = Number(parts[1]) || 0;
  return new Date(y, m - 1, d, hh, mm, 0, 0).getTime();
}

/** 确定性 Bill id（幂等）：recur-{ruleId}-{date}-{time} */
export function recurringBillId(ruleId: string, dateStr: string, time: string): string {
  return `${RECURRING_BILL_PREFIX}-${ruleId}-${dateStr}-${time}`;
}

/**
 * 返回 rule 在第 idx 个 occurrence 附近的起始索引（保证 occurrence(idx-anchor) 在 anchor 附近）：
 * 用日历量推导，避免从 startDate 起逐条线性扫（旧规则会被 365 上限截断在历史上）。
 * anchor 缺省取 lastGeneratedDate（若晚于 startDate），否则 startDate。
 */
export function startIndexFor(rule: RecurringRule, anchorDate: string): number {
  const { y: sy } = parseDate(rule.startDate);
  const { y: ty, m: tm } = parseDate(anchorDate);
  const interval = Math.max(1, rule.interval);
  switch (rule.frequency) {
    case 'daily': {
      const days = dayNumber(anchorDate) - dayNumber(rule.startDate);
      return Math.max(0, Math.floor(days / interval));
    }
    case 'weekly': {
      // weekly 的 occurrence 0 是 startDate 之后第一个 rule.day，需以它为锚，不能直接用 startDate
      const first = occurrenceDate(rule, 0);
      const days = dayNumber(anchorDate) - dayNumber(first);
      return Math.max(0, Math.floor(days / (7 * interval)));
    }
    case 'monthly': {
      const { m: sm } = parseDate(rule.startDate);
      const totalMonths = (ty - sy) * 12 + (tm - sm);
      return Math.max(0, Math.floor(totalMonths / interval));
    }
    case 'yearly':
      return Math.max(0, Math.floor((ty - sy) / interval));
  }
}

/** 计算 rule 的下一次 occurrence 日期（严格在当前本地时间之后）；无则为 undefined */
export function computeNextOccurrence(rule: RecurringRule, now: Date = new Date()): string | undefined {
  const nowMs = now.getTime();
  const today = localDateKey(now);
  const base = rule.lastGeneratedDate && rule.lastGeneratedDate > rule.startDate ? rule.lastGeneratedDate : rule.startDate;
  let idx = startIndexFor(rule, base);
  idx = Math.max(0, idx - 3);
  // 从 cursor 附近向后找第一个还没到期的 occurrence（含今天但时刻未到的）
  for (let i = 0; i < MAX_CATCHUP_PER_RULE + 4; i++) {
    const occDate = occurrenceDate(rule, idx + i);
    if (occDate < base) continue; // 仍在历史，跳到未来（由 idempotency 兜底）
    const occMs = occurrenceTimestamp(occDate, rule.time);
    if (occMs > nowMs) return occDate;
    if (occDate > today) break; // 已经是未来的天但时刻逾时不会再"未来"（不可能，防御）
  }
  return undefined;
}

/** 分类删除兼容：rule 引用的分类不可用时不崩溃，回退内置"生活"分类或规则快照 */
async function resolveCategory(rule: RecurringRule): Promise<{
  categoryId: string;
  categoryEmoji: string;
  categoryName: string;
}> {
  const cat = await services.categories.get(rule.categoryId);
  if (cat) return { categoryId: cat.id, categoryEmoji: cat.emoji, categoryName: cat.name };
  const fallback = await services.categories.get('c-life');
  if (fallback) return { categoryId: fallback.id, categoryEmoji: fallback.emoji, categoryName: fallback.name };
  return {
    categoryId: rule.categoryId,
    categoryEmoji: rule.categoryEmoji || '📄',
    categoryName: rule.categoryName || '未分类',
  };
}

export interface GenerateResult {
  generated: number;
  /** 单规则 catch-up 达到保护上限、有遗漏放弃补齐 */
  diagnosed: boolean;
  nextOccurrence?: string;
  lastGeneratedDate?: string;
}

/**
 * 为单个 rule 生成所有到期 Bill，并更新游标。
 * 幂等：确定性 Bill id + 查库跳过；多跑（bootstrap/resume/重启）不会重复。
 *
 * 生效边界：occurrence 的本地时间戳 <= scheduleEffectiveAt（编辑规则后置为 now）一律不再回填，
 * 但游标仍推进，避免每次启动都重复扫描同一批被跳过的历史 —— 这同时实现「编辑只影响未来」与
 * 「catch-up 游标分批推进」（多年 backlog 单次最多处理 MAX_CATCHUP_PER_RULE，剩余留给下批）。
 */
export async function generateDueBillsForRule(
  rule: RecurringRule,
  now: Date = new Date(),
): Promise<GenerateResult> {
  const noop = (): GenerateResult => ({ generated: 0, diagnosed: false, nextOccurrence: undefined });
  if (!rule.enabled) return noop();

  const nowMs = now.getTime();
  // 编辑生效边界：未设置（新建/历史规则）为 0 → 不影响；设置了则其之前一律不补生成
  const effectiveMs = rule.scheduleEffectiveAt ?? 0;
  const base = rule.lastGeneratedDate && rule.lastGeneratedDate > rule.startDate ? rule.lastGeneratedDate : rule.startDate;
  let idx = startIndexFor(rule, base);
  idx = Math.max(0, idx - 3); // 留 3 个 margin 兜底边界，靠幂等跳过重复

  let generated = 0;
  let lastGenerated: string | undefined;
  let nextOccurrence: string | undefined;

  for (let i = 0; i < MAX_CATCHUP_PER_RULE; i++) {
    const occDate = occurrenceDate(rule, idx + i);
    // 结构性早于当前游标/开始日期（如 monthly 锚定 startDate 所在月、但日在其前）→ 跳过不计游标
    if (occDate < base) continue;
    // 2.9.9 REC-DEL：lastGeneratedDate 及其之前的 occurrence 一律视为「已处理」。
    // 即使对应 Bill 被用户手动删除，也不得重新生成（防止已删除周期账单在 resume 后复活）；
    // 仅 lastGeneratedDate 之后的 occurrence 才按确定性 id 检查并按需补生成。
    // 新规则没有 lastGeneratedDate 时本分支不生效，startDate 第一次 occurrence 仍正常生成。
    if (rule.lastGeneratedDate && occDate <= rule.lastGeneratedDate) {
      if (!lastGenerated || occDate > lastGenerated) lastGenerated = occDate;
      continue;
    }
    const occMs = occurrenceTimestamp(occDate, rule.time);

    // 找到第一个尚未到期的 occurrence 即停止（它就是 nextOccurrence）
    if (occMs > nowMs) {
      nextOccurrence = occDate;
      break;
    }

    // 编辑生效边界之前：不得作为修改后的新 occurrence 回填；但推进游标避免重扫
    if (occMs <= effectiveMs) {
      if (!lastGenerated || occDate > lastGenerated) lastGenerated = occDate;
      continue;
    }

    const billId = recurringBillId(rule.id, occDate, rule.time);
    const existing = (await services.bills.get(billId)) as Bill | undefined;
    if (!existing) {
      const cat = await resolveCategory(rule);
      await services.bills.add({
        id: billId,
        type: rule.type,
        amount: rule.amount,
        categoryId: cat.categoryId,
        categoryEmoji: cat.categoryEmoji,
        categoryName: cat.categoryName,
        title: rule.note || undefined,
        note: rule.note,
        date: occDate,
        timestamp: occMs,
        source: 'recurring',
        recurringRuleId: rule.id,
        ledgerImpact: 'normal',
      });
      generated++;
    }
    if (!lastGenerated || occDate > lastGenerated) lastGenerated = occDate;
  }

  // 达到上限仍未走到未来 occurrence → 属于未追上的历史 backlog。
  // 游标已经推进到 lastGenerated（可能是一批 skipped/已存在的 vs effective / catch-up 前半段），
  // 下次执行会从新游标继续向后，不再永远重扫第一批 365 条。
  const diagnosed = nextOccurrence === undefined;
  if (nextOccurrence === undefined) {
    nextOccurrence = computeNextOccurrence(rule, now);
  }
  const lastGeneratedDate =
    lastGenerated && (!rule.lastGeneratedDate || lastGenerated > rule.lastGeneratedDate)
      ? lastGenerated
      : rule.lastGeneratedDate;
  await services.recurringRules.update(rule.id, { lastGeneratedDate, nextOccurrence });
  return { generated, diagnosed, nextOccurrence, lastGeneratedDate };
}

export interface AllGenerateResult {
  totalGenerated: number;
  diagnosedRules: number;
  diagnostics: Array<{ ruleId: string; generated: number; nextOccurrence?: string; diagnosed: boolean }>;
}

/** 为所有启用规则生成到期 Bill */
export async function generateDueBills(now: Date = new Date()): Promise<AllGenerateResult> {
  const rules = await services.recurringRules.list();
  // 防御性规范化全部规则：写入前统一 sanitize + 持久化已变化的字段，
  // 保证 UI 与 generator 都拿到合法值（interval 1-999 / weekly 0-6 / monthly 1-31 / yearly 1-12 / HH:mm / boolean）。
  const cleaned: RecurringRule[] = [];
  for (const r of rules) {
    const safe = sanitizeRecurringRule(r);
    const changed =
      safe.interval !== r.interval ||
      safe.enabled !== r.enabled ||
      safe.day !== r.day ||
      safe.time !== r.time ||
      (r.frequency === 'yearly' && safe.month !== r.month);
    if (changed) {
      await services.recurringRules.update(r.id, {
        interval: safe.interval,
        enabled: safe.enabled,
        day: safe.day,
        ...(r.frequency === 'yearly' ? { month: safe.month } : {}),
        time: safe.time,
      });
    }
    cleaned.push(safe);
  }
  const enabled = cleaned.filter((r) => r.enabled);
  const result: AllGenerateResult = { totalGenerated: 0, diagnosedRules: 0, diagnostics: [] };
  for (const rule of enabled) {
    const res = await generateDueBillsForRule(rule, now);
    result.totalGenerated += res.generated;
    if (res.diagnosed) {
      result.diagnosedRules += 1;
      // eslint-disable-next-line no-console
      console.warn(`[recurring] rule ${rule.id} 达到 catch-up 保护上限，已停止补齐并留下诊断；nextOccurrence=${res.nextOccurrence}`);
    }
    result.diagnostics.push({ ruleId: rule.id, generated: res.generated, nextOccurrence: res.nextOccurrence, diagnosed: res.diagnosed });
  }
  return result;
}

/* ---- 触发驱动：bootstrap 一次 + resume（web / Capacitor）----
   initRecurringGeneration 已移至 orchestration.ts（需要调用 billStore.load(true) 同步）。
   generator 保持纯逻辑，不 import Pinia / Vue。 */

/** 单一 drain Promise：运行中再次触发返回同一 Promise，不提前 resolve、不丢失 rerun */
let runningPromise: Promise<AllGenerateResult> | null = null;
let rerunRequested = false;

/**
 * 幂等触发生成（去重去并发，但不丢触发）。
 *
 * 单一 drain Promise 语义：
 *   - 第一次调用创建 runningPromise，运行 drain 循环
 *   - 运行中再次触发 → rerunRequested=true，返回同一个 runningPromise
 *   - 当前轮结束如果 rerunRequested 则继续下一轮
 *   - 整个 queue drain 完 → Promise resolve，返回累计 AllGenerateResult
 *
 * 所有并发调用方 await 同一个 drain Promise，不会提前返回 null。
 * 典型场景：generator 运行中用户新建了一条已到期规则并保存触发
 * → 首轮结束自动补跑第二轮，新规则 Bill 才能生成；调用方 await 完成后保证可见。
 */
export function runRecurringGeneration(now: Date = new Date()): Promise<AllGenerateResult> {
  if (runningPromise) {
    rerunRequested = true;
    return runningPromise;
  }

  runningPromise = (async (): Promise<AllGenerateResult> => {
    let totalGenerated = 0;
    let lastResult: AllGenerateResult = { totalGenerated: 0, diagnosedRules: 0, diagnostics: [] };
    try {
      do {
        rerunRequested = false;
        const result = await generateDueBills(now);
        totalGenerated += result.totalGenerated;
        lastResult = result;
      } while (rerunRequested);
    } finally {
      runningPromise = null;
    }
    return {
      totalGenerated,
      diagnosedRules: lastResult.diagnosedRules,
      diagnostics: lastResult.diagnostics,
    };
  })();

  return runningPromise;
}

/** 节流工具（orchestration 层 resume/visibility 触发用） */
export function throttle(fn: () => void, ms: number): () => void {
  let last = 0;
  return () => {
    const t = Date.now();
    if (t - last >= ms) {
      last = t;
      fn();
    }
  };
}