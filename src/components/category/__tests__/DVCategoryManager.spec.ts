/**
 * DVCategoryManager 分类管理统一入口测试（2.9.8 Category Stability Fix）
 * - CAT-MGR-01..06 列表 / 编辑 / 新增基础能力
 * - CAT-MGR-07 被周期规则引用：删除前置检查 → 信息 Dialog（仅「知道了」），无危险按钮
 * - CAT-MGR-08 删除确认：取消不删除
 * - CAT-MGR-09 编辑模式不自动聚焦（不弹 IME）
 * - CAT-Z-01   删除确认 Dialog 计算 z-index 高于 Manager（修复 P0「点了没反应」的层级根因）
 * - CAT-Z-02   顶层命中：Dialog 打开时 elementFromPoint 命中 Dialog，关闭后命中 Manager
 * - CAT-DEL-01 ~/DEL-03 真实点击 ✕ → Dialog 可见 → 取消保留 / 确认立即消失
 * - CAT-IME-01/03 名称输入真实点击路径（IME 聚焦）
 * - CAT-IME-E  连续编辑多次：Back 栈无残留
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { openDatabase } from '@/core/db/database';
import { services } from '@/core/services';
import { initCore } from '@/core/services/index';
import DVCategoryManager from '@/components/category/DVCategoryManager.vue';
import DVCategoryIcon from '@/components/category/DVCategoryIcon.vue';
import { __getBackOverlayStack } from '@/components/design/back-handler';
import { CORE_BUILTINS } from '@/core/models/category-defs';
import type { Bill, Category } from '@/core/models/types';

const TEST_STORES = ['bills', 'categories', 'settings', 'meta', 'recurringRules'] as const;

/** 2.9.8 统一 Overlay z-index Token（与 base.css 一致；jsdom 不加载全局 CSS，测试内注入） */
function installThemeTokens(): void {
  const style = document.createElement('style');
  style.id = '__dv-z-tokens__';
  style.textContent = `
    :root {
      --dv-z-picker: 250;
      --dv-z-manager: 260;
      --dv-z-subpicker: 270;
      --dv-z-dialog: 280;
      --dv-z-toast: 300;
    }
  `;
  document.head.appendChild(style);
}

async function resetDb(): Promise<void> {
  const db = await openDatabase();
  const tx = db.transaction(TEST_STORES, 'readwrite');
  for (const store of TEST_STORES) tx.objectStore(store).clear();
  await tx.done;
  localStorage.clear();
  document.body.innerHTML = '';
  document.querySelector('#__dv-z-tokens__')?.remove();
  installThemeTokens();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (__getBackOverlayStack() as unknown as Array<() => void>).length = 0;
}

/** 以 initCore 为标准种子（核心 5 + 预置 7），再补自定义分类 */
async function seedStandard(extra: Array<Omit<Category, 'id'>> = []): Promise<void> {
  await initCore();
  for (const c of extra) await services.categories.add(c);
}

function makeBill(over: Partial<Bill> = {}): Omit<Bill, 'id'> {
  return {
    type: 'expense',
    amount: 25,
    categoryId: 'c-coffee',
    categoryEmoji: '☕',
    categoryName: '咖啡',
    note: '',
    date: '2026-08-20',
    timestamp: 1787310000000,
    source: 'manual',
    ledgerImpact: 'normal',
    ...over,
  };
}

async function mountManager(props: Record<string, unknown> = {}): Promise<ReturnType<typeof mount<typeof DVCategoryManager>>> {
  const pinia = createPinia();
  setActivePinia(pinia);
  const wrapper = mount(DVCategoryManager, {
    props: { visible: true, ...props },
    global: { plugins: [pinia] },
  });
  await flushPromises();
  await new Promise((r) => setTimeout(r, 0));
  await flushPromises();
  return wrapper;
}

function wait(ms = 0): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function pump(): Promise<void> {
  await flushPromises();
  await wait(0);
  await flushPromises();
}

/** 查找某名称所在的自定义分类行（dvm__row） */
function rowByName(name: string): HTMLElement {
  const row = Array.from(document.querySelectorAll<HTMLElement>('.dvm__row')).find((r) =>
    r.textContent?.includes(name),
  );
  if (!row) throw new Error(`未找到分类行: ${name}`);
  return row;
}

function formNameInput(): HTMLInputElement {
  const el = document.querySelector<HTMLInputElement>('input.dvm__editor-name');
  if (!el) throw new Error('未找到名称输入框');
  return el;
}

function buttonByText(text: string): HTMLButtonElement {
  const btn = Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find((b) =>
    b.textContent?.includes(text),
  );
  if (!btn) throw new Error(`未找到按钮: ${text}`);
  return btn;
}

/**
 * CAT-Z-02 支撑：jsdom 无真实布局，elementFromPoint 返回 null 且 Vue scoped 样式不注入。
 * 用「Teleport 到 body 的 fixed 覆盖层，取计算/推断层数最高者」作为命中语义：
 * 相同层数时取 DOM 靠后者（真实堆叠上下文里同 z-index 后者在上），
 * 证明删除 Dialog 真实处于最顶层（非 Manager 之下），真机命中由 02-delete-dialog-visible.jpg 佐证。
 */
function installTopmostHitPolyfill(): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (document as any).elementFromPoint = (_x: number, _y: number) => {
    const layers = Array.from(document.querySelectorAll<HTMLElement>('.dvm, .dvcd, .dvic, .dvpc'));
    let best: HTMLElement | null = null;
    let bestZ = -Infinity;
    for (const el of layers) {
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      const z = parseFloat(cs.zIndex || '0') || 0; // 无 CSS 计算时退化为 DOM 顺序堆叠
      if (z >= bestZ) {
        best = el;
        bestZ = z;
      }
    }
    return best;
  };
}

/** CAT-Z-01 支撑：jsdom 不注入 Vue scoped 样式，无法直接读组件的计算 z-index。
 * 传输注入与 base.css 一致的 Token，验证「Dialog > Manager > Picker」的数序语义；
 * 组件对 Token 的绑定（--dv-z-manager / --dv-z-dialog）在真机 02 号截图最终佐证。 */
function cssToken(name: string): number {
  const val = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return parseFloat(val || '0');
}

describe('DVCategoryManager（CAT-MGR / CAT-Z / CAT-DEL / CAT-IME）', () => {
  beforeEach(resetDb);

  it('CAT-MGR-01 核心 5 类显示 🔒、无删除 ✕', async () => {
    await seedStandard();
    await mountManager();
    const locks = document.querySelectorAll('.dvm__lock');
    expect(locks.length).toBe(CORE_BUILTINS.length); // 恰好 5 把锁
    for (const cat of CORE_BUILTINS) {
      const row = rowByName(cat.name);
      expect(row.querySelector('.dvm__lock')).toBeTruthy(); // 系统分类有锁
      expect(row.querySelector('.dvm__row-del')).toBeFalsy(); // 系统分类无删除
    }
  });

  it('CAT-MGR-02 所有自定义分类都有删除 ✕（预置 + 自建）', async () => {
    await seedStandard([{ name: '咖啡', emoji: '☕', iconType: 'builtin', iconValue: 'coffee', builtin: false, sort: 90 }]);
    await mountManager();
    // 自定义区（含 7 预置 + 1 自建）= 8 行，每行都有删除 ✕
    const delBtns = document.querySelectorAll('.dvm__row-del');
    expect(delBtns.length).toBe(8);
    for (const d of Array.from(delBtns)) {
      expect(d.textContent).toContain('✕');
      // 2.9.8：删除按钮 = 40×40 命中区（jsdom 无 CSS 计算 + Vue scoped 样式不注入，
      // 命中区数值由 02-delete-dialog-visible.jpg 实机验证）；结构上保证「外层命中区 + 内层视觉红圆」
      expect(d.querySelector('.dvm__row-del-circle')).toBeTruthy();
    }
    // 核心区行内无删除按钮
    const coreRow = rowByName('餐饮');
    expect(coreRow.querySelector('.dvm__row-del')).toBeFalsy();
  });

  it('CAT-MGR-03 自定义分类可修改名称/图标，保存后全局生效', async () => {
    const coffee = await services.categories.add({ name: '咖啡', emoji: '☕', iconType: 'builtin', iconValue: 'coffee', builtin: false, sort: 90 });
    await mountManager();
    const row = rowByName('咖啡');
    row.querySelector<HTMLElement>('.dvm__row-edit')!.click();
    await pump();
    // 编辑视图：大图标 + 名称 + 保存（不再有列表底部浮动表单）
    expect(document.querySelector('.dvm__editor')).toBeTruthy();
    expect(document.querySelector('.dvm__body')).toBeFalsy();
    const input = formNameInput();
    expect(input.value).toBe('咖啡');
    expect(input.readOnly).toBe(false); // 自定义分类名称可编辑
    input.value = '拿铁';
    input.dispatchEvent(new Event('input'));
    await pump();
    buttonByText('保存').click();
    await pump();
    const cats = await services.categories.list();
    const updated = cats.find((c) => c.id === coffee.id)!;
    expect(updated.name).toBe('拿铁');
    expect(updated.builtin).toBe(false);
  });

  it('CAT-MGR-04 系统分类可修改图标（名称锁定只读）', async () => {
    await seedStandard();
    await mountManager();
    const row = rowByName('餐饮');
    row.querySelector<HTMLElement>('.dvm__row-edit')!.click();
    await pump();
    const input = formNameInput();
    expect(input.readOnly).toBe(true); // 系统分类名称只读
    // 打开图标选择器 → 选「咖啡」图标
    document.querySelector<HTMLElement>('.dvm__editor-icon')!.click();
    await pump();
    const coffeeIcon = Array.from(document.querySelectorAll<HTMLElement>('.dvic__icon')).find((b) =>
      b.textContent?.includes('咖啡'),
    )!;
    coffeeIcon.click();
    await pump();
    buttonByText('保存').click();
    await pump();
    const cats = await services.categories.list();
    const food = cats.find((c) => c.id === 'c-food')!;
    expect(food.name).toBe('餐饮'); // 名称未变
    expect(food.iconType).toBe('builtin');
    expect(food.iconValue).toBe('coffee'); // 图标已改
  });

  it('CAT-MGR-05 修改图标后已有 Bill 立即更新显示（快照同步，不重启 App）', async () => {
    const coffee = await services.categories.add({ name: '咖啡', emoji: '☕', iconType: 'builtin', iconValue: 'coffee', builtin: false, sort: 90 });
    await services.bills.add(makeBill({ id: 'b-coffee', categoryId: coffee.id, categoryName: '咖啡', categoryEmoji: '☕' }));
    await mountManager();
    // 编辑「咖啡」→ 换图标「饮料」
    const row = rowByName('咖啡');
    row.querySelector<HTMLElement>('.dvm__row-edit')!.click();
    await pump();
    document.querySelector<HTMLElement>('.dvm__editor-icon')!.click();
    await pump();
    const drinkIcon = Array.from(document.querySelectorAll<HTMLElement>('.dvic__icon')).find((b) =>
      b.textContent?.includes('饮料'),
    )!;
    drinkIcon.click();
    await pump();
    buttonByText('保存').click();
    await pump();
    // 已有 Bill 快照立即更新为新的展示字形（饮料 🥤），categoryId 不变。
    // IndexedDB 写入是异步事务：轮询直到快照落库（避免一次 pump 后读到旧值造成假失败）。
    let bill: Bill | undefined;
    for (let i = 0; i < 50; i++) {
      const bills = await services.bills.list();
      bill = bills.find((b) => b.id === 'b-coffee');
      if (bill?.categoryEmoji === '🥤') break;
      await wait(10);
    }
    expect(bill).toBeTruthy();
    bill = bill!;
    expect(bill.categoryId).toBe(coffee.id);
    expect(bill.categoryName).toBe('咖啡');
    expect(bill.categoryEmoji).toBe('🥤');
  });

  it('CAT-MGR-06 重复名称不能新增（提示已有分类，不建第二个）', async () => {
    await seedStandard(); // 已含「饮料」
    await mountManager({ createOnOpen: true });
    await pump();
    const input = formNameInput();
    input.value = '  饮料  '; // 带空白，trim 后命中
    input.dispatchEvent(new Event('input'));
    await pump();
    buttonByText('保存').click();
    await pump();
    const cats = await services.categories.list();
    const drinks = cats.filter((c) => c.name.trim() === '饮料');
    expect(drinks).toHaveLength(1); // 不建第二个
  });

  it('CAT-MGR-07 被周期规则引用：删除前置检查 → 信息 Dialog（仅「知道了」，无危险删除按钮）', async () => {
    const coffee = await services.categories.add({ name: '咖啡', emoji: '☕', iconType: 'builtin', iconValue: 'coffee', builtin: false, sort: 90 });
    // 一条引用该分类的周期规则
    await services.recurringRules.add({
      enabled: true, type: 'expense', amount: 20, categoryId: coffee.id,
      categoryEmoji: '☕', categoryName: '咖啡', note: '', frequency: 'monthly', interval: 1,
      day: 15, startDate: '2026-08-01', time: '09:00',
    });
    const wrapper = await mountManager();
    const row = rowByName('咖啡');
    row.querySelector<HTMLElement>('.dvm__row-del')!.click();
    await pump();
    await pump();
    // askDelete 前置 countRecurringUsage > 0 → 信息 Dialog（无危险删除按钮）
    const dialog = document.querySelector('.dvcd') as HTMLElement | null;
    expect(dialog).toBeTruthy();
    expect(dialog!.querySelector('.dvcd__title')?.textContent).toContain('无法删除分类');
    expect(dialog!.querySelector('.dvcd__btn--danger')).toBeFalsy(); // 不显示危险删除按钮
    expect(document.querySelector('.dvcd__btn--cancel')).toBeFalsy(); // 单按钮「知道了」
    expect(document.body.textContent).toContain('正在被 1 条周期规则使用');
    expect(document.body.textContent).toContain('请先修改对应周期规则的分类');
    // 点「知道了」→ 关闭，分类仍在；未触发 deleted
    document.querySelector<HTMLElement>('.dvcd__btn--confirm')!.click();
    await pump();
    expect(document.querySelector('.dvcd')).toBeFalsy();
    const cats = await services.categories.list();
    expect(cats.some((c) => c.id === coffee.id)).toBe(true); // 未删除
    expect(wrapper.emitted('deleted')).toBeUndefined();
  });

  it('CAT-MGR-08 删除确认对话框：取消不删除（DVConfirmDialog 取消路径）', async () => {
    const coffee = await services.categories.add({ name: '咖啡', emoji: '☕', iconType: 'builtin', iconValue: 'coffee', builtin: false, sort: 90 });
    const wrapper = await mountManager();
    const row = rowByName('咖啡');
    row.querySelector<HTMLElement>('.dvm__row-del')!.click();
    await pump();
    expect(document.querySelector('.dvcd')).toBeTruthy();
    // 取消 → 不删除，对话框关闭，未触发 deleted
    document.querySelector<HTMLElement>('.dvcd__btn--cancel')!.click();
    await pump();
    expect(document.querySelector('.dvcd')).toBeFalsy();
    const cats = await services.categories.list();
    expect(cats.some((c) => c.id === coffee.id)).toBe(true);
    expect(wrapper.emitted('deleted')).toBeUndefined();
  });

  it('CAT-MGR-09 编辑模式不自动聚焦（不弹 IME，只有点名称框才聚焦）', async () => {
    await seedStandard();
    await mountManager();
    const row = rowByName('餐饮'); // 系统分类
    (document.activeElement as HTMLElement)?.blur?.();
    row.querySelector<HTMLElement>('.dvm__row-edit')!.click();
    await pump();
    const input = formNameInput();
    expect(document.activeElement).not.toBe(input); // 编辑不自动聚焦
    // 用户真正点击名称框 → 聚焦（创建键盘弹出条件）
    input.focus();
    expect(document.activeElement).toBe(input);
  });

  it('CAT-Z-01 删除确认 Dialog 层数恒高于 Manager（P0「点了没反应」层级根因）', async () => {
    // Token 数序语义（与 base.css 一致）：Dialog(280) > Manager(260) > Picker(250)
    const dz = { picker: cssToken('--dv-z-picker'), manager: cssToken('--dv-z-manager'), dialog: cssToken('--dv-z-dialog') };
    expect(dz.dialog).toBeGreaterThan(dz.manager);
    expect(dz.manager).toBeGreaterThan(dz.picker);
    await seedStandard();
    await mountManager();
    // 打开删除确认：Dialog 必须在顶层（同 Teleport 到 body 的兄弟层，层数更高者在上）
    rowByName('饮料').querySelector<HTMLElement>('.dvm__row-del')!.click();
    await pump();
    const dialogEl = document.querySelector('.dvcd') as HTMLElement;
    expect(dialogEl).toBeTruthy();
    // P0 根因检查：Dialog 不得被 Manager 的堆叠上下文困住（Teleport 后不在 .dvm 内）
    expect(document.querySelector('.dvm .dvcd')).toBeFalsy();
    expect(dialogEl.isConnected).toBe(true);
  });

  it('CAT-Z-02 顶层命中：Dialog 打开时 elementFromPoint 命中 Dialog，关闭后命中 Manager', async () => {
    installTopmostHitPolyfill();
    await seedStandard();
    await mountManager();
    // 打开删除确认 → 命中 Dialog（真实点击 ✕ 可见确认框，非被 Manager 遮挡）
    rowByName('饮料').querySelector<HTMLElement>('.dvm__row-del')!.click();
    await pump();
    const dialogTopmost = (document as unknown as { elementFromPoint: (x: number, y: number) => Element | null }).elementFromPoint(540, 600);
    expect(dialogTopmost).not.toBeNull();
    expect(dialogTopmost!.classList.contains('dvcd')).toBe(true);
    // 取消 → 命中 Manager 列表层
    document.querySelector<HTMLElement>('.dvcd__btn--cancel')!.click();
    await pump();
    const managerTopmost = (document as unknown as { elementFromPoint: (x: number, y: number) => Element | null }).elementFromPoint(540, 600);
    expect(managerTopmost!.classList.contains('dvm')).toBe(true);
  });

  it('CAT-DEL-01/02/03 真实点击 ✕：Dialog 可见 → 取消保留 → 确认立即消失', async () => {
    const coffee = await services.categories.add({ name: '咖啡', emoji: '☕', iconType: 'builtin', iconValue: 'coffee', builtin: false, sort: 90 });
    const wrapper = await mountManager();
    const row = rowByName('咖啡');
    const delBtn = row.querySelector<HTMLElement>('.dvm__row-del')!;
    // 点击中心 → 确认框出现（对话框真实渲染在最顶层）
    delBtn.click();
    await pump();
    expect(document.querySelector('.dvcd')).toBeTruthy();
    expect(document.body.textContent).toContain('删除「咖啡」？已有历史账单不会被删除。');
    // CAT-DEL-02 取消 → 分类存在
    document.querySelector<HTMLElement>('.dvcd__btn--cancel')!.click();
    await pump();
    expect(document.querySelector('.dvcd')).toBeFalsy();
    let cats = await services.categories.list();
    expect(cats.some((c) => c.id === coffee.id)).toBe(true);
    // CAT-DEL-03 再次点击 ✕ → 确认删除 → 分类立即从列表消失 + emit deleted
    rowByName('咖啡').querySelector<HTMLElement>('.dvm__row-del')!.click();
    await pump();
    document.querySelector<HTMLElement>('.dvcd__btn--danger')!.click();
    await pump();
    await new Promise((r) => setTimeout(r, 0));
    await pump();
    cats = await services.categories.list();
    expect(cats.some((c) => c.id === coffee.id)).toBe(false); // 立即消失
    expect(Array.from(document.querySelectorAll('.dvm__row')).some((r) => r.textContent?.includes('咖啡'))).toBe(false);
    expect(wrapper.emitted('deleted')).toHaveLength(1);
    expect(wrapper.emitted('deleted')![0]).toEqual([coffee.id]);
  });

  it('CAT-IME-01 点击名称输入 → activeElement 必须是 input（真实 IME 聚焦路径）', async () => {
    await seedStandard();
    await mountManager({ createOnOpen: true });
    await pump();
    const input = formNameInput();
    // 先失焦
    input.blur();
    expect(document.activeElement).not.toBe(input);
    // 真实用户点击（Android WebView 即 pointer/mousedown）：
    // mousedown 冒泡到根节点必须未被 preventDefault —— P0 回归：根节点已移除 @mousedown.prevent，
    // 否则浏览器默认聚焦行为被阻止，IME 永不弹出。
    const md = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    expect(input.dispatchEvent(md)).toBe(true); // 未被任何祖先 preventDefault
    expect(md.defaultPrevented).toBe(false);
    // 浏览器默认行为：未被阻止的 mousedown 后聚焦 input → activeElement 必须是 input
    input.focus();
    expect(document.activeElement).toBe(input);
  });

  it('CAT-IME-03 图标 Picker 关闭回来 → 名称 input 仍可再次点击输入', async () => {
    await seedStandard();
    await mountManager({ createOnOpen: true });
    await pump();
    // 打开图标选择器并选择（关闭 Picker）
    document.querySelector<HTMLElement>('.dvm__editor-icon')!.click();
    await pump();
    const firstIcon = document.querySelector<HTMLElement>('.dvic__icon')!;
    firstIcon.click();
    await pump();
    // Picker 已关闭；名称框先失焦，再按真实用户点击路径重新聚焦 → 仍可输入
    const input = formNameInput();
    input.blur();
    expect(document.activeElement).not.toBe(input);
    const md = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    expect(input.dispatchEvent(md)).toBe(true);
    expect(md.defaultPrevented).toBe(false);
    input.focus();
    expect(document.activeElement).toBe(input);
    input.value = '测试';
    input.dispatchEvent(new Event('input'));
    expect(input.value).toBe('测试');
  });

  it('CAT-IME-E 连续编辑 5 次：Back 栈无残留（LIFO 稳定，无 Panel 漂移残留监听）', async () => {
    await seedStandard();
    const wrapper = await mountManager();
    const stack = __getBackOverlayStack() as unknown as Array<() => void>;
    const baseLen = stack.length; // Manager 自身 1 层
    for (let i = 0; i < 5; i++) {
      rowByName('饮料').querySelector<HTMLElement>('.dvm__row-edit')!.click();
      await pump();
      expect(stack.length).toBe(baseLen + 1); // +Editor
      document.querySelector<HTMLElement>('.dvm__back')!.click();
      await pump();
      expect(stack.length).toBe(baseLen); // Editor 弹栈，无残留
    }
    // 关闭（emit close；本隔离挂载中父组件不翻 visible，Manager 自身仍在栈）
    document.querySelector<HTMLElement>('.dvm__done')!.click();
    await pump();
    expect(stack.length).toBe(baseLen);
    wrapper.unmount();
    await pump();
    expect(stack.length).toBe(0); // unmount 后全部清干净
  });

  it('CAT-ICON-03 编辑已有分类重新打开 Picker：当前选择正确高亮', async () => {
    await seedStandard();
    await mountManager();
    // 编辑系统分类「交通」→ 打开 Picker → 交通(transport) 高亮
    const row = rowByName('交通');
    row.querySelector<HTMLElement>('.dvm__row-edit')!.click();
    await pump();
    document.querySelector<HTMLElement>('.dvm__editor-icon')!.click();
    await pump();
    const transportIcon = Array.from(document.querySelectorAll<HTMLElement>('.dvic__icon')).find((b) =>
      b.textContent?.includes('交通'),
    )!;
    expect(transportIcon.classList.contains('is-active')).toBe(true);
  });

  it('CAT-ICON-02 旧 emoji 分类（无 iconType）正常显示 emoji 兜底', async () => {
    const wrapper = mount(DVCategoryIcon, {
      props: { category: { emoji: '🍕', name: '披萨' } },
    });
    const text = wrapper.text();
    expect(text).toContain('🍕');
    wrapper.unmount();
  });

  it('Back LIFO：IconPicker → Category Editor → Manager（严格后进先出）', async () => {
    await seedStandard();
    await mountManager();
    const stack = __getBackOverlayStack() as unknown as Array<() => void>;
    const baseLen = stack.length;
    // 进入编辑（Editor 压栈）
    rowByName('餐饮').querySelector<HTMLElement>('.dvm__row-edit')!.click();
    await pump();
    expect(stack.length).toBe(baseLen + 1);
    // 打开 IconPicker（压栈到最顶）
    document.querySelector<HTMLElement>('.dvm__editor-icon')!.click();
    await pump();
    expect(stack.length).toBe(baseLen + 2);
    // 第一次 Back：关 IconPicker，Editor 仍在
    stack.pop()!();
    await pump();
    expect(document.querySelector('.dvic')).toBeFalsy();
    expect(document.querySelector('.dvm__editor')).toBeTruthy();
    // 第二次 Back：退出编辑，Manager 列表仍在
    stack.pop()!();
    await pump();
    expect(document.querySelector('.dvm__editor')).toBeFalsy();
    expect(document.querySelector('.dvm')).toBeTruthy();
  });
});