/**
 * 2.10.8 日价页长按两类语义（数据安全规则）——页面级测试
 * - LP-08 daily-value-only：长按 → 「删除这个日价项目？」→ 确认 → 整条 Bill 删除。
 * - LP-09 normal + dailyValue.enabled：长按 → 「移出日价？」→ 确认 → 保留原 Bill/统计，
 *   仅清除 dailyValue（id/amount/type/category/date/source/ledgerImpact 不变）。
 * - 轻点进入日价详情（2.20.0 Gate B：点击日价卡 → /daily-value/:billId，不再直接编辑）。
 * - 长按与轻点/滚动共存：位移/时序行为沿用 useLongPress 单测，页面级验证对话框不双开。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { nextTick } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import { createMemoryHistory, createRouter } from 'vue-router';
import { openDatabase } from '@/core/db/database';
import { services } from '@/core/services';
import DailyValuePage from '@/pages/daily-value/DailyValuePage.vue';
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
    amount: 100,
    categoryId: 'c-food',
    categoryEmoji: '🍚',
    categoryName: '餐饮',
    note: '日价物品',
    date: '2026-08-01',
    timestamp: 1787310000000,
    source: 'manual',
    ledgerImpact: 'normal',
    dailyValue: { enabled: true, mode: 'elapsed', startDate: '2026-08-01' },
    ...over,
  };
}

async function mountPage() {
  const pinia = createPinia();
  setActivePinia(pinia);
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/daily-value', component: DailyValuePage },
      { path: '/daily-value/:billId', component: { template: '<div>detail stub</div>' } },
    ],
  });
  await router.push('/daily-value');
  await router.isReady();
  const wrapper = mount(DailyValuePage, { global: { plugins: [pinia, router] } });
  await flushPromises();
  return wrapper;
}

function fire(el: Element, type: string, x: number, y: number, pid = 1) {
  const ev = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y });
  Object.assign(ev, { isPrimary: true, pointerId: pid });
  el.dispatchEvent(ev);
}

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

/** 日价列表项（非 Teleport，须经 wrapper 查询；Dialog/Sheet 各自 Teleport 到 body） */
function itemEls(wrapper: ReturnType<typeof mount>): Element[] {
  return wrapper.findAll('.dv__item').map((w) => w.element);
}
function dialog(): Element | null {
  return document.body.querySelector('.dvcd');
}
function confirmDanger(): HTMLButtonElement | null {
  return document.body.querySelector('.dvcd__btn--danger');
}

/** 轮询等待条件成立（真实 macrotask 步进，避免 fake-indexeddb 事务时序导致的断言抖动） */
async function pollUntil(cond: () => Promise<boolean> | boolean, tries = 100): Promise<boolean> {
  for (let i = 0; i < tries; i += 1) {
    if (await cond()) return true;
    await new Promise((r) => setTimeout(r, 0));
  }
  return false;
}

describe('日价页长按两类语义（2.10.8）', () => {
  beforeEach(resetDb);
  afterEach(() => {
    vi.useRealTimers();
  });

  it('LP-08 daily-value-only 长按删除：确认后整条 Bill 删除、列表消失', async () => {
    await services.bills.add(makeBill({ ledgerImpact: 'daily-value-only' }));
    const wrapper = await mountPage();
    expect(itemEls(wrapper).length).toBe(1);
    const item = itemEls(wrapper)[0];
    longPress(item);
    await flushPromises();
    const dlg = dialog()!;
    expect(dlg.querySelector('.dvcd__title')?.textContent).toContain('删除这个日价项目？');
    expect(dlg.textContent).toContain('删除后无法恢复。');
    expect(document.body.querySelector('.dvas')).toBeNull(); // 长按不打开编辑
    confirmDanger()!.click();
    // 等待持久化完成，再刷新 DOM 断言
    expect(await pollUntil(async () => (await services.bills.list()).length === 0)).toBe(true);
    await flushPromises();
    await nextTick();
    expect(dialog()).toBeNull();
    expect(itemEls(wrapper).length).toBe(0);
    wrapper.unmount();
  });

  it('LP-09 normal + dailyValue 长按：只移出日价，原 Bill 与 ledgerImpact 保留', async () => {
    await services.bills.add(makeBill({ note: '普通账单的日价' })); // ledgerImpact=normal + dailyValue
    const wrapper = await mountPage();
    expect(itemEls(wrapper).length).toBe(1);
    const item = itemEls(wrapper)[0];
    longPress(item);
    await flushPromises();
    const dlg = dialog()!;
    expect(dlg.querySelector('.dvcd__title')?.textContent).toContain('移出日价？');
    expect(dlg.textContent).toContain('原账单仍会保留，只停止显示日价。');
    confirmDanger()!.click();
    // 等待持久化完成（移出日价 = dailyValue 置空），再刷新 DOM 断言
    const billsAfter = async () => {
      const list = await services.bills.list();
      return list[0] && !list[0].dailyValue;
    };
    expect(await pollUntil(billsAfter)).toBe(true);
    await flushPromises();
    await nextTick();
    expect(dialog()).toBeNull();
    expect(itemEls(wrapper).length).toBe(0); // 日价列表消失
    const bills = await services.bills.list();
    expect(bills.length).toBe(1); // 原 Bill 保留
    expect(bills[0].ledgerImpact).toBe('normal');
    expect(bills[0].amount).toBe(100);
    expect(bills[0].type).toBe('expense');
    expect(bills[0].categoryId).toBe('c-food');
    expect(bills[0].date).toBe('2026-08-01');
    expect(bills[0].source).toBe('manual');
    expect(bills[0].dailyValue).toBeUndefined(); // 仅移出日价
    wrapper.unmount();
  });

  it('LP-08b daily-value-only 长按后松手不再触发编辑（suppress click）', async () => {
    await services.bills.add(makeBill({ ledgerImpact: 'daily-value-only' }));
    const wrapper = await mountPage();
    const item = itemEls(wrapper)[0];
    longPress(item);
    await flushPromises();
    expect(dialog()).not.toBeNull();
    item.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await flushPromises();
    expect(document.body.querySelector('.dvas')).toBeNull(); // 编辑 Sheet 不打开
    expect(dialog()).not.toBeNull();
    wrapper.unmount();
  });

  it('LP-TAP 轻点 daily-value-only → 进入日价详情（不再直接编辑）', async () => {
    const bill = await services.bills.add(makeBill({ ledgerImpact: 'daily-value-only', note: '独立日价' }));
    const wrapper = await mountPage();
    const item = itemEls(wrapper)[0];
    fire(item, 'pointerdown', 10, 10);
    fire(item, 'pointerup', 10, 10);
    item.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await flushPromises();
    // 2.20.0：点击进入详情路由；不直接打开编辑 Sheet
    expect(wrapper.vm.$router.currentRoute.value.path).toBe(`/daily-value/${bill.id}`);
    expect(document.body.querySelector('.dv-sheet__title')).toBeNull();
    expect(dialog()).toBeNull();
    wrapper.unmount();
  });

  it('LP-SWIPE 横滑/纵滑移动 >10px：不弹删除框', async () => {
    await services.bills.add(makeBill({ ledgerImpact: 'daily-value-only' }));
    const wrapper = await mountPage();
    const item = itemEls(wrapper)[0];
    vi.useFakeTimers();
    try {
      fire(item, 'pointerdown', 40, 100);
      fire(item, 'pointermove', 160, 100); // 横向 120px（页面 Swipe）
      vi.advanceTimersByTime(600);
      fire(item, 'pointerup', 160, 100);
    } finally {
      vi.useRealTimers();
    }
    await flushPromises();
    expect(dialog()).toBeNull();
    wrapper.unmount();
  });

  it('LP-CANCEL 长按后取消：项目与 store 不变', async () => {
    await services.bills.add(makeBill({ ledgerImpact: 'daily-value-only' }));
    const wrapper = await mountPage();
    const item = itemEls(wrapper)[0];
    longPress(item);
    await flushPromises();
    expect(dialog()).not.toBeNull();
    (dialog()!.querySelector('.dvcd__btn--cancel') as HTMLButtonElement).click();
    await flushPromises();
    expect(dialog()).toBeNull();
    expect(itemEls(wrapper).length).toBe(1);
    expect((await services.bills.list()).length).toBe(1);
    wrapper.unmount();
  });
});