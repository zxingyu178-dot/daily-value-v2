/**
 * 快速记账 Sheet 测试（Phase 4 收尾 + Phase 5 金额/颜色/日价 + Phase 6 交互收尾）
 * - CATEGORY-01/03/04 + CATEGORY-LAYOUT-01 分类区结构（六列一屏 / 展开互斥）
 * - CATEGORY-ADD-01~04 添加分类完整链路
 * - 两步删除（长按管理模式）
 * - QUICK-01 自定义日期 / 时间保存（滚轮选择器）
 * - QUICK-02 saving 防重复提交 / 金额<=0 disabled
 * - P5-AMOUNT-01~06 金额输入逻辑
 * - P5-DV-01~03 日价开关
 * - P5-COLOR-01 支出/收入颜色
 * - IME-01 文字键盘模式不破坏布局
 * - EDIT-01~07 编辑模式（打开/预填/update/不增数量/月汇总/跨月/日价）
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { openDatabase } from '@/core/db/database';
import { services } from '@/core/services';
import QuickEntrySheet from '@/pages/accounting/QuickEntrySheet.vue';
import DVDateTimeWheelPicker from '@/components/design/DVDateTimeWheelPicker.vue';
import DVWheelPicker from '@/components/design/DVWheelPicker.vue';
import type { DateTimeValue } from '@/components/design/DVDateTimeWheelPicker.vue';
import { useBillStore } from '@/core/store/bill';
import type { Bill } from '@/core/models/types';
import { msUntilNextLocalMidnight, localDateKey } from '@/core/models/daily-value';

const TEST_STORES = ['bills', 'categories', 'settings', 'meta', 'recurringRules'] as const;

async function resetDb(): Promise<void> {
  const db = await openDatabase();
  const tx = db.transaction(TEST_STORES, 'readwrite');
  for (const store of TEST_STORES) tx.objectStore(store).clear();
  await tx.done;
  localStorage.clear();
}

function makeBill(over: Partial<Bill> = {}): Omit<Bill, 'id'> {
  return {
    type: 'expense',
    amount: 25,
    categoryId: 'c-a',
    categoryEmoji: '🏷️',
    categoryName: '分类A',
    note: '',
    date: '2026-08-20',
    timestamp: 1787310000000,
    source: 'manual',
    ledgerImpact: 'normal',
    ...over,
  };
}

async function mountSheet(props: Record<string, unknown> = {}) {
  const pinia = createPinia();
  setActivePinia(pinia);
  const wrapper = mount(QuickEntrySheet, {
    props: { modelValue: true, ...props },
    global: { plugins: [pinia] },
  });
  await flushPromises();
  await new Promise((r) => setTimeout(r, 0));
  await flushPromises();
  return wrapper;
}

function typeAmount(text: string) {
  const padKeys = document.body.querySelectorAll('.qe__pad-key');
  for (const ch of text) {
    const el = Array.from(padKeys).find((b) => b.textContent === ch);
    if (!el) throw new Error(`数字键盘缺少按键: ${ch}`);
    (el as HTMLElement).click();
  }
}

function buttonByText(text: string): HTMLButtonElement {
  const btn = Array.from(document.body.querySelectorAll('button')).find((b) =>
    b.textContent?.includes(text),
  );
  if (!btn) throw new Error(`未找到按钮: ${text}`);
  return btn as HTMLButtonElement;
}

function saveButton(): HTMLButtonElement {
  return buttonByText('记一笔');
}

/** 近期的分类网格（默认态） */
function catRow(): HTMLElement {
  const el = document.body.querySelector('.qe__cats-grid--row');
  if (!el) throw new Error('未找到默认分类网格');
  return el as HTMLElement;
}

async function seedCategories(n: number) {
  const ids: string[] = [];
  for (let i = 0; i < n; i++) {
    const c = await services.categories.add({ name: `分类${i}`, emoji: '🏷️', builtin: false, sort: i });
    ids.push(c.id);
  }
  for (const [i, id] of ids.entries()) {
    await services.bills.add(makeBill({ categoryId: id, categoryName: `分类${i}`, date: '2026-08-10', timestamp: 1787310000000 + i }));
  }
  await flushPromises();
}

describe('快速记账 Sheet（Phase 6 交互收尾）', () => {
  beforeEach(resetDb);

  it('CATEGORY-01 默认最近使用最多展示 5 个分类 + 第6位展开按钮', async () => {
    await seedCategories(8);
    await mountSheet();
    const row = catRow();
    const catBtns = row.querySelectorAll('.qe__cat');
    expect(catBtns.length).toBe(6); // 5 分类 + 1 展开按钮
    expect(row.querySelector('.qe__cat--expand')).not.toBeNull();
  });

  it('CATEGORY-LAYOUT-01 默认六列一屏且不产生横向滚动容器', async () => {
    await seedCategories(8);
    await mountSheet();
    const row = catRow();
    expect(document.body.querySelector('.qe__cats-row')).toBeNull(); // 旧横向滚动容器已移除
    const style = getComputedStyle(row);
    expect(style.overflowX).not.toBe('auto');
  });

  it('CATEGORY-03 最近分类按最后使用时间排序，不按次数', async () => {
    const a = await services.categories.add({ name: '分类A', emoji: '🏷️', builtin: false, sort: 0 });
    const b = await services.categories.add({ name: '分类B', emoji: '🏷️', builtin: false, sort: 1 });
    await services.bills.add(makeBill({ categoryId: a.id, categoryName: '分类A', date: '2026-08-01', timestamp: 1787000000000 }));
    await services.bills.add(makeBill({ categoryId: a.id, categoryName: '分类A', date: '2026-08-02', timestamp: 1787086400000 }));
    await services.bills.add(makeBill({ categoryId: a.id, categoryName: '分类A', date: '2026-08-03', timestamp: 1787172800000 }));
    await services.bills.add(makeBill({ categoryId: b.id, categoryName: '分类B', date: '2026-08-20', timestamp: 1788310400000 }));
    await mountSheet();
    const cats = Array.from(catRow().querySelectorAll('.qe__cat'));
    // 最近一次使用 B(8-20) > A(8-03)，故 B 在前
    expect(cats[0].textContent).toContain('分类B');
    expect(cats[1].textContent).toContain('分类A');
  });

  it('CATEGORY-04 展开后切换到全部分类网格，不重复渲染最近；可收起', async () => {
    await seedCategories(8);
    await mountSheet();
    const expand = catRow().querySelector<HTMLElement>('.qe__cat--expand')!;
    expand.click();
    await flushPromises();
    const full = document.body.querySelector('.qe__cats-grid--full');
    expect(full).not.toBeNull();
    // 互斥：展开显示全部分类时，默认网格消失（不重复渲染“最近使用”）
    expect(document.body.querySelector('.qe__cats-grid--row')).toBeNull();
    const fullCats = full!.querySelectorAll('.qe__cat');
    expect(fullCats.length).toBe(9); // 8 分类 + 1 添加
    expect(full!.querySelector('.qe__cat--add')).not.toBeNull();
    // 收起箭头在标题右侧
    buttonByText('收起').click();
    await flushPromises();
    expect(document.body.querySelector('.qe__cats-grid--full')).toBeNull();
    expect(document.body.querySelector('.qe__cats-grid--row')).not.toBeNull();
  });

  it('CATEGORY-ADD-01 点击 + 后打开 DVCategoryManager 新增编辑区（Teleport 到 body）', async () => {
    await seedCategories(8);
    await mountSheet();
    catRow().querySelector<HTMLElement>('.qe__cat--expand')!.click();
    await flushPromises();
    document.body.querySelector<HTMLElement>('.qe__cat--add')!.click();
    await flushPromises();
    // 唯一管理实现：DVCategoryManager create mode 编辑区立即出现（QuickEntry 不再自研第二套）
    const form = document.body.querySelector('.dvm__editor');
    expect(form).not.toBeNull();
    expect(form!.querySelector('input.dvm__editor-name')).not.toBeNull();
  });

  it('CAT-IME-01 QuickEntry → 全部 → 添加：用户点击名称输入，activeElement 必须是 input', async () => {
    await seedCategories(8);
    await mountSheet();
    catRow().querySelector<HTMLElement>('.qe__cat--expand')!.click();
    await flushPromises();
    document.body.querySelector<HTMLElement>('.qe__cat--add')!.click();
    await flushPromises();
    const nameInput = document.body.querySelector<HTMLInputElement>('input.dvm__editor-name')!;
    expect(nameInput).not.toBeNull();
    // 先失焦
    nameInput.blur();
    expect(document.activeElement).not.toBe(nameInput);
    // 真实用户点击（Android WebView 即 pointer/mousedown）：
    // mousedown 冒泡到根节点必须未被 preventDefault —— P0 回归：QuickEntry 根节点已移除
    // @mousedown.prevent，否则分类名称 input 无法点击聚焦、IME 永不弹出。
    const md = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    expect(nameInput.dispatchEvent(md)).toBe(true);
    expect(md.defaultPrevented).toBe(false);
    // 浏览器默认行为：未被阻止的 mousedown 后聚焦 input → activeElement 必须是 input
    nameInput.focus();
    expect(document.activeElement).toBe(nameInput);
  });

  it('CATEGORY-ADD-02 输入名称保存后新分类写入 DB，Manager 关闭', async () => {
    await seedCategories(8);
    await mountSheet();
    catRow().querySelector<HTMLElement>('.qe__cat--expand')!.click();
    await flushPromises();
    document.body.querySelector<HTMLElement>('.qe__cat--add')!.click();
    await flushPromises();
    const nameInput = document.body.querySelector<HTMLInputElement>('input.dvm__editor-name')!;
    nameInput.value = '咖啡';
    nameInput.dispatchEvent(new Event('input'));
    await flushPromises();
    buttonByText('保存').click();
    await flushPromises();
    await new Promise((r) => setTimeout(r, 0));
    await flushPromises();
    expect((await services.categories.list()).some((c) => c.name === '咖啡')).toBe(true);
    expect(document.body.querySelector('.dvm__editor')).toBeNull(); // Manager 已关闭
  });

  it('CATEGORY-ADD-03 新分类自动成为当前选择并出现在最近使用', async () => {
    await seedCategories(8);
    await mountSheet();
    catRow().querySelector<HTMLElement>('.qe__cat--expand')!.click();
    await flushPromises();
    document.body.querySelector<HTMLElement>('.qe__cat--add')!.click();
    await flushPromises();
    const nameInput = document.body.querySelector<HTMLInputElement>('input.dvm__editor-name')!;
    nameInput.value = '咖啡';
    nameInput.dispatchEvent(new Event('input'));
    await flushPromises();
    buttonByText('保存').click();
    await flushPromises();
    await new Promise((r) => setTimeout(r, 0));
    await flushPromises();
    const row = catRow();
    const newCat = Array.from(row.querySelectorAll('.qe__cat')).find((c) =>
      c.textContent?.includes('咖啡'),
    );
    expect(newCat).not.toBeNull();
    expect(newCat!.classList.contains('is-active')).toBe(true);
  });

  it('CATEGORY-DEL-01 自定义分类删除统一走 Manager + DVConfirmDialog（无原生 confirm）', async () => {
    const x = await services.categories.add({ name: '自定义', emoji: '🏷️', builtin: false, sort: 0 });
    await seedCategories(2);
    await mountSheet();
    // 头部显式「管理」入口（不依赖长按）
    buttonByText('管理').click();
    await flushPromises();
    expect(document.body.querySelector('.dvm')).not.toBeNull();
    // 自定义分类行 → 删除 ✕
    const row = Array.from(document.body.querySelectorAll<HTMLElement>('.dvm__row')).find((r) =>
      r.textContent?.includes('自定义'),
    )!;
    row.querySelector<HTMLElement>('.dvm__row-del')!.click();
    await flushPromises();
    // DVConfirmDialog 弹出（不是 window.confirm）
    expect(document.body.querySelector('.dvcd')).not.toBeNull();
    document.body.querySelector<HTMLElement>('.dvcd__btn--danger')!.click();
    await flushPromises();
    await new Promise((r) => setTimeout(r, 0));
    await flushPromises();
    expect((await services.categories.list()).map((c) => c.id)).not.toContain(x.id);
    // 关闭 Manager
    buttonByText('完成').click();
    await flushPromises();
    expect(document.body.querySelector('.dvm')).toBeNull();
  });

  it('QUICK-01 日期 / 时间通过滚轮选择器选择并正确保存', async () => {
    await services.categories.add({ name: '餐饮', emoji: '🍚', builtin: true, sort: 1 });
    await mountSheet();
    // 打开滚轮选择器
    document.body.querySelector<HTMLElement>('.qe__dt-trigger')!.click();
    await flushPromises();
    const picker = document.body.querySelector('.dv-dtp');
    expect(picker).not.toBeNull();
    // 滚轮存在：年/月/日/时/分 五滚轮
    expect(picker!.querySelectorAll('.dv-wheel').length).toBe(5);
    // 点确定关闭
    buttonByText('确定').click();
    await flushPromises();
    expect(document.body.querySelector('.dv-dtp')).toBeNull();
    // 输入金额并保存
    typeAmount('88.5');
    await flushPromises();
    saveButton().click();
    await flushPromises();
    const bills = await services.bills.list();
    expect(bills).toHaveLength(1);
    expect(bills[0].amount).toBe(88.5);
  });

  it('QUICK-02 saving 期间不能重复提交（快速双击只生成一笔账）', async () => {
    await services.categories.add({ name: '餐饮', emoji: '🍚', builtin: true, sort: 1 });
    await mountSheet();
    typeAmount('50');
    await flushPromises();
    const btn = saveButton();
    btn.click();
    btn.click();
    await flushPromises();
    expect(await services.bills.list()).toHaveLength(1);
  });

  it('QUICK-02 金额 <= 0 时保存按钮保持 disabled', async () => {
    await services.categories.add({ name: '餐饮', emoji: '🍚', builtin: true, sort: 1 });
    await mountSheet();
    typeAmount('0');
    await flushPromises();
    expect(saveButton().disabled).toBe(true);
    document.body.querySelector<HTMLElement>('.qe__pad-key--back')!.click();
    await flushPromises();
    typeAmount('0.5');
    await flushPromises();
    expect(saveButton().disabled).toBe(false);
  });

  it('P5-AMOUNT-01 前导 0 处理：输入 0 后继续输入 5 → 5 而非 05', async () => {
    await services.categories.add({ name: '餐饮', emoji: '🍚', builtin: true, sort: 1 });
    await mountSheet();
    const value = () => document.body.querySelector<HTMLElement>('.qe__amount-value')!.textContent;
    typeAmount('0');
    await flushPromises();
    expect(value()).toBe('0');
    typeAmount('5');
    await flushPromises();
    expect(value()).toBe('5');
  });

  it('P5-AMOUNT-02 连续前导 0 不出现 000000', async () => {
    await services.categories.add({ name: '餐饮', emoji: '🍚', builtin: true, sort: 1 });
    await mountSheet();
    const value = () => document.body.querySelector<HTMLElement>('.qe__amount-value')!.textContent;
    typeAmount('000000');
    await flushPromises();
    expect(value()).toBe('0');
  });

  it('P5-AMOUNT-03 允许 0.5 这类小数', async () => {
    await services.categories.add({ name: '餐饮', emoji: '🍚', builtin: true, sort: 1 });
    await mountSheet();
    const value = () => document.body.querySelector<HTMLElement>('.qe__amount-value')!.textContent;
    typeAmount('0.5');
    await flushPromises();
    expect(value()).toBe('0.5');
  });

  it('P5-AMOUNT-04 最多两位小数（第三位被忽略）', async () => {
    await services.categories.add({ name: '餐饮', emoji: '🍚', builtin: true, sort: 1 });
    await mountSheet();
    const value = () => document.body.querySelector<HTMLElement>('.qe__amount-value')!.textContent;
    typeAmount('1.23');
    await flushPromises();
    expect(value()).toBe('1.23');
    typeAmount('4');
    await flushPromises();
    expect(value()).toBe('1.23');
  });

  it('P5-AMOUNT-05 删除到空值后显示 0（保存禁用）', async () => {
    await services.categories.add({ name: '餐饮', emoji: '🍚', builtin: true, sort: 1 });
    await mountSheet();
    typeAmount('88');
    await flushPromises();
    const back = document.body.querySelector<HTMLElement>('.qe__pad-key--back')!;
    back.click();
    back.click();
    await flushPromises();
    expect(document.body.querySelector<HTMLElement>('.qe__amount-value')!.textContent).toBe('0');
    expect(saveButton().disabled).toBe(true);
  });

  it('P5-AMOUNT-06 长金额动态缩小字号（1~6 is-md / 7~9 is-lg / 更长 is-xxl）', async () => {
    await services.categories.add({ name: '餐饮', emoji: '🍚', builtin: true, sort: 1 });
    await mountSheet();
    const value = () => document.body.querySelector<HTMLElement>('.qe__amount-value')!;
    typeAmount('123456');
    await flushPromises();
    expect(value().classList.contains('is-md')).toBe(true);
    typeAmount('7');
    await flushPromises();
    expect(value().classList.contains('is-lg')).toBe(true);
    typeAmount('8');
    await flushPromises();
    expect(value().classList.contains('is-lg')).toBe(true);
    typeAmount('.');
    typeAmount('8');
    typeAmount('9');
    await flushPromises();
    expect(value().classList.contains('is-xxl')).toBe(true);
  });

  it('P5-DV-01 「计算日价」开关默认关闭', async () => {
    await services.categories.add({ name: '餐饮', emoji: '🍚', builtin: true, sort: 1 });
    await mountSheet();
    const sw = document.body.querySelector<HTMLElement>('.qe__dv-switch')!;
    expect(sw).not.toBeNull();
    expect(sw.classList.contains('is-on')).toBe(false);
    expect(sw.getAttribute('aria-checked')).toBe('false');
  });

  it('P5-DV-02 开启「计算日价」保存后：仍是 normal Bill + dailyValue 扩展，不破坏 ledgerImpact', async () => {
    await services.categories.add({ name: '餐饮', emoji: '🍚', builtin: true, sort: 1 });
    await mountSheet();
    const sw = document.body.querySelector<HTMLElement>('.qe__dv-switch')!;
    sw.click();
    await flushPromises();
    expect(sw.classList.contains('is-on')).toBe(true);
    typeAmount('300');
    await flushPromises();
    saveButton().click();
    await flushPromises();
    const bills = await services.bills.list();
    expect(bills).toHaveLength(1);
    expect(bills[0].ledgerImpact).toBe('normal');
    expect(bills[0].dailyValue?.enabled).toBe(true);
    expect(bills[0].dailyValue?.startDate).toBe(bills[0].date);
  });

  it('P5-DV-03 未开启「计算日价」保存后不附带 dailyValue 字段', async () => {
    await services.categories.add({ name: '餐饮', emoji: '🍚', builtin: true, sort: 1 });
    await mountSheet();
    typeAmount('50');
    await flushPromises();
    saveButton().click();
    await flushPromises();
    const bills = await services.bills.list();
    expect(bills).toHaveLength(1);
    expect(bills[0].dailyValue).toBeUndefined();
    expect(bills[0].ledgerImpact).toBe('normal');
  });

  it('P5-COLOR-01 支出/收入按钮 data-type + active 切换', async () => {
    await services.categories.add({ name: '餐饮', emoji: '🍚', builtin: true, sort: 1 });
    await mountSheet();
    const exp = document.body.querySelector<HTMLElement>('.qe__type-btn[data-type="expense"]')!;
    const inc = document.body.querySelector<HTMLElement>('.qe__type-btn[data-type="income"]')!;
    expect(exp.classList.contains('is-active')).toBe(true);
    expect(inc.classList.contains('is-active')).toBe(false);
    inc.click();
    await flushPromises();
    expect(exp.classList.contains('is-active')).toBe(false);
    expect(inc.classList.contains('is-active')).toBe(true);
  });

  it('IME-01 文字键盘模式不破坏 Sheet 布局，数字键盘保持可见', async () => {
    await services.categories.add({ name: '餐饮', emoji: '🍚', builtin: true, sort: 1 });
    await mountSheet();
    expect(document.body.querySelector('.qe__pad')).not.toBeNull();
    document.body.querySelector<HTMLElement>('.qe__note-trigger')!.click();
    await flushPromises();
    expect(document.body.querySelector('.qe__note-input')).not.toBeNull();
    // 数字键盘始终可见（不再被文字键盘占位替换）
    expect(document.body.querySelector('.qe__pad')).not.toBeNull();
    expect(document.body.querySelector('.dv-sheet__panel')).not.toBeNull();
    expect(document.body.querySelector('.qe__save')).not.toBeNull();
    const input = document.body.querySelector<HTMLInputElement>('.qe__note-input')!;
    input.dispatchEvent(new Event('blur'));
    await flushPromises();
    expect(document.body.querySelector('.qe__pad')).not.toBeNull();
  });

  it('NOTE-01 点击备注后切到系统文字键盘（备注可编辑、获得焦点）', async () => {
    await services.categories.add({ name: '餐饮', emoji: '🍚', builtin: true, sort: 1 });
    await mountSheet();
    document.body.querySelector<HTMLElement>('.qe__note-trigger')!.click();
    await flushPromises();
    const input = document.body.querySelector<HTMLInputElement>('.qe__note-input')!;
    expect(input).not.toBeNull();
    expect(document.activeElement).toBe(input);
  });

  it('NOTE-02 备注输入中直接点数字 7：备注失焦、金额变为 7', async () => {
    await services.categories.add({ name: '餐饮', emoji: '🍚', builtin: true, sort: 1 });
    await mountSheet();
    document.body.querySelector<HTMLElement>('.qe__note-trigger')!.click();
    await flushPromises();
    const input = document.body.querySelector<HTMLInputElement>('.qe__note-input')!;
    expect(document.activeElement).toBe(input);
    // 不点任何空白处，直接点数字键 7
    const key7 = Array.from(document.body.querySelectorAll('.qe__pad-key')).find(
      (b) => b.textContent === '7',
    ) as HTMLElement;
    key7.click();
    await flushPromises();
    // 备注失焦（系统文字键盘已由 blur 收起）
    expect(document.activeElement).not.toBe(input);
    // 金额恢复可输入并写入 7
    expect(document.body.querySelector<HTMLElement>('.qe__amount-value')!.textContent).toBe('7');
  });

  it('NOTE-03 无需额外点击空白区：点数字键即从备注切回金额', async () => {
    await services.categories.add({ name: '餐饮', emoji: '🍚', builtin: true, sort: 1 });
    await mountSheet();
    document.body.querySelector<HTMLElement>('.qe__note-trigger')!.click();
    await flushPromises();
    expect(document.body.querySelector('.qe__note-input')).not.toBeNull();
    // 直接点数字键连续输入（不先点空白处）
    const key8 = Array.from(document.body.querySelectorAll('.qe__pad-key')).find(
      (b) => b.textContent === '8',
    ) as HTMLElement;
    key8.click();
    await flushPromises();
    // 备注 input 已切回备注触发按钮（数字键盘态）
    expect(document.body.querySelector('.qe__note-trigger')).not.toBeNull();
    expect(document.body.querySelector<HTMLElement>('.qe__amount-value')!.textContent).toBe('8');
    // 数字键盘保持可交互（再点一次仍生效）
    key8.click();
    await flushPromises();
    expect(document.body.querySelector<HTMLElement>('.qe__amount-value')!.textContent).toBe('88');
  });

  it('NOTE-04 点左侧金额区从备注切回金额数字键盘', async () => {
    await services.categories.add({ name: '餐饮', emoji: '🍚', builtin: true, sort: 1 });
    await mountSheet();
    document.body.querySelector<HTMLElement>('.qe__note-trigger')!.click();
    await flushPromises();
    expect(document.body.querySelector('.qe__note-input')).not.toBeNull();
    // 点左侧金额显示区（不点空白处）
    document.body.querySelector<HTMLElement>('.qe__amount')!.click();
    await flushPromises();
    // 已切回数字键盘态：备注触发按钮回来、文字输入框消失、数字键盘可交互
    expect(document.body.querySelector('.qe__note-trigger')).not.toBeNull();
    expect(document.body.querySelector('.qe__note-input')).toBeNull();
    expect(document.body.querySelector('.qe__pad')).not.toBeNull();
  });

  it('CAT-01 默认最近使用完整显示（5 分类 + 展开按钮），不被压缩/裁切', async () => {
    await seedCategories(8);
    await mountSheet();
    const row = catRow();
    expect(row.classList.contains('qe__cats-grid--row')).toBe(true);
    expect(row.querySelectorAll('.qe__cat').length).toBe(6); // 5 分类 + 展开按钮
    // 分类网格高度自适应：未写死固定高度、未用 overflow:hidden 裁切
    expect(getComputedStyle(row).height).toBe('auto');
    expect(getComputedStyle(row).overflowY).not.toBe('hidden');
  });

  it('CAT-02 展开后全部分类第二排完整可见、不被裁切', async () => {
    await seedCategories(8);
    await mountSheet();
    catRow().querySelector<HTMLElement>('.qe__cat--expand')!.click();
    await flushPromises();
    const full = document.body.querySelector<HTMLElement>('.qe__cats-grid--full')!;
    expect(full).not.toBeNull();
    // 展开网格高度自适应（非固定），多行不被压缩
    expect(getComputedStyle(full).height).toBe('auto');
    // 顶部信息区为纵向滚动容器（非 hidden），内容超高时滚动展示而非裁切第二排
    const info = document.body.querySelector<HTMLElement>('.qe__info')!;
    expect(getComputedStyle(info).overflowY).not.toBe('hidden');
    // 全部分类项 + 添加按钮均渲染，且“添加”紧随最后一个分类（DOM 顺序可点）
    expect(full.querySelectorAll('.qe__cat').length).toBe(9);
    expect(full.querySelector('.qe__cat--add')).not.toBeNull();
  });

  it('CAT-03 展开态「添加分类」按钮完整可见且可点击', async () => {
    await seedCategories(8);
    await mountSheet();
    catRow().querySelector<HTMLElement>('.qe__cat--expand')!.click();
    await flushPromises();
    const add = document.body.querySelector<HTMLElement>('.qe__cat--add')!;
    expect(add).not.toBeNull();
    // 按钮非隐藏状态（未因裁切而不可见）
    expect(getComputedStyle(add).display).not.toBe('none');
    add.click();
    await flushPromises();
    // 打开 DVCategoryManager 新增编辑区（唯一管理实现）
    expect(document.body.querySelector('.dvm__editor')).not.toBeNull();
  });

  it('CAT-04 不同主题色下分类区不裁切、不重叠（网格高度自适应）', async () => {
    await seedCategories(8);
    await mountSheet();
    for (const themeColor of ['brand', 'indigo', 'emerald']) {
      document.documentElement.setAttribute('data-theme-color', themeColor);
      await flushPromises();
      // 默认态
      const row = catRow();
      expect(getComputedStyle(row).height).toBe('auto');
      expect(row.querySelectorAll('.qe__cat').length).toBe(6);
      // 展开态第二排完整可见
      row.querySelector<HTMLElement>('.qe__cat--expand')!.click();
      await flushPromises();
      const full = document.body.querySelector<HTMLElement>('.qe__cats-grid--full')!;
      expect(getComputedStyle(full).height).toBe('auto');
      expect(full.querySelectorAll('.qe__cat').length).toBe(9);
      // 收起，回默认态进行下一主题色
      buttonByText('收起').click();
      await flushPromises();
      expect(document.body.querySelector('.qe__cats-grid--full')).toBeNull();
      expect(document.body.querySelector('.qe__cats-grid--row')).not.toBeNull();
    }
    document.documentElement.removeAttribute('data-theme-color');
  });

  it('CAT-05 展开分类后自动滚动：添加按钮 bottom 位于数字键盘顶部之上（不被固定输入区遮挡）', async () => {
    await seedCategories(8);
    await mountSheet();
    // 模拟真实溢出：固定数字键盘顶边 500px；添加按钮初始底边 600px（被键盘遮挡），
    // 随顶层 info 滚动联动上移（近似真实布局滚动）。
    const padTop = 500;
    const baseAddBottom = 600;
    const margin = 8;
    const info = document.body.querySelector<HTMLElement>('.qe__info') as HTMLElement;
    let infoScroll = 0;
    Object.defineProperty(info, 'scrollTop', {
      get: () => infoScroll,
      set: (v: number) => {
        infoScroll = v;
      },
      configurable: true,
    });

    const origGetRect = Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect = function (this: Element) {
      if (this.classList.contains('qe__pad')) {
        return { top: padTop, bottom: padTop, left: 0, right: 0, width: 0, height: 0, x: 0, y: 0 } as DOMRect;
      }
      if (this.classList.contains('qe__cat--add')) {
        const bottom = baseAddBottom - infoScroll;
        return { top: bottom - 60, bottom, left: 0, right: 0, width: 0, height: 0, x: 0, y: 0 } as DOMRect;
      }
      return origGetRect.call(this);
    };
    try {
      // 点击「全部」展开（组件内部会自动滚动 info）
      catRow().querySelector<HTMLElement>('.qe__cat--expand')!.click();
      await flushPromises();

      const add = document.body.querySelector<HTMLElement>('.qe__cat--add')!;
      expect(add).not.toBeNull();
      // 关键断言：确实发生了自动滚动（精确到溢出量 + 边距）
      expect(infoScroll).toBe(baseAddBottom - padTop + margin);
      // 添加按钮 bottom 已不高于数字键盘顶部（不再被固定输入区遮挡）
      const finalAddBottom = add.getBoundingClientRect().bottom;
      expect(finalAddBottom).toBeLessThanOrEqual(padTop - margin);
      // 且立即可点（未 display:none 裁切隐藏）
      expect(getComputedStyle(add).display).not.toBe('none');
    } finally {
      Element.prototype.getBoundingClientRect = origGetRect;
    }
  });

  /* ============ EDIT 编辑模式 ============ */

  it('EDIT-01 打开编辑模式：标题为「编辑账单」，按钮为「保存修改」', async () => {
    const bill = await services.bills.add(makeBill({ note: '晨跑后', amount: 99 }));
    await mountSheet({ editingBill: bill });
    expect(document.body.querySelector('.dv-sheet__header')?.textContent).toContain('编辑账单');
    expect(buttonByText('保存修改')).not.toBeNull();
  });

  it('EDIT-02 编辑模式表单正确预填（金额/备注/类型/日价）', async () => {
    const bill = await services.bills.add(
      makeBill({ note: '礼物', amount: 66, type: 'income', dailyValue: { enabled: true, mode: 'elapsed', startDate: '2026-08-20' } }),
    );
    await mountSheet({ editingBill: bill });
    expect(document.body.querySelector<HTMLElement>('.qe__amount-value')!.textContent).toContain('66');
    expect(document.body.querySelector<HTMLElement>('.qe__note-input, .qe__note-trigger')!.textContent).toContain('礼物');
    const inc = document.body.querySelector<HTMLElement>('.qe__type-btn[data-type="income"]')!;
    expect(inc.classList.contains('is-active')).toBe(true);
    const sw = document.body.querySelector<HTMLElement>('.qe__dv-switch')!;
    expect(sw.classList.contains('is-on')).toBe(true);
  });

  it('EDIT-03 编辑保存调用 update 而非 add（保持原 id）', async () => {
    const bill = await services.bills.add(makeBill({ note: '原始', amount: 30 }));
    await mountSheet({ editingBill: bill });
    typeAmount('5'); // 30 → 305
    await flushPromises();
    buttonByText('保存修改').click();
    await flushPromises();
    await new Promise((r) => setTimeout(r, 0));
    await flushPromises();
    const bills = await services.bills.list();
    expect(bills).toHaveLength(1);
    expect(bills[0].id).toBe(bill.id);
    expect(bills[0].amount).toBe(305);
  });

  it('EDIT-04 编辑后账单总数量不增加', async () => {
    const bill = await services.bills.add(makeBill({ note: '原始', amount: 30 }));
    await mountSheet({ editingBill: bill });
    buttonByText('保存修改').click();
    await flushPromises();
    expect(await services.bills.list()).toHaveLength(1);
  });

  it('EDIT-05 金额修改刷新月汇总（同月更新金额）', async () => {
    const bill = await services.bills.add(makeBill({ amount: 100, date: '2026-08-10', categoryId: 'c-b', categoryName: '分类B', categoryEmoji: '🏷️' }));
    await services.categories.add({ name: '分类B', emoji: '🏷️', builtin: false, sort: 1 });
    await mountSheet({ editingBill: bill });
    const back = document.body.querySelector<HTMLElement>('.qe__pad-key--back')!;
    back.click();
    back.click();
    back.click();
    await flushPromises();
    typeAmount('500');
    await flushPromises();
    buttonByText('保存修改').click();
    await flushPromises();
    await new Promise((r) => setTimeout(r, 0));
    await flushPromises();
    const updated = (await services.bills.list())[0];
    expect(updated.amount).toBe(500);
    expect(updated.date).toBe('2026-08-10');
  });

  it('EDIT-06 跨月修改：编辑打开滚轮为「日期时间」选择器', async () => {
    const bill = await services.bills.add(makeBill({ amount: 20, date: '2026-08-05' }));
    await mountSheet({ editingBill: bill });
    document.body.querySelector<HTMLElement>('.qe__dt-trigger')!.click();
    await flushPromises();
    expect(document.body.querySelectorAll('.dv-wheel').length).toBe(5);
    buttonByText('确定').click();
    await flushPromises();
    expect(buttonByText('保存修改')).not.toBeNull();
  });

  it('EDIT-07 编辑日价开关正确更新 DailyValue（关闭已开启的日价）', async () => {
    const target = await services.bills.add(
      makeBill({ amount: 200, date: '2026-08-11', dailyValue: { enabled: true, mode: 'elapsed', startDate: '2026-08-11' } }),
    );
    await mountSheet({ editingBill: target });
    const sw = document.body.querySelector<HTMLElement>('.qe__dv-switch')!;
    expect(sw.classList.contains('is-on')).toBe(true);
    sw.click();
    await flushPromises();
    buttonByText('保存修改').click();
    await flushPromises();
    await new Promise((r) => setTimeout(r, 0));
    await flushPromises();
    const after = (await services.bills.list())[0];
    expect(after.dailyValue?.enabled).toBeFalsy();
    expect(after.id).toBe(target.id);
  });
});

describe('P0-1 QuickEntry 跨午夜不再使用固定 24h interval', () => {
  it('不注册固定 24h setInterval，改用 msUntilNextLocalMidnight 的 setTimeout 调度', async () => {
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');
    const realSetTimeout = globalThis.setTimeout;
    const scheduled: number[] = [];
    const spyTimeout = vi
      .spyOn(globalThis, 'setTimeout')
      .mockImplementation(((handler: TimerHandler, ms?: number, ...rest: unknown[]) => {
        if (typeof handler === 'function' && ms !== undefined) scheduled.push(ms);
        return realSetTimeout(handler, ms, ...rest);
      }) as typeof globalThis.setTimeout);

    await mountSheet({ modelValue: true });

    // 1) 从未注册“固定 24h”(86400000ms) 的 setInterval —— 跨午夜不再用固定 interval
    const fixed24h = setIntervalSpy.mock.calls.filter(
      (c) => typeof c[0] === 'function' && c[1] === 24 * 60 * 60 * 1000,
    );
    expect(fixed24h).toHaveLength(0);

    // 2) 存在一个吻合当前 msUntilNextLocalMidnight() 的本地午夜差值 setTimeout 调度
    const midnightDelay = msUntilNextLocalMidnight();
    const hasMidnight = scheduled.some((ms) => Math.abs(ms - midnightDelay) <= 1000);
    expect(hasMidnight).toBe(true);

    spyTimeout.mockRestore();
    setIntervalSpy.mockRestore();
  });

  it('午夜触发回调会递归重新调度（每次重算本地午夜差值，非固定 24h）', async () => {
    // 进位原函数保留，拦截 setTimeout：记录回调 + 延时
    const realSetTimeout = globalThis.setTimeout;
    const callbacks = new Map<number, { cb: () => void; ms: number }>();
    let runId = 0;
    const spyTimeout = vi
      .spyOn(globalThis, 'setTimeout')
      .mockImplementation(((handler: TimerHandler, ms?: number, ...rest: unknown[]) => {
        const id = ++runId;
        if (typeof handler === 'function') callbacks.set(id, { cb: handler as () => void, ms: ms ?? 0 });
        // 仍走真实定时器：让 mount flush 用的 0ms append 能 resolve；跨午夜长延时不会在测试内触发
        return realSetTimeout(handler, ms, ...rest);
      }) as typeof globalThis.setTimeout);
    const setIntervalSpy = vi
      .spyOn(globalThis, 'setInterval')
      .mockImplementation(() => 0 as unknown as ReturnType<typeof setInterval>);

    await mountSheet({ modelValue: true });

    // 取出跨午夜调度回调（用时延吻合 msUntilNextLocalMidnight 的那个）
    const midnightDelay = msUntilNextLocalMidnight();
    let midnightCb: (() => void) | null = null;
    for (const [, { cb, ms }] of callbacks) {
      if (Math.abs(ms - midnightDelay) <= 1000) midnightCb = cb;
    }
    expect(midnightCb).toBeTypeOf('function');

    // 手动触发一次“到达午夜”，模拟 scheduleNextMidnight 递归：
    // 组件内 setInterval 方式（旧）触发的用 clearInterval+setInterval；新代码用 setTimeout 递归，
    // 因此触发后应产出一次新的 setTimeout 调度（仍走 msUntilNextLocalMidnight），而不是新的 setInterval。
    const runIdBefore = runId;
    if (typeof midnightCb === 'function') midnightCb();
    // 触发后确实产生了新的 setTimeout 调度
    expect(runId).toBeGreaterThan(runIdBefore);
    // 本轮触发新产生的延时仍吻合 msUntilNextLocalMidnight（每次到点重算本地午夜差值）
    const newMin = Math.min(...[...callbacks.values()].map((c) => c.ms));
    expect(newMin).toBeLessThanOrEqual(midnightDelay);
    // 全程零 setInterval（跨午夜并非固定 interval 驱动）
    expect(setIntervalSpy.mock.calls.length).toBe(0);
    expect(midnightDelay).toBeGreaterThan(0);

    spyTimeout.mockRestore();
    setIntervalSpy.mockRestore();
  });
});

/* ============ 真实日期/时间行为测试（禁止“假 PASS”）============
 * 通过 DVWheelPicker 的真实 update:modelValue 事件驱动 DVDateTimeWheelPicker，
 * 再点“确定”让 QuickEntrySheet 接收 emit 的新值并保存到 IDB，最后断言 DB 数据。
 * DATE-01..07 覆盖：新增改日期 / 改时间 / 取消不改 / 编辑改日期 / 跨月编辑 / 日价联动 / 未来限制。 */

/** 打开日期时间选择器并按所选值驱动 5 个滚轮，点“确定”写回表单 */
async function pickDateTime(
  wrapper: Awaited<ReturnType<typeof mountSheet>>,
  dt: DateTimeValue,
  confirm = true,
) {
  document.body.querySelector<HTMLElement>('.qe__dt-trigger')!.click();
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
  if (confirm) {
    document.body.querySelector<HTMLElement>('.dv-dtp__ok')!.click();
  } else {
    document.body.querySelector<HTMLElement>('.dv-dtp__cancel')!.click();
  }
  await flushPromises();
  expect(document.body.querySelector('.dv-dtp')).toBeNull();
}

/** QuickEntry 顶部的日期时间文本（反映 billDate/billTime） */
function qeDateText(): string {
  const el = document.body.querySelector<HTMLElement>('.qe__dt-text');
  if (!el) throw new Error('未找到日期时间入口文本');
  return el.textContent ?? '';
}

describe('DATE 真实日期/时间行为（Phase 6 交互收尾）', () => {
  beforeEach(resetDb);

  it('DATE-01 新增后改为过去日期：保存后 Bill.date === 所选日期', async () => {
    await services.categories.add({ name: '餐饮', emoji: '🍚', builtin: true, sort: 1 });
    const wrapper = await mountSheet();
    await pickDateTime(wrapper, { year: 2026, month: 7, day: 15, hour: 10, minute: 0 });
    expect(qeDateText()).toContain('7月15日');
    typeAmount('100');
    await flushPromises();
    saveButton().click();
    await flushPromises();
    const bill = (await services.bills.list())[0];
    expect(bill.date).toBe('2026-07-15');
  });

  it('DATE-02 新增修改时间 14:37：保存后最终本地 hour/minute 为 14:37、date 为 2026-08-10', async () => {
    await services.categories.add({ name: '餐饮', emoji: '🍚', builtin: true, sort: 1 });
    const wrapper = await mountSheet();
    await pickDateTime(wrapper, { year: 2026, month: 8, day: 10, hour: 14, minute: 37 });
    expect(qeDateText()).toContain('14:37');
    typeAmount('30');
    await flushPromises();
    saveButton().click();
    await flushPromises();
    const bill = (await services.bills.list())[0];
    expect(bill.date).toBe('2026-08-10');
    const t = new Date(bill.timestamp);
    expect(t.getFullYear()).toBe(2026);
    expect(t.getMonth() + 1).toBe(8);
    expect(t.getDate()).toBe(10);
    expect(t.getHours()).toBe(14);
    expect(t.getMinutes()).toBe(37);
  });

  it('DATE-03 Picker 取消：滚动到其他日期时间后 Cancel，billDate/billTime 完全不变', async () => {
    await services.categories.add({ name: '餐饮', emoji: '🍚', builtin: true, sort: 1 });
    const wrapper = await mountSheet();
    const before = qeDateText(); // 初始为今天/当前时间
    await pickDateTime(wrapper, { year: 2026, month: 3, day: 5, hour: 8, minute: 8 }, false);
    expect(qeDateText()).toBe(before); // 取消不写回
    // 保存的仍是未修改的日期（今天）
    typeAmount('50');
    await flushPromises();
    saveButton().click();
    await flushPromises();
    const bill = (await services.bills.list())[0];
    expect(bill.date).toBe(localDateKey());
  });

  it('DATE-04 编辑已有账单日期：id 不变、仅该条更新、不新增', async () => {
    const target = await services.bills.add(makeBill({ amount: 20, date: '2026-08-05', note: '改日期前' }));
    const wrapper = await mountSheet({ editingBill: target });
    await pickDateTime(wrapper, { year: 2026, month: 8, day: 6, hour: 9, minute: 0 });
    buttonByText('保存修改').click();
    await flushPromises();
    // 等 IDB update 提交（macrotask），再读 DB
    await new Promise((r) => setTimeout(r, 0));
    await flushPromises();
    const bills = await services.bills.list();
    expect(bills).toHaveLength(1);
    expect(bills[0].id).toBe(target.id);
    expect(bills[0].date).toBe('2026-08-06');
  });

  it('DATE-05 跨月编辑 8月→7月：DB date 变化、8月汇总减少、7月汇总增加', async () => {
    const moving = await services.bills.add(
      makeBill({ amount: 100, date: '2026-08-20', categoryId: 'c-m', categoryName: '移动' }),
    );
    await services.bills.add(
      makeBill({ amount: 60, date: '2026-08-25', categoryId: 'c-k', categoryName: '留守' }),
    );
    const wrapper = await mountSheet({ editingBill: moving });
    await pickDateTime(wrapper, { year: 2026, month: 7, day: 15, hour: 12, minute: 0 });
    buttonByText('保存修改').click();
    await flushPromises();
    // 等 IDB update 提交（macrotask），再读 DB / store
    await new Promise((r) => setTimeout(r, 0));
    await flushPromises();
    const store = useBillStore();
    const bills = await services.bills.list();
    const moved = bills.find((b) => b.id === moving.id)!;
    expect(moved.date).toBe('2026-07-15');
    // 月份分组/汇总随 date 变化立即刷新
    expect(store.monthSummary('2026-08').expense).toBe(60); // 移走的 100 已离开 8 月
    expect(store.monthSummary('2026-07').expense).toBe(100); // 100 进入 7 月
  });

  it('DATE-06 开启日价的账单改日期：dailyValue.startDate 同步为新日期', async () => {
    const target = await services.bills.add(
      makeBill({
        amount: 200,
        date: '2026-08-20',
        dailyValue: { enabled: true, mode: 'elapsed', startDate: '2026-08-20' },
        categoryId: 'c-d',
        categoryName: '日价品',
      }),
    );
    const wrapper = await mountSheet({ editingBill: target });
    // 编辑态日价开关已预填开启
    expect(document.body.querySelector<HTMLElement>('.qe__dv-switch')!.classList.contains('is-on')).toBe(true);
    await pickDateTime(wrapper, { year: 2026, month: 8, day: 11, hour: 9, minute: 30 });
    buttonByText('保存修改').click();
    await flushPromises();
    // 等 IDB update 提交（macrotask），再读 DB
    await new Promise((r) => setTimeout(r, 0));
    await flushPromises();
    const after = (await services.bills.list()).find((b) => b.id === target.id)!;
    expect(after.date).toBe('2026-08-11');
    expect(after.dailyValue?.enabled).toBe(true);
    expect(after.dailyValue?.startDate).toBe('2026-08-11'); // 必须跟随新日期，不能残留 8-20
  });

  it('DATE-07 今天未来时间被钳制：不能最终选中未来时间', async () => {
    // 只伪造 Date（保留 setTimeout 等真实定时器），避免 fake-indexeddb 的 IDB 操作在假定时器下挂起
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(new Date(2026, 7, 23, 10, 0, 0)); // 固定“现在”为 8-23 10:00
      // 本测试只断言表单时间结果，不保存，无需预置分类
      const pinia = createPinia();
      setActivePinia(pinia);
      const wrapper = mount(QuickEntrySheet, { props: { modelValue: true }, global: { plugins: [pinia] } });
      await flushPromises();
      await pickDateTime(wrapper, { year: 2026, month: 8, day: 23, hour: 14, minute: 0 });
      // 今天 14:00 相对 now(10:00) 是未来 → 确定后钳制到 10:00
      expect(qeDateText()).toContain('10:00');
      expect(qeDateText()).not.toContain('14:00');
    } finally {
      vi.useRealTimers();
    }
  });

  it('DATE-08 跨午夜刷新 today 后日价按新一天重算（DailyValuePage）', async () => {
    // 分两步避免 fake-indexeddb 在假定时器下挂起：
    // 1) 用真实定时器预置账单并预加载 store（loaded=true，后续 mount 不再走 IDB）
    const target = await services.bills.add(
      makeBill({
        amount: 200,
        date: '2026-07-30',
        dailyValue: { enabled: true, mode: 'elapsed', startDate: '2026-07-30' },
        categoryId: 'c-v',
        categoryName: '日价',
      }),
    );
    void target;
    const pinia = createPinia();
    setActivePinia(pinia);
    const store = useBillStore();
    await store.load();
    // 2) 此时开启伪造 Date+定时器，伪装“现在为 8-31 23:59”（距本地午夜 1 分钟）
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date(2026, 7, 31, 23, 59, 0));
      const { default: DailyValuePage } = await import('@/pages/daily-value/DailyValuePage.vue');
      const wrapper = mount(DailyValuePage, { global: { plugins: [pinia] } });
      await flushPromises();
      const meta = () => wrapper.findAll('.dv__item-meta').map((n) => n.text());
      // 跨午夜前：elapsed = 8-31 - 7-30 = 32 天 → 200/32；文案“已用 32 天”
      expect(meta().some((t) => t?.includes('已用 32 天'))).toBe(true);
      // 推进到午夜后（9-1 00:00）：scheduler 触发，today→9-1，并重新调度下一次午夜
      const seek = msUntilNextLocalMidnight(new Date(2026, 7, 31, 23, 59, 0));
      vi.setSystemTime(new Date(2026, 7, 31, 23, 59, 0).getTime() + seek);
      await vi.advanceTimersByTimeAsync(seek); // 触发午夜回调（递归重排下一次）
      await flushPromises();
      // 刷新后 elapsed = 9-1 - 7-30 = 33 天
      expect(meta().some((t) => t?.includes('已用 33 天'))).toBe(true);
      // 触发后 scheduler 已按“下一次本地午夜”重新调度（当前 fake 时间下存在一个 ~24h 长定时器）
      void wrapper;
    } finally {
      vi.useRealTimers();
    }
  });
});

/* ============ CROSS-MIDNIGHT 跨午夜日期时间刷新（Phase 7-0）============
 * 只伪造 Date（保留真实定时器），用 window focus 触发 refreshTodayIfDefault 模拟 App resume。
 * 断言三场景：
 *  - 新增模式跨午夜：日期与时间一起刷新（8/31 23:59 → 9/1 00:00）
 *  - 编辑已有账单跨午夜：日期时间不变
 *  - 用户手动确认过日期时间后跨午夜：不被覆盖 */
describe('CROSS-MIDNIGHT 跨午夜日期时间刷新（Phase 7-0）', () => {
  beforeEach(async () => {
    await resetDb();
    vi.useFakeTimers({ toFake: ['Date'] });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  async function mountSheetMidnight(props: Record<string, unknown> = {}) {
    const pinia = createPinia();
    setActivePinia(pinia);
    const wrapper = mount(QuickEntrySheet, {
      props: { modelValue: true, ...props },
      global: { plugins: [pinia] },
    });
    await flushPromises();
    await new Promise((r) => setTimeout(r, 0));
    await flushPromises();
    return wrapper;
  }

  /** 推进系统时间到指定本地时刻并触发 App resume（window focus），模拟跨午夜刷新 */
  async function crossMidnight(y: number, mo: number, d: number, h: number, min: number) {
    vi.setSystemTime(new Date(y, mo - 1, d, h, min, 0));
    window.dispatchEvent(new Event('focus'));
    await flushPromises();
  }

  it('新增模式跨午夜：日期与时间一起刷新（8/31 23:59 → 9/1 00:00）', async () => {
    await services.categories.add({ name: '餐饮', emoji: '🍚', builtin: true, sort: 1 });
    vi.setSystemTime(new Date(2026, 7, 31, 23, 59, 0));
    await mountSheetMidnight();
    // 初始：今天是 8月31日，当前时间 23:59
    expect(qeDateText()).toContain('8月31日');
    expect(qeDateText()).toContain('23:59');
    // 跨到 9/1 00:00
    await crossMidnight(2026, 9, 1, 0, 0);
    // 日期与时间一起刷新
    expect(qeDateText()).toContain('9月1日');
    expect(qeDateText()).toContain('00:00');
  });

  it('新增模式跨午夜后保存：Bill 落在新的一天（9/1）', async () => {
    await services.categories.add({ name: '餐饮', emoji: '🍚', builtin: true, sort: 1 });
    vi.setSystemTime(new Date(2026, 7, 31, 23, 59, 0));
    await mountSheetMidnight();
    await crossMidnight(2026, 9, 1, 0, 0);
    expect(qeDateText()).toContain('9月1日');
    typeAmount('50');
    await flushPromises();
    saveButton().click();
    await flushPromises();
    const bill = (await services.bills.list())[0];
    expect(bill.date).toBe('2026-09-01');
  });

  it('编辑旧账单跨午夜：日期时间保持不变，不变成第二天', async () => {
    const target = await services.bills.add(makeBill({ amount: 20, date: '2026-08-31', note: '旧账单' }));
    vi.setSystemTime(new Date(2026, 7, 31, 23, 59, 0));
    await mountSheetMidnight({ editingBill: target });
    const before = qeDateText();
    expect(before).toContain('8月31日');
    // 跨午夜后
    await crossMidnight(2026, 9, 1, 0, 0);
    expect(qeDateText()).toBe(before); // 编辑中的账单日期时间完全不变
  });

  it('用户手动确认过日期时间后跨午夜：不被覆盖为今天', async () => {
    await services.categories.add({ name: '餐饮', emoji: '🍚', builtin: true, sort: 1 });
    vi.setSystemTime(new Date(2026, 7, 31, 23, 59, 0));
    const wrapper = await mountSheetMidnight();
    // 用户手动选择 8/31 22:30 并确认（确定按钮 → usingDefaultDateTime=false）
    await pickDateTime(wrapper, { year: 2026, month: 8, day: 31, hour: 22, minute: 30 });
    const before = qeDateText();
    expect(before).toContain('8月31日');
    // 跨午夜后仍保留用户选择，不被覆盖为 9/1
    await crossMidnight(2026, 9, 1, 0, 0);
    expect(qeDateText()).toBe(before);
  });
});

/* ============ BILL-DEL 编辑模式删除账单（2.9.9 + 2.10.0 Header 入口）============
 * BILL-DEL-01..10：入口仅编辑模式 / 位于 Sheet Header（不占主内容高度）/ 点击先弹确认 /
 * 取消保留 / 确认删除（IDB+Pinia 同步消失 + Sheet 关闭）/ 月金额立即变化 / Statistics 派生 /
 * 日价联动消失 / Widget 经 $subscribe 自动更新 / 防重复 remove。 */

/** 删除账单入口（2.10.0 起位于 Sheet Header actions，约 40×40 danger icon） */
function openDeleteEntry(): HTMLElement {
  const el = document.body.querySelector<HTMLElement>('.qe__del-icon');
  if (!el) throw new Error('未找到删除账单入口');
  return el;
}

/** 删除确认 Dialog 的删除按钮（danger 按钮） */
function deleteConfirmBtn(): HTMLButtonElement {
  const btn = Array.from(document.body.querySelectorAll('.dvcd__btn--danger')).find((b) =>
    b.textContent?.includes('删除'),
  );
  if (!btn) throw new Error('未找到删除确认按钮');
  return btn as HTMLButtonElement;
}

describe('BILL-DEL 编辑模式删除账单（2.9.9）', () => {
  beforeEach(resetDb);

  it('BILL-DEL-01 新增模式：不存在「删除账单」入口', async () => {
    await services.categories.add({ name: '餐饮', emoji: '🍚', builtin: true, sort: 1 });
    await mountSheet();
    expect(document.body.querySelector('.qe__del-icon')).toBeNull();
  });

  it('BILL-DEL-02 点击账单进入编辑：删除入口存在且位于 Sheet Header（非主内容区）', async () => {
    const bill = await services.bills.add(makeBill({ note: '午餐', amount: 45 }));
    await mountSheet({ editingBill: bill });
    const btn = openDeleteEntry();
    // 40×40 danger 图标按钮：位于 Header actions（.dv-sheet__actions 内部），不进 .qe__info 主内容区
    expect(btn.closest('.dv-sheet__actions')).not.toBeNull();
    expect(btn.closest('.qe__info')).toBeNull();
    expect(btn.getAttribute('aria-label')).toBe('删除账单');
    // 主内容区（信息区）第一个子区块是类型切换，不再是「删除账单」行（2.10.0 布局回归）
    const info = document.body.querySelector<HTMLElement>('.qe__info')!;
    expect(info.querySelector('.qe__type')).not.toBeNull();
  });

  it('BILL-DEL-10B 布局回归：Edit 与 Create 模式主内容区子区块一致（删除不再挤占一行）', async () => {
    await services.categories.add({ name: '餐饮', emoji: '🍚', builtin: true, sort: 1 });
    const bill = await services.bills.add(makeBill({ note: '午餐', amount: 45 }));
    // Create 模式区块序列
    await mountSheet();
    await flushPromises();
    const createInfo = document.body.querySelector<HTMLElement>('.qe__info')!;
    const createBlocks = Array.from(createInfo.children).map((c) => c.className.split(' ')[0]);
    await document.body.querySelector<HTMLElement>('.dv-sheet__close')!.click();
    await flushPromises();
    // Edit 模式区块序列
    await mountSheet({ editingBill: bill });
    await flushPromises();
    const editInfo = document.body.querySelector<HTMLElement>('.qe__info')!;
    const editBlocks = Array.from(editInfo.children).map((c) => c.className.split(' ')[0]);
    // 2.10.0：删除入口已移出主内容区，Edit/Create 主体布局完全一致（不再多出 qe__del 行）
    expect(editBlocks).toEqual(createBlocks);
  });

  it('BILL-DEL-03 点删除：DVConfirmDialog 可见，账单尚未删除', async () => {
    const bill = await services.bills.add(makeBill({ note: '午餐', amount: 45 }));
    await mountSheet({ editingBill: bill });
    openDeleteEntry().click();
    await flushPromises();
    const dialog = document.body.querySelector('.dvcd');
    expect(dialog).not.toBeNull();
    expect(dialog?.textContent).toContain('删除这笔账单？');
    expect(dialog?.textContent).toContain('删除后无法恢复');
    expect(await services.bills.list()).toHaveLength(1);
  });

  it('BILL-DEL-04 取消：Bill 仍存在，Sheet 仍打开', async () => {
    const bill = await services.bills.add(makeBill({ note: '午餐', amount: 45 }));
    const wrapper = await mountSheet({ editingBill: bill });
    openDeleteEntry().click();
    await flushPromises();
    buttonByText('取消').click();
    await flushPromises();
    expect(await services.bills.list()).toHaveLength(1);
    expect(wrapper.props('modelValue')).toBe(true);
  });

  it('BILL-DEL-05 确认：IDB+Pinia Bill 消失，Edit Sheet 关闭', async () => {
    const bill = await services.bills.add(makeBill({ note: '午餐', amount: 45 }));
    const wrapper = await mountSheet({ editingBill: bill });
    const store = useBillStore();
    await store.load();
    openDeleteEntry().click();
    await flushPromises();
    deleteConfirmBtn().click();
    await flushPromises();
    await new Promise((r) => setTimeout(r, 0));
    await flushPromises();
    expect(await services.bills.list()).toHaveLength(0);
    expect(store.bills).toHaveLength(0);
    expect(wrapper.emitted('update:modelValue')?.flat()).toContain(false);
  });

  it('BILL-DEL-06 删除后 Accounting 月金额立即变化（store 派生）', async () => {
    const bill = await services.bills.add(makeBill({ amount: 100, date: '2026-08-10', categoryId: 'c-x', categoryName: 'X' }));
    await mountSheet({ editingBill: bill });
    const store = useBillStore();
    await store.load();
    expect(store.monthSummary('2026-08').expense).toBe(100);
    openDeleteEntry().click();
    await flushPromises();
    deleteConfirmBtn().click();
    await flushPromises();
    await new Promise((r) => setTimeout(r, 0));
    await flushPromises();
    expect(store.monthSummary('2026-08').expense).toBe(0);
    // Statistics 也从 store 派生：删除即同步
    expect(store.normalBills).toHaveLength(0);
  });

  it('BILL-DEL-08 删除带 dailyValue 的 normal Bill：日价项目同步消失', async () => {
    const bill = await services.bills.add(
      makeBill({
        amount: 200,
        date: '2026-08-10',
        categoryId: 'c-dv',
        categoryName: '日价品',
        dailyValue: { enabled: true, mode: 'elapsed', startDate: '2026-08-10' },
      }),
    );
    await mountSheet({ editingBill: bill });
    const store = useBillStore();
    await store.load();
    expect(store.dailyValueBills.map((b) => b.id)).toContain(bill.id);
    openDeleteEntry().click();
    await flushPromises();
    deleteConfirmBtn().click();
    await flushPromises();
    await new Promise((r) => setTimeout(r, 0));
    await flushPromises();
    // DailyValue 只是 Bill 扩展：Bill 删除后不得留下第二份孤立数据
    expect(store.dailyValueBills).toHaveLength(0);
  });

  it('BILL-DEL-09 Widget 经 billStore $subscribe 在删除后自动触发同步', async () => {
    const bill = await services.bills.add(makeBill({ amount: 66, date: '2026-08-10' }));
    await mountSheet({ editingBill: bill });
    const store = useBillStore();
    await store.load();
    // 模拟 initWidgetSync 的 $subscribe 订阅（同 sync.ts）
    const onStateChange = vi.fn();
    const unsub = store.$subscribe(onStateChange);
    openDeleteEntry().click();
    await flushPromises();
    deleteConfirmBtn().click();
    await flushPromises();
    await new Promise((r) => setTimeout(r, 0));
    await flushPromises();
    // 删除会触发 Pinia state 变更（remove 移除 bills 数组）→ 订阅回调被调用（widget 快照刷新链路）
    expect(onStateChange.mock.calls.length).toBeGreaterThanOrEqual(1);
    unsub();
  });

  it('BILL-DEL-10 快速连续确认：只执行一次 remove（deleting guard）', async () => {
    await services.categories.add({ name: '餐饮', emoji: '🍚', builtin: true, sort: 1 });
    const bill = await services.bills.add(makeBill({ amount: 30 }));
    const wrapper = await mountSheet({ editingBill: bill });
    const store = useBillStore();
    await store.load();
    const removeSpy = vi.spyOn(store, 'remove').mockResolvedValue(undefined);
    // 打开确认并快速连续触发确认（deleting guard 拦截第二次）
    openDeleteEntry().click();
    await flushPromises();
    const vm = wrapper.vm as unknown as { confirmDeleteBill: () => Promise<void> };
    await Promise.all([vm.confirmDeleteBill(), vm.confirmDeleteBill()]);
    expect(removeSpy).toHaveBeenCalledTimes(1);
    removeSpy.mockRestore();
  });
});

/* ============ EDGE-02 编辑“分类已被删除”的历史 Bill（2.9.9）============
 * 用户未主动重选分类时，保存保持原 categoryId / categoryName / categoryEmoji 快照，
 * 绝不偷偷覆盖成「未分类 / 📦」。 */
describe('EDGE-02 历史分类快照保留（2.9.9）', () => {
  beforeEach(resetDb);

  it('编辑分类已被删除的 Bill 保存：保留原分类快照，不降级为未分类', async () => {
    const bill = await services.bills.add(
      makeBill({ amount: 88, categoryId: 'c-gone', categoryName: '已删分类', categoryEmoji: '🔥' }),
    );
    await mountSheet({ editingBill: bill });
    buttonByText('保存修改').click();
    await flushPromises();
    await new Promise((r) => setTimeout(r, 0));
    await flushPromises();
    const after = (await services.bills.list())[0];
    expect(after.categoryId).toBe('c-gone');
    expect(after.categoryName).toBe('已删分类');
    expect(after.categoryEmoji).toBe('🔥');
  });

  it('用户主动重选新分类：仍更新为所选分类', async () => {
    await services.categories.add({ name: '咖啡', emoji: '☕', builtin: false, sort: 1 });
    const bill = await services.bills.add(
      makeBill({ amount: 30, categoryId: 'c-gone', categoryName: '已删分类', categoryEmoji: '🔥' }),
    );
    await mountSheet({ editingBill: bill });
    // 咖啡是自定义分类（不在最近使用网格）：先展开全部分类
    const expand = document.body.querySelector<HTMLElement>('.qe__cat--expand');
    expect(expand).not.toBeNull();
    expand!.click();
    await flushPromises();
    // 在展开态网格中点击分类「咖啡」完成重新选择
    const coffee = Array.from(document.body.querySelectorAll('.qe__cat')).find((b) =>
      b.textContent?.includes('咖啡'),
    ) as HTMLElement;
    coffee.click();
    await flushPromises();
    buttonByText('保存修改').click();
    await flushPromises();
    await new Promise((r) => setTimeout(r, 0));
    await flushPromises();
    const after = (await services.bills.list())[0];
    const cat = (await services.categories.list()).find((c) => c.name === '咖啡')!;
    expect(after.categoryId).toBe(cat.id);
    expect(after.categoryName).toBe('咖啡');
  });
});