/**
 * 2.10.8 版本更新日志判定（REL-01..05 逻辑层）
 * - REL-01 全新安装（迁移系统写入 meta[freshInstallRegistered]）：不自动显示。
 * - REL-02 升级安装（无 fresh 标记、lastSeen 未达当前版本）：自动显示。
 * - REL-03 点击「知道了」写入 lastSeen=当前版本：同版本不再自动显示。
 * - REL-04 更新到下一版本（lastSeen 为旧版本）：再次显示。
 * - 纯函数 shouldAutoShowReleaseNotes 覆盖 fresh/seen/无笔记 三种边界。
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { openDatabase } from '@/core/db/database';
import { useSettingsStore } from '@/core/store/settings';
import { META_FRESH_INSTALL_KEY } from '@/core/migration/manager';
import {
  shouldAutoShowReleaseNotes,
  maybeAutoShowReleaseNotes,
  markReleaseNotesSeen,
  CURRENT_VERSION,
  releaseNoteForVersion,
} from '@/core/release-notes';

const TEST_STORES = ['settings', 'meta'] as const;

async function resetDb(): Promise<void> {
  const db = await openDatabase();
  const tx = db.transaction(TEST_STORES, 'readwrite');
  for (const store of TEST_STORES) tx.objectStore(store).clear();
  await tx.done;
  localStorage.clear();
}

/** 写入「全新安装」标记（等价于迁移管理器初始化数据版本时写入的 meta key） */
async function markFreshInstall(): Promise<void> {
  const db = await openDatabase();
  await db.put('meta', { key: META_FRESH_INSTALL_KEY, value: true });
}

describe('shouldAutoShowReleaseNotes（纯函数）', () => {
  it('REL-01fresh 全新安装（未完成首启）不显示', () => {
    expect(
      shouldAutoShowReleaseNotes({
        currentVersion: CURRENT_VERSION,
        lastSeenVersion: undefined,
        firstLaunchDone: false,
      }),
    ).toBe(false);
  });

  it('REL-02 升级：未读过当前版本笔记 → 显示', () => {
    expect(
      shouldAutoShowReleaseNotes({
        currentVersion: CURRENT_VERSION,
        lastSeenVersion: undefined,
        firstLaunchDone: true,
      }),
    ).toBe(true);
    expect(
      shouldAutoShowReleaseNotes({
        currentVersion: CURRENT_VERSION,
        lastSeenVersion: '2.10.7', // 旧版本基线 → 相对 2.10.8 是新版本
        firstLaunchDone: true,
      }),
    ).toBe(true);
  });

  it('REL-03 已读过当前版本 → 不再显示', () => {
    expect(
      shouldAutoShowReleaseNotes({
        currentVersion: CURRENT_VERSION,
        lastSeenVersion: CURRENT_VERSION,
        firstLaunchDone: true,
      }),
    ).toBe(false);
  });

  it('REL-04 当前版本没有笔记（新版本尚未发布时）→ 不显示', () => {
    expect(releaseNoteForVersion('2.10.9')).toBeUndefined();
    expect(
      shouldAutoShowReleaseNotes({
        currentVersion: '2.10.9',
        lastSeenVersion: '2.10.8',
        firstLaunchDone: true,
      }),
    ).toBe(false);
  });
});

describe('maybeAutoShowReleaseNotes / markReleaseNotesSeen（store 层）', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('REL-01 全新安装（存在 freshInstallRegistered 标记）：不自动显示', async () => {
    await resetDb();
    await markFreshInstall();
    const show = await maybeAutoShowReleaseNotes();
    expect(show).toBe(false);
  });

  it('REL-02 升级安装（无 fresh 标记、未读过）→ 自动显示', async () => {
    await resetDb();
    const settings = useSettingsStore();
    await settings.update({ lastSeenReleaseNotesVersion: undefined });
    const show = await maybeAutoShowReleaseNotes();
    expect(show).toBe(true);
  });

  it('REL-03 点击「知道了」后：同版本不再自动显示', async () => {
    await resetDb();
    expect(await maybeAutoShowReleaseNotes()).toBe(true);
    await markReleaseNotesSeen();
    const settings = useSettingsStore();
    expect(settings.settings?.lastSeenReleaseNotesVersion).toBe(CURRENT_VERSION);
    expect(await maybeAutoShowReleaseNotes()).toBe(false);
  });

  it('REL-04 REL-03 后再回到旧 lastSeen 语义（模拟下一版）：重新显示', async () => {
    await resetDb();
    await markReleaseNotesSeen();
    expect(await maybeAutoShowReleaseNotes()).toBe(false);
    // 升级到含新笔记的版本后 lastSeen 仍是旧版本 → 再显示（判定依赖真实存储在下次升级时由 markReleaseNotesSeen 推进）
    expect(
      shouldAutoShowReleaseNotes({
        currentVersion: CURRENT_VERSION,
        lastSeenVersion: '2.10.7',
        firstLaunchDone: true,
      }),
    ).toBe(true);
  });
});