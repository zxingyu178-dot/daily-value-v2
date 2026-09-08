/**
 * Daily Value v2 - WidgetBridge Capacitor 本地插件 Web 侧接口（Phase 7B-1）
 *
 * 对应 Native：WidgetBridgePlugin.java（@CapacitorPlugin(name = "WidgetBridge")）
 * 提供三个方法：saveSnapshot / refreshWidgets / isSupported
 *
 * 非 addJavascriptInterface，走正式 Capacitor plugin 通道。
 */
import { registerPlugin } from '@capacitor/core';
import { Capacitor } from '@capacitor/core';

export interface SaveSnapshotOptions {
  snapshot: string;
}

export interface SaveSnapshotResult {
  saved: boolean;
}

export interface IsSupportedResult {
  supported: boolean;
}

export interface WidgetBridgePlugin {
  saveSnapshot(options: SaveSnapshotOptions): Promise<SaveSnapshotResult>;
  refreshWidgets(): Promise<void>;
  isSupported(): Promise<IsSupportedResult>;
}

const WidgetBridge = registerPlugin<WidgetBridgePlugin>('WidgetBridge');

export { WidgetBridge };

/**
 * 是否在原生平台且 Widget 插件可用。
 * Web 环境直接返回 false，syncWidgetSnapshot 会静默跳过。
 */
export async function isWidgetSupported(): Promise<boolean> {
  if (!Capacitor.isNativePlatform()) return false;
  try {
    const { supported } = await WidgetBridge.isSupported();
    return supported;
  } catch {
    return false;
  }
}
