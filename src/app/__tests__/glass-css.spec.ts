/**
 * 玻璃强调色 CSS Token（2.10.4 Visual Polish）源级校验。
 * jsdom 不应用 CSS，直接以 node:fs 读取 src/theme/base.css 做字符串级断言：
 * - 默认状态（无 data-theme-glass / off）= 现状（不得出现半透明换肤生效）
 * - 强调色与深色换肤块存在且带门禁
 * - 背景光晕仅无壁纸深色玻璃启用
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const base = readFileSync(join(root, 'src/theme/base.css'), 'utf-8');

/** 取第一个 `.xxx { ... }` 块内容（不含空行/缩进敏感） */
function blockOf(selector: string): string {
  const idx = base.indexOf(`${selector} {`);
  if (idx < 0) return '';
  const open = base.indexOf('{', idx) + 1;
  const close = base.indexOf('}', open);
  return close > open ? base.slice(open, close) : '';
}

const DARK_GLASS_GATE = "[data-theme='dark'][data-theme-glass]:not([data-theme-glass='off'])";

describe('GLASS-CSS（层源静态校验）', () => {
  it('GLASS-CSS-01 :root 默认玻璃 Token 回落现状：--dv-card-bg 引用 surface、accent 透明、非半透明面', () => {
    const rootRule = blockOf(':root');
    expect(rootRule).toContain('--dv-card-bg: var(--dv-surface)');
    expect(rootRule).toContain('--dv-accent: transparent');
    expect(rootRule).toContain('--dv-fab-bg: var(--dv-primary)');
    // 默认（:root 内在无玻璃 selector 前提下）不得含半透明玻璃面常量
    expect(rootRule).not.toContain('rgba(255, 255, 255, 0.05)');
  });

  it('GLASS-CSS-02 强调色块注入 accent；深色换肤含玻璃 surface 与 color-mix 月卡，且全部带门禁', () => {
    expect(base).toContain("[data-theme-glass='crimson']");
    expect(base).toContain('--dv-accent: #ff4d4d');
    expect(base).toContain("[data-theme-glass='amber']");
    expect(base).toContain("[data-theme-glass='ice']");
    const skin = blockOf(DARK_GLASS_GATE);
    expect(skin).toContain('--dv-surface: rgba(255, 255, 255, 0.05)');
    expect(skin).toContain('--dv-page-bg: transparent');
    expect(skin).toContain('--dv-month-card-bg');
    expect(skin).toContain('color-mix(in srgb, var(--dv-accent)');
  });

  it('GLASS-CSS-03 背景光晕仅无壁纸深色玻璃启用（含 :not([data-wallpaper]) 门禁）', () => {
    expect(base).toContain(`${DARK_GLASS_GATE}:not([data-wallpaper='on']) .wallpaper-layer::after`);
    expect(base).toContain('radial-gradient(140% 130%');
  });

  it('GLASS-CSS-04 FAB 玻璃化规则存在（两个页面 FAB）且带深色门禁', () => {
    expect(base).toContain(`${DARK_GLASS_GATE} .accounting__fab`);
    expect(base).toContain(`${DARK_GLASS_GATE} .dv__fab`);
  });

  it('GLASS-CSS-05 Sheet 深玻璃底板：深色玻璃下 .dv-sheet__panel 为 85% 深玻璃实底（防快速记账与主界面重叠）', () => {
    const sheet = blockOf(`${DARK_GLASS_GATE} .dv-sheet__panel`);
    expect(sheet).toContain('rgba(13, 13, 16, 0.85)');
    expect(sheet).toContain('blur(24px)');
  });
});