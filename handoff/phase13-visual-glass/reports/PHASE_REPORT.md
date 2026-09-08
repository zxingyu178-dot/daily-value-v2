# PHASE REPORT — 2.10.4 Visual Polish

## 1. 目标与范围
参考 React 优化版（docs/dailyvalue-web，Crimson Frosted Glass 暗黑毛玻璃）做后期视觉优化：毛玻璃卡片、多种主题（玻璃强调色）、图表玻璃 Tooltip。**零业务逻辑改动、默认关闭可回退、不引入新依赖**。统计页保持柱状图（用户确认）。

## 2. 方案（最稳妥）
- **独立 `data-theme-glass` 维度**（off/none/crimson/amber/ice），不动既有 `ThemeAccentId` union（402 既有用例零波及）。
- **仅深色生效**：所有玻璃规则以 `[data-theme='dark']` 为前提，浅色完全现状。
- **默认 `off` = 现状**：全部门禁 `:not([data-theme-glass='off'])`，未设置即无匹配。
- **Token 层换肤**：改 `--dv-surface` 系 → 所有卡自动玻璃化，页面零逐卡改动；blur 仅加统计 5 卡 + 日价汇总卡（DVCard glass prop）与 Header（已有），列表行零 blur。

## 3. 改动清单
| 文件 | 改动 |
|------|------|
| src/theme/tokens.ts | GlassStyleId/GlassStyleDef/glassStyles(5档)/glassStyleList/GLASS_ACCENT_DEFAULT/GLASS_CHART/GLASS_CATEGORY_PALETTE |
| src/theme/base.css | :root 默认玻璃 Token（--dv-accent/card-bg/fab-bg 回落现状）；强调色块([data-theme-glass=*])；深色换肤块；光晕门禁(:not([data-wallpaper='on']))；FAB 玻璃 |
| src/core/models/types.ts | Settings 可选 `themeGlass?: GlassStyleId` |
| src/core/services/idb.ts + memory.ts | DEFAULT_SETTINGS + `themeGlass:'off'` |
| src/core/store/app.ts | state.themeGlass + `setThemeGlass`（undefined 回落 off，写 data-theme-glass） |
| src/core/store/settings.ts | getter themeGlass + load/update 联动 app.setThemeGlass |
| src/components/design/DVCard.vue | 新增 `glass` prop（24px 圆角 + blur12 + 玻璃边框 Token） |
| src/pages/statistics/StatisticsPage.vue | glassOn 分支（readChartColors 内复用）+ GLASS_TOOLTIP + categoryPalette 四色/10色切换 + 5 卡加 glass + 图例联动 |
| src/pages/settings/SettingsPage.vue | 玻璃强调色 swatch UI（复用 .swatches/.swatch）+ selectGlass |

## 4. 测试
- 新增 10 用例：GLASS-TOKEN-01/02、APP-GLASS-01、SET-GLASS-01（theme.spec）；SETTINGS-GLASS-01/02（SettingsPage.spec）；GLASS-CSS-01..04（源级 base.css 校验，新文件 glass-css.spec.ts）。
- 回归：`vitest run` **412 passed / 38 files**（原 402 全绿 + 新增 10）；`vue-tsc --noEmit` PASS；`vite build` PASS。
- 本轮还修复测试基建两个隐性坑（见 DEV_LOG）：vitest `.vite-temp` 陈旧 transform 缓存、SettingsPage 用例 fake-indexeddb 首次 open 宏任务竞态（update 挂起 → beforeEach 预 openDatabase + await +10ms）。

## 5. 构建与版本
npm test 412 ✅ → vue-tsc ✅ → vite build ✅ → cap sync ✅ → gradlew assembleDebug（JDK 21）✅ → aapt 实测 **55 / 2.10.4**。
APK：5,997,066 B；SHA-256 `B7CB308D35BA9BF4F3A967EAB772FFCEB735F9379796C0CE1D16FA7FE335B486`。

## 6. 回退（三重保险）
1. 设置页「关闭」/默认 off → 门禁不匹配 = 现状。
2. 删 base.css 换肤块 + tokens glass 定义即还原（其余 additive）。
3. themeGlass 可选字段、数据缺失自动 off，无迁移。