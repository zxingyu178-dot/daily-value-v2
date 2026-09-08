import { describe, it, expect, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import DVSheet from '@/components/design/DVSheet.vue';

describe('DVSheet', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('open 时渲染面板与遮罩', async () => {
    const wrapper = mount(DVSheet, {
      props: { modelValue: true, title: '测试' },
    });
    await nextTick();
    const sheet = document.querySelector('.dv-sheet');
    expect(sheet).not.toBeNull();
    expect(document.querySelector('.dv-sheet__mask')).not.toBeNull();
    expect(document.body.textContent).toContain('测试');
    wrapper.unmount();
  });

  it('close 后不渲染', async () => {
    const wrapper = mount(DVSheet, { props: { modelValue: true } });
    await nextTick();
    expect(document.querySelector('.dv-sheet')).not.toBeNull();
    await wrapper.setProps({ modelValue: false });
    await nextTick();
    expect(document.querySelector('.dv-sheet')).toBeNull();
    wrapper.unmount();
  });

  it('点击遮罩触发 close 并 emit update', async () => {
    const wrapper = mount(DVSheet, { props: { modelValue: true } });
    await nextTick();
    const mask = document.querySelector('.dv-sheet__mask') as HTMLElement;
    mask?.click();
    await nextTick();
    expect(wrapper.emitted('close')).toBeTruthy();
    expect(wrapper.emitted('update:modelValue')).toEqual([[false]]);
    wrapper.unmount();
  });

  it('渲染默认插槽内容', async () => {
    const wrapper = mount(DVSheet, {
      props: { modelValue: true },
      slots: { default: '<p class="content">面板内容</p>' },
    });
    await nextTick();
    expect(document.querySelector('.content')).not.toBeNull();
    wrapper.unmount();
  });
});
