/**
 * Daily Value v2 - 迁移管理器
 *
 * 安全模型（Phase 2 定稿）：
 *   读取 v1 → 迁移前备份 → 转换数据 → 写入 v2 → 完整验证（数量校验 + 内容校验）
 *   → 全部成功 → 最后才更新 dataVersion → 最后才写 migrated 标记。
 *
 * 任何失败：
 *   - 不得把 dataVersion 标记为成功版本
 *   - 不得把失败迁移标记为 migrated
 *   - 下一次启动必须仍然能够重新执行（to === from，校验仍在 meta 中可查）
 *   - 调用方（main.ts）应据此进入「数据升级未完成」安全流程
 *
 * 另外：需要迁移但未注册任何实际 Migration 时，返回明确失败状态，
 * 不允许出现"迁移完成"却什么都没做的模糊状态。
 */
import type { IDBPDatabase } from 'idb';
import { openDatabase, type DvSchema } from '@/core/db/database';
import {
  CURRENT_DATA_VERSION,
  type ContentCheck,
  type CountCheck,
  type Migration,
  type MigrationContext,
  type MigrationResult,
  type V1Backup,
} from '@/core/migration/types';
import { hasV1Data, hasV1ParseError, V1_KEYS } from '@/core/migration/v1-reader';

const META_VERSION_KEY = 'dataVersion';
const META_MIGRATED_PREFIX = 'v1-migrated:';
const META_BACKUP_KEY = 'v1-backup';

/**
 * 全新安装标记（2.10.8 Release Notes 复用）：
 * 仅在迁移管理器判定「全新安装 → 初始化数据版本」时写入一次；
 * 升级安装（dataVersion 已存在）不写。Release Notes 据此区分全新安装（不自动弹）
 * 与升级安装（自动弹一次），不另造一套安装检测系统。
 */
export const META_FRESH_INSTALL_KEY = 'freshInstallRegistered';

/** 已注册的迁移步骤（按 version 升序） */
const migrations: Migration[] = [];

export function registerMigration(migration: Migration): void {
  migrations.push(migration);
  migrations.sort((a, b) => a.version - b.version);
}

export function listMigrations(): ReadonlyArray<Migration> {
  return migrations;
}

async function getCurrentVersion(db: IDBPDatabase<DvSchema>): Promise<number> {
  const row = await db.get('meta', META_VERSION_KEY);
  return Number((row as { value?: unknown } | undefined)?.value ?? 0);
}

async function setVersion(db: IDBPDatabase<DvSchema>, version: number): Promise<void> {
  await db.put('meta', { key: META_VERSION_KEY, value: version });
}

/** 快照 v1 localStorage 数据（幂等：仅首次执行） */
async function backupV1Data(db: IDBPDatabase<DvSchema>): Promise<boolean> {
  const existing = await db.get('meta', META_BACKUP_KEY);
  if (existing) return false;
  const data: Record<string, unknown> = {};
  for (const key of Object.values(V1_KEYS)) {
    try {
      const raw = localStorage.getItem(key);
      if (raw != null) {
        try {
          data[key] = JSON.parse(raw);
        } catch {
          data[key] = raw; // 非 JSON，保留原文
        }
      }
    } catch {
      // 忽略单个键读取失败
    }
  }
  const backup: V1Backup = { timestamp: new Date().toISOString(), data };
  await db.put('meta', { key: META_BACKUP_KEY, value: backup });
  return true;
}

async function getV1Backup(db: IDBPDatabase<DvSchema>): Promise<V1Backup | undefined> {
  const row = await db.get('meta', META_BACKUP_KEY);
  return row ? (row as { value: V1Backup }).value : undefined;
}

function createContext(
  db: IDBPDatabase<DvSchema>,
  counts: CountCheck[],
  contents: ContentCheck[],
): MigrationContext {
  const log = (message: string) => {
    // eslint-disable-next-line no-console
    console.log(`[migration] ${message}`);
  };
  return {
    db,
    log,
    async backupV1() {
      const did = await backupV1Data(db);
      if (did) log('已备份 v1 数据到 IndexedDB meta');
    },
    getV1Backup() {
      return getV1Backup(db);
    },
    async markV1Migrated(key: string) {
      // 注：markV1Migrated 仅在全部验证通过后由管理器统一调用；
      // 迁移步骤内不应调用，避免失败时留下"已迁移"标记。
      await db.put('meta', { key: META_MIGRATED_PREFIX + key, value: true });
    },
    async isV1Migrated(key: string) {
      return Boolean(await db.get('meta', META_MIGRATED_PREFIX + key));
    },
    addCount(check: CountCheck) {
      counts.push(check);
    },
    addContent(check: ContentCheck) {
      contents.push(check);
    },
  };
}

/**
 * 执行迁移。
 * @returns ok=true：已是最新版本，或迁移全部通过并已写入 dataVersion；
 *          ok=false：迁移失败（未更新 dataVersion，下次启动可重试/进入安全流程）
 */
export async function runMigrations(): Promise<MigrationResult> {
  const db = await openDatabase();
  const from = await getCurrentVersion(db);
  if (from >= CURRENT_DATA_VERSION) {
    return { from, to: from, ok: true, message: '已是最新数据版本', done: true };
  }

  // 全新安装（无 v1 数据）→ 直接初始化数据版本，并写入「全新安装」标记
  // （供 Release Notes 区分全新/升级：升级安装的 dataVersion 已存在，不会走到这里）
  if (!hasV1Data() && from === 0) {
    await setVersion(db, CURRENT_DATA_VERSION);
    await db.put('meta', { key: META_FRESH_INSTALL_KEY, value: true });
    return {
      from,
      to: CURRENT_DATA_VERSION,
      ok: true,
      message: '全新安装，初始化数据版本',
      backedUp: false,
      done: true,
    };
  }

  // 有数据需要迁移但未注册实际 Migration → 明确失败，禁止"假完成"
  const pending = migrations.filter((m) => m.version > from);
  if (pending.length === 0) {
    const message = `需要迁移但未注册任何实际迁移步骤（dataVersion=${from}，current=${CURRENT_DATA_VERSION}）`;
    // eslint-disable-next-line no-console
    console.warn(`[migration] ${message}`);
    return { from, to: from, ok: false, message, backedUp: false, done: false };
  }

  const counts: CountCheck[] = [];
  const contents: ContentCheck[] = [];
  const ctx = createContext(db, counts, contents);

  // 迁移前备份 v1 数据（幂等；失败不阻塞，但需在结果中暴露）
  let backedUp = false;
  try {
    backedUp = await backupV1Data(db);
  } catch (err) {
    const message = `迁移前备份失败: ${String(err)}`;
    // eslint-disable-next-line no-console
    console.warn(`[migration] ${message}`);
    return { from, to: from, ok: false, message, counts, contents, backedUp, done: false };
  }

  // 检测 v1 核心数据损坏（JSON 解析失败，Phase 3 前置修正 D）：
  // 备份已保留原始字符串；此时必须返回失败并进入安全页，
  // 绝不把"解析失败"当作"没有数据"（0→0 校验通过 → dataVersion 误升级）。
  if (hasV1ParseError()) {
    const message = '检测到 v1 数据损坏（核心数据 JSON 解析失败），已进入安全模式，未升级数据';
    // eslint-disable-next-line no-console
    console.warn(`[migration] ${message}`);
    return { from, to: from, ok: false, message, counts, contents, backedUp, done: false };
  }

  // 执行迁移步骤：只暂存最新版本，验证全部通过前绝不写入 dataVersion
  let latestVersion = from;
  for (const m of pending) {
    try {
      await m.up(ctx);
      latestVersion = Math.max(latestVersion, m.version);
      ctx.log(`迁移完成 v${m.version}（${m.name}）`);
    } catch (err) {
      const message = `迁移失败 @v${m.version}（${m.name}）: ${String(err)}`;
      ctx.log(message);
      return { from, to: from, ok: false, message, counts, contents, backedUp, done: false };
    }
  }

  // 完整验证：数量校验 + 内容校验（任一不通过 → 标记失败，未更新 dataVersion）
  const failedCounts = counts.filter((c) => !c.pass);
  const failedContents = contents.filter((c) => !c.pass);
  if (failedCounts.length > 0 || failedContents.length > 0) {
    const reasons: string[] = [];
    if (failedCounts.length > 0) {
      reasons.push(`数量校验未通过: ${failedCounts.map((c) => `${c.label}(${c.source}->${c.migrated})`).join(', ')}`);
    }
    if (failedContents.length > 0) {
      reasons.push(`内容校验未通过: ${failedContents.map((c) => `${c.label}`).join(', ')}`);
    }
    const message = `迁移完成但校验未通过: ${reasons.join('; ')}`;
    ctx.log(message);
    return { from, to: from, ok: false, message, counts, contents, backedUp, done: false };
  }

  // 全部成功 → 最后才更新 dataVersion，最后才写 migrated 标记
  await setVersion(db, latestVersion);
  await ctx.markV1Migrated('done');
  ctx.log(`迁移全部完成，dataVersion=${latestVersion}，已写 migrated 标记`);
  return {
    from,
    to: latestVersion,
    ok: true,
    message: '迁移完成',
    counts,
    contents,
    backedUp,
    done: true,
  };
}
