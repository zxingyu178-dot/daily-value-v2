# HANDOFF INDEX — 2.10.6（Visual Polish + Sheet 修复 + 跨页残留修复）

> 基线 2.10.3 / 54 → **2.10.6 / 57**。
> 2.10.4 视觉层优化（暗黑毛玻璃/玻璃强调色/图表玻璃）→ 2.10.5 Sheet 深玻璃（透明重叠）→ 2.10.6（本轮）一级页面 KeepAlive 切走时自动关闭 Teleport Sheet（日价/记账面板跨页残留）。
> （docs/dailyvalue-web，Crimson Frosted Glass）的 UI 设计，以**零业务逻辑改动、可随时回退、不引入新依赖**方式移植。
> 冻结区零改动：统计/删除/账单/手势/壁纸/周期/Back 等业务全部原样（图表仅换视觉，保持柱状图）。

## 改动摘要

| 项 | 说明 |
|----|------|
| 玻璃强调色维度 | 新增独立 `data-theme-glass`（off/none/crimson/amber/ice），与 theme/themeColor 正交；**仅深色主题生效**；默认 `off` = 完全现状 |
| Token 换肤 | `base.css`：`[data-theme='dark'][data-theme-glass]:not([data-theme-glass='off'])` 一处换肤（纯黑底 + 白 5% 玻璃面 + 强调色光晕 + 月卡/FAB tint），全部带门禁 |
| 图表玻璃 | 统计页保持柱状/环图形态零改动；深色玻璃时切换玻璃 Tooltip（黑 80% + blur8）+ 四色 palette（#FF4D4D→#FFF→#FFA366→#4DFF88）+ 轴/分割线变白 |
| 设置页 | 新增「玻璃强调色（深色）」swatch UI（关闭/无强调/绯红/琥珀/冰蓝），复用现有色板组件 |
| 回退 | 设置页选「关闭」/默认 off → 所有玻璃规则不匹配 = 现状；删换肤块/Token 即彻底还原；`themeGlass` 可选字段无迁移 |

## 交付物
| 文件 | 说明 |
|------|------|
| `app-debug.apk` | 2.10.4 / 55，见 reports/APK_INFO.md |
| `DailyValue_v2_Source_2.10.4.zip` | 受控源码（git HEAD `aa87119`） |
| `DailyValue_v2_Handoff_2.10.4.zip` | 本目录完整归档 |

## Reports（reports/）
- PHASE_REPORT.md / CHANGELOG.md / TEST_REPORT.md / APK_INFO.md / DEV_LOG.md / GIT_STATUS.md / GIT_LOG.md

## 视觉验收（真机/浏览器，重点）
1. 浅色主题 + 任意玻璃值 → 视觉完全不变（深色门禁）
2. 深色 + 玻璃「关闭」→ 与原深色完全一致（默认现状）
3. 深色 + 绯红/琥珀/冰蓝 → 玻璃卡/月卡/FAB/背景光晕/图表 Tooltip 生效且随主题色联动
4. 无壁纸 + 深色玻璃 → 强调色光晕背景；有壁纸 + 深色玻璃 → 玻璃卡浮壁纸、不叠光晕
5. 设置页切换即时生效、来回切换可回退；统计页环形/柱状仍正常（keep 原 ECharts 生命周期）

> 交付停在完成态；真机手势验收清单（A~J + ANIM-01..06）与真机 GLASS 视觉验收建议用户实机执行后回填。