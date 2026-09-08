/**
 * Daily Value v2 - settingsStore（Pinia）
 * 封装 ISettingsService；主题切换在此持久化，并与 appStore 联动。
 */
import { defineStore } from 'pinia';
import { services } from '@/core/services';
import { useAppStore } from '@/core/store/app';
import type { Settings, WallpaperConfig } from '@/core/models/types';

export const useSettingsStore = defineStore('settings', {
  state: () => ({
    settings: null as Settings | null,
  }),
  getters: {
    theme: (state) => state.settings?.theme ?? 'auto',
    themeColor: (state) => state.settings?.themeColor ?? 'violet',
    themeGlass: (state) => state.settings?.themeGlass ?? 'off',
    currency: (state) => state.settings?.currency ?? '¥',
    wallpaper: (state): WallpaperConfig | undefined => state.settings?.wallpaper,
  },
  actions: {
    async load(force = false) {
      if (this.settings && !force) return;
      this.settings = await services.settings.get();
      // 同步主题/壁纸到 appStore（应用级即时生效）
      const app = useAppStore();
      app.setTheme(this.settings.theme);
      app.setThemeColor(this.settings.themeColor);
      app.setThemeGlass(this.settings.themeGlass);
      app.setWallpaper(this.settings.wallpaper);
    },
    async update(patch: Partial<Settings>) {
      this.settings = await services.settings.update(patch);
      const app = useAppStore();
      if (patch.theme !== undefined) {
        app.setTheme(this.settings.theme);
      }
      if (patch.themeColor !== undefined) {
        app.setThemeColor(this.settings.themeColor);
      }
      if (patch.themeGlass !== undefined) {
        app.setThemeGlass(this.settings.themeGlass);
      }
      if (patch.wallpaper !== undefined) {
        app.setWallpaper(this.settings.wallpaper);
      }
    },
    /** 设置壁纸（含 image/fit/blur/overlay），与主题分离持久化；undefined 移除壁纸 */
    async setWallpaper(wallpaper: WallpaperConfig | undefined) {
      const patch: Partial<Settings> = { wallpaper };
      // 移除壁纸时显式写入 undefined 以覆盖旧值
      this.settings = await services.settings.update(patch);
      const app = useAppStore();
      app.setWallpaper(this.settings.wallpaper);
    },
  },
});
