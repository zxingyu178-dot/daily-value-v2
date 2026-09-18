/**
 * Daily Value v2 - 统计模块图表生命周期 + Tooltip 统一交互（2.12.0 / 2.13.0）
 *
 * 集中封装「持久 DOM + ECharts 实例」的稳定性模式，供 4 个大图模块复用：
 * - 容器从挂载到卸载始终存在（无数据仅 visibility 隐藏，不销毁 DOM），避免实例失联。
 * - onMounted 初始化；onActivated（KeepAlive 切回）重读主题 + 重绘 + resize。
 * - 统一 watch 指定的响应源（月份 / 数据 / 主题 revision）走同一刷新路径。
 * - onBeforeUnmount 释放实例 + 移除全局监听。
 *
 * Tooltip 移动端交互（2.13.0，全部在 use-module-chart 统一实现，模块组件不再逐图补）：
 *   A. 点击数据点/柱 → showTip 显示
 *   B. 再次点击同一数据 → hideTip 关闭（toggle）
 *   C. 点击图表真实空白（非 series）→ hideTip
 *   D. 点击模块标题/底部摘要 → window pointerdown 在容器外 → hideTip
 *   E. 点击页面其它区域 → 同上
 *   F. 上下滚动统计页（touchmove 位移 > 阈值）→ hideTip
 *   G. 切月份（watch 刷新）→ hideTip
 *   H. 切页面 / KeepAlive 失活（onDeactivated）→ hideTip
 *   I. 打开另一个图表 Tooltip → 各图共享 document 级事件，打开即自动收起前一图
 */
import type { Ref, WatchSource } from 'vue';
import { nextTick, onActivated, onBeforeUnmount, onDeactivated, onMounted, watch } from 'vue';
import type { EChartsCoreOption } from 'echarts/core';
import * as echarts from 'echarts/core';
import { ensureECharts } from './echarts-setup';
import { snapshotChartTheme, type ChartThemeSnapshot } from './use-chart-theme';
import { hasUsableChartSize, observeChartContainer } from './chart-responsive';

/** 识别「有效数据点击」：ECharts click 参数为 series 且带 dataIndex */
interface SeriesTap {
  seriesIndex: number;
  dataIndex: number;
}
const TAP_MOVE_THRESHOLD = 8; // px：超过则视为滚动，关闭 Tooltip（tap 抖动不误关）

export function useModuleChart(
  containerRef: Ref<HTMLElement | null>,
  buildOption: () => EChartsCoreOption,
  watchSources: Array<WatchSource | string | number | boolean>,
) {
  let chart: ReturnType<typeof echarts.init> | null = null;
  let theme: ChartThemeSnapshot = snapshotChartTheme();
  /** 最近一次 showTip 的数据点（用于「再点同一数据 = toggle 关闭」；null = 当前无 Tooltip） */
  let lastTap: SeriesTap | null = null;
  /** 「面板已开时容器内按下」所关闭的数据点与生效时间戳（供随后的 click 判断同点抑制） */
  let suppressNext: SeriesTap | null = null;
  let suppressUntil = 0;
  let touchStartY = 0;

  /* ---------- 核心：统一关闭 Tooltip ---------- */
  function hideTooltip() {
    // dispatchAction 可能不存在于测试桩/旧实例，一律可选调用
    chart?.dispatchAction?.({ type: 'hideTip' });
    lastTap = null;
  }

  function showTip(tap: SeriesTap) {
    chart?.dispatchAction?.({
      type: 'showTip',
      seriesIndex: tap.seriesIndex,
      dataIndex: tap.dataIndex,
    });
    lastTap = tap;
  }

  function isSameTap(a: SeriesTap, b: SeriesTap): boolean {
    return a.seriesIndex === b.seriesIndex && a.dataIndex === b.dataIndex;
  }

  function render() {
    theme = snapshotChartTheme();
    const el = containerRef.value;
    // v2.20.0 Gate A：容器不可用（display:none / 未布局，宽 < CHART_MIN_SIZE）时
    // 禁止初始化/写入（否则实例记住错误宽度）。由 ResizeObserver 在尺寸恢复后触发。
    if (!el || !hasUsableChartSize(el)) return;
    if (!chart) {
      try {
        chart = echarts.init(el, undefined, { renderer: 'svg' });
      } catch {
        chart = null;
        return;
      }
      bindChartEvents();
    }
    chart.setOption(buildOption(), true);
  }
  function resize() {
    chart?.resize();
  }
  function dispose() {
    chart?.dispose();
    chart = null;
    lastTap = null;
  }

  /* ---------- ECharts 内部点击：有效数据 toggle / 空白关闭 ---------- */
  function bindChartEvents() {
    chart?.on?.('click', (params: unknown) => {
      const p = params as {
        componentType?: string;
        seriesIndex?: number;
        dataIndex?: number;
        event?: { stop?: () => void };
      };
      const suppressHit = (tap: SeriesTap) => {
        if (suppressNext && isSameTap(suppressNext, tap) && Date.now() < suppressUntil) {
          suppressNext = null;
          // 同点第二次点击：保持关闭；ECharts 原生 axis 可能随后重弹，兜底再隐藏一次
          setTimeout(() => hideTooltip(), 0);
          return true;
        }
        suppressNext = null;
        return false;
      };
      if (p && p.componentType === 'series' && typeof p.dataIndex === 'number' && typeof p.seriesIndex === 'number') {
        const tap: SeriesTap = { seriesIndex: p.seriesIndex, dataIndex: p.dataIndex };
        if (suppressHit(tap)) return; // 「再点同一数据」：保持关闭
        if (lastTap && isSameTap(lastTap, tap)) {
          // 常规 toggle（未走 pointerdown 抑制路径时）
          p.event?.stop?.();
          setTimeout(() => hideTooltip(), 0);
        } else {
          showTip(tap);
        }
      } else {
        // 空白区域（grid/axis/legend 等非 series）→ 关闭
        if (suppressNext && Date.now() < suppressUntil) {
          suppressNext = null;
          setTimeout(() => hideTooltip(), 0);
          return;
        }
        hideTooltip();
      }
    });
  }

  /* ---------- 全局事件：容器外点击 / 滚动 统一关闭（各图实例独立监听，互不干扰） ---------- */
  function onDocPointerDown(e: PointerEvent) {
    const el = containerRef.value;
    if (!chart || !el) return;
    const t = e.target as Node | null;
    if (!t) return;
    if (el.contains(t)) {
      // 面板已开时，容器内任意按下先关（capture 先于 ECharts 命中：即使 Tooltip 面板
      // 拦截了第二次点击，也能在这里生效）。记录被关的数据点，供 click 阶段判断同点抑制。
      if (lastTap) {
        suppressNext = lastTap;
        suppressUntil = Date.now() + 400;
        hideTooltip();
      }
      return; // 容器内点击其余逻辑交给 ECharts click（避免“刚显示马上又被关闭”）
    }
    hideTooltip();
  }
  function onTouchStart(e: TouchEvent) {
    touchStartY = e.touches?.[0]?.clientY ?? 0;
  }
  function onTouchMove(e: TouchEvent) {
    const y = e.touches?.[0]?.clientY;
    if (typeof y === 'number' && Math.abs(y - touchStartY) > TAP_MOVE_THRESHOLD) {
      hideTooltip();
    }
  }

  /* ---------- v2.20.0 Gate A：ResizeObserver + 延迟初始化 ---------- */
  let stopObserve: (() => void) | null = null;
  let resizeTimer: ReturnType<typeof setTimeout> | null = null;
  /** 容器可用后渲染 + 测量；ResizeObserver 回调防抖（避免一帧多次 resize 抖动） */
  function runRender() {
    if (resizeTimer) clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      resizeTimer = null;
      render();
      resize();
    }, 16);
  }

  onMounted(() => {
    ensureECharts();
    render(); // 首次可用即渲染；不可用（隐藏）时由 observer 在尺寸恢复后接管
    stopObserve = observeChartContainer(containerRef.value, {
      onUsable: () => runRender(),
      onResize: () => runRender(),
    });
    // capture：即使事件在子元素被 stopPropagation，也能收到「容器外点击关闭」
    document.addEventListener('pointerdown', onDocPointerDown, true);
    document.addEventListener('touchstart', onTouchStart, { passive: true });
    document.addEventListener('touchmove', onTouchMove, { passive: true });
  });
  onActivated(() => {
    // KeepAlive 恢复：等两帧再渲染+resize，覆盖「布局完成晚于激活」的时序
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        render();
        resize();
      });
    });
  });
  onDeactivated(() => {
    hideTooltip();
  });
  watch(
    watchSources,
    async () => {
      await nextTick();
      hideTooltip(); // 切月份/数据/主题刷新前先收起旧 Tooltip
      render();
      resize();
    },
    { flush: 'post' },
  );
  onBeforeUnmount(() => {
    stopObserve?.();
    stopObserve = null;
    if (resizeTimer) clearTimeout(resizeTimer);
    document.removeEventListener('pointerdown', onDocPointerDown, true);
    document.removeEventListener('touchstart', onTouchStart);
    document.removeEventListener('touchmove', onTouchMove);
    dispose();
  });

  return { render, resize, theme: () => theme, hideTooltip };
}