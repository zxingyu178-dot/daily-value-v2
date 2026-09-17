/**
 * 2.17.1 AutoBill Gate 1 Closure 测试：
 * - TOTAL-OFF-01：总开关关闭 → Native 同步 packages=[]（且不修改来源选择）
 * - TOTAL-OFF-02：总开关重新开启 → 恢复此前来源选择（来源偏好字段未被清空）
 * - SOURCE-DISABLED-01：已进入 Queue 的来源在用户关闭后 → ack 但不生成 Candidate
 * - BACKUP-AUTOBILL-01/02/03：autoBillEnabledSources 进入备份/恢复；[] 语义保持；旧备份兼容
 * - SOURCE-HARDEN-01/02：unsupported 来源不进入有效采集链 / Native packages
 */
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { openDatabase } from '@/core/db/database';
import {
  IdbAutoBillService,
  IdbCategoryService,
  IdbSettingsService,
  IdbBackupService,
} from '@/core/services/idb';
import { enabledPackagesFromSettings } from '@/feature/autobill/service/notification-bridge';
import { resolveEnabledSources, packagesForSourceIds } from '@/feature/autobill/source-registry';

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

beforeEach(async () => {
  await resetDb();
});

describe('TOTAL-OFF-01/02：总开关只控制运行，不修改来源偏好', () => {
  it('TOTAL-OFF-01：总开关 false（即使来源已选）→ Native 同步包名 = []', () => {
    // 幂等语义：关闭时来源选择仍保留（支付宝 + 微信），但白名单应为空
    const settings = {
      autoBillEnabled: false,
      autoBillEnabledSources: ['alipay', 'wechat'],
    };
    expect(enabledPackagesFromSettings(settings)).toEqual([]);
  });

  it('TOTAL-OFF-01 变体：autoBillEnabled 缺省（undefined）也视为完全关闭', () => {
    const settings = { autoBillEnabledSources: ['alipay'] };
    expect(enabledPackagesFromSettings(settings)).toEqual([]);
  });

  it('TOTAL-OFF-02：总开关重新开启 → 按此前来源选择恢复包名（偏好未被清空）', () => {
    const settings = {
      autoBillEnabled: true,
      autoBillEnabledSources: ['alipay', 'wechat'],
    };
    const packages = enabledPackagesFromSettings(settings);
    expect(packages).toContain('com.eg.android.AlipayGphone');
    expect(packages).toContain('com.tencent.mm');
  });

  it('TOTAL-OFF-02 变体：全部来源关闭 + 总开关开 → packages=[]（保持「显式为空的来源」语义）', () => {
    const settings = {
      autoBillEnabled: true,
      autoBillEnabledSources: [],
    };
    expect(enabledPackagesFromSettings(settings)).toEqual([]);
  });
});

describe('SOURCE-DISABLED-01：来源关闭后旧队列记录 → ack 但不生成 Candidate', () => {
  it('微信记录已入队列，用户在同步前关闭微信来源 → 处理时跳过解析并 ack（不生成候选）', async () => {
    // 关闭微信来源：只保留支付宝
    await new IdbSettingsService().update({
      autoBillEnabled: true,
      autoBillEnabledSources: ['alipay'],
    });
    const { syncAutoBillNotifications } = await import('@/feature/autobill/service/sync-service');
    const bridge = await import('@/feature/autobill/service/notification-bridge');

    // 队列里有一条微信支付凭证（可解析）+ 一条支付宝（可解析）
    vi.spyOn(bridge, 'pullPendingNativeNotifications')
      .mockResolvedValueOnce([
        {
          id: 'wx1',
          packageName: 'com.tencent.mm',
          postTime: Date.now(),
          capturedAt: Date.now(),
          title: '微信支付',
          text: '微信支付凭证',
          bigText: '商户A\n¥12.34',
          subText: '',
          channelId: 'bill',
        },
        {
          id: 'al1',
          packageName: 'com.eg.android.AlipayGphone',
          postTime: Date.now(),
          capturedAt: Date.now(),
          title: '付款成功',
          text: '星巴克',
          bigText: '¥35',
          subText: '',
        },
      ])
      .mockResolvedValueOnce([]);
    const ackSpy = vi.spyOn(bridge, 'ackPendingNativeNotifications').mockResolvedValue(undefined);

    const s = await syncAutoBillNotifications();
    // 微信来源已关闭 → 不生成候选；支付宝正常生成 1 条
    expect(s.created).toBe(1);
    expect(ackSpy).toHaveBeenCalledWith(expect.arrayContaining(['wx1', 'al1'])); // 两条都 ack（wx1 只 ack 不解析）

    const candidates = await new IdbAutoBillService().listCandidates('WAIT_CONFIRM');
    expect(candidates).toHaveLength(1);
    expect(candidates[0].source).toBe('alipay'); // 只有支付宝进入候选
  });
});

describe('BACKUP-AUTOBILL-01/02/03：autoBillEnabledSources 进入备份/恢复', () => {
  it('BACKUP-AUTOBILL-01：autoBillEnabledSources = ["wechat"] 导出 → 恢复后仍为 ["wechat"]', async () => {
    const settingsSvc = new IdbSettingsService();
    await settingsSvc.update({
      autoBillEnabled: true,
      autoBillEnabledSources: ['wechat'],
    });

    const backupSvc = new IdbBackupService();
    const backup = await backupSvc.exportData('2.17.1', new Date('2026-09-17T07:30:00Z'));

    // 导出字段包含新来源设置
    expect(backup.data.settings.autoBillEnabledSources).toEqual(['wechat']);

    // 恢复后 Settings 保持
    await new IdbBackupService().restoreFrom(JSON.parse(JSON.stringify(backup)));
    const after = await new IdbSettingsService().get();
    expect(after.autoBillEnabledSources).toEqual(['wechat']);
  });

  it('BACKUP-AUTOBILL-02：显式 [] 导出 → 恢复后仍为 []（不能被解释成“未配置”回归默认）', async () => {
    const settingsSvc = new IdbSettingsService();
    // 先设为非空，再设 [] 确保显式写入
    await settingsSvc.update({ autoBillEnabled: true, autoBillEnabledSources: ['alipay'] });
    await settingsSvc.update({ autoBillEnabledSources: [] });

    const backupSvc = new IdbBackupService();
    const backup = await backupSvc.exportData('2.17.1', new Date('2026-09-17T07:30:00Z'));
    // 导出体里必须是显式 []（picked 保留显式空数组，而不是 undefined）
    expect(backup.data.settings).toHaveProperty('autoBillEnabledSources');
    expect(backup.data.settings.autoBillEnabledSources).toEqual([]);

    await new IdbBackupService().restoreFrom(JSON.parse(JSON.stringify(backup)));
    const after = await new IdbSettingsService().get();
    expect(after.autoBillEnabledSources).toEqual([]);
  });

  it('BACKUP-AUTOBILL-03：旧备份只有 autoBillAllowedApps → 恢复后来源解析回落旧字段（不残留新字段）', async () => {
    // 旧备份：只有 autoBillAllowedApps（2.17.0 前），无 autoBillEnabledSources
    const legacySettingsOnly = { autoBillAllowedApps: ['支付宝'] };
    const backup = {
      format: 'daily-value-backup',
      schemaVersion: 1,
      appVersion: '2.14.0',
      exportedAt: new Date('2026-08-01T07:30:00Z').toISOString(),
      data: {
        bills: [],
        categories: [],
        recurringRules: [],
        settings: legacySettingsOnly,
      },
    };

    // 当前设备已有新字段（模拟升级后用户又选了微信）
    await new IdbSettingsService().update({
      autoBillEnabled: true,
      autoBillEnabledSources: ['wechat'],
    });

    await new IdbBackupService().restoreFrom(JSON.parse(JSON.stringify(backup)));

    const after = await new IdbSettingsService().get();
    // 兼容：恢复旧备份后，新字段被清除（回落旧字段解析），避免当前设备偏好覆盖旧备份来源偏好
    expect(after.autoBillEnabledSources).toBeUndefined();
    expect(after.autoBillAllowedApps).toEqual(['支付宝']);
    // 解析结果 = 旧备份迁移后的来源
    expect(resolveEnabledSources(undefined, after.autoBillAllowedApps)).toEqual(['alipay']);
  });
});

describe('SOURCE-HARDEN-01/02：unsupported 来源不进入有效采集链', () => {
  it('SOURCE-HARDEN-01：resolveEnabledSources 过滤 unsupported（cmb）→ ["alipay"]', () => {
    expect(resolveEnabledSources(['alipay', 'cmb'])).toEqual(['alipay']);
    // 旧字段路径同样过滤：中文名不映射到 unsupported
    expect(resolveEnabledSources(undefined, ['支付宝', '招商银行'])).toEqual(['alipay']);
  });

  it('SOURCE-HARDEN-02：packagesForSourceIds 不输出 unsupported 来源的包名（即使未来带包名）', () => {
    // cmb 目前无包名；断言即使手工塞入 id 也不出现在 Native 白名单
    expect(packagesForSourceIds(['alipay', 'cmb'])).toEqual(['com.eg.android.AlipayGphone']);
  });
});