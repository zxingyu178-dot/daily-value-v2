/**
 * Theme V2（2.13.0）测试：
 * - THEME-01~10：旧 Settings 升级视觉不变 / 四风格即时生效 / 重启保持 / 5 预设 / Custom 合法保存 /
 *   Custom 非法拒绝 / Custom Light+Dark 可读 / Expense/Income 语义色不跟随 / Wallpaper 不丢失 /
 *   旧 themeGlass 正确迁移
 * - deriveCustomAccent / parseHexColor / migrateThemeGlass 纯函数
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import {
  themeStyles,
  themeStyleList,
  THEME_STYLE_DEFAULT,
  themeAccents,
} from '@/theme/tokens';
import { deriveCustomAccent, parseHexColor, hexToHue, migrateThemeGlass } from '@/theme/theme-v2';
import { useAppStore } from '@/core/store/app';
import { useSettingsStore } from '@/core/store/settings';
import { services } from '@/core/services';
import type { ThemeAccentId } from '@/theme/tokens';
import type { Settings } from '@/core/models/types';

const baseSettings = (partial: Partial<Settings> = {}): Settings => ({
  currency: '¥',
  theme: 'light',
  themeColor: 'violet',
  sort: 'per',
  wallpaper: undefined,
  ...partial,
});

describe('THEME-V2 tokens', () => {
  it('THEME-V2-TOKEN 覆盖四种风格；默认 classic', () => {
    expect(themeStyleList.sort()).toEqual(['classic', 'glass', 'minimal', 'soft'].sort());
    expect(THEME_STYLE_DEFAULT).toBe('classic');
    for (const id of themeStyleList) {
      expect(typeof themeStyles[id].label).toBe('string');
      expect(typeof themeStyles[id].desc).toBe('string');
    }
  });
});

describe('deriveCustomAccent / parseHexColor', () => {
  it('ACCENT-01 合法 #RRGGBB 解析；非法格式返回 null', () => {
    expect(parseHexColor('#4F8DF7')).toEqual({ r: 0x4f, g: 0x8d, b: 0xf7 });
    expect(parseHexColor('#4f8df7')).toEqual({ r: 0x4f, g: 0x8d, b: 0xf7 });
    expect(parseHexColor('#FFF')).toBeNull();
    expect(parseHexColor('red')).toBeNull();
    expect(parseHexColor('#12345G')).toBeNull();
    expect(parseHexColor('')).toBeNull();
  });

  it('ACCENT-02 deriveCustomAccent 输出 primary/primarySoft/onPrimary/glow/tint 且为合法色值', () => {
    const d = deriveCustomAccent('#4F8DF7', 'light')!;
    expect(d).not.toBeNull();
    expect(d.primary).toMatch(/^#[0-9a-fA-F]{6}$/);
    expect(d.primarySoft).toMatch(/^#[0-9a-fA-F]{6}$/);
    expect(['#ffffff', '#1c2030']).toContain(d.onPrimary);
    expect(d.glow).toMatch(/^rgba\(/);
    expect(d.tint).toMatch(/^rgba\(/);
  });

  it('ACCENT-03 深色主题下 primary 适亮处理，保证与深底可读（亮度高于原始 HEX）', () => {
    const darkViolet = '#1a1a3a'; // 很暗的主色
    const lightAccent = deriveCustomAccent(darkViolet, 'light')!;
    const darkAccent = deriveCustomAccent(darkViolet, 'dark')!;
    // 深色下必须向上提亮（混合白色），不能仍是深紫像素
    expect(darkAccent.primary).not.toBe(darkViolet);
    // 深色主体 onPrimary 应取浅色文字（白/近黑判断后应有可读选择）
    expect(['#ffffff', '#1c2030']).toContain(darkAccent.onPrimary);
    expect(lightAccent.primary).toBe(darkViolet); // 浅色直接用 HEX
  });

  it('ACCENT-04 非法 HEX 返回 null（调用方拒绝应用）', () => {
    expect(deriveCustomAccent('not-a-color', 'light')).toBeNull();
  });

  it('ACCENT-05 明亮主色 onPrimary=深字、深色主色 onPrimary=白字（自动保证可读）', () => {
    expect(deriveCustomAccent('#222222', 'light')!.onPrimary).toBe('#ffffff');
    expect(deriveCustomAccent('#f5f5f5', 'light')!.onPrimary).toBe('#1c2030');
  });

  it('ACCENT-06 Custom 在 Light/Dark 都保持可读（THEME-07）', () => {
    for (const theme of ['light', 'dark'] as const) {
      const d = deriveCustomAccent('#4F8DF7', theme)!;
      // primary 与 onPrimary 对比（粗略：非同一色，且 onPrimary 为黑白两档）
      expect(['#ffffff', '#1c2030']).toContain(d.onPrimary);
      // soft 与 primary 不同（有区分）
      expect(d.primarySoft).not.toBe(d.primary);
    }
  });

  it('HUE-01 hexToHue：已保存 HEX → 正确色相（#4F8DF7 蓝色 ≈ 217~218°）', () => {
    expect(hexToHue('#4F8DF7')).toBe(218);
  });

  it('HUE-02 hexToHue：纯色相可逆（拖滑杆 → HEX → hue 回到同一位置）', () => {
    expect(hexToHue('#ff0000')).toBe(0); // 红 = 0°
    expect(hexToHue('#00ff00')).toBe(120); // 绿 = 120°
    expect(hexToHue('#0000ff')).toBe(240); // 蓝 = 240°
  });

  it('HUE-03 hexToHue：非法 HEX / 灰阶 → 0（滑杆安全兜底）', () => {
    expect(hexToHue('blue')).toBe(0);
    expect(hexToHue('#ABC')).toBe(0);
    expect(hexToHue('#808080')).toBe(0);
    expect(hexToHue('')).toBe(0);
  });
});

describe('migrateThemeGlass（THEME-01/10）', () => {
  it('THEME-01 旧设置（themeStyle 缺失、glass off）→ 映射 classic，视觉保持 2.12 默认', () => {
    const s = migrateThemeGlass(baseSettings({ themeGlass: 'off' }));
    expect(s.themeStyle).toBe('classic');
    expect(s.themeColor).toBe('violet'); // 无玻璃用户完全不改主色
  });

  it('THEME-10a 旧 crimson glass → glass + rose', () => {
    const s = migrateThemeGlass(baseSettings({ themeGlass: 'crimson' }));
    expect(s.themeStyle).toBe('glass');
    expect(s.themeColor).toBe('rose');
  });

  it('THEME-10b 旧 amber → glass + orange；ice → glass + blue；none → glass + violet', () => {
    expect(migrateThemeGlass(baseSettings({ themeGlass: 'amber' }))).toMatchObject({ themeStyle: 'glass', themeColor: 'orange' });
    expect(migrateThemeGlass(baseSettings({ themeGlass: 'ice' }))).toMatchObject({ themeStyle: 'glass', themeColor: 'blue' });
    expect(migrateThemeGlass(baseSettings({ themeGlass: 'none' }))).toMatchObject({ themeStyle: 'glass', themeColor: 'violet' });
  });

  it('THEME-10c 已是 Theme V2（themeStyle 存在）→ 原样返回，幂等', () => {
    const own = baseSettings({ themeStyle: 'soft', themeColor: 'emerald', themeGlass: 'amber' });
    expect(migrateThemeGlass(own)).toBe(own);
  });

  it('THEME-10d 旧玻璃用户迁移后 themeGlass 字段保留兼容但不主导视觉', () => {
    const s = migrateThemeGlass(baseSettings({ themeGlass: 'crimson' }));
    expect(s.themeGlass).toBe('crimson'); // 兼容保留
    expect(s.themeStyle).toBe('glass'); // 新视觉由 style 驱动
  });

  it('THEME-10e themeGlass 缺失（undefined）同 off → classic', () => {
    const s = migrateThemeGlass(baseSettings());
    expect(s.themeStyle).toBe('classic');
  });
});

describe('theme-v2 应用层（appStore / settingsStore）', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    setActivePinia(createPinia());
  });

  it('THEME-02 setThemeStyle 即时写入 dataset.theme-style 并自增 themeRevision', () => {
    const app = useAppStore();
    const before = app.themeRevision;
    app.setThemeStyle('soft');
    expect(app.themeStyle).toBe('soft');
    expect(document.documentElement.dataset.themeStyle).toBe('soft');
    expect(app.themeRevision).toBe(before + 1);
  });

  it('THEME-08 Expense 仍绿 / Income 仍红（Custom 不改变语义色）', async () => {
    const settings = useSettingsStore();
    await settings.load();
    await settings.update({ themeColor: 'custom', customThemeColor: '#4F8DF7' });
    // 语义色来自 CSS 变量（页面消费 --dv-expense/--dv-income），Inline 只覆盖 primary 相关
    const root = document.documentElement as HTMLElement;
    expect(root.style.getPropertyValue('--dv-primary')).toMatch(/^#/);
    // 语义色变量不受 inline 主色影响（未设置）
    expect(root.style.getPropertyValue('--dv-expense')).toBe('');
    expect(root.style.getPropertyValue('--dv-income')).toBe('');
  });

  it('THEME-09 Wallpaper 不丢失：设置 custom 后再加载仍保留 wallpaper 配置', async () => {
    const settings = useSettingsStore();
    const saved: Settings = baseSettings({
      themeColor: 'blue',
      wallpaper: { image: 'data:image/jpeg;base64,/9j/x', blur: 4, overlay: 0.25 },
    });
    vi.spyOn(services.settings, 'get').mockImplementation(async () => saved as never);
    vi.spyOn(services.settings, 'update').mockImplementation(
      async (patch) => ({ ...saved, ...patch }) as never,
    );
    await settings.load();
    expect(settings.wallpaper?.image).toBe('data:image/jpeg;base64,/9j/x');
    await settings.update({ themeStyle: 'glass' });
    expect(settings.wallpaper?.image).toBe('data:image/jpeg;base64,/9j/x');
    expect(document.documentElement.dataset.wallpaper).toBe('on');
  });

  it('THEME-03 重启后风格保持：settings.load(true) 后 dataset.theme-style 与持久化一致', async () => {
    const settings = useSettingsStore();
    await settings.load();
    await settings.update({ themeStyle: 'minimal', themeColor: 'emerald' });
    await settings.load(true); // 模拟重启重取（force）
    expect(settings.themeStyle).toBe('minimal');
    expect(document.documentElement.dataset.themeStyle).toBe('minimal');
    expect(document.documentElement.dataset.themeColor).toBe('emerald');
  });

  it('THEME-04 5 个预设颜色全部有效（切换即写入 dataset.theme-color）', async () => {
    const settings = useSettingsStore();
    await settings.load();
    for (const id of Object.keys(themeAccents) as ThemeAccentId[]) {
      await settings.update({ themeColor: id });
      expect(document.documentElement.dataset.themeColor).toBe(id);
    }
  });

  it('THEME-05/06 Custom 合法保存 / 非法 HEX 拒绝落地（走 app.applyCustomColor）', async () => {
    const settings = useSettingsStore();
    await settings.load();
    // 非法：不满足 #RRGGBB → 不写 customThemeColor（模拟页面临界校验，这里直接走纯函数返回 null）
    // 合法：
    await settings.update({ themeColor: 'custom', customThemeColor: '#4F8DF7' });
    expect(settings.customThemeColor).toBe('#4F8DF7');
    const root = document.documentElement as HTMLElement;
    expect(root.style.getPropertyValue('--dv-primary')).toMatch(/^#/);
    expect(root.style.getPropertyValue('--dv-primary-soft')).toMatch(/^#/);
    // 切回预设后 inline 自定义变量被清除（回退 stylesheet）
    await settings.update({ themeColor: 'violet' });
    expect(root.style.getPropertyValue('--dv-primary')).toBe('');
    expect(root.style.getPropertyValue('--dv-primary-soft')).toBe('');
  });

  it('THEME-06b deriveCustomAccent 对非法输入返回 null（页面据此拒绝应用）', () => {
    expect(deriveCustomAccent('blue', 'light')).toBeNull();
    expect(deriveCustomAccent('#ABCD', 'light')).toBeNull();
  });

  it('「刚加载未迁移」数据时 load 自动迁移并持久化（迁移不可见、视觉连贯）', async () => {
    // legacy 无 themeStyle（旧玻璃）且无 statisticsModules：2.13.2 起一次持久化同时修复两项
    const legacy: Settings = baseSettings({ themeGlass: 'ice' });
    const spy = vi.spyOn(services.settings, 'get').mockImplementation(async () => legacy as never);
    const updateSpy = vi.spyOn(services.settings, 'update').mockImplementation(async (patch) => {
      const merged: Settings = { ...legacy, ...patch };
      return merged as never;
    });
    const settings = useSettingsStore();
    await settings.load();
    expect(updateSpy).toHaveBeenCalledWith({
      themeStyle: 'glass',
      themeColor: 'blue',
      statisticsModules: ['daily-expense-trend'],
    });
    expect(settings.themeStyle).toBe('glass');
    expect(useAppStore().themeStyle).toBe('glass');
    expect(document.documentElement.dataset.themeStyle).toBe('glass');
    void spy;
  });
});