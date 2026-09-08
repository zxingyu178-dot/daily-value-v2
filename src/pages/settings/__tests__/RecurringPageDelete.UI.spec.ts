/**
 * RecurringPage 删除确认 UI 测试（Phase 7A 收尾）
 * DEL-R01..06：删除不再用 window.confirm，改为自定义 DVConfirmDialog；
 * 历史账单保留；Back 关闭确认框；正式页面不调用 window.confirm/alert/prompt。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { openDatabase } from '@/core/db/database';
import { services } from '@/core/services';
import RecurringPage from '@/pages/settings/RecurringPage.vue';
import { __getBackOverlayStack } from '@/components/design/back-handler';

vi.mock('vue-router', () => ({ useRouter: () => ({ back: vi.fn(), push: vi.fn() }) }));

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
  window.confirm = vi.fn(() => true);
}

async function seedRuleAndBill(): Promise<{ ruleId: string; billId: string }> {
  const rule = await services.recurringRules.add({
    enabled: true, type: 'expense', amount: 88, categoryId: 'c-home',
    categoryEmoji: '🏠', categoryName: '房租', note: '房租',
    frequency: 'monthly', interval: 1, day: 1, startDate: '2026-08-01', time: '09:00',
  });
  const bill = await services.bills.add({
    type: 'expense', amount: 88, categoryId: 'c-home', categoryEmoji: '🏠',
    categoryName: '房租', note: '房租', date: '2026-08-01', timestamp: 1787212800000,
    source: 'recurring', ledgerImpact: 'normal',
  });
  return { ruleId: rule.id, billId: bill.id };
}

async function mountPage(): Promise<ReturnType<typeof mount<typeof RecurringPage>>> {
  const pinia = createPinia();
  setActivePinia(pinia);
  // attachTo body：RecurringPage 根节点不 Teleport，需挂载进 document 才能用 document.querySelector 断言
  const wrapper = mount(RecurringPage, {
    global: { plugins: [pinia] },
    attachTo: document.body,
  });
  for (let i = 0; i < 4; i++) {
    await flushPromises();
    await new Promise((r) => setTimeout(r, 20));
  }
  await flushPromises();
  return wrapper;
}

describe('RecurringPage 删除确认（DEL-R01..06）', () => {
  beforeEach(resetDb);

  it('DEL-R01 点击删除打开自定义确认框（DVConfirmDialog，非 window.confirm）', async () => {
    await seedRuleAndBill();
    await mountPage();
    const confirmSpy = vi.spyOn(window, 'confirm');
    const delBtn = [...document.querySelectorAll<HTMLElement>('.rr-act--danger')].find((b) => b.textContent!.includes('删除'));
    expect(delBtn).toBeTruthy();
    delBtn!.click();
    await flushPromises();
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(document.querySelector('.dvcd')).toBeTruthy(); // 自定义确认框打开
    const title = document.querySelector<HTMLElement>('.dvcd__title');
    expect(title!.textContent).toContain('删除周期规则');
    const hint = document.querySelector<HTMLElement>('.rr-confirm__hint');
    expect(hint!.textContent).toContain('历史账单不会删除');
    const confirmBtn = document.querySelector<HTMLElement>('.dvcd__btn--danger');
    expect(confirmBtn).toBeTruthy(); // 删除按钮危险色类
  });

  it('DEL-R02 Cancel 不删除', async () => {
    await seedRuleAndBill();
    await mountPage();
    document.querySelector<HTMLElement>('.rr-act--danger')!.click();
    await flushPromises();
    const cancelBtn = document.querySelector<HTMLElement>('.dvcd__btn--cancel')!;
    cancelBtn.click();
    await flushPromises();
    expect(document.querySelector('.dvcd')).toBeFalsy();
    const rules = await services.recurringRules.list();
    expect(rules.length).toBe(1); // 规则仍在
  });

  it('DEL-R03 Confirm 删除规则', async () => {
    const { ruleId } = await seedRuleAndBill();
    await mountPage();
    document.querySelector<HTMLElement>('.rr-act--danger')!.click();
    await flushPromises();
    document.querySelector<HTMLElement>('.dvcd__btn--danger')!.click();
    await flushPromises();
    await new Promise((r) => setTimeout(r, 0));
    await flushPromises();
    expect(document.querySelector('.dvcd')).toBeFalsy();
    const rules = await services.recurringRules.list();
    expect(rules.find((r) => r.id === ruleId)).toBeUndefined();
  });

  it('DEL-R04 删除规则后历史 Bill 仍存在', async () => {
    const { ruleId, billId } = await seedRuleAndBill();
    await mountPage();
    document.querySelector<HTMLElement>('.rr-act--danger')!.click();
    await flushPromises();
    document.querySelector<HTMLElement>('.dvcd__btn--danger')!.click();
    await flushPromises();
    await new Promise((r) => setTimeout(r, 0));
    await flushPromises();
    const bills = await services.bills.list();
    expect(bills.find((b) => b.id === billId)).toBeTruthy();
    void ruleId;
  });

  it('DEL-R05 Android Back 关闭确认框（规则仍保留）', async () => {
    await seedRuleAndBill();
    await mountPage();
    const stack0 = (__getBackOverlayStack() as unknown as Array<() => void>).length;
    document.querySelector<HTMLElement>('.rr-act--danger')!.click();
    await flushPromises();
    const stack1 = (__getBackOverlayStack() as unknown as Array<() => void>).length;
    expect(stack1).toBeGreaterThan(stack0);
    const topClose = (__getBackOverlayStack() as unknown as Array<() => void>).pop();
    expect(topClose).toBeTruthy();
    topClose!();
    await flushPromises();
    expect(document.querySelector('.dvcd')).toBeFalsy();
    const rules = await services.recurringRules.list();
    expect(rules.length).toBe(1); // 未删除
  });

  it('DEL-R06 正式 Recurring 页面不再调用 window.confirm/alert/prompt', async () => {
    await seedRuleAndBill();
    await mountPage();
    // 页面源码级：打开删除确认全流程均不应触碰原生 confirm
    const confirmSpy = vi.spyOn(window, 'confirm');
    const alertSpy = vi.spyOn(window, 'alert');
    const promptSpy = vi.spyOn(window, 'prompt');
    document.querySelector<HTMLElement>('.rr-act--danger')!.click();
    await flushPromises();
    document.querySelector<HTMLElement>('.dvcd__btn--danger')!.click();
    await flushPromises();
    await new Promise((r) => setTimeout(r, 0));
    await flushPromises();
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(alertSpy).not.toHaveBeenCalled();
    expect(promptSpy).not.toHaveBeenCalled();
  });
});