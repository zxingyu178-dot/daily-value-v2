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
import type { Settings } from '@/core/models/types';
import {
  resolveEnabledSources,
  packagesForSourceIds,
  sourceDefinition,
  sourceDefinitionForPackage,
} from '@/feature/autobill/source-registry';

/**
 * 2.17.0：来源定义唯一来自 Source Registry（禁止在此再维护业务列表）。
 * 旧 bridge 的 APP_PACKAGE_MAP 已移除，由 Registry 派生。
 */

export interface AutoBillAccessStatus {
  granted: boolean;
  connected: boolean;
  pendingCount: number;
  lastConnectedAt?: number;
}

/** 原生暂存的最小通知记录（正式用户界面不展示完整文本；仅诊断/后续 Gate C 消费） */
export interface NativeNotificationRecord {
  id: string;
  /** 2.17.2：系统通知 key（同一通知被系统更新时 key 不变；去重第一优先级信号） */
  notificationKey?: string;
  packageName: string;
  postTime: number;
  capturedAt: number;
  title: string;
  text: string;
  bigText: string;
  subText: string;
  /** 2.17.0：通知渠道 id（微信同包名下 聊天/支付/服务通知 的区分信号；可空） */
  channelId?: string;
}

/** Capacitor Plugin 契约（与 AutoBillPlugin.java 一一对应；2.16.2 增加 pendingChanged 事件） */
interface AutoBillPluginDef {
  getAccessStatus(): Promise<AutoBillAccessStatus>;
  openAccessSettings(): Promise<void>;
  getPendingNotifications(): Promise<{ records: NativeNotificationRecord[] }>;
  acknowledgeNotifications(options: { ids: string[] }): Promise<{ removed: number }>;
  setEnabledPackages(options: { packages: string[] }): Promise<void>;
  requestRebind(): Promise<void>;
  /** 2.17.0：查询候选来源包名安装状态（Android <queries> 声明，不申请 QUERY_ALL_PACKAGES） */
  getInstalledSources(options: { packages: string[] }): Promise<{
    results: { packageName: string; installed: boolean }[];
  }>;
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
  getInstalledSources: async () => ({ results: [] }), // web 兜底：未知安装状态
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

/**
 * 2.17.0：查询候选来源包名的安装状态（packageName → installed）。
 * Android 侧通过 <queries> 精确声明，不申请 QUERY_ALL_PACKAGES；
 * 仅用于把未安装来源在 UI 上灰显（不报错）。
 */
export async function queryInstalledSources(packages: string[]): Promise<Record<string, boolean>> {
  try {
    const res = await nativeAutoBill.getInstalledSources({ packages: packages ?? [] });
    const map: Record<string, boolean> = {};
    for (const r of res?.results ?? []) {
      map[r.packageName] = String(r.installed) === 'true' || r.installed === true;
    }
    return map;
  } catch {
    return {};
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
 * 来源白名单同步（Web Settings → 原生 SharedPreferences；来源定义来自 Registry）
 * ------------------------------------------------------------------ */

/**
 * 2.17.0/2.17.1：把「用户意愿」同步到原生——返回原生应生效的包名白名单。
 * 2.17.1 P0：总开关语义修正。总开关 false/缺省 = 完全关闭 →
 *   packages = []（Native 停止接受新通知 + 清理 Pending Queue）。
 *   只有 autoBillEnabled = true 时，才按用户来源选择（resolveEnabledSources）计算包名。
 *   注意：本函数【不修改】用户来源偏好字段（autoBillEnabledSources / autoBillAllowedApps），
 *   总开关只控制「是否运行 / 是否采集」，关闭再开启后来源选择原样恢复。
 */
export async function syncEnabledPackagesToNative(): Promise<void> {
  try {
    const settings = await services.settings.get();
    const packages = enabledPackagesFromSettings(settings);
    await nativeAutoBill.setEnabledPackages({ packages });
  } catch {
    // 非 Android 兜底：静默
  }
}

/**
 * 2.17.1 P0：由 Settings 计算应同步给 Native 的包名白名单（纯函数，便于单测）。
 * - autoBillEnabled === false（含缺省）→ []（总开关关闭 = 停止采集 + 清理 Queue）
 * - autoBillEnabled === true → 按 resolveEnabledSources 计算有效来源包名
 * 入参允许部分 Settings（只需 AutoBill 相关字段；供测试与调用方传子集）。
 */
export function enabledPackagesFromSettings(
  settings: Pick<Settings, 'autoBillEnabled' | 'autoBillEnabledSources' | 'autoBillAllowedApps'> | undefined | null,
): string[] {
  if (!settings?.autoBillEnabled) return [];
  const ids = resolveEnabledSources(settings.autoBillEnabledSources, settings.autoBillAllowedApps);
  return packagesForSourceIds(ids);
}

/** 2.17.0：当前开启的来源 id 数组（Registry 解析，兼容旧字段） */
export async function enabledSourceIds(): Promise<string[]> {
  const settings = await services.settings.get();
  return resolveEnabledSources(settings.autoBillEnabledSources, settings.autoBillAllowedApps);
}

/**
 * Web 侧白名单判定（Gate A 语义）：来源包名是否开启。
 * 2.17.0：由 Registry 包名反查支持的来源定义，再对照开启来源。
 */
export async function isAllowedSourcePackage(packageName: string): Promise<boolean> {
  const def = sourceDefinitionForPackage(packageName);
  if (!def) return false;
  const ids = await enabledSourceIds();
  return ids.includes(def.id);
}

/**
 * 2.17.0（兼容保留）：旧统一入口按 sourceApp 应用中文名判定白名单。
 * 仅当该名称能被 Registry 解析为已开启来源时才允许。
 */
export async function isAllowedSourceApp(sourceApp: string): Promise<boolean> {
  const ids = await enabledSourceIds();
  const def = [...ids]
    .map((id) => sourceDefinition(id))
    .find((d) => d && (sourceApp.includes(d.label) || d.label.includes(sourceApp)));
  return Boolean(def);
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