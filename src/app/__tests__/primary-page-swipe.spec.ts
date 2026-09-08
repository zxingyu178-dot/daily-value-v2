/**
 * 2.10.0 主页面滑动切换测试（SWIPE-01..10）+ 2.10.1 Hotfix 增量 + 2.10.2 Primary Pager Rebuild
 *
 * 真实挂载 App + memory router，在 .app-shell__content 上派发 pointer 事件，
 * 断言 route 切换 / 跟手样式 / 动画行为 / capture 配对。覆盖：
 * - swipeTargetFor 方向映射纯函数
 * - 记账左滑→日价 / 右滑→统计；统计左滑→记账；日价右滑→记账；越界方向不变化
 * - 月份卡内滑动只换月份不换页（data-page-swipe-ignore）
 * - 明显上下滚动不换页；屏幕左右边缘手势（x<24 / x>w-24）留给系统导航
 * - 20 轮滑动后 route 仍走 replace（Back History 不增长 → 双 Back 退出语义保留）
 * - 2.10.1：touch-action 源级校验 / 账单行横滑不触发编辑 / cancel 无残留 / capture 配对
 * - 2.10.2：resolveGestureIntent / shouldCommitSwipe / visualDragOffset / visualDragOpacity 纯函数、
 *   方向锁定发生在 pointermove（capture 在 lock 后）、跟手 transform/opacity、边界阻尼不回弹越界、
 *   动画期间忽略新手势、只有 down/up 的 JSDOM 算法兼容
 *
 * 职责边界：JSDOM 单测 = 算法测试；Android 真实触摸链路（touch-action 是否被 WebView 接管、
 * pointer capture、跟手动画）必须以真机 adb input swipe + 录屏验收（handoff DEVICE_UI_TEST.md A~J + ANIM-01..06）。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils';
import { createPinia } from 'pinia';
import { createRouter, createMemoryHistory, type Router } from 'vue-router';
import { nextTick } from 'vue';

import App from '@/App.vue';
import { routes } from '@/app/router';
import {
  swipeTargetFor,
  resolveGestureIntent,
  shouldCommitSwipe,
  visualDragOffset,
  visualDragOpacity,
  PRIMARY_PAGER_ANIM,
} from '@/app/usePrimaryPageSwipe';
import { openDatabase } from '@/core/db/database';
import { services } from '@/core/services';

const STORES = ['bills', 'categories', 'settings', 'meta', 'recurringRules'] as const;

async function resetDb(): Promise<void> {
  const db = await openDatabase();
  const tx = db.transaction(STORES, 'readwrite');
  for (const s of STORES) tx.objectStore(s).clear();
  await tx.done;
  localStorage.clear();
  document.body.innerHTML = '';
}

async function makeHarness() {
  // 2.10.2：动画时长压成 0，保证断言确定性（jsdom 无真实合成器，只测算法/样式时序）
  PRIMARY_PAGER_ANIM.exitMs = 0;
  PRIMARY_PAGER_ANIM.enterMs = 0;
  PRIMARY_PAGER_ANIM.resetMs = 0;
  const router = createRouter({ history: createMemoryHistory(), routes });
  const pinia = createPinia();
  const wrapper = mount(App, { global: { plugins: [pinia, router] } });
  await router.isReady();
  // 预加载三个一级页面（懒加载组件经 await replace 后已缓存），并最终停在 /accounting：
  // 后续滑动 replace 的目标组件已就绪，导航在断言前即可完成（避免懒加载时序抖动）。
  for (const path of ['/statistics', '/daily-value', '/accounting']) {
    await router.replace(path);
    await flushPromises();
    await new Promise((r) => setTimeout(r, 0));
    await flushPromises();
  }
  await waitSettled();
  return { router, wrapper };
}

/** 等宏任务 + 微任务落定（懒加载组件 / IDB load / 导航 / 动画完成） */
async function waitSettled() {
  await flushPromises();
  await new Promise((r) => setTimeout(r, 0));
  await flushPromises();
  await nextTick();
  await flushPromises();
  await new Promise((r) => setTimeout(r, 0));
  await flushPromises();
}

/** jsdom 无真实 PointerEvent 触发链路，用普通 Event + 声明 clientX/clientY/pointerId/isPrimary 模拟 */
function dispatchPointer(
  target: Element,
  type: string,
  clientX: number,
  clientY: number,
  pointerId = 1,
  isPrimary = true,
) {
  const ev = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(ev, 'clientX', { value: clientX });
  Object.defineProperty(ev, 'clientY', { value: clientY });
  Object.defineProperty(ev, 'pointerId', { value: pointerId });
  Object.defineProperty(ev, 'isPrimary', { value: isPrimary });
  target.dispatchEvent(ev);
}

/** 种子账单（SWIPE-ROW 需真实 .tl-item 渲染） */
function makeBill(over: Record<string, unknown> = {}) {
  return {
    type: 'expense' as const,
    amount: 25,
    categoryId: 'c-food',
    categoryEmoji: '🍚',
    categoryName: '餐饮',
    note: '',
    date: '2026-08-20',
    timestamp: Date.now(),
    source: 'manual' as const,
    ledgerImpact: 'normal' as const,
    ...over,
  };
}

/** 一次完整横滑手势（起点 → 终点；默认从内容区中心开始）。
 *  滑动触发 router.replace 会异步懒加载目标页组件，必须经宏任务（setTimeout(0)）等待
 *  导航真正落定，再断言 route（同 route-stability 的 nav 辅助）。 */
async function swipeAt(
  wrapper: VueWrapper,
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  target?: Element,
) {
  const main = (target ?? wrapper.find('.app-shell__content').element) as Element;
  dispatchPointer(main, 'pointerdown', fromX, fromY);
  dispatchPointer(main, 'pointerup', toX, toY);
  await waitSettled();
}

/** 完整横滑：down → 水平锁定向 move（沿滑动方向 1/4 处，保证 lock 方向=最终方向）→ up（真实触摸链路） */
async function swipeWithMove(
  wrapper: VueWrapper,
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  target?: Element,
) {
  const main = (target ?? wrapper.find('.app-shell__content').element) as Element;
  dispatchPointer(main, 'pointerdown', fromX, fromY);
  const midX = fromX + (toX - fromX) * 0.25;
  const midY = fromY + (toY - fromY) * 0.15; // 横向分量明显大于纵向 → lock horizontal
  dispatchPointer(main, 'pointermove', midX, midY);
  dispatchPointer(main, 'pointermove', toX, toY);
  dispatchPointer(main, 'pointerup', toX, toY);
  await waitSettled();
}

function currentPath(router: Router): string {
  return router.currentRoute.value.path;
}

describe('swipeTargetFor 纯函数：方向映射正确', () => {
  it('记账：左滑→日价，右滑→统计', () => {
    expect(swipeTargetFor('/accounting', -100)).toBe('/daily-value');
    expect(swipeTargetFor('/accounting', 100)).toBe('/statistics');
  });

  it('统计：左滑→记账（右滑越界不变化）；日价：右滑→记账（左滑越界不变化）', () => {
    expect(swipeTargetFor('/statistics', -100)).toBe('/accounting');
    expect(swipeTargetFor('/statistics', 100)).toBeNull();
    expect(swipeTargetFor('/daily-value', 100)).toBe('/accounting');
    expect(swipeTargetFor('/daily-value', -100)).toBeNull();
  });

  it('非一级页面：一律不参与（返回 null）', () => {
    expect(swipeTargetFor('/settings', -100)).toBeNull();
    expect(swipeTargetFor('/design', -100)).toBeNull();
  });

  it('水平位移为 0：无方向', () => {
    expect(swipeTargetFor('/statistics', 0)).toBeNull();
  });
});

describe('2.10.2 手势纯函数', () => {
  it('resolveGestureIntent：死区内 none / 纵向 vertical / 横向 horizontal / 对角 none', () => {
    expect(resolveGestureIntent(0, 0)).toBe('none');
    expect(resolveGestureIntent(5, 6)).toBe('none');
    expect(resolveGestureIntent(10, 100)).toBe('vertical');
    expect(resolveGestureIntent(-10, -100)).toBe('vertical');
    expect(resolveGestureIntent(100, 10)).toBe('horizontal');
    expect(resolveGestureIntent(-100, -10)).toBe('horizontal');
    // dy=18, dx=100：18 <= 100*1.15=115 且 100 > 18*1.15=20.7 → horizontal
    expect(resolveGestureIntent(100, 18)).toBe('horizontal');
    // 对角（两者都不满足严格比例）：dx=60, dy=55 → 60 <= 55*1.15=63.25 且 55 <= 60*1.15=69 → none
    expect(resolveGestureIntent(60, 55)).toBe('none');
  });

  it('shouldCommitSwipe：距离达标 / 快速甩动 / 慢小位移回弹', () => {
    // 宽 400：min(96, 400*0.22=88) = 88 → |dx|>=88 commit
    expect(shouldCommitSwipe(120, 300, 400)).toBe(true);
    expect(shouldCommitSwipe(88, 300, 400)).toBe(true);
    expect(shouldCommitSwipe(87, 300, 400)).toBe(false);
    // 宽 1200：min(96, 264)=96 → |dx|>=96 commit
    expect(shouldCommitSwipe(96, 300, 1200)).toBe(true);
    expect(shouldCommitSwipe(95, 300, 1200)).toBe(false);
    // 快速甩动：velocity=60/100=0.6 >= 0.55 且 |dx|=60>=45 → commit
    expect(shouldCommitSwipe(60, 100, 1200)).toBe(true);
    // 慢小位移：velocity=50/1000=0.05 → 不 commit
    expect(shouldCommitSwipe(50, 1000, 1200)).toBe(false);
    // 甩动但距离不足 45
    expect(shouldCommitSwipe(40, 1, 1200)).toBe(false);
    // elapsed<=0（瞬间 up）按距离兜底
    expect(shouldCommitSwipe(60, 0, 1200)).toBe(true);
    expect(shouldCommitSwipe(10, 0, 1200)).toBe(false);
  });

  it('visualDragOffset：有目标页跟手 dx*0.4；边界阻尼 dx*0.12', () => {
    expect(visualDragOffset(100, true)).toBe(40);
    expect(visualDragOffset(-100, true)).toBe(-40);
    expect(visualDragOffset(100, false)).toBe(12);
    expect(visualDragOffset(-100, false)).toBe(-12);
    expect(visualDragOffset(0, true)).toBe(0);
  });

  it('visualDragOpacity：克制淡出 1 - min(|dx|/width*0.25, 0.12)，宽 1000 时 dx=300 → 0.925', () => {
    expect(visualDragOpacity(0, 1000)).toBe(1);
    expect(visualDragOpacity(300, 1000)).toBe(1 - 300 / 1000 * 0.25);
    expect(visualDragOpacity(1000, 1000)).toBe(1 - 0.12); // 封顶 0.12
    expect(visualDragOpacity(-1000, 1000)).toBe(1 - 0.12);
    expect(visualDragOpacity(50, 0)).toBe(1); // 无宽度兜底
  });
});

describe('一级主页面滑动切换（SWIPE-01..10）', () => {
  beforeEach(resetDb);

  it('SWIPE-01 Accounting 中间向左滑 → /daily-value', async () => {
    const { router, wrapper } = await makeHarness();
    await swipeWithMove(wrapper, 500, 400, 140, 400); // dx=-360 明显横向
    expect(currentPath(router)).toBe('/daily-value');
  });

  it('SWIPE-02 Accounting 中间向右滑 → /statistics', async () => {
    const { router, wrapper } = await makeHarness();
    await swipeWithMove(wrapper, 140, 400, 500, 400); // dx=+360
    expect(currentPath(router)).toBe('/statistics');
  });

  it('SWIPE-03 Statistics 向左滑 → Accounting', async () => {
    const { router, wrapper } = await makeHarness();
    await router.replace('/statistics');
    await flushPromises();
    await swipeWithMove(wrapper, 500, 400, 150, 400);
    expect(currentPath(router)).toBe('/accounting');
  });

  it('SWIPE-04 DailyValue 向右滑 → Accounting', async () => {
    const { router, wrapper } = await makeHarness();
    await router.replace('/daily-value');
    await flushPromises();
    await swipeWithMove(wrapper, 150, 400, 520, 400);
    expect(currentPath(router)).toBe('/accounting');
  });

  it('SWIPE-05 越界方向不变化：统计右滑 / 日价左滑', async () => {
    const { router, wrapper } = await makeHarness();
    await router.replace('/statistics');
    await flushPromises();
    await swipeWithMove(wrapper, 150, 400, 520, 400); // 统计右滑 → 无动作
    expect(currentPath(router)).toBe('/statistics');

    await router.replace('/daily-value');
    await flushPromises();
    await swipeWithMove(wrapper, 520, 400, 150, 400); // 日价左滑 → 无动作
    expect(currentPath(router)).toBe('/daily-value');
  });

  it('SWIPE-06/07 在绿色月份卡内部左右滑：只留给月份卡处理，route 仍 /accounting', async () => {
    const { router, wrapper } = await makeHarness();
    // 目标必须是月份卡（data-page-swipe-ignore）→ pointerdown 被忽略
    const card = wrapper.find('.accounting__card').element;
    await swipeWithMove(wrapper, 400, 200, 120, 200, card); // 卡内左滑
    expect(currentPath(router)).toBe('/accounting');
    await swipeWithMove(wrapper, 120, 200, 420, 200, card); // 卡内右滑
    expect(currentPath(router)).toBe('/accounting');
  });

  it('SWIPE-08 明显上下滚动：route 不变化', async () => {
    const { router, wrapper } = await makeHarness();
    const main = wrapper.find('.app-shell__content').element;
    // 纵向为主：move 先明显下移（dy=100 > dx*1.15）→ lock vertical → 不换页
    dispatchPointer(main, 'pointerdown', 300, 200);
    dispatchPointer(main, 'pointermove', 305, 300);
    dispatchPointer(main, 'pointerup', 400, 460);
    await waitSettled();
    expect(currentPath(router)).toBe('/accounting');
    // 幅度不足阈值也不换页
    await swipeWithMove(wrapper, 300, 200, 340, 200); // dx=40 < min(96, width*0.22)
    expect(currentPath(router)).toBe('/accounting');
  });

  it('SWIPE-09 屏幕左右边缘手势：不触发页面 Swipe（留给系统 Back 导航）', async () => {
    const { router, wrapper } = await makeHarness();
    // 左边缘 x=5（<24）：右滑再多也不换页
    await swipeWithMove(wrapper, 5, 400, 400, 400);
    expect(currentPath(router)).toBe('/accounting');
    // 右边缘 x = w-10（> w-24）：同样不换页
    await swipeWithMove(wrapper, window.innerWidth - 10, 400, window.innerWidth - 400, 400);
    expect(currentPath(router)).toBe('/accounting');
  });

  it('SWIPE-10 20 轮滑动跨页后：route 仍一级页面且 history 深度不增长（replace 不进 Back History）', async () => {
    const { router, wrapper } = await makeHarness();
    // 记录 replace 前 memory history 深度
    const depthBefore = (router.options.history.state?.position ?? 0) as number;

    for (let i = 0; i < 20; i += 1) {
      // 在记账反复左右滑（真实横滑，通过判定才会 replace）
      await swipeWithMove(wrapper, 500, 400, 150, 400);
      await swipeWithMove(wrapper, 150, 400, 500, 400);
    }
    // 全程 router.replace：history 深度不再增长（不进 Back History）
    const depthAfter = (router.options.history.state?.position ?? 0) as number;
    expect(depthAfter).toBe(depthBefore);
    // 仍停留一级页面 /accounting（双 Back 退出判定仍按 primary 处理，不退回旧 Tab）
    expect(currentPath(router)).toBe('/accounting');
    // App 已初始化 primaryRouteMatcher：一级页面 Back 不 history.back()（双 Back 语义由 back-handler 承担）
    const backHandlerModule = await import('@/components/design/back-handler');
    expect(typeof backHandlerModule.handleBackWhenNoOverlay).toBe('function');
  });

  it('横向滑动幅度不足阈值 / 未达比例不换页', async () => {
    const { router, wrapper } = await makeHarness();
    // dx=44（< 45 甩动下界且 < 96 距离下界）→ 不换页
    await swipeAt(wrapper, 500, 400, 456, 400);
    expect(currentPath(router)).toBe('/accounting');
    // 对角斜向（dx=dy=80）：两方向都不满足 1.15 严格比例 → intent none → 不换页
    await swipeAt(wrapper, 200, 300, 280, 380);
    expect(currentPath(router)).toBe('/accounting');
  });
});

/* =====================================================================
 * 2.10.1 Swipe Hotfix + 2.10.2 Primary Pager 增量
 * ===================================================================== */

describe('2.10.1 Hotfix / 2.10.2 Pager（CSS/ROW/CANCEL/CAPTURE/ANIM）', () => {
  beforeEach(resetDb);

  it('SWIPE-CSS-01 一级滚动面统一 .dv-primary-scroll-surface：touch-action pan-y（源级静态校验）', () => {
    // jsdom 不应用 CSS；从源码读 src/theme/base.css 校验 .dv-primary-scroll-surface 定义
    // （touch-action 不继承，所有一级页面主内容滚动容器都必须带该类）。
    // .css 经 vitest 的 css 管线会被 import.meta.glob raw 空化，用 node:fs 直接读源码文件。
    const root = process.cwd();
    const base = readFileSync(join(root, 'src/theme/base.css'), 'utf-8');
    const rule = base.match(/\.dv-primary-scroll-surface\s*\{([\s\S]*?)\}/)?.[1] ?? '';
    expect(rule, 'base.css 应定义 .dv-primary-scroll-surface').toContain('touch-action: pan-y');
    expect(rule).toContain('overscroll-behavior-x: none');
    expect(rule).not.toContain('touch-action: none');

    // App.vue 的 main 与 AccountingPage 的 timeline 都必须带该类
    const appSrc = readFileSync(join(root, 'src/App.vue'), 'utf-8');
    expect(appSrc).toContain('class="app-shell__content dv-primary-scroll-surface"');
    const acctSrc = readFileSync(join(root, 'src/pages/accounting/AccountingPage.vue'), 'utf-8');
    expect(acctSrc).toContain('accounting__timeline dv-primary-scroll-surface');
  });

  it('SWIPE-ROW-01 从账单行（role=button）横滑：切页面且不触发 openEditBill（click suppression）', async () => {
    await services.bills.add(makeBill({ note: '午餐', amount: 45 }));
    const { router, wrapper } = await makeHarness();
    // Accounting 渲染出真实账单行
    await waitSettled();
    const row = wrapper.find('.tl-item');
    expect(row.exists()).toBe(true);
    // 账单行上向左横滑（此前 [role=button] 会被 ignore 拦截，2.10.1 已放开；2.10.2 保留）。
    // down → move（锁 horizontal + capture）→ up（同步设置 suppress + 发起 replace/动画）
    dispatchPointer(row.element, 'pointerdown', 700, 400);
    dispatchPointer(row.element, 'pointermove', 400, 405);
    dispatchPointer(row.element, 'pointerup', 120, 400);
    // 横滑成功后 400ms 内的本次 click 被吞：QuickEntry 编辑 Sheet 不打开
    const click = new MouseEvent('click', { bubbles: true, cancelable: true });
    Object.defineProperty(click, 'clientX', { value: 120 });
    const notPrevented = row.element.dispatchEvent(click);
    expect(notPrevented).toBe(false); // capture listener preventDefault + stopPropagation 生效
    await waitSettled();
    expect(currentPath(router)).toBe('/daily-value');
    expect(document.body.querySelector('.dv-sheet')).toBeNull();
  });

  it('SWIPE-ROW-02 普通轻点账单行：正常打开编辑（未达 Swipe 阈值的 click 不被吞）', async () => {
    await services.bills.add(makeBill({ note: '午餐', amount: 45 }));
    const { router, wrapper } = await makeHarness();
    await waitSettled();
    const row = wrapper.find('.tl-item');
    expect(row.exists()).toBe(true);
    // 轻点：不触发横滑 → click 正常 → QuickEntry 编辑 Sheet 打开
    row.element.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flushPromises();
    await new Promise((r) => setTimeout(r, 0));
    await flushPromises();
    expect(document.body.querySelector('.dv-sheet')).not.toBeNull();
    expect(currentPath(router)).toBe('/accounting');
  });

  it('SWIPE-CANCEL-01 pointerdown → pointercancel：不换页、不残留 active 状态、无残余偏移', async () => {
    const { router, wrapper } = await makeHarness();
    const main = wrapper.find('.app-shell__content').element;
    dispatchPointer(main, 'pointerdown', 300, 400);
    dispatchPointer(main, 'pointercancel', 500, 400);
    await flushPromises();
    expect(currentPath(router)).toBe('/accounting');
    // 残留检查：cancel 之后再 up 也不应换页（active 已清空）
    dispatchPointer(main, 'pointerup', 900, 400);
    await waitSettled();
    expect(currentPath(router)).toBe('/accounting');
  });

  it('SWIPE-CAPTURE-01 方向锁定（pointermove horizontal）后才 setPointerCapture，pointerup 后 releasePointerCapture（同一 pointerId）', async () => {
    // jsdom 原型可能未实现 pointer capture，先兜底再 spy
    if (typeof Element.prototype.setPointerCapture !== 'function') {
      (Element.prototype as unknown as { setPointerCapture: () => void }).setPointerCapture = () => undefined;
    }
    if (typeof Element.prototype.releasePointerCapture !== 'function') {
      (Element.prototype as unknown as { releasePointerCapture: () => void }).releasePointerCapture = () => undefined;
    }
    const setSpy = vi.spyOn(Element.prototype, 'setPointerCapture').mockImplementation(() => undefined);
    const releaseSpy = vi.spyOn(Element.prototype, 'releasePointerCapture').mockImplementation(() => undefined);
    try {
      const { wrapper } = await makeHarness();
      const main = wrapper.find('.app-shell__content').element;
      // 2.10.2：pointerdown 不 capture（防干扰纵向滚动仲裁）
      dispatchPointer(main, 'pointerdown', 300, 400, 7);
      await waitSettled();
      expect(setSpy).not.toHaveBeenCalled();
      // 横向 move 锁定后才 capture
      dispatchPointer(main, 'pointermove', 500, 405, 7);
      await waitSettled();
      expect(setSpy).toHaveBeenCalledWith(7);
      dispatchPointer(main, 'pointerup', 900, 400, 7);
      await waitSettled();
      expect(releaseSpy).toHaveBeenCalledWith(7);
    } finally {
      setSpy.mockRestore();
      releaseSpy.mockRestore();
    }
  });

  it('2.10.2 ANIM-01 横向 move 跟手：page-stage 获得 transform/opacity（可见跟手）', async () => {
    const { wrapper } = await makeHarness();
    const main = wrapper.find('.app-shell__content').element;
    const stage = wrapper.find('.primary-page-stage').element as HTMLElement;
    dispatchPointer(main, 'pointerdown', 400, 400);
    dispatchPointer(main, 'pointermove', 300, 405); // dx=-100，lock horizontal
    expect(stage.style.transform).toContain('translate3d(-40px'); // dx*0.4 跟手
    expect(stage.style.opacity).toBe(String(visualDragOpacity(100, window.innerWidth)));
    // 取消（未达 commit，dx=-100 时 distCovered: min(96, w*0.22)；w=1024 → 96；100>=96 → commit！
    // 改用小位移验证回弹：重新小位移到 dx=-40 → 不 commit → resetToZero
    dispatchPointer(main, 'pointermove', 360, 405); // dx=-40
    expect(stage.style.transform).toContain('translate3d(-16px'); // -40*0.4
    dispatchPointer(main, 'pointerup', 360, 405);
    await waitSettled();
    // 回弹：transform 回到 0（translate3d(0px...)
    expect(stage.style.transform).toContain('0px');
    expect(stage.style.opacity).toBe('1');
  });

  it('2.10.2 ANIM-04 边界右拖（Statistics 右滑）：阻尼位移 + 回弹 + route 不变', async () => {
    const { router, wrapper } = await makeHarness();
    await router.replace('/statistics');
    await flushPromises();
    const main = wrapper.find('.app-shell__content').element;
    const stage = wrapper.find('.primary-page-stage').element as HTMLElement;
    dispatchPointer(main, 'pointerdown', 200, 400);
    dispatchPointer(main, 'pointermove', 400, 405); // dx=+200 右滑（无上一页）
    expect(stage.style.transform).toContain('translate3d(24px'); // 边界阻尼 dx*0.12
    dispatchPointer(main, 'pointerup', 600, 400);
    await waitSettled();
    expect(stage.style.transform).toContain('0px'); // 回弹归零
    expect(currentPath(router)).toBe('/statistics'); // route 不变
  });

  it('2.10.2 ANIM-06 动画期间新人（down）被忽略：不打断切页', async () => {
    const { router, wrapper } = await makeHarness();
    const main = wrapper.find('.app-shell__content').element;
    dispatchPointer(main, 'pointerdown', 500, 400);
    dispatchPointer(main, 'pointermove', 300, 405); // lock horizontal
    dispatchPointer(main, 'pointerup', 100, 400); // commit → performNavigation（animating）
    // 动画/导航进行中立刻再 down：应被忽略（不打断）
    dispatchPointer(main, 'pointerdown', 500, 400, 9);
    dispatchPointer(main, 'pointerup', 700, 400, 9);
    await waitSettled();
    expect(currentPath(router)).toBe('/daily-value');
  });

  it('多指（isPrimary=false）pointerdown 被忽略，不接管手势', async () => {
    const { router, wrapper } = await makeHarness();
    const main = wrapper.find('.app-shell__content').element;
    // 第二根手指（非 primary）起手 → 不参与；随后 up 也不换页
    dispatchPointer(main, 'pointerdown', 300, 400, 2, false);
    dispatchPointer(main, 'pointermove', 900, 400, 2, false);
    dispatchPointer(main, 'pointerup', 900, 400, 2, false);
    await waitSettled();
    expect(currentPath(router)).toBe('/accounting');
  });
});