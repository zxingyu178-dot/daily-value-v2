/**
 * Daily Value v2 - service 注册表入口
 * 应用启动时在此初始化并持有唯一 service 实例（IndexedDB 实现，Phase 1）。
 * initCore：确保核心分类 + 预置分类存在，并对 2.9.5 遗留的「强制不可删除预设分类」做幂等
 * reconciliation（重复分类合并 / 降级为可编辑预置 / 删除不复活）。
 */
import { openDatabase } from '@/core/db/database';
import type { IServiceRegistry } from '@/core/services/types';
import { createIdbServiceRegistry } from '@/core/services/idb';
import type { Bill, Category, RecurringRule } from '@/core/models/types';
import {
  CORE_BUILTINS,
  DEFAULT_PRESETS,
  LEGACY_FIXED_PRESET_IDS,
} from '@/core/models/category-defs';

/** 全局唯一服务注册表（IndexedDB 实现） */
export const services: IServiceRegistry = createIdbServiceRegistry();

export interface InitCoreResult {
  /** 本次实际写入/更新过的分类 id */
  touched: string[];
  /** 降级为 builtin=false 的旧固定预置分类 id */
  demotedToPreset: string[];
  /** 与同名用户自定义分类合并后删除的固定分类 id */
  mergedAway: string[];
  /** 补齐新增的预置分类 id */
  addedPresets: string[];
}

const META_KEY = 'main';

/** 读取 meta（与 settings 同一 key 存储，避免多开 DB 事务） */
async function readMeta(db: import('idb').IDBPDatabase<import('@/core/db/database').DvSchema>): Promise<Record<string, unknown>> {
  const row = (await db.get('settings', META_KEY)) as { key: string; value: Record<string, unknown> } | undefined;
  return row?.value ?? {};
}

async function writeMeta(db: import('idb').IDBPDatabase<import('@/core/db/database').DvSchema>, meta: Record<string, unknown>): Promise<void> {
  const existing = (await db.get('settings', META_KEY)) as { key: string; value: Record<string, unknown> } | undefined;
  await db.put('settings', { key: META_KEY, value: { ...(existing?.value ?? {}), ...meta } });
}

/** 将某固定分类 id 的引用（Bill / RecurringRule）迁移到目标分类 id */
async function migrateReferences(db: import('idb').IDBPDatabase<import('@/core/db/database').DvSchema>, fromId: string, toId: string): Promise<void> {
  const bills = (await db.getAll('bills')) as Bill[];
  const rules = (await db.getAll('recurringRules')) as RecurringRule[];
  const billIds = bills.filter((b) => b.categoryId === fromId).map((b) => b.id);
  const ruleIds = rules.filter((r) => r.categoryId === fromId).map((r) => r.id);
  if (billIds.length === 0 && ruleIds.length === 0) return;
  const tx = db.transaction(['bills', 'recurringRules'], 'readwrite');
  for (const id of billIds) {
    const b = bills.find((x) => x.id === id);
    if (b) tx.objectStore('bills').put({ ...b, categoryId: toId });
  }
  for (const id of ruleIds) {
    const r = rules.find((x) => x.id === id);
    if (r) tx.objectStore('recurringRules').put({ ...r, categoryId: toId, updatedAt: Date.now() });
  }
  await tx.done;
}

/**
 * 初始化核心数据层：确保分类体系正确（幂等）。
 * - 首装（无任何分类）：整写 CORE_BUILTINS + DEFAULT_PRESETS。
 * - 老用户升级（含 2.9.5/2.9.6 数据）：
 *   A. 同名合并：若某固定预置分类（如 c-drink 饮料）与用户自定义分类（饮料）重名，
 *      用户自定义分类为 canonical → 把固定分类的 Bill/RecurringRule 引用迁移到用户分类 → 删除固定分类。
 *   B. 降级：固定预置存在但 builtin=true（2.9.5 错标）→ 降级为 builtin=false（可编辑/删除）。
 *   C. 补齐：缺失的核心分类必须补齐；缺失的预置分类补齐（曾被用户删除的 id 不复活）。
 * - 删除不复活：用户删除的预置分类 id 记录在 meta.$$presetDeleted，补齐时跳过该 id。
 */
export async function initCore(): Promise<InitCoreResult> {
  const db = await openDatabase();
  const existing = (await db.getAll('categories')) as Category[];
  const meta = await readMeta(db);
  const presetDeleted = new Set<string>((meta.$$presetDeleted as string[] | undefined) ?? []);

  const result: InitCoreResult = { touched: [], demotedToPreset: [], mergedAway: [], addedPresets: [] };
  const isFresh = existing.length === 0;
  const existingById: Record<string, Category> = {};
  const existingIds = new Set<string>();
  for (const c of existing) {
    existingIds.add(c.id);
    existingById[c.id] = c;
  }

  const writes: Category[] = [];
  const toDelete: string[] = [];

  if (isFresh) {
    writes.push(...CORE_BUILTINS, ...DEFAULT_PRESETS);
  }

  // ---- 1. 老用户升级：对每个固定预置分类做 reconciliation ----
  for (const preset of DEFAULT_PRESETS) {
    const prev = existingById[preset.id];
    if (!prev) {
      // 缺：补齐；但曾被用户删除则跳过（不复活）
      if (presetDeleted.has(preset.id) && !isFresh) continue;
      writes.push({ ...preset, builtin: false });
      if (!isFresh) result.addedPresets.push(preset.id);
      result.touched.push(preset.id);
      continue;
    }
    // 存在：检查是否有同名用户自定义分类（canonical 合并）
    const sameNameCustom = existing.find(
      (c) => c.id !== preset.id && !c.builtin && c.name.trim() === prev.name.trim(),
    );
    if (sameNameCustom) {
      // A. 同名合并：固定分类让位于用户自定义分类
      await migrateReferences(db, prev.id, sameNameCustom.id);
      toDelete.push(prev.id);
      presetDeleted.add(prev.id); // 阻止未来复活
      result.mergedAway.push(prev.id);
      result.touched.push(prev.id);
      continue;
    }
    if (prev.builtin) {
      // B. 2.9.5 错标为核心：降级为可编辑/删除的预置
      writes.push({ ...prev, builtin: false });
      result.demotedToPreset.push(prev.id);
      result.touched.push(prev.id);
    }
    // else：已是 builtin=false 的预置，保持不变
  }

  // ---- 2. 核心分类必须存在（🔒 不可删） ----
  for (const core of CORE_BUILTINS) {
    if (!existingIds.has(core.id)) {
      writes.push(core);
      result.touched.push(core.id);
    }
  }

  // ---- 3. 图标补齐：旧数据内置分类（如 2.9.5 前的核心 5 类，仅有 emoji、无 iconType/iconValue）
  //           补齐本地 SVG 图标（iconType=builtin + 规范 iconValue），实现图标体系真正统一。
  //           幂等：仅当 iconType 缺失时才补齐；用户已编辑过的图标 / 名称一律不动。
  for (const def of [...CORE_BUILTINS, ...DEFAULT_PRESETS]) {
    const prev = existingById[def.id];
    if (prev && !prev.iconType && !toDelete.includes(prev.id)) {
      writes.push({ ...prev, iconType: 'builtin', iconValue: def.iconValue });
      result.touched.push(def.id);
    }
  }

  if (writes.length > 0) {
    const tx = db.transaction('categories', 'readwrite');
    for (const c of writes) tx.store.put(c);
    await tx.done;
  }
  if (toDelete.length > 0) {
    const tx = db.transaction('categories', 'readwrite');
    for (const id of toDelete) tx.store.delete(id);
    await tx.done;
  }
  await writeMeta(db, { $$presetDeleted: [...presetDeleted] });

  return result;
}

/** 分类管理器删除一个预置分类时调用：记录「已删除」以阻止 initCore 未来复活它 */
export async function recordPresetDeletion(removedId: string): Promise<void> {
  if (!LEGACY_FIXED_PRESET_IDS.includes(removedId)) return;
  const db = await openDatabase();
  const meta = await readMeta(db);
  const presetDeleted = new Set<string>((meta.$$presetDeleted as string[] | undefined) ?? []);
  presetDeleted.add(removedId);
  await writeMeta(db, { $$presetDeleted: [...presetDeleted] });
}
