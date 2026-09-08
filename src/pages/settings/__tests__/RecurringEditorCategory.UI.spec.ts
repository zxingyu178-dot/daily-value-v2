/**
 * Recurring Editor 分类选择 UI 测试（小Bug集中收尾）
 * CAT-R01..07：自定义分类（共享全局 Category Store）+ 删除 + Back LIFO。
 * jsdom 不参与真实布局像素，选中/写回/添加/删除/Back 以 DOM + Pinia store + back-handler 栈断言。
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { openDatabase } from '@/core/db/database';
import { services } from '@/core/services';
import { useCategoryStore } from '@/core/store/category';
import RecurringEditorSheet from '@/pages/settings/RecurringEditorSheet.vue';
import { __getBackOverlayStack } from '@/components/design/back-handler';
import type { Category, RecurringRule } from '@/core/models/types';

const STORES = ['bills', 'categories', 'settings', 'meta', 'recurringRules'] as const;

async function resetDb(): Promise<void> {
  const db = await openDatabase();
  const tx = db.transaction(STORES, 'readwrite');
  for (const s of STORES) tx.objectStore(s).clear();
  await tx.done;
  localStorage.clear();
  document.body.innerHTML = '';
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (__getBackOverlayStack() as unknown as Array<() => void>).length = 0;
}

async function seedCategory(name: string, emoji: string, sort: number): Promise<string> {
  const c = await services.categories.add({ name, emoji, builtin: true, sort });
  return c.id;
}

async function mountSheet(editing?: RecurringRule | null): Promise<ReturnType<typeof mount<typeof RecurringEditorSheet>>> {
  const pinia = createPinia();
  setActivePinia(pinia);
  const wrapper = mount(RecurringEditorSheet, { props: { modelValue: true, editing }, global: { plugins: [pinia] } });
  await flushPromises();
  await new Promise((r) => setTimeout(r, 0));
  await flushPromises();
  return wrapper;
}

async function openCategoryPicker(): Promise<void> {
  const row = document.querySelector<HTMLElement>('.rf-cat-row');
  expect(row).toBeTruthy();
  row!.click();
  await flushPromises();
  await new Promise((r) => setTimeout(r, 0));
  await flushPromises();
  expect(document.querySelector('.dvpc')).toBeTruthy();
}

/** 长按触发进入管理态（内置分类不可删，仅自定义分类可删） */
function longPressCell(cell: HTMLElement): void {
  cell.dispatchEvent(new Event('contextmenu'));
}

describe('Recurring Editor 自定义分类（CAT-R01..07）', () => {
  beforeEach(resetDb);

  it('CAT-R01 点击分类行打开自定义 Picker，选择已有分类写回 categoryId，无原生 select', async () => {
    await seedCategory('餐饮', '🍚', 1);
    const carId = await seedCategory('交通', '🚗', 2);
    await mountSheet();
    // 正式 Recurring 表单不存原生 <select>
    expect(document.querySelectorAll('.rr-form select').length).toBe(0);
    await openCategoryPicker();
    expect(document.querySelectorAll('.dvpc__cell').length).toBeGreaterThan(0);
    // Picker 覆盖层仍不出现原生 select
    expect(document.querySelectorAll('select').length).toBe(0);
    // 选择「交通」→ 行文本更新（写回 categoryId）
    const cell = [...document.querySelectorAll<HTMLElement>('.dvpc__cell')].find((c) => c.textContent!.includes('交通'));
    expect(cell).toBeTruthy();
    cell!.click();
    await flushPromises();
    expect(document.querySelector('.dvpc')).toBeFalsy(); // 点选即关闭
    const row = document.querySelector<HTMLElement>('.rf-cat-row');
    expect(row!.textContent).toContain('🚗');
    expect(row!.textContent).toContain('交通');
    void carId; // 引用保证分类存在
  });

  it('CAT-R02 周期页面新建自定义分类：点＋打开 DVCategoryManager create mode，保存后立即选中并关闭', async () => {
    await seedCategory('餐饮', '🍚', 1);
    await mountSheet();
    await openCategoryPicker();
    const addBtn = document.querySelector<HTMLElement>('.dvpc__cell--add');
    expect(addBtn).toBeTruthy();
    addBtn!.click();
    await flushPromises();
    // 唯一管理实现：Manager create mode 编辑区立即可见（图标 + 名称 + 保存/取消）
    expect(document.querySelector('.dvm__editor')).toBeTruthy();
    const nameInput = document.querySelector<HTMLInputElement>('input.dvm__editor-name')!;
    // FIX-03 图标可修改：点击图标框打开 DVCategoryIconPicker，选择「工资」内置图标（glyph 💰）
    document.querySelector<HTMLElement>('.dvm__editor-icon')!.click();
    await flushPromises();
    const salaryIcon = [...document.querySelectorAll<HTMLElement>('.dvic__icon')].find((b) =>
      b.textContent!.includes('工资'),
    );
    expect(salaryIcon).toBeTruthy();
    salaryIcon!.click();
    await flushPromises();
    nameInput.value = '工资';
    nameInput.dispatchEvent(new Event('input'));
    await flushPromises();
    document.querySelector<HTMLElement>('.dvm__editor-save')!.click();
    await flushPromises();
    await new Promise((r) => setTimeout(r, 0)); // 等 IndexedDB 写入 + 父级关闭 Picker 的异步链完成
    await flushPromises();
    // 自动选中新分类并关闭 Picker
    expect(document.querySelector('.dvpc')).toBeFalsy();
    const row = document.querySelector<HTMLElement>('.rf-cat-row');
    // 2.9.7 起分类图标统一经 DVCategoryIcon 渲染为本地 SVG（不再以 emoji 文本出现）
    expect(row!.querySelector('.dvci__svg')).toBeTruthy();
    expect(row!.textContent).toContain('工资');
    // 新分类已写入全局 DB（builtin=false 自定义）
    const cats = await services.categories.list();
    expect(cats.some((c) => c.name === '工资' && c.emoji === '💰' && !c.builtin)).toBe(true);
  });

  it('CAT-R03 周期页新建的自定义分类在普通记账可见（共享全局分类库）', async () => {
    await seedCategory('餐饮', '🍚', 1);
    await mountSheet();
    await openCategoryPicker();
    document.querySelector<HTMLElement>('.dvpc__cell--add')!.click();
    await flushPromises();
    const nameInput = document.querySelector<HTMLInputElement>('input.dvm__editor-name')!;
    nameInput.value = '退款';
    nameInput.dispatchEvent(new Event('input'));
    await flushPromises();
    document.querySelector<HTMLElement>('.dvm__editor-save')!.click();
    await flushPromises();
    await new Promise((r) => setTimeout(r, 0));
    await flushPromises();
    // 同一全局 store：周期记账与普通记账都从 categoryStore 读取
    const store = useCategoryStore();
    await store.load(true);
    expect(store.categories.some((c) => c.name === '退款' && !c.builtin)).toBe(true);
    // 已持久化，重新 load 仍可见（重启后普通记账可选用）
    const dbCats = await services.categories.list();
    expect(dbCats.some((c) => c.name === '退款')).toBe(true);
  });

  it('CAT-R04 自定义分类选中后保存规则正确（规则 categoryId = 新分类 id）', async () => {
    await seedCategory('餐饮', '🍚', 1);
    await mountSheet();
    await openCategoryPicker();
    document.querySelector<HTMLElement>('.dvpc__cell--add')!.click();
    await flushPromises();
    const nameInput = document.querySelector<HTMLInputElement>('input.dvm__editor-name')!;
    // FIX-03 图标可修改：点击图标框打开 DVCategoryIconPicker，选择「工资」内置图标（glyph 💰）
    document.querySelector<HTMLElement>('.dvm__editor-icon')!.click();
    await flushPromises();
    const salaryIcon = [...document.querySelectorAll<HTMLElement>('.dvic__icon')].find((b) =>
      b.textContent!.includes('工资'),
    );
    expect(salaryIcon).toBeTruthy();
    salaryIcon!.click();
    await flushPromises();
    nameInput.value = '工资';
    nameInput.dispatchEvent(new Event('input'));
    await flushPromises();
    document.querySelector<HTMLElement>('.dvm__editor-save')!.click();
    await flushPromises();
    await new Promise((r) => setTimeout(r, 0));
    await flushPromises();
    // 新分类 id 从 DB 取
    const cats = await services.categories.list();
    const custom = cats.find((c: Category) => c.name === '工资')!;
    expect(custom).toBeTruthy();
    // 填金额并保存
    const amountInput = document.querySelector<HTMLInputElement>('.dv-input__field--amount')!;
    amountInput.value = '4000';
    amountInput.dispatchEvent(new Event('input'));
    await flushPromises();
    document.querySelector<HTMLElement>('.rr-footer__save')!.click();
    await flushPromises();
    await new Promise((r) => setTimeout(r, 0));
    await flushPromises();
    const rules = await services.recurringRules.list();
    expect(rules).toHaveLength(1);
    expect(rules[0].categoryId).toBe(custom.id);
    expect(rules[0].categoryName).toBe('工资');
    expect(rules[0].categoryEmoji).toBe('💰');
  });

  it('CAT-R05 内置分类长按不进入管理；自定义分类长按打开统一 Manager', async () => {
    const foodId = await seedCategory('餐饮', '🍚', 1);
    // 手动加一个自定义分类用于触发管理态
    const custom = await services.categories.add({ name: '工资', emoji: '💰', builtin: false, sort: 100 });
    await mountSheet();
    await openCategoryPicker();
    const foodCell = [...document.querySelectorAll<HTMLElement>('.dvpc__cell')].find((c) => c.textContent!.includes('餐饮'))!;
    // 长按内置分类：不打开管理
    longPressCell(foodCell);
    await flushPromises();
    expect(document.querySelector('.dvm')).toBeFalsy();
    // 长按自定义分类：打开统一 Manager（显式「管理」按钮也常驻）
    const customCell = [...document.querySelectorAll<HTMLElement>('.dvpc__cell')].find((c) => c.textContent!.includes('工资'))!;
    longPressCell(customCell);
    await flushPromises();
    expect(document.querySelector('.dvm')).toBeTruthy();
    // 关闭 Manager，恢复 Picker
    document.querySelector<HTMLElement>('.dvm__done')!.click();
    await flushPromises();
    expect(document.querySelector('.dvm')).toBeFalsy();
    void foodId;
    void custom;
  });

  it('CAT-R06 自定义分类删除：Manager 删除 ✕ + DVConfirmDialog 确认', async () => {
    await seedCategory('餐饮', '🍚', 1);
    const custom = await services.categories.add({ name: '工资', emoji: '💰', builtin: false, sort: 100 });
    await mountSheet();
    await openCategoryPicker();
    // 显式「管理」入口打开统一 Manager
    document.querySelector<HTMLElement>('.dvpc__manage')!.click();
    await flushPromises();
    expect(document.querySelector('.dvm')).toBeTruthy();
    // 自定义分类行 → 删除 ✕ → DVConfirmDialog
    const row = [...document.querySelectorAll<HTMLElement>('.dvm__row')].find((r) =>
      r.textContent!.includes('工资'),
    )!;
    row.querySelector<HTMLElement>('.dvm__row-del')!.click();
    await flushPromises();
    // 2.9.8：askDelete 前置 countRecurringUsage 是异步检查，需再等 IDB 读完成才弹 Dialog
    await flushPromises();
    await new Promise((r) => setTimeout(r, 0));
    await flushPromises();
    expect(document.querySelector('.dvcd')).toBeTruthy(); // 自定义确认对话框（非 window.confirm）
    document.querySelector<HTMLElement>('.dvcd__btn--danger')!.click();
    await flushPromises();
    await new Promise((r) => setTimeout(r, 0));
    await flushPromises();
    const cats = await services.categories.list();
    expect(cats.some((c) => c.id === custom.id)).toBe(false);
    expect(cats.some((c) => c.name === '餐饮')).toBe(true); // 内置分类仍在
    // 关闭 Manager
    document.querySelector<HTMLElement>('.dvm__done')!.click();
    await flushPromises();
    expect(document.querySelector('.dvm')).toBeFalsy();
  });

  it('CAT-R07 Back 层级正常：添加（DVCategoryManager）→ CategoryPicker → RecurringSheet', async () => {
    await seedCategory('餐饮', '🍚', 1);
    await mountSheet();
    const stack0 = (__getBackOverlayStack() as unknown as Array<() => void>).length;
    expect(stack0).toBeGreaterThan(0); // Editor(DVSheet) 已入栈
    await openCategoryPicker();
    const stack1 = (__getBackOverlayStack() as unknown as Array<() => void>).length;
    expect(stack1).toBeGreaterThan(stack0); // Picker 压栈到最顶层
    // 点 ＋ 打开统一 Manager（create mode）
    document.querySelector<HTMLElement>('.dvpc__cell--add')!.click();
    await flushPromises();
    expect(document.querySelector('.dvm__editor')).toBeTruthy();
    const stack2 = (__getBackOverlayStack() as unknown as Array<() => void>).length;
    expect(stack2).toBeGreaterThan(stack1); // Manager 压栈到最顶层
    // 第一次 Back：取消新增编辑态 → 编辑区关闭，Manager 列表仍在
    (__getBackOverlayStack() as unknown as Array<() => void>).pop()!();
    await flushPromises();
    expect(document.querySelector('.dvm__editor')).toBeFalsy();
    expect(document.querySelector('.dvm')).toBeTruthy();
    // 第二次 Back：关闭 Manager，Picker 仍在
    (__getBackOverlayStack() as unknown as Array<() => void>).pop()!();
    await flushPromises();
    expect(document.querySelector('.dvm')).toBeFalsy();
    expect(document.querySelector('.dvpc')).toBeTruthy();
    // 第三次 Back：关闭 Picker，Editor 仍在
    (__getBackOverlayStack() as unknown as Array<() => void>).pop()!();
    await flushPromises();
    expect(document.querySelector('.dvpc')).toBeFalsy();
    expect(document.querySelector('.rr-form')).toBeTruthy();
  });

  it('CAT-R08 规则分类已被删除时：Editor 显示 fallback 未分类且不空白', async () => {
    // 引用一个不存在的分类 id（已被删除）
    const editing: RecurringRule = {
      id: 'rr-cat-gone', enabled: true, type: 'expense', amount: 20, categoryId: 'deleted-cat-x',
      categoryEmoji: '📄', categoryName: '已删除', note: '', frequency: 'monthly', interval: 1,
      day: 15, startDate: '2026-08-01', time: '09:00', createdAt: Date.now(),
    };
    await seedCategory('餐饮', '🍚', 1);
    await mountSheet(editing);
    const row = document.querySelector<HTMLElement>('.rf-cat-row');
    expect(row!.textContent).toContain('📄');
    expect(row!.textContent).toContain('未分类');
    // 打开分类 Picker 不因缺失 categoryId 空白崩溃
    await openCategoryPicker();
    expect(document.querySelectorAll('.dvpc__cell').length).toBeGreaterThan(0);
  });
});
