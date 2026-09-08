/**
 * RecurringEditorSheet 日期时间 Picker 状态测试（Phase 7A-Fix2）
 * - REC-DATE-01 打开 Picker → 改成新日期时间 → Confirm → 再打开 Picker → 当前选中仍是新日期时间
 * - REC-DATE-02 修改后保存规则 → DB startDate/time 与当前 Picker 一致
 * 通过真实 DVWheelPicker 驱动 DVDateTimeWheelPicker，再点“确定”让 Sheet 接收 emit 的新值。
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { openDatabase } from '@/core/db/database';
import { services } from '@/core/services';
import RecurringEditorSheet from '@/pages/settings/RecurringEditorSheet.vue';
import DVDateTimeWheelPicker from '@/components/design/DVDateTimeWheelPicker.vue';
import DVWheelPicker from '@/components/design/DVWheelPicker.vue';
import type { DateTimeValue } from '@/components/design/DVDateTimeWheelPicker.vue';
import type { RecurringRule } from '@/core/models/types';

const STORES = ['bills', 'categories', 'settings', 'meta', 'recurringRules'] as const;

async function resetDb(): Promise<void> {
  const db = await openDatabase();
  const tx = db.transaction(STORES, 'readwrite');
  for (const s of STORES) tx.objectStore(s).clear();
  await tx.done;
  localStorage.clear();
}

/** 预置一个分类（自定义 id 不受 Category.add 限制，此处仅确保分类存在） */
async function seedCategory(): Promise<void> {
  await services.categories.add({ name: '餐饮', emoji: '🍚', builtin: true, sort: 1 });
}

async function mountSheet(): Promise<ReturnType<typeof mount<typeof RecurringEditorSheet>>> {
  const pinia = createPinia();
  setActivePinia(pinia);
  const wrapper = mount(RecurringEditorSheet, {
    props: { modelValue: true },
    global: { plugins: [pinia] },
  });
  await flushPromises();
  await new Promise((r) => setTimeout(r, 0));
  await flushPromises();
  return wrapper;
}

/** 打开日期时间 Picker，驱动 5 个滚轮改为 dt，然后“确定” */
async function pickDateTime(
  wrapper: Awaited<ReturnType<typeof mountSheet>>,
  dt: DateTimeValue,
) {
  document.body.querySelector<HTMLElement>('.rf-datetime')!.click();
  await flushPromises();
  const picker = wrapper.findComponent(DVDateTimeWheelPicker);
  expect(picker.exists()).toBe(true);
  const wheels = picker.findAllComponents(DVWheelPicker);
  expect(wheels.length).toBe(5); // 年/月/日/时/分
  const [yW, moW, dW, hW, minW] = wheels;
  yW.vm.$emit('update:modelValue', dt.year);
  moW.vm.$emit('update:modelValue', dt.month);
  dW.vm.$emit('update:modelValue', dt.day);
  hW.vm.$emit('update:modelValue', dt.hour);
  minW.vm.$emit('update:modelValue', dt.minute);
  await flushPromises();
  document.body.querySelector<HTMLElement>('.dv-dtp__ok')!.click();
  await flushPromises();
}

describe('RecurringEditorSheet 日期时间 Picker 状态（Phase 7A-Fix2）', () => {
  beforeEach(resetDb);

  it('REC-DATE-01 打开→改新日期时间→Confirm→再打开→当前选中仍是新日期时间', async () => {
    await seedCategory();
    const wrapper = await mountSheet();

    // 第一次打开并选 9/10 10:30
    await pickDateTime(wrapper, { year: 2026, month: 9, day: 10, hour: 10, minute: 30 });
    // 表单入口文本已更新
    expect(document.body.querySelector<HTMLElement>('.rf-datetime')!.textContent).toContain('2026-09-10 10:30');

    // 关闭后再次打开：Picker 的 modelValue 必须是刚刚选择的新值（不允许回落旧值）
    document.body.querySelector<HTMLElement>('.rf-datetime')!.click();
    await flushPromises();
    const reopened = wrapper.findComponent(DVDateTimeWheelPicker);
    const m = reopened.props('modelValue') as DateTimeValue;
    expect(m.year).toBe(2026);
    expect(m.month).toBe(9);
    expect(m.day).toBe(10);
    expect(m.hour).toBe(10);
    expect(m.minute).toBe(30);
    // 清理：关闭
    document.body.querySelector<HTMLElement>('.dv-dtp__cancel')!.click();
    await flushPromises();
  });

  it('REC-DATE-02 修改后保存规则 → DB startDate/time 与当前 Picker 一致', async () => {
    await seedCategory();
    const wrapper = await mountSheet();
    await pickDateTime(wrapper, { year: 2026, month: 12, day: 1, hour: 21, minute: 45 });

    // 填金额并保存
    const amountInput = document.body.querySelector<HTMLInputElement>('.dv-input__field--amount')!;
    amountInput.value = '88.5';
    amountInput.dispatchEvent(new Event('input'));
    await flushPromises();
    document.body.querySelector<HTMLElement>('.rr-footer__save')!.click();
    await flushPromises();
    await new Promise((r) => setTimeout(r, 0));
    await flushPromises();

    const rules = (await services.recurringRules.list()) as RecurringRule[];
    expect(rules).toHaveLength(1);
    expect(rules[0].startDate).toBe('2026-12-01');
    expect(rules[0].time).toBe('21:45');
    expect(rules[0].amount).toBe(88.5);
  });
});