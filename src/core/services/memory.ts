/**
 * Daily Value v2 - service 占位实现（内存版）
 * Phase 0 仅提供接口契约与空壳实现，保证页面占位可运行、可注入。
 * Phase 1「Core Layer」将替换为 IndexedDB 实现；Phase 2 完成 v1→v2 迁移。
 */
import type {
  ICategoryService,
  IBillService,
  IRecurringRuleService,
  IServiceRegistry,
  ISettingsService,
  IBackupService,
  IStorageService,
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
import { buildBillFromCandidate, NEAR_DEDUPE_WINDOW_MS } from '@/feature/autobill/service/candidate';
import { sourceFromLabel } from '@/feature/autobill/parser/registry';
// 2.9.7 统一真源：核心 + 预置分类与 services/index.ts / category-defs.ts 一致
import { BUILTIN_CATEGORIES } from '@/core/models/category-defs';

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

/** 内存键值存储（Phase 0 占位） */
export class MemoryStorageService implements IStorageService {
  private map = new Map<string, unknown>();

  async get<T>(key: string): Promise<T | undefined> {
    return this.map.get(key) as T | undefined;
  }
  async set<T>(key: string, value: T): Promise<void> {
    this.map.set(key, value);
  }
  async remove(key: string): Promise<void> {
    this.map.delete(key);
  }
  async clear(): Promise<void> {
    this.map.clear();
  }
}

export class MemoryBillService implements IBillService {
  private items: Bill[] = [];

  async list(): Promise<Bill[]> {
    return [...this.items];
  }
  async listByMonth(ym: string): Promise<Bill[]> {
    return this.items.filter((b) => b.ledgerImpact !== 'daily-value-only' && b.date.startsWith(ym));
  }
  async get(id: string): Promise<Bill | undefined> {
    return this.items.find((b) => b.id === id);
  }
  async add(bill: Omit<Bill, 'id'> & { id?: string }): Promise<Bill> {
    const full: Bill = { ...bill, id: bill.id ?? uid() };
    this.items.unshift(full);
    return full;
  }
  async update(id: string, patch: Partial<Bill>): Promise<void> {
    const idx = this.items.findIndex((b) => b.id === id);
    if (idx >= 0) this.items[idx] = { ...this.items[idx], ...patch };
  }
  async remove(id: string): Promise<void> {
    this.items = this.items.filter((b) => b.id !== id);
  }
}

export class MemoryCategoryService implements ICategoryService {
  private items: Category[] = BUILTIN_CATEGORIES.map((c) => ({ ...c }));

  async list(): Promise<Category[]> {
    return [...this.items];
  }
  async get(id: string): Promise<Category | undefined> {
    return this.items.find((c) => c.id === id);
  }
  async add(category: Omit<Category, 'id'>): Promise<Category> {
    const full: Category = { ...category, id: uid() };
    this.items.push(full);
    return full;
  }
  async update(id: string, patch: Partial<Category>): Promise<void> {
    const idx = this.items.findIndex((c) => c.id === id);
    if (idx >= 0) this.items[idx] = { ...this.items[idx], ...patch };
  }
  async remove(id: string): Promise<void> {
    this.items = this.items.filter((c) => c.id !== id);
  }
}

export class MemoryRecurringRuleService implements IRecurringRuleService {
  private items: RecurringRule[] = [];

  async list(): Promise<RecurringRule[]> {
    return [...this.items];
  }
  async get(id: string): Promise<RecurringRule | undefined> {
    return this.items.find((r) => r.id === id);
  }
  async add(rule: Omit<RecurringRule, 'id' | 'createdAt'>): Promise<RecurringRule> {
    const full: RecurringRule = { ...rule, id: uid(), createdAt: Date.now(), updatedAt: Date.now() };
    this.items.push(full);
    return full;
  }
  async update(id: string, patch: Partial<RecurringRule>): Promise<void> {
    const idx = this.items.findIndex((r) => r.id === id);
    if (idx >= 0) this.items[idx] = { ...this.items[idx], ...patch, updatedAt: Date.now() };
  }
  async remove(id: string): Promise<void> {
    this.items = this.items.filter((r) => r.id !== id);
  }
}

export class MemorySettingsService implements ISettingsService {
  private value: Settings = { ...DEFAULT_SETTINGS };

  async get(): Promise<Settings> {
    return { ...this.value };
  }
  async update(patch: Partial<Settings>): Promise<Settings> {
    this.value = { ...this.value, ...patch };
    return { ...this.value };
  }
}

/** 备份服务（内存版，语义与 IdbBackupService 一致，测试/占位用） */
export class MemoryBackupService implements IBackupService {
  private value: Settings = { ...DEFAULT_SETTINGS };
  private bills: Bill[] = [];
  private categories: Category[] = BUILTIN_CATEGORIES.map((c) => ({ ...c }));
  private rules: RecurringRule[] = [];

  /** 测试注入：直接替换内存数据源（与 registry 的 bill/category/rule/settings 服务共享） */
  bind(sources: { bills: Bill[]; categories: Category[]; rules: RecurringRule[]; settings: Settings }): void {
    this.bills = sources.bills;
    this.categories = sources.categories;
    this.rules = sources.rules;
    this.value = sources.settings;
  }

  async exportData(appVersion: string, now: Date = new Date()): Promise<DailyValueBackup> {
    return {
      format: BACKUP_FORMAT,
      schemaVersion: BACKUP_SCHEMA_VERSION,
      appVersion,
      exportedAt: now.toISOString(),
      data: {
        bills: [...this.bills],
        categories: [...this.categories],
        recurringRules: [...this.rules],
        settings: pickBackupSettings(this.value),
        wallpaper: pickBackupWallpaper(this.value),
      },
    };
  }

  async createSnapshot(): Promise<BackupSnapshot> {
    return {
      bills: [...this.bills],
      categories: [...this.categories],
      recurringRules: [...this.rules],
      settingsValue: { ...this.value },
    };
  }

  async restoreFrom(raw: unknown): Promise<void> {
    const v = validateBackup(raw);
    if (!v.ok) throw new Error(v.error);
    const backup = v.backup;
    const categoryIds = new Set(backup.data.categories.map((c) => c.id));
    this.bills = [...backup.data.bills];
    this.categories = [...backup.data.categories];
    this.rules = backup.data.recurringRules.map((r) =>
      r.enabled && r.categoryId && !categoryIds.has(r.categoryId)
        ? { ...r, enabled: false, updatedAt: Date.now() }
        : r,
    );
    this.value = { ...this.value, ...(backup.data.settings as Record<string, unknown>) } as Settings;
  }

  async exportCsv(): Promise<string> {
    return buildBillsCsv(this.bills);
  }
}

/** 自动记账服务（内存版，语义与 IdbAutoBillService 一致，测试/占位用） */
export class MemoryAutoBillService implements IAutoBillService {
  private candidates: AutoBillCandidate[] = [];
  private bills: Bill[] = [];

  /** 测试注入：与 registry 的 bill 服务共享数据源 */
  bind(sources: { bills: Bill[] }): void {
    this.bills = sources.bills;
  }

  async ingest(input: IncomingNotification) {
    // 同 IdbAutoBillService：ParsedResult（parsed）为唯一真实来源；无 parsed 才通用启发式兜底
    const generic = parseNotification(input.rawText);
    const amount = input.parsed?.amount ?? generic.amount;
    if (amount === null) {
      return { created: false, duplicate: false };
    }
    const type = input.parsed?.type ?? generic.type;
    const merchant = input.parsed?.merchant ?? generic.merchant ?? input.sourceApp;
    const hash = buildNotificationHash({
      sourceApp: input.sourceApp,
      amount,
      merchant,
      type,
      transactionTime: input.postedAt,
      rawText: input.rawText,
    });
    const byHash = this.candidates.find((c) => c.notificationHash === hash);
    if (byHash) {
      return { created: false, duplicate: true, candidateId: byHash.id };
    }
    const near = this.candidates.find(
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
    const candidate: AutoBillCandidate = {
      id: uid(),
      sourceApp: input.sourceApp,
      source: input.parsed?.source ?? sourceFromLabel(input.sourceApp),
      rawText: input.rawText,
      merchant,
      amount,
      type,
      suggestCategoryId: input.parsed?.suggestCategoryId,
      confidence: input.parsed?.confidence,
      transactionTime: input.postedAt,
      status: 'WAIT_CONFIRM',
      notificationHash: hash,
      createdAt: Date.now(),
    };
    this.candidates.push(candidate);
    return { created: true, duplicate: false, candidateId: candidate.id };
  }

  async listCandidates(status: AutoBillCandidateStatus = 'WAIT_CONFIRM'): Promise<AutoBillCandidate[]> {
    return this.candidates.filter((c) => c.status === status).sort((a, b) => b.createdAt - a.createdAt);
  }
  async countWaitConfirm(): Promise<number> {
    return this.candidates.filter((c) => c.status === 'WAIT_CONFIRM').length;
  }
  async getCandidate(id: string): Promise<AutoBillCandidate | undefined> {
    return this.candidates.find((c) => c.id === id);
  }
  async existsHash(hash: string): Promise<boolean> {
    return this.candidates.some((c) => c.notificationHash === hash);
  }
  async confirm(id: string): Promise<Bill> {
    const idx = this.candidates.findIndex((c) => c.id === id);
    if (idx < 0 || this.candidates[idx].status !== 'WAIT_CONFIRM') throw new Error('candidate-not-found');
    const candidate = this.candidates[idx];
    const bill = buildBillFromCandidate(candidate, undefined);
    this.bills.push(bill);
    // 2.16.3：保留记录，置为已确认（不删除）
    this.candidates[idx] = { ...candidate, status: 'CONFIRMED' };
    return bill;
  }
  async ignore(id: string): Promise<void> {
    const c = this.candidates.find((x) => x.id === id);
    if (c) c.status = 'IGNORED';
  }
}

/** 组装服务注册表（单例） */
export function createServiceRegistry(): IServiceRegistry {
  return {
    bills: new MemoryBillService(),
    categories: new MemoryCategoryService(),
    recurringRules: new MemoryRecurringRuleService(),
    settings: new MemorySettingsService(),
    backup: new MemoryBackupService(),
    autoBill: new MemoryAutoBillService(),
  };
}
