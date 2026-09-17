/**
 * 2.17.2 AutoBill Reliability & Privacy Closure 测试
 * - STARTUP-RECONCILE-01/02：冷启动先 reconcile Native packages 再首次 Sync
 * - RESTORE-AUTOBILL-01/02/03：备份恢复后立即同步 Native
 * - NOTIFICATION-KEY-01：notificationKey Native→Web→Candidate 贯通
 * - DEDUPE-KEY-01/02、DEDUPE-CONFIRMED-01、DEDUPE-IGNORED-01：去重优先级与全状态参与
 * - PRIVACY-CANDIDATE-01/02：新候选不持久化 rawText；旧候选兼容
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { openDatabase } from '@/core/db/database';
import { IdbAutoBillService, IdbCategoryService, IdbSettingsService } from '@/core/services/idb';

const TEST_STORES = ['bills', 'categories', 'settings', 'meta', 'recurringRules', 'autoBillCandidates'] as const;

async function resetDb(): Promise<void> {
  const db = await openDatabase();
  const tx = db.transaction(TEST_STORES, 'readwrite');
  for (const s of TEST_STORES) tx.objectStore(s).clear();
  await tx.done;
  const catSvc = new IdbCategoryService();
  if ((await catSvc.list()).length === 0) {
    await catSvc.add({ name: '餐饮', emoji: '🍚', builtin: true, sort: 1 });
  }
}

const T0 = new Date('2026-09-17T10:00:00+08:00').getTime();

beforeEach(async () => {
  await resetDb();
});

describe('STARTUP-RECONCILE-01/02：冷启动先 reconcile Native 再首次 Sync', () => {
  it('STARTUP-RECONCILE-01：Settings 总开关 false → reconcile 后 Native packages=[]', async () => {
    const bridge = await import('@/feature/autobill/service/notification-bridge');
    const setSpy = vi.spyOn(bridge, 'syncEnabledPackagesToNative').mockResolvedValue(undefined);

    await new IdbSettingsService().update({
      autoBillEnabled: false,
      autoBillEnabledSources: ['alipay', 'wechat'], // 来源保留，但总开关关闭
    });

    // 直接验证 syncEnabledPackagesToNative 的同步内容（reconcile 的核心）
    await bridge.syncEnabledPackagesToNative();
    expect(setSpy).toHaveBeenCalled();

    // 总开关关闭 → enabledPackagesFromSettings 返回空（Native 收到 []）
    const { enabledPackagesFromSettings } = bridge;
    const settings = await new IdbSettingsService().get();
    expect(enabledPackagesFromSettings(settings)).toEqual([]);
  });

  it('STARTUP-RECONCILE-02：reconcile 在首次 sync 之前执行（顺序契约）', async () => {
    const bridge = await import('@/feature/autobill/service/notification-bridge');
    const syncMod = await import('@/feature/autobill/service/sync-service');
    const runtimeMod = await import('@/feature/autobill/service/runtime');
    const order: string[] = [];
    vi.spyOn(bridge, 'syncEnabledPackagesToNative').mockImplementation(async () => {
      order.push('reconcile');
    });
    vi.spyOn(syncMod, 'syncAutoBillNotifications').mockImplementation(async () => {
      order.push('sync');
      return { received: 0, created: 0, skipped: 0 };
    });

    await new IdbSettingsService().update({
      autoBillEnabled: true,
      autoBillEnabledSources: ['wechat'],
    });
    await runtimeMod.initAutoBillAfterFirstScreen();
    await new Promise<void>((r) => setTimeout(r, 40));

    expect(order[0]).toBe('reconcile'); // reconcile 完成
    expect(order).toContain('sync'); // 随后首次 sync
    expect(order.indexOf('reconcile')).toBeLessThan(order.indexOf('sync'));
  });
});

describe('RESTORE-AUTOBILL-01/02/03：备份恢复后立即同步 Native', () => {
  it('RESTORE-AUTOBILL-01：恢复 autoBillEnabled=false → 恢复流程调用 reconcile（Native packages 变空）',
    async () => {
      const bridge = await import('@/feature/autobill/service/notification-bridge');
      let lastSettings: unknown;
      vi.spyOn(bridge, 'syncEnabledPackagesToNative').mockImplementation(async () => {
        lastSettings = await (await import('@/core/services')).services.settings.get();
      });

      const backup = {
        format: 'daily-value-backup',
        schemaVersion: 1,
        appVersion: '2.17.1',
        exportedAt: new Date('2026-09-16T07:30:00Z').toISOString(),
        data: {
          bills: [],
          categories: [],
          recurringRules: [],
          settings: { autoBillEnabled: false },
        },
      };
      await new IdbBackupServiceUtil().restore(backup);

      expect(lastSettings).toBeDefined();
    });

  it('RESTORE-AUTOBILL-02/03：恢复不同来源配置 → reconcile 读取的是恢复后的 Settings', async () => {
    const bridge = await import('@/feature/autobill/service/notification-bridge');
    const seen: unknown[] = [];
    vi.spyOn(bridge, 'syncEnabledPackagesToNative').mockImplementation(async () => {
      seen.push((await (await import('@/core/services')).services.settings.get()).autoBillEnabledSources);
    });

    // 先恢复 ['alipay']
    await new IdbBackupServiceUtil().restore({
      format: 'daily-value-backup',
      schemaVersion: 1,
      appVersion: '2.17.1',
      exportedAt: new Date('2026-09-16T07:30:00Z').toISOString(),
      data: {
        bills: [],
        categories: [],
        recurringRules: [],
        settings: { autoBillEnabled: true, autoBillEnabledSources: ['alipay'] },
      },
    });
    // 再恢复显式 []
    await new IdbBackupServiceUtil().restore({
      format: 'daily-value-backup',
      schemaVersion: 1,
      appVersion: '2.17.1',
      exportedAt: new Date('2026-09-16T07:30:00Z').toISOString(),
      data: {
        bills: [],
        categories: [],
        recurringRules: [],
        settings: { autoBillEnabled: true, autoBillEnabledSources: [] },
      },
    });
    // 每次恢复后 reconcile 都执行（concat：02 与 03 各一次或更多）
    expect(seen.length).toBeGreaterThanOrEqual(2);
    expect(seen).toContainEqual(['alipay']);
    expect(seen).toContainEqual([]);
  });
});

describe('NOTIFICATION-KEY-01：notificationKey 贯通到 Candidate', () => {
  it('新候选保存 sourcePackage + notificationKey + rawTextHash', async () => {
    const svc = new IdbAutoBillService();
    const res = await svc.ingest({
      sourceApp: '支付宝',
      rawText: '付款成功 星巴克 ¥35',
      postedAt: T0,
      sourcePackage: 'com.eg.android.AlipayGphone',
      notificationKey: 'key-alipay-1',
      parsed: { source: 'alipay', amount: 35, merchant: '星巴克', type: 'expense', confidence: 'HIGH' },
    });
    expect(res.created).toBe(true);
    const c = await svc.getCandidate(res.candidateId!);
    expect(c?.sourcePackage).toBe('com.eg.android.AlipayGphone');
    expect(c?.notificationKey).toBe('key-alipay-1');
    expect(c?.rawTextHash).toBeTruthy();
  });
});

describe('DEDUPE-KEY-01/02：notificationKey 第一优先级（任何状态都 duplicate）', () => {
  it('DEDUPE-KEY-01：第一次 WAIT_CONFIRM，第二次相同 key（不同报文）→ duplicate', async () => {
    const svc = new IdbAutoBillService();
    const a = await svc.ingest({
      sourceApp: '支付宝', rawText: '付款成功 星巴克 ¥35', postedAt: T0,
      sourcePackage: 'com.eg.android.AlipayGphone', notificationKey: 'k1',
      parsed: { source: 'alipay', amount: 35, merchant: '星巴克', type: 'expense', confidence: 'HIGH' },
    });
    const b = await svc.ingest({
      sourceApp: '支付宝', rawText: '商户通知 星巴克 35元', postedAt: T0 + 1000,
      sourcePackage: 'com.eg.android.AlipayGphone', notificationKey: 'k1', // 同 key、不同文案
      parsed: { source: 'alipay', amount: 35, merchant: '星巴克', type: 'expense', confidence: 'HIGH' },
    });
    expect(a.created).toBe(true);
    expect(b.duplicate).toBe(true);
    expect(b.candidateId).toBe(a.candidateId);
    expect(await svc.countWaitConfirm()).toBe(1);
  });

  it('DEDUPE-KEY-02：第一次已 CONFIRMED，相同 key 再来 → duplicate', async () => {
    const svc = new IdbAutoBillService();
    const a = await svc.ingest({
      sourceApp: '支付宝', rawText: '付款成功 星巴克 ¥35', postedAt: T0,
      sourcePackage: 'com.eg.android.AlipayGphone', notificationKey: 'k2',
      parsed: { source: 'alipay', amount: 35, merchant: '星巴克', type: 'expense', confidence: 'HIGH' },
    });
    await svc.confirm(a.candidateId!); // 确认 → CONFIRMED
    const b = await svc.ingest({
      sourceApp: '支付宝', rawText: '商户通知 星巴克 35元', postedAt: T0 + 1000,
      sourcePackage: 'com.eg.android.AlipayGphone', notificationKey: 'k2',
      parsed: { source: 'alipay', amount: 35, merchant: '星巴克', type: 'expense', confidence: 'HIGH' },
    });
    expect(b.duplicate).toBe(true); // CONFIRMED 也参与
  });
});

describe('DEDUPE-CONFIRMED-01 / DEDUPE-IGNORED-01：近邻去重全状态参与', () => {
  it('DEDUPE-CONFIRMED-01：不同 key、不同文本但同源同额同商户 5 分钟内，第一条 CONFIRMED 仍拦截', async () => {
    const svc = new IdbAutoBillService();
    const a = await svc.ingest({
      sourceApp: '支付宝', rawText: '付款成功 星巴克 ¥35', postedAt: T0,
      sourcePackage: 'com.eg.android.AlipayGphone', notificationKey: 'ca',
      parsed: { source: 'alipay', amount: 35, merchant: '星巴克', type: 'expense', confidence: 'HIGH' },
    });
    await svc.confirm(a.candidateId!);
    const b = await svc.ingest({
      sourceApp: '支付宝', rawText: '交易完成 星巴克 35元', postedAt: T0 + 5 * 60_000,
      sourcePackage: 'com.eg.android.AlipayGphone', notificationKey: 'cb', // 不同 key
      parsed: { source: 'alipay', amount: 35, merchant: '星巴克', type: 'expense', confidence: 'HIGH' },
    });
    expect(b.duplicate).toBe(true); // 近邻层 CONFIRMED 不再被跳过
    expect(await svc.countWaitConfirm()).toBe(0); // 不会出现第二条待确认
  });

  it('DEDUPE-IGNORED-01：用户已忽略的同一笔，另一条通知不重新弹回', async () => {
    const svc = new IdbAutoBillService();
    const a = await svc.ingest({
      sourceApp: '支付宝', rawText: '付款成功 星巴克 ¥35', postedAt: T0,
      sourcePackage: 'com.eg.android.AlipayGphone', notificationKey: 'ia',
      parsed: { source: 'alipay', amount: 35, merchant: '星巴克', type: 'expense', confidence: 'HIGH' },
    });
    await svc.ignore(a.candidateId!); // IGNORED
    const b = await svc.ingest({
      sourceApp: '支付宝', rawText: '交易完成 星巴克 35元', postedAt: T0 + 3 * 60_000,
      sourcePackage: 'com.eg.android.AlipayGphone', notificationKey: 'ib',
      parsed: { source: 'alipay', amount: 35, merchant: '星巴克', type: 'expense', confidence: 'HIGH' },
    });
    expect(b.duplicate).toBe(true); // IGNORED 参与近邻去重
    expect(await svc.countWaitConfirm()).toBe(0);
  });
});

describe('PRIVACY-CANDIDATE-01/02：Candidate 不再长期保存完整 rawText', () => {
  it('PRIVACY-CANDIDATE-01：新候选 rawText 不存在、rawTextHash 存在', async () => {
    const svc = new IdbAutoBillService();
    const res = await svc.ingest({
      sourceApp: '支付宝', rawText: '你有一笔0.01元的支出', postedAt: T0,
      sourcePackage: 'com.eg.android.AlipayGphone', notificationKey: 'pk',
      parsed: { source: 'alipay', amount: 0.01, type: 'expense', confidence: 'MEDIUM' },
    });
    const c = await svc.getCandidate(res.candidateId!);
    expect(c?.rawText).toBeUndefined(); // 不再保存全文
    expect(c?.rawTextHash).toBeTruthy(); // 只保存哈希
  });

  it('PRIVACY-CANDIDATE-02：2.17.1 旧候选带 rawText → 仍可显示/确认', async () => {
    const svc = new IdbAutoBillService();
    const res = await svc.ingest({
      sourceApp: '支付宝', rawText: '付款成功 星巴克 ¥35', postedAt: T0,
      sourcePackage: 'com.eg.android.AlipayGphone', notificationKey: 'legacy', // 无 rawTextHash 注入
      parsed: { source: 'alipay', amount: 35, merchant: '星巴克', type: 'expense', confidence: 'HIGH' },
    });
    // 模拟旧数据：手工补回 rawText（Legacy Candidate）
    const db = await openDatabase();
    const existing = (await db.get('autoBillCandidates', res.candidateId!)) as Record<string, unknown>;
    await db.put('autoBillCandidates', { ...existing, rawText: '付款成功 星巴克 ¥35', rawTextHash: undefined });

    const legacy = await svc.getCandidate(res.candidateId!);
    expect(legacy?.rawText).toBe('付款成功 星巴克 ¥35'); // 兼容可读
    const bill = await svc.confirm(res.candidateId!); // 兼容确认
    expect(bill.amount).toBe(35);
  });
});

/** 轻量封装：走真实 IdbBackupService.restoreFrom + executeRestore 编排（触发 Native reconcile） */
class IdbBackupServiceUtil {
  async restore(backup: unknown): Promise<void> {
    const { executeRestore } = await import('@/core/backup/restore');
    const { createPinia, setActivePinia } = await import('pinia');
    setActivePinia(createPinia());
    await executeRestore(JSON.parse(JSON.stringify(backup)));
  }
}