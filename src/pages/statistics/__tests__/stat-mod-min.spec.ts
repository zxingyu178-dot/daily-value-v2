/**
 * 2.13.2 统计模块「至少保留 1 个」约束测试（STAT-MOD-01..07）
 * - normalizeStatisticsModules 纯函数：空数组/未知 ID/重复 ID 兼容修复（STAT-MOD-04/05/06）
 * - settingsStore.setStatisticsModules 数据层兜底：空数组拒绝保存返回 false（STAT-MOD-01/02/07）
 * - settingsStore.load 旧数据自动修复：[]/['unknown-id']/重复 → 恢复默认或去重（STAT-MOD-04/05/06）
 * - 重启保持：单一模块 load(true) 后仍存在（STAT-MOD-03）
 * - 组件交互：只剩最后一个开启项点击关闭 → 保持 ON + Toast（STAT-MOD-02）
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import type { Settings } from '@/core/models/types';
import { services } from '@/core/services';
import { useSettingsStore } from '@/core/store/settings';
import { DEFAULT_STAT_MODULE_ID, normalizeStatisticsModules, STATISTICS_MODULES } from '../statistics-module-types';
import { toast, toasts } from '@/components/design/toast';
import StatisticsModuleHost from '../StatisticsModuleHost.vue';

const ALL_IDS = STATISTICS_MODULES.map((m) => m.id);

const { initMock } = vi.hoisted(() => ({ initMock: vi.fn() }));
vi.mock('echarts/core', () => ({ use: vi.fn(), init: (...args: unknown[]) => initMock(...args) }));
vi.mock('echarts/charts', () => ({ PieChart: {}, BarChart: {}, LineChart: {} }));
vi.mock('echarts/components', () => ({
  TitleComponent: {},
  TooltipComponent: {},
  LegendComponent: {},
  GridComponent: {},
  MarkLineComponent: {},
}));
vi.mock('echarts/renderers', () => ({ SVGRenderer: {} }));

/** 可用的 ECharts 桩实例（useModuleChart 生命周期的 setOption/resize/dispose/on 全部落桩） */
function chartInstance() {
  return {
    setOption: vi.fn(),
    resize: vi.fn(),
    dispose: vi.fn(),
    on: vi.fn(),
    dispatchAction: vi.fn(),
  };
}

const baseSettings = (partial: Partial<Settings> = {}): Settings => ({
  currency: '¥',
  theme: 'light',
  themeColor: 'violet',
  themeStyle: 'classic',
  sort: 'per',
  wallpaper: undefined,
  ...partial,
});

/** 用内存 mock 替换 settings 服务（确定性），返回可读的最新值 */
function mockSettingsService(initial: Settings) {
  let current: Settings = { ...initial };
  const getSpy = vi.spyOn(services.settings, 'get').mockImplementation(async () => ({ ...current }) as never);
  const updateSpy = vi.spyOn(services.settings, 'update').mockImplementation(async (patch) => {
    current = { ...current, ...patch };
    return { ...current } as never;
  });
  return { getSpy, updateSpy, get current() { return current; } };
}

describe('normalizeStatisticsModules 纯函数', () => {
  it('STAT-MOD-04 Settings 旧数据 [] → 恢复默认「每日花费趋势」', () => {
    expect(normalizeStatisticsModules([])).toEqual([DEFAULT_STAT_MODULE_ID]);
  });
  it('STAT-MOD-04b 字段不存在（undefined）→ 恢复默认', () => {
    expect(normalizeStatisticsModules(undefined)).toEqual([DEFAULT_STAT_MODULE_ID]);
  });
  it('STAT-MOD-05 全部为未知 ID → 恢复默认模块', () => {
    expect(normalizeStatisticsModules(['unknown-id', 'old-deleted-id'])).toEqual([DEFAULT_STAT_MODULE_ID]);
  });
  it('STAT-MOD-05b 部分未知 ID → 只保留合法模块', () => {
    expect(normalizeStatisticsModules(['unknown-id', 'category-ranking'])).toEqual(['category-ranking']);
  });
  it('STAT-MOD-06 重复 ID → 自动去重（保留首次出现顺序）', () => {
    expect(normalizeStatisticsModules(['category-ranking', 'daily-expense-trend', 'category-ranking'])).toEqual([
      'category-ranking',
      'daily-expense-trend',
    ]);
  });
  it('合法列表原样保留（幂等）', () => {
    const list = ALL_IDS.slice(0, 2);
    expect(normalizeStatisticsModules(list)).toEqual(list);
  });
});

describe('settingsStore 数据层兜底（至少保留 1 个）', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    setActivePinia(createPinia());
  });

  it('STAT-MOD-01 四个全部开启：可以关闭任意三个（最终保留 1 个）', async () => {
    const svc = mockSettingsService(baseSettings({ statisticsModules: [...ALL_IDS] }));
    const settings = useSettingsStore();
    await settings.load();
    for (let i = 0; i < 3; i += 1) {
      const ok = await settings.setStatisticsModules(settings.statisticsModules!.slice(1));
      expect(ok).toBe(true);
    }
    expect(settings.statisticsModules).toHaveLength(1);
    expect(svc.updateSpy).toHaveBeenCalledTimes(3); // load 无修复不持久化；仅 3 次关闭
  });

  it('STAT-MOD-07 两个模块开启：关闭其中一个正常（不被错误阻止）', async () => {
    const svc = mockSettingsService(baseSettings({ statisticsModules: ALL_IDS.slice(0, 2) }));
    const settings = useSettingsStore();
    await settings.load();
    const ok = await settings.setStatisticsModules(['category-ranking']);
    expect(ok).toBe(true);
    expect(settings.statisticsModules).toEqual(['category-ranking']);
    void svc;
  });

  it('STAT-MOD-02(数据层) 直接写空数组 → 拒绝保存返回 false，持久化不变', async () => {
    const svc = mockSettingsService(baseSettings({ statisticsModules: ['daily-expense-trend'] }));
    const settings = useSettingsStore();
    await settings.load();
    const ok = await settings.setStatisticsModules([]);
    expect(ok).toBe(false);
    expect(settings.statisticsModules).toEqual(['daily-expense-trend']);
    // update 未曾被调用（拒绝对应无持久化副作用；load 时无修复也不写）
    expect(svc.updateSpy).not.toHaveBeenCalled();
  });

  it('STAT-MOD-03 重启（load(true)）后最后一个模块仍存在', async () => {
    const svc = mockSettingsService(baseSettings({ statisticsModules: ALL_IDS }));
    const settings = useSettingsStore();
    await settings.load();
    await settings.setStatisticsModules(['cumulative-expense']);
    await settings.load(true); // 模拟重启重取
    expect(settings.statisticsModules).toEqual(['cumulative-expense']);
    void svc;
  });
});

describe('settingsStore.load 旧数据自动修复', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    setActivePinia(createPinia());
  });

  it('STAT-MOD-04 Settings 已存 [] → 启动自动恢复默认并持久化', async () => {
    const svc = mockSettingsService(baseSettings({ statisticsModules: [] }));
    const settings = useSettingsStore();
    await settings.load();
    expect(settings.statisticsModules).toEqual([DEFAULT_STAT_MODULE_ID]);
    expect(svc.updateSpy).toHaveBeenCalled();
    // 已修复后再次 load 幂等，不再持久化
    const calls = svc.updateSpy.mock.calls.length;
    await settings.load(true);
    expect(svc.updateSpy.mock.calls.length).toBe(calls);
  });

  it('STAT-MOD-05 Settings 全非法 ID → 启动恢复默认模块', async () => {
    const svc = mockSettingsService(baseSettings({ statisticsModules: ['unknown-id'] as never }));
    const settings = useSettingsStore();
    await settings.load();
    expect(settings.statisticsModules).toEqual([DEFAULT_STAT_MODULE_ID]);
    void svc;
  });

  it('STAT-MOD-06 Settings 含重复 ID → 自动去重', async () => {
    const svc = mockSettingsService(
      baseSettings({ statisticsModules: ['category-ranking', 'daily-expense-trend', 'category-ranking'] }),
    );
    const settings = useSettingsStore();
    await settings.load();
    expect(settings.statisticsModules).toEqual(['category-ranking', 'daily-expense-trend']);
    void svc;
  });

  it('已有合法模块：原样保留，不整体回退四个（不持久化）', async () => {
    const svc = mockSettingsService(baseSettings({ statisticsModules: ['category-ranking'] }));
    const settings = useSettingsStore();
    await settings.load();
    expect(settings.statisticsModules).toEqual(['category-ranking']);
    expect(svc.updateSpy).not.toHaveBeenCalled();
  });
});

describe('StatisticsModuleHost 交互（最后一个开关）', () => {
  let pinia: ReturnType<typeof createPinia>;
  beforeEach(() => {
    vi.restoreAllMocks();
    pinia = createPinia();
    setActivePinia(pinia);
    toasts.value = [];
  });

  it('STAT-MOD-02 只剩一个开启项：点击关闭 → 状态仍 ON + Toast 出现', async () => {
    mockSettingsService(baseSettings({ statisticsModules: ['daily-expense-trend'] }));
    initMock.mockImplementation(() => chartInstance());
    const settings = useSettingsStore();
    await settings.load();
    const infoSpy = vi.spyOn(toast, 'info');
    const wrapper = mount(StatisticsModuleHost, {
      props: { bills: [], activeYm: '2026-09', today: '2026-09-11', monthLabel: '2026年9月' },
      global: { plugins: [pinia] },
    });
    await flushPromises();
    // 打开管理 Sheet（DVSheet Teleport 到 body）
    await wrapper.find('.stats-modules__add').trigger('click');
    await flushPromises();
    const manage = document.body.querySelectorAll('.stats-modules__option');
    const option = Array.from(manage).find((el) => el.textContent?.includes('每日花费趋势'))!;
    const onTrack = option.querySelector('.stats-modules__switch-track')!;
    expect(onTrack.classList.contains('is-on')).toBe(true);
    (option.querySelector('.stats-modules__switch') as HTMLElement).click();
    await flushPromises();
    expect(infoSpy).toHaveBeenCalledWith('至少保留一个统计模块');
    expect(settings.statisticsModules).toEqual(['daily-expense-trend']); // 状态保持 ON
    wrapper.unmount();
  });
});