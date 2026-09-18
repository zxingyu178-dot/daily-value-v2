/**
 * 2.20.0 Gate B 页面测试（DV-DETAIL-ROUTE-01 / DV-DETAIL-EDIT-01 / DV-DETAIL-MISSING-01）
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount, flushPromises, VueWrapper } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { createMemoryHistory, createRouter, type Router } from 'vue-router';
import { openDatabase } from '@/core/db/database';
import { useBillStore } from '@/core/store/bill';
import { useCategoryStore } from '@/core/store/category';
import DailyValueDetailPage from '@/pages/daily-value/DailyValueDetailPage.vue';
import type { Bill } from '@/core/models/types';

const TEST_STORES = ['bills', 'categories', 'settings', 'meta', 'recurringRules'] as const;

async function resetDb(): Promise<void> {
  const db = await openDatabase();
  const tx = db.transaction(TEST_STORES, 'readwrite');
  for (const store of TEST_STORES) tx.objectStore(store).clear();
  await tx.done;
}

function makeDvBill(over: Partial<Bill> = {}): Bill {
  return {
    id: 'dv-1',
    type: 'expense',
    amount: 6088,
    categoryId: 'c-a',
    categoryEmoji: '💻',
    categoryName: '购物',
    title: 'MacBook Pro',
    note: '',
    date: '2025-10-26',
    timestamp: new Date('2025-10-26T10:00:00').getTime(),
    source: 'manual',
    ledgerImpact: 'daily-value-only',
    dailyValue: { enabled: true, mode: 'elapsed', startDate: '2025-10-26' },
    ...over,
  };
}

let wrapper: VueWrapper | null = null;
let router: Router;

async function mountDetail(routePath: string, prepare?: () => Promise<void>) {
  const pinia = createPinia();
  setActivePinia(pinia);
  const cat = useCategoryStore();
  await cat.add({ name: '购物', emoji: '🛍️', builtin: true, sort: 0 });
  if (prepare) await prepare();
  router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/daily-value/:billId', component: DailyValueDetailPage },
      { path: '/daily-value', component: { template: '<div>list</div>' } },
    ],
  });
  await router.push(routePath);
  await router.isReady();
  wrapper = mount(DailyValueDetailPage, {
    global: { plugins: [pinia, router] },
  });
  await flushPromises();
  await new Promise((r) => setTimeout(r, 60));
  await flushPromises();
  return pinia;
}

beforeEach(async () => {
  vi.restoreAllMocks();
  await resetDb();
});

afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
});

describe('DV-DETAIL-ROUTE-01：进入详情并渲染 Hero / 曲线 / 里程碑', () => {
  it('/daily-value/dv-1 显示名称、当前日价、曲线与里程碑', async () => {
    await mountDetail('/daily-value/dv-1', async () => {
      const bills = useBillStore();
      await bills.load(true);
      await bills.add(makeDvBill());
    });

    const text = wrapper!.text();
    expect(text).toContain('MacBook Pro');
    expect(text).toContain('/ 天');
    expect(text).toContain('已使用');
    expect(text).toContain('日价变化'); // 曲线卡
    expect(text).toContain('使用 7 天'); // 使用里程碑
    expect(text).toContain('降到 ¥100 / 天'); // 日价目标节点
    expect(wrapper!.find('.dv-detail__chart').exists()).toBe(true);
  });
});

describe('DV-DETAIL-EDIT-01：编辑保存后详情即时更新', () => {
  it('点「编辑」打开 DailyValueAddSheet；保存触发 billStore.load(true)', async () => {
    let billStore: ReturnType<typeof useBillStore>;
    await mountDetail('/daily-value/dv-1', async () => {
      billStore = useBillStore();
      await billStore.load(true);
      await billStore.add(makeDvBill());
    });
    billStore = useBillStore();

    const editBtn = wrapper!.find('.dv-detail__edit');
    expect(editBtn.exists()).toBe(true);
    await editBtn.trigger('click');
    await flushPromises();

    // 编辑 Sheet 打开（DailyValueAddSheet 内容含金额/分类/保存）
    const dialogs = document.body.querySelectorAll('[role="dialog"]');
    expect(dialogs.length).toBeGreaterThan(0);
    const sheetText = dialogs[0]?.textContent ?? '';
    expect(sheetText).toContain('保存');

    // 保存 → onEdited → billStore.load(true)（详情数据刷新）
    const loadSpy = vi.spyOn(billStore, 'load');
    const saveBtn = [...document.body.querySelectorAll('button')].find((b) =>
      (b.textContent ?? '').includes('保存'),
    );
    expect(saveBtn).toBeTruthy();
    saveBtn!.click();
    await new Promise((r) => setTimeout(r, 120));
    await flushPromises();
    expect(loadSpy).toHaveBeenCalled();
  });
});

describe('DV-DETAIL-MISSING-01：项目不存在不白屏', () => {
  it('/daily-value/nonexistent 显示「这个日价项目已不存在」', async () => {
    await mountDetail('/daily-value/nonexistent');
    const text = wrapper!.text();
    expect(text).toContain('这个日价项目已不存在');
    expect(text).toContain('返回日价列表');
    // 不出现 NaN / undefined / 崩溃
    expect(text).not.toContain('NaN');
  });
});