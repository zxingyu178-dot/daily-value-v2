<script setup lang="ts">
/**
 * 统计模块 - 累计消费趋势（2.12.0）
 * 折线图展示本月累计支出的上升过程；底部摘要：当前累计支出 / 月内最高单日新增 / 均值斜率。
 */
defineOptions({ name: 'CumulativeExpenseModule' });
import { computed, ref } from 'vue';
import type { EChartsCoreOption } from 'echarts/core';
import { DVCard } from '@/components/design';
import { useAppStore } from '@/core/store/app';
import type { Bill } from '@/core/models/types';
import { computeCumulativeExpense } from './statistics-modules';
import { useModuleChart } from './use-module-chart';
import { chartTooltipOption } from './use-chart-theme';

const app = useAppStore();

const props = defineProps<{
  bills: Bill[];
  activeYm: string;
  today: string;
  monthLabel: string;
}>();

const data = computed(() =>
  computeCumulativeExpense(props.bills, props.activeYm, props.today),
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
      grid: { left: 8, right: 12, top: 12, bottom: 4, containLabel: true },
      xAxis: {
        type: 'category',
        boundaryGap: false,
        data: days.map((p) => p.label),
        axisLine: { lineStyle: { color: t.chartSplit } },
        axisTick: { show: false },
        axisLabel: { color: t.chartText, fontSize: 10, interval: Math.max(0, Math.floor(days.length / 10) - 1) },
      },
      yAxis: {
        type: 'value',
        splitLine: { lineStyle: { color: t.chartSplit } },
        axisLabel: { color: t.chartText, fontSize: 10 },
      },
      series: [
        {
          name: '累计支出',
          type: 'line',
          data: days.map((p) => p.cumulative),
          symbol: 'none',
          lineStyle: { color: t.expense, width: 2.5 },
          itemStyle: { color: t.expense },
          areaStyle: {
            color: {
              type: 'linear',
              x: 0,
              y: 0,
              x2: 0,
              y2: 1,
              colorStops: [
                { offset: 0, color: t.expense + '2e' },
                { offset: 1, color: t.expense + '00' },
              ],
            },
          },
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
      <h3 class="stats-module__title">累计消费趋势</h3>
      <span class="stats-module__range">{{ monthLabel }}</span>
    </div>
    <div class="stats-module__stage">
      <div ref="chartRef" class="stats-module__chart" :class="{ 'is-hidden': !data.hasData }" />
      <p v-if="!data.hasData" class="stats-module__empty">当前时间范围暂无数据</p>
    </div>
    <div v-if="data.hasData" class="stats-module__foot">
      <span class="stats-module__metric">
        <b>当前累计支出</b><em>¥ {{ data.total.toFixed(2) }}</em>
      </span>
      <span class="stats-module__metric">
        <b>最高单日新增</b><em>{{ data.highestDay?.label ?? '—' }} ¥ {{ data.highestDay?.amount.toFixed(2) ?? '0.00' }}</em>
      </span>
      <span class="stats-module__metric">
        <b>日均增加</b><em>¥ {{ data.dailyAverage.toFixed(2) }}<i> /天</i></em>
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
.stats-module__metric em i {
  font-style: normal;
  font-size: 11px;
  font-weight: 400;
  color: var(--dv-on-surface-variant);
}
</style>