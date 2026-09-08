/**
 * Daily Value v2 - Recurring 生成器行为测试（Phase 7A）
 * 目标：断言数据库层结果（bills / recurringRules），不测页面按钮。
 * 覆盖 REC-01 ~ REC-17。
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { openDatabase } from '@/core/db/database';
import { services } from '@/core/services';
import {
  generateDueBills,
  generateDueBillsForRule,
  isWeeklyDayInvalid,
  MAX_CATCHUP_PER_RULE,
  occurrenceDate,
  recurringBillId,
  runRecurringGeneration,
  sanitizeRecurringRule,
} from '@/core/recurring/generator';
import type { Bill, RecurringRule } from '@/core/models/types';
import { dayNumber } from '@/core/models/daily-value';

const STORES = ['bills', 'categories', 'settings', 'meta', 'recurringRules'] as const;

/** 重置所有 Store（保留数据库连接），并预置存活分类（generator 的 resolveCategory 回退需要） */
async function resetDb() {
  const db = await openDatabase();
  const tx = db.transaction(STORES, 'readwrite');
  for (const s of STORES) tx.objectStore(s).clear();
  await tx.done;
  const tx2 = db.transaction('categories', 'readwrite');
  for (const c of [
    { id: 'c-life', name: '生活', emoji: '🏠', builtin: true, sort: 5 },
    { id: 'c-food', name: '餐饮', emoji: '🍚', builtin: true, sort: 1 },
    { id: 'c-fun', name: '娱乐', emoji: '🎮', builtin: true, sort: 4 },
  ]) {
    tx2.store.put(c);
  }
  await tx2.done;
  localStorage.clear();
}

type RuleInput = Omit<RecurringRule, 'id' | 'createdAt' | 'updatedAt' | 'lastGeneratedDate' | 'nextOccurrence'>;

function baseRule(): RuleInput {
  return {
    enabled: true,
    type: 'expense',
    amount: 100,
    categoryId: 'c-food',
    categoryEmoji: '🍚',
    categoryName: '餐饮',
    note: '周期账单',
    frequency: 'monthly',
    interval: 1,
    day: 1,
    month: 1,
    startDate: '2026-08-01',
    time: '09:00',
  };
}

async function addRule(over: Partial<RuleInput> = {}): Promise<RecurringRule> {
  return services.recurringRules.add({ ...baseRule(), ...over });
}

/** 构造本地 now（本地时区），用于定位 occurrence */
function at(y: number, m: number, d: number, hh = 12, mm = 0): Date {
  return new Date(y, m - 1, d, hh, mm, 0, 0);
}

async function bill(id: string): Promise<Bill | undefined> {
  return services.bills.get(id);
}

describe('occurrence 日历算法（REC-01~06 基础）', () => {
  it('dayNumber/localDateKey 稳定（本地日历语义，不受 toISOString 影响）', () => {
    // REC-17：纯日历编号与本地时区无关
    expect(occurrenceDate({ ...baseRule(), frequency: 'daily', startDate: '2026-08-22' } as RecurringRule, 0)).toBe('2026-08-22');
    expect(occurrenceDate({ ...baseRule(), frequency: 'daily', startDate: '2026-08-22' } as RecurringRule, 3)).toBe('2026-08-25');
  });
});

describe('REC-01 每日规则生成', () => {
  beforeEach(resetDb);

  it('startDate 当天到 now 每天生成一条 Bill，且 nextOccurrence 正确更新', async () => {
    const rule = await addRule({ frequency: 'daily', startDate: '2026-08-20', time: '09:00' });
    const now = at(2026, 8, 24, 12); // 8/24 中午
    const res = await generateDueBillsForRule(rule, now);
    // 20/21/22/23/24 五天的 09:00 都已到期（24 日 09:00 < 12:00）
    expect(res.generated).toBe(5);
    expect(res.nextOccurrence).toBe('2026-08-25');

    for (const d of [20, 21, 22, 23, 24]) {
      const b = await bill(recurringBillId(rule.id, `2026-08-${d}`, '09:00'));
      expect(b?.date, `2026-08-${d}`).toBe(`2026-08-${d}`);
      expect(b?.amount).toBe(100);
    }
  });
});

describe('REC-02 每周规则生成', () => {
  beforeEach(resetDb);

  it('与 startDate 同星期，隔 interval*7 天', async () => {
    // 2026-08-24 是周一
    const rule = await addRule({ frequency: 'weekly', day: 1, startDate: '2026-08-24', time: '09:00' });
    const now = at(2026, 9, 15, 12);
    const res = await generateDueBillsForRule(rule, now);

    const billDates = (await services.bills.list()).map((b) => b.date).sort();
    // 8/24、8/31、9/7、9/14（每次 09:00 到期）；9/21 尚未到期
    expect(billDates).toEqual(['2026-08-24', '2026-08-31', '2026-09-07', '2026-09-14']);
    expect(res.nextOccurrence).toBe('2026-09-21');
  });

  it('每 2 周 interval=2', async () => {
    const rule = await addRule({ frequency: 'weekly', interval: 2, day: 1, startDate: '2026-08-24', time: '09:00' });
    const now = at(2026, 9, 15, 12);
    await generateDueBillsForRule(rule, now);
    const billDates = (await services.bills.list()).map((b) => b.date).sort();
    // idx0=8/24、idx1=9/7、idx2=9/21；9/21 未到期
    expect(billDates).toEqual(['2026-08-24', '2026-09-07']);
  });
});

describe('REC-03 每月规则生成', () => {
  beforeEach(resetDb);

  it('每月 15 日生成', async () => {
    const rule = await addRule({ frequency: 'monthly', day: 15, startDate: '2026-08-24', time: '09:00' });
    const now = at(2026, 11, 1, 12);
    const res = await generateDueBillsForRule(rule, now);
    // startDate 8/24 属于 8 月；8/15 已在 startDate 前 → 从 9/15 起补齐
    const billDates = (await services.bills.list()).map((b) => b.date).sort();
    expect(billDates).toEqual(['2026-09-15', '2026-10-15']);
    expect(res.nextOccurrence).toBe('2026-11-15');
  });

  it('每 3 月 interval=3', async () => {
    const rule = await addRule({ frequency: 'monthly', interval: 3, day: 1, startDate: '2026-08-01', time: '09:00' });
    const now = at(2026, 12, 1, 12);
    await generateDueBillsForRule(rule, now);
    const billDates = (await services.bills.list()).map((b) => b.date).sort();
    expect(billDates).toEqual(['2026-08-01', '2026-11-01']);
    expect((await services.bills.list()).length).toBe(2);
  });
});

describe('REC-04 每年规则生成', () => {
  beforeEach(resetDb);

  it('每年同日生成', async () => {
    const rule = await addRule({ frequency: 'yearly', month: 7, day: 1, startDate: '2026-07-01', time: '09:00' });
    const now = at(2028, 8, 1, 12);
    await generateDueBillsForRule(rule, now);
    const billDates = (await services.bills.list()).map((b) => b.date).sort();
    expect(billDates).toEqual(['2026-07-01', '2027-07-01', '2028-07-01']);
  });
});

describe('REC-05 每月 31 日 → 目标月最后一天', () => {
  beforeEach(resetDb);

  it('1/31 → 2/28 → 3/31（非闰年 2025）', async () => {
    const rule = await addRule({ frequency: 'monthly', day: 31, startDate: '2025-01-31', time: '09:00' });
    const now = at(2025, 4, 1, 12);
    await generateDueBillsForRule(rule, now);
    const billDates = (await services.bills.list()).map((b) => b.date).sort();
    expect(billDates).toEqual(['2025-01-31', '2025-02-28', '2025-03-31']);
    expect(await bill(recurringBillId(rule.id, '2025-02-28', '09:00'))).toBeTruthy();
  });
});

describe('REC-06 闰年 2 月 29 逻辑', () => {
  beforeEach(resetDb);

  it('2028（闰年）2 月取 29 日', async () => {
    const rule = await addRule({ frequency: 'monthly', day: 31, startDate: '2028-01-31', time: '09:00' });
    const now = at(2028, 4, 1, 12);
    await generateDueBillsForRule(rule, now);
    const billDates = (await services.bills.list()).map((b) => b.date).sort();
    expect(billDates).toEqual(['2028-01-31', '2028-02-29', '2028-03-31']);
    expect(await bill(recurringBillId(rule.id, '2028-02-29', '09:00'))).toBeTruthy();
  });

  it('非闰年（2026）2 月取 28 日', async () => {
    const rule = await addRule({ frequency: 'monthly', day: 29, startDate: '2026-01-29', time: '09:00' });
    const now = at(2026, 3, 1, 12);
    await generateDueBillsForRule(rule, now);
    const billDates = (await services.bills.list()).map((b) => b.date).sort();
    expect(billDates).toEqual(['2026-01-29', '2026-02-28']);
  });
});

describe('幂等 / 触发（REC-07/08/09）', () => {
  beforeEach(resetDb);

  it('REC-07 app 启动（bootstrap）对多规则一次性补齐', async () => {
    await addRule({ frequency: 'daily', startDate: '2026-08-28', time: '09:00' });
    await addRule({ frequency: 'monthly', day: 1, startDate: '2026-08-01', time: '09:00' });
    const now = at(2026, 8, 31, 12);
    const res = await generateDueBills(now);
    // daily: 28/29/30/31 = 4 条；monthly(day=1): 8/1 在 startDate，9/1 未到期 → 1 条
    expect(res.totalGenerated).toBe(5);
    expect((await services.bills.list()).length).toBe(5);
  });

  it('REC-08 resume 重复触发不生成第二条（确定性 id 幂等）', async () => {
    const rule = await addRule({ frequency: 'monthly', day: 5, startDate: '2026-08-01', time: '09:00' });
    const now = at(2026, 9, 1, 12);
    await generateDueBillsForRule(rule, now);
    const first = (await services.bills.list()).length;
    expect(first).toBe(1);

    // 再次触发（resume）
    await generateDueBillsForRule(rule, now);
    await generateDueBills(now);
    expect((await services.bills.list()).length).toBe(1);
  });

  it('REC-09 force-stop/restart（重新 full 扫描）仍幂等', async () => {
    await addRule({ frequency: 'monthly', day: 5, startDate: '2026-08-01', time: '09:00' });
    const now = at(2026, 9, 1, 12);
    await generateDueBills(now);
    // 模拟重启：新建 registry 实例再次全量扫描（同一 DB）
    expect((await services.bills.list()).length).toBe(1);
    await generateDueBills(now);
    expect((await services.bills.list()).length).toBe(1);
  });
});

describe('catch-up（REC-10/11）', () => {
  beforeEach(resetDb);

  it('REC-10 多天未打开自动补齐期间所有到期 Bill', async () => {
    // 7 天没打开：8/1 创建的每日规则，直到 8/8 才打开
    const rule = await addRule({ frequency: 'daily', startDate: '2026-08-01', time: '09:00' });
    const now = at(2026, 8, 8, 12);
    await generateDueBillsForRule(rule, now);
    const billDates = (await services.bills.list()).map((b) => b.date).sort();
    expect(billDates).toEqual([
      '2026-08-01', '2026-08-02', '2026-08-03', '2026-08-04',
      '2026-08-05', '2026-08-06', '2026-08-07', '2026-08-08',
    ]);
    expect(billDates.length).toBe(8);
  });

  it('REC-11 catch-up 保护上限：单规则最多补 365，超出则 diagnosed 并停止', async () => {
    // startDate 距今远大于 365 天，因无未来 occurrence 会触发保护
    const rule = await addRule({ frequency: 'daily', startDate: '2023-09-01', time: '09:00' });
    const now = at(2026, 8, 24, 12);
    const res = await generateDueBillsForRule(rule, now);
    expect(res.generated).toBe(MAX_CATCHUP_PER_RULE); // 365
    expect(res.diagnosed).toBe(true);
    // 未来不再被无限生成
    const before = (await services.bills.list()).length;
    await generateDueBillsForRule(rule, now);
    expect((await services.bills.list()).length).toBe(before);
  });
});

describe('修改/删除规则不影响历史（REC-12/13）', () => {
  beforeEach(resetDb);

  it('REC-12 修改规则金额，历史已生成 Bill 不变，仅未来按新值', async () => {
    const rule = await addRule({ frequency: 'monthly', day: 1, startDate: '2026-08-01', amount: 2500, time: '09:00' });
    await generateDueBillsForRule(rule, at(2026, 8, 5, 12)); // 只生成 8/1 一条 2500

    await services.recurringRules.update(rule.id, { amount: 2600 });
    const updated = (await services.recurringRules.get(rule.id)) as RecurringRule;
    await generateDueBillsForRule(updated, at(2026, 9, 5, 12)); // 生成 9/1 一条 2600

    const aug = await bill(recurringBillId(rule.id, '2026-08-01', '09:00'));
    const sep = await bill(recurringBillId(rule.id, '2026-09-01', '09:00'));
    expect(aug?.amount).toBe(2500); // 历史不变
    expect(sep?.amount).toBe(2600); // 未来新值
  });

  it('REC-13 删除规则不删除已生成的历史 Bill，仅停止未来生成', async () => {
    const rule = await addRule({ frequency: 'monthly', day: 1, startDate: '2026-08-01', time: '09:00' });
    await generateDueBillsForRule(rule, at(2026, 9, 5, 12)); // 生成 8/1、9/1
    expect((await services.bills.list()).length).toBe(2);

    await services.recurringRules.remove(rule.id);
    const before = (await services.bills.list()).length;
    await generateDueBills(at(2026, 11, 1, 12)); // 删除后再跑，规则已不在
    expect((await services.bills.list()).length).toBe(before); // 一条不多删
    expect((await services.bills.get(recurringBillId(rule.id, '2026-08-01', '09:00')))).toBeTruthy();
  });
});

describe('REC-14 disabled 规则不生成', () => {
  beforeEach(resetDb);

  it('enabled=false 规则不产出任何 Bill', async () => {
    const rule = await addRule({ enabled: false, frequency: 'monthly', day: 1, startDate: '2026-08-01', time: '09:00' });
    const res = await generateDueBillsForRule(rule, at(2026, 9, 5, 12));
    expect(res.generated).toBe(0);
    expect((await services.bills.list()).length).toBe(0);
  });
});

describe('REC-15 生成 Bill 字段语义', () => {
  beforeEach(resetDb);

  it('source=recurring、recurringRuleId 正确、ledgerImpact=normal', async () => {
    const rule = await addRule({ frequency: 'monthly', day: 2, startDate: '2026-08-02', time: '09:00' });
    await generateDueBillsForRule(rule, at(2026, 8, 5, 12));
    const b = (await services.bills.list())[0];
    expect(b.source).toBe('recurring');
    expect(b.recurringRuleId).toBe(rule.id);
    expect(b.ledgerImpact).toBe('normal');
    expect(b.type).toBe('expense');
    expect(b.date).toBe('2026-08-02');
    expect(b.timestamp).toBeGreaterThan(0);
  });

  it('分类被删除后回退到内置「生活」分类，不崩溃', async () => {
    // 先用存在的分类建规则，再删该分类
    const rule = await addRule({ categoryId: 'c-food', frequency: 'monthly', day: 2, startDate: '2026-08-02', time: '09:00' });
    const db = await openDatabase();
    await db.delete('categories', 'c-food');
    await generateDueBillsForRule(rule, at(2026, 8, 5, 12));
    const b = (await services.bills.list())[0];
    expect(b.categoryId).toBe('c-life'); // 回退到生活
  });
});

describe('REC-16 生成后记账/统计立即可见', () => {
  beforeEach(resetDb);

  it('listByMonth 计入周期 Bill 金额（Accounting/Statistics 数据源）', async () => {
    const rule = await addRule({ frequency: 'daily', startDate: '2026-09-01', amount: 10, time: '09:00' });
    await generateDueBillsForRule(rule, at(2026, 9, 3, 12)); // 3 条：9/1,9/2,9/3
    const month = await services.bills.listByMonth('2026-09');
    expect(month.length).toBe(3);
    const total = month.reduce((s, b) => s + b.amount, 0);
    expect(total).toBe(30);
  });
});

describe('REC-17 本地时间 / DST 语义', () => {
  beforeEach(resetDb);

  it('「每天 09:00」按本地时刻到期判定，不因固定 24h 偏移', async () => {
    const rule = await addRule({ frequency: 'daily', startDate: '2026-08-20', time: '09:00' });
    // now = 8/20 08:59（还没到 09:00）→ 当天不生成，nextOccurrence 为当天
    const res = await generateDueBillsForRule(rule, at(2026, 8, 20, 8, 59));
    expect(res.generated).toBe(0);
    expect(res.nextOccurrence).toBe('2026-08-20');
    expect((await services.bills.list()).length).toBe(0);

    // now = 8/20 09:00 → 当天生成
    const res2 = await generateDueBillsForRule(rule, at(2026, 8, 20, 9, 0));
    expect(res2.generated).toBe(1);
  });
});

describe('REC-W01/W02 每周 weekday 实际生效', () => {
  beforeEach(resetDb);

  it('REC-W01 startDate周一 + 选周五 → 首次生成周五而不是周一', async () => {
    // 2026-08-24 是周一；rule.day=5 是周五
    const rule = await addRule({ frequency: 'weekly', day: 5, startDate: '2026-08-24', time: '09:00' });
    const now = at(2026, 9, 10, 12); // 首批周五 8/28、9/4 已到期；9/11 未到期
    const res = await generateDueBillsForRule(rule, now);
    const dates = (await services.bills.list()).map((b) => b.date).sort();
    expect(dates).toEqual(['2026-08-28', '2026-09-04']); // 首次是周五，不是周一
    expect(res.nextOccurrence).toBe('2026-09-11');
  });

  it('REC-W02 每 2 周周五（interval=2）', async () => {
    const rule = await addRule({ frequency: 'weekly', interval: 2, day: 5, startDate: '2026-08-24', time: '09:00' });
    const now = at(2026, 9, 20, 12); // 8/28、9/11 到期；9/25 未到期
    await generateDueBillsForRule(rule, now);
    const dates = (await services.bills.list()).map((b) => b.date).sort();
    expect(dates).toEqual(['2026-08-28', '2026-09-11']);
  });
});

describe('scheduleEffectiveAt 编辑只影响未来（EDIT-R01~R05）', () => {
  beforeEach(resetDb);

  it('EDIT-R01 修改时间 09:00→10:00，不重复生成今天/历史 Bill', async () => {
    const rule = await addRule({ frequency: 'monthly', day: 1, startDate: '2026-08-01', time: '09:00' });
    await generateDueBillsForRule(rule, at(2026, 9, 15, 12)); // 生成 8/1、9/1（09:00）

    // 9/20 编辑：时间改 10:00 → 生效边界 9/20
    await services.recurringRules.update(rule.id, { time: '10:00', scheduleEffectiveAt: at(2026, 9, 20, 0).getTime() });
    const updated = (await services.recurringRules.get(rule.id)) as RecurringRule;
    const res = await generateDueBillsForRule(updated, at(2026, 10, 5, 11));

    // 8/1、9/1 原 09:00 历史 Bill 保留；不再因 id 含 time 而按新 time 重生成 10:00；仅 10/1 10:00 为未来新 occurrence
    expect(res.generated).toBe(1);
    expect(await bill(recurringBillId(rule.id, '2026-08-01', '09:00'))).toBeTruthy();
    expect(await bill(recurringBillId(rule.id, '2026-09-01', '09:00'))).toBeTruthy();
    expect(await bill(recurringBillId(rule.id, '2026-08-01', '10:00'))).toBeUndefined(); // 历史不回填
    expect(await bill(recurringBillId(rule.id, '2026-09-01', '10:00'))).toBeUndefined(); // 历史不回填
    expect(await bill(recurringBillId(rule.id, '2026-10-01', '10:00'))).toBeTruthy(); // 未来新值
    expect((await services.bills.list()).length).toBe(3);
  });

  it('EDIT-R02 修改周一→周五，不补出编辑时间之前的周五', async () => {
    const rule = await addRule({ frequency: 'weekly', day: 1, startDate: '2026-08-24', time: '09:00' });
    await generateDueBillsForRule(rule, at(2026, 9, 10, 12)); // 周一：8/24、8/31、9/7

    // 9/5 编辑：改选周五 → 生效边界 9/5；此前已过去的周五(8/28、9/4)不回填
    await services.recurringRules.update(rule.id, { day: 5, scheduleEffectiveAt: at(2026, 9, 5, 0).getTime() });
    const updated = (await services.recurringRules.get(rule.id)) as RecurringRule;
    const res = await generateDueBillsForRule(updated, at(2026, 9, 12, 12));

    expect(res.generated).toBe(1); // 仅 9/11（周五，编辑之后）
    expect(await bill(recurringBillId(rule.id, '2026-08-28', '09:00'))).toBeUndefined(); // 编辑前周五不回填
    expect(await bill(recurringBillId(rule.id, '2026-09-04', '09:00'))).toBeUndefined(); // 编辑前周五不回填
    expect(await bill(recurringBillId(rule.id, '2026-09-11', '09:00'))).toBeTruthy(); // 编辑后周五生成
    // 历史周一 Bill 全部保留
    for (const d of ['2026-08-24', '2026-08-31', '2026-09-07']) {
      expect(await bill(recurringBillId(rule.id, d, '09:00'))).toBeTruthy();
    }
    expect((await services.bills.list()).length).toBe(4);
  });

  it('EDIT-R03 修改每月1日→15日，不补编辑日前已经过去的15日', async () => {
    const rule = await addRule({ frequency: 'monthly', day: 1, startDate: '2026-08-01', time: '09:00' });
    await generateDueBillsForRule(rule, at(2026, 10, 1, 12)); // 8/1、9/1、10/1

    // 9/20 编辑：每月1日→15日；此前已过去的 9/15 不回填
    await services.recurringRules.update(rule.id, { day: 15, scheduleEffectiveAt: at(2026, 9, 20, 0).getTime() });
    const updated = (await services.recurringRules.get(rule.id)) as RecurringRule;
    const res = await generateDueBillsForRule(updated, at(2026, 10, 20, 12));

    expect(res.generated).toBe(1); // 仅 10/15
    expect(await bill(recurringBillId(rule.id, '2026-09-15', '09:00'))).toBeUndefined(); // 编辑前 15 日不回填
    expect(await bill(recurringBillId(rule.id, '2026-10-15', '09:00'))).toBeTruthy(); // 编辑后生成
    for (const d of ['2026-08-01', '2026-09-01', '2026-10-01']) {
      expect(await bill(recurringBillId(rule.id, d, '09:00'))).toBeTruthy();
    }
    expect((await services.bills.list()).length).toBe(4);
  });

  it('EDIT-R04 修改 frequency 不改历史 Bill（daily 不回填编辑前每天）', async () => {
    const rule = await addRule({ frequency: 'monthly', day: 1, startDate: '2026-08-01', time: '09:00' });
    await generateDueBillsForRule(rule, at(2026, 9, 15, 12)); // 8/1、9/1

    // 9/10 编辑：改为每天 → 生效边界 9/10；9/2~9/9（过去）不回填
    await services.recurringRules.update(rule.id, {
      frequency: 'daily',
      interval: 1,
      scheduleEffectiveAt: at(2026, 9, 10, 0).getTime(),
    });
    const updated = (await services.recurringRules.get(rule.id)) as RecurringRule;
    const res = await generateDueBillsForRule(updated, at(2026, 9, 18, 12));

    // 历史 8/1、9/1 保留；9/3 未回填；9/12 新生成
    expect(await bill(recurringBillId(rule.id, '2026-08-01', '09:00'))).toBeTruthy();
    expect(await bill(recurringBillId(rule.id, '2026-09-01', '09:00'))).toBeTruthy();
    expect(await bill(recurringBillId(rule.id, '2026-09-03', '09:00'))).toBeUndefined(); // 编辑前不回填
    expect(await bill(recurringBillId(rule.id, '2026-09-12', '09:00'))).toBeTruthy(); // 编辑后生成
    expect(res.generated).toBe(9); // 9/10..9/18 九天
  });

  it('EDIT-R05 修改金额只影响未来', async () => {
    const rule = await addRule({ frequency: 'monthly', day: 1, startDate: '2026-08-01', amount: 100, time: '09:00' });
    await generateDueBillsForRule(rule, at(2026, 8, 5, 12)); // 8/1 金额 100

    await services.recurringRules.update(rule.id, { amount: 200, scheduleEffectiveAt: at(2026, 8, 10, 0).getTime() });
    const updated = (await services.recurringRules.get(rule.id)) as RecurringRule;
    await generateDueBillsForRule(updated, at(2026, 9, 5, 12)); // 生成 9/1（金额应为 200）

    expect((await bill(recurringBillId(rule.id, '2026-08-01', '09:00')))?.amount).toBe(100); // 历史不变
    expect((await bill(recurringBillId(rule.id, '2026-09-01', '09:00')))?.amount).toBe(200); // 未来新值
  });
});

describe('REC-18 多年 daily backlog 分批补齐，游标逐批推进且不重复', () => {
  beforeEach(resetDb);

  it('3 年 backlog：run1≤365 → run2 继续 → 多轮最终追到 now，全程不重复', async () => {
    const start = '2023-09-01';
    const rule = await addRule({ frequency: 'daily', startDate: start, time: '09:00' });
    const now = at(2026, 8, 24, 12);
    const totalExpected = dayNumber('2026-08-24') - dayNumber(start) + 1;

    let totalGenerated = 0;
    let round = 0;
    let last: Awaited<ReturnType<typeof generateDueBillsForRule>>;
    do {
      const current = (await services.recurringRules.get(rule.id)) as RecurringRule;
      last = await generateDueBillsForRule(current, now);
      totalGenerated += last.generated;
      round += 1;
      expect(last.generated).toBeLessThanOrEqual(MAX_CATCHUP_PER_RULE); // 单轮不超上限
      expect(round).toBeLessThanOrEqual(10); // 防御死循环
    } while (last.diagnosed);

    // 全程补完，无重复
    expect(totalGenerated).toBe(totalExpected);
    const bills = await services.bills.list();
    expect(bills.length).toBe(totalExpected);
    const ids = bills.map((b) => b.id);
    expect(new Set(ids).size).toBe(ids.length); // 每个 id 唯一 → 无重复生成
  });
});

describe('REC-LEGACY 兼容旧 Weekly 非法 day（Phase 7A-Fix2）', () => {
  beforeEach(resetDb);

  it('REC-LEGACY-01 weekly day=24 视为非法，generateDueBills 后持久化修复为 startDate weekday（0-6）', async () => {
    // 2026-08-24 是周一（weekday=1）；旧数据写入 day=24（非法）
    const rule = await addRule({ frequency: 'weekly', day: 24, startDate: '2026-08-24', time: '09:00' });
    expect(isWeeklyDayInvalid(rule)).toBe(true);

    // 触发一次全量生成（会先读取时规范化并持久化修复）
    await generateDueBills(at(2026, 9, 1, 12));
    const fixed = (await services.recurringRules.get(rule.id)) as RecurringRule;
    expect(fixed.day).toBe(1); // 回退到 startDate 对应的周一，且已在 0-6
    expect(fixed.day).toBeGreaterThanOrEqual(0);
    expect(fixed.day).toBeLessThanOrEqual(6);
    expect(isWeeklyDayInvalid(fixed)).toBe(false);
  });

  it('REC-LEGACY-02 normalized 规则生成的日期符合旧 startDate 每 7 天节奏', async () => {
    // 旧 generator 长期按「startDate 起的每 7 天」执行；非法 day 归一化到 startDate weekday 后应还原该节奏
    await addRule({ frequency: 'weekly', day: 24, startDate: '2026-08-24', time: '09:00' });
    await generateDueBills(at(2026, 9, 15, 12));
    const dates = (await services.bills.list()).map((b) => b.date).sort();
    // 归一化到周一后：8/24、8/31、9/7、9/14（= 旧 startDate 每 7 天节奏）
    expect(dates).toEqual(['2026-08-24', '2026-08-31', '2026-09-07', '2026-09-14']);
  });
});

describe('REC-RERUN 并发触发不丢（Phase 7A-Fix3 → 7B-0 drain Promise）', () => {
  beforeEach(resetDb);

  it('REC-RERUN-01 generator 运行中新增 due 规则 → 首轮后自动第二轮并生成新规则 Bill', async () => {
    await addRule({ frequency: 'daily', startDate: '2026-08-01', time: '09:00', amount: 10 });
    const now = at(2026, 8, 20, 12);
    const p1 = runRecurringGeneration(now); // 创建 runningPromise，开始首轮
    const p2 = runRecurringGeneration(now); // 同一 drain Promise，置 rerunRequested=true
    expect(p2).toBe(p1); // 并发调用返回同一 drain Promise，不返回 null
    // 首轮运行期间新建一条已到期规则
    const rule2 = await addRule({ frequency: 'daily', startDate: '2026-08-19', time: '09:00', amount: 50 });
    await p1;
    // 新规则 Bill 必须由第二轮（rerun）生成，不得被 running 分支丢请求
    const b = await bill(recurringBillId(rule2.id, '2026-08-19', '09:00'));
    expect(b).toBeDefined();
    expect(b).toMatchObject({ amount: 50, source: 'recurring', recurringRuleId: rule2.id });
  });

  it('REC-RERUN-02 连续触发 5 次不并发、不重复 Bill、最终状态正确', async () => {
    const rule = await addRule({ frequency: 'daily', startDate: '2026-08-01', time: '09:00', amount: 100 });
    const now = at(2026, 8, 20, 12);
    const proms = Array.from({ length: 5 }, () => runRecurringGeneration(now));
    expect(new Set(proms).size).toBe(1); // 全部同一 drain Promise
    await Promise.all(proms);
    const related = (await services.bills.list()).filter((b) => b.recurringRuleId === rule.id);
    // 每天 09:00 一条：08-01 ~ 08-20（含 08-20 当天 09:00<12:00）共 20 条
    expect(related).toHaveLength(20);
    const dates = related.map((b) => b.date);
    expect(new Set(dates).size).toBe(dates.length); // 无重复日期 → 5 次触发不产生重复 Bill
  });

  it('REC-RERUN-03 第二轮执行期间再次 trigger 仍不丢请求', async () => {
    await addRule({ frequency: 'daily', startDate: '2026-08-01', time: '09:00', amount: 10 });
    const now = at(2026, 8, 20, 12);
    const p1 = runRecurringGeneration(now); // 首轮
    // 首轮期间连续多次 trigger（均返回同一 drain Promise）→ 折叠为 rerun
    runRecurringGeneration(now);
    runRecurringGeneration(now);
    runRecurringGeneration(now); // 第二轮期间再 trigger
    const rule2 = await addRule({ frequency: 'daily', startDate: '2026-08-19', time: '09:00', amount: 50 });
    await p1;
    const b = await bill(recurringBillId(rule2.id, '2026-08-19', '09:00'));
    expect(b).toBeDefined();
  });
});

describe('RUN drain Promise 语义（Phase 7B-0）', () => {
  beforeEach(resetDb);

  it('RUN-01 两个并发调用最终 await 同一 drain', async () => {
    await addRule({ frequency: 'daily', startDate: '2026-08-01', time: '09:00', amount: 10 });
    const now = at(2026, 8, 20, 12);
    const p1 = runRecurringGeneration(now);
    const p2 = runRecurringGeneration(now);
    expect(p2).toBe(p1);
    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1).toBe(r2);
    expect(r1.totalGenerated).toBe(20);
    expect(r1).not.toBeNull();
  });

  it('RUN-02 第二调用 await 结束时新规则 Bill 已存在', async () => {
    await addRule({ frequency: 'daily', startDate: '2026-08-01', time: '09:00', amount: 10 });
    const now = at(2026, 8, 20, 12);
    runRecurringGeneration(now); // 首轮开始
    const p2 = runRecurringGeneration(now); // 第二调用，返回同一 drain Promise
    const rule2 = await addRule({ frequency: 'daily', startDate: '2026-08-19', time: '09:00', amount: 50 });
    const result = await p2;
    expect(result.totalGenerated).toBeGreaterThanOrEqual(21);
    const b = await bill(recurringBillId(rule2.id, '2026-08-19', '09:00'));
    expect(b).toBeDefined();
    expect(b?.amount).toBe(50);
  });

  it('RUN-03 5 次触发不并发、不重复、不提前 resolve', async () => {
    const rule = await addRule({ frequency: 'daily', startDate: '2026-08-01', time: '09:00', amount: 100 });
    const now = at(2026, 8, 20, 12);
    const proms = Array.from({ length: 5 }, () => runRecurringGeneration(now));
    expect(new Set(proms).size).toBe(1);
    const result = await Promise.all(proms);
    const related = (await services.bills.list()).filter((b) => b.recurringRuleId === rule.id);
    expect(related).toHaveLength(20);
    expect(result[0].totalGenerated).toBe(20);
  });

  it('RUN-04 totalGenerated 累计正确（多轮 drain 累加）', async () => {
    await addRule({ frequency: 'daily', startDate: '2026-08-01', time: '09:00', amount: 10 });
    const now = at(2026, 8, 20, 12);
    const p1 = runRecurringGeneration(now);
    runRecurringGeneration(now); // 触发 rerun
    await addRule({ frequency: 'daily', startDate: '2026-08-19', time: '09:00', amount: 50 });
    const result = await p1;
    // 第一轮：rule1 生成 20 条 → totalGenerated=20
    // 第二轮：rule2 生成 2 条（08-19、08-20 均已到期）→ 累计 totalGenerated=22
    expect(result.totalGenerated).toBe(22);
    expect(result.diagnostics).toHaveLength(2);
  });
});

describe('REC-SAN 规则输入统一 sanitize（Phase 7A-Fix3）', () => {
  it('REC-SAN-01 interval 非法值规范化到 1..999', () => {
    expect(sanitizeRecurringRule({ ...baseRule(), interval: 0 }).interval).toBe(1);
    expect(sanitizeRecurringRule({ ...baseRule(), interval: -5 }).interval).toBe(1);
    expect(sanitizeRecurringRule({ ...baseRule(), interval: 1000 }).interval).toBe(999);
    expect(sanitizeRecurringRule({ ...baseRule(), interval: Number.NaN }).interval).toBe(1);
    expect(sanitizeRecurringRule({ ...baseRule(), interval: 7.6 }).interval).toBe(8);
    expect(sanitizeRecurringRule({ ...baseRule(), interval: 3 }).interval).toBe(3);
  });

  it('REC-SAN-02 weekly 非法 day 回退 startDate weekday（0-6）', () => {
    // 2026-08-03 = 周一；day=24/99 非法 → 回退到 startDate weekday
    const fallback = new Date(2026, 7, 3).getDay();
    expect(sanitizeRecurringRule({ ...baseRule(), frequency: 'weekly', day: 24, startDate: '2026-08-03' }).day).toBe(fallback);
    expect(sanitizeRecurringRule({ ...baseRule(), frequency: 'weekly', day: 99, startDate: '2026-08-03' }).day).toBe(fallback);
    // 合法 weekday 原样保留
    expect(sanitizeRecurringRule({ ...baseRule(), frequency: 'weekly', day: 5, startDate: '2026-08-03' }).day).toBe(5);
  });

  it('REC-SAN-03 monthly day 0/32 规范化到 1-31', () => {
    expect(sanitizeRecurringRule({ ...baseRule(), frequency: 'monthly', day: 0 }).day).toBe(1);
    expect(sanitizeRecurringRule({ ...baseRule(), frequency: 'monthly', day: 32 }).day).toBe(31);
    expect(sanitizeRecurringRule({ ...baseRule(), frequency: 'monthly', day: 15 }).day).toBe(15);
  });

  it('REC-SAN-04 yearly month/day 非法规范化（1-12 / 1-31）', () => {
    const a = sanitizeRecurringRule({ ...baseRule(), frequency: 'yearly', month: 13, day: 0 });
    expect(a.month).toBe(12);
    expect(a.day).toBe(1);
    const b = sanitizeRecurringRule({ ...baseRule(), frequency: 'yearly', month: 0, day: 32 });
    expect(b.month).toBe(1);
    expect(b.day).toBe(31);
    const c = sanitizeRecurringRule({ ...baseRule(), frequency: 'yearly', month: undefined, day: 5 });
    expect(c.month).toBeUndefined();
    expect(c.day).toBe(5);
  });

  it('REC-SAN-05 非法 time 拒绝/规范化到 00:00，合法保持不变', () => {
    expect(sanitizeRecurringRule({ ...baseRule(), time: '09:00' }).time).toBe('09:00');
    expect(sanitizeRecurringRule({ ...baseRule(), time: '23:59' }).time).toBe('23:59');
    expect(sanitizeRecurringRule({ ...baseRule(), time: '25:99' }).time).toBe('00:00');
    expect(sanitizeRecurringRule({ ...baseRule(), time: '9:0' }).time).toBe('00:00');
    expect(sanitizeRecurringRule({ ...baseRule(), time: 'abc' }).time).toBe('00:00');
  });

  it('REC-SAN-06 enabled 非 boolean → 安全默认 false；非法字段不产出非法业务日期（day=0 防御）', async () => {
    await resetDb();
    expect(sanitizeRecurringRule({ ...baseRule(), enabled: 'yes' as unknown as boolean }).enabled).toBe(false);
    expect(sanitizeRecurringRule({ ...baseRule(), enabled: true }).enabled).toBe(true);
    // generator 防御：monthly day=0（本应月首）经 clampDay 下限保护不会生成 2026-xx-00
    await addRule({ frequency: 'monthly', day: 0, startDate: '2026-08-01', time: '09:00' });
    await generateDueBills(at(2026, 9, 1, 12));
    const dates = (await services.bills.list()).map((b) => b.date);
    expect(dates).not.toContain('2026-08-00');
    expect(dates).not.toContain('2026-09-00');
  });
});

describe('REC-DEL-01 已删除周期账单不复活（2.9.9）', () => {
  beforeEach(resetDb);

  it('删除已生成的周期 Bill 后 resume 再生成：该 Bill 不复活，后续 occurrence 仍正常生成', async () => {
    const rule = await addRule({ frequency: 'daily', startDate: '2026-08-20', time: '09:00' });
    const res1 = await generateDueBillsForRule(rule, at(2026, 8, 24, 12));
    expect(res1.generated).toBe(5); // 8/20..8/24

    // 用户手动删除最后一笔历史周期账单（8/24）
    const deletedId = recurringBillId(rule.id, '2026-08-24', '09:00');
    await services.bills.remove(deletedId);
    expect(await bill(deletedId)).toBeUndefined();

    // 模拟真实 resume：generateDueBills 每次从 DB 拉取最新规则（游标 lastGeneratedDate 已写库），时间推进到 8/26
    await generateDueBills(at(2026, 8, 26, 12));

    // 关键断言：被删除的 8/24 不得复活（lastGeneratedDate 已覆盖它）
    expect(await bill(deletedId)).toBeUndefined();
    // 8/25、8/26 的下一次 occurrence 仍正常生成
    for (const d of [25, 26]) {
      const b = await bill(recurringBillId(rule.id, `2026-08-${d}`, '09:00'));
      expect(b?.date, `2026-08-${d}`).toBe(`2026-08-${d}`);
    }
  });

  it('新规则没有 lastGeneratedDate：startDate 首次 generation 仍正常补齐（游标语义不阻塞首次）', async () => {
    const rule = await addRule({ frequency: 'daily', startDate: '2026-08-20', time: '09:00' });
    const res = await generateDueBillsForRule(rule, at(2026, 8, 22, 12));
    expect(res.generated).toBe(3); // 8/20/21/22
    for (const d of [20, 21, 22]) {
      expect(await bill(recurringBillId(rule.id, `2026-08-${d}`, '09:00'))).toBeDefined();
    }
  });
});