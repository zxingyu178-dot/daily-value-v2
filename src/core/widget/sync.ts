/**
 * Daily Value v2 - Widget 数据同步（Phase 7B-1 / 2.18.0 Widget V2 Visual Refresh）
 *
 * 唯一入口 syncWidgetSnapshot：从 billStore 计算当前月度摘要 + Theme V2 视觉参数
 * → WidgetBridge.saveSnapshot → Native refreshAllWidgets。
 *
 * 触发场景（由 initWidgetSync 统一编排）：
 *   Bill add / update / remove
 *   Recurring 生成 Bill（runRecurringAndSync 返回 totalGenerated > 0）
 *   App bootstrap 数据 ready
 *   App resume 重新生成 Recurring 以后
 *   2.18.0 Widget V2：主题变化（light/dark / style / color / custom / auto 系统深浅）
 *   2.18.0 Widget V2：Currency 变化
 *
 * Widget 是 Bill 数据的"只读投影"，只保存派生摘要（不含原始账单文本）。
 * 2.18.0：Theme 单一事实来源在 Web —— Native 只消费计算好的
 * resolvedTheme / themeStyle / accentColor，不在 Android 复刻主题算法。
 */
import { useBillStore } from '@/core/store/bill';
import { useAppStore } from '@/core/store/app';
import { useSettingsStore } from '@/core/store/settings';
import { getActivePinia } from 'pinia';
import { localDateKey } from '@/core/models/daily-value';
import { themeAccents, type ThemeAccentId } from '@/theme/tokens';
import { deriveCustomAccent } from '@/theme/theme-v2';
import { WidgetBridge, isWidgetSupported } from './widget-bridge';

/**
 * 2.18.0 Widget Snapshot V2（version=2）：
 * - 在 V1 基础上新增 currency / resolvedTheme / themeStyle / accentColor。
 * - Native 按 version 渲染；version=1/缺失 → 兼容默认（dark/classic/品牌紫/¥）。
 */
export interface WidgetSnapshotV2 {
  version: 2;
  generatedAt: number;
  monthKey: string;
  monthExpense: number;
  monthIncome: number;
  monthBalance: number;
  currency: string;
  resolvedTheme: 'light' | 'dark';
  themeStyle: 'classic' | 'soft' | 'minimal' | 'glass';
  accentColor: string;
}

/** 2.18.0：计算当前实际生效的主题主色（accentColor），供 Native 直接消费。
 *  驻留单一事实源：预设 Theme Accent（明暗自适应 primary）/ 自定义 Custom Accent */
export function resolveWidgetAccent(
  themeColor: ThemeAccentId | 'custom',
  customThemeColor: string | undefined,
  resolvedTheme: 'light' | 'dark',
): string {
  if (themeColor === 'custom' && customThemeColor) {
    const derived = deriveCustomAccent(customThemeColor, resolvedTheme);
    if (derived) return derived.primary;
  }
  const accent = themeColor !== 'custom' ? themeAccents[themeColor] : undefined;
  return (accent ?? themeAccents.violet)[resolvedTheme].primary;
}

/** 2.18.0：组装 Widget Snapshot V2（纯逻辑，便于单测） */
export function buildWidgetSnapshotV2(input: {
  now: number;
  monthKey: string;
  expense: number;
  income: number;
  balance: number;
  currency: string;
  resolvedTheme: 'light' | 'dark';
  themeStyle: 'classic' | 'soft' | 'minimal' | 'glass';
  accentColor: string;
}): WidgetSnapshotV2 {
  return {
    version: 2,
    generatedAt: input.now,
    monthKey: input.monthKey,
    monthExpense: round2(input.expense),
    monthIncome: round2(input.income),
    monthBalance: round2(input.balance),
    currency: input.currency,
    resolvedTheme: input.resolvedTheme,
    themeStyle: input.themeStyle,
    accentColor: input.accentColor,
  };
}

let supportedCached: boolean | null = null;

async function checkSupported(): Promise<boolean> {
  if (supportedCached === null) {
    supportedCached = await isWidgetSupported();
  }
  return supportedCached;
}

/**
 * 从 billStore 计算当前月度摘要并推送 Native Widget（V2）。
 * 非 Native 平台静默跳过。支持缓存：首次调用后内部 know supported 状态。
 */
export async function syncWidgetSnapshot(): Promise<void> {
  if (!(await checkSupported())) return;

  try {
    const billStore = useBillStore();
    await billStore.load();

    const monthKey = localDateKey().slice(0, 7);
    const summary = billStore.monthSummary(monthKey);

    // 2.18.0 Widget V2：读取 App 主题（revision 驱动刷新）+ 设置（currency）
    const app = useAppStore();
    const settingsStore = useSettingsStore();
    const currency = settingsStore.settings?.currency ?? '¥';
    const resolvedTheme = app.resolvedTheme;
    const themeStyle = app.themeStyle ?? 'classic';
    const accentColor = resolveWidgetAccent(
      app.themeColor,
      app.customThemeColor,
      resolvedTheme,
    );

    const snapshot = buildWidgetSnapshotV2({
      now: Date.now(),
      monthKey,
      expense: summary.expense,
      income: summary.income,
      balance: summary.income - summary.expense,
      currency,
      resolvedTheme,
      themeStyle,
      accentColor,
    });

    await WidgetBridge.saveSnapshot({ snapshot: JSON.stringify(snapshot) });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[dv:widget] syncWidgetSnapshot failed:', err);
  }
}

let widgetSyncInitialized = false;
/** 记录已注册订阅的 Pinia 实例（生产单实例只注册一次；测试每次重建 pinia 可重新注册） */
let widgetSyncInitializedPinia: ReturnType<typeof getActivePinia> = undefined;

/**
 * 初始化 Widget 同步：在以下变化时自动同步 snapshot（统一 debounce 500ms）：
 *   - billStore 变更（add/update/remove/load；含 Recurring 生成 Bill）
 *   - appStore.themeRevision 变化（theme/themeColor/customThemeColor/themeStyle/
 *     auto 系统深浅切换全部自增该字段）
 *   - settings.currency 变化
 * 幂等：同一 Pinia 实例只注册一次（不同实例重新注册，便于测试隔离）。
 * Native 不支持时静默跳过。
 */
export function initWidgetSync(): void {
  const currentPinia = getActivePinia();
  if (widgetSyncInitialized && widgetSyncInitializedPinia === currentPinia) return;
  widgetSyncInitialized = true;
  widgetSyncInitializedPinia = currentPinia;

  const billStore = useBillStore();
  const appStore = useAppStore();
  const settingsStore = useSettingsStore();
  let lastThemeRevision = appStore.themeRevision;
  let lastCurrency = settingsStore.settings?.currency ?? '¥';

  let syncTimer: ReturnType<typeof setTimeout> | null = null;
  const scheduleSync = () => {
    if (syncTimer) clearTimeout(syncTimer);
    syncTimer = setTimeout(() => {
      void syncWidgetSnapshot();
    }, 500);
  };

  billStore.$subscribe(() => scheduleSync());
  // 2.18.0：主题 revision 变化（Light/Dark/Style/Color/Custom/Auto 系统深浅）
  appStore.$subscribe((_mutation, state) => {
    if (state.themeRevision !== lastThemeRevision) {
      lastThemeRevision = state.themeRevision;
      scheduleSync();
    }
  });
  // 2.18.0：Currency 变化
  settingsStore.$subscribe((_mutation, state) => {
    const cur = state.settings?.currency ?? '¥';
    if (cur !== lastCurrency) {
      lastCurrency = cur;
      scheduleSync();
    }
  });

  // 首次初始化时尝试同步一次（如果 Native 不支持则静默跳过）
  void syncWidgetSnapshot();
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}