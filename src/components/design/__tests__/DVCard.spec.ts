import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import DVCard from '@/components/design/DVCard.vue';

describe('DVCard', () => {
  it('渲染默认卡片与默认 padding', () => {
    const wrapper = mount(DVCard, { slots: { default: '内容' } });
    expect(wrapper.classes()).toContain('dv-card');
    expect(wrapper.classes()).toContain('dv-card--pad-md');
    expect(wrapper.text()).toContain('内容');
  });

  it('渲染 outlined / frosted / elevation class', () => {
    const wrapper = mount(DVCard, {
      props: { outlined: true, frosted: true, elevation: 'md' },
    });
    expect(wrapper.classes()).toContain('dv-card--outlined');
    expect(wrapper.classes()).toContain('dv-card--frosted');
    expect(wrapper.classes()).toContain('dv-card--elev-md');
  });

  it('点击触发 click 事件', async () => {
    const wrapper = mount(DVCard, { props: { clickable: true } });
    await wrapper.trigger('click');
    expect(wrapper.emitted('click')).toHaveLength(1);
  });
});
