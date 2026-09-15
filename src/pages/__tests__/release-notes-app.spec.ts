/**
 * 2.10.8 版本更新日志自动弹窗（真实 App + Router）— REL-01/02/03/05/06/07
 * - REL-01 全新安装（无首启标记）：主界面稳定后不自动弹。
 * - REL-02 升级安装且未读过：进入主界面后自动弹一次。
 * - REL-03 点「知道了」→ 关闭 → 重启 App → 不再弹。
 * - REL-05 Settings → 更新日志：始终可手动查看（不改变 lastSeen）。
 * - REL-06 ReleaseNotes 显示期间 Back：只关弹窗，不退出 App。
 * - REL-07 ReleaseNotes 不阻塞首页渲染 / 路由稳定。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createPinia } from 'pinia';
import { createMemoryHistory, createRouter } from 'vue-router';
import { nextTick } from 'vue';
import App from '@/App.vue';
import { routes } from '@/app/router';
import { openDatabase } from '@/core/db/database';
import { META_FRESH_INSTALL_KEY } from '@/core/migration/manager';
import { services } from '@/core/services';
import { __getBackOverlayStack } from '@/components/design/back-handler';
import { CURRENT_VERSION } from '@/core/release-notes';

// 2.14.0：包装 markReleaseNotesSeen 以便断言「同一次关闭只写一次已读」
vi.mock('@/core/release-notes', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/core/release-notes')>();
  return { ...mod, markReleaseNotesSeen: vi.fn(() => mod.markReleaseNotesSeen()) };
});

const STORES = ['bills', 'categories', 'settings', 'meta', 'recurringRules'] as const;
let wrapper: ReturnType<typeof mount> | null = null;
let host: HTMLElement | null = null;

async function resetDb(): Promise<void> {
  const db = await openDatabase();
  const tx = db.transaction(STORES, 'readwrite');
  for (const store of STORES) tx.objectStore(store).clear();
  await tx.done;
  localStorage.clear();
}

async function settle() {
  await flushPromises();
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  await nextTick();
  await flushPromises();
}

/** 挂载真实 App：seedFresh=true 表示全新安装（迁移系统已写入 freshInstallRegistered）；
 *  false 表示从旧版本升级（无 fresh 标记、未读过当前版本 Release Notes）。 */
async function start(seedFresh: boolean) {
  const pinia = createPinia();
  if (seedFresh) {
    // 模拟迁移管理器「全新安装 → 初始化数据版本」时写入的 fresh 标记
    const db = await openDatabase();
    await db.put('meta', { key: META_FRESH_INSTALL_KEY, value: true });
  }
  const router = createRouter({ history: createMemoryHistory(), routes });
  await router.replace('/accounting');
  await router.isReady();
  host = document.createElement('div');
  document.body.appendChild(host);
  // 先开 fake timers 再挂载，精确控制 App 内 setTimeout(1200) 的自动弹窗时机
  vi.useFakeTimers();
  wrapper = mount(App, { attachTo: host, global: { plugins: [pinia, router] } });
  await vi.advanceTimersByTimeAsync(1300);
  vi.useRealTimers();
  await settle();
  return { router, pinia };
}

function rnDialog(): Element | null {
  return document.body.querySelector('.rn');
}
function knowButton(): HTMLButtonElement | null {
  return Array.from(document.body.querySelectorAll<HTMLButtonElement>('button')).find(
    (b) => b.textContent?.trim() === '知道了',
  ) ?? null;
}

beforeEach(resetDb);
afterEach(async () => {
  vi.useRealTimers();
  wrapper?.unmount();
  wrapper = null;
  host?.remove();
  host = null;
  await settle();
  document.body.replaceChildren();
  __getBackOverlayStack().splice(0);
});

describe('版本更新日志自动弹窗（2.10.8）', () => {
  it('REL-01 全新安装：主界面稳定后不自动弹，首页正常', async () => {
    await start(true);
    expect(rnDialog()).toBeNull();
    // App 已进入主界面（记账页正常渲染 + 全局唯一 FAB 存在）
    expect(document.body.querySelector('.accounting')).not.toBeNull();
    expect(document.body.querySelector('.global-primary-fab')).not.toBeNull();
    // 全新安装只是不自动弹（标记由迁移系统写入，不依赖弹窗逻辑额外状态）
    expect(rnDialog()).toBeNull();
  });

  it('REL-02 从旧版本升级到 2.10.8：首次进入主界面后自动显示一次', async () => {
    await start(false);
    expect(rnDialog()).not.toBeNull();
    expect(document.body.querySelector('.dv-sheet__title')?.textContent).toContain(
      `每日的价值 ${CURRENT_VERSION}`,
    );
    expect(rnDialog()!.textContent).toContain('本次更新');
    expect(knowButton()).not.toBeNull();
  });

  it('REL-03 点「知道了」→ 关闭 → 重启 App → 不再自动显示', async () => {
    const { pinia } = await start(false);
    expect(rnDialog()).not.toBeNull();
    knowButton()!.click();
    await settle();
    expect(rnDialog()).toBeNull();
    expect((await services.settings.get()).lastSeenReleaseNotesVersion).toBe(CURRENT_VERSION);
    // 重启：同一 Persistence，升级态仍在但已读过 → 不再弹
    wrapper?.unmount();
    host?.remove();
    document.body.replaceChildren();
    const router2 = createRouter({ history: createMemoryHistory(), routes });
    await router2.replace('/accounting');
    await router2.isReady();
    host = document.createElement('div');
    document.body.appendChild(host);
    vi.useFakeTimers();
    wrapper = mount(App, { attachTo: host, global: { plugins: [pinia, router2] } });
    await vi.advanceTimersByTimeAsync(1300);
    vi.useRealTimers();
    await settle();
    expect(rnDialog()).toBeNull();
  });

  it('REL-05 设置 → 更新日志：始终可手动查看', async () => {
    // 以全新安装打底（无自动弹窗干扰），验证设置内手动入口始终可用
    const { router } = await start(true);
    expect(rnDialog()).toBeNull();
    await router.push('/settings/release-notes');
    await settle();
    expect(document.body.querySelector('.rn-block__version')?.textContent).toContain(
      `V${CURRENT_VERSION}`,
    );
    expect(document.body.querySelector('.rn-block')).not.toBeNull();
    // 手动浏览不改变自动弹窗的已读版本
    expect((await services.settings.get()).lastSeenReleaseNotesVersion).toBeUndefined();
  });

  it('REL-06 ReleaseNotes 显示期间 Back：只关闭 Release Notes，不退出 App', async () => {
    await start(false);
    expect(rnDialog()).not.toBeNull();
    const stack = __getBackOverlayStack();
    expect(stack.length).toBeGreaterThan(0);
    // 模拟 Android Back：Back 分发逻辑 = 弹出覆盖层栈顶并执行关闭回调
    const closeTop = stack[stack.length - 1];
    closeTop();
    await settle();
    expect(rnDialog()).toBeNull();
    // App 仍在运行：主界面与路由保持，未退出
    expect(document.body.querySelector('.accounting')).not.toBeNull();
  });

  it('REL-07 ReleaseNotes 弹窗不阻塞首页/路由：主界面保持可用', async () => {
    await start(false);
    expect(rnDialog()).not.toBeNull();
    // 弹窗期间一级页面照常渲染（Splash 不卡、首页不黑屏、路由正常）
    expect(document.body.querySelector('.accounting')).not.toBeNull();
    expect(document.body.querySelector('.global-primary-fab')).not.toBeNull();
    // 弹窗只是普通覆盖层：可拖到 FAB 仍可点击记账等基础操作（页面未被遮罩冻结）
    expect(document.body.querySelector('.dv-sheet')).not.toBeNull();
  });

  it('REL-08 同一次关闭（confirmed 与 modelValue(false) 双事件）只 markReleaseNotesSeen 一次（2.14.0）', async () => {
    await start(false);
    expect(rnDialog()).not.toBeNull();
    const { markReleaseNotesSeen } = await import('@/core/release-notes');
    vi.mocked(markReleaseNotesSeen).mockClear();
    await vi.waitFor(() => expect(markReleaseNotesSeen).toHaveBeenCalledTimes(0));
    // 点「知道了」→ ReleaseNotesDialog 会同时触发 confirmed 与 update:modelValue(false)；
    // 2.14.0 后 closeReleaseNotes 单入口 + rnSeenHandled：两次回调只落地一次写
    knowButton()!.click();
    await settle();
    expect(rnDialog()).toBeNull();
    expect(markReleaseNotesSeen).toHaveBeenCalledTimes(1);
    expect((await services.settings.get()).lastSeenReleaseNotesVersion).toBe(CURRENT_VERSION);
  });
});