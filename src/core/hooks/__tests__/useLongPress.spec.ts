/**
 * 2.10.8 统一长按 composable 单元测试（LP-02/03/04/07 核心手势判定 + 反馈时序）
 * - 只处理 primary pointer；单次跟踪一个 pointerId
 * - delay=550ms 触发 onTrigger；移动超过 10px 立即取消；300ms 松手不触发
 * - 触发后 consumeSuppressedClick() 吞掉随后一次 click
 * - 视觉反馈：约 150ms onFeedbackStart，触发/取消/松手 onFeedbackEnd
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { useLongPress, type LongPressHandlers } from '@/core/hooks/useLongPress';

function makeEv(x: number, y: number, opts: { pointerId?: number; isPrimary?: boolean } = {}): PointerEvent {
  return {
    pointerId: opts.pointerId ?? 1,
    isPrimary: opts.isPrimary ?? true,
    clientX: x,
    clientY: y,
  } as unknown as PointerEvent;
}

describe('useLongPress（2.10.8）', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function setup(over?: { delay?: number; moveTolerance?: number }) {
    const calls: string[] = [];
    const h = useLongPress({
      delay: over?.delay,
      moveTolerance: over?.moveTolerance,
      onTrigger: () => calls.push('trigger'),
      onFeedbackStart: () => calls.push('feedback-start'),
      onFeedbackEnd: () => calls.push('feedback-end'),
    });
    return { h, calls } as { h: LongPressHandlers & { consumeSuppressedClick: () => boolean; reset: () => void }; calls: string[] };
  }

  it('LP-02 长按 550ms：触发 onTrigger', () => {
    const { h, calls } = setup();
    h.onPointerdown(makeEv(10, 10));
    vi.advanceTimersByTime(550);
    expect(calls).toContain('trigger');
  });

  it('LP-03 按住 300ms 松手：不触发、无删除', () => {
    const { h, calls } = setup();
    h.onPointerdown(makeEv(10, 10));
    vi.advanceTimersByTime(300);
    h.onPointerup(makeEv(10, 10));
    vi.advanceTimersByTime(600);
    expect(calls).not.toContain('trigger');
  });

  it('LP-04 pointermove 移动超过 10px：长按取消（过后即使补时间也不触发）', () => {
    const { h, calls } = setup();
    h.onPointerdown(makeEv(10, 10));
    // 水平位移 15px
    h.onPointermove(makeEv(25, 10));
    vi.advanceTimersByTime(600);
    expect(calls).not.toContain('trigger');
  });

  it('LP-04b 纵向位移 15px 同样取消（上下滚动不误触）', () => {
    const { h, calls } = setup();
    h.onPointerdown(makeEv(10, 10));
    h.onPointermove(makeEv(10, 25));
    vi.advanceTimersByTime(600);
    expect(calls).not.toContain('trigger');
  });

  it('LP-04c 位移 10px 内（含边界 10px）不取消', () => {
    const { h, calls } = setup();
    h.onPointerdown(makeEv(10, 10));
    h.onPointermove(makeEv(10, 20)); // 恰好 10px，仍在容差内
    vi.advanceTimersByTime(550);
    expect(calls).toContain('trigger');
  });

  it('LP-07 长按触发后：consumeSuppressedClick 吞掉随后一次 click，第二次不再吞', () => {
    const { h, calls } = setup();
    h.onPointerdown(makeEv(10, 10));
    vi.advanceTimersByTime(550);
    expect(calls).toContain('trigger');
    h.onPointerup(makeEv(10, 10));
    expect(h.consumeSuppressedClick()).toBe(true);
    expect(h.consumeSuppressedClick()).toBe(false);
  });

  it('非 primary pointer（多指第二指）不参与长按', () => {
    const { h, calls } = setup();
    h.onPointerdown(makeEv(0, 0, { pointerId: 2, isPrimary: false }));
    vi.advanceTimersByTime(900);
    expect(calls).not.toContain('trigger');
  });

  it('pointercancel（浏览器接管滚动/Swipe）立即取消', () => {
    const { h, calls } = setup();
    h.onPointerdown(makeEv(10, 10));
    vi.advanceTimersByTime(200);
    h.onPointercancel(makeEv(10, 10));
    vi.advanceTimersByTime(600);
    expect(calls).not.toContain('trigger');
  });

  it('视觉反馈时序：约 150ms feedback-start，触发/取消后 feedback-end', () => {
    const { h, calls } = setup();
    h.onPointerdown(makeEv(10, 10));
    vi.advanceTimersByTime(150);
    expect(calls).toContain('feedback-start');
    expect(calls).not.toContain('trigger');
    vi.advanceTimersByTime(400);
    expect(calls).toContain('feedback-end'); // 触发同时结束反馈
    expect(calls).toContain('trigger');
  });

  it('轻按（<550ms）也恢复视觉反馈（feedback-end）', () => {
    const { h, calls } = setup();
    h.onPointerdown(makeEv(10, 10));
    vi.advanceTimersByTime(150);
    expect(calls).toContain('feedback-start');
    h.onPointerup(makeEv(10, 10));
    expect(calls).toContain('feedback-end');
  });

  it('reset() 清空全部状态：之后长按不再触发', () => {
    const { h, calls } = setup();
    h.onPointerdown(makeEv(10, 10));
    vi.advanceTimersByTime(200);
    h.reset();
    vi.advanceTimersByTime(600);
    expect(calls).not.toContain('trigger');
    expect(h.consumeSuppressedClick()).toBe(false);
  });
});