/**
 * back-handler 唯一 callback 栈测试（Phase 6 收口 G / E）
 * 目标：register 去重 + 只 push 栈顶；unregister 删除所有相同项；保持真实 LIFO 层级。
 * - Sheet → Picker → Back 关 Picker → Back 关 Sheet（LIFO）
 * - Editor 快速 open→close→open 后栈中只有一个 Editor callback（不残留 stale）
 * - 重复 register 同一 callback 不会堆叠（去重）
 * - unregister 一次性删除所有相同项
 */
import { describe, it, expect } from 'vitest';
import {
  registerOverlayForBack,
  unregisterOverlayForBack,
  __getBackOverlayStack,
} from '@/components/design/back-handler';

/** 清空栈中指定的所有回调，避免测试间污染 */
async function purge(cbs: Array<() => void>): Promise<void> {
  for (const cb of cbs) await unregisterOverlayForBack(cb);
}

describe('back-handler 唯一回调栈', () => {
  it('Sheet→Picker 打开后栈为 [Sheet, Picker]；模拟 Back 先关 Picker 再关 Sheet（真 LIFO）', async () => {
    const closeOrder: string[] = [];
    const sheetClose = () => closeOrder.push('sheet');
    const pickerClose = () => closeOrder.push('picker');
    await registerOverlayForBack(sheetClose);
    await registerOverlayForBack(pickerClose);

    // 模拟真机 backButton：总是 pop 栈顶最顶层覆盖层
    const stack = __getBackOverlayStack();
    stack.pop()?.(); // 第一次 Back → Picker
    stack.pop()?.(); // 第二次 Back → Sheet
    expect(closeOrder).toEqual(['picker', 'sheet']);

    await purge([sheetClose, pickerClose]);
  });

  it('Editor 快速 open→close→open：栈中最终只有一个 Editor callback（去重/清理）', async () => {
    const editorClose = () => {};
    await registerOverlayForBack(editorClose); // open
    await unregisterOverlayForBack(editorClose); // close（清理）
    await registerOverlayForBack(editorClose); // 重新 open
    const count = __getBackOverlayStack().filter((cb) => cb === editorClose).length;
    expect(count).toBe(1);
    await purge([editorClose]);
  });

  it('重复 register 同一 callback 不堆叠，且移到栈顶（保持唯一）', async () => {
    const cbA = () => {};
    const cbB = () => {};
    await registerOverlayForBack(cbA);
    await registerOverlayForBack(cbB);
    // 再次 register cbA：先去重旧项，再 push 到顶
    await registerOverlayForBack(cbA);
    const stack = __getBackOverlayStack();
    const countA = stack.filter((cb) => cb === cbA).length;
    expect(countA).toBe(1);
    // cbA 现在应位于栈顶（LIFO 最顶层）
    expect(stack[stack.length - 1]).toBe(cbA);
    await purge([cbA, cbB]);
  });

  it('unregister 一次性删除所有相同项（即便异常残留多份）', async () => {
    const cb = () => {};
    await registerOverlayForBack(cb);
    // 人为制造重复残留（直接 push 进数组验证 unregister 全清）
    __getBackOverlayStack().push(cb);
    __getBackOverlayStack().push(cb);
    await unregisterOverlayForBack(cb);
    expect(__getBackOverlayStack().filter((x) => x === cb)).toHaveLength(0);
  });

  it('P0-2 异步竞态：register 未 await 即紧接 unregister，经过 plugin ready 后栈仍为 0（stale 不残留）', async () => {
    const cb = () => {};
    // 不 await：模拟调用方打开后立即关闭（真实 open→close 常见时序）
    registerOverlayForBack(cb);
    unregisterOverlayForBack(cb);
    // 让 ensurePlugin 的异步初始化与任何 microtask 完成
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
    // 竞态失败时会残留一个已关闭的 callback；同步实现下必须为 0
    expect(__getBackOverlayStack().filter((x) => x === cb)).toHaveLength(0);
  });

  it('P0-2 异步竞态（Editor 场景）：open→close 不 await，栈中无 Editor stale', async () => {
    const editorClose = () => {};
    registerOverlayForBack(editorClose); // open（模拟 Editor 打开）
    unregisterOverlayForBack(editorClose); // 立即 close
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
    expect(__getBackOverlayStack().filter((x) => x === editorClose)).toHaveLength(0);
  });
});