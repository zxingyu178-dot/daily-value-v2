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
import { __getBackInterceptorStack } from '@/components/design/back-handler';
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

  it('2.16.6 Android Back：入口=review，切到设置后 Back 先回归 review（消费、路由不变），再 Back 交还全局回 /accounting', async () => {
    const router = await makeRouter();
    await router.push('/autobill');
    const host = document.createElement('div');
    document.body.appendChild(host);
    const wrapper = mount(AutoBillPage, { attachTo: host, global: { plugins: [createPinia(), router] } });
    await settle();
    // 进入设置面板（偏离入口 review）
    wrapper.find('.settings-entry').trigger('click');
    await nextTick();
    expect(wrapper.find('.access-row').exists()).toBe(true); // 已切到 SettingsPanel
    expect(router.currentRoute.value.path).toBe('/autobill');

    // 拿到页面注册的系统 Back 拦截器（模拟 Android Back 触发）
    const stack = __getBackInterceptorStack();
    const interceptor = stack[stack.length - 1]!;
    // 第一次 Back：偏离入口 → 消费（true），回到 review，路由不变
    expect(interceptor()).toBe(true);
    await nextTick();
    expect(router.currentRoute.value.path).toBe('/autobill');
    expect(wrapper.find('.seg').exists()).toBe(true); // 已回到审核面板
    // 第二次 Back：已在入口 review → 不消费（false），交还全局由系统历史返回处理
    expect(interceptor()).toBe(false);
    router.back(); // 全局 back-handler 收到 false 后将执行 history.back() 的等效动作
    await settle();
    expect(router.currentRoute.value.path).toBe('/accounting');

    wrapper.unmount();
    host.remove();
  });

  it('2.16.6 Android Back：入口=settings，切到待确认后 Back 先回归 settings，再交还回 /settings；卸载后拦截器清空', async () => {
    const router = await makeRouter();
    await router.push('/settings');
    await router.push('/autobill?panel=settings');
    const host = document.createElement('div');
    document.body.appendChild(host);
    const wrapper = mount(AutoBillPage, { attachTo: host, global: { plugins: [createPinia(), router] } });
    await settle();
    // 从设置面板切到待确认（偏离入口 settings）
    wrapper.findAll('.page__nav')[0].trigger('click');
    await nextTick();
    expect(wrapper.find('.settings-entry').exists()).toBe(true); // 已切到 ReviewTab
    expect(router.currentRoute.value.path).toBe('/autobill');

    const stackCheck = __getBackInterceptorStack();
    const interceptor = stackCheck[stackCheck.length - 1]!;
    expect(interceptor()).toBe(true); // 回归 settings（消费）
    await nextTick();
    expect(wrapper.find('.access-row').exists()).toBe(true); // 回到 SettingsPanel
    expect(interceptor()).toBe(false); // 已在入口 settings → 交还全局
    router.back(); // 全局系统返回（等效 history.back()）
    await settle();
    expect(router.currentRoute.value.path).toBe('/settings');

    wrapper.unmount();
    host.remove();
    expect(__getBackInterceptorStack()).toHaveLength(0); // unmount 注销拦截器
  });
});

describe('2.16.7 UX hotfix：唯一 Review 入口 + 通知使用权点击不跳页', () => {
  it('UI-01 Settings Panel 只有一个 Review 入口（顶部「待确认 ›」），底部「返回待确认账单」已删除', async () => {
    const router = await makeRouter();
    await router.push('/settings');
    await router.push('/autobill?panel=settings');
    const host = document.createElement('div');
    document.body.appendChild(host);
    const wrapper = mount(AutoBillPage, { attachTo: host, global: { plugins: [createPinia(), router] } });
    await settle();
    // 设置面板状态
    expect(wrapper.find('.access-row').exists()).toBe(true);
    // 仅顶部一个 Review 入口：标题右侧 .page__nav 且文本含「待确认」
    const nav = wrapper.findAll('.page__nav');
    expect(nav).toHaveLength(1);
    expect(nav[0].text()).toContain('待确认');
    // 底部重复入口已删除
    expect(wrapper.find('.back-review').exists()).toBe(false);
    wrapper.unmount();
    host.remove();
  });

  it('ACCESS-web 点击「通知使用权」：仅调 Native（web 下失败 toast），路由/History/面板均不变', async () => {
    const router = await makeRouter();
    await router.push('/autobill');
    const host = document.createElement('div');
    document.body.appendChild(host);
    const wrapper = mount(AutoBillPage, { attachTo: host, global: { plugins: [createPinia(), router] } });
    await settle();
    // 先切到设置面板
    wrapper.find('.settings-entry').trigger('click');
    await nextTick();
    const posBefore = position(router);
    expect(wrapper.find('.access-row').exists()).toBe(true);
    // 点击通知使用权（JSDOM → Capacitor web 兜底 openAccessSettings 抛错 → toast，不跳页）
    await wrapper.find('.access-row').trigger('click');
    await settle();
    expect(router.currentRoute.value.path).toBe('/autobill');
    expect(position(router)).toBe(posBefore); // 0 历史污染
    expect(wrapper.find('.access-row').exists()).toBe(true); // 仍停留在 Settings Panel
    wrapper.unmount();
    host.remove();
  });
});