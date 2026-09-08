import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { toasts, dismiss, showToast, toast } from '@/components/design/toast';
import DVToast from '@/components/design/DVToast.vue';

describe('toast service & DVToast', () => {
  beforeEach(() => {
    toasts.value = [];
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  it('showToast 追加一条 info toast', () => {
    showToast('提示');
    expect(toasts.value).toHaveLength(1);
    expect(toasts.value[0].type).toBe('info');
  });

  it('success / error / info 类型正确', () => {
    toast.success('成功');
    toast.error('失败');
    toast.info('信息');
    expect(toasts.value.map((t) => t.type)).toEqual(['success', 'error', 'info']);
  });

  it('自动消失（2.5s 后移除）', () => {
    toast.info('x');
    expect(toasts.value).toHaveLength(1);
    vi.advanceTimersByTime(3000);
    expect(toasts.value).toHaveLength(0);
  });

  it('超过 3 条时移除最早一条', () => {
    for (let i = 0; i < 5; i++) toast.info(`m${i}`);
    expect(toasts.value.length).toBeLessThanOrEqual(3);
  });

  it('dismiss 移除指定 toast', () => {
    toast.info('a');
    const id = toasts.value[0].id;
    dismiss(id);
    expect(toasts.value).toHaveLength(0);
  });

  it('DVToast 渲染当前 toast 列表', () => {
    toast.success('保存成功');
    mount(DVToast);
    // DVToast 内容 Teleport 到 body
    expect(document.body.textContent).toContain('保存成功');
    expect(document.body.querySelector('.dv-toast--success')).not.toBeNull();
  });
});
