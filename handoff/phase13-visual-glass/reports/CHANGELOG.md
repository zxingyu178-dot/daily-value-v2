# CHANGELOG — 2.10.7（跨页新增入口归属修复，基于 2.10.6）

> 基线 2.10.6 / 57 → **2.10.7 / 58**。本轮只修「跨页加号与弹层归属」及直接相关生命周期，不重做 Pager/KeepAlive/主题/数据模型。

## FIX — 进入日价后再回记账，右下角仍会打开「添加日价物品」（2.10.7）
- 现象（复审确认 2.10.6 漏修）：两个页面右下角 FAB 都无条件 `Teleport to body`，位置/尺寸/z-index 相同；App 又用 KeepAlive 缓存页面 → 访问日价后回记账，日价 FAB 仍可能盖在记账 FAB 上，点击实际执行日价 `openAdd()`。
- 根因：2.10.6 只加 `onDeactivated` 关闭已打开的面板，不能阻止「残留 FAB 再次打开它」；`openAdd/openCreate` 无归属校验。
- 修复（最小、对称，不另建全局弹层系统）：
  - DailyValuePage / AccountingPage 各加 `ownsPage = computed(() => route.path === '/daily-value')`（记账为 `/accounting`），**入口归属于当前路由**。
  - 两个 `<Teleport to="body">` 内的 FAB 加 `v-if="ownsPage"`（非当前页不进入可点击 DOM，不是透明/改 z-index）。
  - 对应 `QuickEntrySheet` / `DailyValueAddSheet`（含其日期/分类/管理等子弹层树）整组 `v-if="ownsPage"`，随页面失活卸载；页面本身继续缓存。
  - `openAdd/openEdit`（日价）、`openCreate/openEditBill`（记账）首行 `if (!ownsPage.value) return`；保留既有 `onDeactivated` 复位作为补充。
  - 统计页 `onDeactivated` 关闭自定义区间日期 Picker（补 import，KeepAlive 缓存下子弹层不跨页残留，不销毁 ECharts 主体）。
  - DailyValueAddSheet `modelValue=false` 时一并复位 `datePickerOpen/categoryPickerOpen`。
- 数据语义不变：记账新增 `ledgerImpact='normal'`；日价独立新增 `ledgerImpact='daily-value-only'`（不进时间线/统计）。已有数据不做猜测性修复/批量转换。
- 回归：
  - 新增 `fab-route-ownership.spec.ts`（真实 App + Router + KeepAlive + Teleport，不 stub）：FO-01 首次访问日价回记账仅记账 FAB；FO-02 反向顺序 + 统计/设置无 FAB；FO-03 日价开/关后回记账点右下角只出「快速记账」；FO-04 陈旧按钮 handler 带 guard；FO-05 子弹层离页清 Back 栈；FO-06 双页往返 20 轮不串页不叠按钮；FO-07 统计往返 ECharts 不销毁。
  - 三个既有页面级单测（AccountingPage / polish-ui / QuickEntrySheet DATE-08）因页面新增 `useRoute()` 门禁，mount 补齐**真实 Router 注入**（组件测试环境与运行环境一致）。
  - 浏览器实测（vite preview 生产构建 + 系统 Chrome + puppeteer-core，真实坐标点击 + elementFromPoint）：FAB-01..07 全过；「记账→日价→关闭→回记账→点右下角」打开「快速记账」。
  - Android 模拟器实测（MediaReview_Test，API 35 / 1080×2400 / dumpsys 实测 2.10.7/58；adb 真实 tap + 逐屏截图）：记账 FAB→「快速记账」；日价 FAB→「添加日价物品」；往返后点右下角→「快速记账」；统计页无 FAB。
  - 账务作用域实测（浏览器临时 IDB）：记账入口新增 125（ledgerImpact=normal，进时间线）；日价入口新增 咖啡机 300（ledgerImpact=daily-value-only，dailyValue 启用，不进记账时间线，仅在日价页展示）。
  - 全量单测 **421 passed / 39 files**（原 414 + 7）；vue-tsc ✅；vite build ✅；cap sync ✅；assembleDebug ✅。

## 既有历史（自新到旧）

# CHANGELOG — 2.10.6（Sheet 跨页残留修复，基于 2.10.5）

> 基线 2.10.5 / 56 → **2.10.6 / 57**。一处修复：一级页面 KeepAlive 切走时残留 Teleport Sheet。

## FIX — 切走页面后残留「日价记账界面/快速记账」（2.10.6）
- 现象：日价页打开「添加日价物品」面板（或记账页打开快速记账）后，**不关闭面板直接切 tab**，新页面仍显示上一个页面的 Sheet（尤其「日价点击记账 Tab 看到日价面板」）。
- 根因：一级页面被 App.vue KeepAlive 缓存（保滚动位），切换时仅 deactivated、不卸载；而 DVSheet 内容是 `Teleport to body` + `v-if="modelValue"`——deactivated 期间 DOM 仍悬浮在 body 上，形成跨页残留。
- 修复（最小、对称）：DailyValuePage 与 AccountingPage 各加 `onDeactivated` → `sheetOpen=false; editingBill=null`。仅新增生命周期关闭，不改 KeepAlive/路由/Sheet 结构。
- 新增回归用例 SHEET-DEACTIV-01（DailyValuePage 源级校验 onDeactivated 关闭逻辑存在）。
- **注意：2.10.7 复审确认本修复不完整（入口未归属），已由 2.10.7 补全；此处保留历史事实。**

## 既有（2.10.5）Sheet 深玻璃修复、既有 2.10.4 GLASS 视觉内容见下（原 413 → 现 **414 passed**）

# CHANGELOG — 2.10.5（Sheet 深玻璃修复，基于 2.10.4）

## FIX — 快速记账界面透明重叠（2.10.5）
- 现象：深色 + 玻璃强调色开启时，快速记账（及所有 DVSheet 面板）底板用 `--dv-surface`（玻璃下为 `rgba(255,255,255,0.05)`）→ 几乎全透明，与主界面内容重叠可见。
- 修复：base.css 深色玻璃门禁下新增 `.dv-sheet__panel { background: rgba(13,13,16,0.85); backdrop-filter: blur(24px) saturate(140%); border: 1px solid rgba(255,255,255,0.08) }`（参考 React 优化版 Sheet 深玻璃），面板不再透出主界面；Sheet 内 `--dv-surface-alt` 次级面（8%）位于 85% 底板上，正常层级。
- 影响面：仅深色 + 非 off 玻璃场景；浅色 / 深色默认（off）/ 有壁纸等完全不变。
- 新增源级用例 GLASS-CSS-05（断言 Sheet 底板 85% + blur24）。

## 既有（2.10.4）内容见上 — GLASS 玻璃强调色 / Token 换肤 / 图表玻璃 / 设置 UI（原 412 → 现 **413 passed**）

# CHANGELOG — 2.10.4 Visual Polish（以下为 2.10.4 原始记录，保留变迁历史）

## GLASS — 玻璃强调色维度（新增）
- `GlassStyleId = off | none | crimson | amber | ice`，独立于 theme（auto/light/dark）与 themeColor（5 强调色）。
- 仅深色主题生效；默认 off = 完全现状；三重回退（设置关闭 / 删样式块 / 数据缺失）。
- `tokens.ts` 单一事实来源：glassStyles（label/chip/accent/glow/tint）+ GLASS_CHART（#4DFF88/#FF4D4D）+ 四色 GLASS_CATEGORY_PALETTE。

## GLASS-CSS — Token 换肤（base.css）
- `:root` 默认玻璃 Token 回落现状（--dv-card-bg:var(--dv-surface)、--dv-fab-bg:var(--dv-primary)、accent 透明）。
- `[data-theme-glass='crimson'|'amber'|'ice'|'none']` 仅注入 accent/glow/tint。
- 深色换肤块（一处开关）：`[data-theme='dark'][data-theme-glass]:not([data-theme-glass='off'])` → 纯黑底 + 白 5%~8% 透明面 + 玻璃边框 + `color-mix` 月卡/FAB tint + 无阴影。
- 背景强调色光晕：仅无壁纸深色玻璃（`:not([data-wallpaper='on'])` 门禁）→ 双 radial-gradient。
- FAB 玻璃化：深色玻璃门禁下 `.accounting__fab` / `.dv__fab` 换玻璃背景+边框。

## GLASS-UI — 设置页与 DVCard
- 设置页新增「玻璃强调色（深色）」swatch（关闭/无强调/绯红/琥珀/冰蓝，chip 取自 glassStyles），`settings.update({ themeGlass })` 即时应/可回退。
- DVCard 新增 `glass` prop：24px 大圆角 + `blur(12px)` + `var(--dv-card-border)`；不设 background（沿用 surface/壁纸覆盖，未启用无副作用）。

## CHART — 统计页玻璃图表（业务零改动）
- `readChartColors()` 内 glassOn 分支：深色 + 非 off → 轴/分割线/文字玻璃白、EXPENSE/INCOME 霓虹、分类 palette 切四色。
- `GLASS_TOOLTIP`：rgba(0,0,0,.8) + white/10 边框 + `blur(8px)`；ring/bar tooltip 按 glassOn 切换。
- 图例 dot 随 categoryPalette 联动；统计 5 卡加 DVCard glass。
- ECharts 生命周期（init/render/resize/属性 watch）与柱状图形态均未动。

## 测试
- 新增 10 用例（GLASS-TOKEN/APP-GLASS/SET-GLASS/SETTINGS-GLASS ×2/GLASS-CSS ×4），原 402 全绿 → **412 passed / 38 files**；vue-tsc / vite build PASS。

## 版本
2.10.4 / 55；package.json / package-lock.json / build.gradle 一致；aapt 实测 `versionName='2.10.4' versionCode='55'`。

## 冻结区
统计数据/删除/账单/手势 Pager/壁纸/周期/Back 双击：零改动。归档 docs/dailyvalue-web（React 优化版源码，本次视觉效果参考来源）。