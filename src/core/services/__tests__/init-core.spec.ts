/**
 * initCore 幂等 reconciliation 测试（2.9.7 Category Final Refactor）
 * - CAT-DATA-01：2.9.6 数据（用户自定义「饮料」 + 固定 c-drink「饮料」）→ 升级后只剩一个饮料
 *   （用户自定义为 canonical，固定分类引用迁移过去并删除）
 * - CAT-DATA-02：额外默认分类没有重名 → builtin=false（降级），可删除，重启后不复活
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { openDatabase } from '@/core/db/database';
import { services } from '@/core/services';
import { initCore, recordPresetDeletion } from '@/core/services/index';
import { CORE_BUILTINS, DEFAULT_PRESETS } from '@/core/models/category-defs';
import type { Bill, Category, RecurringRule } from '@/core/models/types';

const TEST_STORES = ['bills', 'categories', 'settings', 'meta', 'recurringRules'] as const;

async function resetDb(): Promise<void> {
  const db = await openDatabase();
  const tx = db.transaction(TEST_STORES, 'readwrite');
  for (const store of TEST_STORES) tx.objectStore(store).clear();
  await tx.done;
  localStorage.clear();
}

function makeBill(over: Partial<Bill> = {}): Omit<Bill, 'id'> {
  return {
    type: 'expense',
    amount: 15,
    categoryId: 'c-drink',
    categoryEmoji: '🥤',
    categoryName: '饮料',
    note: '',
    date: '2026-08-20',
    timestamp: 1787310000000,
    source: 'manual',
    ledgerImpact: 'normal',
    ...over,
  };
}

/** 直接往 DB 写入 Category（模拟 2.9.5/2.9.6 旧数据） */
async function seedCategory(raw: Category): Promise<void> {
  const db = await openDatabase();
  const tx = db.transaction('categories', 'readwrite');
  tx.store.put(raw);
  await tx.done;
}

/** 直接往 DB 写入 RecurringRule（模拟旧数据引用固定分类） */
async function seedRule(raw: RecurringRule): Promise<void> {
  const db = await openDatabase();
  const tx = db.transaction('recurringRules', 'readwrite');
  tx.store.put(raw);
  await tx.done;
}

async function listCats(): Promise<Category[]> {
  return services.categories.list();
}

describe('initCore reconciliation（CAT-DATA-01/02）', () => {
  beforeEach(resetDb);

  it('CAT-DATA-01 2.9.6 数据：自定义「饮料」+ c-drink → 升级后只剩一个饮料，引用迁移', async () => {
    // 2.9.5/2.9.6 错标：c-drink 是 builtin=true 的固定分类
    await seedCategory({ ...DEFAULT_PRESETS.find((c) => c.id === 'c-drink')!, builtin: true });
    // 用户自定义「饮料」（builtin=false，用户自己的分类）
    const custom = { id: 'u-drink', name: '饮料', emoji: '🧋', builtin: false, sort: 90 };
    await seedCategory(custom);
    // 一条引用 c-drink 的旧账单 + 一条引用 c-drink 的周期规则
    await services.bills.add(makeBill({ id: 'b1' }));
    await seedRule({
      id: 'rr1', enabled: true, type: 'expense', amount: 10, categoryId: 'c-drink',
      categoryEmoji: '🥤', categoryName: '饮料', note: '', frequency: 'weekly', interval: 1,
      day: 1, startDate: '2026-08-01', time: '09:00', createdAt: Date.now(), updatedAt: Date.now(),
    });

    const result = await initCore();

    // c-drink 被合并删除，用户自定义分类为 canonical
    expect(result.mergedAway).toContain('c-drink');
    const cats = await listCats();
    const drinks = cats.filter((c) => c.name.trim() === '饮料');
    expect(drinks).toHaveLength(1);
    expect(drinks[0].id).toBe('u-drink');
    expect(cats.some((c) => c.id === 'c-drink')).toBe(false);
    // 核心 5 类仍在（🔒）
    for (const core of CORE_BUILTINS) {
      expect(cats.some((c) => c.id === core.id && c.builtin)).toBe(true);
    }
    // 引用迁移：旧账单 / 周期规则都指向用户自定义分类
    const bills = await services.bills.list();
    expect(bills.find((b) => b.id === 'b1')!.categoryId).toBe('u-drink');
    const rules = await services.recurringRules.list();
    expect(rules.find((r) => r.id === 'rr1')!.categoryId).toBe('u-drink');
  });

  it('CAT-DATA-02 无同名自定义：固定 c-drink 降级 builtin=false，可删除且重启后不复活', async () => {
    // 只有 2.9.5 遗留的 c-drink（builtin=true），无同名自定义
    await seedCategory({ ...DEFAULT_PRESETS.find((c) => c.id === 'c-drink')!, builtin: true });

    const first = await initCore();
    expect(first.demotedToPreset).toContain('c-drink');

    let cats = await listCats();
    const drink = cats.find((c) => c.id === 'c-drink')!;
    expect(drink.builtin).toBe(false); // 已降级为可编辑/删除的预置

    // 用户删除该预置分类
    await services.categories.remove('c-drink');
    await recordPresetDeletion('c-drink');
    cats = await listCats();
    expect(cats.some((c) => c.id === 'c-drink')).toBe(false);

    // 重启（再次 initCore）：不得复活 c-drink
    const second = await initCore();
    cats = await listCats();
    expect(cats.some((c) => c.id === 'c-drink')).toBe(false);
    expect(second.touched).not.toContain('c-drink');
  });

  it('DEFAULT_PRESETS 全部为 builtin=false（新装预置，用户可删/改），CORE 仅 5 类 builtin=true', async () => {
    for (const p of DEFAULT_PRESETS) expect(p.builtin).toBe(false);
    expect(CORE_BUILTINS).toHaveLength(5);
    for (const c of CORE_BUILTINS) expect(c.builtin).toBe(true);
    // 2.9.5 曾错标的 7 个固定分类都在 DEFAULT_PRESETS 中
    for (const id of ['c-drink', 'c-bill', 'c-salary', 'c-medical', 'c-housing', 'c-travel', 'c-other']) {
      expect(DEFAULT_PRESETS.some((c) => c.id === id)).toBe(true);
    }
  });

  it('CAT-ICON-04 旧数据核心分类（仅有 emoji、无 iconType）升级后补齐本地 SVG 图标', async () => {
    // 模拟 2.9.5 之前创建的核心分类：只有 emoji，没有 iconType/iconValue
    await seedCategory({ id: 'c-food', name: '餐饮', emoji: '🍚', builtin: true, sort: 1 });
    // 预置分类带 iconType 的不动
    await seedCategory({ ...DEFAULT_PRESETS.find((c) => c.id === 'c-drink')!, builtin: false });

    await initCore();
    const cats = await listCats();
    const food = cats.find((c) => c.id === 'c-food')!;
    expect(food.iconType).toBe('builtin');
    expect(food.iconValue).toBe('dining'); // 规范图标 id
    // 已有 iconType 的预置分类不被覆盖
    const drink = cats.find((c) => c.id === 'c-drink')!;
    expect(drink.iconType).toBe('builtin');
    expect(drink.iconValue).toBe('drink');
  });
});
