/**
 * Daily Value v2 - 周期记账编排层（Phase 7B-0）
 *
 * 定位：generator（纯逻辑）与 Pinia store 之间的统一数据同步边界。
 * generator 完成后将结果返回此处，由 orchestration 层决定是否强制 billStore reload，
 * 使 Accounting / Statistics / DailyValue 的 Pinia computed 立即响应。
 *
 * 不让 core generator import Vue/Pinia，保持 generator 可测试与可复用。
 */
import { runRecurringGeneration, throttle, type AllGenerateResult } from './generator';
import { useBillStore } from '@/core/store/bill';
import { syncWidgetSnapshot } from '@/core/widget/sync';

/**
 * 统一数据同步：generator 写 IDB 后，如果生成了新 Bill（totalGenerated > 0），
 * 强制 billStore.load(true) 重新从 IDB 拉取，使所有 Pinia computed 立即刷新。
 * 同时推送 Widget snapshot（Phase 7B-1）。
 *
 * RecurringPage 保存/启用、bootstrap、resume 均走此同一流程。
 */
export async function runRecurringAndSync(now: Date = new Date()): Promise<AllGenerateResult> {
  const result = await runRecurringGeneration(now);
  if (result.totalGenerated > 0) {
    await useBillStore().load(true);
  }
  // Phase 7B-Final：无论是否生成新 Bill，都刷新 Widget 快照，
  // 使启动/resume 后立即恢复当前月数据，避免跨月后 Widget 长期显示旧月数据。
  void syncWidgetSnapshot();
  return result;
}

let initialized = false;

/**
 * 初始化周期记账：App 启动立即补一次生成，并注册 resume 触发。
 * 幂等（多次调用只注册一次）。返回清理函数（卸载监听）。
 *
 * 从 generator.ts 迁移至此，改为调用 runRecurringAndSync（含 billStore 同步）。
 */
export function initRecurringGeneration(): () => void {
  if (initialized) return () => undefined;
  initialized = true;

  // bootstrap：立即补一次（不 await，避免阻塞首屏）
  void runRecurringAndSync();

  const trigger = throttle(() => {
    void runRecurringAndSync();
  }, 1000);

  const onVisibility = () => {
    if (document.visibilityState === 'visible') trigger();
  };
  const onFocus = () => trigger();

  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('focus', onFocus);

  // Capacitor App 前台 resume（原生）——尝试挂接，缺失则忽略
  let removeCapacitorListener: (() => void) | null = null;
  import('@capacitor/app')
    .then(({ App }) =>
      App.addListener('resume', () => trigger()).then((handle) => {
        removeCapacitorListener = () => handle.remove();
      }),
    )
    .catch(() => undefined);

  return () => {
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('focus', onFocus);
    if (removeCapacitorListener) removeCapacitorListener();
  };
}
