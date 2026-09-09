# DEV_LOG — 2.10.7 跨页新增入口归属修复

## 背景
用户复审发现 2.10.6 只解决「已打开面板跨页残留」，未解决「入口归属」：两个页面 FAB 都无条件 Teleport 到 body、位置/z-index 相同、KeepAlive 缓存页面 → 访问日价后回记账，旧日价 FAB 覆盖记账 FAB，点击再次打开日价表单。本轮严格收口：只修入口归属与直接相关生命周期，不重做 Pager/KeepAlive/主题/数据模型。

## 决策
| # | 决策 | 理由 |
|---|------|------|
| 1 | 页面内最小修复，不建全局弹层系统 | 用户明确否掉 App 层 primarySheet 全局方案（曾误入的方向已撤销） |
| 2 | `route.path` 谓词（非 route.name） | 用户指定路径判定，避免依赖路由命名 |
| 3 | FAB 保留 Teleport + `v-if="ownsPage"` | 保留 fixed 相对视口固定；非当前页按钮不进入可点击 DOM |
| 4 | Sheet（含子 Picker 树）整组 `v-if="ownsPage"` | 切页整组卸载，不残留 Back 回调/焦点/滚动锁 |
| 5 | 测试补真实 Router 注入 | 页面加 useRoute 后，旧 mount-无-Router 的用例必然崩——补内存路由到本页，测试环境=运行环境 |

## 踩坑（本轮，已修复）
1. **上一会话误入「App 层全局 primarySheet」方向**：app.ts 曾加 primarySheet/sheetEditingBill 状态，与用户「不另建全局弹层系统」冲突 → 本轮撤销（git 致敬：先验证失败再修，先回滚冗余再补正确修法）。
2. **测试先证失败**：修复前 fab-route-ownership.spec 6 failed / 1 error——日价 FAB 缺 `v-if="ownsPage"`（上会话只加了 Sheet 的 v-if，漏了 FAB 本体，正是复审根因）＋ StatisticsPage `onDeactivated` 未 import 导致 setup 崩溃。修复后 7 全绿。
3. **Edit 工具部分写入回退再现**（2.10.4 已记录过的老问题）：本轮 import 行 / route.path 行多次写后丢失（polish-ui import、QuickEntrySheet import、AccountingPage import、DailyValuePage route.name→path 各回滚至少一次）。对策：每处 Edit 后立即 grep 校验；校验不过当场补写；最终 git diff 全量复核。
4. **浏览器/设备坐标校准**：导航 tab/FAB 的位置不能靠估算（首轮 tap (360,340) 误中统计）；对策=截图像素级读点（记账(540,283)/日价(783,283)/FAB(942,2265)）后重跑。
5. **PowerShell 重定向污染二进制**：`adb exec-out screencap -p > file` 会写坏 PNG → 改设备内 `screencap -p /sdcard/x.png` + `adb pull`。
6. **npm 缺失**：node 为 WindowsApps shim，无 npm；复用 `E:\aihome\tools\nodejs\node-v24.18.1-win-x64\npm.cmd` 执行 npm ci。
7. **模拟器 SDK 根**：AVD system image 在 `D:\Android\Sdk`（非 E:\aihome 的 SDK）→ 启动需 `ANDROID_SDK_ROOT=D:\Android\Sdk`；`-no-window -no-snapshot` 冷启动，结束后 `adb emu kill` 还原环境。

## 流程
失败先行确认（6 failed）→ 撤销全局方案 → 两页 route.path 门禁 + FAB/Sheet v-if + guard → Statistics import 修复 → 测试补 Router → 421 全绿 → vue-tsc → vite build → cap sync → assembleDebug（2.10.7/58）→ aapt 实测 → 浏览器实测（elementFromPoint + 真实坐标 + 保存作用域）→ Android 模拟器实测（tap 往返截图）→ Handoff 更新 → 提交 3db7aca → Source/Handoff ZIP → 邮件交付。

## 待用户核对
- 历史 daily-value-only 记录是否混入误录（本轮未批量转换，由用户核对）；真机往返体验复验。

---

# DEV_LOG — 2.10.4 Visual Polish（历史）

## 背景
用户提供 React 优化版（docs/dailyvalue-web，Crimson Frosted Glass）参考其 UI：毛玻璃、多种主题（玻璃强调色）、折线图等。用户要求：**最稳妥方案**（Vue 已完善，此为后期视觉优化）。已确认：统计页保持柱状图；完整交付发邮箱。

## 方案决策
| # | 决策 | 理由 |
|---|------|------|
| 1 | 独立 `data-theme-glass`（off/none/crimson/amber/ice），不动 ThemeAccentId union | 零波及既有 402 用例；语义正交 |
| 2 | 仅深色生效 + 默认 off | 浅色/现状完全不变；门禁天然回退 |
| 3 | Token 层换肤（--dv-surface 系） | 所有卡自动玻璃化，零逐卡改动 |
| 4 | blur 只加 Hero 卡（DVCard glass 5 卡 + 日价汇总） | WebView 性能纪律（列表行零 blur） |
| 5 | 图表复用 readChartColors + glassOn 分支 | 生命周期零改动，仅换 option 视觉 |
| 6 | 柱状图保持（不折线） | 用户确认功能冻结优先 |
| 7 | Settings 可选 themeGlass + 三重回退 | 无迁移、可整体回退 |

## 踩坑（2.10.4，已修复）
1. vitest `.vite-temp` 陈旧 transform 缓存：清 `.vite` + `.vite-temp` 恢复。
2. Edit 工具偶发部分写入回退：grep 校验 + 关键文件 Write 全量重写兜底。
3. SettingsPage 用例 IDB 竞态：beforeEach 预 openDatabase + 宏任务等待。
4. base.css `color-scheme` 行误删：对比原 :root 恢复。

## 流程
计划批准 → tokens/glass 定义 → base.css 换肤 → Settings 模型+服务+store 联动 → DVCard glass → 统计页玻璃图表 → 设置页 swatch UI → 测试 → 412 全绿 → vue-tsc ✅ → vite build ✅ → cap sync ✅ → assembleDebug ✅（2.10.4/55）→ aapt ✅ → Handoff → 提交 → 交付。

## 回顾「折线图」
用户提及「折线图等」为参考点；Vue 统计页趋势已确认保持柱状图。若后续要折线趋势，可基于 ECharts series type=line 在统计页单独扩展（不在本轮）。