/**
 * Daily Value v2 - 统一长按交互（2.10.8 UX Stability）
 *
 * 语义（与页面 Swipe / 滚动/ 轻点共存）：
 * - delay = 550ms 后触发 onTrigger；期间只处理 primary pointer。
 * - pointermove 位移 > moveTolerance（默认 10px）→ 立即取消（上下滚动 / 左右页面 Swipe 不误触）。
 * - pointerup / pointercancel → 取消。
 * - 长按触发后 consumeSuppressedClick() 吞掉随后的 click（长按松手不得再打开编辑）。
 * - 长按永远只进入「确认弹窗」入口，数据删除必须二次确认（本 composable 不负责删除）。
 * - 视觉反馈：down 约 150ms 后 onFeedbackStart（轻缩放/表面变化），触发或取消后 onFeedbackEnd。
 *
 * 注意：Vue 模板里用 passive 绑定 pointer 事件（@pointerdown.passive 等），
 * 避免页面滚动/Swipe 在 pointer 监听上受阻。
 */

export interface UseLongPressOptions {
  /** 长按触发延迟（ms） */
  delay?: number;
  /** 位移容差（px），超过即取消 */
  moveTolerance?: number;
  /** 长按真正触发（此时应打开确认弹窗） */
  onTrigger: () => void;
  /** 按下约 150ms 的轻反馈开始（视觉 scale/surface 变化） */
  onFeedbackStart?: () => void;
  /** 反馈结束（触发 / 取消 / 松手时恢复） */
  onFeedbackEnd?: () => void;
}

export interface LongPressHandlers {
  onPointerdown: (e: PointerEvent) => void;
  onPointermove: (e: PointerEvent) => void;
  onPointerup: (e: PointerEvent) => void;
  onPointercancel: (e: PointerEvent) => void;
}

/** 轻反馈前置时间：长按视觉反馈先于触发出现（约 150ms） */
const FEEDBACK_LEAD_MS = 150;

export function useLongPress(options: UseLongPressOptions): LongPressHandlers & {
  /** click 处理器入口统一经过此方法：长按触发的随后 click 被吞掉 */
  consumeSuppressedClick: () => boolean;
  /** 状态复位（组件卸载等场景手动调用） */
  reset: () => void;
} {
  const delay = options.delay ?? 550;
  const tolerance = options.moveTolerance ?? 10;

  let triggerTimer: ReturnType<typeof setTimeout> | null = null;
  let feedbackTimer: ReturnType<typeof setTimeout> | null = null;
  let activePointerId = -1;
  let startX = 0;
  let startY = 0;
  /** 长按已触发 → 下一次 click 需要被吞掉 */
  let suppressClick = false;

  function clearTimers() {
    if (triggerTimer) {
      clearTimeout(triggerTimer);
      triggerTimer = null;
    }
    if (feedbackTimer) {
      clearTimeout(feedbackTimer);
      feedbackTimer = null;
    }
  }

  function endFeedback() {
    if (feedbackTimer) {
      clearTimeout(feedbackTimer);
      feedbackTimer = null;
    }
    options.onFeedbackEnd?.();
  }

  function cancelAll() {
    clearTimers();
    endFeedback();
    activePointerId = -1;
  }

  function onPointerdown(e: PointerEvent) {
    // 只处理 primary pointer（触摸第一指 / 鼠标主键 / 主笔），多指触摸忽略
    if (!e.isPrimary) return;
    if (activePointerId !== -1) return; // 已有长按跟踪中
    activePointerId = e.pointerId;
    startX = e.clientX;
    startY = e.clientY;
    clearTimers();
    // 轻反馈先于触发：约 150ms 时给出视觉反馈，550ms 才真正触发
    feedbackTimer = setTimeout(() => {
      feedbackTimer = null;
      options.onFeedbackStart?.();
    }, FEEDBACK_LEAD_MS);
    triggerTimer = setTimeout(() => {
      triggerTimer = null;
      endFeedback();
      suppressClick = true; // 吞掉随后的 click，避免「长按 → 松手 → 打开编辑」
      options.onTrigger();
    }, delay);
  }

  function onPointermove(e: PointerEvent) {
    if (e.pointerId !== activePointerId) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    if (Math.hypot(dx, dy) > tolerance) {
      cancelAll(); // 滚动 / 页面 Swipe：位移超容差立即取消
    }
  }

  function onPointerup(e: PointerEvent) {
    if (e.pointerId !== activePointerId) return;
    cancelAll();
  }

  function onPointercancel(e: PointerEvent) {
    if (e.pointerId !== activePointerId) return;
    cancelAll();
  }

  function consumeSuppressedClick(): boolean {
    const suppressed = suppressClick;
    suppressClick = false;
    return suppressed;
  }

  function reset() {
    cancelAll();
    suppressClick = false;
  }

  return { onPointerdown, onPointermove, onPointerup, onPointercancel, consumeSuppressedClick, reset };
}