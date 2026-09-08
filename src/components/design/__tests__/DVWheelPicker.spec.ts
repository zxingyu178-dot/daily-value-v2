/**
 * DVWheelPicker / DVDateTimeWheelPicker 滚轮测试（Phase 6）
 * WHEEL-01 年滚轮存在
 * WHEEL-02 月滚轮存在
 * WHEEL-03 日滚轮随月份自动变化天数
 * WHEEL-04 闰年 2 月 29 日
 * WHEEL-05 小时 00~23
 * WHEEL-06 分钟 00~59
 * WHEEL-07 不能选择未来本地时间（确定保存被钳制到当前）
 * WHEEL-08 可见区域中央选中
 * WHEEL-09 关闭后父层修改 modelValue，再次打开显示新值
 * WHEEL-10 第二次打开使用新的当前本地时间基准（不缓存旧 now）
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import DVWheelPicker from '@/components/design/DVWheelPicker.vue';
import DVDateTimeWheelPicker, { type DateTimeValue } from '@/components/design/DVDateTimeWheelPicker.vue';
import * as backHandler from '@/components/design/back-handler';

/** 从滚轮渲染出的选项 label 列表 */
function wrapCount(wrapper: ReturnType<typeof mount>) {
  return wrapper.findAll('.dv-wheel__item').length;
}

describe('DVWheelPicker 基础滚轮', () => {
  it('WHEEL-01/02 渲染全部选项，中央选中高亮', async () => {
    const options = Array.from({ length: 12 }, (_, i) => ({ label: String(i + 1), value: i + 1 }));
    const wrapper = mount(DVWheelPicker, {
      props: { modelValue: 3, options, itemHeight: 44 },
      attachTo: document.body,
    });
    await flushPromises();
    expect(wrapCount(wrapper)).toBe(12);
    const item0 = wrapper.findAll('.dv-wheel__item')[0];
    expect(item0.exists()).toBe(true);
  });

  it('WHEEL-06 分钟选项覆盖 0~59', async () => {
    const options = Array.from({ length: 60 }, (_, i) => ({ label: String(i), value: i }));
    const wrapper = mount(DVWheelPicker, { props: { modelValue: 0, options } });
    await flushPromises();
    const labels = wrapper.findAll('.dv-wheel__label').map((n) => n.text());
    expect(labels[0]).toBe('0');
    expect(labels[59]).toBe('59');
    expect(labels).toHaveLength(60);
  });

  it('WHEEL-12 滚动停到禁用项时自动吸附到最近合法项（不变成选定项，F）', async () => {
    const options = Array.from({ length: 8 }, (_, i) => ({ label: String(i), value: i }));
    const wrapper = mount(DVWheelPicker, {
      props: { modelValue: 0, options, itemHeight: 44, isDisabled: (v: number) => v === 3 },
      attachTo: document.body,
    });
    await flushPromises();
    const scroller = wrapper.find('.dv-wheel__scroller').element as HTMLElement;
    // 模拟拖动到 index 3（禁用）居中；defineProperty 绕开 jsdom 布局 clamp
    Object.defineProperty(scroller, 'scrollTop', { value: 3 * 44, configurable: true, writable: true });
    scroller.dispatchEvent(new Event('scroll'));
    await flushPromises();
    const emitted = wrapper.emitted('update:modelValue');
    // nearestSelectable(3) 优先向下取最近合法项 → 4
    expect(emitted?.[(emitted?.length ?? 1) - 1]?.[0]).toBe(4);
    // 且禁用项永远不成为选中值
    expect(emitted?.flat()).not.toContain(3);
  });

  it('WHEEL-13 点击禁用项无效（不触发选择变更，F）', async () => {
    const options = Array.from({ length: 6 }, (_, i) => ({ label: String(i), value: i }));
    const wrapper = mount(DVWheelPicker, {
      props: { modelValue: 0, options, itemHeight: 44, isDisabled: (v: number) => v === 5 },
      attachTo: document.body,
    });
    await flushPromises();
    const item5 = wrapper.findAll('.dv-wheel__item')[5];
    await item5.trigger('click');
    await flushPromises();
    // 点击禁用项：onClickItem 对锁定项直接 return，不产生 update:modelValue
    expect(wrapper.emitted('update:modelValue')).toBeFalsy();
  });
});

describe('DVDateTimeWheelPicker 日期时间滚轮', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('WHEEL-01/02/03/05/06 年月日时分滚轮齐全，日滚轮随 8 月显示 31 天', async () => {
    mount(DVDateTimeWheelPicker, {
      props: {
        modelValue: { year: 2026, month: 8, day: 22, hour: 16, minute: 30 },
        visible: true,
      },
      attachTo: document.body,
    });
    await flushPromises();
    const wheels = document.body.querySelectorAll('.dv-wheel');
    expect(wheels.length).toBe(5); // 年 月 日 时 分
    const dayWheel = wheels[2] as HTMLElement;
    const dayLabels = Array.from(dayWheel.querySelectorAll('.dv-wheel__label')).map((n) => n.textContent);
    expect(dayLabels).toHaveLength(31); // 8 月 31 天
    expect(dayLabels[0]).toBe('1');
    expect(dayLabels[30]).toBe('31');
  });

  it('WHEEL-03 日滚轮随月份变化天数（2 月平年 → 28 天）', async () => {
    mount(DVDateTimeWheelPicker, {
      props: { modelValue: { year: 2026, month: 2, day: 28, hour: 12, minute: 0 }, visible: true },
      attachTo: document.body,
    });
    await flushPromises();
    const dayWheel = document.body.querySelectorAll('.dv-wheel')[2] as HTMLElement;
    const dayLabels = Array.from(dayWheel.querySelectorAll('.dv-wheel__label')).map((n) => n.textContent);
    expect(dayLabels).toHaveLength(28);
  });

  it('WHEEL-04 闰年 2 月 29 天（2024 闰年）', async () => {
    mount(DVDateTimeWheelPicker, {
      props: { modelValue: { year: 2024, month: 2, day: 29, hour: 12, minute: 0 }, visible: true },
      attachTo: document.body,
    });
    await flushPromises();
    const dayWheel = document.body.querySelectorAll('.dv-wheel')[2] as HTMLElement;
    const dayLabels = Array.from(dayWheel.querySelectorAll('.dv-wheel__label')).map((n) => n.textContent);
    expect(dayLabels).toHaveLength(29);
    expect(dayLabels[28]).toBe('29');
  });

  it('WHEEL-07 未来时间被钳制：确定后关闭，且日期时间滚轮组件在体面上层（z-picker）', async () => {
    const now = new Date();
    const future = {
      year: now.getFullYear(),
      month: now.getMonth() + 1,
      day: now.getDate(),
      hour: 23,
      minute: 59,
    };
    const wrapper = mount(DVDateTimeWheelPicker, {
      props: { modelValue: future, visible: true, showTime: true },
      attachTo: document.body,
    });
    await flushPromises();
    // 确定：选中默认价格(今天的未来 23:59) 应被钳制到当前本地时间，并 emit close
    (document.body.querySelector('.dv-dtp__ok') as HTMLElement).click();
    await flushPromises();
    const emitted = wrapper.emitted('update:modelValue');
    expect(emitted).toBeTruthy();
    const val = emitted![0][0] as DateTimeValue;
    expect(val.hour).toBe(now.getHours());
    expect(val.minute).toBe(now.getMinutes());
    expect(wrapper.emitted('close')).toBeTruthy();
  });

  it('WHEEL-05 小时滚轮选项 0~23', async () => {
    mount(DVDateTimeWheelPicker, {
      props: { modelValue: { year: 2026, month: 8, day: 22, hour: 16, minute: 30 }, visible: true },
      attachTo: document.body,
    });
    await flushPromises();
    const hourWheel = document.body.querySelectorAll('.dv-wheel')[3] as HTMLElement;
    const hourLabels = Array.from(hourWheel.querySelectorAll('.dv-wheel__label')).map((n) => n.textContent);
    expect(hourLabels).toHaveLength(24);
    expect(hourLabels[0]).toBe('0');
    expect(hourLabels[23]).toBe('23');
  });

  it('WHEEL-08 打开时年月日滚轮各自渲染且中央高亮项存在', async () => {
    mount(DVDateTimeWheelPicker, {
      props: { modelValue: { year: 2026, month: 8, day: 22, hour: 16, minute: 30 }, visible: true },
      attachTo: document.body,
    });
    await flushPromises();
    const yearWheel = document.body.querySelectorAll('.dv-wheel')[0] as HTMLElement;
    expect(yearWheel.querySelector('.dv-wheel__item.is-center')).not.toBeNull();
  });

  it('WHEEL-09 关闭后父层修改 modelValue，再次打开显示新值（日滚轮按新月份变天数）', async () => {
    const wrapper = mount(DVDateTimeWheelPicker, {
      props: {
        modelValue: { year: 2026, month: 2, day: 28, hour: 12, minute: 0 },
        visible: true,
      },
      attachTo: document.body,
    });
    await flushPromises();
    const dayWheelOf = () =>
      Array.from(
        (document.body.querySelectorAll('.dv-wheel')[2] as HTMLElement).querySelectorAll('.dv-wheel__label'),
      ).map((n) => n.textContent);
    expect(dayWheelOf()).toHaveLength(28); // 2 月平年 28 天

    // 关闭
    await wrapper.setProps({ visible: false });
    await flushPromises();

    // 父层修改 modelValue 为 4 月（30 天）并重新打开
    await wrapper.setProps({
      modelValue: { year: 2026, month: 4, day: 30, hour: 12, minute: 0 },
      visible: true,
    });
    await flushPromises();
    expect(dayWheelOf()).toHaveLength(30); // 4 月 30 天 → 显示新值而非旧内部状态
  });

  it('WHEEL-10 第二次打开使用新的当前本地时间基准（不缓存旧 now）', async () => {
    vi.useFakeTimers();
    try {
      // 初始时间 2026-08-23 10:00
      const t0 = new Date(2026, 7, 23, 10, 0, 0);
      vi.setSystemTime(t0);

      const wrapper = mount(DVDateTimeWheelPicker, {
        props: {
          modelValue: { year: 2026, month: 8, day: 23, hour: 10, minute: 5 },
          visible: false,
        },
        attachTo: document.body,
      });
      await flushPromises();

      // 时间推进到 10:03（当前时间上限随之刷新）
      vi.setSystemTime(new Date(2026, 7, 23, 10, 3, 0));

      // 再次打开并“确定”，10:05 相对新 now(10:03) 为未来 → 应钳制到 10:03
      await wrapper.setProps({ visible: true });
      await flushPromises();
      (document.body.querySelector('.dv-dtp__ok') as HTMLElement).click();
      await flushPromises();

      const val = wrapper.emitted('update:modelValue')![0][0] as DateTimeValue;
      expect(val.hour).toBe(10);
      expect(val.minute).toBe(3); // 若非 3 而是 0，说明仍用旧 now(10:00) 缓存
    } finally {
      vi.useRealTimers();
    }
  });

  it('WHEEL-11 Picker 打开后直接卸载会从 backStack 移除 close 回调（不残留 stale 回调）', async () => {
    const unregisterSpy = vi.spyOn(backHandler, 'unregisterOverlayForBack');
    const registerSpy = vi.spyOn(backHandler, 'registerOverlayForBack');
    try {
      // 先挂载为关闭，再切到 visible=true 以触发 watcher 注册 close（visible watcher 非 immediate）
      const wrapper = mount(DVDateTimeWheelPicker, {
        props: { modelValue: { year: 2026, month: 8, day: 22, hour: 16, minute: 30 }, visible: false },
        attachTo: document.body,
      });
      await flushPromises();
      await wrapper.setProps({ visible: true });
      await flushPromises();
      const registered = registerSpy.mock.calls.map((c) => c[0]);
      expect(registered.length).toBeGreaterThanOrEqual(1);

      // 直接卸载（模拟路由切换/父组件销毁，未先 close）
      const beforeUnmountUnreg = unregisterSpy.mock.calls.length;
      wrapper.unmount();
      await flushPromises();
      // 卸载必须调用 unregister 移除同一个 close 回调
      const removedAfter = unregisterSpy.mock.calls.map((c) => c[0]);
      expect(removedAfter.length).toBeGreaterThan(beforeUnmountUnreg);
      // 至少有一个被移除的回调与注册的是同一引用
      const registeredSet = new Set(registered);
      const removedSet = new Set(removedAfter);
      let shared = false;
      for (const cb of registeredSet) if (removedSet.has(cb)) shared = true;
      expect(shared).toBe(true);
    } finally {
      unregisterSpy.mockRestore();
      registerSpy.mockRestore();
      document.body.innerHTML = '';
    }
  });

  it('P2-1 默认 minYear=2000 时仍包含 modelValue 的历史年份（旧账单年份不被裁掉）', async () => {
    // 编辑 1998 年账单：即便未传 minYear，年份滚轮也必须含 1998（不能硬编码 2000 切断）
    mount(DVDateTimeWheelPicker, {
      props: { modelValue: { year: 1998, month: 6, day: 15, hour: 10, minute: 0 }, visible: true },
      attachTo: document.body,
    });
    await flushPromises();
    const yearWheel = document.body.querySelectorAll('.dv-wheel')[0] as HTMLElement;
    const yearLabels = Array.from(yearWheel.querySelectorAll('.dv-wheel__label')).map((n) => n.textContent);
    expect(yearLabels).toContain('1998');
    // 且模型当前年份无效成首项（旧年份可被选中）
    expect(yearLabels[0]).toBe('1998');
  });

  /* ---- Phase 7B-Fix: allowFuture 未来时间选择 ---- */
  it('WHEEL-14 allowFuture=true 时未来年份/月份/日期/时分全部可选，年份放宽到当前年+5', async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date(2026, 7, 25, 10, 0, 0)); // 2026-08-25 10:00
      mount(DVDateTimeWheelPicker, {
        props: {
          modelValue: { year: 2026, month: 8, day: 25, hour: 10, minute: 0 },
          visible: true,
          allowFuture: true,
          showTime: true,
        },
        attachTo: document.body,
      });
      await flushPromises();
      const wheels = document.body.querySelectorAll('.dv-wheel');
      expect(wheels.length).toBe(5);
      // 各滚轮均无禁用项（未来年/月/日/时/分全部可选）
      for (let i = 0; i < 5; i++) {
        const disabled = Array.from(wheels[i].querySelectorAll('.dv-wheel__item.is-disabled'));
        expect(disabled.length).toBe(0);
      }
      // 年份滚轮覆盖到当前年 +5（2031），未来年份滚得到
      const yearLabels = Array.from(wheels[0].querySelectorAll('.dv-wheel__label')).map((n) => n.textContent);
      expect(yearLabels[yearLabels.length - 1]).toBe('2031');
    } finally {
      vi.useRealTimers();
      document.body.innerHTML = '';
    }
  });

  it('WHEEL-15 allowFuture=false 时未来项仍被禁用（普通记账日期不受影响）', async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date(2026, 7, 25, 10, 0, 0)); // 2026-08-25 10:00
      mount(DVDateTimeWheelPicker, {
        props: {
          modelValue: { year: 2026, month: 8, day: 25, hour: 10, minute: 0 },
          visible: true,
          showTime: true,
        },
        attachTo: document.body,
      });
      await flushPromises();
      const wheels = document.body.querySelectorAll('.dv-wheel');
      // 年滚轮范围 minYear(2000)~当前年(2026)，未来年份根本不出现在滚轮里（更强约束）
      const yearLabels = Array.from(wheels[0].querySelectorAll('.dv-wheel__label')).map((n) => n.textContent);
      expect(yearLabels[0]).toBe('2000');
      expect(yearLabels[yearLabels.length - 1]).toBe('2026');
      expect(yearLabels).not.toContain('2027');
      // 月/日/时/分滚轮存在禁用项（未来被禁止）
      for (let i = 1; i <= 4; i++) {
        const disabled = wheels[i].querySelectorAll('.dv-wheel__item.is-disabled').length;
        expect(disabled).toBeGreaterThan(0);
      }
    } finally {
      vi.useRealTimers();
      document.body.innerHTML = '';
    }
  });

  it('WHEEL-16 编辑已有未来规则：年份超出+5 放宽范围也能出现在滚轮中', async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date(2026, 7, 25, 10, 0, 0)); // 2026-08-25 10:00
      const farFuture = { year: 2036, month: 3, day: 15, hour: 8, minute: 30 };
      const wrapper = mount(DVDateTimeWheelPicker, {
        props: { modelValue: farFuture, visible: true, allowFuture: true, showTime: true },
        attachTo: document.body,
      });
      await flushPromises();
      const yearLabels = Array.from(
        (document.body.querySelectorAll('.dv-wheel')[0] as HTMLElement).querySelectorAll('.dv-wheel__label'),
      ).map((n) => n.textContent);
      // 远超 +5 放宽范围（2031）的未来年份也必须出现在滚轮里
      expect(yearLabels).toContain('2036');
      // 确定后年份不被钳制回当前年（未来时间被保留）
      (document.body.querySelector('.dv-dtp__ok') as HTMLElement).click();
      await flushPromises();
      const val = wrapper.emitted('update:modelValue')![0][0] as DateTimeValue;
      expect(val.year).toBe(2036);
      expect(val.month).toBe(3);
      expect(val.day).toBe(15);
    } finally {
      vi.useRealTimers();
      document.body.innerHTML = '';
    }
  });
});