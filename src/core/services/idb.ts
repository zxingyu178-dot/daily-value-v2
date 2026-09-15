/**
 * Daily Value v2 - service IndexedDB 实现（Phase 1 Core Data Layer）
 * 架构：Page → Store → Service → Database；页面禁止直接访问数据库。
 * 本文件将 Phase 0 的内存占位替换为 IndexedDB 持久化实现。
 */
import type { IDBPDatabase } from 'idb';
import { openDatabase, type DvSchema } from '@/core/db/database';
import type {
  ICategoryService,
  IBillService,
  IRecurringRuleService,
  ISettingsService,
  IBackupService,
  IAutoBillService,
  IncomingNotification,
  BackupSnapshot,
} from '@/core/services/types';
import type {
  Bill,
  Category,
  RecurringRule,
  Settings,
  AutoBillCandidate,
  AutoBillCandidateStatus,
} from '@/core/models/types';
import {
  BACKUP_FORMAT,
  BACKUP_SCHEMA_VERSION,
  pickBackupSettings,
  pickBackupWallpaper,
  validateBackup,
  type DailyValueBackup,
} from '@/core/backup/backup';
import { buildBillsCsv } from '@/core/backup/csv';
import { buildNotificationHash } from '@/feature/autobill/domain/hash';
import { parseNotification } from '@/feature/autobill/parser/parser';
import { resolveCategory, buildBillFromCandidate, NEAR_DEDUPE_WINDOW_MS } from '@/feature/autobill/service/candidate';
import { sourceFromLabel } from '@/feature/autobill/parser/registry';

function uid(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

const DEFAULT_SETTINGS: Settings = {
  currency: '¥',
  theme: 'auto',
  themeColor: 'violet',
  themeGlass: 'off',
  sort: 'per',
  wallpaper: undefined,
  statisticsModules: ['daily-expense-trend', 'income-expense-compare', 'category-ranking', 'cumulative-expense'],
  autoBillEnabled: false,
  autoBillAllowedApps: ['支付宝', '微信支付'],
};
const SETTINGS_KEY = 'main';

export class IdbBillService implements IBillService {
  private async db(): Promise<IDBPDatabase<DvSchema>> {
    return openDatabase();
  }

  async list(): Promise<Bill[]> {
    const db = await this.db();
    return (await db.getAll('bills')) as Bill[];
  }

  async listByMonth(ym: string): Promise<Bill[]> {
    const all = await this.list();
    // 仅统计/时间线口径：排除 daily-value-only（只在日价模块展示，不进入月度账本）
    return all.filter((b) => b.ledgerImpact !== 'daily-value-only' && b.date.startsWith(ym));
  }

  async get(id: string): Promise<Bill | undefined> {
    const db = await this.db();
    return (await db.get('bills', id)) as Bill | undefined;
  }

  async add(bill: Omit<Bill, 'id'> & { id?: string }): Promise<Bill> {
    const full: Bill = { ...bill, id: bill.id ?? uid() };
    const db = await this.db();
    await db.put('bills', full);
    return full;
  }

  async update(id: string, patch: Partial<Bill>): Promise<void> {
    const db = await this.db();
    const existing = (await db.get('bills', id)) as Bill | undefined;
    if (existing) {
      await db.put('bills', { ...existing, ...patch, id });
    }
  }

  async remove(id: string): Promise<void> {
    const db = await this.db();
    await db.delete('bills', id);
  }
}

export class IdbCategoryService implements ICategoryService {
  private async db(): Promise<IDBPDatabase<DvSchema>> {
    return openDatabase();
  }

  async list(): Promise<Category[]> {
    const db = await this.db();
    const all = (await db.getAll('categories')) as Category[];
    return all.sort((a, b) => a.sort - b.sort);
  }

  async get(id: string): Promise<Category | undefined> {
    const db = await this.db();
    return (await db.get('categories', id)) as Category | undefined;
  }

  async add(category: Omit<Category, 'id'>): Promise<Category> {
    const full: Category = { ...category, id: uid() };
    const db = await this.db();
    await db.put('categories', full);
    return full;
  }

  async update(id: string, patch: Partial<Category>): Promise<void> {
    const db = await this.db();
    const existing = (await db.get('categories', id)) as Category | undefined;
    if (existing) {
      await db.put('categories', { ...existing, ...patch, id });
    }
  }

  async remove(id: string): Promise<void> {
    const db = await this.db();
    await db.delete('categories', id);
  }
}

export class IdbSettingsService implements ISettingsService {
  private async db(): Promise<IDBPDatabase<DvSchema>> {
    return openDatabase();
  }

  async get(): Promise<Settings> {
    const db = await this.db();
    const row = (await db.get('settings', SETTINGS_KEY)) as
      | { key: string; value: Settings }
      | undefined;
    return { ...DEFAULT_SETTINGS, ...(row?.value ?? {}) };
  }

  async update(patch: Partial<Settings>): Promise<Settings> {
    const db = await this.db();
    const current = await this.get();
    const merged: Settings = { ...current, ...patch };
    await db.put('settings', { key: SETTINGS_KEY, value: merged });
    return merged;
  }
}

/** 读取当前 settings 行的原始 value（含 meta 混合字段；用于备份恢复时保留 meta） */
async function readSettingsRowValue(
  db: IDBPDatabase<DvSchema>,
): Promise<Record<string, unknown> | undefined> {
  const row = (await db.get('settings', SETTINGS_KEY)) as
    | { key: string; value: Record<string, unknown> }
    | undefined;
  return row?.value;
}

/**
 * 备份服务（2.14.0，IndexedDB 实现）。
 * - 导出：业务数据 + 用户设置白名单 + 壁纸设置元数据（不含图片本体/不含 meta）
 * - 恢复：validate → 单事务整库替换（IDB 原子性 → 失败自动回滚）→ 引用完整性修复
 * - 恢复设置：只覆盖用户设置白名单键，meta（migration/fresh/$$presetDeleted）原样保留
 */
export class IdbBackupService implements IBackupService {
  private async db(): Promise<IDBPDatabase<DvSchema>> {
    return openDatabase();
  }

  async exportData(appVersion: string, now: Date = new Date()): Promise<DailyValueBackup> {
    const db = await this.db();
    const [bills, categories, recurringRules, settingsRow] = await Promise.all([
      (await db.getAll('bills')) as Bill[],
      (await db.getAll('categories')) as Category[],
      (await db.getAll('recurringRules')) as RecurringRule[],
      readSettingsRowValue(db),
    ]);
    return {
      format: BACKUP_FORMAT,
      schemaVersion: BACKUP_SCHEMA_VERSION,
      appVersion,
      exportedAt: now.toISOString(),
      data: {
        bills,
        categories,
        recurringRules,
        settings: pickBackupSettings(settingsRow as unknown as Settings),
        wallpaper: pickBackupWallpaper(settingsRow as unknown as Settings),
      },
    };
  }

  async createSnapshot(): Promise<BackupSnapshot> {
    const db = await this.db();
    const [bills, categories, recurringRules, settingsValue] = await Promise.all([
      (await db.getAll('bills')) as Bill[],
      (await db.getAll('categories')) as Category[],
      (await db.getAll('recurringRules')) as RecurringRule[],
      readSettingsRowValue(db),
    ]);
    return { bills, categories, recurringRules, settingsValue };
  }

  async restoreFrom(raw: unknown): Promise<void> {
    const v = validateBackup(raw);
    if (!v.ok) throw new Error(v.error); // 调用方把 Error.message（BackupErrorKind）映射为友好文案
    const backup = v.backup;
    const db = await this.db();

    // 1) 恢复前安全快照：在替换事务开始前读取现库全量数据。
    //    回滚走独立新事务，绝不依赖失败事务的“自动中止回滚”（fake-indexeddb 等环境不保证该语义）。
    const snapshot: BackupSnapshot = {
      bills: (await db.getAll('bills')) as Bill[],
      categories: (await db.getAll('categories')) as Category[],
      recurringRules: (await db.getAll('recurringRules')) as RecurringRule[],
      settingsValue: await readSettingsRowValue(db),
    };

    // 引用完整性修复：分类缺失时，启用的周期规则 → 停用为安全状态（不静默生成错误分类）
    const categoryIds = new Set(backup.data.categories.map((c) => c.id));
    const safeRules: RecurringRule[] = backup.data.recurringRules.map((r) =>
      r.enabled && r.categoryId && !categoryIds.has(r.categoryId)
        ? { ...r, enabled: false, updatedAt: Date.now() }
        : r,
    );

    // 设置合并：只覆盖用户白名单，meta 字段原样保留；壁纸图片本体不恢复（保持当前壁纸）
    const nextSettingsValue: Record<string, unknown> = {
      ...(snapshot.settingsValue ?? {}),
      ...backup.data.settings,
    };

    try {
      // 2) 整库替换：任一环节失败（如非法数据触发 put 错误）→ 走下方回滚
      const tx = db.transaction(['bills', 'categories', 'recurringRules', 'settings'], 'readwrite');
      const clearPut = async <T>(store: 'bills' | 'categories' | 'recurringRules' | 'settings', list: T[]) => {
        const s = tx.objectStore(store);
        await s.clear();
        for (const item of list) await s.put(item);
      };
      await clearPut('categories', backup.data.categories);
      await clearPut('recurringRules', safeRules);
      await clearPut('bills', backup.data.bills);
      await tx.objectStore('settings').put({ key: SETTINGS_KEY, value: nextSettingsValue });
      await tx.done;
    } catch {
      // 3) 恢复失败 → 显式回滚到恢复前快照（跨事务，语义完整：绝不出现半恢复状态）
      try {
        const rb = db.transaction(['bills', 'categories', 'recurringRules', 'settings'], 'readwrite');
        const rbClearPut = async <T>(store: 'bills' | 'categories' | 'recurringRules' | 'settings', list: T[]) => {
          const s = rb.objectStore(store);
          await s.clear();
          for (const item of list) await s.put(item);
        };
        await rbClearPut('categories', snapshot.categories);
        await rbClearPut('recurringRules', snapshot.recurringRules);
        await rbClearPut('bills', snapshot.bills);
        if (snapshot.settingsValue !== undefined) {
          await rb.objectStore('settings').put({ key: SETTINGS_KEY, value: snapshot.settingsValue });
        }
        await rb.done;
      } catch {
        // 回滚也失败（极端存储故障）→ 区别于“普通恢复失败”，由上层给出更明确提示
        throw new Error('rollback-failed');
      }
      throw new Error('restore-failed');
    }
  }

  async exportCsv(): Promise<string> {
    const db = await this.db();
    const bills = (await db.getAll('bills')) as Bill[];
    return buildBillsCsv(bills);
  }
}

export class IdbRecurringRuleService implements IRecurringRuleService {
  private async db(): Promise<IDBPDatabase<DvSchema>> {
    return openDatabase();
  }

  async list(): Promise<RecurringRule[]> {
    const db = await this.db();
    return (await db.getAll('recurringRules')) as RecurringRule[];
  }

  async get(id: string): Promise<RecurringRule | undefined> {
    const db = await this.db();
    return (await db.get('recurringRules', id)) as RecurringRule | undefined;
  }

  async add(rule: Omit<RecurringRule, 'id' | 'createdAt'>): Promise<RecurringRule> {
    const full: RecurringRule = { ...rule, id: uid(), createdAt: Date.now(), updatedAt: Date.now() };
    const db = await this.db();
    await db.put('recurringRules', full);
    return full;
  }

  async update(id: string, patch: Partial<RecurringRule>): Promise<void> {
    const db = await this.db();
    const existing = (await db.get('recurringRules', id)) as RecurringRule | undefined;
    if (existing) {
      await db.put('recurringRules', { ...existing, ...patch, id, updatedAt: Date.now() });
    }
  }

  async remove(id: string): Promise<void> {
    const db = await this.db();
    await db.delete('recurringRules', id);
  }
}

/**
 * 自动记账服务（2.15.0 Gate A，IndexedDB 实现）。
 * 生命周期：通知 → 解析 → 去重 → 待确认候选 → 用户确认/忽略。
 * 确认才生成正式 Bill（source='notification'）；忽略保留记录（不进入账本）。
 */
export class IdbAutoBillService implements IAutoBillService {
  private async db(): Promise<IDBPDatabase<DvSchema>> {
    return openDatabase();
  }

  async ingest(input: IncomingNotification) {
    // 2.16.2 数据正确性收口：正式链路 Native → Source Parser → ParsedResult 是唯一真实来源，
    // 不再对 rawText 重新猜一次。Gate A 模拟通知（无 parsed）才 fallback 通用启发式。
    const generic = parseNotification(input.rawText);
    const amount = input.parsed?.amount ?? generic.amount;
    if (amount === null) {
      return { created: false, duplicate: false };
    }
    const type = input.parsed?.type ?? generic.type;
    const merchant = input.parsed?.merchant ?? generic.merchant ?? input.sourceApp;
    const db = await this.db();
    const all = (await db.getAll('autoBillCandidates')) as AutoBillCandidate[];
    const hash = buildNotificationHash({
      sourceApp: input.sourceApp,
      amount,
      merchant,
      type,
      transactionTime: input.postedAt,
      rawText: input.rawText,
    });
    // 去重双保险：① 精确指纹（notificationHash）② 10 分钟近邻（同源+同额+同商户）
    const byHash = all.find((c) => c.notificationHash === hash);
    if (byHash) {
      return { created: false, duplicate: true, candidateId: byHash.id };
    }
    const near = all.find(
      (c) =>
        c.sourceApp === input.sourceApp &&
        c.amount === amount &&
        c.merchant === merchant &&
        Math.abs(c.transactionTime - input.postedAt) <= NEAR_DEDUPE_WINDOW_MS &&
        c.status !== 'CONFIRMED',
    );
    if (near) {
      return { created: false, duplicate: true, candidateId: near.id };
    }
    const categories = (await db.getAll('categories')) as Category[];
    const suggestCategoryId =
      input.parsed?.suggestCategoryId ?? resolveCategory(categories, undefined, type)?.id;
    const candidate: AutoBillCandidate = {
      id: uid(),
      sourceApp: input.sourceApp,
      source: input.parsed?.source ?? sourceFromLabel(input.sourceApp),
      rawText: input.rawText,
      merchant,
      amount,
      type,
      suggestCategoryId,
      confidence: input.parsed?.confidence,
      transactionTime: input.postedAt,
      status: 'WAIT_CONFIRM',
      notificationHash: hash,
      createdAt: Date.now(),
    };
    await db.put('autoBillCandidates', candidate);
    return { created: true, duplicate: false, candidateId: candidate.id };
  }

  async listCandidates(status: AutoBillCandidateStatus = 'WAIT_CONFIRM'): Promise<AutoBillCandidate[]> {
    const db = await this.db();
    const all = (await db.getAll('autoBillCandidates')) as AutoBillCandidate[];
    return all
      .filter((c) => c.status === status)
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  async countWaitConfirm(): Promise<number> {
    return (await this.listCandidates('WAIT_CONFIRM')).length;
  }

  async getCandidate(id: string): Promise<AutoBillCandidate | undefined> {
    const db = await this.db();
    return (await db.get('autoBillCandidates', id)) as AutoBillCandidate | undefined;
  }

  async existsHash(hash: string): Promise<boolean> {
    return (await this.idByHash(hash)) !== undefined;
  }

  private async idByHash(hash: string): Promise<string | undefined> {
    const db = await this.db();
    const all = (await db.getAll('autoBillCandidates')) as AutoBillCandidate[];
    return all.find((c) => c.notificationHash === hash)?.id;
  }

  /** 确认：单事务 生成正式 Bill（source=notification）+ 候选置为 CONFIRMED（保留记录，不删除） */
  async confirm(id: string): Promise<Bill> {
    const db = await this.db();
    const candidate = (await db.get('autoBillCandidates', id)) as AutoBillCandidate | undefined;
    if (!candidate || candidate.status !== 'WAIT_CONFIRM') {
      throw new Error('candidate-not-found');
    }
    const categories = (await db.getAll('categories')) as Category[];
    const category = resolveCategory(categories, candidate.suggestCategoryId, candidate.type);
    const bill = buildBillFromCandidate(candidate, category);
    const tx = db.transaction(['bills', 'autoBillCandidates'], 'readwrite');
    await tx.objectStore('bills').put(bill);
    // 2.16.3：不删除，置为已确认（便于用户回看状态）；非 WAIT_CONFIRM 后续确认被拒绝
    await tx.objectStore('autoBillCandidates').put({ ...candidate, status: 'CONFIRMED' });
    await tx.done;
    return bill;
  }

  /** 忽略：置为 IGNORED（保留记录供后续分析，不再进入账本） */
  async ignore(id: string): Promise<void> {
    const db = await this.db();
    const existing = (await db.get('autoBillCandidates', id)) as AutoBillCandidate | undefined;
    if (existing) {
      await db.put('autoBillCandidates', { ...existing, status: 'IGNORED' });
    }
  }
}

/** 组装 IndexedDB 服务注册表（单例） */
export function createIdbServiceRegistry() {
  return {
    bills: new IdbBillService(),
    categories: new IdbCategoryService(),
    recurringRules: new IdbRecurringRuleService(),
    settings: new IdbSettingsService(),
    backup: new IdbBackupService(),
    autoBill: new IdbAutoBillService(),
  };
}
