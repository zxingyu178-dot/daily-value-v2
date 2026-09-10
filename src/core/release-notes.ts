/**
 * Daily Value v2 - 正式 Release Notes（2.10.8）
 *
 * - 只写用户能理解的变化（不出现 KeepAlive / Teleport / 生命周期等开发术语）。
 * - 从正式加入本模块的版本开始记录，不补写历史小版本。
 * - 版本号与 package.json / build.gradle 保持同步（交付时一致性核对项之一）。
 *
 * 全新安装 / 升级安装判定（复用迁移系统，不另造框架）：
 * - 迁移管理器在「全新安装 → 初始化数据版本」时写入 meta[freshInstallRegistered]。
 * - 升级安装（dataVersion 已存在）不写该标记。
 * - 有该标记 = 全新安装 → 不自动弹；无该标记 = 升级安装 → 未读过当前版本则弹一次。
 */
import { openDatabase } from '@/core/db/database';
import { META_FRESH_INSTALL_KEY } from '@/core/migration/manager';
import { useSettingsStore } from '@/core/store/settings';

export interface ReleaseNoteEntry {
  version: string;
  title: string;
  items: string[];
}

export const RELEASE_NOTES: ReleaseNoteEntry[] = [
  {
    version: '2.10.8',
    title: '本次更新',
    items: [
      '新增账单长按删除：轻点编辑、长按删除',
      '日价项目支持长按删除或移出日价',
      '修复记账与日价新增界面串用问题',
      '新增版本更新日志：升级后自动展示一次，设置中可随时查看',
    ],
  },
];

/** 当前 App 版本（与版本文件同步；交付一致性核对项） */
export const CURRENT_VERSION = '2.10.8';

/** 最新一条 Release Notes（自动弹窗使用） */
export const LATEST_RELEASE_NOTES: ReleaseNoteEntry | undefined = RELEASE_NOTES[0];

/** 按版本取 Release Notes */
export function releaseNoteForVersion(version: string): ReleaseNoteEntry | undefined {
  return RELEASE_NOTES.find((r) => r.version === version);
}

export interface ReleaseNotesCheckInput {
  /** 当前版本 */
  currentVersion: string;
  /** settings.lastSeenReleaseNotesVersion */
  lastSeenVersion: string | undefined;
  /** 是否已完成过首次启动（Fresh Install 未完成时不自动弹） */
  firstLaunchDone: boolean;
}

/**
 * 自动展示判定（纯函数）：
 * 只有「升级安装」且「该版本笔记未被看过」才显示；全新安装不弹。
 */
export function shouldAutoShowReleaseNotes(input: ReleaseNotesCheckInput): boolean {
  if (!input.firstLaunchDone) return false; // 全新安装：不弹更新日志
  if (!releaseNoteForVersion(input.currentVersion)) return false; // 当前版本无笔记
  return input.lastSeenVersion !== input.currentVersion;
}

/**
 * 启动完成后调用（幂等、失败静默）：判定是否需要自动展示。
 * 全新安装（迁移系统写过的 freshInstallRegistered 标记）→ 不自动弹；
 * 升级安装且未读过当前版本 → 返回 true（由 App 层挂载 ReleaseNotesDialog）。
 * 注意：本函数不写 lastSeenReleaseNotesVersion —— 只有用户点击「知道了」/主动关闭才写。
 */
export async function maybeAutoShowReleaseNotes(): Promise<boolean> {
  try {
    if (await isFreshInstall()) return false;
    const settings = useSettingsStore();
    await settings.load(true);
    return shouldAutoShowReleaseNotes({
      currentVersion: CURRENT_VERSION,
      lastSeenVersion: settings.settings?.lastSeenReleaseNotesVersion,
      firstLaunchDone: true,
    });
  } catch {
    // 更新日志加载失败不能阻塞进入首页
    return false;
  }
}

/** 全新安装判定：迁移管理器初始化数据版本时写入 meta 标记；升级安装没有该标记 */
async function isFreshInstall(): Promise<boolean> {
  try {
    const db = await openDatabase();
    return Boolean(await db.get('meta', META_FRESH_INSTALL_KEY));
  } catch {
    // 读失败按升级语义处理（至多多显示一次，不阻塞启动）
    return false;
  }
}

/** 用户点击「知道了」/主动关闭自动弹窗后，记录已读版本（同版本不再自动出现） */
export async function markReleaseNotesSeen(): Promise<void> {
  try {
    const settings = useSettingsStore();
    await settings.update({ lastSeenReleaseNotesVersion: CURRENT_VERSION });
  } catch {
    // 静默失败：不影响主流程
  }
}