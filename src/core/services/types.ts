/**
 * Daily Value v2 - 数据层接口（service 契约）
 *
 * 架构约束（rules/Trae_Development_Rules.md）：
 * - 页面禁止直接操作 localStorage / IndexedDB
 * - 必须通过 service/store 层访问数据
 * - 本文件定义所有数据访问接口；Phase 1「Core Layer」落地 IndexedDB 实现
 */
import type { Bill, Category, RecurringRule, Settings } from '@/core/models/types';

/** 底层存储抽象（键值） */
export interface IStorageService {
  get<T>(key: string): Promise<T | undefined>;
  set<T>(key: string, value: T): Promise<void>;
  remove(key: string): Promise<void>;
  clear(): Promise<void>;
}

/** 账单仓库（唯一核心消费数据） */
export interface IBillService {
  list(): Promise<Bill[]>;
  listByMonth(ym: string): Promise<Bill[]>;
  get(id: string): Promise<Bill | undefined>;
  /** 可传入确定性 id（周期记账幂等用）；缺省自动生成 */
  add(bill: Omit<Bill, 'id'> & { id?: string }): Promise<Bill>;
  update(id: string, patch: Partial<Bill>): Promise<void>;
  remove(id: string): Promise<void>;
}

/** 分类仓库 */
export interface ICategoryService {
  list(): Promise<Category[]>;
  get(id: string): Promise<Category | undefined>;
  add(category: Omit<Category, 'id'>): Promise<Category>;
  update(id: string, patch: Partial<Category>): Promise<void>;
  remove(id: string): Promise<void>;
}

/** 周期规则仓库（生成 Bill 的来源，v2.0 暂不开放业务，仅保留接口） */
export interface IRecurringRuleService {
  list(): Promise<RecurringRule[]>;
  get(id: string): Promise<RecurringRule | undefined>;
  add(rule: Omit<RecurringRule, 'id' | 'createdAt'>): Promise<RecurringRule>;
  update(id: string, patch: Partial<RecurringRule>): Promise<void>;
  remove(id: string): Promise<void>;
}

/** 设置仓库 */
export interface ISettingsService {
  get(): Promise<Settings>;
  update(patch: Partial<Settings>): Promise<Settings>;
}

/** 统一服务入口：业务侧只依赖本接口获取各 service */
export interface IServiceRegistry {
  bills: IBillService;
  categories: ICategoryService;
  recurringRules: IRecurringRuleService;
  settings: ISettingsService;
}
