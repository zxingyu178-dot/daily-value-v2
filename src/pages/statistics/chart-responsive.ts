/**
 * DailyValue v2.20.0 Gate A - 图表响应式统一基础设施
 *
 * 根因（真机统计图只有左侧 1/3 宽）：
 * - ECharts 在容器隐藏（display:none / v-show=false / 页面尚未布局完成）时被 init，
 *   此时 clientWidth≈0，实例记住错误宽度，之后从不重新测量 → 图表挤在左侧一小条。
 * - 原实现只在 mounted/activated/数据变化时 resize，没有监听容器真实尺寸变化。
 *
 * 本模块统一解决：
 * 1. hasUsableChartSize：容器宽高足够才允许初始化（<32 视为不可用）。
 * 2. observeChartContainer：ResizeObserver 监听真实 container，
 *   尺寸/可见性变化（含 display:none → visible、KeepAlive、切 tab、WebView 延迟布局）
 *   一律回调；回调方按需 render+resize（主保障）。
 * 3. 显式 LayoutRefresher（第二层保险）：页面级切换动作（月↔年等）主动触发一次 refresh。
 * 4. calculateAxisInterval：横轴标签自动步长，18/31 天也只显示约 6~8 个易读标签，
 *    不再出现「18 个日期全叠字」。
 */
export const CHART_MIN_SIZE = 32;

/** 容器是否达到可初始化/可 resize 的尺寸（display:none / 未布局时为 false） */
export function hasUsableChartSize(el: HTMLElement | null | undefined): boolean {
  if (!el) return false;
  const w = el.clientWidth;
  const h = el.clientHeight;
  return w >= CHART_MIN_SIZE && h >= CHART_MIN_SIZE;
}

type Unobserve = () => void;

/**
 * 监听图表容器真实尺寸（ResizeObserver）。
 * - size 从不可用 → 可用（0 → 真实宽高）时回调 onUsable。
 * - 可用尺寸变化时回调 onResize（携带最新宽高）。
 * - 返回取消订阅函数；创建时若已可用立即触发一次 onResize（幂等，调用方自行防抖）。
 * - 环境无 ResizeObserver 时（老 WebView/测试桩）：依赖调用方显式 refresh 兜底，
 *   创建时仍做一次「可用检查 → onUsable」。
 */
export function observeChartContainer(
  el: HTMLElement | null | undefined,
  handlers: {
    onUsable?: () => void;
    onResize?: (width: number, height: number) => void;
  },
): Unobserve {
  if (!el) return () => {};
  const { onUsable, onResize } = handlers;
  let usableFired = false;
  const RO: typeof ResizeObserver | undefined =
    typeof ResizeObserver !== 'undefined' ? ResizeObserver : undefined;

  if (!RO) {
    // 无 ResizeObserver 环境：至少做一次可用检查；之后依赖页面显式 refresh
    if (hasUsableChartSize(el)) {
      onUsable?.();
      onResize?.(el.clientWidth, el.clientHeight);
    }
    return () => {};
  }

  const ro = new RO((entries) => {
    const entry = entries[0];
    if (!entry) return;
    const w = entry.contentRect?.width ?? el.clientWidth;
    const h = entry.contentRect?.height ?? el.clientHeight;
    if (w >= CHART_MIN_SIZE && h >= CHART_MIN_SIZE) {
      if (!usableFired) {
        usableFired = true;
        onUsable?.();
      }
      onResize?.(w, h);
    } else {
      // 尺寸回落到不可用（display:none 等）：下次恢复后重新按 Usable 流程走
      usableFired = false;
    }
  });
  ro.observe(el);
  // 创建时若已可见，主动补一次（RO 首次回调也会来，这里保证不依赖观察时序）
  if (hasUsableChartSize(el)) {
    if (!usableFired) {
      usableFired = true;
      onUsable?.();
    }
    onResize?.(el.clientWidth, el.clientHeight);
  }
  return () => {
    try {
      ro.disconnect();
    } catch {
      /* ignore */
    }
  };
}

/**
 * 横轴标签步长（interval）：目标是任何点数都只显示约 targetLabels 个易读标签。
 * - pointCount <= targetLabels：全部显示（interval 0）。
 * - 否则按「每标签约 labelWidthPx 像素」与「目标标签数」双约束取较大步长，
 *   保证标签既不叠字、也不过多；调用方可配 showMaxLabel 保留末位。
 * 例：18 天 → 2 天显示 1 个（约 9 个标签）；31 天 → 间隔 4（约 7 个标签）；12 月 → 0 或 1。
 */
export function calculateAxisInterval(
  pointCount: number,
  containerWidth: number,
  targetLabels = 7,
  labelWidthPx = 30,
): number {
  if (!Number.isFinite(pointCount) || pointCount <= 0) return 0;
  if (pointCount <= targetLabels) return 0;
  const width = containerWidth > 0 ? containerWidth : 360;
  const fitByWidth = Math.max(1, Math.floor(width / Math.max(1, labelWidthPx)));
  const byWidth = Math.max(0, Math.ceil(pointCount / fitByWidth) - 1);
  const byCount = Math.max(0, Math.ceil(pointCount / targetLabels) - 1);
  return Math.max(byWidth, byCount);
}

/** 由 interval 计算实际可见标签数（约 <= targetLabels+1，含首尾） */
export function labelCountForInterval(pointCount: number, interval: number): number {
  if (pointCount <= 1) return pointCount;
  return Math.ceil(pointCount / (interval + 1));
}