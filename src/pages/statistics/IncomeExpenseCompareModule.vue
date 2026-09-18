<script setup lang="ts">
/**
 * 统计模块 - 收入 / 支出对比（2.12.0）
 * 柱状图按天对比收入与支出（缺失为 0）；底部摘要：本月总支出 / 本月总收入 / 结余。
 */
defineOptions({ name: 'IncomeExpenseCompareModule' });
import { computed, ref } from 'vue';
import type { EChartsCoreOption } from 'echarts/core';
import { DVCard } from '@/components/design';
import { useAppStore } from '@/core/store/app';
import type { Bill } from '@/core/models/types';
import { computeIncomeExpenseCompare } from './statistics-modules';
import { useModuleChart } from './use-module-chart';
import { chartTooltipOption } from './use-chart-theme';
import { calculateAxisInterval } from './chart-responsive';

const app = useAppStore();

const props = defineProps<{
  bills: Bill[];
  activeYm: string;
  today: string;
  monthLabel: string;
}>();

const data = computed(() =>
  computeIncomeExpenseCompare(props.bills, props.activeYm, props.today),
);

const chartRef = ref<HTMLElement | null>(null);
const chart = useModuleChart(
  chartRef,
  (): EChartsCoreOption => {
    const t = chart.theme();
    const days = data.value.points;
    return {
      backgroundColor: 'transparent',
      tooltip: chartTooltipOption(t),
      legend: {
        data: ['支出', '收入'],
        top: 0,
        right: 0,
        textStyle: { color: t.chartText, fontSize: 11 },
        itemWidth: 12,
        itemHeight: 8,
      },
      grid: { left: 8, right: 8, top: 30, bottom: 4, containLabel: true },
      xAxis: {
        type: 'category',
        data: days.map((p) => p.label),
        axisLine: { lineStyle: { color: t.chartSplit } },
        axisTick: { show: false },
        axisLabel: {
          color: t.chartText,
          fontSize: 10,
          // v2.20.0 Gate A：18/31 天不叠字（约 6~8 个易读标签），末位保留
          interval: calculateAxisInterval(days.length, chartRef.value?.clientWidth ?? 360),
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
          name: '支出',
          type: 'bar',
          barMaxWidth: 14,
          itemStyle: { color: t.expense, borderRadius: [4, 4, 0, 0] },
          data: days.map((p) => p.expense),
        },
        {
          name: '收入',
          type: 'bar',
          barMaxWidth: 14,
          itemStyle: { color: t.income, borderRadius: [4, 4, 0, 0] },
          data: days.map((p) => p.income),
        },
      ],
    };
  },
  [() => props.activeYm, () => props.bills, () => app.themeRevision],
);
</script>

<template>
  <DVCard class="stats-module" outlined>
    <div class="stats-module__head">
      <h3 class="stats-module__title">收入 / 支出对比</h3>
      <span class="stats-module__range">{{ monthLabel }}</span>
    </div>
    <div class="stats-module__stage">
      <div ref="chartRef" class="stats-module__chart" :class="{ 'is-hidden': !data.hasData }" />
      <p v-if="!data.hasData" class="stats-module__empty">当前时间范围暂无数据</p>
    </div>
    <div v-if="data.hasData" class="stats-module__foot">
      <span class="stats-module__metric">
        <b>本月总支出</b><em>¥ {{ data.totalExpense.toFixed(2) }}</em>
      </span>
      <span class="stats-module__metric">
        <b>本月总收入</b><em>¥ {{ data.totalIncome.toFixed(2) }}</em>
      </span>
      <span class="stats-module__metric" :class="{ 'is-warn': data.balance < 0 }">
        <b>结余</b><em>¥ {{ data.balance.toFixed(2) }}</em>
      </span>
    </div>
  </DVCard>
</template>

<style scoped>
.stats-module {
  padding: var(--dv-space-md);
}
.stats-module__head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--dv-space-sm);
  margin-bottom: var(--dv-space-xs);
}
.stats-module__title {
  font-size: 15px;
  font-weight: 600;
  color: var(--dv-on-surface);
}
.stats-module__range {
  flex-shrink: 0;
  font-size: 12px;
  color: var(--dv-on-surface-variant);
  white-space: nowrap;
}
.stats-module__stage {
  position: relative;
  height: 240px;
}
.stats-module__chart {
  height: 100%;
  width: 100%;
}
.stats-module__chart.is-hidden {
  visibility: hidden;
}
.stats-module__empty {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--dv-on-surface-variant);
  font-size: 13px;
}
.stats-module__foot {
  display: flex;
  align-items: center;
  gap: var(--dv-space-xs);
  margin-top: var(--dv-space-sm);
  padding-top: var(--dv-space-sm);
  border-top: 1px solid var(--dv-surface-border);
}
.stats-module__metric {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.stats-module__metric b {
  font-size: 11px;
  font-weight: 400;
  color: var(--dv-on-surface-variant);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.stats-module__metric em {
  font-style: normal;
  font-size: 13px;
  font-weight: 600;
  color: var(--dv-on-surface);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.stats-module__metric.is-warn em {
  color: var(--dv-warning);
}
</style>