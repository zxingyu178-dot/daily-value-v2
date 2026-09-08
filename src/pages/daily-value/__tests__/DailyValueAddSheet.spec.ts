/**
 * 2.9.5 日价页独立新增/编辑测试（FIX-05/06）
 * - FIX-05：日价页 FAB 打开「添加日价物品」面板，保存生成 Bill
 * - FIX-06：新增的日价项目 ledgerImpact='daily-value-only'
 *   → 不进 normalBills / billsByMonth / monthSummary（记账时间线/月支出/统计），
 *   → 但进入 dailyValueBills（日价模块可见）
 * - 编辑模式：patch 原 Bill，保持 id / source / ledgerImpact 不变
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { openDatabase } from '@/core/db/database';
import { services } from '@/core/services';
import DailyValueAddSheet from '@/pages/daily-value/DailyValueAddSheet.vue';
import { useBillStore } from '@/core/store/bill';
import type { Bill } from '@/core/models/types';

const TEST_STORES = ['bills', 'categories', 'settings', 'meta', 'recurringRules'] as const;

async function resetDb(): Promise<void> {
  const db = await openDatabase();
  const tx = db.transaction(TEST_STORES, 'readwrite');
  for (const store of TEST_STORES) tx.objectStore(store).clear();
  await tx.done;
  localStorage.clear();
}

async function seedCategory() {
  const cat = await services.categories.add({
    name: '数码',
    emoji: '💻',
    iconType: 'builtin',
    iconValue: 'digital',
    builtin: false,
    sort: 1,
  });
  return cat;
}

function inputByPlaceholder(placeholder: string): HTMLInputElement {
  const el = document.body.querySelector<HTMLInputElement>(`input[placeholder="${placeholder}"]`);
  if (!el) throw new Error(`未找到输入框: ${placeholder}`);
  return el;
}

function buttonByText(text: string): HTMLButtonElement {
  const btn = Array.from(document.body.querySelectorAll('button')).find((b) =>
    b.textContent?.includes(text),
  );
  if (!btn) throw new Error(`未找到按钮: ${text}`);
  return btn as HTMLButtonElement;
}

async function mountSheet(props: Record<string, unknown> = {}) {
  const pinia = createPinia();
  setActivePinia(pinia);
  const wrapper = mount(DailyValueAddSheet, {
    props: { modelValue: true, ...props },
    global: { plugins: [pinia] },
  });
  await flushPromises();
  await new Promise((r) => setTimeout(r, 0));
  await flushPromises();
  return wrapper;
}

/** 完整走一遍「新增日价物品」：填名称/金额 → 选分类 → 保存 */
async function addItem(title: string, amount: string) {
  const nameInput = inputByPlaceholder('如：MacBook / 咖啡');
  nameInput.value = title;
  nameInput.dispatchEvent(new Event('input'));
  await flushPromises();
  const amountInput = inputByPlaceholder('0.00');
  amountInput.value = amount;
  amountInput.dispatchEvent(new Event('input'));
  await flushPromises();
  // 打开分类选择器并选中第一个分类
  document.body.querySelector<HTMLElement>('button[aria-label="选择分类"]')!.click();
  await flushPromises();
  const catCell = document.body.querySelector<HTMLElement>('.dvpc__cell');
  if (!catCell) throw new Error('未找到分类网格');
  catCell.click();
  await flushPromises();
  buttonByText('添加').click();
  await flushPromises();
  await new Promise((r) => setTimeout(r, 0));
  await flushPromises();
}

describe('DailyValueAddSheet（FIX-05/06）', () => {
  beforeEach(resetDb);

  it('FIX-05 保存新增：type=expense / source=manual / ledgerImpact=daily-value-only / dailyValue 开启', async () => {
    await seedCategory();
    await mountSheet();
    await addItem('MacBook', '10000');
    const bills = await services.bills.list();
    expect(bills).toHaveLength(1);
    const b = bills[0];
    expect(b.title).toBe('MacBook');
    expect(b.amount).toBe(10000);
    expect(b.type).toBe('expense');
    expect(b.source).toBe('manual');
    expect(b.ledgerImpact).toBe('daily-value-only');
    expect(b.dailyValue).toEqual({ enabled: true, mode: 'elapsed', startDate: b.date });
    expect(b.categoryName).toBe('数码');
  });

  it('FIX-06 新增日价项目不进 normalBills / billsByMonth / monthSummary，但进 dailyValueBills', async () => {
    await seedCategory();
    await mountSheet();
    await addItem('咖啡机', '899');
    const store = useBillStore();
    await store.load();
    expect(store.normalBills).toHaveLength(0); // 不进记账时间线
    const ym = store.bills[0].date.slice(0, 7);
    expect(store.billsByMonth(ym)).toHaveLength(0); // 不进月支出
    expect(store.monthSummary(ym).expense).toBe(0); // 不进统计
    expect(store.dailyValueBills).toHaveLength(1); // 日价模块可见
  });

  it('编辑模式：patch 原 Bill，保持 id / source / ledgerImpact 不变', async () => {
    const cat = await seedCategory();
    const original = await services.bills.add({
      type: 'expense',
      amount: 899,
      categoryId: cat.id,
      categoryEmoji: '💻',
      categoryName: '数码',
      note: '',
      title: '咖啡机',
      date: '2026-08-01',
      timestamp: 1787310000000,
      source: 'manual',
      ledgerImpact: 'daily-value-only',
      dailyValue: { enabled: true, mode: 'elapsed', startDate: '2026-08-01' },
    } as Omit<Bill, 'id'>);
    await mountSheet({ editingBill: original });
    const amountInput = inputByPlaceholder('0.00');
    amountInput.value = '1200';
    amountInput.dispatchEvent(new Event('input'));
    await flushPromises();
    buttonByText('保存修改').click();
    await flushPromises();
    await new Promise((r) => setTimeout(r, 0));
    await flushPromises();
    const bills = await services.bills.list();
    expect(bills).toHaveLength(1);
    const b = bills[0];
    expect(b.id).toBe(original.id);
    expect(b.amount).toBe(1200);
    expect(b.source).toBe('manual');
    expect(b.ledgerImpact).toBe('daily-value-only');
  });
});
