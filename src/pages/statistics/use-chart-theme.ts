/**
 * Daily Value v2 - 图表主题快照（2.12.0）
 *
 * 从 CSS 变量读取图表配色（复刻 StatisticsPage.readChartColors 的 token 逻辑），
 * 供各统计模块组件在 mount / 页面重新激活 / 主题切换时取用。
 * 玻璃模式（深色 + data-theme-glass 非 off）时使用 GLASS 图表配色与四色分类 palette。
 * 页面环形图/柱状图保留其原有 inline 逻辑，本模块面向新增的大图模块使用，避免改动既有稳定路径。
 */
import { GLASS_CHART, GLASS_CATEGORY_PALETTE } from '@/theme/tokens';

export interface ChartThemeSnapshot {
  isDark: boolean;
  chartText: string;
  chartSplit: string;
  chartSurface: string;
  wallpaperOn: boolean;
  glassOn: boolean;
  expense: string;
  income: string;
  categoryPalette: string[];
  /** Tooltip 视觉（2.13.0：不再是大白框，随主题 Surface/文字 Token） */
  tooltipBg: string;
  tooltipBorder: string;
  tooltipText: string;
}

const TEXT_FALLBACK = { dark: '#9aa4bd', light: '#5c6478' };
const SPLIT_FALLBACK = { dark: '#2b3550', light: '#e5e9f2' };
const SURFACE_FALLBACK = { dark: '#1a2236', light: '#ffffff' };
const SURFACE_TEXT_FALLBACK = { dark: '#eef1f8', light: '#1c2030' };
export const CATEGORY_PALETTE = [
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

/** 一次性读取当前主题的图表配色快照（调用方在需要时重新取值以跟随主题变化） */
export function snapshotChartTheme(): ChartThemeSnapshot {
  const isDark =
    typeof document !== 'undefined'
      ? document.documentElement.dataset.theme === 'dark'
      : false;
  const cs =
    typeof document !== 'undefined' ? getComputedStyle(document.documentElement) : null;
  const pick = (varName: string, fallback: { dark: string; light: string }) => {
    const v = cs?.getPropertyValue(varName).trim();
    if (v) return v;
    return isDark ? fallback.dark : fallback.light;
  };
  let chartText = pick('--dv-on-surface-variant', TEXT_FALLBACK);
  let chartSplit = pick('--dv-outline', SPLIT_FALLBACK);
  let chartSurface = pick('--dv-surface', SURFACE_FALLBACK);
  const wallpaperOn =
    typeof document !== 'undefined' && document.documentElement.dataset.wallpaper === 'on';
  // 2.13.0：玻璃由 Theme V2 风格（data-theme-style='glass'）驱动，深色下启用霓虹图表
  const style =
    typeof document !== 'undefined'
      ? (document.documentElement.dataset.themeStyle ?? 'classic')
      : 'classic';
  const glassOn = isDark && style === 'glass';
  let expense: string = GLASS_CHART.expense;
  let income: string = GLASS_CHART.income;
  let categoryPalette: string[] = CATEGORY_PALETTE;
  let tooltipBg = pick('--dv-surface', SURFACE_FALLBACK);
  let tooltipBorder = chartSplit;
  let tooltipText = pick('--dv-on-surface', SURFACE_TEXT_FALLBACK);
  if (glassOn) {
    chartText = 'rgba(255, 255, 255, 0.72)';
    chartSplit = 'rgba(255, 255, 255, 0.12)';
    categoryPalette = GLASS_CATEGORY_PALETTE;
    tooltipBg = 'rgba(13, 13, 16, 0.92)';
    tooltipBorder = 'rgba(255, 255, 255, 0.12)';
    tooltipText = 'rgba(255, 255, 255, 0.9)';
  } else {
    const exp = cs?.getPropertyValue('--dv-expense').trim();
    const inc = cs?.getPropertyValue('--dv-income').trim();
    expense = exp || GLASS_CHART.expense;
    income = inc || GLASS_CHART.income;
    // 浅色玻璃：浅色半透明 Surface Tooltip
    if (style === 'glass') tooltipBg = 'rgba(255, 255, 255, 0.9)';
  }
  return {
    isDark,
    chartText,
    chartSplit,
    chartSurface,
    wallpaperOn,
    glassOn,
    expense,
    income,
    categoryPalette,
    tooltipBg,
    tooltipBorder,
    tooltipText,
  };
}

/** 统一 Tooltip 主题（2.13.0：读 Token 而非硬编码 #fff/#000；模块图表全部复用）。
 *  triggerOn:'click'：点击显示（本 ECharts/WebView 组合下 dispatchAction showTip 在
 *  triggerOn:'none' 时无法渲染，因此保留原生点击显示）。enterable:false → ECharts 自动
 *  pointer-events:none，Tooltip 面板不拦截后续点击（同一数据再点/空白关闭才能生效）。
 *  关闭（同点/空白/外部/滚动/切月/切页）统一由 use-module-chart 的
 *  dispatchAction(hideTip) + document 级 pointer 监听完成。 */
export function chartTooltipOption(t: ChartThemeSnapshot, trigger: 'axis' | 'item' = 'axis') {
  return {
    trigger,
    triggerOn: 'click',
    enterable: false,
    backgroundColor: t.tooltipBg,
    borderColor: t.tooltipBorder,
    borderWidth: 1,
    textStyle: { color: t.tooltipText, fontSize: 12 },
    extraCssText:
      'border-radius: 10px; box-shadow: 0 4px 16px rgba(0,0,0,0.12); padding: 6px 10px;',
  };
}