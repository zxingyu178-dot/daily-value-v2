# PHASE_REPORT — 2.13.2 Stability Closure

- 版本：2.13.2（versionCode 66）
- 日期：2026-09-11
- 阶段定位：2.13.x 最终稳定收尾版本（只修稳定性与体验，未新增业务功能）
- 基线：2.13.1

## 一、本轮范围
1. 统计模块「至少保留 1 个」产品规则（UI 拦截 + 数据层兜底 + 旧数据自动修复）
2. 自定义主题颜色 Hue 滑杆位置不同步修复（HEX → HSL → hue）
3. 自定义颜色 Sheet 增加迷你 Hero 主题预览（复用真实 Hero Token）
4. 2.13.x Git 稳定基线建立（CODE_HEAD / APK_BUILD_HEAD / DELIVERY_HEAD）
5. Source / Handoff 交付体积瘦身与版本一致性

## 二、变更明细

| 项 | 实现 |
|---|---|
| normalizeStatisticsModules | `src/pages/statistics/statistics-module-types.ts` 新增纯函数：删除未知 ID、去重、保持顺序、最终至少 1 项（空/非法→恢复默认 `daily-expense-trend`） |
| 数据层兜底 | `settingsStore.setStatisticsModules`：空数组直接 `return false` 拒写（返回布尔供 UI 弹 Toast） |
| 旧数据修复 | `settingsStore.load`：`[]`/undefined/全非法/重复 → 自动恢复默认或去重并持久化（幂等） |
| UI 拦截 | `StatisticsModuleHost`：只剩最后 1 个开启项时点击 → 状态保持 ON + `toast.info('至少保留一个统计模块')`（不弹 ConfirmDialog） |
| Hue 同步 | `theme-v2.ts` 新增 `hexToHue`；`SettingsPage` `:value="0"` 写死改为由保存 HEX 计算色相；拖 Hue / 输合法 HEX 实时互相同步；非法 HEX 不改变正式颜色 |
| 迷你 Hero 预览 | 自定义色 Sheet 顶部新增 Hero 卡预览，inline 覆盖 `--dv-primary/--dv-on-primary` 复用 `--dv-hero-*` Token（随界面风格即变） |
| 语义色保护 | Expense=绿 / Income=红 / Danger=红 / Warning=橙 全部不变；Hue 只作用于 primary/hero/FAB/Nav/accent/glow |

## 三、明确不做
- 不进入 2.14.0（数据备份/恢复）；不重构统计计算/Tooltip/Theme V2/Wallpaper/路由等冻结区。

## 四、质量
- vitest 全量 540 例（1 例既有滑动用例在满负载串行下偶发 5000ms 超时，隔离复跑 27/27 全绿，与本版本改动无因果关系）
- vue-tsc / vite build / cap sync / assembleDebug（JDK 21）全绿
- APK badging：package com.dailyvalue.app，versionCode=66，versionName=2.13.2
- 真机（Android 15 / API 35 / 1080×2400）：模块开关守卫、Hue 位置恢复、迷你 Hero 预览已实测截图

## 五、交付物
- APK：app-debug-2.13.2.apk（5.75 MB）
- Source ZIP（瘦身：无 node_modules/dist/build/公共资产/旧交付）
- Handoff ZIP（轻量：8 份报告 + 6 张关键截图）