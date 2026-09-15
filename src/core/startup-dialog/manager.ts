/**
 * Daily Value v2 - 启动弹窗统一管理（2.15.0 Gate A）
 *
 * 禁止多个启动弹窗连续出现。启动流程 → 检查所有启动事件 → 排序优先级 → 只展示一个。
 *
 * 优先级（L1 → L4，高者先）：
 *   L1 强制更新（预留：接入强制更新通道后天然最高优先）
 *   L2 更新日志
 *   L3 权限提醒（仅当用户已开启自动记账但通知权限未授予）
 *   L4 自动账单提醒（有待确认候选）
 *
 * 纯函数 resolveNextStartupDialog 可单测（测试 5）。
 */

export type StartupDialogKind = 'release-notes' | 'permission-reminder' | 'autobill-reminder';

export interface StartupDialogInput {
  /** L2：当前版本更新日志未看过（升级安装且未读） */
  releaseNotesUnseen: boolean;
  /** L3 前置：自动记账总开关已开启 */
  autoBillEnabled: boolean;
  /** L3：系统通知监听权限已授予 */
  notificationAccessGranted: boolean;
  /** L4：待确认候选数量 */
  pendingCandidates: number;
}

/** 本阶段支持的最大弹窗数（为 1 提供可测约束） */
export const MAX_STARTUP_DIALOGS = 1;

/** 返回本启动唯一应展示的弹窗；无任何事件 → null */
export function resolveNextStartupDialog(input: StartupDialogInput): StartupDialogKind | null {
  // L1 强制更新：预留插槽（当前无强制更新通道）
  if (input.releaseNotesUnseen) return 'release-notes';
  // L3 权限提醒：仅用户主动开启自动记账但未授权时提醒（不打扰默认用户）
  if (input.autoBillEnabled && !input.notificationAccessGranted) return 'permission-reminder';
  // L4 自动账单提醒：有待确认候选
  if (input.pendingCandidates > 0) return 'autobill-reminder';
  return null;
}