/**
 * Recurring Editor 交互结构 UI 测试（Phase 7A-Fix3-UX）
 * 覆盖 RR-UI-01..07：
 *   - 主表单不再内嵌常驻滚轮（修复「每月日期滚轮铺满 Sheet」）
 *   - 周期日期 = 紧凑选择行 → 独立 RecurringPeriodPicker（复用 DVWheelPicker，固定高 132px）
 *   - weekly/monthly/yearly 各自字形；yearly 月/日左右并排
 *   - Cancel 不改值；确定才写回；Android Back LIFO
 *   - 412×915 下无内嵌大滚轮、保存按钮可达
 * jsdom 无法计算真实布局，尺寸用 DVWheelPicker 内联固定高度（44*3=132px）断言，
 * 真实溢出/像素由 Android 模拟器截图验收（RR-SHOT-01..08）。
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { openDatabase } from '@/core/db/database';
import { services } from '@/core/services';
import RecurringEditorSheet from '@/pages/settings/RecurringEditorSheet.vue';
import RecurringPeriodPicker from '@/pages/settings/RecurringPeriodPicker.vue';
import DVWheelPicker from '@/components/design/DVWheelPicker.vue';
import { __getBackOverlayStack } from '@/components/design/back-handler';

const STORES = ['bills', 'categories', 'settings', 'meta', 'recurringRules'] as const;

async function resetDb(): Promise<void> {
  const db = await openDatabase();
  const tx = db.transaction(STORES, 'readwrite');
  for (const s of STORES) tx.objectStore(s).clear();
  await tx.done;
  localStorage.clear();
  document.body.innerHTML = '';
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (__getBackOverlayStack() as unknown as Array<() => void>).length = 0;
}

async function seedCategory(): Promise<void> {
  await services.categories.add({ name: '餐饮', emoji: '🍚', builtin: true, sort: 1 });
}

type SheetMount = Promise<ReturnType<typeof mount<typeof RecurringEditorSheet>>>;

async function mountSheet(): Promise<Awaited<SheetMount>> {
  const pinia = createPinia();
  setActivePinia(pinia);
  const wrapper = mount(RecurringEditorSheet, { props: { modelValue: true }, global: { plugins: [pinia] } });
  await flushPromises();
  await new Promise((r) => setTimeout(r, 0));
  await flushPromises();
  return wrapper;
}

async function setFreq(label: string): Promise<void> {
  const btn = [...document.querySelectorAll<HTMLElement>('.rf-freq__item')].find((b) => b.textContent.trim() === label);
  expect(btn).toBeTruthy();
  btn!.click();
  await flushPromises();
}

async function openPeriod(): Promise<void> {
  const row = document.querySelector<HTMLElement>('.rf-period');
  expect(row).toBeTruthy();
  row!.click();
  await flushPromises();
  await new Promise((r) => setTimeout(r, 0));
  await flushPromises();
  expect(document.querySelector('.rpp')).toBeTruthy();
}

function rrFormWheels(): number {
  return document.querySelectorAll('.rr-form .dv-wheel').length;
}

describe('Recurring Editor 交互结构（RR-UI，Phase 7A-Fix3-UX）', () => {
  beforeEach(resetDb);

  it('RR-UI-01 monthly：主 Sheet 无常驻滚轮，显示「每月日期 N 日 ›」', async () => {
    await seedCategory();
    await mountSheet();
    expect(rrFormWheels()).toBe(0); // 主表单绝不内嵌滚轮
    const row = document.querySelector<HTMLElement>('.rf-period');
    expect(row).toBeTruthy();
    expect(row!.textContent).toMatch(/\d+ 日/); // 每月日期 xx 日
    expect(row!.textContent).toContain('›');
    await openPeriod();
    expect(rrFormWheels()).toBe(0); // 打开 Picker 后主表单仍无滚轮
  });

  it('RR-UI-02：点「每月日期」打开独立 Picker，滚轮高 132~220px', async () => {
    await seedCategory();
    await mountSheet();
    await openPeriod();
    const wheels = document.querySelectorAll<HTMLElement>('.rpp .dv-wheel');
    expect(wheels.length).toBe(1); // monthly 单滚轮
    const n = Number.parseFloat(wheels[0].style.height);
    expect(n).toBeGreaterThanOrEqual(132);
    expect(n).toBeLessThanOrEqual(220);
  });

  it('RR-UI-03 weekly：7 个星期，确认周五后表单显示「周五」', async () => {
    await seedCategory();
    const wrapper = await mountSheet();
    await setFreq('每周');
    await openPeriod();
    const picker = wrapper.findComponent(RecurringPeriodPicker);
    const wheels = picker.findAllComponents(DVWheelPicker);
    expect(wheels.length).toBe(1);
    expect((wheels[0].props('options') as Array<{ label: string; value: number }>).length).toBe(7);
    wheels[0].vm.$emit('update:modelValue', 5); // 周五
    await flushPromises();
    document.querySelector<HTMLElement>('.rpp__ok')!.click();
    await flushPromises();
    expect(document.querySelector<HTMLElement>('.rf-period')!.textContent).toContain('周五');
  });

  it('RR-UI-04 yearly：月/日两滚轮左右并排，确认 8月24日', async () => {
    await seedCategory();
    const wrapper = await mountSheet();
    await setFreq('每年');
    await openPeriod();
    const row = document.querySelector<HTMLElement>('.rpp__row--double');
    expect(row).toBeTruthy();
    // 横向排列（flex-direction: row），修复旧「rf-row 纵向 50% 堆叠」
    expect(getComputedStyle(row!).flexDirection).toBe('row');
    const picker = wrapper.findComponent(RecurringPeriodPicker);
    const wheels = picker.findAllComponents(DVWheelPicker);
    expect(wheels.length).toBe(2); // 月 + 日
    wheels[0].vm.$emit('update:modelValue', 8); // 8 月
    wheels[1].vm.$emit('update:modelValue', 24); // 24 日
    await flushPromises();
    document.querySelector<HTMLElement>('.rpp__ok')!.click();
    await flushPromises();
    expect(document.querySelector<HTMLElement>('.rf-period')!.textContent).toContain('8 月 24 日');
  });

  it('RR-UI-05：Picker Cancel 不改变原值', async () => {
    await seedCategory();
    const wrapper = await mountSheet();
    const before = document.querySelector<HTMLElement>('.rf-period')!.textContent;
    await openPeriod();
    // 改变草稿（驱动月份滚轮），但不点确定
    const picker = wrapper.findComponent(RecurringPeriodPicker);
    picker.findAllComponents(DVWheelPicker)[0].vm.$emit('update:modelValue', 15);
    await flushPromises();
    document.querySelector<HTMLElement>('.rpp__cancel')!.click();
    await flushPromises();
    expect(document.querySelector<HTMLElement>('.rf-period')!.textContent).toBe(before);
  });

  it('RR-UI-06：Android Back 先关 Picker，再关 Editor（严格 LIFO）', async () => {
    await seedCategory();
    const wrapper = await mountSheet();
    const stackBefore = __getBackOverlayStack().length;
    expect(stackBefore).toBeGreaterThan(0); // editor(DVSheet) 已注册
    await openPeriod();
    const stackWithPicker = __getBackOverlayStack().length;
    expect(stackWithPicker).toBeGreaterThan(stackBefore); // Picker 压栈到最顶层
    // 第一次 Back：弹出最顶层（Picker 的 close）→ 关闭 Picker，Editor 仍打开
    (__getBackOverlayStack() as unknown as Array<() => void>).pop()!();
    await flushPromises();
    expect(document.querySelector('.rpp')).toBeFalsy(); // Picker 已关
    expect(document.querySelector('.rr-form')).toBeTruthy(); // Editor 未关（LIFO：先关的是 Picker）
    // 第二次 Back：弹出下一层（Editor 的 close）→ 触发 Editor 关闭（父级收到 update:modelValue=false）
    (__getBackOverlayStack() as unknown as Array<() => void>).pop()!();
    await flushPromises();
    const events = wrapper.emitted('update:modelValue');
    expect(events?.[events.length - 1]).toEqual([false]); // Editor 已请求关闭
  });

  it('RR-UI-07：412×915 下内容有界、保存按钮可达、无横向滚动结构', async () => {
    await seedCategory();
    await mountSheet();
    expect(rrFormWheels()).toBe(0); // 无内嵌滚轮 → 内容不被撑高
    const save = document.querySelector<HTMLElement>('.rr-footer__save');
    expect(save).toBeTruthy(); // 保存按钮可达
    expect(save!.closest('.rr-footer')).toBeTruthy(); // 位于 Sheet 内 sticky footer
    expect(document.querySelector('.rr-form .rf-wheel')).toBeFalsy(); // 旧样式类已废除
  });
});