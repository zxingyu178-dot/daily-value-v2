/**
 * Daily Value v2 - v1 → v2 数据迁移（账单 / 分类 / 日价）
 *
 * 迁移口径（Phase 2 定稿）：
 * - 账单（dv-ledger:v1）→ normal Bill（id/type/amount/category/emoji/note/date/timestamp，
 *   source=import；transfer：direction=out→expense、direction=in→income，保留 transferDirection）
 * - 分类：系统内置 5 类使用固定 id；额外分类只根据账单中实际使用过的分类重建
 *   （处理重名 / emoji 不同 / 空分类 / 缺失 emoji / 自定义分类）
 * - 日价物品（item-value-calculator:v1）→ daily-value-only Bill（Bill+dailyValue+ledgerImpact='daily-value-only'）：
 *   可出现在日价模块、计算每日价值，但不进入账单时间线/月度支出/统计，不改变用户原有现金流。
 *   DailyValue.startDate = purchaseDate，日价动态计算 amount/elapsedDays（不固化摊销天数）
 * - 图片（v1 dv-images/images）本阶段不迁移，结果记录在 MIGRATION_REPORT
 *
 * 安全：up 幂等（先清空 v2 目标存储再写入）；dataVersion/migrated 由管理器在全部校验通过后统一写入。
 */
import type { Migration, MigrationContext } from '@/core/migration/types';
import { readV1Data, type V1Item, type V1LedgerEntry } from '@/core/migration/v1-reader';
import type { Bill, Category } from '@/core/models/types';
// 2.9.7 统一真源：核心内置分类 + 默认预置分类（与 services/index.ts / category-defs.ts 一致，
// 禁止在迁移里再硬编码一套「核心分类」）
import { BUILTIN_CATEGORIES } from '@/core/models/category-defs';

/** 日价物品专用分类（仅在有 v1 日价物品时创建） */
const DAILY_VALUE_CATEGORY: Category = {
  id: 'c-daily-value',
  name: '日价物品',
  emoji: '💎',
  builtin: false,
  sort: 99,
};

const DEFAULT_CATEGORY = { name: '未分类', emoji: '📦' };

/**
 * 构建"分类名 → Category"字典（仅账单中实际使用过的分类；内置按固定 id 匹配）。
 * - 内置分类（餐饮/交通/购物/娱乐/生活）→ 固定 id
 * - 其余 → 自定义分类（按首次出现顺序分配稳定 id：mig-cat-N）
 * - 重名合并（首个出现的 emoji 生效）；空分类 → 未分类📦；缺失 emoji → 📦
 */
function buildCategoryMap(ledger: V1LedgerEntry[]): Map<string, Category> {
  const map = new Map<string, Category>();
  // 预置内置分类
  for (const c of BUILTIN_CATEGORIES) map.set(c.name, c);
  let customIndex = 0;
  for (const e of ledger) {
    const rawName = (e.category ?? '').trim();
    const name = rawName || DEFAULT_CATEGORY.name;
    if (map.has(name)) continue; // 已存在（内置或已建自定义），重名合并
    const emoji = (e.emoji ?? '').trim() || DEFAULT_CATEGORY.emoji;
    customIndex += 1;
    map.set(name, {
      id: `mig-cat-${customIndex}`,
      name,
      emoji,
      builtin: false,
      sort: 100 + customIndex,
    });
  }
  return map;
}

/** v1 transfer 映射为 v2 type（保持 v1 统计语义：out=支出、in=收入） */
function mapV1Type(e: V1LedgerEntry): { type: Bill['type']; transferDirection?: 'out' | 'in' } {
  if (e.type === 'expense') return { type: 'expense' };
  if (e.type === 'income') return { type: 'income' };
  // transfer
  if (e.direction === 'in') return { type: 'income', transferDirection: 'in' };
  return { type: 'expense', transferDirection: 'out' };
}

export const v1ToV2Migration: Migration = {
  version: 1,
  name: 'v1-to-v2（账单/分类/日价）',
  async up(ctx: MigrationContext): Promise<void> {
    const db = ctx.db;
    const v1 = readV1Data();
    const ledger = Array.isArray(v1.ledger) ? v1.ledger : [];
    const items = Array.isArray(v1.items) ? v1.items : [];

    // ---- 1. 幂等：清空 v2 目标存储（迁移数据完全由 v1 派生，可安全重建） ----
    {
      const stores = ['bills', 'categories'] as const;
      const tx = db.transaction(stores, 'readwrite');
      for (const store of stores) tx.objectStore(store).clear();
      await tx.done;
    }

    // ---- 2. 分类：内置（固定 id，核心 + 预置）+ 账单实际使用过的自定义分类 ----
    const categoryMap = buildCategoryMap(ledger);
    // 预置分类也是 builtin=false，但属于系统预置（固定 id），不计入「用户自定义分类」
    const presetIds = new Set(BUILTIN_CATEGORIES.map((c) => c.id));
    const customCategories: Category[] = [...categoryMap.values()].filter(
      (c) => !c.builtin && !presetIds.has(c.id),
    );
    const categoriesToWrite: Category[] = [...BUILTIN_CATEGORIES, ...customCategories];
    if (items.length > 0) categoriesToWrite.push(DAILY_VALUE_CATEGORY);

    {
      const tx = db.transaction('categories', 'readwrite');
      for (const c of categoriesToWrite) tx.store.put(c);
      await tx.done;
    }
    ctx.log(`分类写入 ${categoriesToWrite.length}（内置 ${BUILTIN_CATEGORIES.length} + 自定义 ${customCategories.length} + 日价 ${items.length > 0 ? 1 : 0}）`);

    // ---- 3. 账单：dv-ledger:v1 → normal Bill ----
    const normalBills: Bill[] = [];
    for (const e of ledger) {
      const rawName = (e.category ?? '').trim();
      const name = rawName || DEFAULT_CATEGORY.name;
      const cat = categoryMap.get(name) ?? {
        id: 'c-life',
        name: '生活',
        emoji: '🏠',
        builtin: true,
        sort: 5,
      };
      const { type, transferDirection } = mapV1Type(e);
      normalBills.push({
        id: String(e.id),
        type,
        amount: Number(e.amount) || 0,
        categoryId: cat.id,
        categoryEmoji: cat.emoji,
        categoryName: cat.name,
        note: e.note ?? '',
        date: e.date,
        timestamp: e.timestamp ?? Date.now(),
        source: 'import',
        ledgerImpact: 'normal',
        transferDirection,
      });
    }

    // ---- 4. 日价物品：item-value-calculator:v1 → daily-value-only Bill ----
    // 名称语义（Phase 3 前置修正）：物品名称存 Bill.title，categoryName 只存真实分类名（日价物品），
    // 不再长期借用 categoryName 保存物品名；旧数据向前兼容（读取用 title ?? categoryName）。
    const dailyValueBills: Bill[] = [];
    items.forEach((it, index) => {
      const purchaseDate = it.purchaseDate || todayLocal();
      dailyValueBills.push({
        id: itemId(it, index),
        type: 'expense',
        amount: Number(it.price) || 0,
        categoryId: DAILY_VALUE_CATEGORY.id,
        categoryEmoji: DAILY_VALUE_CATEGORY.emoji,
        categoryName: DAILY_VALUE_CATEGORY.name,
        title: it.name || '未命名物品',
        note: it.note ?? '',
        date: purchaseDate,
        timestamp: it.createdAt ?? Date.now(),
        source: 'import',
        ledgerImpact: 'daily-value-only',
        dailyValue: { enabled: true, mode: 'elapsed', startDate: purchaseDate },
      });
    });

    {
      const tx = db.transaction('bills', 'readwrite');
      for (const b of normalBills) tx.store.put(b);
      for (const b of dailyValueBills) tx.store.put(b);
      await tx.done;
    }
    ctx.log(`账单写入 normal=${normalBills.length}，日价=${dailyValueBills.length}`);

    // ---- 5. 数量校验（CountCheck） ----
    const distinctCustom = [...categoryMap.values()].filter(
      (c) => !c.builtin && !presetIds.has(c.id),
    ).length;
    ctx.addCount({ label: 'bills', source: ledger.length, migrated: normalBills.length, pass: normalBills.length === ledger.length });
    ctx.addCount({ label: 'daily-value-items', source: items.length, migrated: dailyValueBills.length, pass: dailyValueBills.length === items.length });
    ctx.addCount({
      label: 'custom-categories',
      source: distinctCustom,
      migrated: customCategories.length,
      pass: customCategories.length === distinctCustom,
    });
    // 5.1 实际 IndexedDB 写入后数量验证（不止比较内存数组长度）
    {
      const written = (await db.getAll('bills')) as Bill[];
      const writtenNormalList = written.filter((b) => b.ledgerImpact !== 'daily-value-only');
      const writtenDailyList = written.filter((b) => b.ledgerImpact === 'daily-value-only');
      ctx.addCount({
        label: 'bills-write',
        source: ledger.length,
        migrated: writtenNormalList.length,
        pass: writtenNormalList.length === ledger.length,
        note: 'IndexedDB 实际写入后验证',
      });
      ctx.addCount({
        label: 'daily-value-items-write',
        source: items.length,
        migrated: writtenDailyList.length,
        pass: writtenDailyList.length === items.length,
        note: 'IndexedDB 实际写入后验证',
      });
      // 日价物品 id 唯一性验证（缺失 id 的 v1 物品不能互相覆盖）
      const ids = writtenDailyList.map((b) => b.id);
      ctx.addCount({
        label: 'daily-value-id-unique',
        source: items.length,
        migrated: new Set(ids).size,
        pass: new Set(ids).size === items.length,
        note: '写入后日价物品 id 去重验证',
      });
    }

    // ---- 6. 内容校验（ContentCheck） ----
    // 6.1 支出合计（expense + transfer-out）在 v1 与 v2 一致
    const v1Expense = ledger.reduce((s, e) => {
      if (e.type === 'expense') return s + (Number(e.amount) || 0);
      if (e.type === 'transfer' && e.direction !== 'in') return s + (Number(e.amount) || 0);
      return s;
    }, 0);
    const v2Expense = normalBills.filter((b) => b.type === 'expense').reduce((s, b) => s + b.amount, 0);
    const expensePass = Math.abs(v2Expense - v1Expense) < 0.001;
    ctx.addContent({
      label: 'expense-total',
      source: `v1 支出合计 ${round(v1Expense)}`,
      migrated: `v2 支出合计 ${round(v2Expense)}`,
      pass: expensePass,
    });
    // 6.2 收入合计（income + transfer-in）一致
    const v1Income = ledger.reduce((s, e) => {
      if (e.type === 'income') return s + (Number(e.amount) || 0);
      if (e.type === 'transfer' && e.direction === 'in') return s + (Number(e.amount) || 0);
      return s;
    }, 0);
    const v2Income = normalBills.filter((b) => b.type === 'income').reduce((s, b) => s + b.amount, 0);
    ctx.addContent({
      label: 'income-total',
      source: `v1 收入合计 ${round(v1Income)}`,
      migrated: `v2 收入合计 ${round(v2Income)}`,
      pass: Math.abs(v2Income - v1Income) < 0.001,
    });
    // 6.3 transfer 数量与方向保留
    const v1Transfers = ledger.filter((e) => e.type === 'transfer').length;
    const v2Transfers = normalBills.filter((b) => b.transferDirection).length;
    ctx.addContent({
      label: 'transfer-map',
      source: `v1 transfer=${v1Transfers}`,
      migrated: `v2 保留 transferDirection=${v2Transfers}`,
      pass: v2Transfers === v1Transfers,
    });
    // 6.4 日价不污染账单统计：所有 daily-value-only 账单不得进入 normal 口径
    ctx.addContent({
      label: 'ledger-scope-isolation',
      source: `日价物品 ${items.length} 条`,
      migrated: `全部为 ledgerImpact=daily-value-only，不进入账单/统计`,
      pass: dailyValueBills.every((b) => b.ledgerImpact === 'daily-value-only'),
    });
    // 6.5 日价未固化摊销天数：迁移后不写入 durationDays/elapsedDays
    ctx.addContent({
      label: 'daily-value-dynamic',
      source: 'v1 日价 = price / daysSince(purchaseDate)',
      migrated: 'v2 DailyValue 仅存 enabled/startDate，无固定 durationDays，显示时动态计算',
      pass: dailyValueBills.every(
        (b) => !('durationDays' in (b.dailyValue ?? {})) && !('elapsedDays' in (b.dailyValue ?? {})),
      ),
    });
    // 6.6 图片：本阶段不迁移（记录结果，不阻塞核心数据）
    ctx.addContent({
      label: 'images',
      source: 'v1 日价图片存于 IndexedDB dv-images/images',
      migrated: 'Phase 2 不迁移图片（避免大体积 base64 搬运风险），已记录待 Phase 3 处理',
      pass: true,
    });

    // ---- 7. 保留 v1 localStorage（不删除；备份已在 manager 中执行） ----
    ctx.log(`迁移完成：normal=${normalBills.length}，daily-value=${dailyValueBills.length}，分类=${categoriesToWrite.length}`);
  },
};

function todayLocal(): string {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

function round(n: number): string {
  return Number(n.toFixed(2)).toString();
}

/**
 * 日价物品迁移 id（Phase 3 前置修正 C）：
 * - 有 v1 id → dv-<v1id>（保持原语义）
 * - 无 v1 id → 基于稳定字段（name/price/purchaseDate/note）哈希 + 原始数组 index 生成确定性 id，
 *   保证：多件无 id 物品互不覆盖、id 唯一、重试迁移生成相同 id。
 * 禁止使用 Date.now()/Math.random() 作为 fallback id（会破坏幂等）。
 */
function itemId(it: V1Item, index: number): string {
  if (it.id) return `dv-${it.id}`;
  const stable = [it.name ?? '', it.price ?? '', it.purchaseDate ?? '', it.note ?? ''].join('|');
  return `dv-mig-${index}-${hashString(stable)}`;
}

/** 确定性字符串哈希（djb2，非加密；仅用于生成稳定 id） */
function hashString(str: string): string {
  let h = 5381;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) + h + str.charCodeAt(i)) >>> 0;
  }
  return h.toString(36);
}
