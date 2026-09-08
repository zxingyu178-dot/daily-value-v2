import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import DVInput from '@/components/design/DVInput.vue';

describe('DVInput', () => {
  it('文字模式直接输出输入值', async () => {
    const wrapper = mount(DVInput, { props: { modelValue: '' } });
    const input = wrapper.find('input');
    await input.setValue('hello');
    expect(wrapper.emitted('update:modelValue')).toEqual([['hello']]);
  });

  it('金额模式仅保留数字与小数点', async () => {
    const wrapper = mount(DVInput, { props: { modelValue: '', mode: 'amount' } });
    const input = wrapper.find('input');
    await input.setValue('12abc3.4.5');
    expect(wrapper.emitted('update:modelValue')).toEqual([['123.45']]);
  });

  it('金额模式最多两位小数', async () => {
    const wrapper = mount(DVInput, { props: { modelValue: '', mode: 'amount' } });
    const input = wrapper.find('input');
    await input.setValue('1.999');
    expect(wrapper.emitted('update:modelValue')).toEqual([['1.99']]);
  });

  it('金额模式去除整数前导零', async () => {
    const wrapper = mount(DVInput, { props: { modelValue: '', mode: 'amount' } });
    const input = wrapper.find('input');
    await input.setValue('007');
    expect(wrapper.emitted('update:modelValue')).toEqual([['7']]);
  });

  it('禁用态不可输入', () => {
    const wrapper = mount(DVInput, { props: { disabled: true } });
    expect(wrapper.find('input').attributes('disabled')).toBeDefined();
  });

  it('label 渲染', () => {
    const wrapper = mount(DVInput, { props: { label: '金额' } });
    expect(wrapper.text()).toContain('金额');
  });
});
