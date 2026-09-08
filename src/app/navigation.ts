/**
 * Daily Value v2 - 一级业务导航定义（唯一事实来源）
 *
 * 产品最终信息架构：一级业务页面只有三个 —— 统计 / 记账 / 日价。
 * - 记账页即 App 默认首页（根路由 `/` → `/accounting`），位于中间并默认选中。
 * - 顺序固定：统计在左、记账在中、日价在右。
 * - /settings 与 /design 不属于一级业务导航（Settings 经右上角菜单进入，Design 为开发验收工具页）。
 *
 * 注意：本骨架仅做导航与架构纠偏；最终视觉与横向手势交互在 Phase 3「记账主界面」实现。
 */

export const PRIMARY_NAV = [
  { path: '/statistics', label: '统计' },
  { path: '/accounting', label: '记账' },
  { path: '/daily-value', label: '日价' },
] as const;

export type PrimaryNavPath = (typeof PRIMARY_NAV)[number]['path'];

/** 一级业务页面路由（用于决定是否显示一级导航） */
export const PRIMARY_ROUTES: readonly string[] = PRIMARY_NAV.map((item) => item.path);
