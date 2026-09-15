/**
 * 2.16.4 AUTOBILL-NAV：AutoBill 单路由 + 内部 Panel 状态机
 * - /autobill 唯一路由；ReviewTab ⇄ SettingsPanel 用 currentPanel（禁止 router 跳转）
 * - 内部切换不产生任何 Web History；Back 一次 = 退出模块到父级（或按一级页处理）
 * - 主页入口（Accounting banner）replace 进入；设置主页入口 push('/autobill?panel=settings')
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { nextTick } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import { createMemoryHistory, createRouter, type Router } from 'vue-router';
import { routes } from '@/app/router';
import { openDatabase } from '@/core/db/database';
import { IdbCategoryService } from '@/core/services/idb';
import AutoBillPage from '@/pages/autobill/AutoBillPage.vue';

const STORES = ['bills', 'categories', 'settings', 'meta', 'recurringRules', 'autoBillCandidates'] as const;

async function resetDb(): Promise<void> {
  const db = await openDatabase();
  const tx = db.transaction(STORES, 'readwrite');
  for (const s of STORES) tx.objectStore(s).clear();
  await tx.done;
  const catSvc = new IdbCategoryService();
  if ((await catSvc.list()).length === 0) {
    await catSvc.add({ name: '餐饮', emoji: '🍚', builtin: true, sort: 1 });
  }
}

async function makeRouter(): Promise<Router> {
  const router = createRouter({ history: createMemoryHistory(), routes });
  await router.push('/accounting');
  await router.isReady();
  return router;
}

function position(router: Router): number {
  return (router.options.history.state?.position as number | undefined) ?? 0;
}

async function settle() {
  await flushPromises();
  await new Promise<void>((r) => setTimeout(r, 0));
  await nextTick();
  await flushPromises();
}

beforeEach(async () => {
  await resetDb();
  setActivePinia(createPinia());
});

describe('AUTOBILL-NAV：单路由 + 内部 Panel（无路由历史）', () => {
  it('进入 /autobill 后反复 待确认⇄设置 20 轮：路由不变、History 位置不增长；Back 一次回 /accounting（主页入口 push 语义）', async () => {
    const router = await makeRouter();
    await router.push('/autobill'); // 主页入口：push（2.16.4 修复：replace 会把 /accounting 顶替掉，Back 无路可退）
    const base = position(router);

    const pinia = createPinia();
    const host = document.createElement('div');
    document.body.appendChild(host);
    const wrapper = mount(AutoBillPage, { attachTo: host, global: { plugins: [pinia, router] } });
    await settle();
    expect(router.currentRoute.value.path).toBe('/autobill'); // push 进入成功

    // 内部 panel 切换：纯状态，不产生历史
    for (let i = 0; i < 20; i += 1) {
      wrapper.find('.settings-entry').trigger('click'); // 审核 → 设置面板
      await nextTick();
      wrapper.findAll('.page__nav')[0].trigger('click'); // 设置 → 返回待确认
      await nextTick();
    }
    expect(router.currentRoute.value.path).toBe('/autobill');
    expect(position(router)).toBe(base); // 20 轮内部切换 0 历史污染

    // Back 一次退出模块 → 回到主页父级 /accounting（2.16.4 P1 验收）
    await router.back();
    await settle();
    expect(router.currentRoute.value.path).toBe('/accounting');

    wrapper.unmount();
    host.remove();
  });

  it('设置主页入口 push(/autobill?panel=settings) → 面板为设置；Back 回 /settings', async () => {
    const router = await makeRouter();
    await router.push('/settings');
    await router.push('/autobill?panel=settings');
    const base = position(router);

    const host = document.createElement('div');
    document.body.appendChild(host);
    const wrapper = mount(AutoBillPage, { attachTo: host, global: { plugins: [createPinia(), router] } });
    await settle();
    // query 初始化指向 SettingsPanel
    expect(wrapper.find('.access-row').exists()).toBe(true);
    expect(position(router)).toBe(base); // 进入设置未产生多余历史（本页为一级 push）

    await router.back(); // 一次 Back → 父级 Settings
    await settle();
    expect(router.currentRoute.value.path).toBe('/settings');
    wrapper.unmount();
    host.remove();
  });

  it('Back 一次退出 AutoBill 模块（不循环、不回另一 AutoBill 页）', async () => {
    const router = await makeRouter();
    await router.push('/autobill');
    await router.back();
    await settle();
    expect(router.currentRoute.value.path).toBe('/accounting');
    // 再次 back（一级页语义）不落入任何 AutoBill 路径
    await router.back();
    await settle();
    expect(['/autobill']).not.toContain(router.currentRoute.value.path);
  });

  it('Header 返回：设置面板 → 待确认（内部）；待确认 → 退出模块', async () => {
    const router = await makeRouter();
    await router.push('/autobill');

    const host = document.createElement('div');
    document.body.appendChild(host);
    const wrapper = mount(AutoBillPage, { attachTo: host, global: { plugins: [createPinia(), router] } });
    await settle();

    wrapper.find('.settings-entry').trigger('click'); // → 设置面板
    await nextTick();
    wrapper.find('.page__back').trigger('click'); // Header ‹：设置 → 待确认（内部，非路由）
    await nextTick();
    expect(router.currentRoute.value.path).toBe('/autobill');
    expect(wrapper.find('.seg').exists()).toBe(true); // 回到审核面板

    wrapper.find('.page__back').trigger('click'); // Header ‹：待确认 → 退出
    await settle();
    expect(router.currentRoute.value.path).toBe('/accounting');

    wrapper.unmount();
    host.remove();
  });
});