/**
 * 2.9.4 最终 UI Polish 回归测试
 * 覆盖 POLISH-01..05（jsdom 无法计算真实像素布局，
 * 因此以「DOM 结构 + 计算样式 + CSS 源码断言」方式锁定修复点；
 * 真实溢出/截图由 Android 模拟器验收，不在此堆脆弱截图测试）。
 *
 * POLISH-01 Recurring 最后字段不被 sticky footer 遮挡
 * POLISH-02 DailyValue 空状态不重复
 * POLISH-03 主页面 transition 存在且不影响路由（KeepAlive 保滚动）
 * POLISH-04 CategoryPicker 窄屏添加区按钮可见
 * POLISH-05 Light/Dark 主页面对比度无明显回归
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { createMemoryHistory, createRouter } from 'vue-router';
import { openDatabase } from '@/core/db/database';
import { services } from '@/core/services';
import { colors } from '@/theme/tokens';
import RecurringEditorSheet from '@/pages/settings/RecurringEditorSheet.vue';
import DailyValuePage from '@/pages/daily-value/DailyValuePage.vue';
import DVCategoryPicker from '@/components/category/DVCategoryPicker.vue';

// 源码级断言通过 Vite ?raw 导入读取（避免测试依赖 node:fs/process，与 tsconfig 类型配置一致）
import recurringEditorSrc from '@/pages/settings/RecurringEditorSheet.vue?raw';
import appSrc from '@/App.vue?raw';
import managerSrc from '@/components/category/DVCategoryManager.vue?raw';

const STORES = ['bills', 'categories', 'settings', 'meta', 'recurringRules'] as const;

async function resetDb(): Promise<void> {
  const db = await openDatabase();
  const tx = db.transaction(STORES, 'readwrite');
  for (const s of STORES) tx.objectStore(s).clear();
  await tx.done;
  localStorage.clear();
  document.body.innerHTML = '';
}

/* ---------------- POLISH-01 ---------------- */

describe('POLISH-01 Recurring 最后字段不被 sticky footer 遮挡', () => {
  beforeEach(resetDb);

  it('表单滚动区带 overflow-y:auto + 足够 bottom padding + scroll-padding-bottom', async () => {
    // jsdom 的 CSSOM 对 scoped 样式计算不可靠（overflow-y 回退 visible），
    // 因此直接断言 SFC 样式源码，锁定「滚动区 + 底部间距」修复点。
    const css = recurringEditorSrc.slice(
      recurringEditorSrc.indexOf('.rr-form__fields {'),
      recurringEditorSrc.indexOf('.rr-form__fields > *'),
    );
    // 独立滚动：超高时滚动而不是压缩表单
    expect(css).toContain('overflow-y: auto');
    // 最后一项滚到底时完整停在保存按钮上方（padding ≥ 16px）
    expect(css).toContain('padding-bottom: var(--dv-space-lg)');
    // IME 打开时聚焦/滚动锚定同样尊重底部间距
    expect(css).toContain('scroll-padding-bottom: var(--dv-space-lg)');
    // 不允许通过压缩控件高度解决：子项禁止参与压缩
    expect(recurringEditorSrc).toContain('.rr-form__fields > *');
    expect(
      recurringEditorSrc.slice(
        recurringEditorSrc.indexOf('.rr-form__fields > *'),
        recurringEditorSrc.indexOf('.rr-form__fields > *') + 120,
      ),
    ).toContain('flex-shrink: 0');
  });

  it('「开始日期/时间」字段与 sticky 保存按钮结构都存在且互不嵌套', async () => {
    await services.categories.add({ name: '餐饮', emoji: '🍚', builtin: true, sort: 1 });
    const pinia = createPinia();
    setActivePinia(pinia);
    mount(RecurringEditorSheet, { props: { modelValue: true }, global: { plugins: [pinia] } });
    await flushPromises();

    const datetime = document.querySelector<HTMLElement>('.rf-datetime');
    expect(datetime).toBeTruthy();
    // 按钮本身显示日期/时间值（如 2026-08-26 09:00）
    expect(datetime!.textContent).toMatch(/\d{4}-\d{2}-\d{2}/);
    // 其 label「开始日期 / 时间」为同一滚动区内的独立元素
    const labels = [...document.querySelectorAll<HTMLElement>('.rr-form__fields .rf-label')];
    expect(labels.some((l) => l.textContent.includes('开始日期'))).toBe(true);
    // 保存按钮为 Sheet 内 sticky footer，独立于滚动区之外（非嵌套在 fields 内）
    const save = document.querySelector<HTMLElement>('.rr-footer__save');
    expect(save).toBeTruthy();
    const fields = document.querySelector<HTMLElement>('.rr-form__fields');
    expect(fields!.contains(save!)).toBe(false);
    expect(fields!.contains(datetime!)).toBe(true);
  });
});

/* ---------------- POLISH-02 ---------------- */

/** 2.10.7：页面级 mount 需真实 Router 注入（useRoute 入口归属门禁），最小路由 = 本页 */
async function makeDvRouter() {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/daily-value', component: DailyValuePage }],
  });
  await router.push('/daily-value');
  await router.isReady();
  return router;
}

describe('POLISH-02 DailyValue 空状态不重复', () => {
  beforeEach(resetDb);

  it('空状态：绿色卡只保留「每日总花费 ¥0.00」，不重复空文案', async () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    const router = await makeDvRouter();
    const wrapper = mount(DailyValuePage, { global: { plugins: [pinia, router] } });
    await flushPromises();

    const summary = wrapper.find('.dv__summary');
    expect(summary.exists()).toBe(true);
    expect(summary.text()).toContain('每日总花费');
    expect(summary.text()).toContain('0.00');
    // 绿色卡不再写空状态文案
    expect(summary.text()).not.toContain('还没有日价物品');
  });

  it('空状态：列表区只有一个简洁两行空状态', async () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    const router = await makeDvRouter();
    const wrapper = mount(DailyValuePage, { global: { plugins: [pinia, router] } });
    await flushPromises();

    const empties = wrapper.findAll('.dv__empty');
    expect(empties).toHaveLength(1);
    const text = empties[0].text().replace(/\s+/g, ' ');
    // 两行内：第一行标题 + 第二行引导（2.9.5 起日价页有独立 FAB，空状态引导指向右下角 ＋）
    expect(text).toContain('还没有日价物品');
    expect(text).toContain('点击右下角 ＋ 可直接添加');
    // 全页不再出现第二份重复引导文案
    expect(wrapper.text().match(/还没有日价物品/g)).toHaveLength(1);
  });
});

/* ---------------- POLISH-03 ---------------- */

describe('POLISH-03 一级路由稳定结构（2.9.6 移除高风险 Transition）', () => {
  it('App.vue 不再包裹一级 RouterView Transition（P0-1 根因），KeepAlive 保留', () => {
    // 2.9.6（P0-1）：Transition(out-in)+KeepAlive 对路由组件根节点有单根要求，
    // DailyValuePage 曾因多根 Fragment 触发路由空白。本轮稳定优先，移除路由 Transition。
    expect(appSrc).not.toContain('name="dv-page"');
    expect(appSrc).not.toContain('mode="out-in"');
    // 旧 transition CSS 一并清理
    expect(appSrc).not.toContain('.dv-page-enter');
    expect(appSrc).not.toContain('.dv-page-leave');
    // KeepAlive 保留：只缓存三个一级业务页面（Accounting 长列表返回不丢滚动位置）
    expect(appSrc).toContain("include=\"['AccountingPage', 'StatisticsPage', 'DailyValuePage']\"");
  });

  it('KeepAlive include 精确等于三个一级业务页面', () => {
    // include 只允许缓存正式一级页面；settings/design 每次进入重建（保持原有行为）
    expect(appSrc).toContain('AccountingPage');
    expect(appSrc).toContain('StatisticsPage');
    expect(appSrc).toContain('DailyValuePage');
    expect(appSrc).not.toContain("'SettingsPage'");
    expect(appSrc).not.toContain("'DesignDemoPage'");
  });
});

/* ---------------- POLISH-04 ---------------- */

describe('POLISH-04 分类「添加/编辑」统一走 DVCategoryManager，Editor 独立视图（2.9.8 双视图）', () => {
  beforeEach(resetDb);

  async function openCreateForm(): Promise<void> {
    const pinia = createPinia();
    setActivePinia(pinia);
    mount(DVCategoryPicker, { props: { visible: true }, global: { plugins: [pinia] } });
    await flushPromises();
    const addBtn = document.querySelector<HTMLElement>('.dvpc__cell--add');
    expect(addBtn).toBeTruthy();
    addBtn!.click();
    await flushPromises();
    // 唯一管理实现：DVCategoryManager create mode Editor 视图立即出现（Teleport 到 body）
    expect(document.querySelector('.dvm__editor')).toBeTruthy();
  }

  it('DVCategoryPicker [＋ 添加分类] → DVCategoryManager Editor 视图（大图标 + 名称 + 全宽保存）', async () => {
    await openCreateForm();
    const editor = document.querySelector<HTMLElement>('.dvm__editor')!;
    expect(editor.querySelector('.dvm__editor-icon')).toBeTruthy(); // 64×64 图标入口（更换图标）
    expect(editor.querySelector('.dvm__editor-icon-hint')).toBeTruthy();
    expect(editor.querySelector('input.dvm__editor-name')).toBeTruthy(); // 名称输入（编辑时非只读）
    expect(editor.querySelector('.dvm__editor-save')).toBeTruthy(); // 全宽主按钮保存
    // 编辑视图（Editor）独立于 QuickEntry 自定义数字键盘（Manager Teleport 到 body，不挡在后面）
    expect(document.querySelector('.qe__pad')).toBeFalsy();
    // 列表视图与编辑视图互斥：进入 Editor 后列表 body 不渲染（键盘不再盖住列表操作）
    expect(document.querySelector('.dvm__body')).toBeFalsy();
    expect(document.querySelector('.dvm__back')).toBeTruthy(); // ‹ 返回列表
    // 保存为全宽主按钮（源码断言；jsdom CSSOM 计算不可靠）
    const saveCss = managerSrc.slice(managerSrc.indexOf('.dvm__editor-save'), managerSrc.indexOf('.dvm__confirm-text'));
    expect(saveCss).toContain('width: 100%');
    expect(saveCss).toContain('height: 48px');
  });

  it('Editor 与 LIST 双视图互斥（v-if="!formMode" / v-else），保存按钮随 Editor 一起存在', () => {
    // 源码断言：列表在 formMode 为空时渲染，Editor 在 formMode 非空时渲染（互斥，非同屏叠加）
    expect(managerSrc).toContain('v-if="!formMode"');
    const listBlock = managerSrc.slice(managerSrc.indexOf('v-if="!formMode"'), managerSrc.indexOf('EDITOR MODE'));
    expect(listBlock).toContain('.dvm__body');
    expect(managerSrc).toContain('EDITOR MODE');
    // 保存按钮只属于 Editor 视图（列表视图没有悬浮输入表单/按钮组）
    expect(managerSrc).toContain('.dvm__editor-save');
  });
});

/* ---------------- POLISH-05 ---------------- */

describe('POLISH-05 Light/Dark 主页面对比度无明显回归', () => {
  function luminance(hex: string): number {
    const c = hex.replace('#', '');
    const [r, g, b] = [0, 2, 4].map((i) => Number.parseInt(c.slice(i, i + 2), 16) / 255);
    const lin = (v: number): number => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  }

  function ratio(a: string, b: string): number {
    const la = luminance(a);
    const lb = luminance(b);
    const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
    return (hi + 0.05) / (lo + 0.05);
  }

  it('Light：主文本与次级文本在页面背景上满足对比度', () => {
    const { background, onSurface, onSurfaceVariant } = colors.light;
    // 主文本 ≥ 7（AAA），次级文本 ≥ 4.5（AA）
    expect(ratio(onSurface, background)).toBeGreaterThanOrEqual(7);
    expect(ratio(onSurfaceVariant, background)).toBeGreaterThanOrEqual(4.5);
  });

  it('Dark：主文本与次级文本在页面背景上满足对比度', () => {
    const { background, onSurface, onSurfaceVariant } = colors.dark;
    expect(ratio(onSurface, background)).toBeGreaterThanOrEqual(7);
    expect(ratio(onSurfaceVariant, background)).toBeGreaterThanOrEqual(4.5);
  });

  it('明暗模式下文案色均非「同色即不可读」的退化组合', () => {
    for (const mode of ['light', 'dark'] as const) {
      const t = colors[mode];
      // onSurface 与 background 必须不同色（避免同色不可读）
      expect(t.onSurface.toLowerCase()).not.toBe(t.background.toLowerCase());
      expect(ratio(t.onSurface, t.surface)).toBeGreaterThanOrEqual(7);
    }
  });
});
