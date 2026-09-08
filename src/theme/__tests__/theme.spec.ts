/**
 * Daily Value v2 - Phase 6 Theme 单测
 * 覆盖：强调色 token palette 结构、appStore 强调色/明暗落地、settingsStore 持久化与联动。
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import {
  themeAccents,
  themeAccentList,
  ACCENT_DEFAULT,
  glassStyles,
  glassStyleList,
  GLASS_ACCENT_DEFAULT,
  GLASS_CHART,
  GLASS_CATEGORY_PALETTE,
} from '@/theme/tokens';
import { useAppStore } from '@/core/store/app';
import { useSettingsStore } from '@/core/store/settings';

describe('themeAccents palette', () => {
  it('TOKEN-01 覆盖 5 种强调色且含品牌紫', () => {
    expect(themeAccentList.sort()).toEqual(['blue', 'emerald', 'orange', 'rose', 'violet'].sort());
    expect(themeAccents.violet).toBeDefined();
  });

  it('TOKEN-02 每个强调色均含 label / chip / light / dark，且明暗都提供 primary 与 primarySoft', () => {
    for (const id of themeAccentList) {
      const def = themeAccents[id];
      expect(typeof def.label).toBe('string');
      expect(def.label.length).toBeGreaterThan(0);
      expect(def.chip).toMatch(/^#[0-9a-fA-F]{6}$/);
      expect(def.light.primary).toMatch(/^#[0-9a-fA-F]{6}$/);
      expect(def.light.primarySoft).toMatch(/^#[0-9a-fA-F]{6}$/);
      expect(def.dark.primary).toMatch(/^#[0-9a-fA-F]{6}$/);
      expect(def.dark.primarySoft).toMatch(/^#[0-9a-fA-F]{6}$/);
    }
  });

  it('TOKEN-03 默认强调色为 violet（品牌紫）', () => {
    expect(ACCENT_DEFAULT).toBe('violet');
  });
});

describe('appStore 主题落地', () => {
  beforeEach(() => setActivePinia(createPinia()));

  it('APP-01 切换强调色写入 document data-theme-color', () => {
    document.documentElement.dataset.themeColor = '';
    const app = useAppStore();
    app.setThemeColor('emerald');
    expect(app.themeColor).toBe('emerald');
    expect(document.documentElement.dataset.themeColor).toBe('emerald');
  });

  it('APP-02 auto 主题按系统偏好解析为 dark/light 并显式写入 data-theme/color-scheme', () => {
    const app = useAppStore();
    app.setTheme('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(document.documentElement.style.colorScheme).toBe('dark');
    app.setTheme('light');
    expect(app.resolvedTheme).toBe('light');
    // 显式 light（而非空串），WebView 原生控件与 App 主题一致
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(document.documentElement.style.colorScheme).toBe('light');
  });

  it('APP-04 反复 auto/light/dark 切换后系统深浅监听不累积（不同 MQL 实例上每次只注册一个有效监听）', () => {
    // 模拟 WebView 下 matchMedia 每次返回不同实例；分别记录每个实例上 add/remove 次数
    let dark = false;
    type entry = { added: number; removed: number; cb: ((e: { matches: boolean }) => void) | null };
    const instances: entry[] = [];
    const fakeMatchMedia = () => {
      const mql: entry = { added: 0, removed: 0, cb: null };
      instances.push(mql);
      return {
        get matches() {
          return dark;
        },
        addEventListener(_t: string, cb: (e: { matches: boolean }) => void) {
          mql.added += 1;
          mql.cb = cb;
        },
        removeEventListener() {
          mql.removed += 1;
          mql.cb = null;
        },
        media: '(prefers-color-scheme: dark)',
        onchange: null,
        addListener() {},
        removeListener() {},
        dispatchEvent: () => false,
      } as unknown as MediaQueryList;
    };
    const original = window.matchMedia;
    (window as unknown as { matchMedia: () => MediaQueryList }).matchMedia = fakeMatchMedia;
    try {
      const app = useAppStore();
      // 反复切换 6 次（auto → dark → light → auto → dark → auto）
      app.setTheme('auto');
      app.setTheme('dark');
      app.setTheme('light');
      app.setTheme('auto');
      app.setTheme('dark');
      app.setTheme('auto');
      // 任一实例上，注册过的监听都应在被替换时移除（非当前实例 added===removed；当前有效实例 added=removed+1）
      for (const i of instances) {
        if (i.cb !== null) {
          expect(i.added - i.removed).toBe(1);
        } else {
          expect(i.added).toBe(i.removed);
        }
      }
      // 结束时处于 auto：仅最后一次注册的实例上有 1 个有效监听
      const activeInstances = instances.filter((i) => i.cb !== null);
      expect(activeInstances).toHaveLength(1);
      // 手动触发当前生效监听，auto 仍实时刷新
      dark = true;
      activeInstances[0].cb!({ matches: true });
      expect(document.documentElement.dataset.theme).toBe('dark');
    } finally {
      (window as unknown as { matchMedia: (query: string) => MediaQueryList }).matchMedia = original;
    }
  });

  it('APP-05 setWallpaper 新链路：仅写 image/blur/mask，不再写 position/scale（P0-1）', () => {
    const app = useAppStore();
    const root = document.documentElement;
    // 新 Cropper 数据：仅 image/blur/overlay
    app.setWallpaper({
      image: 'data:image/jpeg;base64,AAA',
      blur: 6,
      overlay: 0.4,
    });
    expect(root.dataset.wallpaper).toBe('on');
    expect(root.dataset.wallpaperMode).toBe('new');
    expect(root.style.getPropertyValue('--dv-wallpaper-image')).toBe('url("data:image/jpeg;base64,AAA")');
    expect(root.style.getPropertyValue('--dv-wallpaper-blur')).toBe('6px');
    expect(root.style.getPropertyValue('--dv-wallpaper-mask')).toBe('rgba(0,0,0,0.4)');
    // 新链路严禁写旧 position/scale（破坏 WYSIWYG）
    expect(root.style.getPropertyValue('--dv-wallpaper-position')).toBe('');
    expect(root.style.getPropertyValue('--dv-wallpaper-scale')).toBe('');
    // 移除壁纸 → off，清空 image/blur/mask
    app.setWallpaper(undefined);
    expect(root.dataset.wallpaper).toBe('off');
    expect(root.dataset.wallpaperMode).toBe('new');
    expect(root.style.getPropertyValue('--dv-wallpaper-image')).toBe('none');
    expect(root.style.getPropertyValue('--dv-wallpaper-blur')).toBe('0px');
    expect(root.style.getPropertyValue('--dv-wallpaper-mask')).toBe('rgba(0,0,0,0)');
  });

  it('APP-05b legacy 兼容：读到旧 WallpaperConfig 才走 legacy renderer，仍写位置/缩放', () => {
    const app = useAppStore();
    const root = document.documentElement;
    app.setWallpaper({
      image: 'data:image/jpeg;base64,AAA',
      fit: 'cover',
      positionX: 30,
      positionY: 70,
      scale: 1.5,
      blur: 6,
      overlay: 0.4,
    });
    expect(root.dataset.wallpaperMode).toBe('legacy');
    expect(root.style.getPropertyValue('--dv-wallpaper-position')).toBe('30% 70%');
    expect(root.style.getPropertyValue('--dv-wallpaper-scale')).toBe('1.5');
  });

  it('APP-03 auto 模式监听系统深浅变化实时刷新（跟随系统不失效）', () => {
    // 可控 matchMedia：dark 可动态翻转，监听回调可手动触发
    let dark = false;
    const listeners: Array<(e: { matches: boolean }) => void> = [];
    const fakeMql = {
      get matches() {
        return dark;
      },
      addEventListener(_type: string, cb: (e: { matches: boolean }) => void) {
        listeners.push(cb);
      },
      removeEventListener() {
        /* no-op */
      },
    };
    const original = window.matchMedia;
    (window as unknown as { matchMedia: () => MediaQueryList }).matchMedia = () =>
      fakeMql as unknown as MediaQueryList;
    try {
      const app = useAppStore();
      app.setTheme('auto');
      expect(document.documentElement.dataset.theme).toBe('light');
      expect(listeners.length).toBe(1); // 已注册系统变化监听
      // 系统切深色 → 实时刷新
      dark = true;
      listeners.forEach((cb) => cb({ matches: true }));
      expect(document.documentElement.dataset.theme).toBe('dark');
      expect(document.documentElement.style.colorScheme).toBe('dark');
      // 系统切浅色 → 实时刷新
      dark = false;
      listeners.forEach((cb) => cb({ matches: false }));
      expect(document.documentElement.dataset.theme).toBe('light');
    } finally {
      (window as unknown as { matchMedia: (query: string) => MediaQueryList }).matchMedia = original;
    }
  });
});

describe('settingsStore 主题持久化联动', () => {
  beforeEach(() => setActivePinia(createPinia()));

  it('SET-01 更新强调色后持久化并同步至 appStore 与 document', async () => {
    const settings = useSettingsStore();
    await settings.load();
    await settings.update({ themeColor: 'rose' });
    expect(settings.settings?.themeColor).toBe('rose');
    expect(useAppStore().themeColor).toBe('rose');
    expect(document.documentElement.dataset.themeColor).toBe('rose');
  });

  it('SET-02 更新明暗后持久化并同步至 appStore 与 document', async () => {
    const settings = useSettingsStore();
    await settings.load();
    await settings.update({ theme: 'dark' });
    expect(settings.theme).toBe('dark');
    expect(useAppStore().theme).toBe('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
  });
});

describe('2.10.4 玻璃强调色（themeGlass）', () => {
  beforeEach(() => setActivePinia(createPinia()));

  it('GLASS-TOKEN-01 覆盖 5 档玻璃且各有 label/chip/accent/glow/tint；默认 off', () => {
    expect(glassStyleList.sort()).toEqual(['amber', 'crimson', 'ice', 'none', 'off'].sort());
    for (const id of glassStyleList) {
      const def = glassStyles[id];
      expect(typeof def.label).toBe('string');
      expect(def.label.length).toBeGreaterThan(0);
      expect(typeof def.chip).toBe('string');
      expect(typeof def.accent).toBe('string');
      expect(typeof def.glow).toBe('string');
      expect(typeof def.tint).toBe('string');
    }
    expect(GLASS_ACCENT_DEFAULT).toBe('off');
  });

  it('GLASS-TOKEN-02 玻璃图表常量：支出绿/收入红 + 四色分类 palette', () => {
    expect(GLASS_CHART.expense).toBe('#4DFF88');
    expect(GLASS_CHART.income).toBe('#FF4D4D');
    expect(GLASS_CATEGORY_PALETTE).toHaveLength(4);
    expect(GLASS_CATEGORY_PALETTE[0]).toBe('#FF4D4D');
  });

  it('APP-GLASS-01 setThemeGlass 写入 data-theme-glass 且默认/undefined 回落 off', () => {
    document.documentElement.dataset.themeGlass = '';
    const app = useAppStore();
    expect(app.themeGlass).toBe('off'); // 默认关闭 = 现状
    app.setThemeGlass('crimson');
    expect(app.themeGlass).toBe('crimson');
    expect(document.documentElement.dataset.themeGlass).toBe('crimson');
    app.setThemeGlass('ice');
    expect(document.documentElement.dataset.themeGlass).toBe('ice');
    // 旧数据缺失（undefined）回落 off
    app.setThemeGlass(undefined);
    expect(app.themeGlass).toBe('off');
    expect(document.documentElement.dataset.themeGlass).toBe('off');
  });

  it('SET-GLASS-01 更新玻璃强调色后持久化并同步至 appStore 与 document', async () => {
    const settings = useSettingsStore();
    await settings.load();
    await settings.update({ themeGlass: 'ice' });
    expect(settings.themeGlass).toBe('ice');
    expect(useAppStore().themeGlass).toBe('ice');
    expect(document.documentElement.dataset.themeGlass).toBe('ice');
    // 默认加载兜底 off
    await settings.update({ themeGlass: 'off' });
    expect(document.documentElement.dataset.themeGlass).toBe('off');
  });
});