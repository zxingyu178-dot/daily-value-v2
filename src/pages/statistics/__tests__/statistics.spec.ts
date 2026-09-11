/**
 * 统计（Phase 4）测试
 * - 纯函数：computeOverview / computeCategoryShare / computeMonthlyTrend / computeMaxExpense / monthRange
 * - 数据只从 Bill 派生；daily-value-only 不进入统计；支出=绿色/收入=红色的数据口径正确
 * - 组件：月份切换 / 概览 / 最大单笔支出 / 分类图例 / ECharts 挂载与 option 数据
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { KeepAlive, defineComponent, h } from 'vue';
import { localDateKey } from '@/core/models/daily-value';
import type { Bill } from '@/core/models/types';
import DVDateTimeWheelPicker from '@/components/design/DVDateTimeWheelPicker.vue';
import DVWheelPicker from '@/components/design/DVWheelPicker.vue';
import type { DateTimeValue } from '@/components/design/DVDateTimeWheelPicker.vue';
import {
  computeOverview,
  computeCategoryShare,
  computeMonthlyTrend,
  computeMaxExpense,
  monthRange,
  summarizeBillsByDateRange,
} from '../statistics';
import StatisticsPage from '../StatisticsPage.vue';

const { initMock } = vi.hoisted(() => ({ initMock: vi.fn() }));
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

/** 种子数据：以“今天”所在月份为中心，跨 3 个月 */
function seedBills(): Bill[] {
  const today = localDateKey();
  const ym = today.slice(0, 7);
  const [y, m] = ym.split('-').map(Number);
  const pad = (n: number) => String(n).padStart(2, '0');
  const lastYM = `${m === 1 ? y - 1 : y}-${pad(m === 1 ? 12 : m - 1)}`;
  const last2YM = `${m <= 2 ? y - 1 : y}-${pad(m <= 2 ? m + 10 : m - 2)}`;

  return [
    makeBill({ id: 'e1', type: 'expense', amount: 25, categoryId: 'c-food', categoryName: '餐饮', categoryEmoji: '🍚', date: `${ym}-05` }),
    makeBill({ id: 'e2', type: 'expense', amount: 75, categoryId: 'c-food', categoryName: '餐饮', categoryEmoji: '🍚', date: `${ym}-10` }),
    makeBill({ id: 'e3', type: 'expense', amount: 40, categoryId: 'c-transport', categoryName: '交通', categoryEmoji: '🚗', date: `${ym}-12` }),
    makeBill({ id: 'e4', type: 'expense', amount: 300, categoryId: 'c-fun', categoryName: '娱乐', categoryEmoji: '🎮', date: `${ym}-20` }),
    makeBill({ id: 'i1', type: 'income', amount: 100, categoryId: 'c-salary', categoryName: '工资', categoryEmoji: '💰', date: `${ym}-01` }),
    // daily-value-only：不进入统计
    makeBill({ id: 'dv', type: 'expense', amount: 999, categoryId: 'c-dv', categoryName: '日价', categoryEmoji: '📦', date: `${ym}-15`, ledgerImpact: 'daily-value-only' }),
    makeBill({ id: 'l1', type: 'expense', amount: 10, categoryId: 'c-food', categoryName: '餐饮', categoryEmoji: '🍚', date: `${lastYM}-08` }),
    makeBill({ id: 'l2', type: 'expense', amount: 20, categoryId: 'c-food', categoryName: '餐饮', categoryEmoji: '🍚', date: `${last2YM}-08` }),
  ];
}

describe('统计纯函数（Bill 派生）', () => {
  let bills: Bill[];
  beforeEach(() => {
    bills = seedBills();
  });

  it('computeOverview：当月支出/收入/结余正确，排除 daily-value-only', () => {
    const ym = localDateKey().slice(0, 7);
    const s = computeOverview(bills, ym);
    expect(s.expense).toBe(440);
    expect(s.income).toBe(100);
    expect(s.net).toBe(-340);
  });

  it('computeOverview：其它月份独立统计', () => {
    const today = localDateKey();
    const ym = today.slice(0, 7);
    const [y, m] = ym.split('-').map(Number);
    const pad = (n: number) => String(n).padStart(2, '0');
    const lastYM = `${m === 1 ? y - 1 : y}-${pad(m === 1 ? 12 : m - 1)}`;
    const s = computeOverview(bills, lastYM);
    expect(s.expense).toBe(10);
    expect(s.income).toBe(0);
    expect(s.net).toBe(-10);
  });

  it('computeCategoryShare：按金额降序，percent 正确，排除收入与 daily-value-only', () => {
    const ym = localDateKey().slice(0, 7);
    const shares = computeCategoryShare(bills, ym);
    expect(shares.map((s) => s.name)).toEqual(['娱乐', '餐饮', '交通']);
    expect(shares[0].amount).toBe(300);
    expect(shares[0].percent).toBe(68.2);
    expect(shares[1].amount).toBe(100);
    expect(shares[1].percent).toBe(22.7);
    expect(shares[2].amount).toBe(40);
    expect(shares[2].percent).toBe(9.1);
    // 总占比 ≈ 100%
    const total = shares.reduce((a, s) => a + s.percent, 0);
    expect(total).toBeCloseTo(100, 1);
  });

  it('computeCategoryShare：无支出月份返回空数组', () => {
    expect(computeCategoryShare(bills, '1990-01')).toEqual([]);
  });

  it('computeMonthlyTrend：最近 6 个月（含当前月，旧→新），月度汇总正确', () => {
    const trend = computeMonthlyTrend(bills, 6);
    expect(trend).toHaveLength(6);
    const ym = localDateKey().slice(0, 7);
    const last = trend[trend.length - 1];
    expect(last.ym).toBe(ym);
    expect(last.expense).toBe(440);
    expect(last.income).toBe(100);
    // 上一月与上上月汇总
    const [y, m] = ym.split('-').map(Number);
    const pad = (n: number) => String(n).padStart(2, '0');
    const lastYM = `${m === 1 ? y - 1 : y}-${pad(m === 1 ? 12 : m - 1)}`;
    const last2YM = `${m <= 2 ? y - 1 : y}-${pad(m <= 2 ? m + 10 : m - 2)}`;
    const p1 = trend.find((t) => t.ym === lastYM);
    const p2 = trend.find((t) => t.ym === last2YM);
    expect(p1?.expense).toBe(10);
    expect(p2?.expense).toBe(20);
  });

  it('computeMaxExpense：当月最大单笔支出（仅支出）', () => {
    const ym = localDateKey().slice(0, 7);
    const max = computeMaxExpense(bills, ym);
    expect(max?.id).toBe('e4');
    expect(max?.amount).toBe(300);
  });

  it('computeMaxExpense：无支出月份返回 undefined', () => {
    expect(computeMaxExpense(bills, '1990-01')).toBeUndefined();
  });

  it('monthRange：端点包含，连续生成', () => {
    expect(monthRange('2026-08', '2026-10')).toEqual(['2026-08', '2026-09', '2026-10']);
    expect(monthRange('2025-11', '2026-02')).toEqual([
      '2025-11',
      '2025-12',
      '2026-01',
      '2026-02',
    ]);
  });
});

describe('统计页面（ECharts 打桩）', () => {
  beforeEach(() => {
    initMock.mockReset();
    initMock.mockImplementation(() => ({
      setOption: vi.fn(),
      resize: vi.fn(),
      dispose: vi.fn(),
      on: vi.fn(),
      dispatchAction: vi.fn(),
    }));
  });

  it('概览：支出/收入/结余渲染正确，最大单笔支出卡片展示，daily-value-only 不计入', async () => {
    // 直接注入 store 数据（页面只读）
    const pinia = createPinia();
    setActivePinia(pinia);
    const { useBillStore } = await import('@/core/store/bill');
    const store = useBillStore(pinia);
    store.bills = seedBills();
    store.loaded = true;

    const wrapper = mount(StatisticsPage, { global: { plugins: [pinia] } });
    await flushPromises();
    await new Promise((r) => setTimeout(r, 0));
    await flushPromises();

    const text = wrapper.text();
    expect(text).toContain('440.00');
    expect(text).toContain('100.00');
    expect(text).toContain('-340.00');
    expect(text).toContain('最大单笔支出');
    expect(text).toContain('300.00');
    // 分类图例：娱乐 / 餐饮 / 交通（收入与 daily-value-only 不出现）
    expect(text).toContain('娱乐');
    expect(text).toContain('餐饮');
    expect(text).toContain('交通');
    expect(text).not.toContain('999.00');
  });

  it('月份切换：‹ 可切到上一月并更新概览；到最老边界箭头禁用', async () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    const { useBillStore } = await import('@/core/store/bill');
    const store = useBillStore(pinia);
    store.bills = seedBills();
    store.loaded = true;

    const wrapper = mount(StatisticsPage, { global: { plugins: [pinia] } });
    await flushPromises();
    await new Promise((r) => setTimeout(r, 0));
    await flushPromises();

    const prevBtn = wrapper.find('button[aria-label="上一月"]');
    expect(prevBtn.attributes('disabled')).toBeUndefined();
    await prevBtn.trigger('click');
    await flushPromises();
    // 上月概览：支出 10（仅断言月度概览卡，不整页 text——自定义日期区间卡可能仍显示当前月数据）
    const ovValues = wrapper.findAll('.stats__ov-value').map((v) => v.text());
    expect(ovValues[0]).toContain('10.00');
    expect(ovValues[0]).not.toContain('440.00');
  });

  // 2.9.6（P0-2）：空数据时图表容器必须【持久存在】仅隐藏（visibility），
  // 旧断言「空数据不渲染图表容器」把错误架构锁住了——v-if 销毁 DOM 正是环形图消失的根因。
  it('空数据：显示空状态覆盖层，图表容器仍持久存在且仅隐藏（不销毁 DOM）', async () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    const { useBillStore } = await import('@/core/store/bill');
    const store = useBillStore(pinia);
    store.bills = [];
    store.loaded = true;

    const wrapper = mount(StatisticsPage, { global: { plugins: [pinia] } });
    await flushPromises();
    await new Promise((r) => setTimeout(r, 0));
    await flushPromises();

    // 空状态覆盖层文案存在
    expect(wrapper.find('.stats__empty--overlay').text()).toContain('暂无支出');
    // 图表容器不销毁（P0-2 修复的核心）：ring/bar 两个 chart DOM 都在，仅加 is-hidden
    const charts = wrapper.findAll('.stats__chart');
    expect(charts).toHaveLength(2);
    expect(charts.every((c) => c.classes().includes('is-hidden'))).toBe(true);
    // 持久 DOM 依旧可被 ECharts 初始化（无数据时也初始化，避免切回有数据时实例缺失）
    expect(echartInstanceByClass('stats__chart--ring')).toBeTruthy();
    expect(echartInstanceByClass('stats__chart--bar')).toBeTruthy();
  });

  it('ECharts：环形图与柱状图挂载，option 数据来自 Bill 派生', async () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    const { useBillStore } = await import('@/core/store/bill');
    const store = useBillStore(pinia);
    store.bills = seedBills();
    store.loaded = true;

    mount(StatisticsPage, { global: { plugins: [pinia] } });
    await flushPromises();
    await new Promise((r) => setTimeout(r, 0));
    await flushPromises();

    expect(echartInstanceByClass('stats__chart--ring')).toBeTruthy();
    expect(echartInstanceByClass('stats__chart--bar')).toBeTruthy();
    const ringChart = echartInstanceByClass('stats__chart--ring')!;
    const barChart2 = echartInstanceByClass('stats__chart--bar')!;
    // 环形图 option：pie 数据 = 分类占比（娱乐/餐饮/交通）
    const ringOpt = ringChart.setOption.mock.calls[0][0] as {
      series: Array<{ type: string; data: Array<{ name: string }> }>;
    };
    expect(ringOpt.series[0].type).toBe('pie');
    expect(ringOpt.series[0].data.map((d) => d.name)).toEqual(['娱乐', '餐饮', '交通']);
    // 柱状图 option：bar 数据 = 最近 6 个月趋势
    const barOpt = barChart2.setOption.mock.calls[0][0] as {
      series: Array<{ type: string; data: number[] }>;
    };
    expect(barOpt.series.map((s) => s.type)).toEqual(['bar', 'bar']);
    expect(barOpt.series[0].data[barOpt.series[0].data.length - 1]).toBe(440);
  });
});

/* =====================================================================
 * 2.9.6（P0-2）统计图表生命周期回归测试（STAT-LIFE-01..06）
 * 根因：v-if 销毁 ECharts 容器 → 实例失联 → 切回有数据月份环形图消失。
 * 修复：图表容器持久存在（visibility 隐藏），独立 init，统一 watch + onActivated。
 * 这里全部通过真实 mount/导航/KeepAlive 往返断言，不用字符串源码检查代替。
 * ===================================================================== */

/** 空月往返种子：当前月(ym)有支出、ym-3 有支出、中间 ym-1/ym-2 完全无支出 */
function seedEmptyMiddle(): Bill[] {
  const today = localDateKey();
  const ym = today.slice(0, 7);
  const [y, m] = ym.split('-').map(Number);
  const pad = (n: number) => String(n).padStart(2, '0');
  const minus = (offset: number) => {
    let ty = y;
    let tm = m - offset;
    while (tm <= 0) {
      tm += 12;
      ty -= 1;
    }
    return `${ty}-${pad(tm)}`;
  };
  const ym3 = minus(3);
  return [
    makeBill({ id: 'c1', type: 'expense', amount: 60, categoryId: 'c-food', categoryName: '餐饮', categoryEmoji: '🍚', date: `${ym}-05` }),
    makeBill({ id: 'c2', type: 'expense', amount: 40, categoryId: 'c-transport', categoryName: '交通', categoryEmoji: '🚗', date: `${ym}-12` }),
    makeBill({ id: 'c3', type: 'expense', amount: 30, categoryId: 'c-food', categoryName: '餐饮', categoryEmoji: '🍚', date: `${ym3}-08` }),
  ];
}

/** 通用挂载：注入种子账单 + 返回实例辅助 */
async function mountStats(bills: Bill[]) {
  const pinia = createPinia();
  setActivePinia(pinia);
  const { useBillStore } = await import('@/core/store/bill');
  const store = useBillStore(pinia);
  store.bills = bills;
  store.loaded = true;
  const wrapper = mount(StatisticsPage, { global: { plugins: [pinia] } });
  await flushPromises();
  await new Promise((r) => setTimeout(r, 0));
  await flushPromises();
  return { wrapper, store };
}

/**
 * 2.12.0：统计页除原有的环形图(ring)/柱状图(bar)外，还新增了多个 ECharts 统计模块。
 * 因此不能再用 initMock.results[0]/[1] 假定 ring/bar，改为按各图表容器 class 定位对应实例。
 */
function echartInstanceByClass(cls: string) {
  const calls = initMock.mock.calls;
  const idx = calls.findIndex((c) => {
    const el = c[0] as HTMLElement | undefined;
    return !!el && typeof el.classList !== 'undefined' && el.classList.contains(cls);
  });
  if (idx < 0) return undefined;
  return initMock.mock.results[idx]!.value as {
    setOption: ReturnType<typeof vi.fn>;
    resize: ReturnType<typeof vi.fn>;
    dispose: ReturnType<typeof vi.fn>;
    on: ReturnType<typeof vi.fn>;
    dispatchAction: ReturnType<typeof vi.fn>;
  };
}
/** 初始化次数（含模块图表）；用「导航/切活前后不产生新实例」断言无泄漏，而非硬编码图表个数 */
function initCount() {
  return initMock.mock.calls.length;
}

describe('统计图表生命周期（P0-2 稳定性修复）', () => {
  beforeEach(() => {
    initMock.mockReset();
    initMock.mockImplementation(() => ({
      setOption: vi.fn(),
      resize: vi.fn(),
      dispose: vi.fn(),
      on: vi.fn(),
      dispatchAction: vi.fn(),
    }));
  });

  it('STAT-LIFE-01 当前月有支出：环形图存在且可见（未加 is-hidden）', async () => {
    const { wrapper } = await mountStats(seedEmptyMiddle());
    const ring = wrapper.find('.stats__chart--ring');
    expect(ring.exists()).toBe(true);
    expect(ring.classes()).not.toContain('is-hidden');
    // 环形图有数据：无空状态覆盖层
    expect(wrapper.find('.stats__empty--overlay').exists()).toBe(false);
    // 环 + 柱（及统计模块）实例均已初始化
    expect(echartInstanceByClass('stats__chart--ring')).toBeTruthy();
    expect(echartInstanceByClass('stats__chart--bar')).toBeTruthy();
  });

  it('STAT-LIFE-02 切到完全无支出月份：显示“本月暂无支出”，ringRef DOM 仍存在', async () => {
    const { wrapper } = await mountStats(seedEmptyMiddle());
    const ring = wrapper.find('.stats__chart--ring');
    const prevBtn = wrapper.find('button[aria-label="上一月"]');

    // 当前月 ym → 上一月 ym-1（无支出）
    await prevBtn.trigger('click');
    await flushPromises();

    // 空状态覆盖层出现
    expect(wrapper.find('.stats__empty--overlay').text()).toContain('本月暂无支出');
    // DOM 不销毁：ringRef 依旧存在，仅加 is-hidden（visibility 隐藏）
    expect(ring.exists()).toBe(true);
    expect(ring.classes()).toContain('is-hidden');
    // 且仍持有 ECharts 实例（不因空数据重新 init）
    expect(echartInstanceByClass('stats__chart--ring')).toBeTruthy();
  });

  it('STAT-LIFE-03【复现用户 Bug】有数据→空月→再回有数据：环形图恢复正常，setOption 用当前月数据', async () => {
    const { wrapper } = await mountStats(seedEmptyMiddle());
    const ring = wrapper.find('.stats__chart--ring');
    const prevBtn = wrapper.find('button[aria-label="上一月"]');
    const nextBtn = wrapper.find('button[aria-label="下一月"]');

    const ringInstance = echartInstanceByClass('stats__chart--ring')!;
    const setCallsBefore = ringInstance.setOption.mock.calls.length;
    const initBefore = initCount();

    // 有数据 → 空月
    await prevBtn.trigger('click');
    await flushPromises();
    expect(ring.classes()).toContain('is-hidden');
    // 空月 → 有数据（回到当前月）
    await nextBtn.trigger('click');
    await flushPromises();

    // 环形图重新可见
    expect(ring.classes()).not.toContain('is-hidden');
    // setOption 使用的是当前月数据（餐饮/交通），且确实发生了新的渲染
    const calls = ringInstance.setOption.mock.calls;
    expect(calls.length).toBeGreaterThan(setCallsBefore);
    const lastCall = calls[calls.length - 1]![0];
    expect(lastCall.series[0].type).toBe('pie');
    expect(lastCall.series[0].data.map((d: { name: string }) => d.name)).toEqual(['餐饮', '交通']);
    // 未创建泄漏的多个 ECharts 实例（切月不重建）
    expect(initCount()).toBe(initBefore);
  });

  it('STAT-LIFE-04 有→无→有往返 10 次：图表不消失、不创建泄漏实例', async () => {
    const { wrapper } = await mountStats(seedEmptyMiddle());
    const ring = wrapper.find('.stats__chart--ring');
    const bar = wrapper.find('.stats__chart--bar');
    const prevBtn = wrapper.find('button[aria-label="上一月"]');
    const nextBtn = wrapper.find('button[aria-label="下一月"]');
    const initBefore = initCount();

    for (let i = 0; i < 10; i += 1) {
      // 有 → 无：环形图隐藏但 DOM 存在
      await prevBtn.trigger('click');
      await flushPromises();
      expect(ring.classes()).toContain('is-hidden');
      // 柱状图是最近 6 个月趋势：空月份时其余月份仍有数据，不隐藏但 DOM 必须存在
      expect(bar.exists()).toBe(true);
      // 无 → 有：环形图恢复可见
      await nextBtn.trigger('click');
      await flushPromises();
      expect(ring.classes()).not.toContain('is-hidden');
      expect(wrapper.find('.stats__chart--ring').exists()).toBe(true);
    }

    // 全程不创建泄漏实例（无 v-if 重建）
    expect(initCount()).toBe(initBefore);
  });

  it('STAT-LIFE-05 记账新增一笔后返回统计：环图与趋势立即更新（KeepAlive onActivated 路径）', async () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    const { useBillStore } = await import('@/core/store/bill');
    const store = useBillStore(pinia);
    store.bills = seedEmptyMiddle();
    store.loaded = true;

    // KeepAlive 包裹：active=false 时 StatisticsPage 被缓存（不 unmount），active=true 时触发 onActivated
    const Harness = defineComponent({
      name: 'KeepAliveHarness',
      components: { StatisticsPage },
      props: { active: { type: Boolean, default: true } },
      setup(props) {
        return () =>
          h(KeepAlive, null, {
            default: () => (props.active ? h(StatisticsPage) : null),
          });
      },
    });

    const wrapper = mount(Harness, { props: { active: true }, global: { plugins: [pinia] } });
    await flushPromises();
    await new Promise((r) => setTimeout(r, 0));
    await flushPromises();

    const ringInstance = echartInstanceByClass('stats__chart--ring')!;
    const barInstance = echartInstanceByClass('stats__chart--bar')!;
    const initBefore = initCount();

    // 模拟：离开统计（缓存）→ 记账新增一笔
    await wrapper.setProps({ active: false });
    await flushPromises();
    store.bills = [
      ...store.bills,
      makeBill({ id: 'new1', type: 'expense', amount: 88, categoryId: 'c-fun', categoryName: '娱乐', categoryEmoji: '🎮', date: `${localDateKey().slice(0, 7)}-15` }),
    ];
    await flushPromises();

    // 返回统计 → onActivated 触发重绘 + resize
    await wrapper.setProps({ active: true });
    await flushPromises();
    await new Promise((r) => setTimeout(r, 0));
    await flushPromises();

    // 环图重绘且包含新账单分类
    const calls = ringInstance.setOption.mock.calls;
    const lastCall = calls[calls.length - 1]![0];
    expect(lastCall.series[0].data.map((d: { name: string }) => d.name)).toContain('娱乐');
    // 趋势图也重绘（新增账单月份为当前月 → 趋势最后一项增加）
    const barCalls = barInstance.setOption.mock.calls;
    const lastBar = barCalls[barCalls.length - 1]![0];
    const lastExpense = lastBar.series[0].data[lastBar.series[0].data.length - 1] as number;
    expect(lastExpense).toBeGreaterThan(100); // 原当前月 100 + 新 88
    // 不重启 App：仍是同一批实例（未重新 init）
    expect(initCount()).toBe(initBefore);
  });

  it('STAT-LIFE-06 KeepAlive 离开/回来：resize 执行，图表不空白', async () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    const { useBillStore } = await import('@/core/store/bill');
    const store = useBillStore(pinia);
    store.bills = seedEmptyMiddle();
    store.loaded = true;

    const Harness = defineComponent({
      name: 'KeepAliveHarness',
      components: { StatisticsPage },
      props: { active: { type: Boolean, default: true } },
      setup(props) {
        return () =>
          h(KeepAlive, null, {
            default: () => (props.active ? h(StatisticsPage) : null),
          });
      },
    });

    const wrapper = mount(Harness, { props: { active: true }, global: { plugins: [pinia] } });
    await flushPromises();
    await new Promise((r) => setTimeout(r, 0));
    await flushPromises();

    const ringInstance = echartInstanceByClass('stats__chart--ring')!;
    const barInstance = echartInstanceByClass('stats__chart--bar')!;
    const initBefore = initCount();
    expect(ringInstance.resize).not.toHaveBeenCalled();

    // 离开 → 回来（KeepAlive 缓存，不 unmount；回来走 onActivated）
    await wrapper.setProps({ active: false });
    await flushPromises();
    await wrapper.setProps({ active: true });
    await flushPromises();
    await new Promise((r) => setTimeout(r, 0));
    await flushPromises();

    // 两个图表都 resize（页面尺寸恢复 → 图表不空白）
    expect(ringInstance.resize).toHaveBeenCalled();
    expect(barInstance.resize).toHaveBeenCalled();
    // 组件未被销毁重建（实例仍是同一批）
    expect(initCount()).toBe(initBefore);
  });
});

/* =====================================================================
 * 2.10.0 自定义日期区间统计（RANGE-01..10）
 * 纯函数 summarizeBillsByDateRange + 页面自定义日期统计卡片。
 * ===================================================================== */

/** 固定日期区间测试种子（含 daily-value-only 不计入口径样本） */
function rangeBills(): Bill[] {
  return [
    makeBill({ id: 'r1', type: 'expense', amount: 100, date: '2026-08-01' }),
    makeBill({ id: 'r2', type: 'expense', amount: 50, date: '2026-08-31' }),
    makeBill({ id: 'r3', type: 'expense', amount: 30, date: '2026-07-20' }),
    makeBill({ id: 'r4', type: 'income', amount: 500, date: '2026-08-10' }),
    makeBill({ id: 'r5', type: 'expense', amount: 20, date: '2026-09-01' }),
    makeBill({ id: 'r6', type: 'income', amount: 200, date: '2025-12-30' }),
    makeBill({ id: 'r7', type: 'expense', amount: 999, date: '2026-08-15', ledgerImpact: 'daily-value-only' }),
  ];
}

describe('RANGE 自定义日期区间统计纯函数（summarizeBillsByDateRange）', () => {
  let bills: Bill[];
  beforeEach(() => {
    bills = rangeBills();
  });

  it('RANGE-01 8月1日到8月31日：两端账单都计入', () => {
    const s = summarizeBillsByDateRange(bills, '2026-08-01', '2026-08-31');
    expect(s.expense).toBe(150); // r1(100) + r2(50)；r7 daily-value-only 不计
    expect(s.income).toBe(500); // r4
    expect(s.count).toBe(3);
  });

  it('RANGE-02 跨月 7月20日→8月10日：正确统计两个月内的数据', () => {
    const s = summarizeBillsByDateRange(bills, '2026-07-20', '2026-08-10');
    // r3(30,7-20) + r1(100,8-01) 支出；r4(500,8-10) 收入；r2(8-31) 超出区间不计
    expect(s.expense).toBe(130);
    expect(s.income).toBe(500);
    expect(s.count).toBe(3);
  });

  it('RANGE-03 跨年 2025-12-25 → 2026-01-05：正确', () => {
    const s = summarizeBillsByDateRange(bills, '2025-12-25', '2026-01-05');
    expect(s.expense).toBe(0);
    expect(s.income).toBe(200); // r6(2025-12-30)
    expect(s.count).toBe(1);
  });

  it('RANGE-04 daily-value-only 不计入（999 不进入区间收支）', () => {
    const s = summarizeBillsByDateRange(bills, '2026-08-01', '2026-08-31');
    expect(s.expense).toBe(150); // 若 r7(999) 计入则为 1149
    expect(s.count).toBe(3);
  });

  it('RANGE-05 expense / income 分别正确', () => {
    const s = summarizeBillsByDateRange(bills, '2026-08-01', '2026-08-31');
    expect(s.expense).toBe(150);
    expect(s.income).toBe(500);
  });

  it('RANGE-06 balance = income - expense', () => {
    const s = summarizeBillsByDateRange(bills, '2026-08-01', '2026-08-31');
    expect(s.balance).toBe(500 - 150);
  });

  it('RANGE-08 无账单：支出/收入/结余均为 0', () => {
    const s = summarizeBillsByDateRange([], '2026-01-01', '2030-12-31');
    expect(s.expense).toBe(0);
    expect(s.income).toBe(0);
    expect(s.balance).toBe(0);
    expect(s.count).toBe(0);
  });
});

/** 通过真实滚轮选择器为「自定义日期统计」设置区间端点（同 QuickEntry pickDateTime 思路）。
 *  统计页自身 DOM 挂载在 wrapper 上（非 document.body），日期格用 wrapper 定位；
 *  滚轮 Picker Teleport 到 body，确认按钮用 document.body 定位。 */
async function pickRangeDate(wrapper: VueWrapper, target: 'start' | 'end', dt: DateTimeValue) {
  const cells = wrapper.findAll('.stats__range-date');
  expect(cells.length).toBe(2);
  await cells[target === 'start' ? 0 : 1].trigger('click');
  await flushPromises();
  const picker = wrapper.findComponent(DVDateTimeWheelPicker);
  expect(picker.exists()).toBe(true);
  const wheels = picker.findAllComponents(DVWheelPicker);
  expect(wheels.length).toBe(3); // showTime=false：只有年/月/日
  const [yW, moW, dW] = wheels;
  yW.vm.$emit('update:modelValue', dt.year);
  moW.vm.$emit('update:modelValue', dt.month);
  dW.vm.$emit('update:modelValue', dt.day);
  await flushPromises();
  const ok = document.body.querySelector<HTMLElement>('.dv-dtp__ok');
  expect(ok).not.toBeNull();
  ok!.click();
  await flushPromises();
}

describe('RANGE 自定义日期统计页面（2.10.0）', () => {
  beforeEach(() => {
    initMock.mockReset();
    initMock.mockImplementation(() => ({
      setOption: vi.fn(),
      resize: vi.fn(),
      dispose: vi.fn(),
      on: vi.fn(),
      dispatchAction: vi.fn(),
    }));
  });

  it('RANGE-00 默认显示：开始=本月1日，结束=今天；区间明细正确不驱动月度概览', async () => {
    const today = localDateKey();
    const defaultStart = `${today.slice(0, 7)}-01`;
    const pinia = createPinia();
    setActivePinia(pinia);
    const { useBillStore } = await import('@/core/store/bill');
    const store = useBillStore(pinia);
    store.bills = rangeBills();
    store.loaded = true;

    const wrapper = mount(StatisticsPage, { global: { plugins: [pinia] } });
    await flushPromises();
    await new Promise((r) => setTimeout(r, 0));
    await flushPromises();

    const values = wrapper.findAll('.stats__range-date-value');
    expect(values[0].text()).toBe(defaultStart);
    expect(values[1].text()).toBe(today);
    // 区间明细：本月1日~今天（含 daily-value-only 不计）
    expect(wrapper.find('.stats__title').text()).toContain('自定义日期统计');
    const text = wrapper.text();
    expect(text).not.toContain('NaN');
  });

  it('RANGE-07 开始晚于结束：显示错误、保留用户选择、不产生错误数据/NaN', async () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    const { useBillStore } = await import('@/core/store/bill');
    const store = useBillStore(pinia);
    store.bills = [{ ...makeBill({ id: 'x1', type: 'expense', amount: 66, date: localDateKey() }), id: 'x1' }];
    store.loaded = true;

    const wrapper = mount(StatisticsPage, { global: { plugins: [pinia] } });
    await flushPromises();
    await new Promise((r) => setTimeout(r, 0));
    await flushPromises();

    // 把结束日期改成 2026-01-01（早于默认开始 = 本月1日）→ 范围无效
    await pickRangeDate(wrapper, 'end', { year: 2026, month: 1, day: 1, hour: 0, minute: 0 });
    await flushPromises();

    const err = wrapper.find('.stats__range-error');
    expect(err.exists()).toBe(true);
    expect(err.text()).toContain('开始日期不能晚于结束日期');
    // 两个日期格进入错误态（is-error）
    expect(wrapper.findAll('.stats__range-date.is-error').length).toBe(2);
    // 保留用户选择：结束日期仍是 2026-01-01（不静默交换）
    const values = wrapper.findAll('.stats__range-date-value');
    expect(values[1].text()).toBe('2026-01-01');
    // 不产生错误数据/NaN：区间金额仍是最近有效汇总的格式化数字
    expect(wrapper.text()).not.toContain('NaN');
  });

  it('RANGE-09 412px 窄屏：两个日期格完整渲染 yyyy-MM-dd，不裁掉数字', async () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    const { useBillStore } = await import('@/core/store/bill');
    const store = useBillStore(pinia);
    store.bills = [];
    store.loaded = true;

    const wrapper = mount(StatisticsPage, { global: { plugins: [pinia] } });
    await flushPromises();
    await new Promise((r) => setTimeout(r, 0));
    await flushPromises();

    window.innerWidth = 412;
    window.dispatchEvent(new Event('resize'));
    await flushPromises();
    // 日期永不 ellipsis：value span 用 nowrap + 完整日期文本，DOM 文本即完整 yyyy-MM-dd
    for (const el of wrapper.findAll('.stats__range-date-value')) {
      const text = el.text();
      expect(text).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
    // 两个日期格（开始/结束）均存在且 label 正确
    const labels = wrapper.findAll('.stats__range-date-label');
    expect(labels.map((l) => l.text())).toEqual(['开始日期', '结束日期']);
  });

  it('RANGE-10 月份切换不影响自定义区间；自定义区间不改月度概览/ECharts', async () => {
    const today = localDateKey();
    const ym = today.slice(0, 7);
    const [y, mo] = ym.split('-').map(Number);
    const pad = (n: number) => String(n).padStart(2, '0');
    const lastYM = `${mo === 1 ? y - 1 : y}-${pad(mo === 1 ? 12 : mo - 1)}`;
    const pinia = createPinia();
    setActivePinia(pinia);
    const { useBillStore } = await import('@/core/store/bill');
    const store = useBillStore(pinia);
    store.bills = [
      makeBill({ id: 'a1', type: 'expense', amount: 300, date: `${ym}-10` }),
      makeBill({ id: 'a2', type: 'expense', amount: 90, date: `${lastYM}-10` }),
    ];
    store.loaded = true;

    const wrapper = mount(StatisticsPage, { global: { plugins: [pinia] } });
    await flushPromises();
    await new Promise((r) => setTimeout(r, 0));
    await flushPromises();

    const rangeDatesBefore = wrapper.findAll('.stats__range-date-value').map((v) => v.text());
    // 切到上一月：月度概览变化（90），但自定义区间日期保持不变
    await wrapper.find('button[aria-label="上一月"]').trigger('click');
    await flushPromises();
    expect(wrapper.text()).toContain('90.00');
    const rangeDatesAfter = wrapper.findAll('.stats__range-date-value').map((v) => v.text());
    expect(rangeDatesAfter).toEqual(rangeDatesBefore);

    // 修改自定义区间端点：月度概览数字不变，区间数组发生变化（区间独立）
    await pickRangeDate(wrapper, 'start', { year: 2024, month: 1, day: 1, hour: 0, minute: 0 });
    await flushPromises();
    const startValue = wrapper.findAll('.stats__range-date-value')[0].text();
    expect(startValue).toBe('2024-01-01');
    expect(wrapper.text()).toContain('90.00'); // 月度概览仍是上一月 90，未被区间改动影响
  });
});
