/**
 * Phase 3 记账主界面组件测试
 * - 空状态（中文提示）
 * - 月份汇总卡 / 账单时间线（跨月连续、排除 daily-value-only）
 * - 右下角 + 打开快速记账 Sheet
 * - 数字键盘输入金额 + 选分类 + 保存
 * - 月份切换
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
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

/** 相对当前月偏移 delta 个月的 yyyy-MM（避免用例写死日期，随日期漂移失效） */
function offsetYM(delta: number): string {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() + delta);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

async function mountPage() {
  const pinia = createPinia();
  setActivePinia(pinia);
  const wrapper = mount(AccountingPage, {
    global: { plugins: [pinia] },
  });
  await flushPromises();
  return wrapper;
}

describe('Phase 3 记账主界面', () => {
  beforeEach(resetDb);

  it('空状态：无账单时显示中文空状态提示与 FAB', async () => {
    const wrapper = await mountPage();
    expect(wrapper.text()).toContain('还没有账单');
    // FAB 已 Teleport 到 body（脱离 .primary-page-stage transform 定位上下文，2.10.2 FAB 固定修复）
    expect(document.body.querySelector('.accounting__fab')).not.toBeNull();
    // 月份卡默认显示当前月标题
    const now = new Date();
    const label = `${now.getFullYear()}年${now.getMonth() + 1}月`;
    expect(wrapper.find('.accounting__card-month').text()).toContain(label);
  });

  it('有账单：月份汇总卡金额 + 账单时间线（名称/备注/金额）', async () => {
    await services.bills.add(
      makeBill({ amount: 25, note: '午饭', date: '2026-08-21' }),
    );
    await services.bills.add(makeBill({ amount: 12.5, note: '地铁', categoryId: 'c-transport', categoryEmoji: '🚗', categoryName: '交通' }));
    const wrapper = await mountPage();
    // 时间线渲染两笔
    expect(wrapper.findAll('.tl-item')).toHaveLength(2);
    expect(wrapper.text()).toContain('午饭');
    expect(wrapper.text()).toContain('地铁');
    expect(wrapper.text()).toContain('25.00');
    expect(wrapper.text()).toContain('12.50');
  });

  it('daily-value-only 账单不进入账单时间线', async () => {
    await services.bills.add(
      makeBill({ amount: 100, note: '日价物品', ledgerImpact: 'daily-value-only', dailyValue: { enabled: true, mode: 'elapsed', startDate: '2026-01-01' } }),
    );
    const wrapper = await mountPage();
    expect(wrapper.findAll('.tl-item')).toHaveLength(0);
    expect(wrapper.text()).toContain('还没有账单');
  });

  it('时间线跨月份连续展示（连续时间线）', async () => {
    await services.bills.add(makeBill({ amount: 10, date: '2026-08-05' }));
    await services.bills.add(makeBill({ amount: 20, date: '2026-07-20' }));
    await services.bills.add(makeBill({ amount: 30, date: '2026-07-01' }));
    const wrapper = await mountPage();
    expect(wrapper.findAll('.tl-day')).toHaveLength(3);
    // 按日期倒序：8月5日在前
    const heads = wrapper.findAll('.tl-day__head');
    expect(heads[0].text()).toContain('8月5日');
  });

  it('快速记账：数字键盘输入金额 + 选择分类 + 保存生成账单并关闭 Sheet', async () => {
    await services.categories.add({ name: '餐饮', emoji: '🍚', builtin: true, sort: 1 });
    const wrapper = await mountPage();
    // 打开快速记账 Sheet（FAB 已 Teleport 到 body）
    (document.body.querySelector('.accounting__fab') as HTMLElement).click();
    await flushPromises();
    // Sheet 已挂载（Teleport 到 body）
    const sheet = document.body.querySelector('.qe');
    expect(sheet).not.toBeNull();
    // 数字键盘输入 25.5
    const padKeys = document.body.querySelectorAll('.qe__pad-key');
    const key = (k: string) => {
      const el = Array.from(padKeys).find((b) => b.textContent === k);
      expect(el).toBeTruthy();
      (el as HTMLElement).click();
    };
    key('2');
    key('5');
    key('.');
    key('5');
    // 等待 DOM 更新（amount ref 同步更新，但视图渲染在下一 tick）
    await flushPromises();
    const amountValue = document.body.querySelector('.qe__amount-value');
    expect(amountValue?.textContent).toContain('25.5');
    // 选择分类（最近使用里第一个，或全部分类里的餐饮）
    const catBtns = document.body.querySelectorAll('.qe__cat');
    expect(catBtns.length).toBeGreaterThan(0);
    (catBtns[0] as HTMLElement).click();
    // 保存
    const saveBtn = Array.from(document.body.querySelectorAll('button')).find((b) => b.textContent?.includes('记一笔'));
    expect(saveBtn).toBeTruthy();
    (saveBtn as HTMLElement).click();
    await flushPromises();
    // 账单已生成，Sheet 关闭
    expect((await services.bills.list()).length).toBe(1);
    expect((await services.bills.list())[0].amount).toBe(25.5);
    expect(document.body.querySelector('.qe')).toBeNull();
    // 时间线更新显示新账单
    expect(wrapper.findAll('.tl-item').length).toBeGreaterThan(0);
  });

  it('月份切换：点上一月箭头更新月份标题，并精确滚动到目标月份第一条（MONTH-01/02）', async () => {
    const cur = offsetYM(0);
    const prev1 = offsetYM(-1);
    const prev2 = offsetYM(-2);
    await services.bills.add(makeBill({ amount: 10, date: `${cur}-05` }));
    await services.bills.add(makeBill({ amount: 20, date: `${prev1}-20` }));
    await services.bills.add(makeBill({ amount: 30, date: `${prev2}-10` }));
    const wrapper = await mountPage();
    const arrows = wrapper.findAll('.accounting__card-arrow');
    expect(arrows).toHaveLength(2);
    // 当前月标题
    const now = new Date();
    expect(wrapper.find('.accounting__card-month').text()).toContain(`${now.getFullYear()}年${now.getMonth() + 1}月`);
    // 模拟真实布局：时间线可视高 600，内容高 1400（不含 spacer），
    // 时间线容器相对页面顶部偏移 80；前一月第一组内容偏移 1000（rect 差值应得 1000）。
    const timeline = wrapper.find('.accounting__timeline').element as HTMLElement;
    Object.defineProperty(timeline, 'clientHeight', { configurable: true, value: 600 });
    Object.defineProperty(timeline, 'scrollHeight', { configurable: true, value: 1400 });
    const containerTop = 80;
    const rect = (top: number): DOMRect =>
      ({ top, left: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
    timeline.getBoundingClientRect = () => rect(containerTop);
    const prevGroup = timeline.querySelector<HTMLElement>(`.tl-day[data-month="${prev1}"]`)!;
    prevGroup.getBoundingClientRect = () => rect(containerTop + 1000 - timeline.scrollTop);
    // 点左箭头（上一月）→ 前一月，前一月第一组精确置顶（targetTop = 1000 - 80 + 0 = 920 → 但正确公式得内容偏移 1000）
    await arrows[0].trigger('click');
    await flushPromises();
    expect(wrapper.find('.accounting__card-month').text()).toContain(`${Number(prev1.slice(5, 7))}月`);
    // spacer 需保证可滚动：contentHeight=1400, clientHeight=600, targetTop=1000 → spacer=1000+600-1400=200
    const spacer = timeline.querySelector<HTMLElement>('.accounting__spacer')!;
    expect(spacer.style.height).toBe('200px');
    expect(timeline.scrollTop).toBe(1000);
  });

  it('MONTH-02 最老月份（前两个月）仍能精确置顶（内容不足时补充 spacer）', async () => {
    const cur = offsetYM(0);
    const prev1 = offsetYM(-1);
    const prev2 = offsetYM(-2);
    await services.bills.add(makeBill({ amount: 10, date: `${cur}-05` }));
    await services.bills.add(makeBill({ amount: 20, date: `${prev1}-20` }));
    await services.bills.add(makeBill({ amount: 30, date: `${prev2}-10` }));
    const wrapper = await mountPage();
    const timeline = wrapper.find('.accounting__timeline').element as HTMLElement;
    Object.defineProperty(timeline, 'clientHeight', { configurable: true, value: 600 });
    Object.defineProperty(timeline, 'scrollHeight', { configurable: true, value: 1500 });
    const containerTop = 80;
    const rect = (top: number): DOMRect =>
      ({ top, left: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
    timeline.getBoundingClientRect = () => rect(containerTop);
    const oldest = timeline.querySelector<HTMLElement>(`.tl-day[data-month="${prev2}"]`)!;
    oldest.getBoundingClientRect = () => rect(containerTop + 1400 - timeline.scrollTop);
    // 直接切到最老月份 prev2（targetTop 内容偏移 = 1400）
    const arrows = wrapper.findAll('.accounting__card-arrow');
    // 先切到 prev1（中间），再切到 prev2（最老）
    await arrows[0].trigger('click');
    await flushPromises();
    const arrows2 = wrapper.findAll('.accounting__card-arrow');
    await arrows2[0].trigger('click');
    await flushPromises();
    expect(wrapper.find('.accounting__card-month').text()).toContain(`${Number(prev2.slice(5, 7))}月`);
    // 最老月份仍可置顶：spacer = 1400 + 600 - 1500 = 500
    const spacer = timeline.querySelector<HTMLElement>('.accounting__spacer')!;
    expect(spacer.style.height).toBe('500px');
    expect(timeline.scrollTop).toBe(1400);
  });

  it('月份边界：最老/最新月份对应箭头 disabled', async () => {
    const cur = offsetYM(0);
    const prev1 = offsetYM(-1);
    await services.bills.add(makeBill({ amount: 10, date: `${cur}-05` }));
    await services.bills.add(makeBill({ amount: 20, date: `${prev1}-20` }));
    const wrapper = await mountPage();
    // 当前月为最新：下一月箭头 disabled，上一月可用
    let arrows = wrapper.findAll('.accounting__card-arrow');
    expect((arrows[0].element as HTMLButtonElement).disabled).toBe(false);
    expect((arrows[1].element as HTMLButtonElement).disabled).toBe(true);
    // 切到最老（前一月）：上一月 disabled，下一月可用
    await arrows[0].trigger('click');
    await flushPromises();
    arrows = wrapper.findAll('.accounting__card-arrow');
    expect((arrows[0].element as HTMLButtonElement).disabled).toBe(true);
    expect((arrows[1].element as HTMLButtonElement).disabled).toBe(false);
  });

  it('日期标题汇总：收入-only 日期不显示“支出 0.00”，只显示“收入”', async () => {
    await services.bills.add(
      makeBill({ type: 'income', amount: 500, note: '工资', categoryId: 'c-salary', categoryEmoji: '💰', categoryName: '工资', date: '2026-08-20' }),
    );
    const wrapper = await mountPage();
    const head = wrapper.find('.tl-day__total');
    expect(head.text()).toContain('收入 ¥ 500.00');
    expect(head.text()).not.toContain('支出 0.00');
    expect(head.text()).not.toContain('·');
  });

  it('日期标题汇总：两者都有时简洁展示 支出与收入', async () => {
    await services.bills.add(makeBill({ amount: 25, note: '午饭', date: '2026-08-21' }));
    await services.bills.add(makeBill({ type: 'income', amount: 100, note: '红包', date: '2026-08-21' }));
    const wrapper = await mountPage();
    const head = wrapper.find('.tl-day__total');
    expect(head.text()).toContain('支出 ¥ 25.00');
    expect(head.text()).toContain('收入 ¥ 100.00');
  });

  it('到底反馈：真实 end sentinel 在 spacer 之前，且“已到底部”渲染在 sentinel 与 spacer 之间（反馈位置不被 spacer 改变）', async () => {
    await services.bills.add(makeBill({ amount: 10, date: '2026-08-05' }));
    await services.bills.add(makeBill({ amount: 20, date: '2026-08-04' }));
    await services.bills.add(makeBill({ amount: 30, date: '2026-08-03' }));
    const wrapper = await mountPage();
    const timeline = wrapper.find('.accounting__timeline');
    expect(timeline.exists()).toBe(true);
    // 不再有悬浮的“继续下滑查看更早记录”覆盖层（已删除）
    expect(wrapper.find('.accounting__scroll-hint').exists()).toBe(false);
    const timelineEl = timeline.element;
    const sentinel = timelineEl.querySelector<HTMLElement>('.accounting__end-sentinel');
    const spacer = timelineEl.querySelector<HTMLElement>('.accounting__spacer');
    expect(sentinel).not.toBeNull();
    expect(spacer).not.toBeNull();
    // 触发滚动到真实内容底部，使 reachedBottom=true、反馈渲染进 DOM
    Object.defineProperty(timelineEl, 'clientHeight', { configurable: true, value: 300 });
    Object.defineProperty(timelineEl, 'scrollTop', { configurable: true, value: 900 });
    Object.defineProperty(sentinel!, 'offsetTop', { configurable: true, value: 600 });
    timelineEl.dispatchEvent(new Event('scroll'));
    await flushPromises();
    // DOM 顺序：真实内容 sentinel → 到底反馈 → 月份定位 spacer
    // 用 compareDocumentPosition 判断文档顺序（Transition 渲染下 children.indexOf 不稳定）
    const FOLL = 4; // Node.DOCUMENT_POSITION_FOLLOWING
    const follows = (a: Element, b: Element) => (a.compareDocumentPosition(b) & FOLL) === FOLL;
    // 反馈节点既存在（渲染后才可见）
    const endEl = Array.from(timelineEl.querySelectorAll('.accounting__end')).find(
      (el) => el.textContent?.includes('已到底部'),
    );
    expect(endEl).toBeTruthy();
    // 核心：sentinel 先于反馈、反馈先于 spacer，spacer 高度不改变其视觉位置
    expect(follows(sentinel!, endEl!)).toBe(true);
    expect(follows(endEl!, spacer!)).toBe(true);
    expect(follows(sentinel!, spacer!)).toBe(true);
  });

  it('EDIT-01 点击账单行打开编辑 Sheet（整行可点）', async () => {
    await services.categories.add({ name: '餐饮', emoji: '🍚', builtin: true, sort: 1 });
    await services.bills.add(makeBill({ amount: 25, note: '午饭', date: '2026-08-21' }));
    const wrapper = await mountPage();
    const item = wrapper.find('.tl-item');
    expect(item.exists()).toBe(true);
    // 整行点击打开编辑
    await item.trigger('click');
    await flushPromises();
    const header = document.body.querySelector('.dv-sheet__header');
    expect(header?.textContent).toContain('编辑账单');
    // 编辑模式下按钮为「保存修改」
    const saveBtn = Array.from(document.body.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('保存修改'),
    );
    expect(saveBtn).toBeTruthy();
  });
});
