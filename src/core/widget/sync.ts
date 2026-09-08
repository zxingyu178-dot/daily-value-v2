/**
 * Daily Value v2 - Widget 数据同步（Phase 7B-1）
 *
 * 唯一入口 syncWidgetSnapshot：从 billStore 计算当前月度摘要
 * → WidgetBridge.saveSnapshot → Native refreshAllWidgets。
 *
 * 触发场景（由 initWidgetSync 统一编排）：
 *   Bill add / update / remove
 *   Recurring 生成 Bill（runRecurringAndSync 返回 totalGenerated > 0）
 *   App bootstrap 数据 ready
 *   App resume 重新生成 Recurring 以后
 *
 * Widget 是 Bill 数据的"只读投影"，只保存派生摘要，不保存原始账单。
 */
import { useBillStore } from '@/core/store/bill';
import { localDateKey } from '@/core/models/daily-value';
import { WidgetBridge, isWidgetSupported } from './widget-bridge';

export interface WidgetSnapshot {
  version: 1;
  generatedAt: number;
  monthKey: string;
  monthExpense: number;
  monthIncome: number;
  monthBalance: number;
}

let supportedCached: boolean | null = null;

async function checkSupported(): Promise<boolean> {
  if (supportedCached === null) {
    supportedCached = await isWidgetSupported();
  }
  return supportedCached;
}

/**
 * 从 billStore 计算当前月度摘要并推送到 Native Widget。
 * 非 Native 平台静默跳过。支持缓存：首次调用后内部 know supported 状态。
 */
export async function syncWidgetSnapshot(): Promise<void> {
  if (!(await checkSupported())) return;

  try {
    const billStore = useBillStore();
    await billStore.load();

    const monthKey = localDateKey().slice(0, 7);
    const summary = billStore.monthSummary(monthKey);

    const snapshot: WidgetSnapshot = {
      version: 1,
      generatedAt: Date.now(),
      monthKey,
      monthExpense: round2(summary.expense),
      monthIncome: round2(summary.income),
      monthBalance: round2(summary.income - summary.expense),
    };

    await WidgetBridge.saveSnapshot({ snapshot: JSON.stringify(snapshot) });
  } catch (err) {
    console.warn('[dv:widget] syncWidgetSnapshot failed:', err);
  }
}

let widgetSyncInitialized = false;

/**
 * 初始化 Widget 同步：在 billStore 变更时自动同步 snapshot。
 * 幂等（多次调用只注册一次）。
 *
 * 采用 Pinia $subscribe 监听 billStore 状态变化（add/update/remove/load 均触发），
 * 节流 500ms 避免高频写入。Native 不支持时静默跳过。
 *
 * 同时由 main.ts / orchestration.ts 在关键节点显式调用 syncWidgetSnapshot。
 */
export function initWidgetSync(): void {
  if (widgetSyncInitialized) return;
  widgetSyncInitialized = true;

  const billStore = useBillStore();
  let syncTimer: ReturnType<typeof setTimeout> | null = null;

  billStore.$subscribe(() => {
    if (syncTimer) clearTimeout(syncTimer);
    syncTimer = setTimeout(() => {
      void syncWidgetSnapshot();
    }, 500);
  });

  // 首次初始化时尝试同步一次（如果 Native 不支持则静默跳过）
  void syncWidgetSnapshot();
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}
