/**
 * Daily Value v2 - 自动记账 通知桥（2.15.1 Gate B 真实接入）
 *
 * 真实链路：Android AutoBill 插件（通知使用权状态 / Native Pending Queue / 白名单同步）。
 * 安全兜底：非 Android（浏览器 / JSDOM 测试）→ Capacitor web 实现返回安全默认值，绝不抛异常。
 *
 * Gate B 边界：把真实 Notification 可靠送到 Web 层（拉取 + ack），
 * 不做支付解析 / 不生成 AutoBillCandidate（Gate C 完成）。
 */
import { Capacitor, registerPlugin } from '@capacitor/core';
import { services } from '@/core/services';
import type { IncomingNotification, AutobillIngestResult } from '@/core/services/types';

/** Settings 应用名 → Android packageName 映射（必须用包名判定，禁止用中文名） */
export const APP_PACKAGE_MAP: Record<string, string> = {
  支付宝: 'com.eg.android.AlipayGphone',
  微信支付: 'com.tencent.mm',
};

export interface AutoBillAccessStatus {
  granted: boolean;
  connected: boolean;
  pendingCount: number;
  lastConnectedAt?: number;
}

/** 原生暂存的最小通知记录（正式用户界面不展示完整文本；仅诊断/后续 Gate C 消费） */
export interface NativeNotificationRecord {
  id: string;
  packageName: string;
  postTime: number;
  capturedAt: number;
  title: string;
  text: string;
  bigText: string;
  subText: string;
}

/** Capacitor Plugin 契约（与 AutoBillPlugin.java 一一对应；2.16.2 增加 pendingChanged 事件） */
interface AutoBillPluginDef {
  getAccessStatus(): Promise<AutoBillAccessStatus>;
  openAccessSettings(): Promise<void>;
  getPendingNotifications(): Promise<{ records: NativeNotificationRecord[] }>;
  acknowledgeNotifications(options: { ids: string[] }): Promise<{ removed: number }>;
  setEnabledPackages(options: { packages: string[] }): Promise<void>;
  requestRebind(): Promise<void>;
  /** Native Queue 有新内容（仅计数，不含文本；真实内容仍主动拉取） */
  addListener(
    eventName: 'pendingChanged',
    listenerFunc: (data: { pendingCount: number }) => void,
  ): Promise<{ remove: () => void }>;
}

export interface AutoBillPendingChangedPayload {
  pendingCount: number;
}

/** 非 Android（浏览器/JSDOM）安全兜底：全部返回默认值，不抛异常 */
const webFallback: AutoBillPluginDef = {
  getAccessStatus: async () => ({ granted: false, connected: false, pendingCount: 0 }),
  // Web 无系统「通知使用权」页面：明确失败，调用方提示（不允许假装成功）
  openAccessSettings: async () => {
    throw new Error('notification access settings not available on web');
  },
  getPendingNotifications: async () => ({ records: [] }),
  acknowledgeNotifications: async () => ({ removed: 0 }),
  setEnabledPackages: async () => undefined,
  requestRebind: async () => undefined,
  addListener: async () => ({ remove: () => undefined }), // web 兜底：无事件
};

const nativeAutoBill = registerPlugin<AutoBillPluginDef>('AutoBill', { web: () => webFallback });

/** 当前是否 Android 原生环境（Web 层据界面可用性） */
export function isNativeCapacityAvailable(): boolean {
  try {
    return Capacitor.getPlatform() === 'android';
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ *
 * 权限闭环（通知使用权 Notification Access）
 * ------------------------------------------------------------------ */

/** 通知使用权状态（granted/connected/pendingCount/lastConnectedAt） */
export async function getAccessStatus(): Promise<AutoBillAccessStatus> {
  try {
    return await nativeAutoBill.getAccessStatus();
  } catch {
    return { granted: false, connected: false, pendingCount: 0 };
  }
}

/**
 * 打开系统「通知使用权」页面（不是普通 App「允许通知」页面）。
 * @returns 是否成功发起跳转（OEM 不支持时 false）
 */
export async function openNotificationAccessSettings(): Promise<boolean> {
  try {
    await nativeAutoBill.openAccessSettings();
    return true;
  } catch {
    return false;
  }
}

/** 已授权但监听未连接时请求系统重绑 Listener */
export async function requestAutoBillRebind(): Promise<boolean> {
  try {
    await nativeAutoBill.requestRebind();
    return true;
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ *
 * Native Pending Queue 同步（拉取与 ack 分离：SyncService 解析成功后 ack；
 * 正式 UI 不展示原始文本）
 * ------------------------------------------------------------------ */

/** 拉取原生 Pending 记录（不 ack；由调用方处理完后 ackPendingNativeNotifications） */
export async function pullPendingNativeNotifications(): Promise<NativeNotificationRecord[]> {
  try {
    const res = await nativeAutoBill.getPendingNotifications();
    return res?.records ?? [];
  } catch {
    return [];
  }
}

/** 处理完成后 ack（幂等删除；失败保留 → 下次前台再读） */
export async function ackPendingNativeNotifications(ids: string[]): Promise<void> {
  if (!ids || ids.length === 0) return;
  try {
    await nativeAutoBill.acknowledgeNotifications({ ids });
  } catch {
    // ack 失败：下次拉取会再次读到（幂等导入语义），不阻塞
  }
}

/**
 * 订阅 Native pendingChanged 事件（Runtime 实时同步用）。
 * 事件只携带 pendingCount（不含通知文本）；返回取消订阅函数。
 * 非 Android 环境安全：注册不影响、无事件触发。
 */
export function addAutoBillPendingChangedListener(
  cb: (payload: AutoBillPendingChangedPayload) => void,
): () => void {
  let removed = false;
  let handle: { remove: () => void } | null = null;
  void nativeAutoBill
    .addListener('pendingChanged', (data) => {
      if (!removed) cb({ pendingCount: data?.pendingCount ?? 0 });
    })
    .then((h) => {
      handle = h;
    })
    .catch(() => {
      // web 兜底：无事件（不抛异常）
    });
  return () => {
    removed = true;
    void handle?.remove?.();
  };
}

/* ------------------------------------------------------------------ *
 * 白名单同步（Web Settings → 原生 SharedPreferences，第一行防线）
 * ------------------------------------------------------------------ */

/** 把用户开启的来源应用同步为 Android Enabled Packages（空 = 停止采集） */
export async function syncEnabledPackagesToNative(): Promise<void> {
  try {
    const settings = await services.settings.get();
    const apps = settings.autoBillAllowedApps ?? ['支付宝', '微信支付'];
    const packages = apps.map((a) => APP_PACKAGE_MAP[a]).filter((p): p is string => Boolean(p));
    await nativeAutoBill.setEnabledPackages({ packages });
  } catch {
    // 非 Android 兜底：静默
  }
}

/* ------------------------------------------------------------------ *
 * 来源白名单（JS 侧应用名匹配；与 Gate A 保持一致）
 * ------------------------------------------------------------------ */

const DEFAULT_ALLOWED_APPS = ['支付宝', '微信支付'];

/** 来源应用白名单（label 互含即匹配） */
export async function isAllowedSourceApp(sourceApp: string): Promise<boolean> {
  const settings = await services.settings.get();
  const allowed = settings.autoBillAllowedApps ?? DEFAULT_ALLOWED_APPS;
  return allowed.some((a) => sourceApp.includes(a) || a.includes(sourceApp));
}

/**
 * 统一通知消费入口（Gate A）：总开关关闭 / 不在白名单 → 不建候选（返回 null）；
 * 通过 → 解析 + 去重 + 生成待确认候选（绝不直接写正式账单）。
 * Gate B 阶段真实通知走 Native Queue → Web 拉取（见 pullPendingNativeNotifications），
 * 暂不调用本入口生成候选（正式解析在 Gate C）。
 */
export async function handleIncomingNotification(
  input: IncomingNotification,
): Promise<AutobillIngestResult | null> {
  const settings = await services.settings.get();
  if (!settings.autoBillEnabled) return null;
  if (!(await isAllowedSourceApp(input.sourceApp))) return null;
  return services.autoBill.ingest(input);
}

/** 模拟一条支付通知（开发/测试用） */
export function simulateNotification(
  sourceApp: string,
  rawText: string,
  postedAt?: number,
): Promise<AutobillIngestResult | null> {
  return handleIncomingNotification({ sourceApp, rawText, postedAt: postedAt ?? Date.now() });
}