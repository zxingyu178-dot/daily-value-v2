/**
 * 2.10.10 Global Primary FAB —— 唯一 FAB + 命令总线归属测试。
 * 前置（本轮架构收口）：
 *   - App.vue 全 DOM 唯一 Primary FAB（.global-primary-fab，Teleport 到 body）
 *     状态完全由 route.path 决定（/accounting → accounting-add；/daily-value → daily-value-add；其它不显示）
 *   - 页面通过 src/app/primary-action.ts 命令总线订阅：Accounting 收 accounting-add / DailyValue 收 daily-value-add
 *   - 页面自身不再渲染/Teleport 任何 FAB（全文不得再出现 .accounting__fab / .dv__fab 按钮）
 * 不 stub KeepAlive / Teleport；DOM 归属是验收对象。
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
import { triggerPrimaryAction, getPrimaryActionSequence } from '@/app/primary-action';

const FAB_SELECTOR = '.global-primary-fab';
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

/** 断言全局 FAB 归属：expected 为 'accounting' / 'daily-value' 时恰好一个（aria-label 匹配）；
 *  null 时不允许存在任何 FAB */
function assertOwner(expected: 'accounting' | 'daily-value' | null) {
  const fabs = Array.from(document.body.querySelectorAll<HTMLButtonElement>(FAB_SELECTOR));
  expect(fabs.length).toBe(expected ? 1 : 0);
  if (!expected) return;
  expect(fabs[0].getAttribute('aria-label')).toBe(
    expected === 'accounting' ? '快速记账' : '添加日价物品',
  );
}

/** 点击唯一的 Global FAB（立刻，等价真机「第一次点击」） */
function clickFab(): HTMLButtonElement {
  const fab = document.body.querySelector<HTMLButtonElement>(FAB_SELECTOR);
  expect(fab, '应该在当前页面存在唯一 Global FAB').not.toBeNull();
  fab!.click();
  return fab!;
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

describe('Global Primary FAB（2.10.10 唯一 + 命令总线）', () => {
  it('FAB-01 冷启动记账：DOM 只有 1 个 Global FAB，第一次点击 QuickEntry 立即打开', async () => {
    await start('/accounting');
    const fabs = document.body.querySelectorAll(FAB_SELECTOR);
    expect(fabs.length).toBe(1);
    clickFab();
    await settle();
    expect(document.body.querySelector('.qe')).not.toBeNull();
  });

  it('FAB-02 记账→日价：第一次点 + 立即打开 DailyValueAdd', async () => {
    const h = await start('/accounting');
    await h.go('/daily-value');
    assertOwner('daily-value');
    clickFab();
    await settle();
    expect(document.body.querySelector('.dvas')).not.toBeNull();
  });

  it('FAB-03 日价→记账（切回）后马上点 +：第一次立即打开 QuickEntry（不得等待第二次）', async () => {
    const h = await start('/daily-value');
    await h.go('/accounting');
    assertOwner('accounting');
    clickFab();
    await settle();
    expect(document.body.querySelector('.qe')).not.toBeNull();
  });

  it('FAB-04 记账↔日价 切换 24 轮：每轮恰一个 FAB，且均能将第一击响应到正确 Sheet', async () => {
    const h = await start('/accounting');
    for (let i = 0; i < 12; i += 1) {
      await h.go('/daily-value');
      assertOwner('daily-value');
      clickFab();
      await settle();
      expect(document.body.querySelector('.dvas')).not.toBeNull();
      expect(document.body.querySelector('.qe')).toBeNull();
      // 关闭日价 Sheet 再回到记账（保持 sheet 关闭态，模拟真实切换）
      document.body.querySelector<HTMLElement>('.dv-sheet__close')!.click();
      await settle();
      await h.go('/accounting');
      assertOwner('accounting');
      clickFab();
      await settle();
      expect(document.body.querySelector('.qe')).not.toBeNull();
      expect(document.body.querySelector('.dvas')).toBeNull();
      document.body.querySelector<HTMLElement>('.dv-sheet__close')!.click();
      await settle();
      expect(document.body.querySelectorAll('.dv-sheet').length).toBe(0);
    }
  });

  it('FAB-07/08 统计、设置：Global FAB 不存在', async () => {
    const h = await start('/statistics');
    assertOwner(null);
    await h.go('/daily-value');
    assertOwner('daily-value');
    await h.go('/settings');
    assertOwner(null);
  });

  it('FAB-09 日价 Sheet 开着切到记账：第一次点 + 只能 QuickEntry（dvas 不残留）', async () => {
    const h = await start('/daily-value');
    clickFab();
    await settle();
    expect(document.body.querySelector('.dvas')).not.toBeNull();
    await h.go('/accounting');
    // 日价 Sheet 被清理（route 条件 + 失活清理）
    expect(document.body.querySelector('.dvas')).toBeNull();
    assertOwner('accounting');
    clickFab();
    await settle();
    expect(document.body.querySelector('.qe')).not.toBeNull();
    expect(document.body.querySelector('.dvas')).toBeNull();
    expect(document.body.querySelectorAll('.dv-sheet').length).toBe(1);
  });

  it('FAB-10 记账 Sheet 开着切到日价：第一次点 + 只能 DailyValueAdd（qe 不残留）', async () => {
    const h = await start('/accounting');
    clickFab();
    await settle();
    expect(document.body.querySelector('.qe')).not.toBeNull();
    await h.go('/daily-value');
    expect(document.body.querySelector('.qe')).toBeNull();
    assertOwner('daily-value');
    clickFab();
    await settle();
    expect(document.body.querySelector('.dvas')).not.toBeNull();
    expect(document.body.querySelector('.qe')).toBeNull();
    expect(document.body.querySelectorAll('.dv-sheet').length).toBe(1);
  });

  it('FO-04 跨页命令守卫：在记账时触发 daily-value-add 不得打开日价 Sheet（route 门禁）', async () => {
    await start('/accounting');
    triggerPrimaryAction('daily-value-add');
    await settle();
    expect(document.body.querySelector('.dvas')).toBeNull();
    expect(document.body.querySelector('.dv-sheet')).toBeNull();
    // 正确命令仍有效
    triggerPrimaryAction('accounting-add');
    await settle();
    expect(document.body.querySelector('.qe')).not.toBeNull();
  });

  it('FO-05 日价日期 Picker 打开时切页：子弹层及 Back 回调全部清理', async () => {
    const h = await start('/daily-value');
    clickFab();
    await settle();
    document.body.querySelector<HTMLButtonElement>('[aria-label="选择起算日期"]')!.click();
    await settle();
    expect(document.body.querySelector('.dv-dtp')).not.toBeNull();
    await h.go('/accounting');
    expect(document.body.querySelector('.dvas')).toBeNull();
    expect(document.body.querySelector('.dv-dtp')).toBeNull();
    expect(__getBackOverlayStack().length).toBe(0);
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

  it('FAB-11 pointerup 触发后短窗抑制随后的 click：一次触摸 primaryAction sequence 只 +1（2.14.0）', async () => {
    await start('/accounting');
    const fab = document.body.querySelector<HTMLButtonElement>(FAB_SELECTOR)!;

    // 真实触摸链路：pointerup（主键）立即触发 action；随后的 click（浏览器 tap 仲裁产物）应在 400ms 短窗内被抑制
    const before = getPrimaryActionSequence();
    const ev = new Event('pointerup', { bubbles: true, cancelable: true });
    Object.defineProperty(ev, 'button', { value: 0 });
    fab.dispatchEvent(ev);
    fab.click();
    await settle();
    expect(getPrimaryActionSequence() - before).toBe(1); // 一次触摸 sequence 只增加 1
    expect(document.body.querySelector('.qe')).not.toBeNull(); // QuickEntry 正常打开

    // 短窗过后（>400ms）纯 click 仍有效（桌面/键盘 Enter 语义不受影响）
    await new Promise<void>((resolve) => setTimeout(resolve, 450));
    document.body.querySelector<HTMLElement>('.dv-sheet__close')!.click();
    await settle();
    const before2 = getPrimaryActionSequence();
    document.body.querySelector<HTMLButtonElement>(FAB_SELECTOR)!.click();
    await settle();
    expect(getPrimaryActionSequence() - before2).toBe(1);
    expect(document.body.querySelector('.qe')).not.toBeNull();
  });
});