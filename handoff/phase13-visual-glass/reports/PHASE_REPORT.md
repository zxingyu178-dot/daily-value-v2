# PHASE REPORT — 2.10.7 跨页新增入口归属修复

## 1. 目标与范围（严格收口）
修复 2.10.6 复审确认的漏修：跨页新增入口串用。**只修入口归属及直接相关生命周期**，不重做 Pager / KeepAlive / 主题 / 壁纸 / 数据模型 / 统计。
- 现象复现：记账 → 进日价 → 关闭日价表单 → 回记账 → 点右下角，仍可能再次打开「添加日价物品」。
- 根因：两个 FAB 无条件 `Teleport to body`、位置/z-index 相同；KeepAlive 缓存下旧页 FAB 覆盖记账 FAB；`openAdd/openCreate` 无归属校验；2.10.6 仅 onDeactivated 关面板不能阻止残留按钮再次打开。

## 2. 方案（最小修复，不建全局弹层系统）
两页各加当前路由谓词，入口归属路由：
```ts
const route = useRoute();
const ownsPage = computed(() => route.path === '/daily-value'); // 记账页为 '/accounting'
```
- `<Teleport to="body">` 的 FAB：`v-if="ownsPage"`（非当前页 FAB 不进入可点击 DOM）。
- QuickEntrySheet / DailyValueAddSheet 整组 `v-if="ownsPage"`（含日期/分类/管理等子弹层树随页面卸载）；页面仍被 KeepAlive 缓存（滚动位/月份/统计状态不丢）。
- `openAdd/openEdit`、`openCreate/openEditBill` 首行 `if (!ownsPage.value) return`。
- 保留 onDeactivated 复位（补充，非唯一防线）。
- 统计页 onDeactivated 关闭自定义区间日期 Picker（补 import）；不销毁 ECharts 主体。
- DailyValueAddSheet modelValue=false 时复位日期/分类子 Picker。

## 3. 改动清单
| 文件 | 改动 |
|------|------|
| src/pages/daily-value/DailyValuePage.vue | route.path ownsPage；FAB `v-if="ownsPage"`（本轮漏修点）；Sheet `v-if`；openAdd/openEdit guard |
| src/pages/accounting/AccountingPage.vue | route.path ownsPage；FAB/Sheet `v-if`；openCreate/openEditBill guard |
| src/pages/statistics/StatisticsPage.vue | 补 `onDeactivated` import + 切走关闭区间 Picker |
| src/pages/daily-value/DailyValueAddSheet.vue | 主面板关闭时复位日期/分类子 Picker |
| src/pages/__tests__/fab-route-ownership.spec.ts | 新增 7 用例 FO-01..07（真实 App+Router+KeepAlive+Teleport） |
| 3 个既有页面级单测 | AccountingPage/polish-ui/QuickEntrySheet(DATE-08) mount 补真实 Router 注入（页面新增 useRoute 门禁后的必需配套） |
| 版本 | package.json / package-lock（root+self）/ build.gradle = 2.10.7 / 58 |

## 4. 验证结果
| 层 | 结果 |
|----|------|
| 单测 | 421 passed / 39 files（414 + 7）；失败先行确认（6 failed → 修复后全绿流程） |
| 类型/构建 | vue-tsc ✅ → vite build ✅ → cap sync ✅ → assembleDebug ✅（JDK 21） |
| 浏览器实测 | FAB-01..07 全过；elementFromPoint 命中 + 真实坐标点击；关键复现出「快速记账」 |
| Android 实测 | MediaReview_Test（API 35/1080×2400）安装 dumpsys=2.10.7/58；adb 真实 tap 往返：日价 FAB→「添加日价物品」、回记账点右下角→「快速记账」、统计页无 FAB（截图为证） |
| 账务作用域 | 记账新增=normal 进时间线；日价独立新增=daily-value-only 仅日价展示（浏览器临时 IDB 实测） |

## 5. 交付产物
- APK：`android/app/build/outputs/apk/debug/app-debug.apk`，**2.10.7 / 58**，SHA-256 `1F9E8D3CD3764FA1B3170571C41444F1C9E56571F53C44934005AA076CE672B6`，5,997,298 B。
- Source ZIP（受控源码，git HEAD `3db7aca`）+ Handoff ZIP（含本目录报告 + ui/ 关键截图）。

## 附录：2.10.4 Visual Polish（历史记录，保留原文结论）
目标：参考 docs/dailyvalue-web（React 优化版）做视觉优化：毛玻璃卡片、玻璃强调色主题、图表玻璃 Tooltip。**零业务逻辑改动、默认关闭可回退、不引入新依赖**。
- 独立 `data-theme-glass`（off/none/crimson/amber/ice），仅深色生效，默认 off=现状；Token 层换肤（--dv-surface 系）→ 卡片自动玻璃化；blur 仅统计 5 卡 + 日价汇总卡 + Header。
- 新增 10 用例；**412 passed / 38 files**；vue-tsc / vite build PASS；2.10.4/55 aapt 实测。
- 三重回退：设置关闭 / 删换肤块 / themeGlass 缺省 off。