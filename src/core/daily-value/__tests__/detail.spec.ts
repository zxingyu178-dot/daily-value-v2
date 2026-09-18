/**
 * 2.20.0 Gate B 测试（DV-DETAIL / DV-CURVE / DV-MILESTONE / DV-PRICE-MILESTONE）
 * 页面级（ROUTE/EDIT/MISSING）见 daily-value-detail-page.spec.ts。
 */
import { describe, expect, it } from 'vitest';
import type { Bill } from '@/core/models/types';
import {
  buildDailyValueCurve,
  buildMilestoneSummary,
  computeDailyPriceMilestones,
  computeDailyValueDetail,
  computeUsageMilestones,
  nextPriceMilestone,
  utcDayDiff,
} from '@/core/daily-value/detail';

function makeBills(): Bill[] {
  // MacBook：6088 元，2025-10-26 起算；以 today 2026-09-17 计算 elapsed=326（10-26 起 ~ 9-17）
  const bills: Bill[] = [
    {
      id: 'dv-mac',
      type: 'expense',
      amount: 6088,
      categoryId: 'c-shopping',
      categoryEmoji: '💻',
      categoryName: '购物',
      title: 'MacBook Pro',
      note: '',
      date: '2025-10-26',
      timestamp: 0,
      source: 'manual',
      ledgerImpact: 'daily-value-only',
      dailyValue: { enabled: true, mode: 'elapsed', startDate: '2025-10-26' },
    },
    // 普通账单未开启日价（不应产生详情）
    {
      id: 'plain',
      type: 'expense',
      amount: 25,
      categoryId: 'c-food',
      categoryEmoji: '☕',
      categoryName: '餐饮',
      title: '咖啡',
      note: '',
      date: '2026-09-01',
      timestamp: 0,
      source: 'manual',
      ledgerImpact: 'normal',
    },
  ];
  return bills;
}
const TODAY = '2026-09-17';
const [MAC, PLAIN] = makeBills();

describe('DV-DETAIL-01：当前日价计算', () => {
  it('computeDailyValueDetail 返回 elapsed 与 current=amount/elapsed', () => {
    const detail = computeDailyValueDetail(MAC, TODAY);
    expect(detail.ok).toBe(true);
    expect(detail.name).toBe('MacBook Pro');
    const elapsed = utcDayDiff(MAC.dailyValue!.startDate, TODAY);
    expect(detail.elapsed).toBe(Math.max(1, elapsed));
    expect(detail.current).toBeCloseTo(detail.amount / detail.elapsed, 4);
  });

  it('dailyValue 未启用 → ok=false（不渲染详情）', () => {
    const detail = computeDailyValueDetail(PLAIN, TODAY);
    expect(detail.ok).toBe(false);
    expect(detail.current).toBe(0);
  });

  it('Bill 缺失 / 未来 startDate（脏数据）→ 安全返回', () => {
    expect(computeDailyValueDetail(undefined, TODAY).ok).toBe(false);
    const future = {
      ...MAC,
      id: 'dv-future',
      dailyValue: { enabled: true, mode: 'elapsed' as const, startDate: '2027-01-01' },
    };
    const d = computeDailyValueDetail(future, TODAY);
    expect(d.ok).toBe(true);
    expect(d.elapsed).toBeGreaterThanOrEqual(1); // 未来起算也安全（不 NaN）
    expect(Number.isFinite(d.current)).toBe(true);
  });

  it('amount = 0 → current = 0（安全）', () => {
    const zero = { ...MAC, id: 'dv-zero', amount: 0 };
    const d = computeDailyValueDetail(zero, TODAY);
    expect(d.ok).toBe(true);
    expect(d.current).toBe(0);
  });
});

describe('DV-CURVE-01/02：第 1 天与今天必含', () => {
  it('短周期（<=100 天）逐日；首尾包含（今天 = 第 elapsed 天，与 v1 一致）', () => {
    const bill = { ...MAC, id: 'dv-short', dailyValue: { enabled: true, mode: 'elapsed' as const, startDate: '2026-08-01' } };
    const curve = buildDailyValueCurve(bill, '2026-08-10');
    // 8-01 起、8-10 今天：elapsed = 9（不含起始日），曲线 [第1天 .. 第9天]
    expect(curve.length).toBe(9);
    expect(curve[0].day).toBe(1);
    expect(curve[0].value).toBe(bill.amount); // 第 1 天 = 原价
    expect(curve[curve.length - 1].day).toBe(9);
    expect(curve[curve.length - 1].date).toBe('2026-08-09');
  });

  it('今天（同一购买日）只有 1 个点且 value=amount', () => {
    const curve = buildDailyValueCurve(MAC, MAC.dailyValue!.startDate);
    expect(curve.length).toBeGreaterThanOrEqual(1);
    expect(curve[0].day).toBe(1);
    expect(curve[0].value).toBe(MAC.amount);
  });
});

describe('DV-CURVE-03：长周期最大采样数量', () => {
  it('1400 天（近 4 年）点数量 <= 约定上限 + 里程碑', () => {
    const long = {
      ...MAC,
      id: 'dv-long',
      dailyValue: { enabled: true, mode: 'elapsed' as const, startDate: '2022-09-01' },
    };
    const elapsed = utcDayDiff('2022-09-01', TODAY);
    expect(elapsed).toBeGreaterThan(1400);
    const curve = buildDailyValueCurve(long, TODAY);
    expect(curve.length).toBeLessThanOrEqual(120);
    expect(curve.length).toBeGreaterThan(0);
    expect(curve[0].day).toBe(1);
    expect(curve[curve.length - 1].day).toBe(elapsed);
  });
});

describe('DV-CURVE-04：曲线单调不增', () => {
  it('value = amount/day 严格单调不增（相同 day 去重后必然递减或相等）', () => {
    const curve = buildDailyValueCurve(MAC, TODAY);
    for (let i = 1; i < curve.length; i++) {
      expect(curve[i].value).toBeLessThanOrEqual(curve[i - 1].value);
    }
    // 首值 6088，末值 = 当前日价（2 位小数容差）
    expect(curve[0].value).toBe(6088);
    expect(curve[curve.length - 1].value).toBeCloseTo(MAC.amount / utcDayDiff(MAC.dailyValue!.startDate, TODAY), 2);
  });
});

describe('DV-MILESTONE-01/02/03：使用时间里程碑', () => {
  it('7/30/100/365 节点存在；低天数窗口只含未达成的', () => {
    // 使用 10 天：节点含 7（达成）、30/100/365（未达成），不含超窗口
    const days10 = computeUsageMilestones('2026-09-07', '2026-09-17');
    const seven = days10.find((m) => m.target === 7);
    expect(seven?.achieved).toBe(true);
    const thirty = days10.find((m) => m.target === 30);
    expect(thirty?.achieved).toBe(false);
    expect(thirty?.remaining).toBe(20);
    // 使用 327 天：7/30/100/365 全在窗口；100 达成、365 未达成差 38 天
    const days327 = computeUsageMilestones(MAC.dailyValue!.startDate, TODAY);
    const h100 = days327.find((m) => m.target === 100);
    expect(h100?.achieved).toBe(true);
    const y365 = days327.find((m) => m.target === 365);
    expect(y365).toBeDefined();
    expect(y365!.achieved).toBe(false);
    expect(y365!.remaining).toBe(365 - utcDayDiff(MAC.dailyValue!.startDate, TODAY));
  });
});

describe('DV-PRICE-MILESTONE-01：amount/target → requiredDays', () => {
  it('6088 → 100(61)/50(122)/20(305)/10(609) 前 4 个节点', () => {
    const elapsed = utcDayDiff('2025-10-26', TODAY); // 327
    const ms = computeDailyPriceMilestones(6088, elapsed);
    expect(ms.length).toBe(4);
    expect(ms[0]).toMatchObject({ target: 100, requiredDays: 61, achieved: true });
    expect(ms[1]).toMatchObject({ target: 50, requiredDays: 122, achieved: true });
    expect(ms[2]).toMatchObject({ target: 20, requiredDays: 305, achieved: true });
    expect(ms[3]).toMatchObject({ target: 10, requiredDays: 609, achieved: false, remainingDays: Math.max(0, 609 - elapsed) });
  });

  it('金额 < 100：只取 <= 原价的节点；amount<=0 → 空', () => {
    const small = computeDailyPriceMilestones(60, 10);
    expect(small.length).toBeGreaterThan(0);
    expect(small.every((m) => m.target <= 60)).toBe(true);
    expect(computeDailyPriceMilestones(0, 10)).toEqual([]);
    expect(computeDailyPriceMilestones(-5, 10)).toEqual([]);
  });

  it('nextPriceMilestone 返回第一个未达成；全部达成 → undefined', () => {
    const notAll = computeDailyPriceMilestones(100000, 999999);
    expect(nextPriceMilestone(notAll)).toBeUndefined();
    const some = computeDailyPriceMilestones(6088, 100);
    expect(nextPriceMilestone(some)?.target).toBe(50); // 100→61 达成；50→122 未达成 → 下一站
  });

  it('buildMilestoneSummary 输出「已达成 + 下一站」纯事实文案', () => {
    const detail = computeDailyValueDetail(MAC, TODAY);
    const ms = computeDailyPriceMilestones(MAC.amount, detail.elapsed);
    const summary = buildMilestoneSummary(detail, ms);
    expect(summary).not.toBeNull();
    expect(summary!.achievedText).toContain('已使用');
    // 已达成最小值（¥20）作为当前位置；下一站 ¥10
    expect(summary!.achievedText).toContain('¥20/天以内');
    expect(summary!.nextText).toContain('¥10/天');
  });
});