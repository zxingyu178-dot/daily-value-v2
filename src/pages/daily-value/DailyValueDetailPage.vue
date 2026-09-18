<script setup lang="ts">
/**
 * DailyValue v2.20.0 Gate B - 日价详情（我的物品价值入口）
 * - 点击日价列表卡进入；顶部 ‹ 返回 / 右上角「编辑」。
 * - Hero 突出「¥xx / 天」（当前日价），原价/起算日期为次级信息。
 * - 日价变化曲线（第1天 → 今天，value = amount / day），复用统一响应式图表生命周期。
 * - 里程碑：使用时间节点（7/30/100/365…）+ 日价目标节点（按原价选 3~5 个），
 *   + 最近里程碑摘要（已达成 / 下一站）。全部纯数学事实。
 * - 数据全部从 Bill.dailyValue 派生（detail.ts 纯函数），不新增数据库。
 * - 缺失/已删除 → 显示「这个日价项目已不存在」并可返回（不白屏）。
 */
defineOptions({ name: 'DailyValueDetailPage' });
import { computed, onDeactivated, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import type { EChartsCoreOption } from 'echarts/core';
import { DVCard, toast } from '@/components/design';
import { useAppStore } from '@/core/store/app';
import { useBillStore } from '@/core/store/bill';
import { useCategoryStore } from '@/core/store/category';
import { localDateKey } from '@/core/models/daily-value';
import type { Bill } from '@/core/models/types';
import {
  buildDailyValueCurve,
  buildMilestoneSummary,
  computeDailyPriceMilestones,
  computeDailyValueDetail,
  computeUsageMilestones,
} from '@/core/daily-value/detail';
import { useModuleChart } from '@/pages/statistics/use-module-chart';
import { chartTooltipOption } from '@/pages/statistics/use-chart-theme';
import { calculateAxisInterval } from '@/pages/statistics/chart-responsive';
import DVCategoryIcon from '@/components/category/DVCategoryIcon.vue';
import DailyValueAddSheet from './DailyValueAddSheet.vue';

const route = useRoute();
const router = useRouter();
const billStore = useBillStore();
const categoryStore = useCategoryStore();
const appStore = useAppStore();

const today = ref<string>(localDateKey());
const billId = computed(() => String(route.params.billId ?? ''));

const bill = computed<Bill | undefined>(() => billStore.bills.find((b) => b.id === billId.value));
const detail = computed(() => computeDailyValueDetail(bill.value, today.value));

const curve = computed(() => buildDailyValueCurve(bill.value, today.value));
const usageMilestones = computed(() =>
  detail.value.ok ? computeUsageMilestones(detail.value.startDate, today.value) : [],
);
const priceMilestones = computed(() =>
  detail.value.ok ? computeDailyPriceMilestones(detail.value.amount, detail.value.elapsed) : [],
);
const summary = computed(() => buildMilestoneSummary(detail.value, priceMilestones.value));

const categoryOf = computed(() =>
  detail.value.ok
    ? (categoryStore.byId(detail.value.categoryId) ?? {
        id: detail.value.categoryId,
        name: detail.value.categoryName,
        emoji: detail.value.emoji,
        builtin: false,
        sort: 0,
      })
    : null,
);

function fmt(n: number): string {
  return n.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtInt(n: number): string {
  return n.toLocaleString('zh-CN', { maximumFractionDigits: 0 });
}
/** 起算日期展示（2025年10月26日） */
function dateText(date: string): string {
  if (!date) return '';
  const [y, m, d] = date.split('-').map(Number);
  return `${y}年${m}月${d}日`;
}

/* ---- 日价变化曲线（统一响应式图表生命周期） ---- */
const chartRef = ref<HTMLElement | null>(null);
const chart = useModuleChart(
  chartRef,
  (): EChartsCoreOption => {
    const t = chart.theme();
    const points = curve.value;
    return {
      backgroundColor: 'transparent',
      tooltip: {
        ...chartTooltipOption(t),
        confine: true,
        formatter: (p: unknown) => {
          const params = (Array.isArray(p) ? p : [p]) as { dataIndex?: number }[];
          const idx = params[0]?.dataIndex;
          const pt = typeof idx === 'number' ? points[idx] : undefined;
          if (!pt) return '';
          return `${pt.date}<br/>已使用 ${pt.day} 天<br/><b>¥ ${fmt(pt.value)} / 天</b>`;
        },
      },
      grid: { left: 8, right: 12, top: 12, bottom: 4, containLabel: true },
      xAxis: {
        type: 'category',
        boundaryGap: false,
        data: points.map((p) => p.label),
        axisLine: { lineStyle: { color: t.chartSplit } },
        axisTick: { show: false },
        axisLabel: {
          color: t.chartText,
          fontSize: 10,
          interval: calculateAxisInterval(points.length, chartRef.value?.clientWidth ?? 360),
          showMaxLabel: true,
        },
      },
      yAxis: {
        type: 'value',
        splitLine: { lineStyle: { color: t.chartSplit } },
        axisLabel: { color: t.chartText, fontSize: 10 },
      },
      series: [
        {
          name: '日价',
          type: 'line',
          smooth: 0.3,
          symbol: 'circle',
          symbolSize: 4,
          data: points.map((p) => p.value),
          lineStyle: { color: t.income, width: 2.5 },
          itemStyle: { color: t.income },
          areaStyle: {
            color: {
              type: 'linear',
              x: 0,
              y: 0,
              x2: 0,
              y2: 1,
              colorStops: [
                { offset: 0, color: toAreaColor(t.income) },
                { offset: 1, color: 'rgba(0,0,0,0)' },
              ],
            },
          },
        },
      ],
    };
  },
  [() => billId.value, () => bill.value, () => detail.value.elapsed, () => appStore.themeRevision],
);

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
  return 'rgba(224, 75, 75, 0.28)';
}

/* ---- 编辑入口（复用 DailyValueAddSheet） ---- */
const editSheetOpen = ref(false);
const editingBill = ref<Bill | null>(null);
function openEdit() {
  if (!detail.value.ok) return;
  editingBill.value = detail.value.bill ?? null;
  editSheetOpen.value = true;
}
async function onEdited() {
  editSheetOpen.value = false;
  editingBill.value = null;
  await billStore.load(true); // Hero/曲线/里程碑/列表即时刷新
  toast.success('已保存');
}

function goBack() {
  if (detail.value.ok) {
    if (window.history.length > 1) router.back();
    else router.replace('/daily-value');
  } else {
    router.replace('/daily-value');
  }
}
onDeactivated(() => {
  editSheetOpen.value = false;
  editingBill.value = null;
});
</script>

<template>
  <section class="dv-detail">
    <!-- 顶栏：返回 + 标题 + 编辑 -->
    <header class="dv-detail__head">
      <button class="dv-detail__back" type="button" aria-label="返回" @click="goBack">‹</button>
      <span class="dv-detail__title">日价详情</span>
      <button
        v-if="detail.ok"
        class="dv-detail__edit"
        type="button"
        aria-label="编辑日价"
        @click="openEdit"
      >
        编辑
      </button>
      <span v-else class="dv-detail__edit-spacer" aria-hidden="true"></span>
    </header>

    <!-- 缺失 / 已删除：不白屏 -->
    <div v-if="!detail.ok" class="dv-detail__missing">
      <p class="dv-detail__missing-title">这个日价项目已不存在</p>
      <button class="dv-detail__missing-back" type="button" @click="goBack">返回日价列表</button>
    </div>

    <template v-else>
      <!-- Hero：当前日价（重点） -->
      <DVCard class="dv-detail__hero" glass>
        <p class="dv-detail__hero-name">
          <span v-if="categoryOf" class="dv-detail__hero-icon">
            <DVCategoryIcon :category="categoryOf" :size="20" />
          </span>
          {{ detail.name }}
        </p>
        <p class="dv-detail__hero-current-label">当前日价</p>
        <p class="dv-detail__hero-current">
          ¥ {{ fmt(detail.current) }} <em>/ 天</em>
        </p>
        <p class="dv-detail__hero-used">已使用 {{ detail.elapsed }} 天</p>
        <p class="dv-detail__hero-meta">
          原价 ¥ {{ fmt(detail.amount) }} · {{ dateText(detail.startDate) }} 开始计算
        </p>
      </DVCard>

      <!-- 最近里程碑摘要（纯事实） -->
      <DVCard v-if="summary" class="dv-detail__summary" outlined>
        <p class="dv-detail__summary-now">当前已经达到</p>
        <p class="dv-detail__summary-achieved">{{ summary.achievedText }}</p>
        <p v-if="summary.nextText" class="dv-detail__summary-next">下一站：{{ summary.nextText }}</p>
      </DVCard>

      <!-- 日价变化曲线 -->
      <DVCard class="dv-detail__block" outlined>
        <h3 class="dv-detail__title">日价变化</h3>
        <div class="dv-detail__chart-stage">
          <div ref="chartRef" class="dv-detail__chart" />
        </div>
      </DVCard>

      <!-- 里程碑：使用时间节点 -->
      <DVCard v-if="usageMilestones.length" class="dv-detail__block" outlined>
        <h3 class="dv-detail__title">使用时间</h3>
        <ul class="dv-detail__ms">
          <li
            v-for="m in usageMilestones"
            :key="m.target"
            class="dv-detail__ms-item"
            :class="{ 'is-done': m.achieved }"
          >
            <span class="dv-detail__ms-mark" aria-hidden="true">{{ m.achieved ? '✓' : '○' }}</span>
            <span class="dv-detail__ms-text">
              使用 {{ m.target }} 天
              <em v-if="!m.achieved">还有 {{ m.remaining }} 天</em>
            </span>
          </li>
        </ul>
      </DVCard>

      <!-- 里程碑：日价目标节点 -->
      <DVCard v-if="priceMilestones.length" class="dv-detail__block" outlined>
        <h3 class="dv-detail__title">日价节点</h3>
        <ul class="dv-detail__ms">
          <li
            v-for="m in priceMilestones"
            :key="m.target"
            class="dv-detail__ms-item"
            :class="{ 'is-done': m.achieved }"
          >
            <span class="dv-detail__ms-mark" aria-hidden="true">{{ m.achieved ? '✓' : '○' }}</span>
            <span class="dv-detail__ms-text">
              降到 ¥{{ m.target }} / 天
              <em>
                {{
                  m.achieved
                    ? `第 ${fmtInt(m.requiredDays)} 天达成`
                    : `预计第 ${fmtInt(m.requiredDays)} 天`
                }}
              </em>
            </span>
          </li>
        </ul>
      </DVCard>
    </template>

    <!-- 编辑（复用 DailyValueAddSheet：编辑现有 Bill，保存后全部即时更新） -->
    <DailyValueAddSheet
      :model-value="editSheetOpen"
      :editing-bill="editingBill"
      @update:model-value="(v: boolean) => (editSheetOpen = v)"
      @saved="onEdited"
    />
  </section>
</template>

<style scoped>
.dv-detail {
  display: flex;
  flex-direction: column;
  gap: var(--dv-space-sm);
  padding: var(--dv-space-md);
  padding-bottom: calc(var(--dv-space-xl) + var(--dv-safe-bottom));
}
.dv-detail__head {
  display: flex;
  align-items: center;
  gap: var(--dv-space-xs);
}
.dv-detail__back,
.dv-detail__edit {
  width: 36px;
  height: 36px;
  border-radius: var(--dv-radius-pill);
  background: var(--dv-surface);
  border: 1px solid var(--dv-outline);
  color: var(--dv-on-surface);
  font-size: 20px;
  line-height: 1;
}
.dv-detail__edit {
  width: auto;
  padding: 0 14px;
  font-size: 14px;
  font-weight: 600;
  color: var(--dv-primary);
}
.dv-detail__edit-spacer {
  width: 36px;
}
.dv-detail__title {
  flex: 1;
  text-align: center;
  font-size: 17px;
  font-weight: 600;
  color: var(--dv-on-surface);
}
/* 缺失状态 */
.dv-detail__missing {
  padding: var(--dv-space-xl) 0;
  text-align: center;
}
.dv-detail__missing-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--dv-on-surface);
}
.dv-detail__missing-back {
  margin-top: var(--dv-space-md);
  padding: 8px 18px;
  border-radius: var(--dv-radius-pill);
  background: var(--dv-primary);
  color: var(--dv-on-primary, #fff);
  font-size: 14px;
}
/* Hero */
.dv-detail__hero {
  padding: var(--dv-space-lg) var(--dv-space-md);
  background: var(--dv-hero-bg);
  border: none;
  box-shadow: var(--dv-hero-shadow);
  text-align: center;
}
.dv-detail__hero-name {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--dv-space-xs);
  font-size: 16px;
  font-weight: 700;
  color: var(--dv-hero-text);
}
.dv-detail__hero-icon {
  display: inline-flex;
}
.dv-detail__hero-current-label {
  margin-top: var(--dv-space-sm);
  font-size: 12px;
  color: var(--dv-hero-text-dim);
}
.dv-detail__hero-current {
  margin-top: 2px;
  font-size: 34px;
  font-weight: 800;
  font-variant-numeric: tabular-nums;
  color: var(--dv-hero-text);
}
.dv-detail__hero-current em {
  font-style: normal;
  font-size: 16px;
  font-weight: 600;
}
.dv-detail__hero-used {
  margin-top: var(--dv-space-xs);
  font-size: 13px;
  color: var(--dv-hero-text);
}
.dv-detail__hero-meta {
  margin-top: 2px;
  font-size: 12px;
  color: var(--dv-hero-text-dim);
}
/* 最近里程碑摘要 */
.dv-detail__summary {
  padding: var(--dv-space-md);
}
.dv-detail__summary-now {
  font-size: 12px;
  color: var(--dv-on-surface-variant);
}
.dv-detail__summary-achieved {
  margin-top: 2px;
  font-size: 15px;
  font-weight: 600;
  color: var(--dv-on-surface);
}
.dv-detail__summary-next {
  margin-top: var(--dv-space-xxs);
  font-size: 13px;
  color: var(--dv-primary);
}
/* 区块 */
.dv-detail__block {
  padding: var(--dv-space-md);
}
.dv-detail__title {
  font-size: 15px;
  font-weight: 600;
  color: var(--dv-on-surface);
  margin-bottom: var(--dv-space-sm);
}
.dv-detail__chart-stage {
  height: 220px;
}
.dv-detail__chart {
  width: 100%;
  height: 100%;
}
/* 里程碑列表 */
.dv-detail__ms {
  list-style: none;
  display: flex;
  flex-direction: column;
}
.dv-detail__ms-item {
  display: flex;
  align-items: center;
  gap: var(--dv-space-sm);
  padding: 8px 0;
  border-bottom: 1px solid var(--dv-surface-border);
}
.dv-detail__ms-item:last-child {
  border-bottom: none;
}
.dv-detail__ms-mark {
  width: 22px;
  height: 22px;
  flex-shrink: 0;
  border-radius: var(--dv-radius-pill);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
  background: var(--dv-surface-alt);
  color: var(--dv-on-surface-variant);
}
.dv-detail__ms-item.is-done .dv-detail__ms-mark {
  background: color-mix(in srgb, var(--dv-expense) 16%, transparent);
  color: var(--dv-expense);
}
.dv-detail__ms-text {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--dv-space-sm);
  font-size: 14px;
  color: var(--dv-on-surface);
}
.dv-detail__ms-item.is-done .dv-detail__ms-text {
  color: var(--dv-on-surface);
}
.dv-detail__ms-text em {
  font-style: normal;
  font-size: 12px;
  color: var(--dv-on-surface-variant);
}
.dv-detail__ms-item.is-done .dv-detail__ms-text em {
  color: var(--dv-expense);
}
:global([data-wallpaper='on'] .dv-detail__summary),
:global([data-wallpaper='on'] .dv-detail__block) {
  background: var(--dv-surface-soft);
  border-color: var(--dv-surface-border);
}
</style>