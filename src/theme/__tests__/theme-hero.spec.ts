/**
 * 2.13.1 Hero Surface Theme Integration 测试（THEME-HERO-01..07）
 * - Hero（记账月卡 / 日价总览大卡）从「固定绿色」改为「随 Theme Color + Theme Style」
 * - jsdom 无法计算 color-mix 渐变，因而 Hero 视觉断言采用 base.css 源级校验 + store/dataset 功能断言
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createPinia, setActivePinia } from 'pinia';
import accountingSrc from '@/pages/accounting/AccountingPage.vue?raw';
import dailyValueSrc from '@/pages/daily-value/DailyValuePage.vue?raw';
import { useAppStore } from '@/core/store/app';
import { useSettingsStore } from '@/core/store/settings';
import { services } from '@/core/services';
import type { Settings } from '@/core/models/types';

const root = process.cwd();
const base = readFileSync(join(root, 'src/theme/base.css'), 'utf-8');

/** 取第一个 `.xxx { ... }` 块 */
function blockOf(source: string, selector: string): string {
  const idx = source.indexOf(`${selector} {`);
  if (idx < 0) return '';
  const open = source.indexOf('{', idx) + 1;
  const close = source.indexOf('}', open);
  return close > open ? source.slice(open, close) : '';
}

const GREEN_STOPS = ['#23b26e', '#17a05d', '#129157', '#1f9e63', '#158a52', '#0f7c47', 'rgba(31, 158, 99', 'rgba(35, 178, 110', 'rgba(21, 138, 82'];

describe('THEME-HERO 源级校验（base.css）', () => {
  it('HERO-01 Hero Card 不再硬编码固定绿色（--dv-hero-bg 一律由主色派生）', () => {
    for (const sel of [':root', "[data-theme='dark']", "[data-theme-style='soft']", "[data-theme-style='minimal']", "[data-theme='light'][data-theme-style='glass']", "[data-theme='dark'][data-theme-style='glass']"]) {
      const block = blockOf(base, sel);
      if (!block.includes('--dv-hero-bg')) continue; // 该块不定义 Hero 则跳过
      expect(block).toMatch(/--dv-hero-bg:[^;]*var\(--dv-primary\)/);
      for (const s of GREEN_STOPS) {
        expect(block).not.toContain(s);
      }
    }
  });

  it('HERO-04m Hero Token 完全由 --dv-primary 间接派生（自定义色可经 inline primary 生效）', () => {
    // :root 默认 Hero：classic 饱和渐变（82% white / primary / 84% black），文字 on-primary
    const rootRule = blockOf(base, ':root');
    expect(rootRule).toContain('color-mix(in srgb, var(--dv-primary) 82%, white)');
    expect(rootRule).toContain('var(--dv-primary) 55%');
    expect(rootRule).toContain('color-mix(in srgb, var(--dv-primary) 84%, black)');
    expect(rootRule).toContain('--dv-hero-text: var(--dv-on-primary)');
    // soft/minimal/glass 各块均引用 --dv-primary 派生（不写死绿/白）
    const soft = blockOf(base, "[data-theme-style='soft']");
    expect(soft).toContain('--dv-hero-bg: linear-gradient(');
    expect(soft).toMatch(/--dv-hero-bg:[^;]*var\(--dv-primary\)/);
    const minimal = blockOf(base, "[data-theme-style='minimal']");
    expect(minimal).toMatch(/--dv-hero-bg:[^;]*var\(--dv-primary\)/);
    expect(minimal).toContain('--dv-hero-border: 1px solid color-mix(in srgb, var(--dv-primary) 30%');
  });

  it('HERO-07a Wallpaper 块不再把 Hero 覆盖回绿色（只负责透明/模糊/遮罩）', () => {
    const wp = blockOf(base, "[data-wallpaper='on']");
    expect(wp).not.toContain('--dv-hero-');
    expect(wp).not.toContain('--dv-month-card-');
    expect(wp).not.toContain('178, 110');
    expect(wp).not.toContain('158, 99');
  });
});

describe('THEME-HERO 页面消费', () => {
  it('HERO-05 Accounting 与 DailyValue 使用同一 Hero Token（不再消费 month-card）', () => {
    expect(accountingSrc).toContain('background: var(--dv-hero-bg)');
    expect(dailyValueSrc).toContain('background: var(--dv-hero-bg)');
    expect(accountingSrc).not.toContain('var(--dv-month-card-bg)');
    expect(dailyValueSrc).not.toContain('var(--dv-month-card-bg)');
  });

  it('HERO-06 语义色不跟随主题：页面仍消费 --dv-expense / --dv-income', () => {
    expect(accountingSrc).toContain('var(--dv-expense)');
    expect(accountingSrc).toContain('var(--dv-income)');
    expect(dailyValueSrc).toContain('var(--dv-expense)');
  });
});

describe('THEME-HERO 应用层', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    setActivePinia(createPinia());
  });

  it('HERO-02 切换 blue：dataset.theme-color 改变（Hero 背景随主色联动）', () => {
    const app = useAppStore();
    app.setThemeColor('blue');
    expect(document.documentElement.dataset.themeColor).toBe('blue');
    expect(app.themeRevision).toBeGreaterThanOrEqual(1);
  });

  it('HERO-03 切换 rose：dataset.theme-color 再次改变（与 blue 不同 → Hero 再次联动）', () => {
    const app = useAppStore();
    app.setThemeColor('blue');
    const blue = document.documentElement.dataset.themeColor;
    app.setThemeColor('rose');
    const rose = document.documentElement.dataset.themeColor;
    expect(rose).toBe('rose');
    expect(rose).not.toBe(blue);
  });

  it('HERO-04 Custom：#9BE86A 应用后 inline --dv-primary 被设置（Hero 由 var(--dv-primary) 间接派生）', async () => {
    const settings = useSettingsStore();
    const saved: Settings = {
      currency: '¥',
      theme: 'light',
      themeColor: 'violet',
      sort: 'per',
      wallpaper: undefined,
    };
    vi.spyOn(services.settings, 'get').mockImplementation(async () => saved as never);
    vi.spyOn(services.settings, 'update').mockImplementation(
      async (patch) => ({ ...saved, ...patch }) as never,
    );
    await settings.load();
    await settings.update({ themeColor: 'custom', customThemeColor: '#9BE86A' });
    const root = document.documentElement as HTMLElement;
    expect(root.style.getPropertyValue('--dv-primary')).toMatch(/^#/);
    // 语义色不随自定义主色变化（HERO-06 应用层）
    expect(root.style.getPropertyValue('--dv-expense')).toBe('');
    expect(root.style.getPropertyValue('--dv-income')).toBe('');
  });

  it('HERO-07 Wallpaper ON 后 Hero 仍保持当前主题色（不恢复绿色）：wallpaper 只写对 dataset/壁纸变量', async () => {
    const settings = useSettingsStore();
    const saved: Settings = {
      currency: '¥',
      theme: 'light',
      themeColor: 'blue',
      sort: 'per',
      wallpaper: undefined,
    };
    vi.spyOn(services.settings, 'get').mockImplementation(async () => saved as never);
    vi.spyOn(services.settings, 'update').mockImplementation(
      async (patch) => ({ ...saved, ...patch }) as never,
    );
    await settings.load();
    expect(document.documentElement.dataset.themeColor).toBe('blue');
    await settings.update({
      wallpaper: { image: 'data:image/jpeg;base64,/9j/x', blur: 4, overlay: 0.25 },
    });
    // 壁纸开启后主题色保持不变（Hero 颜色由 Theme 决定，壁纸不改色）
    expect(document.documentElement.dataset.wallpaper).toBe('on');
    expect(document.documentElement.dataset.themeColor).toBe('blue');
    expect(document.documentElement.style.getPropertyValue('--dv-wallpaper-image')).toContain('data:image');
  });
});