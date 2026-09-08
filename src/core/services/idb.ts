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
} from '@/core/services/types';
import type { Bill, Category, RecurringRule, Settings } from '@/core/models/types';

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

/** 组装 IndexedDB 服务注册表（单例） */
export function createIdbServiceRegistry() {
  return {
    bills: new IdbBillService(),
    categories: new IdbCategoryService(),
    recurringRules: new IdbRecurringRuleService(),
    settings: new IdbSettingsService(),
  };
}
