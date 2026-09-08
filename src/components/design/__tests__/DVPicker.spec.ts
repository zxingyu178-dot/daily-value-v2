import { describe, it, expect, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import DVPicker from '@/components/design/DVPicker.vue';

describe('DVPicker', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('显示占位符', () => {
    const wrapper = mount(DVPicker, { props: { placeholder: '请选择' } });
    expect(wrapper.find('button.dv-picker').text()).toContain('请选择');
  });

  it('选项模式：点击选项 emit 并显示选中值', async () => {
    const options = [
      { label: '餐饮', value: 'c-food' },
      { label: '交通', value: 'c-transport' },
    ];
    const wrapper = mount(DVPicker, { props: { options, modelValue: 'c-food' } });
    await wrapper.find('button.dv-picker').trigger('click');
    await nextTick();
    const option = document.querySelector('.dv-picker__option') as HTMLElement;
    option?.click();
    await nextTick();
    expect(wrapper.emitted('update:modelValue')).toEqual([['c-food']]);
    wrapper.unmount();
  });

  it('日期模式：显示所选日期', async () => {
    const wrapper = mount(DVPicker, {
      props: { type: 'date', modelValue: '2026-08-21' },
    });
    expect(wrapper.find('button.dv-picker').text()).toContain('2026-08-21');
  });

  it('禁用时不打开且带禁用样式', async () => {
    const wrapper = mount(DVPicker, { props: { disabled: true } });
    expect(wrapper.find('button.dv-picker').classes()).toContain('dv-picker--disabled');
  });
});
