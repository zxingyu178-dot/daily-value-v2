/**
 * Daily Value v2 - AutoBill Runtime（2.16.2）
 *
 * App 级统一实时同步 Runtime，职责：
 *   1. 首屏 Ready 后的初始同步（不阻塞 Splash，调用方在首屏后触发）
 *   2. App resume 后的同步（仅在此注册一次，页面不再各自注册）
 *   3. Native pendingChanged 事件后的实时同步（前台即时刷新，不轮询）
 *   4. 同步完成后刷新 Pinia AutoBillStore（AutoBillPage / Accounting 入口自动响应）
 *
 * 串行锁：Native 连续更新（支付成功 → 交易提醒 → 积分提醒）不会并发拉取/并发 ack/
 * 并发写 Candidate；只串行执行并在有新请求时补跑一次。
 *
 * 事件链路（原生）：Service upsert → app-private Broadcast → AutoBillPlugin
 * notifyListeners("pendingChanged", {pendingCount}) → addAutoBillPendingChangedListener
 * → syncAndRefreshAutoBill('event')。事件只带计数，真实内容仍主动拉取。
 */
import { useAutoBillStore } from '@/core/store/autobill';
import { syncAutoBillNotifications } from '@/feature/autobill/service/sync-service';
import { addAutoBillPendingChangedListener } from '@/feature/autobill/service/notification-bridge';

export type AutoBillSyncReason = 'initial' | 'resume' | 'event';

/** 串行锁：同步进行中只标记 rerun，不并发执行 */
let syncing = false;
let rerun = false;

async function runSyncOnce(): Promise<void> {
  try {
    await syncAutoBillNotifications();
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[AutoBill.Runtime] sync failed:', String(err));
  }
  try {
    const store = useAutoBillStore();
    await store.load();
    // 2.16.4：同步后联动刷新「通知使用权」状态（resume/事件回来即生效，无需重进页面）
    await store.refreshStatus();
  } catch {
    // store 刷新失败静默（下次触发再试）
  }
}

/** 串行入口：进行中 → 标记 rerun；空闲 → 执行（循环补跑） */
async function syncAndRefreshAutoBill(_reason: AutoBillSyncReason): Promise<void> {
  if (syncing) {
    rerun = true;
    return;
  }
  syncing = true;
  try {
    do {
      rerun = false;
      await runSyncOnce();
    } while (rerun);
  } finally {
    syncing = false;
  }
}

export interface AutoBillRuntimeHandle {
  /** 立即触发一次同步（首屏 Ready / 调试用） */
  syncNow(reason?: AutoBillSyncReason): void;
  /** 销毁 Runtime：移除全部监听 */
  dispose(): void;
}

/** 初始化 App 级 AutoBill Runtime（单例语义；App 生命周期一次） */
export function initAutoBillRuntime(): AutoBillRuntimeHandle {
  let disposed = false;
  let resumeHandle: { remove: () => void } | null = null;
  let eventOff: (() => void) | null = null;

  // ① 首屏 Ready 后的初始同步（调用方（main.ts）在 firstScreenReady 之后调用 syncNow）
  // ② App resume（仅注册一次；从支付宝/微信支付等返回也触发 resume）
  void import('@capacitor/app')
    .then(({ App }) => App.addListener('resume', () => syncAndRefreshAutoBill('resume')))
    .then((h) => {
      if (disposed) void h?.remove?.();
      else resumeHandle = h;
    })
    .catch(() => {
      // 非 Capacitor 环境：无 resume 事件
    });

  // ③ Native pendingChanged 事件（前台实时刷新，不轮询）
  eventOff = addAutoBillPendingChangedListener(() => {
    if (!disposed) void syncAndRefreshAutoBill('event');
  });

  return {
    syncNow(reason: AutoBillSyncReason = 'initial') {
      if (disposed) return;
      void syncAndRefreshAutoBill(reason);
    },
    dispose() {
      disposed = true;
      void resumeHandle?.remove?.();
      resumeHandle = null;
      eventOff?.();
      eventOff = null;
    },
  };
}