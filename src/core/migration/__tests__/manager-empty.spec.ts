import { describe, it, expect, beforeEach } from 'vitest';
import { openDatabase } from '@/core/db/database';
import { runMigrations } from '@/core/migration/manager';
import { CURRENT_DATA_VERSION } from '@/core/migration/types';

/**
 * 独立文件：本文件不得注册任何 Migration。
 * 验证 manager 在"需要迁移但未注册实际迁移"时的明确失败语义，
 * 以及全新安装 / 已是最新版本的正常路径（与注册状态无关）。
 */
const TEST_STORES = ['meta', 'bills', 'categories', 'settings', 'recurringRules'] as const;

async function resetDb(): Promise<void> {
  const db = await openDatabase();
  const tx = db.transaction(TEST_STORES, 'readwrite');
  for (const store of TEST_STORES) {
    tx.objectStore(store).clear();
  }
  await tx.done;
  localStorage.clear();
}

async function metaVersion(): Promise<number | null> {
  const db = await openDatabase();
  const row = await db.get('meta', 'dataVersion');
  return row ? Number((row as { value: unknown }).value) : null;
}

describe('migration manager（未注册迁移场景，独立模块上下文）', () => {
  beforeEach(resetDb);

  it('需要迁移但未注册任何实际迁移 → 明确失败（不允许"假完成"）', async () => {
    localStorage.setItem('dv-ledger:v1', JSON.stringify([{ id: '1', amount: 5 }]));
    const result = await runMigrations();
    expect(result.ok).toBe(false);
    expect(result.message).toContain('未注册任何实际迁移步骤');
    expect(await metaVersion()).toBeNull();
  });

  it('全新安装：无 v1 数据 → 直接初始化数据版本', async () => {
    const result = await runMigrations();
    expect(result.ok).toBe(true);
    expect(result.done).toBe(true);
    expect(await metaVersion()).toBe(CURRENT_DATA_VERSION);
  });

  it('已是最新数据版本 → done=true', async () => {
    const db = await openDatabase();
    await db.put('meta', { key: 'dataVersion', value: CURRENT_DATA_VERSION });
    const result = await runMigrations();
    expect(result.ok).toBe(true);
    expect(result.done).toBe(true);
    expect(result.message).toContain('已是最新数据版本');
  });
});
