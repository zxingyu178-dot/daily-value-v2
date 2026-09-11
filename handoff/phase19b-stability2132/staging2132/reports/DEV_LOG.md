# DEV_LOG — 2.13.2

## 实现记录
1. `statistics-module-types.ts` 新增 `DEFAULT_STAT_MODULE_ID` + `normalizeStatisticsModules`
2. `settingsStore.setStatisticsModules` 空数组拒写返回 `false`；`load` 启动自动修复旧数据（幂等，含与 theme 迁移合并持久化）
3. `StatisticsModuleHost.toggleModule` 最后一个开启项拦截 + `toast.info`
4. `theme-v2.ts` 新增 `hexToHue`；`SettingsPage` Hue 滑块由保存 HEX 恢复（`customHue` ref，open/输入/拖动三向同步）
5. `SettingsPage` 自定义 Sheet 新增迷你 Hero 预览（inline `--dv-primary`/`--dv-on-primary` 覆盖 + 复用 `--dv-hero-*`）
6. 版本 2.13.2 / versionCode 66 / package-lock 同步 / Release Notes 条目

## 测试记录
- 新增 stat-mod-min.spec（15）、HUE-01..03、SETTINGS-THEMEV2-05/06；修订 theme-v2 load 迁移断言
- 全量 540 例；vue-tsc/build/cap sync/assembleDebug 全绿

## 真机记录
- 管理 Sheet 开关状态反复以「像素扫描蓝色轨道」核验（防 LLM 视觉幻觉）；关闭一个正常、最后开关点击保持 ON
- Hue 滑块重开 Sheet 位于蓝色 210-220°，非 0
- 迷你 Hero 预览随主题主色即时变化

## 已知项
- 满负载串行专项下既有 SWIPE 用例偶发 5000ms 超时（隔离复跑全绿，非本版本引入）
- 升级后首次启动展示更新日志弹窗（既有行为）
- 单次 Toast 画面截图时机未捕捉（以组件测试 + 像素守卫证明）