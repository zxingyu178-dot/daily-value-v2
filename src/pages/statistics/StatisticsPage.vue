<script setup lang="ts">
/**
 * 统计（Phase 4）：月度消费概览 / 分类占比环形图 / 消费趋势柱状图 / 最大单笔支出。
 * - 数据只能从 Bill 派生（billStore），禁止维护第二套统计数据库。
 * - 颜色产品规则：支出=绿色，收入=红色。
 * - 图表使用 ECharts（SVG renderer，适配 WebView 与测试环境）。
 * - 保持简单：不做财务管理平台；架构预留后续统计模块扩展。
 */
// 显式组件名：App.vue KeepAlive include 按名字精确缓存一级页面，保证切页不丢滚动位置
defineOptions({ name: 'StatisticsPage' });
import { computed, nextTick, onActivated, onBeforeUnmount, onDeactivated, onMounted, ref, watch } from 'vue';
// 按需引入 ECharts（树摇：仅 Pie/Bar/Line + 所需组件 + SVG 渲染），邻近减小并集中 ensureECharts()
import * as echarts from 'echarts/core';
import type { EChartsCoreOption } from 'echarts/core';
import { ensureECharts } from './echarts-setup';
import { DVCard, DVDateTimeWheelPicker } from '@/components/design';
import { GLASS_CHART, GLASS_CATEGORY_PALETTE } from '@/theme/tokens';
import type { DateTimeValue } from '@/components/design/DVDateTimeWheelPicker.vue';
import { useBillStore } from '@/core/store/bill';
import { useCategoryStore } from '@/core/store/category';
import { useAppStore } from '@/core/store/app';
import type { Category } from '@/core/models/types';
import { localDateKey } from '@/core/models/daily-value';
import { useLocalMidnightRefresh } from '@/core/hooks/useLocalMidnight';
import DVCategoryIcon from '@/components/category/DVCategoryIcon.vue';
import {
  computeOverview,
  computeCategoryShare,
  computeMonthlyTrend,
  computeMaxExpense,
  monthRange,
  summarizeBillsByDateRange,
  type CategoryShare,
  type TrendPoint,
} from './statistics';
import { yearRangeFromBills } from '@/core/statistics/year';
import YearReview from './YearReview.vue';
import StatisticsModuleHost from './StatisticsModuleHost.vue';

const billStore = useBillStore();
const appStore = useAppStore();
const categoryStore = useCategoryStore();

/** 统计分类 → 实时分类（图标统一渲染）：优先实时分类 SVG，缺失时回退快照 emoji */
function shareCategory(s: CategoryShare): Category | undefined {
  return categoryStore.byId(s.categoryId) ?? {
    id: s.categoryId,
    name: s.name,
    emoji: s.emoji,
    builtin: false,
    sort: 0,
  };
}

const today = ref<string>(localDateKey());
const currentYM = ref<string>(today.value.slice(0, 7));

const activeYM = ref(currentYM.value);

/* ---- 2.19.0 月 / 年切换（默认月度，老用户习惯不变） ---- */
const viewMode = ref<'month' | 'year'>('month');
const currentYear = new Date().getFullYear();
const activeYear = ref(currentYear);
const yearList = computed(() => yearRangeFromBills(billStore.bills, currentYear));
const yearIndex = computed(() => yearList.value.indexOf(activeYear.value));
const canPrevYear = computed(() => yearIndex.value > 0);
const canNextYear = computed(() => yearIndex.value < yearList.value.length - 1);
function shiftYear(delta: number) {
  const next = yearList.value[yearIndex.value + delta];
  if (next) activeYear.value = next;
}
function switchMode(mode: 'month' | 'year') {
  if (viewMode.value === mode) return;
  viewMode.value = mode;
  void playPanelAnim();
}
/* 月度 / 年度面板切换轻动画（fade + 8~10px 上移，不破坏图表 DOM：v-show 保持挂载） */
const monthPanelRef = ref<HTMLElement | null>(null);
const yearPanelRef = ref<HTMLElement | null>(null);
async function playPanelAnim() {
  await nextTick();
  const el = viewMode.value === 'month' ? monthPanelRef.value : yearPanelRef.value;
  if (!el) return;
  el.classList.remove('stats__panel-in');
  void el.offsetHeight; // 强制 reflow，保证动画每次切换重触发
  el.classList.add('stats__panel-in');
}

const ringRef = ref<HTMLElement | null>(null);
const barRef = ref<HTMLElement | null>(null);
let ringChart: ReturnType<typeof echarts.init> | null = null;
let barChart: ReturnType<typeof echarts.init> | null = null;

onMounted(async () => {
  await billStore.load();
  await nextTick();
  ensureECharts();
  readChartColors();
  initCharts();
});
// 2.9.6 稳定性修复（P0-2 收口）：App.vue 对一级页面使用 KeepAlive，
// 离开统计时组件并不 unmount，再次进入只触发 onActivated。
// 因此除 onMounted 外，必须在这里补一次渲染 + resize，否则「去记账新增/编辑账单
// → 返回统计」时 ECharts 仍是旧 option，甚至因缓存容器未触发重算而空白。
onActivated(async () => {
  await nextTick();
  readChartColors();
  renderCharts();
  resizeCharts();
});
onBeforeUnmount(() => {
  ringChart?.dispose();
  barChart?.dispose();
  ringChart = null;
  barChart = null;
});

/* ---- 月份范围：最老账单月 ~ 当前月（边界箭头禁用） ---- */
const monthList = computed(() => {
  const set = new Set<string>([currentYM.value]);
  for (const b of billStore.normalBills) set.add(b.date.slice(0, 7));
  const keys = [...set].sort();
  return monthRange(keys[0], currentYM.value);
});
const monthIndex = computed(() => monthList.value.indexOf(activeYM.value));
const canPrev = computed(() => monthIndex.value > 0);
const canNext = computed(() => monthIndex.value < monthList.value.length - 1);
function shiftMonth(delta: number) {
  const next = monthList.value[monthIndex.value + delta];
  if (next) activeYM.value = next;
}

/* ---- 统计计算（纯函数，Bill 派生） ---- */
const overview = computed(() => computeOverview(billStore.bills, activeYM.value));
const shares = computed(() => computeCategoryShare(billStore.bills, activeYM.value));
const trend = computed(() => computeMonthlyTrend(billStore.bills, 6));
const maxExpense = computed(() => computeMaxExpense(billStore.bills, activeYM.value));
const hasRingData = computed(() => shares.value.length > 0);
const hasTrendData = computed(() => trend.value.some((t) => t.expense > 0 || t.income > 0));

const monthLabel = computed(() => {
  const [y, m] = activeYM.value.split('-').map(Number);
  return `${y}年${m}月`;
});

function fmt(n: number): string {
  return n.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/* ---- 图表（ECharts SVG） ---- */
const isDark = computed(() => appStore.resolvedTheme === 'dark');
// —— 图表配色统一从 Theme Token（CSS 变量）读取，避免主题切换后图表与页面颜色脱节（P2-3 收敛）——
const CHART_TEXT_FALLBACK = { dark: '#9aa4bd', light: '#5c6478' };
const CHART_SPLIT_FALLBACK = { dark: '#2b3550', light: '#e5e9f2' };
const CHART_SURFACE_FALLBACK = { dark: '#1a2236', light: '#ffffff' };
/** 常规 10 色分类 palette（玻璃模式下由 GLASS_CATEGORY_PALETTE 四色替换） */
const CATEGORY_PALETTE = [
  '#5b67f0',
  '#22b57f',
  '#f0a32f',
  '#3b82f6',
  '#9b59b6',
  '#16a085',
  '#e67e22',
  '#2f9e8f',
  '#c0392b',
  '#3498db',
];
const chartText = ref(CHART_TEXT_FALLBACK.light);
const chartSplit = ref(CHART_SPLIT_FALLBACK.light);
const chartSurface = ref(CHART_SURFACE_FALLBACK.light);
// 壁纸模式：卡片表面是半透明浅色层，环图描边会出现明显白边 → 关闭描边（P1）
const wallpaperOn = ref(false);
// 支出=绿色 / 收入=红色（产品固定规则）
const EXPENSE_COLOR = ref('#22b57f');
const INCOME_COLOR = ref('#e04b4b');
/** 分类 palette：玻璃四色 / 常规 10 色（readChartColors 中按玻璃切换） */
const categoryPalette = ref(CATEGORY_PALETTE);
/** Tooltip 主题（2.13.0：随 Theme Token，不再硬编码大白框） */
const chartTooltipBg = ref(CHART_SURFACE_FALLBACK.light);
const chartTooltipBorder = ref(CHART_SPLIT_FALLBACK.light);
const chartTooltipText = ref('#1c2030');
function readChartColors() {
  const cs = getComputedStyle(document.documentElement);
  const pick = (varName: string, fallback: { dark: string; light: string }) => {
    const v = cs.getPropertyValue(varName).trim();
    if (v) return v;
    return isDark.value ? fallback.dark : fallback.light;
  };
  chartText.value = pick('--dv-on-surface-variant', CHART_TEXT_FALLBACK);
  chartSplit.value = pick('--dv-outline', CHART_SPLIT_FALLBACK);
  chartSurface.value = pick('--dv-surface', CHART_SURFACE_FALLBACK);
  wallpaperOn.value = document.documentElement.dataset.wallpaper === 'on';
  // 2.13.0：仅深色 + data-theme-style='glass' 启用玻璃图表配色
  const style = document.documentElement.dataset.themeStyle ?? 'classic';
  const glassOn = isDark.value && style === 'glass';
  chartTooltipBg.value = pick('--dv-surface', CHART_SURFACE_FALLBACK);
  chartTooltipBorder.value = chartSplit.value;
  chartTooltipText.value = pick('--dv-on-surface', { dark: '#eef1f8', light: '#1c2030' });
  if (glassOn) {
    chartText.value = 'rgba(255, 255, 255, 0.72)';
    chartSplit.value = 'rgba(255, 255, 255, 0.12)';
    EXPENSE_COLOR.value = GLASS_CHART.expense;
    INCOME_COLOR.value = GLASS_CHART.income;
    categoryPalette.value = GLASS_CATEGORY_PALETTE;
    chartTooltipBg.value = 'rgba(13, 13, 16, 0.92)';
    chartTooltipBorder.value = 'rgba(255, 255, 255, 0.12)';
    chartTooltipText.value = 'rgba(255, 255, 255, 0.9)';
  } else {
    const expense = cs.getPropertyValue('--dv-expense').trim();
    const income = cs.getPropertyValue('--dv-income').trim();
    if (expense) EXPENSE_COLOR.value = expense;
    if (income) INCOME_COLOR.value = income;
    categoryPalette.value = CATEGORY_PALETTE;
    if (style === 'glass') chartTooltipBg.value = 'rgba(255, 255, 255, 0.9)';
  }
}

// 2.9.6 稳定性修复（P0-2）：ring/bar 独立初始化，任一图表容器缺失不影响另一图表。
// 旧实现 `if (!ringRef || !barRef) return` 会让「一个图因空数据未挂载」导致两个图都初始化失败；
// 且切到空月份时若 v-if 销毁过容器，需要能在新 DOM 上重新 init，而不是 setOption 到旧实例。
function initCharts() {
  try {
    if (ringRef.value && !ringChart) {
      ringChart = echarts.init(ringRef.value, undefined, { renderer: 'svg' });
    }
    if (barRef.value && !barChart) {
      barChart = echarts.init(barRef.value, undefined, { renderer: 'svg' });
    }
    renderCharts();
  } catch {
    // 容器无尺寸（如测试环境）或渲染失败时静默降级，不影响页面数据展示
    ringChart = null;
    barChart = null;
  }
}

function buildRingOption(shares: CategoryShare[], total: number): EChartsCoreOption {
  return {
    backgroundColor: 'transparent',
    tooltip: {
      trigger: 'item',
      formatter: '{b}<br/>¥{c}（{d}%）',
      backgroundColor: chartTooltipBg.value,
      borderColor: chartTooltipBorder.value,
      borderWidth: 1,
      textStyle: { color: chartTooltipText.value, fontSize: 12 },
      extraCssText:
        'border-radius: 10px; box-shadow: 0 4px 16px rgba(0,0,0,0.12); padding: 6px 10px;',
    },
    title: {
      text: `¥ ${fmt(total)}`,
      subtext: '总支出',
      left: 'center',
      top: '38%',
      textStyle: { fontSize: 15, fontWeight: 700, color: chartText.value },
      subtextStyle: { fontSize: 11, color: chartText.value },
    },
    series: [
      {
        type: 'pie',
        radius: ['58%', '80%'],
        center: ['50%', '50%'],
        avoidLabelOverlap: true,
        itemStyle: {
          borderRadius: 6,
          // 壁纸模式下卡片表面为半透明浅色层，描边会呈现明显白边 → 去描边，分段感靠色块本身区分；
          // 无壁纸模式保持原描边效果（与卡片表面同色，分割干净）。
          borderColor: wallpaperOn.value ? 'transparent' : chartSurface.value,
          borderWidth: wallpaperOn.value ? 0 : 2,
        },
        label: { show: false },
        emphasis: { scaleSize: 6 },
        data: shares.map((s, i) => ({
          name: s.name,
          value: Math.round(s.amount * 100) / 100,
          itemStyle: { color: CATEGORY_PALETTE[i % CATEGORY_PALETTE.length] },
        })),
      },
    ],
  };
}

function buildBarOption(trend: TrendPoint[]): EChartsCoreOption {
  return {
    backgroundColor: 'transparent',
    tooltip: {
      trigger: 'axis',
      backgroundColor: chartTooltipBg.value,
      borderColor: chartTooltipBorder.value,
      borderWidth: 1,
      textStyle: { color: chartTooltipText.value, fontSize: 12 },
      extraCssText:
        'border-radius: 10px; box-shadow: 0 4px 16px rgba(0,0,0,0.12); padding: 6px 10px;',
    },
    legend: {
      data: ['支出', '收入'],
      top: 0,
      right: 0,
      textStyle: { color: chartText.value, fontSize: 11 },
      itemWidth: 12,
      itemHeight: 8,
    },
    grid: { left: 8, right: 8, top: 30, bottom: 6, containLabel: true },
    xAxis: {
      type: 'category',
      data: trend.map((t) => t.label),
      axisLine: { lineStyle: { color: chartSplit.value } },
      axisTick: { show: false },
      axisLabel: { color: chartText.value, fontSize: 11 },
    },
    yAxis: {
      type: 'value',
      splitLine: { lineStyle: { color: chartSplit.value } },
      axisLabel: { color: chartText.value, fontSize: 10 },
    },
    series: [
      {
        name: '支出',
        type: 'bar',
        barMaxWidth: 16,
        itemStyle: { color: EXPENSE_COLOR.value, borderRadius: [5, 5, 0, 0] },
        data: trend.map((t) => Math.round(t.expense * 100) / 100),
      },
      {
        name: '收入',
        type: 'bar',
        barMaxWidth: 16,
        itemStyle: { color: INCOME_COLOR.value, borderRadius: [5, 5, 0, 0] },
        data: trend.map((t) => Math.round(t.income * 100) / 100),
      },
    ],
  };
}

function renderCharts() {
  if (ringChart) {
    ringChart.setOption(buildRingOption(shares.value, overview.value.expense), true);
  }
  if (barChart) {
    barChart.setOption(buildBarOption(trend.value), true);
  }
}

function resizeCharts() {
  ringChart?.resize();
  barChart?.resize();
}

// 2.9.6 稳定性修复（P0-2）：统一监听数据 / 月份 / 主题变化。
// 旧实现只 watch(activeYM)，「新增/编辑/删除账单后返回统计」「主题切换」均不触发重绘。
// 换月份、数据变化、主题变化都走同一刷新路径：nextTick 后重读图表配色 → 重绘 → resize。
watch(
  [activeYM, shares, trend, () => appStore.themeRevision],
  async () => {
    await nextTick();
    readChartColors();
    renderCharts();
    resizeCharts();
  },
  { flush: 'post' },
);

/** 跨午夜/跨日：刷新 today 与当前月；若仍停留在“今天月份”则自动跟到新月份（如 8-31 → 9-1）。 */
function refreshCurrentDate() {
  today.value = localDateKey();
  const newYM = today.value.slice(0, 7);
  const wasOnTodayMonth = activeYM.value === currentYM.value;
  currentYM.value = newYM;
  if (wasOnTodayMonth) activeYM.value = newYM;
  renderCharts();
}
useLocalMidnightRefresh(refreshCurrentDate);

function maxExpenseText(b: NonNullable<typeof maxExpense.value>): string {
  return `${b.categoryEmoji} ${b.title || b.categoryName} · ¥ ${fmt(b.amount)} · ${b.date.slice(5)}`;
}

/* =====================================================================
 * 2.10.0 自定义日期区间统计
 * 独立区块，只负责指定开始~结束日期的支出/收入/结余汇总；
 * 不复用去驱动环形图/ECharts，不改变现有月度统计。
 * 默认 start = 本月1日，end = 今天；月份切换不影响区间（RANGE-10）。
 * 复用 DVDateTimeWheelPicker（showTime=false, allowFuture=false），一个 Picker 服务两次。
 * ===================================================================== */
type RangeTarget = 'start' | 'end' | null;

/** 区间默认值：本月 1 日 ~ 今天（仅初始化，不随月份切换/跨午夜改动） */
function defaultRange(): { start: string; end: string } {
  const today = localDateKey();
  return { start: `${today.slice(0, 7)}-01`, end: today };
}
const initialRange = defaultRange();
const rangeStart = ref(initialRange.start);
const rangeEnd = ref(initialRange.end);
/** 当前正在编辑的区间端点（打开 Picker 时非空；一个 Picker 复用于开始/结束） */
const rangePickerTarget = ref<RangeTarget>(null);
const rangeWheelValue = ref<DateTimeValue>({ year: 0, month: 1, day: 1, hour: 0, minute: 0 });
/** 无效范围：start > end → 轻量错误状态，不更新统计结果、保留用户选择 */
const rangeInvalid = computed(() => rangeStart.value > rangeEnd.value);
/** 最近一次有效区间的汇总（无效范围时保留，不显示错误数据/NaN） */
const rangeValidSummary = ref(summarizeBillsByDateRange(billStore.bills, rangeStart.value, rangeEnd.value));
const rangeSummary = computed(() => {
  if (rangeInvalid.value) return rangeValidSummary.value; // 范围无效：不更新统计结果
  const next = summarizeBillsByDateRange(billStore.bills, rangeStart.value, rangeEnd.value);
  rangeValidSummary.value = next;
  return next;
});

function pad2Range(n: number): string {
  return String(n).padStart(2, '0');
}

/* =====================================================================
 * 2.12.0 我的统计模块（大图模块，替代 2.11.0 两列小卡片）
 * - 独立区域，位于「自定义日期统计」之后；全部模块跟随顶部 activeYM。
 * - 模块数据由 statistics-modules 纯函数计算（Bill 派生）；图表生命周期在各模块组件内自管，
 *   本页只负责把 bills / activeYM / today / monthLabel 传给 StatisticsModuleHost。
 * - 默认全部开启；「＋ 添加 / 管理」打开 DVSheet 开关式增删（在 Host 内，不改本页）。
 * ===================================================================== */

function openRangePicker(target: 'start' | 'end') {
  const [y, mo, d] = (target === 'start' ? rangeStart.value : rangeEnd.value).split('-').map(Number);
  rangeWheelValue.value = { year: y, month: mo, day: d, hour: 0, minute: 0 };
  rangePickerTarget.value = target;
}
function closeRangePicker() {
  rangePickerTarget.value = null;
}
/** Picker「确定」写回目标端点（范围无效时由 rangeInvalid 展示错误，不静默交换） */
function onRangeWheelChange(v: DateTimeValue) {
  const date = `${v.year}-${pad2Range(v.month)}-${pad2Range(v.day)}`;
  if (rangePickerTarget.value === 'start') rangeStart.value = date;
  else if (rangePickerTarget.value === 'end') rangeEnd.value = date;
}
// 2.10.7：切走统计页时关闭自定义日期区间 Picker（KeepAlive 缓存下避免子弹层跨页残留）。
// 2.12.0：模块管理 Sheet 由 StatisticsModuleHost 在自身 onDeactivated 关闭，本页不再处理。
onDeactivated(() => {
  rangePickerTarget.value = null;
});
</script>

<template>
  <section class="stats">
    <!-- 2.19.0：月度 | 年度 切换（默认月度，老用户习惯不变） -->
    <div class="stats__mode" role="tablist" aria-label="统计周期">
      <button
        class="stats__mode-btn"
        :class="{ 'is-active': viewMode === 'month' }"
        type="button"
        role="tab"
        :aria-selected="viewMode === 'month'"
        @click="switchMode('month')"
      >
        月度
      </button>
      <button
        class="stats__mode-btn"
        :class="{ 'is-active': viewMode === 'year' }"
        type="button"
        role="tab"
        :aria-selected="viewMode === 'year'"
        @click="switchMode('year')"
      >
        年度
      </button>
    </div>

    <!-- 月份 / 年份切换头（按模式） -->
    <div v-if="viewMode === 'month'" class="stats__head">
      <button
        class="stats__arrow"
        type="button"
        aria-label="上一月"
        :disabled="!canPrev"
        @click="shiftMonth(-1)"
      >
        ‹
      </button>
      <span class="stats__month">{{ monthLabel }}</span>
      <button
        class="stats__arrow"
        type="button"
        aria-label="下一月"
        :disabled="!canNext"
        @click="shiftMonth(1)"
      >
        ›
      </button>
    </div>
    <div v-else class="stats__head">
      <button
        class="stats__arrow"
        type="button"
        aria-label="上一年"
        :disabled="!canPrevYear"
        @click="shiftYear(-1)"
      >
        ‹
      </button>
      <span class="stats__month">{{ activeYear }}年</span>
      <button
        class="stats__arrow"
        type="button"
        aria-label="下一年"
        :disabled="!canNextYear"
        @click="shiftYear(1)"
      >
        ›
      </button>
    </div>

    <!-- 月度面板（v-show 保持图表 DOM 存活，切换不销毁 ECharts 实例） -->
    <div v-show="viewMode === 'month'" ref="monthPanelRef" class="stats__panel">
    <!-- 月度消费概览：支出 / 收入 / 结余 -->
    <DVCard class="stats__overview" outlined glass>
      <div class="stats__ov-row">
        <div class="stats__ov-cell">
          <span class="stats__ov-label">支出</span>
          <span class="stats__ov-value is-expense">¥ {{ fmt(overview.expense) }}</span>
        </div>
        <div class="stats__ov-cell">
          <span class="stats__ov-label">收入</span>
          <span class="stats__ov-value is-income">¥ {{ fmt(overview.income) }}</span>
        </div>
        <div class="stats__ov-cell">
          <span class="stats__ov-label">结余</span>
          <span
            class="stats__ov-value"
            :class="overview.net < 0 ? 'is-negative' : 'is-neutral'"
          >
            ¥ {{ fmt(overview.net) }}
          </span>
        </div>
      </div>
    </DVCard>

    <!-- 自定义日期统计（2.10.0）：仅区间收支汇总，不驱动图表；日期两格防溢出 -->
    <DVCard class="stats__range" outlined>
      <h2 class="stats__title">自定义日期统计</h2>
      <div class="stats__range-dates">
        <button
          class="stats__range-date"
          :class="{ 'is-error': rangeInvalid }"
          type="button"
          aria-label="选择开始日期"
          @click="openRangePicker('start')"
        >
          <span class="stats__range-date-label">开始日期</span>
          <span class="stats__range-date-value">{{ rangeStart }}</span>
        </button>
        <button
          class="stats__range-date"
          :class="{ 'is-error': rangeInvalid }"
          type="button"
          aria-label="选择结束日期"
          @click="openRangePicker('end')"
        >
          <span class="stats__range-date-label">结束日期</span>
          <span class="stats__range-date-value">{{ rangeEnd }}</span>
        </button>
      </div>
      <p v-if="rangeInvalid" class="stats__range-error">开始日期不能晚于结束日期</p>
      <div class="stats__range-summary">
        <div class="stats__range-cell">
          <span class="stats__range-label">支出</span>
          <span class="stats__range-value is-expense">¥ {{ fmt(rangeSummary.expense) }}</span>
        </div>
        <div class="stats__range-cell">
          <span class="stats__range-label">收入</span>
          <span class="stats__range-value is-income">¥ {{ fmt(rangeSummary.income) }}</span>
        </div>
        <div class="stats__range-cell">
          <span class="stats__range-label">结余</span>
          <span
            class="stats__range-value"
            :class="rangeSummary.balance < 0 ? 'is-negative' : 'is-neutral'"
          >
            ¥ {{ fmt(rangeSummary.balance) }}
          </span>
        </div>
      </div>
    </DVCard>

    <!-- 我的统计模块（2.12.0 大图模块，替代 2.11.0 小卡片）：跟随顶部月份；默认全部开启 -->
    <StatisticsModuleHost
      :bills="billStore.bills"
      :active-ym="activeYM"
      :today="today"
      :month-label="monthLabel"
    />

    <!-- 最大单笔支出（轻量卡片） -->
    <DVCard v-if="maxExpense" class="stats__max" outlined>
      <span class="stats__max-label">最大单笔支出</span>
      <span class="stats__max-value">{{ maxExpenseText(maxExpense) }}</span>
    </DVCard>

    <!-- 分类占比环形图 -->
    <DVCard class="stats__block stats__block--ring" outlined>
      <h2 class="stats__title">分类占比</h2>
      <!-- 2.9.6 稳定性修复（P0-2）：图表容器改为持久 DOM，不再用 v-if 销毁。
           根因：旧实现 `v-if="hasRingData"` 在切到空月份时销毁 ringRef DOM，
           ECharts 实例仍挂在已销毁的 DOM 上；切回有数据月份时只 setOption 到旧实例，
           新 DOM 没有 instance → 环形图消失。
           现在 ringRef 从挂载到卸载始终存在：无数据时仅 visibility:hidden（保留真实尺寸，
           ECharts 初始化需要尺寸），空状态文案覆盖在 stage 中央；有数据直接 setOption。 -->
      <div class="stats__chart-stage stats__chart-stage--ring">
        <div
          ref="ringRef"
          class="stats__chart stats__chart--ring"
          :class="{ 'is-hidden': !hasRingData }"
        />
        <p v-if="!hasRingData" class="stats__empty stats__empty--overlay">本月暂无支出</p>
      </div>
      <ul v-if="hasRingData" class="stats__legend">
        <li v-for="(s, i) in shares" :key="s.categoryId" class="stats__legend-item">
          <span
            class="stats__legend-dot"
            :style="{ background: categoryPalette[i % categoryPalette.length] }"
          />
          <span class="stats__legend-name">
            <DVCategoryIcon :category="shareCategory(s)" :size="16" />
            <span class="stats__legend-text">{{ s.name }}</span>
          </span>
          <span class="stats__legend-amt">¥ {{ fmt(s.amount) }}</span>
          <span class="stats__legend-pct">{{ s.percent }}%</span>
        </li>
      </ul>
    </DVCard>

    <!-- 消费趋势柱状图（最近 6 个月） -->
    <DVCard class="stats__block stats__block--trend" outlined>
      <h2 class="stats__title">消费趋势</h2>
      <!-- 同 P0-2 修复：barRef 同样持久化，无数据时仅隐藏，避免 v-if 销毁容器导致实例失联 -->
      <div class="stats__chart-stage stats__chart-stage--bar">
        <div
          ref="barRef"
          class="stats__chart stats__chart--bar"
          :class="{ 'is-hidden': !hasTrendData }"
        />
        <p v-if="!hasTrendData" class="stats__empty stats__empty--overlay">暂无消费数据</p>
      </div>
    </DVCard>

    <!-- 自定义日期区间选择器（2.10.0）：复用 DVDateTimeWheelPicker，showTime=false，
         一个 Picker 复用于开始/结束（rangePickerTarget 区分） -->
    <DVDateTimeWheelPicker
      :model-value="rangeWheelValue"
      :visible="rangePickerTarget !== null"
      :show-time="false"
      :allow-future="false"
      @update:model-value="onRangeWheelChange"
      @close="closeRangePicker"
    />
    </div>

    <!-- 年度面板（2.19.0 Year Review：Hero / 月均极值 / 12月趋势 / 分类排名 / 消费足迹） -->
    <div v-show="viewMode === 'year'" ref="yearPanelRef" class="stats__panel">
      <YearReview :bills="billStore.bills" :active-year="activeYear" />
    </div>
  </section>
</template>

<style scoped>
.stats {
  display: flex;
  flex-direction: column;
  gap: var(--dv-space-sm);
  padding: var(--dv-space-md);
  padding-bottom: calc(var(--dv-space-xl) + var(--dv-safe-bottom));
}
/* 2.19.0：月度 | 年度 切换（segmented） */
.stats__mode {
  display: flex;
  justify-content: center;
  gap: var(--dv-space-xxs);
  padding: 3px;
  border-radius: var(--dv-radius-pill);
  background: var(--dv-surface-alt);
  border: 1px solid var(--dv-outline);
}
.stats__mode-btn {
  flex: 1;
  max-width: 120px;
  padding: 6px 18px;
  border-radius: var(--dv-radius-pill);
  font-size: 13px;
  font-weight: 600;
  color: var(--dv-on-surface-variant);
  transition: background-color var(--dv-motion-fast) var(--dv-ease-standard), color var(--dv-motion-fast) var(--dv-ease-standard);
}
.stats__mode-btn.is-active {
  background: var(--dv-primary);
  color: var(--dv-on-primary, #ffffff);
}
/* 月 / 年面板切换动画（fade + 上移，v-show 不销毁图表 DOM） */
.stats__panel {
  display: flex;
  flex-direction: column;
  gap: var(--dv-space-sm);
}
.stats__panel-in {
  animation: dv-panel-in 200ms var(--dv-ease-standard);
}
@keyframes dv-panel-in {
  from {
    opacity: 0;
    transform: translateY(10px);
  }
  to {
    opacity: 1;
    transform: none;
  }
}
/* 月份切换头 */
.stats__head {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--dv-space-md);
}
.stats__arrow {
  width: 32px;
  height: 32px;
  border-radius: var(--dv-radius-pill);
  background: var(--dv-surface);
  border: 1px solid var(--dv-outline);
  color: var(--dv-on-surface-variant);
  font-size: 18px;
  line-height: 1;
  transition: opacity var(--dv-motion-fast) var(--dv-ease-standard);
}
.stats__arrow:disabled {
  opacity: 0.35;
}
.stats__month {
  min-width: 128px;
  text-align: center;
  font-size: 16px;
  font-weight: 600;
  color: var(--dv-on-surface);
}
/* 概览卡 */
.stats__overview {
  padding: var(--dv-space-md);
}
.stats__ov-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--dv-space-sm);
}
.stats__ov-cell {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--dv-space-xxs);
}
.stats__ov-label {
  font-size: 12px;
  color: var(--dv-on-surface-variant);
}
.stats__ov-value {
  font-size: 18px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}
/* 产品固定规则：支出=绿色，收入=红色 */
.stats__ov-value.is-expense {
  color: var(--dv-expense);
}
.stats__ov-value.is-income {
  color: var(--dv-income);
}
/* 结余：默认中性 / 主色；负结余用警示色（不直接复用 income/expense 语义） */
.stats__ov-value.is-neutral {
  color: var(--dv-on-surface);
}
.stats__ov-value.is-negative {
  color: var(--dv-warning);
}
/* 自定义日期统计（2.10.0）：紧凑卡片，两日期格 + 三项金额；日期永远完整不溢出 */
.stats__range {
  padding: var(--dv-space-md);
}
.stats__range-dates {
  display: flex;
  gap: var(--dv-space-xs);
  margin-bottom: var(--dv-space-xs);
}
.stats__range-date {
  flex: 1;
  min-width: 0; /* 允许格子收缩，禁止把日期数字挤出 */
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--dv-space-xxs);
  padding: var(--dv-space-xs) var(--dv-space-xxs);
  border-radius: var(--dv-radius-md);
  background: var(--dv-surface-alt);
  transition: background-color var(--dv-motion-fast) var(--dv-ease-standard);
}
.stats__range-date:active {
  background: var(--dv-outline);
}
.stats__range-date.is-error {
  background: color-mix(in srgb, var(--dv-danger) 12%, var(--dv-surface-alt));
}
.stats__range-date-label {
  font-size: 12px;
  color: var(--dv-on-surface-variant);
}
.stats__range-date.is-error .stats__range-date-label {
  color: var(--dv-danger);
}
.stats__range-date-value {
  font-size: 14px;
  font-weight: 600;
  color: var(--dv-on-surface);
  white-space: nowrap; /* 日期数字永远完整展示，不做 ellipsis 裁掉数字 */
  font-variant-numeric: tabular-nums;
}
.stats__range-date.is-error .stats__range-date-value {
  color: var(--dv-danger);
}
.stats__range-error {
  margin-bottom: var(--dv-space-xs);
  font-size: 12px;
  color: var(--dv-danger);
}
.stats__range-summary {
  display: flex;
  align-items: center;
  padding-top: var(--dv-space-xs);
  border-top: 1px solid var(--dv-surface-border);
}
.stats__range-cell {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--dv-space-xxs);
}
.stats__range-label {
  font-size: 12px;
  color: var(--dv-on-surface-variant);
}
.stats__range-value {
  font-size: 15px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
/* 产品固定规则：支出=绿色，收入=红色 */
.stats__range-value.is-expense {
  color: var(--dv-expense);
}
.stats__range-value.is-income {
  color: var(--dv-income);
}
.stats__range-value.is-neutral {
  color: var(--dv-on-surface);
}
.stats__range-value.is-negative {
  color: var(--dv-warning);
}
/* 特别窄屏：两个日期格自动变成上下两行（日期数字仍完整，不挤横排） */
@media (max-width: 340px) {
  .stats__range-dates {
    flex-direction: column;
  }
}
/* 最大单笔支出 */
.stats__max {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--dv-space-sm);
  padding: var(--dv-space-sm) var(--dv-space-md);
}
.stats__max-label {
  flex-shrink: 0;
  font-size: 13px;
  color: var(--dv-on-surface-variant);
}
.stats__max-value {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  text-align: right;
  font-size: 14px;
  font-weight: 600;
  color: var(--dv-expense);
}
/* 图表块 */
.stats__block {
  padding: var(--dv-space-md);
}
.stats__title {
  font-size: 15px;
  font-weight: 600;
  color: var(--dv-on-surface);
  margin-bottom: var(--dv-space-sm);
}
.stats__chart--ring {
  height: 220px;
  width: 100%;
}
.stats__chart--bar {
  height: 220px;
  width: 100%;
}
/* 2.9.6 稳定性修复（P0-2）：图表 stage 提供相对定位，供 overlay 空状态居中覆盖。
   stage 自身固定 ~220px 高度，避免空数据时容器塌陷、ECharts 丢失真实尺寸。 */
.stats__chart-stage {
  position: relative;
}
.stats__chart-stage--ring {
  height: 220px;
}
.stats__chart-stage--bar {
  height: 220px;
}
.stats__chart--ring,
.stats__chart--bar {
  height: 100%;
}
/* 空数据：仅隐藏 ECharts 画布，不销毁 DOM（销毁会导致实例失联 → 环形图消失回归）。
   visibility:hidden 保留布局尺寸，ECharts 初始化依赖真实宽高。 */
.stats__chart.is-hidden {
  visibility: hidden;
}
.stats__empty--overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
}
.stats__empty {
  padding: var(--dv-space-lg) 0;
  text-align: center;
  color: var(--dv-on-surface-variant);
  font-size: 13px;
}
/* 分类图例 */
.stats__legend {
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: var(--dv-space-xs);
  margin-top: var(--dv-space-sm);
}
.stats__legend-item {
  display: flex;
  align-items: center;
  gap: var(--dv-space-xs);
  font-size: 13px;
}
.stats__legend-dot {
  flex-shrink: 0;
  width: 10px;
  height: 10px;
  border-radius: var(--dv-radius-pill);
}
.stats__legend-name {
  flex: 1;
  min-width: 0;
  display: inline-flex;
  align-items: center;
  gap: var(--dv-space-xxs);
  color: var(--dv-on-surface);
  overflow: hidden;
}
.stats__legend-text {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.stats__legend-amt {
  color: var(--dv-on-surface);
  font-variant-numeric: tabular-nums;
}
.stats__legend-pct {
  min-width: 44px;
  text-align: right;
  color: var(--dv-on-surface-variant);
  font-variant-numeric: tabular-nums;
}
/* Wallpaper Surface Mode（ON）：卡片由统一 Token 切成半透明面，浮在壁纸上而非深蓝墙。
   颜色/透明度由 base.css 的 --dv-surface-soft / --dv-surface-strong 决定，不在页面自写 rgba。
   不使用 backdrop blur（多块卡片全 blur 会拖慢 WebView 滚动）——靠半透明 + border + shadow 分层次。 */
:global([data-wallpaper='on'] .stats__overview),
:global([data-wallpaper='on'] .stats__block--ring),
:global([data-wallpaper='on'] .stats__range) {
  background: var(--dv-surface-strong);
  border-color: var(--dv-surface-border);
  box-shadow: var(--dv-surface-shadow);
}
:global([data-wallpaper='on'] .stats__max),
:global([data-wallpaper='on'] .stats__block--trend) {
  background: var(--dv-surface-soft);
  border-color: var(--dv-surface-border);
  box-shadow: var(--dv-surface-shadow);
}
:global([data-wallpaper='on'] .stats__arrow) {
  background: var(--dv-surface-soft);
  border-color: var(--dv-surface-border);
}
</style>
