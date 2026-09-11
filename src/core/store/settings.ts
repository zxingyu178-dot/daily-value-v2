/**
 * Daily Value v2 - settingsStore（Pinia）
 * 封装 ISettingsService；主题切换在此持久化，并与 appStore 联动。
 */
import { defineStore } from 'pinia';
import { services } from '@/core/services';
import { useAppStore } from '@/core/store/app';
import { migrateThemeGlass } from '@/theme/theme-v2';
import { normalizeStatisticsModules } from '@/pages/statistics/statistics-module-types';
import type { Settings, WallpaperConfig, StatisticsModuleId } from '@/core/models/types';

export const useSettingsStore = defineStore('settings', {
  state: () => ({
    settings: null as Settings | null,
  }),
  getters: {
    theme: (state) => state.settings?.theme ?? 'auto',
    themeColor: (state) => state.settings?.themeColor ?? 'violet',
    themeStyle: (state) => state.settings?.themeStyle ?? 'classic',
    customThemeColor: (state) => state.settings?.customThemeColor,
    themeGlass: (state) => state.settings?.themeGlass ?? 'off',
    currency: (state) => state.settings?.currency ?? '¥',
    wallpaper: (state): WallpaperConfig | undefined => state.settings?.wallpaper,
    /** 我的统计模块（2.12.0；undefined = 旧用户升级未选过，由页面默认全开） */
    statisticsModules: (state): StatisticsModuleId[] | undefined => state.settings?.statisticsModules,
  },
  actions: {
    async load(force = false) {
      if (this.settings && !force) return;
      const fetched = await services.settings.get();
      // Theme V2 迁移（2.13.0）：themeStyle 缺失时按 themeGlass 映射并持久化（幂等）
      const migrated = migrateThemeGlass(fetched);
      // 2.13.2：统计模块兼容修复 —— 空/非法/未定义 恢复至少 1 个默认模块（幂等）
      const normalizedStats = normalizeStatisticsModules(migrated.statisticsModules);
      const statsChanged =
        !Array.isArray(migrated.statisticsModules) ||
        migrated.statisticsModules.length !== normalizedStats.length ||
        migrated.statisticsModules.some((id, i) => id !== normalizedStats[i]);
      this.settings =
        migrated === fetched && !statsChanged
          ? fetched
          : await services.settings.update({
              themeStyle: migrated.themeStyle,
              themeColor: migrated.themeColor,
              ...(statsChanged ? { statisticsModules: normalizedStats } : {}),
            });
      // 同步主题/壁纸到 appStore（应用级即时生效）
      const app = useAppStore();
      app.setTheme(this.settings.theme);
      app.setThemeColor(this.settings.themeColor);
      app.setThemeStyle(this.settings.themeStyle);
      app.setCustomThemeColor(this.settings.customThemeColor);
      // 视觉已由 data-theme-style 驱动，旧玻璃 attr 统一复位（避免旧 CSS 门禁误触发）
      app.setThemeGlass('off');
      app.setWallpaper(this.settings.wallpaper);
    },
    async update(patch: Partial<Settings>) {
      this.settings = await services.settings.update(patch);
      const app = useAppStore();
      if (patch.theme !== undefined) {
        app.setTheme(this.settings.theme);
      }
      if (patch.themeColor !== undefined || patch.customThemeColor !== undefined) {
        app.setThemeColor(this.settings.themeColor);
        app.setCustomThemeColor(this.settings.customThemeColor);
      }
      if (patch.themeStyle !== undefined) {
        app.setThemeStyle(this.settings.themeStyle);
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
    /** 更新“我的统计模块”集合（2.12.0；添加/移除，不做排序）
     *  2.13.2：至少保留 1 个 —— 空数组在数据层直接拒绝保存并返回 false（UI 据此弹 Toast）。 */
    async setStatisticsModules(modules: StatisticsModuleId[]): Promise<boolean> {
      if (!Array.isArray(modules) || modules.length === 0) return false;
      const next = normalizeStatisticsModules(modules);
      this.settings = await services.settings.update({ statisticsModules: next });
      return true;
    },
  },
});
