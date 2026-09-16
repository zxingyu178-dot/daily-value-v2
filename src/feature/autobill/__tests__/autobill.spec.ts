/**
 * 2.15.0 Gate A - 自动记账生命周期测试（测试 1..5 + 纯函数）
 * 测试 1：模拟通知 支付宝「支付25.80元」 → 生成 Candidate
 * 测试 2：重复通知（付款成功 + 交易完成 + 商户通知）→ 只生成一个 Candidate
 * 测试 3：确认 → 生成正式 Bill（source=notification）
 * 测试 4：忽略 → 不进入账本/统计
 * 测试 5：启动弹窗优先级（更新日志与自动账单不会同时出现）
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { openDatabase } from '@/core/db/database';
import { IdbAutoBillService, IdbBillService, IdbCategoryService } from '@/core/services/idb';
import { buildNotificationHash, normalizeNotificationText } from '@/feature/autobill/domain/hash';
import { parseNotification } from '@/feature/autobill/parser/parser';
import { resolveNextStartupDialog } from '@/core/startup-dialog/manager';

const TEST_STORES = ['bills', 'categories', 'settings', 'meta', 'recurringRules', 'autoBillCandidates'] as const;

async function resetDb(): Promise<void> {
  const db = await openDatabase();
  const tx = db.transaction(TEST_STORES, 'readwrite');
  for (const store of TEST_STORES) tx.objectStore(store).clear();
  await tx.done;
}

/** 种子一个「餐饮」分类（确认→Bill 需要分类快照） */
async function seedCategory(): Promise<void> {
  const catSvc = new IdbCategoryService();
  const cats = await catSvc.list();
  if (cats.length === 0) {
    await catSvc.add({ name: '餐饮', emoji: '🍚', builtin: true, sort: 1 });
  }
}

const POSTED_AT = new Date('2026-09-14T13:20:00+08:00').getTime();

describe('测试 1：模拟通知 → 生成 Candidate', () => {
  beforeEach(resetDb);

  it('支付宝「支付25.80元」→ 生成一笔待确认候选（金额 25.80 / 支出）', async () => {
    const svc = new IdbAutoBillService();
    const r = await svc.ingest({
      sourceApp: '支付宝',
      rawText: '支付宝 付款成功 支付25.80元',
      postedAt: POSTED_AT,
    });
    expect(r.created).toBe(true);
    expect(r.duplicate).toBe(false);
    expect(r.candidateId).toBeTruthy();
    const pending = await svc.listCandidates('WAIT_CONFIRM');
    expect(pending).toHaveLength(1);
    expect(pending[0].amount).toBe(25.8);
    expect(pending[0].type).toBe('expense');
    expect(pending[0].sourceApp).toBe('支付宝');
    // 禁止直接写正式账单
    expect(await new IdbBillService().list()).toHaveLength(0);
  });

  it('解析不到金额的通知不建候选（不污染待确认列表）', async () => {
    const svc = new IdbAutoBillService();
    const r = await svc.ingest({ sourceApp: '支付宝', rawText: '你有新的朋友动态', postedAt: POSTED_AT });
    expect(r.created).toBe(false);
    expect(await svc.countWaitConfirm()).toBe(0);
  });

  it('Parser：¥/元/块 金额、退款收入方向', () => {
    expect(parseNotification('支付¥25.80').amount).toBe(25.8);
    expect(parseNotification('支付25.80元').amount).toBe(25.8);
    expect(parseNotification('退款到账50元').amount).toBe(50);
    expect(parseNotification('退款到账50元').type).toBe('income');
    expect(parseNotification('付款完成').amount).toBeNull();
  });
});

describe('测试 2：重复通知去重（同一通知推送两次 = 1 笔）', () => {
  beforeEach(resetDb);

  it('同一通知发送两次 → 只有一个 Candidate（第二次 duplicate 命中同一 id）', async () => {
    const svc = new IdbAutoBillService();
    const first = { sourceApp: '支付宝', rawText: '支付宝 付款成功 支付25.80元', postedAt: POSTED_AT };
    const a = await svc.ingest(first);
    const b = await svc.ingest({ ...first });
    expect(a.created).toBe(true);
    expect(b.duplicate).toBe(true);
    expect(b.candidateId).toBe(a.candidateId);
    expect(await svc.countWaitConfirm()).toBe(1);
  });

  it('金额不同 → 不同一笔（不误合并）', async () => {
    const svc = new IdbAutoBillService();
    const a = await svc.ingest({ sourceApp: '支付宝', rawText: '支付宝 付款成功 支付25.80元', postedAt: POSTED_AT });
    const d = await svc.ingest({ sourceApp: '支付宝', rawText: '支付宝 付款成功 支付30.00元', postedAt: POSTED_AT });
    expect(d.created).toBe(true);
    expect(d.candidateId).not.toBe(a.candidateId);
    expect(await svc.countWaitConfirm()).toBe(2);
  });

  it('Hash：确定性 + 跨天窗口（同一天重复推送同指纹；跨天 = 新窗口）', () => {
    const base = { sourceApp: '支付宝', amount: 25.8, merchant: '瑞幸咖啡', type: 'expense' as const, rawText: '瑞幸咖啡 支付25.80元' };
    const h1 = buildNotificationHash({ ...base, transactionTime: POSTED_AT });
    const h2 = buildNotificationHash({ ...base, transactionTime: POSTED_AT + 1000 });
    expect(h1).toBe(h2); // 同一「天」窗口
    expect(normalizeNotificationText(' 支付  25.80元 ')).toBe('支付 25.80元');
    const h3 = buildNotificationHash({ ...base, transactionTime: POSTED_AT + 2 * 24 * 3600 * 1000 });
    expect(h3).not.toBe(h1); // 跨天 = 新窗口
  });
});

describe('测试 3：确认 → 生成正式 Bill', () => {
  beforeEach(async () => {
    await resetDb();
    await seedCategory();
  });

  it('确认后：Bill=notification 进入账本，候选保留为 CONFIRMED（不删除），待确认归零', async () => {
    const svc = new IdbAutoBillService();
    const r = await svc.ingest({ sourceApp: '支付宝', rawText: '瑞幸咖啡 支付25.80元', postedAt: POSTED_AT });
    expect(r.candidateId).toBeTruthy();
    const bill = await svc.confirm(r.candidateId!);
    expect(bill.source).toBe('notification');
    expect(bill.amount).toBe(25.8);
    expect(bill.note).toContain('瑞幸咖啡');
    expect(bill.date).toBe('2026-09-14');
    expect(bill.ledgerImpact).toBe('normal');
    expect(bill.categoryId).toBeTruthy();
    // 2.16.3：候选保留为已确认（明确状态，不直接删除）
    const cand = await svc.getCandidate(r.candidateId!);
    expect(cand?.status).toBe('CONFIRMED');
    expect(await svc.countWaitConfirm()).toBe(0);
    const bills = await new IdbBillService().list();
    expect(bills).toHaveLength(1);
    expect(bills[0].source).toBe('notification');
  });

  it('非待确认（重复确认/已忽略）拒绝', async () => {
    const svc = new IdbAutoBillService();
    await expect(svc.confirm('nope')).rejects.toBeTruthy();
    const r = await svc.ingest({ sourceApp: '支付宝', rawText: '支付10元', postedAt: POSTED_AT });
    await svc.confirm(r.candidateId!);
    await expect(svc.confirm(r.candidateId!)).rejects.toBeTruthy();
  });

  it('2.16.6 修改后确认：confirmCandidateWithBill → Bill.source 恒为 notification + 候选 CONFIRMED 且写入 confirmedBillId', async () => {
    const svc = new IdbAutoBillService();
    const r = await svc.ingest({ sourceApp: '支付宝', rawText: '瑞幸咖啡 支付25.80元', postedAt: POSTED_AT });
    expect(r.candidateId).toBeTruthy();
    // 用户修改：金额 12.00 + 分类改为 餐饮 + 备注改为「瑞幸拿铁」
    const draft = {
      type: 'expense' as const,
      amount: 12,
      categoryId: 'c-food',
      categoryEmoji: '🍚',
      categoryName: '餐饮',
      note: '瑞幸拿铁',
      date: '2026-09-15',
      timestamp: POSTED_AT + 3600_000,
    };
    const bill = await svc.confirmCandidateWithBill(r.candidateId!, draft);
    expect(bill.source).toBe('notification'); // 无论用户如何修改，来源语义固定
    expect(bill.amount).toBe(12);
    expect(bill.categoryName).toBe('餐饮');
    expect(bill.note).toContain('瑞幸拿铁');
    expect(bill.id).toBe(`nb-${r.candidateId}`);
    const cand = await svc.getCandidate(r.candidateId!);
    expect(cand?.status).toBe('CONFIRMED');
    expect(cand?.confirmedBillId).toBe(bill.id);
    expect(await svc.countWaitConfirm()).toBe(0);
    // 账本只有这一笔 notification Bill（QuickEntrySheet 不再预写 manual Bill）
    const bills = await new IdbBillService().list();
    expect(bills).toHaveLength(1);
    expect(bills[0].source).toBe('notification');
  });

  it('2.16.6 confirmCandidateWithBill 失败回滚：草稿非法/候选不存在 → 不产生孤立 Bill、候选状态不变', async () => {
    const svc = new IdbAutoBillService();
    const r = await svc.ingest({ sourceApp: '支付宝', rawText: '支付10元', postedAt: POSTED_AT });
    // 候选不存在 → 整体失败
    await expect(
      svc.confirmCandidateWithBill('no-such-id', {
        type: 'expense',
        amount: 9,
        categoryId: 'c-food',
        categoryEmoji: '🍚',
        categoryName: '餐饮',
        note: '',
        date: '2026-09-15',
        timestamp: POSTED_AT,
      }),
    ).rejects.toBeTruthy();
    expect(await new IdbBillService().list()).toHaveLength(0); // 无孤立 Bill
    const cand = await svc.getCandidate(r.candidateId!);
    expect(cand?.status).toBe('WAIT_CONFIRM'); // 候选未被误改
  });
});

describe('测试 4：忽略 → 不进入账本/统计', () => {
  beforeEach(async () => {
    await resetDb();
    await seedCategory();
  });

  it('忽略后：候选保留为 IGNORED，账本无 Bill', async () => {
    const svc = new IdbAutoBillService();
    const r = await svc.ingest({ sourceApp: '微信支付', rawText: '微信支付 支付100元', postedAt: POSTED_AT });
    await svc.ignore(r.candidateId!);
    const cand = await svc.getCandidate(r.candidateId!);
    expect(cand?.status).toBe('IGNORED'); // 保留记录供后续分析
    expect(await svc.countWaitConfirm()).toBe(0);
    expect(await new IdbBillService().list()).toHaveLength(0); // 不入账本
  });
});

describe('测试 5：启动弹窗优先级（一次只展示一个）', () => {
  it('更新日志优先：有未读更新日志 + 待确认 → 只展示更新日志', () => {
    expect(
      resolveNextStartupDialog({
        releaseNotesUnseen: true,
        autoBillEnabled: true,
        notificationAccessGranted: true,
        pendingCandidates: 3,
      }),
    ).toBe('release-notes');
  });

  it('权限提醒优先于自动账单：已开启但权限未授权 + 待确认 → 权限提醒', () => {
    expect(
      resolveNextStartupDialog({
        releaseNotesUnseen: false,
        autoBillEnabled: true,
        notificationAccessGranted: false,
        pendingCandidates: 3,
      }),
    ).toBe('permission-reminder');
  });

  it('更新日志读完→下次启动只展示自动账单（不会同时出现）', () => {
    const first = resolveNextStartupDialog({
      releaseNotesUnseen: true,
      autoBillEnabled: true,
      notificationAccessGranted: true,
      pendingCandidates: 3,
    });
    expect(first).toBe('release-notes');
    const second = resolveNextStartupDialog({
      releaseNotesUnseen: false,
      autoBillEnabled: true,
      notificationAccessGranted: true,
      pendingCandidates: 3,
    });
    expect(second).toBe('autobill-reminder');
  });

  it('全部无事件 → 不展示任何弹窗', () => {
    expect(
      resolveNextStartupDialog({
        releaseNotesUnseen: false,
        autoBillEnabled: false,
        notificationAccessGranted: false,
        pendingCandidates: 0,
      }),
    ).toBeNull();
  });
});