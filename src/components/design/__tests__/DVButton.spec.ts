import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import DVButton from '@/components/design/DVButton.vue';

describe('DVButton', () => {
  it('默认渲染 primary 变体', () => {
    const wrapper = mount(DVButton, { slots: { default: '确定' } });
    expect(wrapper.classes()).toContain('dv-button--primary');
    expect(wrapper.text()).toContain('确定');
  });

  it('渲染各变体 class', () => {
    const variants = ['primary', 'secondary', 'danger', 'ghost'] as const;
    for (const variant of variants) {
      const wrapper = mount(DVButton, { props: { variant } });
      expect(wrapper.classes()).toContain(`dv-button--${variant}`);
    }
  });

  it('渲染尺寸 class', () => {
    const wrapper = mount(DVButton, { props: { size: 'lg' } });
    expect(wrapper.classes()).toContain('dv-button--lg');
  });

  it('点击触发 click 事件', async () => {
    const wrapper = mount(DVButton);
    await wrapper.trigger('click');
    expect(wrapper.emitted('click')).toHaveLength(1);
  });

  it('禁用时不触发 click 且带禁用样式', async () => {
    const wrapper = mount(DVButton, { props: { disabled: true } });
    await wrapper.trigger('click');
    expect(wrapper.emitted('click')).toBeUndefined();
    expect(wrapper.attributes('disabled')).toBeDefined();
    expect(wrapper.classes()).toContain('dv-button--disabled');
  });

  it('block 模式带宽度 class', () => {
    const wrapper = mount(DVButton, { props: { block: true } });
    expect(wrapper.classes()).toContain('dv-button--block');
  });
});
