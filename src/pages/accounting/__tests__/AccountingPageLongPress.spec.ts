/**
 * 2.10.8 记账长按语义（轻点 = 编辑；长按 = 删除确认）——页面级测试
 * 覆盖：LP-01 轻点编辑 / LP-02 长按删除确认 / LP-03 300ms 松手不删除 /
 *        LP-04/05/06 位移超容差与横纵 Swipe 不误触 / LP-07 长按后不再触发编辑 /
 *        Recurring 账单文案与整单删除（rule 不动）/ 确认后 store 与时间线同步刷新。
 * 手势模拟：pointerdown/up/cancel + click 直接派发到 .tl-item 原生节点；
 * 长按触发走 fake timers（method: advanceTimersByTime 550ms）。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { nextTick } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import { createMemoryHistory, createRouter } from 'vue-router';
import { openDatabase } from '@/core/db/database';
import { services } from '@/core/services';
import AccountingPage from '@/pages/accounting/AccountingPage.vue';
import type { Bill } from '@/core/models/types';

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
    amount: 25,
    categoryId: 'c-food',
    categoryEmoji: '🍚',
    categoryName: '餐饮',
    note: '午饭',
    date: '2026-08-21',
    timestamp: 1787310000000,
    source: 'manual',
    ledgerImpact: 'normal',
    ...over,
  };
}

async function mountPage() {
  const pinia = createPinia();
  setActivePinia(pinia);
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/accounting', component: AccountingPage }],
  });
  await router.push('/accounting');
  await router.isReady();
  const wrapper = mount(AccountingPage, { global: { plugins: [pinia, router] } });
  await flushPromises();
  return wrapper;
}

/** 派发 pointer 事件（jsdom 无 PointerEvent，用 MouseEvent + 补充字段） */
function fire(el: Element, type: string, x: number, y: number, pid = 1) {
  const ev = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y });
  Object.assign(ev, { isPrimary: true, pointerId: pid });
  el.dispatchEvent(ev);
}

/** 长按 550ms：down → 550ms → up */
function longPress(el: Element) {
  vi.useFakeTimers();
  try {
    fire(el, 'pointerdown', 10, 10);
    vi.advanceTimersByTime(550);
    fire(el, 'pointerup', 10, 10);
  } finally {
    vi.useRealTimers();
  }
}

async function seedAndMount(bills: Array<Omit<Bill, 'id'>>) {
  for (const b of bills) await services.bills.add(b);
  return mountPage();
}

/** 时间线账单项（非 Teleport，须经 wrapper 查询；Dialog/Sheet 各自 Teleport 到 body） */
function itemEls(wrapper: ReturnType<typeof mount>): Element[] {
  return wrapper.findAll('.tl-item').map((w) => w.element);
}
/** 删除确认框（Teleport 到 body） */
function dialog(): Element | null {
  return document.body.querySelector('.dvcd');
}

/** 轮询等待条件成立（真实 macrotask 步进，避免 fake-indexeddb 事务时序导致的断言抖动） */
async function pollUntil(cond: () => Promise<boolean> | boolean, tries = 100): Promise<boolean> {
  for (let i = 0; i < tries; i += 1) {
    if (await cond()) return true;
    await new Promise((r) => setTimeout(r, 0));
  }
  return false;
}

describe('记账页长按删除（2.10.8）', () => {
  beforeEach(resetDb);
  afterEach(() => {
    vi.useRealTimers();
  });

  it('LP-01 轻点账单 → 打开 QuickEntry 编辑', async () => {
    const wrapper = await seedAndMount([makeBill({ note: '午饭' })]);
    const item = itemEls(wrapper)[0];
    fire(item, 'pointerdown', 10, 10);
    fire(item, 'pointerup', 10, 10);
    item.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await flushPromises();
    const title = document.body.querySelector('.dv-sheet__title');
    expect(title?.textContent).toContain('编辑账单');
    expect(document.body.querySelector('.qe')).not.toBeNull();
    expect(dialog()).toBeNull();
    wrapper.unmount();
  });

  it('LP-02 长按 550ms → 打开删除确认框；取消后账单保留', async () => {
    const wrapper = await seedAndMount([makeBill({ note: '午饭' })]);
    const item = itemEls(wrapper)[0];
    longPress(item);
    await flushPromises();
    const dlg = dialog();
    expect(dlg).not.toBeNull();
    expect(dlg?.querySelector('.dvcd__title')?.textContent).toContain('删除这笔账单？');
    expect(document.body.querySelector('.qe')).toBeNull(); // 长按不进入编辑
    // 取消
    (dlg!.querySelector('.dvcd__btn--cancel') as HTMLButtonElement).click();
    await flushPromises();
    expect(dialog()).toBeNull();
    expect((await services.bills.list()).length).toBe(1);
    wrapper.unmount();
  });

  it('LP-03 按住 300ms 松手：不弹框、不删除', async () => {
    const wrapper = await seedAndMount([makeBill({ note: '午饭' })]);
    const item = itemEls(wrapper)[0];
    vi.useFakeTimers();
    try {
      fire(item, 'pointerdown', 10, 10);
      vi.advanceTimersByTime(300);
      fire(item, 'pointerup', 10, 10);
      vi.advanceTimersByTime(400);
    } finally {
      vi.useRealTimers();
    }
    await flushPromises();
    expect(dialog()).toBeNull();
    expect((await services.bills.list()).length).toBe(1);
    wrapper.unmount();
  });

  it('LP-04 pointermove 位移 >10px：长按取消，不弹删除', async () => {
    const wrapper = await seedAndMount([makeBill({ note: '午饭' })]);
    const item = itemEls(wrapper)[0];
    vi.useFakeTimers();
    try {
      fire(item, 'pointerdown', 10, 10);
      fire(item, 'pointermove', 30, 10); // 水平 20px
      vi.advanceTimersByTime(600);
      fire(item, 'pointerup', 30, 10);
    } finally {
      vi.useRealTimers();
    }
    await flushPromises();
    expect(dialog()).toBeNull();
    expect((await services.bills.list()).length).toBe(1);
    wrapper.unmount();
  });

  it('LP-05 横滑（primary page swipe）：账单位移 >10px，不弹删除', async () => {
    const wrapper = await seedAndMount([makeBill({ note: '午饭' })]);
    const item = itemEls(wrapper)[0];
    vi.useFakeTimers();
    try {
      fire(item, 'pointerdown', 40, 100);
      fire(item, 'pointermove', 120, 100); // 横向 80px
      vi.advanceTimersByTime(600);
      fire(item, 'pointerup', 120, 100);
    } finally {
      vi.useRealTimers();
    }
    await flushPromises();
    expect(dialog()).toBeNull();
    wrapper.unmount();
  });

  it('LP-06 纵滑（滚动）：账单位移 >10px，不弹删除', async () => {
    const wrapper = await seedAndMount([makeBill({ note: '午饭' })]);
    const item = itemEls(wrapper)[0];
    vi.useFakeTimers();
    try {
      fire(item, 'pointerdown', 40, 100);
      fire(item, 'pointermove', 40, 220); // 纵向 120px
      vi.advanceTimersByTime(600);
      fire(item, 'pointerup', 40, 220);
    } finally {
      vi.useRealTimers();
    }
    await flushPromises();
    expect(dialog()).toBeNull();
    wrapper.unmount();
  });

  it('LP-07 长按后松手：不再触发编辑（确认框与编辑 Sheet 不可同时出现）', async () => {
    const wrapper = await seedAndMount([makeBill({ note: '午饭' })]);
    const item = itemEls(wrapper)[0];
    longPress(item);
    await flushPromises();
    expect(dialog()).not.toBeNull();
    // 松手后浏览器会补发 click：必须被 suppress
    item.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await flushPromises();
    expect(document.body.querySelector('.qe')).toBeNull();
    expect(dialog()).not.toBeNull();
    wrapper.unmount();
  });

  it('LP-REC 长按 Recurring 生成账单：确认文案含「只删除本次账单」，Rule 不删除', async () => {
    const wrapper = await seedAndMount([
      makeBill({ note: '周期账', source: 'recurring', recurringRuleId: 'rule-1' }),
    ]);
    await services.recurringRules.add({
      enabled: true,
      type: 'expense',
      amount: 3000,
      categoryId: 'c-food',
      categoryEmoji: '🍚',
      categoryName: '餐饮',
      note: '周期',
      frequency: 'monthly',
      interval: 1,
      day: 1,
      startDate: '2026-08-01',
      time: '10:00',
    });
    const item = itemEls(wrapper)[0];
    longPress(item);
    await flushPromises();
    const dlg = dialog()!;
    expect(dlg.textContent).toContain('只删除本次账单，不影响后续周期记账');
    // 确认删除：只删当次 Bill，Rule 保留
    (dlg.querySelector('.dvcd__btn--danger') as HTMLButtonElement).click();
    await flushPromises();
    expect((await services.bills.list()).length).toBe(0);
    expect((await services.recurringRules.list()).length).toBe(1);
    expect(dialog()).toBeNull();
    wrapper.unmount();
  });

  it('LP-DEL 确认删除：Timeline/store 立即刷新', async () => {
    const wrapper = await seedAndMount([makeBill({ note: '午饭' })]);
    const item = itemEls(wrapper)[0];
    longPress(item);
    await flushPromises();
    (dialog()!.querySelector('.dvcd__btn--danger') as HTMLButtonElement).click();
    // 等待持久化完成（fake-indexeddb 事务异步时序），再刷新 DOM 断言
    expect(await pollUntil(async () => (await services.bills.list()).length === 0)).toBe(true);
    await flushPromises();
    await nextTick();
    expect(dialog()).toBeNull();
    expect(itemEls(wrapper).length).toBe(0);
    expect(wrapper.text()).toContain('还没有账单');
    wrapper.unmount();
  });
});