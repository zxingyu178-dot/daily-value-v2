/**
 * Recurring Editor 金额 / 备注真实测试（小Bug集中收尾）
 * RR-F01..04（金额布局/清洗/校验）+ RR-N01..03（备注新建/回显/只影响未来）。
 * 不依赖 DOM 存在性，直接断言最终持久化的 RecurringRule 数据与输入清洗结果。
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { openDatabase } from '@/core/db/database';
import { services } from '@/core/services';
import RecurringEditorSheet from '@/pages/settings/RecurringEditorSheet.vue';
import type { RecurringRule } from '@/core/models/types';

const STORES = ['bills', 'categories', 'settings', 'meta', 'recurringRules'] as const;

async function resetDb(): Promise<void> {
  const db = await openDatabase();
  const tx = db.transaction(STORES, 'readwrite');
  for (const s of STORES) tx.objectStore(s).clear();
  await tx.done;
  localStorage.clear();
  document.body.innerHTML = '';
}

async function seedCategory(): Promise<string> {
  const c = await services.categories.add({ name: '餐饮', emoji: '🍚', builtin: true, sort: 1 });
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

function amountInput(): HTMLInputElement {
  const el = document.querySelector<HTMLInputElement>('.dv-input__field--amount');
  expect(el).toBeTruthy();
  return el!;
}
function setAmount(value: string): void {
  const input = amountInput();
  input.value = value;
  input.dispatchEvent(new Event('input'));
}
function noteInput(): HTMLInputElement {
  const el = document.querySelector<HTMLInputElement>('input[placeholder="例如：工资 / Netflix / 房租"]');
  expect(el).toBeTruthy();
  return el!;
}
function setNote(value: string): void {
  const input = noteInput();
  input.value = value;
  input.dispatchEvent(new Event('input'));
}
async function clickSave(): Promise<void> {
  document.querySelector<HTMLElement>('.rr-footer__save')!.click();
  await flushPromises();
  await new Promise((r) => setTimeout(r, 0));
  await flushPromises();
}
async function listRules(): Promise<RecurringRule[]> {
  return (await services.recurringRules.list()) as RecurringRule[];
}

describe('Recurring Editor 金额（RR-F01..04）', () => {
  beforeEach(resetDb);

  it('RR-F01 金额不再右贴边：¥ 前缀 + 左对齐 + 放大字号（不改变全局默认右对齐）', async () => {
    await seedCategory();
    await mountSheet();
    const input = amountInput();
    // 显式启用 left/lg（全局 DVInput 默认仍为 right/md）
    expect(input.classList.contains('dv-input__field--left')).toBe(true);
    expect(input.classList.contains('dv-input__field--lg')).toBe(true);
    // ¥ 前缀明确显示在输入框内左侧
    expect(document.querySelector('.dv-input__prefix')?.textContent).toBe('¥');
  });

  it('RR-F02 0.5 / 12.50 / 4000 输入清洗正常', async () => {
    await seedCategory();
    await mountSheet();
    for (const [raw, expected] of [
      ['0.5', '0.5'],
      ['12.50', '12.50'],
      ['4000', '4000'],
    ] as Array<[string, string]>) {
      setAmount(raw);
      await flushPromises();
      expect(amountInput().value).toBe(expected);
    }
  });

  it('RR-F03 超过 2 位小数被规范（复用全局 amount sanitizer）', async () => {
    await seedCategory();
    await mountSheet();
    setAmount('12.345');
    await flushPromises();
    expect(amountInput().value).toBe('12.34');
    setAmount('123.456');
    await flushPromises();
    expect(amountInput().value).toBe('123.45');
    setAmount('0.999');
    await flushPromises();
    expect(amountInput().value).toBe('0.99');
  });

  it('RR-F04 金额 <= 0 禁止保存（不写库）；收入默认分类被清空时保存提示选择分类', async () => {
    await seedCategory();
    await mountSheet();
    // 空金额 → 禁止保存
    setAmount('');
    await clickSave();
    expect(await listRules()).toHaveLength(0);
    // 0 金额 → 禁止保存
    setAmount('0');
    await clickSave();
    expect(await listRules()).toHaveLength(0);
    // 切换到收入：默认 c-food 被清空 → 行显示「请选择分类」→ 保存仍禁止
    document.querySelectorAll<HTMLElement>('.rf-seg__item')[1].click(); // 收入
    await flushPromises();
    expect(document.querySelector<HTMLElement>('.rf-cat-row')!.textContent).toContain('请选择分类');
    setAmount('4000');
    await clickSave();
    expect(await listRules()).toHaveLength(0); // 未选分类不得写库
    // 明确选择分类后可保存
    document.querySelector<HTMLElement>('.rf-cat-row')!.click();
    await flushPromises();
    document.querySelector<HTMLElement>('.dvpc__cell')!.click();
    await flushPromises();
    await clickSave();
    const rules = await listRules();
    expect(rules).toHaveLength(1);
    expect(rules[0].type).toBe('income');
    expect(rules[0].amount).toBe(4000);
  });
});

describe('Recurring Editor 备注（RR-N01..03）', () => {
  beforeEach(resetDb);

  it('RR-N01 新建备注保存：规则 note 正确写入', async () => {
    await seedCategory();
    await mountSheet();
    setNote('工资');
    setAmount('8000');
    await clickSave();
    const rules = await listRules();
    expect(rules).toHaveLength(1);
    expect(rules[0].note).toBe('工资');
  });

  it('RR-N02 编辑已有规则备注正确回显', async () => {
    const foodId = await seedCategory();
    const editing: RecurringRule = {
      id: 'rr-note-echo', enabled: true, type: 'expense', amount: 500, categoryId: foodId,
      categoryEmoji: '🍚', categoryName: '餐饮', note: '房租', frequency: 'monthly', interval: 1,
      day: 1, startDate: '2026-08-01', time: '09:00', createdAt: Date.now(),
    };
    await mountSheet(editing);
    expect(noteInput().value).toBe('房租');
  });

  it('RR-N03 修改规则备注只影响未来生成 Bill（更新写库 + 打生效边界）', async () => {
    const foodId = await seedCategory();
    const editing: RecurringRule = {
      id: 'rr-note-future', enabled: true, type: 'expense', amount: 500, categoryId: foodId,
      categoryEmoji: '🍚', categoryName: '餐饮', note: '旧备注', frequency: 'monthly', interval: 1,
      day: 1, startDate: '2026-08-01', time: '09:00', createdAt: Date.now(),
    };
    // 编辑模式要求目标规则已存在于库（IdbRecurringRuleService.update 只更新已存在记录）
    // 注意：services.recurringRules.add 会强制生成新 uid，故用 db.put 按指定 id 落库
    const db = await openDatabase();
    await db.put('recurringRules', { ...editing, updatedAt: Date.now() });
    await mountSheet(editing);
    // 修改备注并保存
    setNote('新备注');
    await clickSave();
    const rules = await listRules();
    expect(rules).toHaveLength(1);
    expect(rules[0].id).toBe('rr-note-future');
    expect(rules[0].note).toBe('新备注');
    // 编辑保存会打上 scheduleEffectiveAt：历史 occurrence 不再回填 → 只影响未来生成的 Bill
    expect(typeof rules[0].scheduleEffectiveAt).toBe('number');
  });
});
