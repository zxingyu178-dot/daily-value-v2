# DEV_LOG — 2.10.4 Visual Polish

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

## 踩坑（本轮，已修复）

1. **vitest `.vite-temp` 陈旧 transform 缓存**：连续编辑 SFC 后出现「模板新/脚本旧」「import 丢失」类 ReferenceError 与 Vue warn，一度误判为 Edit 回退。真因=node_modules/.vite-temp 残留旧编译；**清理 `.vite` + `.vite-temp` 即恢复**。（此前现象「编辑后立刻跑读到旧行号」同源。）
2. **Edit 工具偶发部分写入回退**：tokens/theme.spec/app.ts/SettingsPage/DVCard 等 import 段多次丢失；对策=每步 grep 校验关键标记、对关键文件用 Write 全量重写、最终 git diff 复核。
3. **SettingsPage 用例 IDB 竞态**：services 为 IndexedDB，测试未预开 DB 时 `settings.update` 挂起 → beforeEach `await openDatabase()` + 点击后宏任务等待解决。
4. **base.css `color-scheme` 行**：首轮 Edit 误删 `color-scheme: light dark`，已恢复；编写后需对比原 :root 完整结构。

## 流程

计划批准 → tokens/glass 定义 → base.css 换肤 → Settings 模型+服务+store 联动 → DVCard glass → 统计页玻璃图表 → 设置页 swatch UI → 测试（吸取缓存教训：清理 .vite-temp 后再验）→ 412 全绿 → vue-tsc ✅ → vite build ✅ → cap sync ✅ → assembleDebug ✅（2.10.4/55）→ aapt ✅ → Handoff（phase13-visual-glass）→ 提交 aa87119 → 交付。

## 回顾「折线图」

用户提及「折线图等」为参考点；Vue 统计页趋势已确认保持柱状图（视觉升级含玻璃 Tooltip/配色）。若后续要折线趋势，可基于 ECharts series type=line 在统计页单独扩展（不在本轮）。