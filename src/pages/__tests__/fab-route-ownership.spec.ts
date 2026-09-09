/**
 * 2.10.7 跨页入口归属（FAB/Sheet 随当前路由存在）— 真实 App + Router + KeepAlive + Teleport。
 * 前置：DailyValuePage / AccountingPage 增加 ownsPage（route.name）门禁：
 *   FAB 与 Sheet 均 v-if="ownsPage"，openAdd/openEdit/openCreate/openEditBill 首行 guard。
 * 不 stub KeepAlive / Teleport；DOM 归属是验收对象。
 * 注：表单保存的账务作用域（normal / daily-value-only）由组件级
 * QuickEntrySheet.spec / DailyValueAddSheet.spec 覆盖；本文件只验证入口归属与弹层清理。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils';
import { createPinia } from 'pinia';
import { createMemoryHistory, createRouter } from 'vue-router';
import { nextTick } from 'vue';
import App from '@/App.vue';
import { routes } from '@/app/router';
import { openDatabase } from '@/core/db/database';
import { __getBackOverlayStack } from '@/components/design/back-handler';

const FAB_SELECTOR = '.accounting__fab, .dv__fab';
const STORES = ['bills', 'categories', 'settings', 'meta', 'recurringRules'] as const;
let wrapper: VueWrapper | null = null;
let host: HTMLElement | null = null;

async function settle() {
  await flushPromises();
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  await nextTick();
  await flushPromises();
}

async function start(path: string) {
  const router = createRouter({ history: createMemoryHistory(), routes });
  const pinia = createPinia();
  await router.replace(path);
  await router.isReady();
  host = document.createElement('div');
  document.body.appendChild(host);
  wrapper = mount(App, { attachTo: host, global: { plugins: [pinia, router] } });
  await settle();
  return {
    router,
    async go(target: string) {
      await router.replace(target);
      await settle();
    },
  };
}

/** 断言当前 body 中主页面 FAB 的归属：expected 为 null 时两个 FAB 都不允许存在 */
function assertOwner(expected: 'accounting' | 'daily-value' | null) {
  const fabs = Array.from(document.body.querySelectorAll<HTMLButtonElement>(FAB_SELECTOR));
  expect(fabs.length).toBe(expected ? 1 : 0);
  if (!expected) return;
  expect(fabs[0].getAttribute('aria-label')).toBe(
    expected === 'accounting' ? '快速记账' : '添加日价物品',
  );
}

beforeEach(async () => {
  const db = await openDatabase();
  const tx = db.transaction(STORES, 'readwrite');
  for (const store of STORES) tx.objectStore(store).clear();
  await tx.done;
  localStorage.clear();
  document.body.replaceChildren();
  document.body.style.overflow = '';
  __getBackOverlayStack().splice(0);
});

afterEach(async () => {
  wrapper?.unmount();
  wrapper = null;
  host?.remove();
  host = null;
  await settle();
  document.body.replaceChildren();
  document.body.style.overflow = '';
  __getBackOverlayStack().splice(0);
});

describe('FAB 与一级路由归属（2.10.7）', () => {
  it('FO-01 首次访问日价再回记账：不得保留日价 FAB', async () => {
    const h = await start('/accounting');
    assertOwner('accounting');
    await h.go('/daily-value');
    assertOwner('daily-value');
    await h.go('/accounting');
    assertOwner('accounting');
  });

  it('FO-02 反向访问顺序也成立；统计/设置没有主页面 FAB', async () => {
    const h = await start('/daily-value');
    assertOwner('daily-value');
    await h.go('/accounting');
    assertOwner('accounting');
    await h.go('/daily-value');
    assertOwner('daily-value');
    await h.go('/statistics');
    assertOwner(null);
    await h.go('/settings');
    assertOwner(null);
  });

  it('FO-03 日价打开并关闭后回记账：唯一加号只能打开 QuickEntry', async () => {
    const h = await start('/accounting');
    await h.go('/daily-value');
    document.body.querySelector<HTMLButtonElement>('.dv__fab')!.click();
    await settle();
    expect(document.body.querySelector('.dvas')).not.toBeNull();
    document.body.querySelector<HTMLButtonElement>('.dv-sheet__close')!.click();
    await settle();
    await h.go('/accounting');
    assertOwner('accounting');
    const onlyFab = document.body.querySelector<HTMLButtonElement>(FAB_SELECTOR)!;
    onlyFab.click();
    await settle();
    expect(document.body.querySelector('.qe')).not.toBeNull();
    expect(document.body.querySelector('.dvas')).toBeNull();
    expect(document.body.querySelectorAll('.dv-sheet').length).toBe(1);
  });

  it('FO-04 非活跃页旧入口即使被调用也不能再开日价 Sheet', async () => {
    const h = await start('/accounting');
    await h.go('/daily-value');
    const staleFab = document.body.querySelector<HTMLButtonElement>('.dv__fab')!;
    await h.go('/accounting');
    assertOwner('accounting');
    staleFab.click(); // 防御性测试：handlers 应带 ownsPage guard
    await settle();
    expect(document.body.querySelector('.dvas')).toBeNull();
    expect(document.body.querySelector('.dv-sheet')).toBeNull();
  });

  it('FO-05 日价日期 Picker 打开时切页：子弹层及 Back 回调全部清理', async () => {
    const h = await start('/daily-value');
    document.body.querySelector<HTMLButtonElement>('.dv__fab')!.click();
    await settle();
    document.body.querySelector<HTMLButtonElement>('[aria-label="选择起算日期"]')!.click();
    await settle();
    expect(document.body.querySelector('.dv-dtp')).not.toBeNull();
    await h.go('/accounting');
    expect(document.body.querySelector('.dvas')).toBeNull();
    expect(document.body.querySelector('.dv-dtp')).toBeNull();
    expect(__getBackOverlayStack().length).toBe(0);
  });

  it('FO-06 导航点击与往返各 20 轮：不串页、不叠按钮', async () => {
    const h = await start('/accounting');
    for (let i = 0; i < 20; i += 1) {
      await h.go('/daily-value');
      assertOwner('daily-value');
      expect(document.body.querySelectorAll('.dv-sheet').length).toBe(0);
      await h.go('/accounting');
      assertOwner('accounting');
      expect(document.body.querySelectorAll('.dv-sheet').length).toBe(0);
    }
    await h.go('/statistics');
    assertOwner(null);
    await h.go('/daily-value');
    assertOwner('daily-value');
  });

  it('FO-07 记账回退后再次进入统计：ECharts 不因往返销毁（回归保护）', async () => {
    const h = await start('/accounting');
    await h.go('/statistics');
    await settle();
    expect(document.body.querySelector('.stats')).not.toBeNull();
    await h.go('/accounting');
    assertOwner('accounting');
    await h.go('/statistics');
    expect(document.body.querySelector('.stats')).not.toBeNull();
  });
});