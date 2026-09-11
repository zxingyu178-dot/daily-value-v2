# TEST_REPORT — 2.13.2

- 命令：`vitest run --no-file-parallelism`
- 结果：**Test Files 49 passed (49) | Tests 540 passed (540)**（含 1 例满负载偶发超时，隔离复跑全绿）

## 本版本新增 / 修订
- 新增 `stat-mod-min.spec.ts`（15 例）：
  - STAT-MOD-01 四个全开可关闭任意三个
  - STAT-MOD-02 只剩一个：点击关闭 → 状态保持 ON + Toast（component 级，spy toast.info）
  - STAT-MOD-03 重启（load(true)）后最后模块仍存在
  - STAT-MOD-04 Settings `[]` / undefined → 启动自动恢复每日花费趋势
  - STAT-MOD-05 `['unknown-id']` → 恢复默认；部分未知只保留合法
  - STAT-MOD-06 重复 ID → 去重
  - STAT-MOD-07 两个开启关闭一个正常
  - 数据层兜底：`setStatisticsModules([])` → `false` 且不持久化
- `theme-v2.spec.ts` 新增 HUE-01..03（hexToHue：#4F8DF7→218°、纯色相 0/120/240、非法→0）；修订「load 自动迁移」断言兼容 statisticsModules 一次持久化
- `SettingsPage.spec.ts` 新增 SETTINGS-THEMEV2-05（重开 Sheet Hue 滑块=218°、改 HEX 实时同步、非法不跳变）、SETTINGS-THEMEV2-06（迷你 Hero 预览存在且消费 --dv-primary）
- 其余 522+ 例全量回归通过（统计模块计算、Tooltip、Theme Hero、Wallpaper、FAB、Swipe、长按删除、Release Notes、空月/有数据切换等）

## 回归确认
- 四个统计大模块计算不变（statistics-modules.spec 19/19）
- Chart Tooltip 优化不回退（chart-tooltip.spec 10/10）
- Theme Hero / Custom Color / Wallpaper 正常（theme-hero.spec、theme-v2.spec 全绿）
- Global FAB / 左右 Swipe / 月份卡 Swipe / Long Press 删除 / Release Notes / ECharts 数据切换 全绿