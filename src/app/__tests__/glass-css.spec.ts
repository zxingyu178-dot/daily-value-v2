/**
 * Theme V2 CSS Token（2.13.0）源级校验。
 * jsdom 不应用 CSS，直接以 node:fs 读取 src/theme/base.css 做字符串级断言：
 * - 默认状态（无 data-theme-style / classic）= 现状（不得出现半透明换肤生效）
 * - 四种风格块存在且位于 Token 层（data-theme-style 门禁）
 * - glass 深色块含玻璃 surface、Overlay 面板 Token（2.10.9 视觉标准，弹层不变透明）
 * - 旧 data-theme-glass 皮肤块已收敛（属性不再驱动视觉）
 * - FAB 玻璃化由 glass 风格启用
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const base = readFileSync(join(root, 'src/theme/base.css'), 'utf-8');
const readVue = (rel: string) => readFileSync(join(root, rel), 'utf-8');

/** 取第一个 `.xxx { ... }` 块内容（不含空行/缩进敏感）；跨组件文件通用 */
function blockOf(source: string, selector: string): string {
  const idx = source.indexOf(`${selector} {`);
  if (idx < 0) return '';
  const open = source.indexOf('{', idx) + 1;
  const close = source.indexOf('}', open);
  return close > open ? source.slice(open, close) : '';
}

const GLASS_DARK_GATE = "[data-theme='dark'][data-theme-style='glass']";
const GLASS_LIGHT_GATE = "[data-theme='light'][data-theme-style='glass']";

describe('THEME-V2-CSS（源层静态校验）', () => {
  it('V2-CSS-01 :root 默认 Token 回落现状：card-bg 引用 surface、accent 透明、非半透明面、Overlay 默认 Surface', () => {
    const rootRule = blockOf(base, ':root');
    expect(rootRule).toContain('--dv-card-bg: var(--dv-surface)');
    expect(rootRule).toContain('--dv-accent: transparent');
    expect(rootRule).toContain('--dv-fab-bg: var(--dv-primary)');
    expect(rootRule).toContain('--dv-overlay-panel-bg: var(--dv-surface)');
    expect(rootRule).toContain('--dv-overlay-panel-blur: none');
    // classic 即默认，:root 内不得含半透明玻璃面常量
    expect(rootRule).not.toContain('rgba(255, 255, 255, 0.05)');
  });

  it('V2-CSS-02 四种风格块均存在且带 data-theme-style 门禁（soft/minimal/glass Light+Dark）', () => {
    expect(base).toContain("[data-theme-style='soft']");
    expect(base).toContain("[data-theme='dark'][data-theme-style='soft']");
    expect(base).toContain("[data-theme-style='minimal']");
    expect(base).toContain(GLASS_LIGHT_GATE);
    expect(base).toContain(GLASS_DARK_GATE);
  });

  it('V2-CSS-03 深/浅 glass 块含玻璃 surface、非硬编码主色 accent（color-mix primary）', () => {
    const dark = blockOf(base, GLASS_DARK_GATE);
    expect(dark).toContain('--dv-page-bg: transparent');
    expect(dark).toContain('--dv-surface: rgba(255, 255, 255, 0.05)');
    expect(dark).toContain('--dv-accent: var(--dv-primary)');
    expect(dark).not.toContain('--dv-accent: #ff4d4d'); // 不再硬编码旧 glass 色
    expect(dark).toContain('color-mix(in srgb, var(--dv-primary)');
    const light = blockOf(base, GLASS_LIGHT_GATE);
    expect(light).toContain('--dv-surface: rgba(255, 255, 255, 0.55)');
    expect(light).toContain('--dv-accent: var(--dv-primary)');
  });

  it('V2-CSS-04 glass 风格下 Overlay 面板保持 2.10.9 视觉标准（不重新变透明）', () => {
    const dark = blockOf(base, GLASS_DARK_GATE);
    expect(dark).toContain('--dv-overlay-panel-bg: rgba(13, 13, 16, 0.85)');
    expect(dark).toContain('--dv-overlay-panel-blur: blur(24px) saturate(140%)');
    expect(dark).toContain('--dv-overlay-panel-border: 1px solid rgba(255, 255, 255, 0.08)');
    const light = blockOf(base, GLASS_LIGHT_GATE);
    expect(light).toContain('--dv-overlay-panel-bg');
    expect(light).toContain('--dv-overlay-panel-blur');
  });

  it('V2-CSS-05 Hero（月卡/日价大卡）在 glass 风格使用主色 Tint + 玻璃 Surface，不再硬编码绿色', () => {
    for (const gate of [GLASS_DARK_GATE, GLASS_LIGHT_GATE]) {
      const block = blockOf(base, gate);
      // Hero 背景由主题主色派生（color-mix primary），禁止绿色常量
      expect(block).toContain('--dv-hero-bg: linear-gradient(');
      expect(block).toContain('color-mix(in srgb, var(--dv-primary) 24%');
      expect(block).not.toContain('rgba(31, 158, 99, 0.95)');
      expect(block).not.toContain('rgba(35, 178, 110, 0.95)');
      // Hero 描边由主色混合
      expect(block).toContain('--dv-hero-border: color-mix(in srgb, var(--dv-primary) 25%');
    }
    // hardcode 绿色月卡规则已全部移除（仅剩 Hero Token 与 alias）
    const dark = blockOf(base, GLASS_DARK_GATE);
    expect(dark).not.toContain('--dv-month-card-bg: linear-gradient');
  });

  it('V2-CSS-06 背景光晕仅无壁纸深色 glass 启用；FAB 玻璃化由 glass 风格启用（全局唯一 FAB）', () => {
    expect(base).toContain(`${GLASS_DARK_GATE}:not([data-wallpaper='on']) .wallpaper-layer::after`);
    expect(base).toContain('radial-gradient(140% 130%');
    expect(base).toContain("[data-theme-style='glass'] .global-primary-fab");
    expect(base).not.toContain("[data-theme-style='glass'] .accounting__fab");
    expect(base).not.toContain("[data-theme-style='glass'] .dv__fab");
  });

  it('V2-CSS-07 弹层面板统一消费 --dv-overlay-panel-* Token（2.10.9：全部弹层共用同一套背景/blur/border）', () => {
    const panels: Array<{ file: string; selector: string }> = [
      { file: 'src/components/design/DVSheet.vue', selector: '.dv-sheet__panel' },
      { file: 'src/components/design/DVConfirmDialog.vue', selector: '.dvcd__panel' },
      { file: 'src/components/design/DVDateTimeWheelPicker.vue', selector: '.dv-dtp__panel' },
      { file: 'src/components/category/DVCategoryPicker.vue', selector: '.dvpc__panel' },
      { file: 'src/components/category/DVCategoryManager.vue', selector: '.dvm__panel' },
      { file: 'src/components/category/DVCategoryIconPicker.vue', selector: '.dvic__panel' },
      { file: 'src/pages/settings/RecurringPeriodPicker.vue', selector: '.rpp__panel' },
    ];
    for (const { file, selector } of panels) {
      const block = blockOf(readVue(file), selector);
      expect(block).toContain('background: var(--dv-overlay-panel-bg)');
      expect(block).not.toContain('background: var(--dv-surface)');
      expect(block).not.toContain(/\brgba\(\s*\d+\s*,\s*\d+\s*,\s*\d+/);
      expect(block).toContain('backdrop-filter: var(--dv-overlay-panel-blur)');
      expect(block).toContain('border: var(--dv-overlay-panel-border)');
    }
  });
});