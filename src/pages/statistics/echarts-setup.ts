/**
 * Daily Value v2 - ECharts 全局注册（2.12.0）
 *
 * 集中注册统计页 + 各统计模块所需的图表类型与组件（Pie/Bar/Line + SVG）。
 * ensureECharts() 幂等：在 StatisticsPage 与各模块组件进入前调用一次即可，重复调用无副作用。
 * 集中在这里便于测试统一 mock echarts/core、echarts/charts。
 */
import * as echarts from 'echarts/core';
import { PieChart, BarChart, LineChart } from 'echarts/charts';
import {
  TitleComponent,
  TooltipComponent,
  LegendComponent,
  GridComponent,
  MarkLineComponent,
} from 'echarts/components';
import { SVGRenderer } from 'echarts/renderers';

let ensured = false;
export function ensureECharts(): void {
  if (ensured) return;
  echarts.use([
    PieChart,
    BarChart,
    LineChart,
    TitleComponent,
    TooltipComponent,
    LegendComponent,
    GridComponent,
    MarkLineComponent,
    SVGRenderer,
  ]);
  ensured = true;
}