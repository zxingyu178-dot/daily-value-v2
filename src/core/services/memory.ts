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
  IStorageService,
} from '@/core/services/types';
import type { Bill, Category, RecurringRule, Settings } from '@/core/models/types';
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

/** 组装服务注册表（单例） */
export function createServiceRegistry(): IServiceRegistry {
  return {
    bills: new MemoryBillService(),
    categories: new MemoryCategoryService(),
    recurringRules: new MemoryRecurringRuleService(),
    settings: new MemorySettingsService(),
  };
}
