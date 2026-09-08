/**
 * Daily Value v2 - v1 遗留数据读取器（只读）
 *
 * 用途：迁移设计 / 调试对照。启动时若检测到 v1 数据存在，由迁移层调用本模块
 * 读取原始数据并转换为 v2 模型（转换逻辑在 Phase 2 落地）。
 * 注意：本模块不改写任何 v1 数据。
 *
 * v1 存储布局（源自 d:\daily 源码分析，详见 V1_DATA_ANALYSIS.md）：
 * - localStorage 键：
 *   item-value-calculator:v1  日价物品
 *   dv-ledger:v1              账目（Bill）
 *   dv-settings:v1            设置
 *   dv-ledger-cats:v1         自定义分类
 *   dv-ledger-tpl:v1          记账模板
 *   dv-recurring:v1 / dv-recurring-pending:v1  周期
 *   dv-budget:v1 / dv-budget-alert:v1          预算（不迁移）
 *   dv-wallpaper:v1 / dv-wallpaper-params:v1   壁纸（不迁移）
 * - IndexedDB：dv-images / images（图片与壁纸 base64，不迁移）
 */

/** v1 localStorage 键常量 */
export const V1_KEYS = {
  items: 'item-value-calculator:v1',
  ledger: 'dv-ledger:v1',
  settings: 'dv-settings:v1',
  cats: 'dv-ledger-cats:v1',
  templates: 'dv-ledger-tpl:v1',
  recurring: 'dv-recurring:v1',
  recurringPending: 'dv-recurring-pending:v1',
} as const;

/** v1 账目原始结构（仅迁移分析用，勿在生产逻辑引用 v1 类型） */
export interface V1LedgerEntry {
  id: string;
  type: 'expense' | 'income' | 'transfer';
  amount: number;
  category?: string;
  emoji?: string;
  direction?: 'out' | 'in';
  note?: string;
  date: string; // yyyy-mm-dd
  timestamp?: number;
}

/** v1 日价物品原始结构 */
export interface V1Item {
  id?: string;
  name?: string;
  price?: number;
  purchaseDate?: string;
  note?: string;
  image?: string;
  tags?: string[];
  createdAt?: number;
}

/** 读取 v1 数据（同源 localStorage；升级后数据目录不变故可读） */
export function readV1Data() {
  const get = (key: string): unknown | undefined => {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : undefined;
    } catch {
      return undefined;
    }
  };
  return {
    items: get(V1_KEYS.items) as V1Item[] | undefined,
    ledger: get(V1_KEYS.ledger) as V1LedgerEntry[] | undefined,
    settings: get(V1_KEYS.settings) as Record<string, unknown> | undefined,
  };
}

/** 是否存在 v1 遗留数据 */
export function hasV1Data(): boolean {
  return Boolean(
    localStorage.getItem(V1_KEYS.items) || localStorage.getItem(V1_KEYS.ledger),
  );
}

/**
 * 核心 key 是否存在但 JSON 无法解析（数据损坏，Phase 3 前置修正 D）。
 * 防止"key 存在但 JSON 损坏 → reader 返回 undefined → 被当作 0 条数据 → 校验 0→0 通过
 * → dataVersion 误升级"的不安全路径。检测到损坏时必须由迁移管理器返回失败并进入安全页。
 */
export function hasV1ParseError(): boolean {
  const coreKeys: readonly string[] = [V1_KEYS.items, V1_KEYS.ledger];
  return coreKeys.some((key) => {
    const raw = localStorage.getItem(key);
    if (raw == null) return false;
    try {
      JSON.parse(raw);
      return false;
    } catch {
      return true;
    }
  });
}
