/**
 * 2.9.6（P0-1）一级路由往返稳定性测试（RS-01..04）
 *
 * 根因：2.9.5 将 DailyValueAddSheet 放在 section 外，使 DailyValuePage 变成 Vue Fragment（多根）；
 * 而 App.vue 一级路由使用 Transition(out-in)+KeepAlive，对路由组件根节点有单根要求，
 * 导致「记账 → 日价」后内容区变空（业务页面全部消失）。
 *
 * 修复：App.vue 移除一级 RouterView 外的 Transition（稳定优先）；DailyValuePage 恢复单根。
 * 本测试不再用「组件单独 mount」或「源码字符串检查」代替，而是真实挂载 App + Router，
 * 通过真实 router.push 在三个一级页面间往返，断言 .app-shell__content 始终非空且当前页存在。
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils';
import { createPinia } from 'pinia';
import { createRouter, createMemoryHistory } from 'vue-router';
import { nextTick } from 'vue';

import App from '@/App.vue';
import { routes } from '@/app/router';
import { openDatabase } from '@/core/db/database';

const STORES = ['bills', 'categories', 'settings', 'meta', 'recurringRules'] as const;

async function resetDb(): Promise<void> {
  const db = await openDatabase();
  const tx = db.transaction(STORES, 'readwrite');
  for (const s of STORES) tx.objectStore(s).clear();
  await tx.done;
  localStorage.clear();
  document.body.innerHTML = '';
}

function makeHarness() {
  const router = createRouter({ history: createMemoryHistory(), routes });
  const pinia = createPinia();
  const wrapper = mount(App, { global: { plugins: [pinia, router] } });
  return { router, wrapper };
}

/** 真实导航：push + 等待懒加载组件与页面 onMounted（billStore.load）完成 */
async function nav(router: ReturnType<typeof makeHarness>['router'], path: string) {
  await router.push(path);
  await flushPromises();
  await new Promise((r) => setTimeout(r, 0));
  await flushPromises();
  await nextTick();
  await flushPromises();
}

/** 内容区子元素数量：P0-1 复现时只有 Header/Nav、.app-shell__content 为空（0 子元素） */
function contentChildCount(wrapper: VueWrapper): number {
  const content = wrapper.find('.app-shell__content');
  return content.exists() ? content.element.children.length : 0;
}

describe('路由稳定性（P0-1 回归）', () => {
  beforeEach(resetDb);

  it('RS-01 /accounting → /daily-value：日价内容存在且内容区非空', async () => {
    const { router, wrapper } = makeHarness();
    await nav(router, '/accounting');
    expect(contentChildCount(wrapper)).toBeGreaterThan(0);
    expect(wrapper.find('.accounting').exists()).toBe(true);

    await nav(router, '/daily-value');
    // P0-1 断言：切到日价后业务页面不再消失
    expect(contentChildCount(wrapper)).toBeGreaterThan(0);
    expect(wrapper.find('.dv').exists()).toBe(true);
    expect(wrapper.find('.dv__summary').exists()).toBe(true);
  });

  it('RS-02 /daily-value → /accounting：记账内容存在且内容区非空', async () => {
    const { router, wrapper } = makeHarness();
    await nav(router, '/daily-value');
    expect(wrapper.find('.dv').exists()).toBe(true);

    await nav(router, '/accounting');
    expect(contentChildCount(wrapper)).toBeGreaterThan(0);
    expect(wrapper.find('.accounting').exists()).toBe(true);
  });

  it('RS-03 记账→统计→日价→记账 连续切换 10 次：每次 .app-shell__content 都非空', async () => {
    const { router, wrapper } = makeHarness();
    const cycles = [
      { path: '/accounting', marker: '.accounting' },
      { path: '/statistics', marker: '.stats' },
      { path: '/daily-value', marker: '.dv' },
      { path: '/accounting', marker: '.accounting' },
    ];

    await nav(router, '/accounting');

    for (let i = 0; i < 10; i += 1) {
      for (const step of cycles) {
        await nav(router, step.path);
        // 任何一次都不得出现只有 Header/Nav、内容全空
        expect(contentChildCount(wrapper)).toBeGreaterThan(0);
        expect(wrapper.find(step.marker).exists()).toBe(true);
      }
    }
  }, 60000);

  it('RS-04 日价 Sheet 打开/关闭一次后，返回其它一级页仍正常', async () => {
    const { router, wrapper } = makeHarness();
    await nav(router, '/daily-value');

    // 打开日价新增 Sheet（右下角 FAB；FAB Teleport 到 body，脱离 stage transform 定位上下文）
    const fab = document.body.querySelector('.dv__fab') as HTMLElement | null;
    expect(fab).not.toBeNull();
    fab!.click();
    await flushPromises();
    const sheet = document.querySelector('.dv-sheet');
    expect(sheet).toBeTruthy();
    expect(document.querySelector('.dvas')).toBeTruthy();

    // 关闭 Sheet（Teleport 到 body，用关闭按钮）
    const close = document.querySelector<HTMLElement>('.dv-sheet__close');
    expect(close).toBeTruthy();
    close!.click();
    await flushPromises();
    await nextTick();
    expect(document.querySelector('.dv-sheet')).toBeNull();

    // 返回其它一级页：记账 → 日价，页面仍正常
    await nav(router, '/accounting');
    expect(contentChildCount(wrapper)).toBeGreaterThan(0);
    expect(wrapper.find('.accounting').exists()).toBe(true);

    await nav(router, '/daily-value');
    expect(contentChildCount(wrapper)).toBeGreaterThan(0);
    expect(wrapper.find('.dv').exists()).toBe(true);
    expect(wrapper.find('.dv__summary').exists()).toBe(true);
  });
});
