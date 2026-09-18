/**
 * 2.13.0 统计图表 Tooltip 移动端交互测试（CHART-02~09）
 *
 * Tooltip 交互全部在 use-module-chart.ts 统一实现（不逐模块补）：
 * - CHART-02 点击数据点 → showTip
 * - CHART-03 再点同一数据 → hideTip（toggle）
 * - CHART-04 点击图表空白（非 series）→ hideTip
 * - CHART-05 点击 Card 标题/摘要（容器外 pointerdown）→ hideTip
 * - CHART-06 滚动（touchmove 位移超阈值）→ hideTip；微小抖动不误关
 * - CHART-07 切月份 → hideTip
 * - CHART-08 切页面 / KeepAlive 失活 → hideTip
 * - CHART-09 打开另一图表 Tooltip → 前一图自动关闭
 * - 关键防抖：容器内 pointerdown 不得在 showTip 后立即 hideTip
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { KeepAlive, defineComponent, type Component } from 'vue';
import { localDateKey } from '@/core/models/daily-value';
import type { Bill } from '@/core/models/types';
import DailyExpenseTrendModule from '../DailyExpenseTrendModule.vue';
import IncomeExpenseCompareModule from '../IncomeExpenseCompareModule.vue';

const { initMock } = vi.hoisted(() => ({ initMock: vi.fn() }));

interface MockInst {
  setOption: ReturnType<typeof vi.fn>;
  resize: ReturnType<typeof vi.fn>;
  dispose: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
  dispatchAction: ReturnType<typeof vi.fn>;
}

vi.mock('echarts/core', () => ({
  use: vi.fn(),
  init: (...args: unknown[]) => initMock(...args),
}));
vi.mock('echarts/charts', () => ({ PieChart: {}, BarChart: {}, LineChart: {} }));
vi.mock('echarts/components', () => ({
  TitleComponent: {},
  TooltipComponent: {},
  LegendComponent: {},
  GridComponent: {},
  MarkLineComponent: {},
}));
vi.mock('echarts/renderers', () => ({ SVGRenderer: {} }));

function makeBill(over: Partial<Bill>): Bill {
  return {
    id: over.id ?? Math.random().toString(36).slice(2),
    type: 'expense',
    amount: 0,
    categoryId: 'c-food',
    categoryEmoji: '🍚',
    categoryName: '餐饮',
    note: '',
    date: localDateKey(),
    timestamp: Date.now(),
    source: 'manual',
    ledgerImpact: 'normal',
    ...over,
  } as Bill;
}

function seedMonthBills(ym: string): Bill[] {
  return [
    makeBill({ id: 'e1', amount: 25, date: `${ym}-05` }),
    makeBill({ id: 'e2', amount: 40, date: `${ym}-10` }),
  ];
}

function makeInst(containerClass = 'stats-module__chart'): MockInst {
  const inst: MockInst = {
    setOption: vi.fn(),
    resize: vi.fn(),
    dispose: vi.fn(),
    on: vi.fn(),
    dispatchAction: vi.fn(),
  };
  initMock.mockImplementationOnce(() => inst);
  void containerClass;
  return inst;
}

function initRegister(): void {
  initMock.mockReset();
}

async function mountModule(comp: Component, ym: string, today: string) {
  const wrapper = mount(comp, {
    props: {
      bills: seedMonthBills(ym),
      activeYm: ym,
      today,
      monthLabel: `${Number(ym.slice(5))}月`,
    },
    attachTo: document.body, // 挂到 document，保证事件可冒泡到 document 级监听（容器外点击/滚动关闭需要）
    global: { plugins: [usePinia()] },
  });
  await flushPromises();
  await new Promise((r) => setTimeout(r, 0));
  await flushPromises();
  return wrapper;
}

let activePinia: ReturnType<typeof createPinia>;
function usePinia() {
  return activePinia;
}

/** 触发 ECharts 实例的 click handler（use-module-chart 在 on('click', handler) 注册） */
function fireChartClick(inst: MockInst, params: unknown) {
  const clickHandler = inst.on.mock.calls.find((c: Array<unknown>) => c[0] === 'click')?.[1] as
    | ((p: unknown) => void)
    | undefined;
  expect(clickHandler).toBeTruthy();
  clickHandler!(params);
}

function dispatchType(type: string, init: EventInit, target: Element | Document = document) {
  target.dispatchEvent(new Event(type, { bubbles: true, ...init }));
}

/** 以带 touches 的触摸事件对象派发（Event init 不携带 touches，需事后挂到事件实例） */
function dispatchTouch(type: 'touchstart' | 'touchmove', clientY: number) {
  const ev = new Event(type, { bubbles: true });
  Object.defineProperty(ev, 'touches', { value: [{ clientY }] });
  document.dispatchEvent(ev);
}

describe('统计图表 Tooltip 交互（2.13.0）', () => {
  beforeEach(() => {
    // v2.20.0 Gate A：hasUsableChartSize 需要真实布局尺寸；jsdom 无布局（clientWidth=0）
    // → 迭代为固定可用尺寸（360×200），保证「隐藏容器不初始化」判定在组件测试中可落入「可用」分支
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
      configurable: true,
      get() {
        return 360;
      },
    });
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
      configurable: true,
      get() {
        return 200;
      },
    });
  });
  beforeEach(() => {
    initRegister();
    activePinia = createPinia();
    setActivePinia(activePinia);
  });

  it('CHART-02 点击数据点 → dispatchAction showTip', async () => {
    const ym = localDateKey().slice(0, 7);
    const inst = makeInst();
    const wrapper = await mountModule(DailyExpenseTrendModule, ym, localDateKey());
    fireChartClick(inst, { componentType: 'series', seriesIndex: 0, dataIndex: 4 });
    const actions = inst.dispatchAction.mock.calls.map((c) => c[0] as { type: string });
    expect(actions).toContainEqual(expect.objectContaining({ type: 'showTip', dataIndex: 4 }));
    wrapper.unmount();
  });

  it('CHART-03 再点同一数据第二次 → hideTip（切换关闭）', async () => {
    const ym = localDateKey().slice(0, 7);
    const inst = makeInst();
    const wrapper = await mountModule(DailyExpenseTrendModule, ym, localDateKey());
    const params = { componentType: 'series', seriesIndex: 0, dataIndex: 2 };
    fireChartClick(inst, params); // 第一次：显示
    await new Promise((r) => setTimeout(r, 5)); // hide 为下一事件循环派发（等原生 axis 完成后生效）
    fireChartClick(inst, params); // 第二次：关闭
    await new Promise((r) => setTimeout(r, 5));
    const types = inst.dispatchAction.mock.calls.map((c) => (c[0] as { type: string }).type);
    expect(types).toEqual(['showTip', 'hideTip']);
    // 点另一个数据点 → 再显示
    fireChartClick(inst, { componentType: 'series', seriesIndex: 0, dataIndex: 5 });
    await new Promise((r) => setTimeout(r, 5));
    expect(
      inst.dispatchAction.mock.calls[inst.dispatchAction.mock.calls.length - 1][0],
    ).toMatchObject({ type: 'showTip', dataIndex: 5 });
    wrapper.unmount();
  });

  it('CHART-04 点击图表空白（非 series）→ hideTip', async () => {
    const ym = localDateKey().slice(0, 7);
    const inst = makeInst();
    const wrapper = await mountModule(DailyExpenseTrendModule, ym, localDateKey());
    fireChartClick(inst, { componentType: 'series', seriesIndex: 0, dataIndex: 1 }); // 先显示
    fireChartClick(inst, { componentType: 'grid' }); // 空白
    expect(
      inst.dispatchAction.mock.calls[inst.dispatchAction.mock.calls.length - 1][0],
    ).toMatchObject({ type: 'hideTip' });
    wrapper.unmount();
  });

  it('CHART-05 点击模块标题/摘要（容器外 pointerdown）→ hideTip', async () => {
    const ym = localDateKey().slice(0, 7);
    const inst = makeInst();
    const wrapper = await mountModule(DailyExpenseTrendModule, ym, localDateKey());
    fireChartClick(inst, { componentType: 'series', seriesIndex: 0, dataIndex: 1 }); // 显示
    // 点击 DVCard（模块外壳，非图表容器）→ 外部 pointerdown
    dispatchType('pointerdown', {}, wrapper.find('.stats-module').element);
    expect(
      inst.dispatchAction.mock.calls[inst.dispatchAction.mock.calls.length - 1][0],
    ).toMatchObject({ type: 'hideTip' });
    wrapper.unmount();
  });

  it('CHART-06 滚动（touchmove 位移 > 8px）→ hideTip；微小抖动不误关', async () => {
    const ym = localDateKey().slice(0, 7);
    const inst = makeInst();
    const wrapper = await mountModule(DailyExpenseTrendModule, ym, localDateKey());
    fireChartClick(inst, { componentType: 'series', seriesIndex: 0, dataIndex: 1 }); // 显示
    const before = inst.dispatchAction.mock.calls.length;
    // 微小抖动（3px < 8px 阈值）→ 不关闭
    dispatchTouch('touchstart', 100);
    dispatchTouch('touchmove', 103);
    expect(inst.dispatchAction.mock.calls.length).toBe(before);
    // 正式滚动：位移 60px → 关闭
    dispatchTouch('touchstart', 100);
    dispatchTouch('touchmove', 160);
    expect(inst.dispatchAction.mock.calls.length).toBe(before + 1);
    expect(
      inst.dispatchAction.mock.calls[before][0],
    ).toMatchObject({ type: 'hideTip' });
    wrapper.unmount();
  });

  it('CHART-07 切月份（watch 刷新前）→ hideTip', async () => {
    const ym = localDateKey().slice(0, 7);
    const inst = makeInst();
    const wrapper = await mountModule(DailyExpenseTrendModule, ym, localDateKey());
    fireChartClick(inst, { componentType: 'series', seriesIndex: 0, dataIndex: 1 }); // 显示
    // 换月份：重新渲染 parent 传新 activeYm
    await wrapper.setProps({ activeYm: '2024-01' });
    await flushPromises();
    const types = inst.dispatchAction.mock.calls.map((c) => (c[0] as { type: string }).type);
    expect(types).toContain('hideTip');
    wrapper.unmount();
  });

  it('CHART-08 切页面 / KeepAlive 失活 → hideTip', async () => {
    const ym = localDateKey().slice(0, 7);
    const inst = makeInst();
    const Comp = defineComponent({
      components: { KeepAlive, DailyExpenseTrendModule },
      data: () => ({ show: true }),
      setup() {
        return { bills: seedMonthBills(ym), today: localDateKey() };
      },
      template: `
        <KeepAlive>
          <DailyExpenseTrendModule
            v-if="show"
            :bills="bills"
            :active-ym="'${ym}'"
            :today="today"
            :month-label="'9月'"
          />
        </KeepAlive>`,
    });
    const wrapper = mount(Comp, {
      attachTo: document.body,
      global: { plugins: [activePinia] },
    });
    await flushPromises();
    await new Promise((r) => setTimeout(r, 0));
    await flushPromises();
    fireChartClick(inst, { componentType: 'series', seriesIndex: 0, dataIndex: 1 }); // 显示
    // 切走（失活）
    await wrapper.setData({ show: false });
    await flushPromises();
    expect(
      inst.dispatchAction.mock.calls[inst.dispatchAction.mock.calls.length - 1][0],
    ).toMatchObject({ type: 'hideTip' });
    wrapper.unmount();
  });

  it('CHART-09 打开另一图表 Tooltip → 前一图自动关闭（容器外 pointerdown）', async () => {
    const ym = localDateKey().slice(0, 7);
    const instA = makeInst();
    const instB = makeInst();
    const wrapperA = await mountModule(DailyExpenseTrendModule, ym, localDateKey());
    const wrapperB = await mountModule(IncomeExpenseCompareModule, ym, localDateKey());
    // 图表 A 显示 Tooltip
    fireChartClick(instA, { componentType: 'series', seriesIndex: 0, dataIndex: 1 });
    // 点击图表 B 的数据点：pointerdown 落在 B 容器（A 容器外）→ A hideTip；随后 B click → showTip
    dispatchType('pointerdown', {}, wrapperB.find('.stats-module__chart').element);
    expect(
      instA.dispatchAction.mock.calls[instA.dispatchAction.mock.calls.length - 1][0],
    ).toMatchObject({ type: 'hideTip' });
    fireChartClick(instB, { componentType: 'series', seriesIndex: 0, dataIndex: 0 });
    expect(
      instB.dispatchAction.mock.calls[instB.dispatchAction.mock.calls.length - 1][0],
    ).toMatchObject({ type: 'showTip' });
    wrapperA.unmount();
    wrapperB.unmount();
  });

  it('B2 同点第二次点击走 pointerdown 抑制路径：面板开时容器内按下即先关，click 同点不重开', async () => {
    const ym = localDateKey().slice(0, 7);
    const inst = makeInst();
    const wrapper = await mountModule(DailyExpenseTrendModule, ym, localDateKey());
    fireChartClick(inst, { componentType: 'series', seriesIndex: 0, dataIndex: 1 }); // 显示（lastTap 记录）
    await new Promise((r) => setTimeout(r, 5));
    // 面板拦截第二次点击时，由 document capture pointerdown 兜底先关（不在容器内命中 zrender）
    dispatchType('pointerdown', {}, wrapper.find('.stats-module__chart').element);
    await new Promise((r) => setTimeout(r, 5));
    const types1 = inst.dispatchAction.mock.calls.map((c) => (c[0] as { type: string }).type);
    expect(types1).toContain('showTip');
    expect(types1.slice(types1.indexOf('showTip') + 1).every((t) => t === 'hideTip')).toBe(true);
    // 随后的 click 落到同一数据 → 被抑制，不重新 showTip / 不产生新 hide 之外的副作用
    fireChartClick(inst, { componentType: 'series', seriesIndex: 0, dataIndex: 1 });
    await new Promise((r) => setTimeout(r, 5));
    const types2 = inst.dispatchAction.mock.calls.map((c) => (c[0] as { type: string }).type);
    expect(types2.slice(1).every((t) => t === 'hideTip')).toBe(true);
    wrapper.unmount();
  });

  it('防抖：Tooltip 未开时，容器内 pointerdown 不会误关（首次点击不会“刚显示马上被关闭”）', async () => {
    const ym = localDateKey().slice(0, 7);
    const inst = makeInst();
    const wrapper = await mountModule(DailyExpenseTrendModule, ym, localDateKey());
    // 面板未开（lastTap=null）：容器内 pointerdown 不触发 hide
    dispatchType('pointerdown', {}, wrapper.find('.stats-module__chart').element);
    expect(inst.dispatchAction).not.toHaveBeenCalled();
    // 随后 ECharts click → 正常 showTip（未被上一轮 pointerdown 影响）
    fireChartClick(inst, { componentType: 'series', seriesIndex: 0, dataIndex: 1 });
    expect(
      inst.dispatchAction.mock.calls[inst.dispatchAction.mock.calls.length - 1][0],
    ).toMatchObject({ type: 'showTip' });
    wrapper.unmount();
  });
});