/**
 * Daily Value v2 - 统计模块类型（2.12.0 Statistics Dashboard）
 *
 * 「我的统计模块」把统计页从两列小卡片升级为大图模块。
 * 第一版固定 4 个模块；显示顺序固定按 STATISTICS_MODULES 目录顺序，不支持拖拽排序。
 */
export type StatisticsModuleId =
  | 'daily-expense-trend'
  | 'income-expense-compare'
  | 'category-ranking'
  | 'cumulative-expense';

export interface StatisticsModuleMeta {
  id: StatisticsModuleId;
  /** 模块标题（模块头主标题） */
  title: string;
  /** 管理 Sheet 内说明文本 */
  desc: string;
}

/** 模块目录（顺序即显示顺序；默认全开，可在管理 Sheet 关闭） */
export const STATISTICS_MODULES: StatisticsModuleMeta[] = [
  { id: 'daily-expense-trend', title: '每日花费趋势', desc: '本月每日支出变化' },
  { id: 'income-expense-compare', title: '收入 / 支出对比', desc: '按天对比收入与支出' },
  { id: 'category-ranking', title: '分类支出排行', desc: '各分类支出金额从高到低' },
  { id: 'cumulative-expense', title: '累计消费趋势', desc: '本月累计支出上升过程' },
];

/** 默认统计模块（规范化兜底用：2.13.2 起至少保留 1 个） */
export const DEFAULT_STAT_MODULE_ID: StatisticsModuleId = 'daily-expense-trend';

/**
 * 2.13.2 统计模块规范化（Settings 字段兼容修复，纯函数）：
 * - 非数组（undefined / 旧结构）→ 恢复默认模块
 * - 删除未知 ID；去重；保持首次出现顺序（显示顺序仍由目录决定）
 * - 最终至少 1 项：空数组 / 全非法 → 恢复默认「每日花费趋势」，不整体回退四个
 * 不升级 IndexedDB schema，仅做 Settings 字段兼容修复。
 */
export function normalizeStatisticsModules(input: unknown): StatisticsModuleId[] {
  if (!Array.isArray(input)) return [DEFAULT_STAT_MODULE_ID];
  const valid = new Set<string>(STATISTICS_MODULES.map((m) => m.id));
  const seen = new Set<StatisticsModuleId>();
  const out: StatisticsModuleId[] = [];
  for (const id of input) {
    if (typeof id !== 'string' || !valid.has(id)) continue;
    const mid = id as StatisticsModuleId;
    if (seen.has(mid)) continue;
    seen.add(mid);
    out.push(mid);
  }
  return out.length > 0 ? out : [DEFAULT_STAT_MODULE_ID];
}