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
import { WechatParser } from '@/feature/autobill/parser/WechatParser';
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

  it('2.16.6 样本1 真实通知「0.01元支出 + 点击领取积分」→ MEDIUM expense，商户不误判为 积分/点击', () => {
    const parsed = new AlipayParser().parse({
      packageName: 'com.eg.android.AlipayGphone',
      title: '交易提醒',
      text: '你有一笔0.01元的支出\n点击领取2个支付宝积分',
      bigText: '',
      subText: '',
      postTime: T0,
    })!;
    expect(parsed.amount).toBe(0.01);
    expect(parsed.type).toBe('expense');
    expect(parsed.merchant).toBeUndefined(); // 不再把「积分 / 点击领取」当商户
    expect(parsed.confidence).toBe('MEDIUM'); // 无交易语义锚点，不升 HIGH
    expect(parsed.source).toBe('alipay');
  });

  it('2.16.6 样本2 普通消费「您在瑞幸咖啡消费 23.50元」→ HIGH，商户 瑞幸咖啡 != 整段句子', () => {
    const parsed = new AlipayParser().parse({
      packageName: 'com.eg.android.AlipayGphone',
      title: '消费提示',
      text: '您在瑞幸咖啡消费了 23.50元',
      bigText: '',
      subText: '',
      postTime: T0,
    })!;
    expect(parsed.amount).toBe(23.5);
    expect(parsed.type).toBe('expense');
    expect(parsed.merchant).toBe('瑞幸咖啡'); // 剥离「消费了」尾缀与功能字
    expect(parsed.confidence).toBe('HIGH'); // 存在「消费」交易语义锚点
    expect(parsed.suggestCategoryId).toBe('c-food');
  });
});

describe('TASK-2161/2.17.0: ParserRegistry 路由（经 Source Registry）', () => {
  it('支付宝包名 → AlipayParser；微信包名 → WechatParser；未知包名 → null', () => {
    expect(parserForPackage('com.eg.android.AlipayGphone')?.source).toBe('alipay');
    expect(parserForPackage('com.tencent.mm')?.source).toBe('wechat');
    expect(parserForPackage('com.example.evil')).toBeNull();
  });

  it('2.17.0 普通聊天「帮我支付20元」→ WechatParser 返回 null（不误抓聊天）', () => {
    const wechat = parserForPackage('com.tencent.mm')!;
    expect(
      wechat.parse({ packageName: 'com.tencent.mm', title: '小红', text: '帮我支付20元', bigText: '', subText: '', postTime: T0 }),
    ).toBeNull();
  });
});

describe('2.17.0 WECHAT-01..04 微信真实通知脱敏样本解析', () => {
  it('WECHAT-01 支付凭证（title=微信支付 + 商户A ¥12.34）→ expense 12.34 / 商户A / HIGH', () => {
    const parsed = new WechatParser().parse({
      packageName: 'com.tencent.mm',
      title: '微信支付',
      text: '微信支付凭证',
      bigText: '商户A\n¥12.34',
      subText: '',
      postTime: T0,
      channelId: 'bill',
    })!;
    expect(parsed.source).toBe('wechat');
    expect(parsed.amount).toBe(12.34);
    expect(parsed.type).toBe('expense');
    expect(parsed.merchant).toBe('商户A');
    expect(parsed.confidence).toBe('HIGH');
  });

  it('WECHAT-02 收款到账（转账到账 + 收款¥88.00 无商户）→ income 88 / MEDIUM', () => {
    const parsed = new WechatParser().parse({
      packageName: 'com.tencent.mm',
      title: '微信支付',
      text: '转账到账',
      bigText: '收款¥88.00',
      subText: '',
      postTime: T0,
      channelId: 'bill',
    })!;
    expect(parsed.amount).toBe(88);
    expect(parsed.type).toBe('income');
    expect(parsed.merchant).toBeUndefined();
    expect(parsed.confidence).toBe('MEDIUM');
  });

  it('WECHAT-03 退款（退款 ¥20.00 已退回）→ income 20（沿用 Bill 模型 income）', () => {
    const parsed = new WechatParser().parse({
      packageName: 'com.tencent.mm',
      title: '微信支付',
      text: '退款 ¥20.00 已退回',
      bigText: '',
      subText: '',
      postTime: T0,
    })!;
    expect(parsed.amount).toBe(20);
    expect(parsed.type).toBe('income');
    expect(parsed.confidence).toBe('MEDIUM');
  });

  it('WECHAT-04 无金额（系统结构但无金额）→ null，不生成账单', () => {
    const parsed = new WechatParser().parse({
      packageName: 'com.tencent.mm',
      title: '微信支付',
      text: '微信支付凭证',
      bigText: '查看详情',
      subText: '',
      postTime: T0,
    });
    expect(parsed).toBeNull();
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

  it('2.17.0 WECHAT-01 真实微信支付凭证（channelId 贯通）→ 生成 微信支付 候选；聊天通知不建候选', async () => {
    const { syncAutoBillNotifications } = await import('@/feature/autobill/service/sync-service');
    const bridge = await import('@/feature/autobill/service/notification-bridge');

    // 模拟 Native Pending：n1=微信支付凭证（带 channelId），n2=普通聊天「帮我支付20元」
    const pullSpy = vi
      .spyOn(bridge, 'pullPendingNativeNotifications')
      .mockResolvedValueOnce([
        {
          id: 'n1',
          packageName: 'com.tencent.mm',
          postTime: T0,
          capturedAt: T0,
          title: '微信支付',
          text: '微信支付凭证',
          bigText: '商户A\n¥12.34',
          subText: '',
          channelId: 'bill', // 2.17.0：channelId 贯通 Native → Web → Parser
        },
        {
          id: 'n2',
          packageName: 'com.tencent.mm',
          postTime: T0 + 1000,
          capturedAt: T0 + 1000,
          title: '小红',
          text: '帮我支付20元',
          bigText: '',
          subText: '',
          channelId: 'chat',
        },
      ])
      .mockResolvedValueOnce([]);
    const ackSpy = vi.spyOn(bridge, 'ackPendingNativeNotifications').mockResolvedValue(undefined);

    const s1 = await syncAutoBillNotifications();
    expect(s1.received).toBe(2);
    expect(s1.created).toBe(1); // 聊天被安全过滤
    const candidates = await new IdbAutoBillService().listCandidates('WAIT_CONFIRM');
    expect(candidates).toHaveLength(1);
    expect(candidates[0].sourceApp).toBe('微信支付'); // 展示中文名，不暴露 com.tencent.mm
    expect(candidates[0].amount).toBe(12.34);
    expect(candidates[0].merchant).toBe('商户A');
    expect(candidates[0].confidence).toBe('HIGH');
    expect(ackSpy).toHaveBeenCalledWith(['n1', 'n2']);

    pullSpy.mockRestore();
    ackSpy.mockRestore();
  });

  it('2.17.0 SOURCE-05 channelId 贯通：微信 Parser 实际收到渠道信号（bill ≠ chat）', async () => {
    // Parser 层验证：传入 channelId 参与判断（bill 渠道 + 系统结构 → 建候选）
    const wechat = new WechatParser();
    const withBillChannel = wechat.parse({
      packageName: 'com.tencent.mm',
      title: '微信支付',
      text: '微信支付凭证\n商户A\n¥12.34',
      bigText: '',
      subText: '',
      postTime: T0,
      channelId: 'bill',
    });
    expect(withBillChannel?.amount).toBe(12.34);
  });
});