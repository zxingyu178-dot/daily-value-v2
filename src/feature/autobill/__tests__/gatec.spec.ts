/**
 * 2.16.1 Gate C 测试：
 * - 支付宝 Parser 示例 1/2/3（无金额不建候选 / 0.01元支出 MEDIUM / 星巴克¥35 HIGH+餐饮）
 * - ParserRegistry 路由（包名 → Parser；未知/占位 → 不建候选）
 * - 去重双保险：10 分钟近邻合并（付款成功/交易完成不同文案 = 同一笔）
 * - AutoBillSyncService：Native Queue → 解析 → 候选（总开关/解析失败/幂等）
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { openDatabase } from '@/core/db/database';
import { IdbAutoBillService, IdbBillService, IdbCategoryService, IdbSettingsService } from '@/core/services/idb';
import { AlipayParser } from '@/feature/autobill/parser/AlipayParser';
import { parserForPackage } from '@/feature/autobill/parser/registry';
import { NEAR_DEDUPE_WINDOW_MS } from '@/feature/autobill/service/candidate';

const TEST_STORES = ['bills', 'categories', 'settings', 'meta', 'recurringRules', 'autoBillCandidates'] as const;

async function resetDb(): Promise<void> {
  const db = await openDatabase();
  const tx = db.transaction(TEST_STORES, 'readwrite');
  for (const store of TEST_STORES) tx.objectStore(store).clear();
  await tx.done;
}

async function seedCategory(): Promise<void> {
  const catSvc = new IdbCategoryService();
  if ((await catSvc.list()).length === 0) {
    await catSvc.add({ name: '餐饮', emoji: '🍚', builtin: true, sort: 1 });
  }
}

const T0 = new Date('2026-09-15T10:00:00+08:00').getTime();

describe('TASK-2161: 支付宝 Parser（示例 1/2/3）', () => {
  it('示例1 交易提醒 0.01元支出 → MEDIUM expense，无商户', () => {
    const parsed = new AlipayParser().parse({
      packageName: 'com.eg.android.AlipayGphone',
      title: '交易提醒',
      text: '你有一笔0.01元的支出',
      bigText: '',
      subText: '',
      postTime: T0,
    })!;
    expect(parsed.type).toBe('expense');
    expect(parsed.amount).toBe(0.01);
    expect(parsed.merchant).toBeUndefined();
    expect(parsed.confidence).toBe('MEDIUM');
    expect(parsed.source).toBe('alipay');
  });

  it('示例2 付款成功 星巴克 ¥35 → HIGH expense + 餐饮分类', () => {
    const parsed = new AlipayParser().parse({
      packageName: 'com.eg.android.AlipayGphone',
      title: '付款成功',
      text: '星巴克',
      bigText: '¥35',
      subText: '',
      postTime: T0,
    })!;
    expect(parsed.amount).toBe(35);
    expect(parsed.merchant).toBe('星巴克');
    expect(parsed.confidence).toBe('HIGH');
    expect(parsed.suggestCategoryId).toBe('c-food'); // 星巴克 → 餐饮
  });

  it('示例3 积分提醒（无金额）→ null，不生成账单', () => {
    const parsed = new AlipayParser().parse({
      packageName: 'com.eg.android.AlipayGphone',
      title: '支付宝积分提醒',
      text: '您的积分即将过期，快去使用吧',
      bigText: '',
      subText: '',
      postTime: T0,
    });
    expect(parsed).toBeNull();
  });
});

describe('TASK-2161: ParserRegistry 路由', () => {
  it('支付宝包名 → AlipayParser；微信包名 → WechatParser（占位 null）', () => {
    expect(parserForPackage('com.eg.android.AlipayGphone')?.source).toBe('alipay');
    const wechat = parserForPackage('com.tencent.mm');
    expect(wechat?.source).toBe('wechat');
    expect(
      wechat?.parse({ packageName: 'com.tencent.mm', title: '微信支付', text: '收款 10元', bigText: '', subText: '', postTime: T0 }),
    ).toBeNull(); // Gate C 占位：微信暂不建候选
    expect(parserForPackage('com.example.evil')).toBeNull();
  });
});

describe('TASK-2161: 去重双保险（10 分钟近邻合并）', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it('同源同额同商户 5 分钟内（不同文案）→ 合并为 1 候选；15 分钟后 → 新候选', async () => {
    const svc = new IdbAutoBillService();
    const a = await svc.ingest({ sourceApp: '支付宝', rawText: '付款成功 星巴克 ¥35', postedAt: T0 });
    expect(a.created).toBe(true);
    // 5 分钟后「交易完成」不同文案：hash 不同 → 近邻去重合并
    const b = await svc.ingest({ sourceApp: '支付宝', rawText: '交易完成 星巴克 35元', postedAt: T0 + 5 * 60_000 });
    expect(b.duplicate).toBe(true);
    expect(b.candidateId).toBe(a.candidateId);
    expect(await svc.countWaitConfirm()).toBe(1);
    // 15 分钟后第三种文案：超近邻窗口 → 新候选
    const c = await svc.ingest({ sourceApp: '支付宝', rawText: '商户通知 星巴克 支付35元', postedAt: T0 + 15 * 60_000 });
    expect(c.created).toBe(true);
    expect(await svc.countWaitConfirm()).toBe(2);
  });

  it('近邻窗口常量 = 10 分钟', () => {
    expect(NEAR_DEDUPE_WINDOW_MS).toBe(10 * 60 * 1000);
  });
});

describe('TASK-2161: AutoBillSyncService（Native Queue → Parser → 候选）', () => {
  beforeEach(async () => {
    await resetDb();
    await seedCategory();
    await new IdbSettingsService().update({ autoBillEnabled: true });
  });

  it('开启总开关：支付宝真实通知 → 生成待确认候选；解析失败不建；重复不重复建', async () => {
    const { syncAutoBillNotifications } = await import('@/feature/autobill/service/sync-service');
    const bridge = await import('@/feature/autobill/service/notification-bridge');

    // 模拟 Native Pending：一条可解析 + 一条积分提醒（无金额）
    const pullSpy = vi
      .spyOn(bridge, 'pullPendingNativeNotifications')
      .mockResolvedValueOnce([
        {
          id: 'n1',
          packageName: 'com.eg.android.AlipayGphone',
          postTime: T0,
          capturedAt: T0,
          title: '付款成功',
          text: '星巴克',
          bigText: '¥35',
          subText: '',
        },
        {
          id: 'n2',
          packageName: 'com.eg.android.AlipayGphone',
          postTime: T0,
          capturedAt: T0,
          title: '支付宝积分提醒',
          text: '积分即将过期',
          bigText: '',
          subText: '',
        },
      ])
      .mockResolvedValueOnce([]); // 第二次同步：无新消息
    const ackSpy = vi.spyOn(bridge, 'ackPendingNativeNotifications').mockResolvedValue(undefined);

    const s1 = await syncAutoBillNotifications();
    expect(s1.received).toBe(2);
    expect(s1.created).toBe(1); // 积分提醒被跳过
    expect(s1.skipped).toBe(1);
    expect(ackSpy).toHaveBeenCalledWith(['n1', 'n2']); // 无论是否生成，处理完即 ack

    const candidates = await new IdbAutoBillService().listCandidates('WAIT_CONFIRM');
    expect(candidates).toHaveLength(1);
    expect(candidates[0].amount).toBe(35);
    expect(candidates[0].merchant).toBe('星巴克');
    expect(candidates[0].confidence).toBe('HIGH');

    // 第二次同步无新消息：不再创建
    const s2 = await syncAutoBillNotifications();
    expect(s2.received).toBe(0);
    expect(await new IdbAutoBillService().countWaitConfirm()).toBe(1);
    expect(await new IdbBillService().list()).toHaveLength(0); // 未确认不进账本

    pullSpy.mockRestore();
    ackSpy.mockRestore();
  });

  it('总开关关闭：不拉取、不创建', async () => {
    await new IdbSettingsService().update({ autoBillEnabled: false });
    const { syncAutoBillNotifications } = await import('@/feature/autobill/service/sync-service');
    const bridge = await import('@/feature/autobill/service/notification-bridge');
    const pullSpy = vi.spyOn(bridge, 'pullPendingNativeNotifications').mockResolvedValue([{
      id: 'x', packageName: 'com.eg.android.AlipayGphone', postTime: T0, capturedAt: T0, title: 't', text: '支付 10元', bigText: '', subText: '',
    }]);
    const s = await syncAutoBillNotifications();
    expect(s.received).toBe(0);
    expect(pullSpy).not.toHaveBeenCalled();
    expect(await new IdbAutoBillService().countWaitConfirm()).toBe(0);
    pullSpy.mockRestore();
  });
});