/**
 * Daily Value v2 - 一级主页面 Primary Pager（2.10.2 Rebuild）
 *
 * 背景（2.10.1 真机仍失败 → 2.10.2 重构，docs/markDown1788166748886）：
 * - 2.10.1 只在 .app-shell__content 设 touch-action:pan-y，但 Accounting 账单列表
 *   （.accounting__timeline，overflow-y:auto）是真正的内部滚动容器，touch-action 不继承，
 *   手指从时间线起滑时浏览器命中的滚动层是 timeline → 父层 pan-y 约束不到它，
 *   横向触摸仍被 WebView 接管（pointercancel），Primary Swipe 失效。
 *   而 Statistics/DailyValue 无内部滚动容器 → 父层 pan-y 生效 → 能滑回 Accounting。
 *   这正好吻合 2.10.1 真机表现（Accounting 不能滑、其它两页可以）。
 * - 修复：所有一级页面主内容滚动容器统一挂 .dv-primary-scroll-surface
 *   （touch-action:pan-y + overscroll-behavior-x:none，见 src/theme/base.css）。
 *
 * 2.10.2 手势状态机（pointerdown → pointermove → pointerup，不再只判最终位移）：
 *   idle → tracking（pointerdown，记录 startX/Y/time/pointerId，不 capture）
 *       → horizontal（pointermove 满足 abs(dx) > abs(dy)*1.15 且过死区，
 *                      此时才 setPointerCapture；跟手动画只操作 page-stage）
 *       → vertical（abs(dy) > abs(dx)*1.15：放弃，不 capture，浏览器正常上下滚）
 *       → animating（commit 成功后的退场/入场动画期间，忽略新手势）
 *   pointerup：
 *   - horizontal → 按 shouldCommitSwipe（距离 + 速度）判定 commit：
 *       commit → 退场动画 → router.replace(target) → 新页从对侧入场
 *       取消   → 回弹到 0（轻微 return）
 *   - tracking（未 lock，如 JSDOM 只有 down/up）→ 用最终 dx/dy 走同一判定（兼容算法测试）
 *   pointerup/pointercancel 只认 activePointerId；isPrimary=false 多指忽略；
 *   pointercancel 一律回弹到 0，绝不留残余偏移。
 *
 * 视觉（只操作 primary-page-stage，Header/Nav/壁纸固定不动）：
 * - 跟手：translate3d(visualDx,0,0)，visualDx = dx * 0.4（有目标页）或 dx * 0.12（边界阻尼）；
 *   opacity 轻微淡出 1 - min(|dx|/width*0.25, 0.12)。不做 scale/bounce/blur。
 * - 成功：当前页 130ms 滑出（translateX(±18vw)，opacity 0.7）→ replace →
 *   新页 transition:none 到 translateX(∓10vw) → rAF×2 → 175ms 滑入归位 opacity 1。
 * - 取消：140ms reset 到 (0, 1)。边界（统计右滑 / 日价左滑）：阻尼 + 回弹，route 不变。
 * - transition 不 preventDefault，不全局 touchmove；横向归 JS，纵向归浏览器（touch-action）。
 *
 * 起点忽略（与 2.10.1 一致）：非 primary / 屏幕左右边缘 24px（留系统 Back）/
 *   input/textarea/select/[role=slider]/[data-page-swipe-ignore]（月份卡独占横向，
 *   从卡内起滑所有权不变；卡外起滑 → Pager）。账单行（li role=button）不再被 ignore：
 *   轻点 → Edit；横滑 → Pager（成功横滑后 400ms click suppression 防止误触打开编辑）。
 *
 * 职责边界：JSDOM 单测 = 算法测试；Android 真实触摸链路（touch-action / pointer capture /
 * 跟手动画）必须以真机 adb input swipe + 录屏验收（handoff DEVICE_UI_TEST.md A~J + ANIM-01..06）。
 */

import { onBeforeUnmount, onMounted, ref, type Ref } from 'vue';
import { useRouter } from 'vue-router';

/* ================= 常量（可单测/可覆盖） ================= */

/** 屏幕左右边缘保留给 Android 系统手势导航的宽度（CSS px） */
export const PRIMARY_SWIPE_EDGE_EXCLUSION = 24;
/** 横滑成功后吞掉本次误触 click 的时间窗（ms） */
export const SWIPE_CLICK_SUPPRESS_MS = 400;

/** 方向锁定死区（px）：|dx| 与 |dy| 均小于该值不锁方向 */
export const GESTURE_LOCK_DEAD_ZONE = 10;
/** 纵向判定比：abs(dy) > abs(dx) * 1.15 → lock vertical */
export const GESTURE_VERTICAL_RATIO = 1.15;
/** 横向判定比：abs(dx) > abs(dy) * 1.15 → lock horizontal */
export const GESTURE_HORIZONTAL_RATIO = 1.15;

/** 跟手位移增益：有目标页（可切）时 dx * 0.4 */
export const VISUAL_DRAG_GAIN = 0.4;
/** 边界阻尼增益：无目标页时 dx * 0.12 */
export const VISUAL_EDGE_GAIN = 0.12;
/** 跟手最大淡出（opacity 最低到 1 - 0.12 = 0.88，克制） */
export const VISUAL_OPACITY_MAX = 0.12;

/** commit 距离下界：abs(dx) >= min(96, width * 0.22) 视为切页 */
export const SWIPE_COMMIT_DX_FLOOR = 96;
export const SWIPE_COMMIT_DX_RATIO = 0.22;
/** 快速甩动：velocity >= 0.55 px/ms 且 abs(dx) >= 45 也切页 */
export const SWIPE_COMMIT_VELOCITY = 0.55;
export const SWIPE_COMMIT_MIN_DX = 45;

/** 退场/入场/回弹动画时长（px 内联样式过渡；测试可改 PRIMARY_PAGER_ANIM 压成 0 提速） */
export const PAGE_EXIT_VW = 18;
export const PAGE_ENTER_FROM_VW = 10;
let ANIM = {
  exitMs: 130,
  enterMs: 175,
  resetMs: 140,
};
/** 测试可覆盖：PRIMARY_PAGER_ANIM.exitMs = 0 等 */
export const PRIMARY_PAGER_ANIM = {
  get exitMs() { return ANIM.exitMs; },
  set exitMs(v: number) { ANIM.exitMs = v; },
  get enterMs() { return ANIM.enterMs; },
  set enterMs(v: number) { ANIM.enterMs = v; },
  get resetMs() { return ANIM.resetMs; },
  set resetMs(v: number) { ANIM.resetMs = v; },
};

/** 一级页面固定顺序：统计(左) / 记账(中) / 日价(右) */
const PRIMARY_ORDER = ['/statistics', '/accounting', '/daily-value'] as const;
type PrimaryPath = (typeof PRIMARY_ORDER)[number];

/** 手势起点忽略清单（2.10.1 缩小后保持一致；不按元素类型一刀切） */
const SWIPE_IGNORE_SELECTOR = [
  'input',
  'textarea',
  'select',
  '[role="slider"]',
  '[data-page-swipe-ignore]',
].join(',');

export type GestureIntent = 'none' | 'vertical' | 'horizontal';

/* ================= 纯函数（可单测） ================= */

/** 根据最终 dx/dy 判定手势意图；对角/死区内 → 'none' */
export function resolveGestureIntent(dx: number, dy: number): GestureIntent {
  if (Math.abs(dx) < GESTURE_LOCK_DEAD_ZONE && Math.abs(dy) < GESTURE_LOCK_DEAD_ZONE) return 'none';
  if (Math.abs(dy) > Math.abs(dx) * GESTURE_VERTICAL_RATIO) return 'vertical';
  if (Math.abs(dx) > Math.abs(dy) * GESTURE_HORIZONTAL_RATIO) return 'horizontal';
  return 'none';
}

/**
 * 切页判定：距离 或 快速甩动。
 * distCovered = abs(dx) >= min(96, width * 0.22)
 * fastFlick   = velocity(abs(dx)/elapsed) >= 0.55 px/ms 且 abs(dx) >= 45
 */
export function shouldCommitSwipe(dx: number, elapsedMs: number, width: number): boolean {
  const absDx = Math.abs(dx);
  if (elapsedMs <= 0) return absDx >= SWIPE_COMMIT_MIN_DX; // 测试/极端：瞬间 up 仍按距离兜底
  const distCovered = absDx >= Math.min(SWIPE_COMMIT_DX_FLOOR, width * SWIPE_COMMIT_DX_RATIO);
  const velocity = absDx / elapsedMs;
  const fastFlick = velocity >= SWIPE_COMMIT_VELOCITY && absDx >= SWIPE_COMMIT_MIN_DX;
  return distCovered || fastFlick;
}

/** 跟手位移：有目标页 → dx*0.4（明显跟手）；边界 → dx*0.12（阻尼） */
export function visualDragOffset(dx: number, hasTarget: boolean): number {
  return dx * (hasTarget ? VISUAL_DRAG_GAIN : VISUAL_EDGE_GAIN);
}

/** 跟手透明度：1 - min(|dx|/width*0.25, 0.12)，克制淡出 */
export function visualDragOpacity(dx: number, width: number): number {
  if (width <= 0) return 1;
  return 1 - Math.min((Math.abs(dx) / width) * 0.25, VISUAL_OPACITY_MAX);
}

/** 根据当前页与横滑方向计算目标页（越界返回 null → 不变化） */
export function swipeTargetFor(currentPath: string, dx: number): PrimaryPath | null {
  const idx = PRIMARY_ORDER.indexOf(currentPath as PrimaryPath);
  if (idx < 0) return null;
  // dx < 0 → 向左滑 → 顺序后一页；dx > 0 → 向右滑 → 顺序前一页
  const target = PRIMARY_ORDER[idx + (dx < 0 ? 1 : -1)];
  return target ?? null;
}

/* ================= 组合式函数 ================= */

type PagerState = 'idle' | 'tracking' | 'horizontal' | 'vertical' | 'animating';

export interface PrimaryPagerRefs {
  contentRef: Ref<HTMLElement | null>;
  pageStageRef: Ref<HTMLElement | null>;
}

function wait(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
function nextFrame(): Promise<void> {
  return new Promise((r) => requestAnimationFrame(() => r()));
}

export function usePrimaryPageSwipe({ contentRef, pageStageRef }: PrimaryPagerRefs): { isAnimating: Ref<boolean> } {
  const router = useRouter();

  /** 2.16.3：仅这三个一级主页参与左右滑动；/settings/*、/autobill/* 等子页面完全排除 */
  const MAIN_PAGES = ['/statistics', '/accounting', '/daily-value'];

  function canSwipePage(): boolean {
    return MAIN_PAGES.includes(router.currentRoute.value.path);
  }

  /** 2.10.10：切页动画进行中（退场/入场），供 App 层 Global FAB 停用 pointer-events，
   *  避免「动画未结束、FAB 已换新 action」被误点。nav 切换无动画 → 恒为 false。 */
  const isAnimating = ref(false);

  /* ---- 手势状态 ---- */
  let state: PagerState = 'idle';
  let activePointerId: number | null = null;
  let startX = 0;
  let startY = 0;
  let startTime = 0;
  /** 已锁定的横滑方向：-1 左（去下一页）/ +1 右（去上一页） */
  let lockDirection = 0;
  /** 横滑成功后到该时刻前吞掉本地点击（防误触 openEditBill 等） */
  let suppressClickUntil = 0;

  function stage(): HTMLElement | null {
    return pageStageRef.value;
  }

  function applyStyle(transform: string, opacity: string, transition: string): void {
    const el = stage();
    if (!el) return;
    el.style.transition = transition;
    el.style.transform = transform;
    el.style.opacity = opacity;
  }
  function resetStageStyle(): void {
    const el = stage();
    if (!el) return;
    el.style.transition = 'none';
    el.style.transform = '';
    el.style.opacity = '';
  }

  function releaseCaptureIfAny(el: HTMLElement): void {
    if (activePointerId === null) return;
    try {
      el.releasePointerCapture?.(activePointerId);
    } catch {
      // jsdom / 无捕获能力环境忽略
    }
  }

  function resetGesture(): void {
    state = 'idle';
    activePointerId = null;
    lockDirection = 0;
  }

  /** 取消/回弹：140ms 回零（轻微 return），不换页 */
  function resetToZero(): void {
    const el = stage();
    if (!el) return;
    applyStyle(
      'translate3d(0px, 0px, 0px)',
      '1',
      `transform ${ANIM.resetMs}ms cubic-bezier(0.2, 0, 0, 1), opacity ${ANIM.resetMs}ms cubic-bezier(0.2, 0, 0, 1)`,
    );
  }

  /** 成功切页：退场 → replace → 新页入场（只操作 page-stage，绝不动 RouterView Transition） */
  /** 进入动画阶段：等 CSS transition 真实结束（transitionend）再 return；
   *  视觉动画结束即 isAnimating=false → Global FAB 立即恢复 pointer-events，
   *  不依赖 setTimeout 猜测时长（真机 WebView 计时被拉长会让 FAB 多锁几百 ms，
   *  正是「切页后第一次点 + 无效」的根因）。transition 异常（被中断/无能力）用兜底超时保底。 */
  function waitEnterTransition(el: HTMLElement, fallbackMs: number): Promise<void> {
    return new Promise((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        el.removeEventListener('transitionend', onEnd);
        clearTimeout(timer);
        resolve();
      };
      const onEnd = (e: TransitionEvent) => {
        if (e.target === el) finish();
      };
      el.addEventListener('transitionend', onEnd);
      const timer = setTimeout(finish, fallbackMs);
    });
  }

  async function performNavigation(target: PrimaryPath, direction: number): Promise<void> {
    state = 'animating';
    isAnimating.value = true;
    // 吞掉本次横滑的误触 click（防横滑账单行 → 切页 + openEditBill 同发）
    suppressClickUntil = performance.now() + SWIPE_CLICK_SUPPRESS_MS;
    const el = stage();
    const width = window.innerWidth || 1;
    // direction: -1 左滑（去下一页）→ 当前页向左退 / 新页从右进；+1 右滑 → 反之
    const exitPx = direction * (PAGE_EXIT_VW / 100) * width;
    const enterFromPx = -direction * (PAGE_ENTER_FROM_VW / 100) * width;
    try {
      if (el) {
        applyStyle(
          `translate3d(${exitPx}px, 0px, 0px)`,
          '0.7',
          `transform ${ANIM.exitMs}ms cubic-bezier(0.2, 0, 0, 1), opacity ${ANIM.exitMs}ms cubic-bezier(0.2, 0, 0, 1)`,
        );
        await wait(ANIM.exitMs);
      }
      // Tab 切换用 replace：不进 Back History，双 Back 退出语义保持不变。
      // best-effort：导航被新导航中断时静默忽略（不产生 unhandledrejection）。
      await router.replace(target).catch(() => undefined);
      if (el) {
        // 新页从对侧 +10vw 起点入场（先无过渡再 rAF×2，保证浏览器渲染两帧后才起动画；
        // 非测试环境动画时长为 0 时可跳过 rAF，保持测试确定性）
        el.style.transition = 'none';
        el.style.transform = `translate3d(${enterFromPx}px, 0px, 0px)`;
        el.style.opacity = '0.7';
        if (ANIM.enterMs > 0) {
          await nextFrame();
          await nextFrame();
        }
        applyStyle(
          'translate3d(0px, 0px, 0px)',
          '1',
          `transform ${ANIM.enterMs}ms cubic-bezier(0.2, 0, 0, 1), opacity ${ANIM.enterMs}ms cubic-bezier(0.2, 0, 0, 1)`,
        );
        // 动画结束以「CSS transition 真实完成」为准；兜底超时 = enterMs + 100
        await waitEnterTransition(el, ANIM.enterMs + 100);
      }
    } finally {
      resetStageStyle();
      resetGesture();
      isAnimating.value = false;
    }
  }

  /** 松手统一收口：horizontal / 未 lock 的 tracking 都走这里（真实与 JSDOM 算法测试兼容） */
  function settleGesture(el: HTMLElement): void {
    releaseCaptureIfAny(el);
    const current = router.currentRoute.value.path;
    // 使用最后记录的位移（move 期间保留，pointerup 事件已更新）
    const finalDx = lastDxRef;
    const finalDy = lastDyRef;
    if (state === 'horizontal') {
      // 已锁横滑：距离 + 速度判定；direction 用锁定方向（更稳，避免回拖反号）
      const elapsed = Math.max(1, performance.now() - startTime);
      const commit = shouldCommitSwipe(finalDx, elapsed, window.innerWidth || 1);
      const target = commit ? swipeTargetFor(current, lockDirection) : null;
      if (!target || target === current) {
        resetToZero();
        resetGesture();
        return;
      }
      void performNavigation(target, lockDirection);
      return;
    }
    // tracking（未 lock）：用最终位移判定（兼容只有 down/up 的算法测试）
    const intent = resolveGestureIntent(finalDx, finalDy);
    if (intent === 'horizontal') {
      const elapsed = Math.max(1, performance.now() - startTime);
      const commit = shouldCommitSwipe(finalDx, elapsed, window.innerWidth || 1);
      const direction = finalDx < 0 ? -1 : 1;
      const target = commit ? swipeTargetFor(current, direction) : null;
      if (!target || target === current) {
        resetToZero();
        resetGesture();
        return;
      }
      void performNavigation(target, direction);
      return;
    }
    // vertical / none：全程未动过 page-stage（vertical 时浏览器已接管滚动），无需回弹
    resetGesture();
  }

  let lastDxRef = 0;
  let lastDyRef = 0;

  function onPointerDown(event: PointerEvent): void {
    // 2.16.3 P0：子页面（设置/自动记账/备份等）完全不参与 Primary Pager 滑动
    if (!canSwipePage()) return;
    if (state === 'animating') return;
    resetGesture();
    const el = contentRef.value;
    if (!el) return;
    // 多指/非 primary 指针忽略，避免双指误触干扰
    if (event.isPrimary === false) return;
    const target = event.target as Element | null;
    if (!target || !(target instanceof Element)) return;
    // 可交互控件/显式忽略区域（输入框、月份卡等）开始的手势：不参与 Primary Pager
    if (target.closest(SWIPE_IGNORE_SELECTOR)) return;
    // 屏幕左右边缘：留给 Android 系统手势导航（右滑 Back / 左滑返回），不抢手势
    if (event.clientX < PRIMARY_SWIPE_EDGE_EXCLUSION) return;
    if (event.clientX > window.innerWidth - PRIMARY_SWIPE_EDGE_EXCLUSION) return;
    state = 'tracking';
    activePointerId = event.pointerId;
    startX = event.clientX;
    startY = event.clientY;
    startTime = performance.now();
    lastDxRef = 0;
    lastDyRef = 0;
    // 2.10.2：不立刻 setPointerCapture —— 方向未锁定时 capture 会干扰纵向滚动的
    // 浏览器仲裁。锁定 horizontal 后才 capture（见 onPointerMove）。
  }

  function onPointerMove(event: PointerEvent): void {
    if (activePointerId !== event.pointerId) return;
    if (state === 'animating' || state === 'idle') return;
    const dx = event.clientX - startX;
    const dy = event.clientY - startY;
    lastDxRef = dx;
    lastDyRef = dy;

    if (state === 'tracking') {
      const intent = resolveGestureIntent(dx, dy);
      if (intent === 'vertical') {
        // 垂直优先：放弃 Primary Pager，不 capture，浏览器正常上下滚动
        state = 'vertical';
        return;
      }
      if (intent === 'horizontal') {
        // 此时才锁定为横滑并 capture：手指滑出原元素也不丢 pointerup
        state = 'horizontal';
        lockDirection = dx < 0 ? -1 : 1;
        const el = contentRef.value;
        if (el) {
          try {
            el.setPointerCapture?.(event.pointerId);
          } catch {
            // jsdom 等无捕获环境忽略
          }
        }
      }
    }
    if (state !== 'horizontal') return;
    // 跟手：只做 transform/opacity 动画层，不动滚动层，不 preventDefault
    const hasTarget = swipeTargetFor(router.currentRoute.value.path, lockDirection) !== null;
    const visualDx = visualDragOffset(dx, hasTarget);
    const opacity = visualDragOpacity(lockDirection * dx, window.innerWidth || 1);
    applyStyle(
      `translate3d(${visualDx}px, 0px, 0px)`,
      String(opacity),
      'none',
    );
  }

  function endPointer(event: PointerEvent, cancelled: boolean): void {
    if (state === 'animating') return;
    if (activePointerId !== event.pointerId) return;
    const el = contentRef.value;
    // 更新最终位移（jsdom 直接 down→up 无 move 时也正确）
    lastDxRef = event.clientX - startX;
    lastDyRef = event.clientY - startY;
    if (cancelled) {
      // pointercancel：可能发生在 vertical（浏览器已接管，无位移）或任何中途。一律回零，不换页。
      if (el) releaseCaptureIfAny(el);
      resetToZero();
      resetGesture();
      return;
    }
    if (el) settleGesture(el);
    else resetGesture();
  }

  function onPointerUp(event: PointerEvent): void {
    endPointer(event, false);
  }
  function onPointerCancel(event: PointerEvent): void {
    endPointer(event, true);
  }

  /** 横滑成功后 400ms 内的本地点击一律吞掉，防止误触账单行打开编辑 */
  function onClickCapture(event: MouseEvent): void {
    if (state === 'animating' || performance.now() < suppressClickUntil) {
      event.preventDefault();
      event.stopPropagation();
    }
  }

  onMounted(() => {
    const el = contentRef.value;
    if (!el) return;
    el.addEventListener('pointerdown', onPointerDown);
    el.addEventListener('pointermove', onPointerMove);
    el.addEventListener('pointerup', onPointerUp);
    el.addEventListener('pointercancel', onPointerCancel);
    el.addEventListener('click', onClickCapture, true);
  });

  onBeforeUnmount(() => {
    const el = contentRef.value;
    if (!el) return;
    el.removeEventListener('pointerdown', onPointerDown);
    el.removeEventListener('pointermove', onPointerMove);
    el.removeEventListener('pointerup', onPointerUp);
    el.removeEventListener('pointercancel', onPointerCancel);
    el.removeEventListener('click', onClickCapture, true);
  });

  return { isAnimating };
}