/**
 * Daily Value v2 - 根应用 store（Pinia）
 * 应用级状态：主题、布局。业务状态由各模块在 Phase 1+ 自行建立。
 */
import { defineStore } from 'pinia';
import type { ThemeAccentId, GlassStyleId, ThemeStyleId } from '@/theme/tokens';
import { deriveCustomAccent } from '@/theme/theme-v2';
import type { WallpaperConfig } from '@/core/models/types';
import { syncSystemBarAppearance } from '@/core/systembars';

/** 模块级：auto 模式下系统深浅变化监听（不放入 state，避免污染可序列化状态） */
let _systemMql: MediaQueryList | null = null;
let _systemMediaListener: ((e: MediaQueryListEvent) => void) | null = null;

/** 判断是否为历史旧 WallpaperConfig（携带废弃的 fit/positionX/positionY/scale）。
 *  是 → legacy renderer；否（新 Cropper 数据，仅 image/blur/overlay）→ new renderer。 */
function wallpaperHasLegacy(w: WallpaperConfig): boolean {
  return (
    w.fit !== undefined ||
    w.positionX !== undefined ||
    w.positionY !== undefined ||
    w.scale !== undefined
  );
}

export const useAppStore = defineStore('app', {
  state: () => ({
    /** auto | light | dark */
    theme: 'auto' as 'auto' | 'light' | 'dark',
    /** 强调色主题标识（Phase 6 Theme；2.13.0 起可为 'custom'） */
    themeColor: 'violet' as ThemeAccentId | 'custom',
    /** 界面风格（Theme V2，2.13.0）：classic 默认，100% 保持旧视觉 */
    themeStyle: 'classic' as ThemeStyleId,
    /** 自定义主题主色（#RRGGBB；themeColor==='custom' 时落地） */
    customThemeColor: undefined as string | undefined,
    /** 玻璃强调色（2.10.4 Visual Polish；off = 关闭。2.13.0 起视觉由 themeStyle 驱动） */
    themeGlass: 'off' as GlassStyleId,
    /**
     * Theme V2（2.13.0）：主题整体修订号。
     * setTheme / setThemeColor / setThemeStyle / setCustomThemeColor / setThemeGlass
     * 及 applyResolved（auto 系统深浅切换）都会自增；
     * 统计图表统一 watch 本字段刷新（不再逐个设置项往 watch 数组塞）。
     */
    themeRevision: 0,
  }),
  getters: {
    resolvedTheme(state): 'light' | 'dark' {
      if (state.theme === 'auto') {
        return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
      }
      return state.theme;
    },
  },
  actions: {
    /** 解析实际主题并显式写入根节点 data-theme（light/dark）与 color-scheme，避免 WebView 原生控件与 App 主题混合。
     *  注意：直接经 matchMedia 即时求值，不依赖 Pinia memoized getter（getter 会缓存，无法感知系统切换）。 */
    applyResolved() {
      const resolved =
        this.theme === 'auto'
          ? window.matchMedia('(prefers-color-scheme: dark)').matches
            ? 'dark'
            : 'light'
          : this.theme;
      const root = document.documentElement;
      root.dataset.theme = resolved;
      root.style.colorScheme = resolved;
      // 自定义主色随实际明暗自适应（深色适亮，保证可读）
      this.applyCustomColor();
      // Android 系统栏图标随 App 主题切换明暗（亮色主题→深色状态栏内容，深色主题→浅色内容）
      syncSystemBarAppearance(resolved === 'light');
      // auto 模式下系统深浅翻转也需让图表重绘
      this.themeRevision++;
    },
    /** auto 模式监听系统深浅实时变化刷新；非 auto 移除监听。
     *  必须对同一个 _systemMql.removeEventListener，避免反复切换 auto/light/dark 时监听累积。 */
    syncSystemListener() {
      const mql = window.matchMedia('(prefers-color-scheme: dark)');
      // 始终先清理旧监听：无论新旧 MQL 是否同一实例，都用登记时的 _systemMql 移除
      if (_systemMql && _systemMediaListener) {
        _systemMql.removeEventListener('change', _systemMediaListener);
      }
      _systemMql = null;
      _systemMediaListener = null;
      if (this.theme === 'auto') {
        _systemMediaListener = () => this.applyResolved();
        _systemMql = mql;
        mql.addEventListener('change', _systemMediaListener);
      }
    },
    setTheme(theme: 'auto' | 'light' | 'dark') {
      this.theme = theme;
      this.applyResolved();
      this.syncSystemListener();
    },
    setThemeColor(color: ThemeAccentId | 'custom') {
      this.themeColor = color;
      document.documentElement.dataset.themeColor = color;
      this.applyCustomColor();
      this.themeRevision++;
    },
    /** 界面风格落地（Theme V2，2.13.0）：写 data-theme-style，触发图表重绘 */
    setThemeStyle(style: ThemeStyleId | undefined) {
      const v = style ?? 'classic';
      this.themeStyle = v;
      document.documentElement.dataset.themeStyle = v;
      this.themeRevision++;
    },
    /** 自定义主色落地：themeColor==='custom' 且 HEX 合法时以 inline 变量覆盖 --dv-primary/soft/on-primary/accent；
     *  否则移除 inline（回退到预设/stylesheets）。 */
    applyCustomColor() {
      const root = document.documentElement;
      const vars = ['--dv-primary', '--dv-primary-soft', '--dv-on-primary', '--dv-accent', '--dv-accent-glow', '--dv-accent-tint'] as const;
      const resolved = this.resolvedTheme;
      const derived =
        this.themeColor === 'custom' && this.customThemeColor
          ? deriveCustomAccent(this.customThemeColor, resolved)
          : null;
      if (derived) {
        root.style.setProperty('--dv-primary', derived.primary);
        root.style.setProperty('--dv-primary-soft', derived.primarySoft);
        root.style.setProperty('--dv-on-primary', derived.onPrimary);
        root.style.setProperty('--dv-accent', derived.primary);
        root.style.setProperty('--dv-accent-glow', derived.glow);
        root.style.setProperty('--dv-accent-tint', derived.tint);
      } else {
        for (const v of vars) root.style.removeProperty(v);
      }
    },
    setCustomThemeColor(hex: string | undefined) {
      this.customThemeColor = hex;
      this.applyCustomColor();
      this.themeRevision++;
    },
    /** 玻璃强调色落地：undefied（旧数据/缺失）回落 off；始终写 data-theme-glass 便于校验与回溯。
     *  2.13.0 起视觉由 data-theme-style 驱动，本属性仅兼容保留（新 UI 不再暴露）。 */
    setThemeGlass(glass: GlassStyleId | undefined) {
      const v = glass ?? 'off';
      this.themeGlass = v;
      document.documentElement.dataset.themeGlass = v;
      this.themeRevision++;
    },
    /**
     * 全局壁纸层落地（Phase 6 v2 Wallpaper，与主题分离）。
     * 将壁纸参数写入根节点 CSS 变量，由 .wallpaper-layer 消费；无壁纸则清空。
     *
     * 正式 new 链路：Cropper 输出最终构图图片，运行时只做
     *   inset:0 / center / cover / blur / overlay，
     * 不再解释 positionX/Y / scale（避免破坏 WYSIWYG）。
     *
     * legacy 兼容：仅当读取到历史旧 WallpaperConfig（携带 fit/positionX/positionY/scale）
     * 时，走 legacy renderer（inset:-40px + position + scale）；新 Cropper 数据永远 new。
     */
    setWallpaper(wallpaper?: WallpaperConfig) {
      const root = document.documentElement;
      const isLegacy = !!wallpaper && wallpaperHasLegacy(wallpaper);
      root.dataset.wallpaperMode = isLegacy ? 'legacy' : 'new';
      root.style.setProperty('--dv-wallpaper-image', wallpaper?.image ? `url("${wallpaper.image}")` : 'none');
      // new 链路不再写 position/scale；仅 legacy 需保留旧变量供 legacy renderer 消费
      if (isLegacy && wallpaper) {
        root.style.setProperty('--dv-wallpaper-size', wallpaper.fit === 'contain' ? 'contain' : wallpaper.fit === 'center' ? 'auto' : 'cover');
        root.style.setProperty('--dv-wallpaper-position', `${wallpaper.positionX ?? 50}% ${wallpaper.positionY ?? 50}%`);
        root.style.setProperty('--dv-wallpaper-scale', String(wallpaper.scale ?? 1));
      } else {
        // 新数据：清空遗留的 legacy 变量，确保只走 new renderer
        root.style.removeProperty('--dv-wallpaper-size');
        root.style.removeProperty('--dv-wallpaper-position');
        root.style.removeProperty('--dv-wallpaper-scale');
      }
      root.style.setProperty('--dv-wallpaper-blur', wallpaper ? `${wallpaper.blur}px` : '0px');
      root.style.setProperty('--dv-wallpaper-mask', wallpaper ? `rgba(0,0,0,${wallpaper.overlay})` : 'rgba(0,0,0,0)');
      root.dataset.wallpaper = wallpaper?.image ? 'on' : 'off';
    },
  },
});
