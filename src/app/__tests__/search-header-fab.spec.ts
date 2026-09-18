/**
 * 2.21.1 - 搜索入口迁移（Header 全局）+ Glass FAB 真毛玻璃（源级静态校验）
 *
 * SEARCH-HEADER-01：月份卡不再存在 Emoji 搜索按钮
 * SEARCH-HEADER-02：一级页面 Header 存在搜索入口
 * SEARCH-HEADER-03：搜索入口 → /bill-search
 * SEARCH-HEADER-04：源码中搜索入口使用 Lucide，不含 🔍/🔎
 * GLASS-FAB-01：Glass FAB 存在 backdrop-filter
 * GLASS-FAB-02：Glass FAB 不再使用 32% 重 Tint（深/浅均为 8~14%）
 * GLASS-FAB-03：Classic（默认 / soft / minimal）FAB 不受玻璃化影响
 * 另校验：弹层面板 Overlay Token 未被本次改动重新变透明（回归护栏）
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const readVue = (rel: string) => readFileSync(join(root, rel), 'utf-8');

const accounting = readVue('src/pages/accounting/AccountingPage.vue');
const appVue = readVue('src/App.vue');
const searchPage = readVue('src/pages/search/BillSearchPage.vue');
const base = readVue('src/theme/base.css');

/** 取第一个 `.xxx { ... }` 块内容 */
function blockOf(source: string, selector: string): string {
  const idx = source.indexOf(`${selector} {`);
  if (idx < 0) return '';
  const open = source.indexOf('{', idx) + 1;
  const close = source.indexOf('}', open);
  return close > open ? source.slice(open, close) : '';
}

const GLASS_DARK_GATE = "[data-theme='dark'][data-theme-style='glass']";
const GLASS_LIGHT_GATE = "[data-theme='light'][data-theme-style='glass']";

describe('2.21.1 SEARCH-HEADER（搜索入口迁移 Header）', () => {
  it('SEARCH-HEADER-01 月份卡不再存在 Emoji 搜索按钮（accounting__card-search 与 🔍 已移除）', () => {
    expect(accounting).not.toContain('accounting__card-search');
    expect(accounting).not.toContain('🔍');
    expect(accounting).not.toContain('🔎');
    // 月份卡仍保留 上一月/下一月（职责纯粹）
    expect(accounting).toContain('aria-label="下一月"');
  });

  it('SEARCH-HEADER-02 一级页面 Header 存在搜索入口（.app-shell__search-entry + 文案「搜索账单」）', () => {
    expect(appVue).toContain('class="app-shell__search-entry"');
    expect(appVue).toContain('<span>搜索账单</span>');
    // 搜索入口是入口按钮而非输入框（无 input/无 v-model 关键词）
    expect(appVue).not.toContain('app-shell__search-input');
  });

  it('SEARCH-HEADER-03 搜索入口 → /bill-search；设置 icon 用 Lucide Settings', () => {
    expect(appVue).toContain('to="/bill-search"');
    expect(appVue).toContain('to="/settings"');
    expect(appVue).toContain('from \'lucide-vue-next\'');
    expect(appVue).toContain('<Settings');
    expect(appVue).toContain('<Search');
  });

  it('SEARCH-HEADER-04 源码中搜索入口使用 Lucide，不含 🔍/🔎 emoji（App/记账页/搜索页）', () => {
    for (const src of [appVue, accounting, searchPage]) {
      expect(src).not.toContain('🔍');
      expect(src).not.toContain('🔎');
    }
    expect(accounting).not.toContain('Search') ; // 记账页彻底不再有搜索 UI（迁移到 Header）
    expect(searchPage).toContain("import { Search } from 'lucide-vue-next'");
    expect(searchPage).toContain('<Search :size="16"');
    expect(searchPage).not.toContain('class="bill-search__box-icon" aria-hidden="true">🔍');
  });
});

describe('2.21.1 GLASS-FAB（FAB 真毛玻璃）', () => {
  it('GLASS-FAB-01 Glass FAB 规则存在 backdrop-filter（壁纸透出）', () => {
    const fabRule = blockOf(base, "[data-theme-style='glass'] .global-primary-fab");
    expect(fabRule).toContain('-webkit-backdrop-filter: blur(18px) saturate(145%)');
    expect(fabRule).toContain('backdrop-filter: blur(18px) saturate(145%)');
    expect(fabRule).toContain('--dv-fab-bg');
  });

  it('GLASS-FAB-02 不再使用 32% 重 Tint（深/浅均为 8~14% 轻 Tint）', () => {
    const dark = blockOf(base, GLASS_DARK_GATE);
    const light = blockOf(base, GLASS_LIGHT_GATE);
    // 深玻璃：32% → 11%（8~14% 区间内）
    expect(dark).toContain('var(--dv-accent) 11%');
    expect(dark).not.toContain('var(--dv-accent) 32%');
    // 浅玻璃：不再是实心主色块（12% 轻 Tint 透明白玻璃）
    expect(light).toContain('var(--dv-primary) 12%');
    expect(light).not.toContain('--dv-fab-bg: var(--dv-primary)');
  });

  it('GLASS-FAB-03 Classic/默认 FAB 不受玻璃化影响；soft/minimal 不引入 backdrop-filter', () => {
    const rootRule = blockOf(base, ':root');
    expect(rootRule).toContain('--dv-fab-bg: var(--dv-primary)');
    // 玻璃化只在 glass 风格选择器上（soft/minimal 无 FAB backdrop-filter）
    expect(base).toContain("[data-theme-style='glass'] .global-primary-fab");
    expect(base).not.toContain("[data-theme-style='soft'] .global-primary-fab");
    expect(base).not.toContain("[data-theme-style='minimal'] .global-primary-fab");
  });

  it('GLASS-FAB-04 弹层面板 Overlay Token 未被本次改动重新变透明（回归护栏）', () => {
    const dark = blockOf(base, GLASS_DARK_GATE);
    const light = blockOf(base, GLASS_LIGHT_GATE);
    expect(dark).toContain('--dv-overlay-panel-bg: rgba(13, 13, 16, 0.85)');
    expect(dark).toContain('--dv-overlay-panel-blur: blur(24px) saturate(140%)');
    expect(light).toContain('--dv-overlay-panel-bg');
    expect(light).toContain('--dv-overlay-panel-blur');
  });
});