<script setup lang="ts">
/**
 * DailyValue v2.19.0 - 年度总览（Year Review）
 * - 顶部由 StatisticsPage 提供「月度 | 年度」切换与年份切换，本组件只管年度内容。
 * - 所有数据由 year.ts 纯函数从 Bill 派生（不新增年度统计数据库）。
 * - 视觉节奏 Hero → 月均/极值 → 12 月趋势 → 分类排名 → 消费足迹（避免五张等权卡片）。
 * - 钻取：分类击 → /bill-search?year&category；趋势月份再点 → /bill-search?month；
 *   最大单笔支出 → QuickEntrySheet 编辑（统计从“只能看”到“看→找到→改”）。
 * - 空年份：显示「这一年还没有记录」，不渲染一堆 ¥0/0%/0笔。
 */
defineOptions({ name: 'YearReview' });
import { computed, onActivated, onBeforeUnmount, onDeactivated, onMounted, nextTick, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import * as echarts from 'echarts/core';
import type { EChartsCoreOption } from 'echarts/core';
import { ensureECharts } from '@/pages/statistics/echarts-setup';
import { DVCard } from '@/components/design';
import { useAppStore } from '@/core/store/app';
import { useCategoryStore } from '@/core/store/category';
import type { Bill } from '@/core/models/types';
import type { YearMonthlyTrend } from '@/core/statistics/year';
import {
  activeExpenseMonthCount,
  computeYearAverageMonthlyExpense,
  computeYearCategoryRanking,
  computeYearExtremeMonths,
  computeYearFacts,
  computeYearMonthlyTrend,
  computeYearOverview,
} from '@/core/statistics/year';
import { buildSearchQuery } from '@/core/search/bill-search';
import { snapshotChartTheme, chartTooltipOption } from '@/pages/statistics/use-chart-theme';
import { calculateAxisInterval, hasUsableChartSize, observeChartContainer } from '@/pages/statistics/chart-responsive';
import DVCategoryIcon from '@/components/category/DVCategoryIcon.vue';
import QuickEntrySheet from '@/pages/accounting/QuickEntrySheet.vue';

const props = defineProps<{
  bills: Bill[];
  activeYear: number;
}>();
const router = useRouter();
const appStore = useAppStore();
const categoryStore = useCategoryStore();

/* ---- 年度计算（Bill 派生） ---- */
const overview = computed(() => computeYearOverview(props.bills, props.activeYear));
const trend = computed(() => computeYearMonthlyTrend(props.bills, props.activeYear));
const activeMonths = computed(() => activeExpenseMonthCount(trend.value));
const avgMonthly = computed(() => computeYearAverageMonthlyExpense(overview.value, activeMonths.value));
const extremes = computed(() => computeYearExtremeMonths(trend.value));
const ranking = computed(() => computeYearCategoryRanking(props.bills, props.activeYear, 5));
const totalCategories = computed(() => computeYearCategoryRanking(props.bills, props.activeYear, 0));
const facts = computed(() => computeYearFacts(props.bills, props.activeYear, trend.value));
const isEmptyYear = computed(() => overview.value.count === 0);

const showAllCategories = ref(false);
const visibleRanking = computed(() => (showAllCategories.value ? totalCategories.value : ranking.value));

function fmt(n: number): string {
  return n.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
/** 整数格式（月均/笔数） */
function fmtInt(n: number): string {
  return n.toLocaleString('zh-CN', { maximumFractionDigits: 0 });
}

/* ---- 钻取（统计分析 → 搜索/编辑） ---- */
/** Top 分类行 → 实时分类（图标统一渲染；分类已删则回退快照 emoji） */
function rankCategory(r: { categoryId: string; name: string; emoji: string }) {
  return (
    categoryStore.byId(r.categoryId) ?? {
      id: r.categoryId,
      name: r.name,
      emoji: r.emoji,
      builtin: false,
      sort: 0,
    }
  );
}
function drillCategory(categoryId: string) {
  router.push({
    path: '/bill-search',
    query: buildSearchQuery({ year: props.activeYear, categoryId }),
  });
}
function drillMonth(ym: string) {
  router.push({ path: '/bill-search', query: buildSearchQuery({ month: ym }) });
}

/* ---- 最大单笔支出 → 直接编辑 ---- */
const editSheetOpen = ref(false);
const editingBill = ref<Bill | null>(null);
function openMaxExpenseEdit() {
  const max = facts.value.maxExpense;
  if (!max) return;
  editingBill.value = max;
  editSheetOpen.value = true;
}
async function onSaved() {
  editSheetOpen.value = false;
  editingBill.value = null;
}

/* ---- 12 月趋势（ECharts 平滑折线 + 轻透明面积，绿色主线；点击显示/再点钻取） ---- */
const chartRef = ref<HTMLElement | null>(null);
let chart: ReturnType<typeof echarts.init> | null = null;
let shownMonth: number | null = null;

/** 支出色（hex 或 rgb()）→ 0.28 透明度渐变起点（面积填充） */
function toAreaColor(color: string): string {
  if (color.startsWith('#')) {
    const r = parseInt(color.slice(1, 3), 16);
    const g = parseInt(color.slice(3, 5), 16);
    const b = parseInt(color.slice(5, 7), 16);
    if (Number.isFinite(r) && Number.isFinite(g) && Number.isFinite(b)) {
      return `rgba(${r}, ${g}, ${b}, 0.28)`;
    }
  }
  if (color.startsWith('rgb(')) return color.replace('rgb(', 'rgba(').replace(')', ', 0.28)');
  return 'rgba(56, 178, 115, 0.28)';
}

function buildTrendOption(t: YearMonthlyTrend): EChartsCoreOption {
  const th = snapshotChartTheme();
  return {
    backgroundColor: 'transparent',
    tooltip: {
      ...chartTooltipOption(th),
      confine: true,
      formatter: (p: unknown) => {
        const params = (Array.isArray(p) ? p : [p]) as { dataIndex: number; marker?: string; seriesName?: string }[];
        const idx = params[0]?.dataIndex;
        if (typeof idx !== 'number') return '';
        const point = t[idx];
        return `${point.label}<br/>支出 ¥${fmt(point.expense)}<br/>收入 ¥${fmt(point.income)}`;
      },
    },
    grid: { left: 8, right: 12, top: 12, bottom: 4, containLabel: true },
    xAxis: {
      type: 'category',
      boundaryGap: false,
      data: t.map((p) => p.label),
      axisLine: { lineStyle: { color: th.chartSplit } },
      axisTick: { show: false },
      axisLabel: {
        color: th.chartText,
        fontSize: 10,
        // v2.20.0 Gate A：12 个月在窄屏不叠字（宽屏 interval 0 全部显示）
        interval: calculateAxisInterval(t.length, chartRef.value?.clientWidth ?? 360, 8),
        showMaxLabel: true,
      },
    },
    yAxis: {
      type: 'value',
      splitLine: { lineStyle: { color: th.chartSplit } },
      axisLabel: { color: th.chartText, fontSize: 10 },
    },
    animationDuration: 400,
    animationEasing: 'cubicOut',
    series: [
      {
        name: '支出',
        type: 'line',
        smooth: 0.5,
        symbol: 'circle',
        symbolSize: 6,
        showSymbol: true,
        itemStyle: { color: th.expense },
        lineStyle: { color: th.expense, width: 2.5 },
        areaStyle: {
          color: {
            type: 'linear',
            x: 0, y: 0, x2: 0, y2: 1,
            colorStops: [
              { offset: 0, color: toAreaColor(th.expense) },
              { offset: 1, color: 'rgba(0,0,0,0)' },
            ],
          },
        },
        data: t.map((p) => Math.round(p.expense * 100) / 100),
      },
    ],
  };
}
function renderTrend() {
  const el = chartRef.value;
  // v2.20.0 Gate A：容器不可用（年度面板 v-show=false 时宽≈0）禁止初始化，
  // 由 ResizeObserver 在月度→年度切换、尺寸恢复后初始化/重绘
  if (!el || !hasUsableChartSize(el)) return;
  if (!chart) {
    try {
      chart = echarts.init(el, undefined, { renderer: 'svg' });
      chart.on('click', (params: unknown) => {
        const p = params as { dataIndex?: number };
        if (typeof p.dataIndex !== 'number') return;
        const m = p.dataIndex + 1;
        if (shownMonth === m) {
          // 已显示 tooltip 的同月再点 → 钻取该月账单
          shownMonth = null;
          chart?.dispatchAction?.({ type: 'hideTip' });
          drillMonth(`${props.activeYear}-${String(m).padStart(2, '0')}`);
          return;
        }
        shownMonth = m;
        chart?.dispatchAction?.({ type: 'showTip', seriesIndex: 0, dataIndex: p.dataIndex });
      });
    } catch {
      chart = null;
      return;
    }
    renderTrend();
  }
  chart.setOption(buildTrendOption(trend.value), true);
}
function resizeTrend() {
  chart?.resize();
}
onActivated(() => {
  void nextTick(() => {
    ensureECharts();
    refresh();
  });
});
/* v2.20.0 Gate A：年度趋势图也接入统一 ResizeObserver（隐藏面板 → 显示即初始化/重绘） */
let stopObserve: (() => void) | null = null;
let trendTimer: ReturnType<typeof setTimeout> | null = null;
function refresh() {
  if (trendTimer) clearTimeout(trendTimer);
  trendTimer = setTimeout(() => {
    trendTimer = null;
    renderTrend();
    resizeTrend();
  }, 16);
}
onMounted(() => {
  ensureECharts();
  stopObserve = observeChartContainer(chartRef.value, {
    onUsable: () => refresh(),
    onResize: () => refresh(),
  });
});
watch(
  [() => props.bills, () => props.activeYear, () => appStore.themeRevision],
  async () => {
    await nextTick();
    shownMonth = null;
    renderTrend();
    resizeTrend();
  },
  { flush: 'post' },
);
onDeactivated(() => {
  shownMonth = null;
  editSheetOpen.value = false;
  editingBill.value = null;
});
onBeforeUnmount(() => {
  stopObserve?.();
  stopObserve = null;
  if (trendTimer) clearTimeout(trendTimer);
  chart?.dispose();
  chart = null;
});
/** 父组件（StatisticsPage）月度↔年度切换时的第二层显式布局刷新 */
defineExpose({ refresh });
</script>

<template>
  <div class="year-review">
    <!-- 空年份：不展示一堆 ¥0/0%/0笔 -->
    <div v-if="isEmptyYear" class="year-review__empty">
      <p class="year-review__empty-year">{{ activeYear }}</p>
      <p class="year-review__empty-text">这一年还没有记录</p>
      <p class="year-review__empty-hint">去看看其他年份</p>
    </div>

    <template v-else>
      <!-- 年度 Hero 卡（主色系，明显区别于月度普通卡） -->
      <DVCard class="year-review__hero" glass>
        <p class="year-review__hero-year">{{ activeYear }}</p>
        <p class="year-review__hero-desc">这一年你记录了 {{ overview.count }} 笔账单</p>
        <p class="year-review__hero-label">总支出</p>
        <p class="year-review__hero-expense">¥ {{ fmt(overview.expense) }}</p>
        <div class="year-review__hero-sub">
          <span>收入 ¥ {{ fmt(overview.income) }}</span>
          <span :class="overview.net < 0 ? 'is-negative' : ''">结余 ¥ {{ fmt(overview.net) }}</span>
        </div>
      </DVCard>

      <!-- 月均 / 最高消费月 / 最低消费月 -->
      <div class="year-review__stats-row">
        <div class="year-review__stat">
          <span class="year-review__stat-label">月均支出</span>
          <span class="year-review__stat-value">¥ {{ fmtInt(avgMonthly) }}</span>
        </div>
        <button class="year-review__stat" type="button" :disabled="!extremes.max" @click="extremes.max && drillMonth(`${activeYear}-${String(extremes.max.month).padStart(2, '0')}`)">
          <span class="year-review__stat-label">最高消费月</span>
          <span class="year-review__stat-value is-accent">
            {{ extremes.max ? `${extremes.max.label} · ¥ ${fmtInt(extremes.max.expense)}` : '—' }}
          </span>
        </button>
        <button class="year-review__stat" type="button" :disabled="!extremes.min" @click="extremes.min && drillMonth(`${activeYear}-${String(extremes.min.month).padStart(2, '0')}`)">
          <span class="year-review__stat-label">最低消费月</span>
          <span class="year-review__stat-value">
            {{ extremes.min ? `${extremes.min.label} · ¥ ${fmtInt(extremes.min.expense)}` : '—' }}
          </span>
        </button>
      </div>

      <!-- 12 月支出趋势（平滑面积折线，绿色主线；点击显示 tooltip，再点同月钻取） -->
      <DVCard class="year-review__block year-review__block--trend" outlined>
        <h3 class="year-review__title">12 个月支出趋势</h3>
        <div class="year-review__chart-stage">
          <div ref="chartRef" class="year-review__chart" />
        </div>
      </DVCard>

      <!-- 年度分类排名 Top5（查看全部展开） -->
      <DVCard v-if="visibleRanking.length" class="year-review__block" outlined>
        <h3 class="year-review__title">年度消费去向</h3>
        <ul class="year-review__rank">
          <li
            v-for="r in visibleRanking"
            :key="r.categoryId"
            class="year-review__rank-item"
            role="button"
            tabindex="0"
            @click="drillCategory(r.categoryId)"
            @keydown.enter="drillCategory(r.categoryId)"
          >
            <span class="year-review__rank-emoji">
              <DVCategoryIcon :category="rankCategory(r)" :size="18" />
            </span>
            <span class="year-review__rank-name">{{ r.name }}</span>
            <span class="year-review__rank-bar">
              <i class="year-review__rank-fill" :style="{ width: Math.min(100, r.percent) + '%' }" />
            </span>
            <span class="year-review__rank-amt">¥ {{ fmtInt(r.amount) }}</span>
            <span class="year-review__rank-pct">{{ r.percent }}%</span>
          </li>
        </ul>
        <button
          v-if="totalCategories.length > 5"
          class="year-review__more"
          type="button"
          @click="showAllCategories = !showAllCategories"
        >
          {{ showAllCategories ? '收起 ▲' : `查看全部 ${totalCategories.length} 个 >` }}
        </button>
      </DVCard>

      <!-- 消费足迹（只从真实数据算确定事实，不生成伪 AI 文案） -->
      <DVCard class="year-review__block" outlined>
        <h3 class="year-review__title">消费足迹</h3>
        <button
          v-if="facts.maxExpense"
          class="year-review__fact"
          type="button"
          @click="openMaxExpenseEdit"
        >
          <span class="year-review__fact-label">今年最大的一笔支出</span>
          <span class="year-review__fact-meta">
            {{ facts.maxExpense.date.slice(5).replace('-', '月') }}日 ·
            {{ facts.maxExpense.title || facts.maxExpense.categoryName }} · ¥ {{ fmt(facts.maxExpense.amount) }}
          </span>
          <span class="year-review__fact-chevron">›</span>
        </button>
        <div v-if="facts.topCategory" class="year-review__fact">
          <span class="year-review__fact-label">记录最多的分类</span>
          <span class="year-review__fact-meta">{{ facts.topCategory.name }} · {{ facts.topCategory.count }} 笔</span>
        </div>
        <div v-if="facts.topMonth" class="year-review__fact">
          <span class="year-review__fact-label">最常消费月份</span>
          <span class="year-review__fact-meta">{{ facts.topMonth.label }} · {{ facts.topMonth.count }} 笔</span>
        </div>
      </DVCard>
    </template>

    <!-- 最大单笔支出 → QuickEntrySheet 编辑模式 -->
    <QuickEntrySheet
      :model-value="editSheetOpen"
      :editing-bill="editingBill"
      @update:model-value="(v: boolean) => (editSheetOpen = v)"
      @saved="onSaved"
    />
  </div>
</template>

<style scoped>
.year-review {
  display: flex;
  flex-direction: column;
  gap: var(--dv-space-sm);
}
/* 空年份 */
.year-review__empty {
  padding: var(--dv-space-xl) 0;
  text-align: center;
}
.year-review__empty-year {
  font-size: 34px;
  font-weight: 700;
  color: var(--dv-on-surface);
}
.year-review__empty-text {
  margin-top: var(--dv-space-xs);
  font-size: 15px;
  color: var(--dv-on-surface);
}
.year-review__empty-hint {
  margin-top: var(--dv-space-xxs);
  font-size: 13px;
  color: var(--dv-on-surface-variant);
}
/* Hero（主色系大卡） */
.year-review__hero {
  padding: var(--dv-space-lg) var(--dv-space-md);
  background: var(--dv-hero-bg);
  border: none;
  box-shadow: var(--dv-hero-shadow);
  border-radius: var(--dv-radius-xl);
  text-align: center;
}
.year-review__hero-year {
  font-size: 30px;
  font-weight: 800;
  color: var(--dv-hero-text);
  letter-spacing: 1px;
}
.year-review__hero-desc {
  margin-top: 2px;
  font-size: 13px;
  color: var(--dv-hero-text-dim);
}
.year-review__hero-label {
  margin-top: var(--dv-space-sm);
  font-size: 12px;
  color: var(--dv-hero-text-dim);
}
.year-review__hero-expense {
  font-size: 30px;
  font-weight: 800;
  font-variant-numeric: tabular-nums;
  color: var(--dv-hero-text);
  transition: opacity var(--dv-motion-normal) var(--dv-ease-standard);
}
.year-review__hero-sub {
  display: flex;
  justify-content: center;
  gap: var(--dv-space-md);
  margin-top: var(--dv-space-xs);
  font-size: 13px;
  color: var(--dv-hero-text-dim);
}
.year-review__hero-sub .is-negative {
  color: var(--dv-warning);
}
/* 月均 / 最高 / 最低 三格 */
.year-review__stats-row {
  display: flex;
  gap: var(--dv-space-xs);
}
.year-review__stat {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--dv-space-xxs);
  padding: var(--dv-space-sm) var(--dv-space-xxs);
  border-radius: var(--dv-radius-md);
  background: var(--dv-surface);
  border: 1px solid var(--dv-surface-border);
  color: var(--dv-on-surface);
}
.year-review__stat:disabled {
  opacity: 0.5;
}
.year-review__stat-label {
  font-size: 11px;
  color: var(--dv-on-surface-variant);
  white-space: nowrap;
}
.year-review__stat-value {
  font-size: 13px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.year-review__stat-value.is-accent {
  color: var(--dv-primary);
}
/* 区块卡 */
.year-review__block {
  padding: var(--dv-space-md);
}
.year-review__block--trend {
  padding-bottom: var(--dv-space-xs);
}
.year-review__title {
  font-size: 15px;
  font-weight: 600;
  color: var(--dv-on-surface);
  margin-bottom: var(--dv-space-sm);
}
.year-review__chart-stage {
  height: 200px;
}
.year-review__chart {
  width: 100%;
  height: 100%;
}
/* 分类排名 */
.year-review__rank {
  list-style: none;
  display: flex;
  flex-direction: column;
}
.year-review__rank-item {
  display: flex;
  align-items: center;
  gap: var(--dv-space-sm);
  padding: 7px 0;
  cursor: pointer;
}
.year-review__rank-emoji {
  flex-shrink: 0;
  width: 28px;
  height: 28px;
  border-radius: var(--dv-radius-sm);
  background: var(--dv-surface-alt);
  display: flex;
  align-items: center;
  justify-content: center;
}
.year-review__rank-name {
  width: 48px;
  flex-shrink: 0;
  font-size: 13px;
  color: var(--dv-on-surface);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.year-review__rank-bar {
  flex: 1;
  min-width: 0;
  height: 6px;
  border-radius: var(--dv-radius-pill);
  background: var(--dv-surface-alt);
  overflow: hidden;
}
.year-review__rank-fill {
  display: block;
  height: 100%;
  border-radius: var(--dv-radius-pill);
  background: var(--dv-expense);
  transition: width var(--dv-motion-normal) var(--dv-ease-standard);
}
.year-review__rank-amt {
  min-width: 72px;
  text-align: right;
  font-size: 13px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  color: var(--dv-on-surface);
}
.year-review__rank-pct {
  width: 38px;
  text-align: right;
  font-size: 12px;
  color: var(--dv-on-surface-variant);
  font-variant-numeric: tabular-nums;
}
.year-review__more {
  margin-top: var(--dv-space-xs);
  padding: 8px 0;
  width: 100%;
  border-radius: var(--dv-radius-md);
  background: var(--dv-surface-alt);
  color: var(--dv-primary);
  font-size: 13px;
  font-weight: 600;
}
/* 消费足迹 */
.year-review__fact {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--dv-space-sm);
  padding: 10px 0;
  width: 100%;
  border-bottom: 1px solid var(--dv-surface-border);
  text-align: left;
  color: var(--dv-on-surface);
}
.year-review__fact:last-child {
  border-bottom: none;
}
.year-review__fact-label {
  flex-shrink: 0;
  font-size: 13px;
  color: var(--dv-on-surface-variant);
}
.year-review__fact-meta {
  flex: 1;
  min-width: 0;
  text-align: right;
  font-size: 13px;
  font-weight: 600;
  color: var(--dv-on-surface);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.year-review__fact-chevron {
  color: var(--dv-on-surface-variant);
  font-size: 16px;
}
:global([data-wallpaper='on'] .year-review__stat),
:global([data-wallpaper='on'] .year-review__block) {
  background: var(--dv-surface-soft);
  border-color: var(--dv-surface-border);
}
</style>