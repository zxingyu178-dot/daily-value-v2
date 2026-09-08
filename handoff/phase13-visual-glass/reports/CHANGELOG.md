# CHANGELOG — 2.10.6（Sheet 跨页残留修复，基于 2.10.5）

> 基线 2.10.5 / 56 → **2.10.6 / 57**。一处修复：一级页面 KeepAlive 切走时残留 Teleport Sheet。

## FIX — 切走页面后残留「日价记账界面/快速记账」（2.10.6）
- 现象：日价页打开「添加日价物品」面板（或记账页打开快速记账）后，**不关闭面板直接切 tab**，新页面仍显示上一个页面的 Sheet（尤其「日价点击记账 Tab 看到日价面板」）。
- 根因：一级页面被 App.vue KeepAlive 缓存（保滚动位），切换时仅 deactivated、不卸载；而 DVSheet 内容是 `Teleport to body` + `v-if="modelValue"`——deactivated 期间 DOM 仍悬浮在 body 上，形成跨页残留。
- 修复（最小、对称）：DailyValuePage 与 AccountingPage 各加 `onDeactivated` → `sheetOpen=false; editingBill=null`。仅新增生命周期关闭，不改 KeepAlive/路由/Sheet 结构。
- 新增回归用例 SHEET-DEACTIV-01（DailyValuePage 源级校验 onDeactivated 关闭逻辑存在）。

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