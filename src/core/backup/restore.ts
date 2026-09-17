/**
 * Daily Value v2 - 备份恢复编排（2.14.0）
 *
 * 用户确认恢复后：
 * 1. validateBackup（纯函数）→ 恢复预览计数
 * 2. createSnapshot（恢复前安全快照；IDB 单事务原子替换本身即回滚保障，快照为双保险）
 * 3. services.backup.restoreFrom（整库替换 + 引用完整性修复）
 * 4. 失败 → 抛 BackupErrorKind → 页面显示「恢复失败，原数据已保留」
 * 5. 成功 → reload 全部 Pinia（bill/category/recurring/settings）→ settings.load 自动 applyTheme
 *    → syncWidgetSnapshot（Widget 立即刷新）→ 统计/日价页面 computed 自动重派生
 *
 * 恢复后绝不需要用户重启 App。
 */
import { services } from '@/core/services';
import { useBillStore } from '@/core/store/bill';
import { useCategoryStore } from '@/core/store/category';
import { useRecurringStore } from '@/core/store/recurring';
import { useSettingsStore } from '@/core/store/settings';
import { syncWidgetSnapshot } from '@/core/widget/sync';
import { validateBackup, type BackupErrorKind, type DailyValueBackup } from './backup';

export interface RestorePreview {
  exportedAt: string;
  appVersion: string;
  billCount: number;
  categoryCount: number;
  ruleCount: number;
}

/** 解析 + 校验备份并生成恢复预览（页面展示用；非法返回友好错误类型） */
export function buildRestorePreview(raw: unknown): { preview: RestorePreview } | { error: BackupErrorKind } {
  const v = validateBackup(raw);
  if (!v.ok) return { error: v.error };
  const b = v.backup;
  return {
    preview: {
      exportedAt: b.exportedAt ?? '',
      appVersion: typeof b.appVersion === 'string' ? b.appVersion : '',
      billCount: b.data.bills.length,
      categoryCount: b.data.categories.length,
      ruleCount: b.data.recurringRules.length,
    },
  };
}

/** 导出完整备份 DTO（供页面序列化 JSON 保存） */
export async function exportFullBackup(): Promise<DailyValueBackup> {
  const { CURRENT_VERSION } = await import('@/core/release-notes');
  return services.backup.exportData(CURRENT_VERSION);
}

/** 导出账单 CSV 文本（含 BOM） */
export async function exportBillsCsv(): Promise<string> {
  return services.backup.exportCsv();
}

/**
 * 执行恢复（确认后调用）。
 * - 失败：抛出带 BackupErrorKind 的 Error（页面据此显示友好文案，不外泄内部异常）
 * - 成功：全部 Store reload + Widget 快照刷新
 */
export async function executeRestore(raw: unknown): Promise<void> {
  const v = validateBackup(raw);
  if (!v.ok) throw new Error(v.error);

  // 1. 恢复前安全快照（双保险；IndexedDB 单事务本身原子）
  await services.backup.createSnapshot();
  // 2. 整库替换（validate 已在事务内再次执行；失败事务中止 → 原数据保留）
  await services.backup.restoreFrom(v.backup);

  // 3. reload 数据层（统计/日价/记账页面 computed 立即重派生，无需重启）
  await useBillStore().load(true);
  await useCategoryStore().load(true);
  await useRecurringStore().load(true);
  //    settings.load(true) 内部会 applyTheme / applyCustomColor / themeRevision++（界面即时切换主题）
  await useSettingsStore().load(true);

  // 3.5. 2.17.2 P0：恢复可能改变 autoBillEnabled / autoBillEnabledSources。
  //       恢复成功且 Settings 已 reload 后，必须立即把当前 Native 白名单对账一次，
  //       否则会出现「恢复前支付宝+微信、恢复备份只开支付宝 → Web 已变、Native 仍监听支付宝+微信」。
  //       动态 import 避免 core → feature 静态循环依赖；失败静默（下次启动/进设置页会再对账）。
  try {
    const { syncEnabledPackagesToNative } = await import('@/feature/autobill/service/notification-bridge');
    await syncEnabledPackagesToNative();
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[restore] autobill native reconcile failed:', String(err));
  }

  // 4. Widget 快照刷新（桌面 Widget 不再显示恢复前数据）
  void syncWidgetSnapshot();
}