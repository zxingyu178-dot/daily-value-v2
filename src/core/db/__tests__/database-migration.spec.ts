/**
 * Daily Value v2 - DB schema 升级迁移测试（Phase 7A）
 * 目标：现有 v2 库（bills/categories/settings/meta）在升级到含 recurringRules 的更高版本时，
 *       不清库、不丢数据；新增 recurringRules store。对应 Handoff 的 DB_MIGRATION_TEST。
 */
import { describe, it, expect } from 'vitest';
import { openDB } from 'idb';
import { openDatabase, DB_NAME, DB_VERSION } from '@/core/db/database';
import { services } from '@/core/services';
import type { Bill } from '@/core/models/types';

/**
 * 模拟旧版本数据库：先用旧版 build（不含 recurringRules）建库 + 写入数据并关闭，
 * 再通过 openDatabase()（当前 DB_VERSION）升级打开。
 * 由于 openDatabase 的 dbPromise 为模块单例（本测试文件内首次调用），能触发升级路径。
 */
async function createOldVersionDbAndSeed(): Promise<void> {
  // 关闭可能存在的连接，保证模拟"旧库已存在"
  const old = await openDB<{
    bills: { key: string; value: Bill; indexes?: { 'by-date': string } };
    categories: { key: string; value: unknown };
    settings: { key: string; value: unknown };
    meta: { key: string; value: unknown };
  }>(DB_NAME, 1, {
    upgrade(db) {
      // 旧版本没有 recurringRules store
      if (!db.objectStoreNames.contains('bills')) db.createObjectStore('bills', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('categories')) db.createObjectStore('categories', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('settings')) db.createObjectStore('settings', { keyPath: 'key' });
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'key' });
    },
  });
  // 写入一笔旧账单 + 旧设置，验证升级后仍在
  await old.put('bills', {
    id: 'legacy-bill-1',
    type: 'expense',
    amount: 999,
    categoryId: 'c-food',
    categoryEmoji: '🍚',
    categoryName: '餐饮',
    note: '历史账单',
    date: '2026-01-15',
    timestamp: 1768521600000,
    source: 'manual',
    ledgerImpact: 'normal',
  });
  await old.put('settings', { key: 'main', value: { currency: '¥', theme: 'auto', themeColor: 'violet', sort: 'per' } });
  old.close();
}

describe('DB 版本升级不丢数据（DB_MIGRATION_TEST）', () => {
  it(`当前 DB_VERSION 为 ${DB_VERSION}（已验证含 recurringRules）`, async () => {
    expect(DB_VERSION).toBeGreaterThanOrEqual(2);
  });

  it('旧库（v1，无 recurringRules）升级后：老数据保留 + 新增 recurringRules 可读可写', async () => {
    await createOldVersionDbAndSeed();

    const db = await openDatabase();
    const storeNames = Array.from(db.objectStoreNames);
    expect(storeNames).toContain('recurringRules');

    // 老账单仍在
    const legacy = await db.get('bills', 'legacy-bill-1');
    expect((legacy as Bill).amount).toBe(999);
    expect((legacy as Bill).note).toBe('历史账单');

    // 老设置仍在
    const settingsRow = (await db.get('settings', 'main')) as { value: { theme: string } };
    expect(settingsRow.value.theme).toBe('auto');

    // 新表可写可读（周期规则）
    const rule = await services.recurringRules.add({
      enabled: true,
      type: 'expense',
      amount: 2500,
      categoryId: 'c-food',
      categoryEmoji: '🍚',
      categoryName: '餐饮',
      note: '房租',
      frequency: 'monthly',
      interval: 1,
      day: 1,
      month: 1,
      startDate: '2026-08-01',
      time: '09:00',
    });
    expect((await services.recurringRules.get(rule.id))?.note).toBe('房租');

    // 清库，避免污染其他用例（本文件无 beforeEach，需显式处理）
    await services.recurringRules.remove(rule.id);
    await db.delete('bills', 'legacy-bill-1');
    await db.delete('settings', 'main');
  });
});