/**
 * Daily Value v2 - IndexedDB 数据库定义
 * 所有数据最终持久化于 IndexedDB（v1 依赖 localStorage + IDB 混合，v2 统一收口）。
 * 页面禁止直接访问本层，必须经 src/core/services 的 service 接口。
 */
import { openDB, type DBSchema, type IDBPDatabase } from 'idb';

/**
 * 数据库版本：数据版本变更时递增，触发 upgrade 迁移。
 * v2 起为 RecurringRule Store 建档；upgrade 内用 createObjectStoreIfMissing 幂等，
 * 升级不清库，已有 bills/categories/settings/meta 数据原样保留。
 * v3（2.15.0 Gate A）：新增 autoBillCandidates Store（自动记账待确认候选）。
 */
export const DB_VERSION = 3;
export const DB_NAME = 'daily-value-v2';

/** 对象仓库（Object Store）定义 */
export interface DvSchema extends DBSchema {
  bills: {
    key: string;
    value: unknown;
    indexes: { 'by-date': string };
  };
  categories: {
    key: string;
    value: unknown;
  };
  recurringRules: {
    key: string;
    value: unknown;
  };
  settings: {
    key: string;
    value: unknown;
  };
  meta: {
    key: string;
    value: unknown;
  };
  autoBillCandidates: {
    key: string;
    value: unknown;
    indexes: { 'by-created': number };
  };
}

let dbPromise: Promise<IDBPDatabase<DvSchema>> | null = null;

/** 打开数据库（惰性单例），upgrade 中建立对象仓库与索引 */
export function openDatabase(): Promise<IDBPDatabase<DvSchema>> {
  if (!dbPromise) {
    dbPromise = openDB<DvSchema>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('bills')) {
          const bills = db.createObjectStore('bills', { keyPath: 'id' });
          bills.createIndex('by-date', 'date');
        }
        if (!db.objectStoreNames.contains('categories')) {
          db.createObjectStore('categories', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('recurringRules')) {
          db.createObjectStore('recurringRules', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('settings')) {
          db.createObjectStore('settings', { keyPath: 'key' });
        }
        if (!db.objectStoreNames.contains('meta')) {
          db.createObjectStore('meta', { keyPath: 'key' });
        }
        // 2.15.0 Gate A：自动记账候选（升级不清库，仅新增 Store/索引）
        if (!db.objectStoreNames.contains('autoBillCandidates')) {
          const cand = db.createObjectStore('autoBillCandidates', { keyPath: 'id' });
          cand.createIndex('by-created', 'createdAt');
        }
      },
    });
  }
  return dbPromise;
}
