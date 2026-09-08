import { describe, it, expect, beforeEach } from 'vitest';
import { openDatabase } from '@/core/db/database';
import { registerMigration, runMigrations } from '@/core/migration/manager';
import { CURRENT_DATA_VERSION } from '@/core/migration/types';

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

async function v1Backup(): Promise<unknown> {
  const db = await openDatabase();
  const row = await db.get('meta', 'v1-backup');
  return row ? (row as { value: unknown }).value : undefined;
}

async function migratedDone(): Promise<boolean> {
  const db = await openDatabase();
  return Boolean(await db.get('meta', 'v1-migrated:done'));
}

describe('migration manager 安全逻辑（含注册迁移）', () => {
  // 可控迁移行为：'ok' | 'fail-count'（校验不通过） | 'throw'（步骤抛错）
  let migrationMode: 'ok' | 'fail-count' | 'throw' = 'ok';
  let upCalls = 0;

  beforeEach(async () => {
    await resetDb();
    migrationMode = 'ok';
    upCalls = 0;
  });

  // 模块级一次性注册可配置假迁移
  registerMigration({
    version: 1,
    name: 'test-migration',
    up: async (ctx) => {
      upCalls += 1;
      ctx.addCount({ label: 'bills', source: 1, migrated: 1, pass: migrationMode !== 'fail-count' });
      ctx.addContent({ label: 'amount-total', source: '5', migrated: '5', pass: migrationMode !== 'fail-count' });
      if (migrationMode === 'throw') {
        throw new Error('boom');
      }
    },
  });

  it('升级：存在 v1 数据 → 迁移前备份 + 全部校验通过后才更新版本与 migrated', async () => {
    localStorage.setItem('dv-ledger:v1', JSON.stringify([{ id: '1', amount: 5 }]));
    const result = await runMigrations();
    expect(result.ok).toBe(true);
    expect(result.backedUp).toBe(true);
    expect(upCalls).toBe(1);
    expect(result.counts?.every((c) => c.pass)).toBe(true);
    expect(result.contents?.every((c) => c.pass)).toBe(true);
    expect(await metaVersion()).toBe(CURRENT_DATA_VERSION);
    expect(await migratedDone()).toBe(true);
    const backup = (await v1Backup()) as { data: Record<string, unknown> };
    expect(backup.data['dv-ledger:v1']).toBeDefined();
  });

  it('校验未通过 → ok=false，不更新 dataVersion，不写 migrated，to===from 下次可重试', async () => {
    localStorage.setItem('dv-ledger:v1', JSON.stringify([{ id: '1', amount: 5 }]));
    migrationMode = 'fail-count';
    const result = await runMigrations();
    expect(result.ok).toBe(false);
    expect(result.to).toBe(result.from);
    expect(result.counts?.some((c) => !c.pass)).toBe(true);
    // 关键：不得把 dataVersion 标记为成功版本
    expect(await metaVersion()).toBeNull();
    expect(await migratedDone()).toBe(false);
    // 下次启动仍会重新执行
    migrationMode = 'ok';
    const retry = await runMigrations();
    expect(retry.ok).toBe(true);
    expect(upCalls).toBe(2);
  });

  it('迁移步骤抛错 → ok=false，不更新 dataVersion，不写 migrated', async () => {
    localStorage.setItem('dv-ledger:v1', JSON.stringify([{ id: '1', amount: 5 }]));
    migrationMode = 'throw';
    const result = await runMigrations();
    expect(result.ok).toBe(false);
    expect(result.message).toContain('boom');
    expect(await metaVersion()).toBeNull();
    expect(await migratedDone()).toBe(false);
  });
});
