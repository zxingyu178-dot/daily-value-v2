/**
 * 记账页时间线月份定位（纯函数，便于单测）。
 *
 * 需求：切换月份后，对应月份第一条记录必须位于时间线可视区域顶部。
 * 问题：目标月份越接近最老数据，其下方内容越少，浏览器只能滚到最大位置，
 *       导致目标月份首条记录无法置顶。
 * 方案：精确计算 scrollTop（目标分组相对内容顶部的距离），
 *       并在时间线尾部补充动态 spacer（可滚动余量），
 *       保证任何月份都能被精确置顶。
 */

export interface MonthScrollResult {
  /** 目标月份置顶所需的滚动量（px） */
  scrollTop: number;
  /** 时间线尾部需要补充的 spacer 高度（px，>=0） */
  spacerHeight: number;
}

/**
 * 计算让目标月份置顶所需的滚动量 + 尾部 spacer 高度。
 * @param containerHeight 时间线可视区高度（clientHeight）
 * @param contentHeight 时间线内容总高度（不含尾部 spacer，scrollHeight - spacer）
 * @param targetTop 目标月份第一条分组相对内容顶部的距离（offsetTop）
 */
export function computeMonthScroll(
  containerHeight: number,
  contentHeight: number,
  targetTop: number,
): MonthScrollResult {
  const scrollTop = Math.max(0, targetTop);
  // 需满足：scrollHeight - clientHeight >= scrollTop
  //        => (contentHeight + spacer) - containerHeight >= targetTop
  //        => spacer >= targetTop + containerHeight - contentHeight
  const spacerHeight = Math.max(0, targetTop + containerHeight - contentHeight);
  return { scrollTop, spacerHeight };
}
