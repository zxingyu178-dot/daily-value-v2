# DailyValue v2.16.4 DEV_LOG

## 阶段目标
AutoBill 自动记账模块导航稳定化：解决「设置入口无法进入系统权限」「待确认页面返回路径错误」「页面间互相污染返回栈」三个小问题，并优化模块结构，为下一阶段（银行卡 / 智能分类 / 自动确认规则）打基础。

## 一、实现明细（文件 + 关键改动）

### 1. 单路由重构（P0）
- `src/app/router/index.ts`：删除 `/settings/autobill` 路由；`/autobill` 注释更新为「2.16.4 起单路由：ReviewTab + SettingsPanel 由 /autobill 内部状态切换」
- `src/pages/autobill/AutoBillPage.vue`：
  - `panel = ref<'review' | 'settings'>(route.query.panel === 'settings' ? 'settings' : 'review')` 初始化面板（设置主页入口 `?panel=settings` 直达设置）
  - `openPanel(name)` 纯状态切换；`goBack()`：设置面板 → 回 review；review → `router.back()` 退出模块
  - Header 右按钮：review 显示「设置 ›」、settings 显示「待确认 ›」
  - SettingsPanel 用 `<template v-if>` + `<AutoBillSettingsPanel ref="settingsPanel">` 内嵌
  - 进入设置面板时 `settingsPanel.refreshSettings()` 刷新权限/来源状态
- `src/pages/autobill/AutoBillSettingsPanel.vue`（本阶段创建）：自动记账总开关 / 通知使用权行（整行可点 → `openNotificationAccessSettings()`）/ 自动识别来源开关（支付宝 / 微信支付，同步原生白名单）/ 银行卡通知占位

### 2. 返回逻辑修复（P1）
- `src/pages/accounting/AccountingPage.vue`：主页「待确认账单 N 笔」入口 `router.replace('/autobill')` → **`router.push('/autobill')`**
  - 根因：replace 替换历史栈当前条目（/accounting），导致返回无路可退
- `src/pages/settings/SettingsPage.vue`：`goAutoBill()` → `router.push('/autobill?panel=settings')`（设置主页入口定位到 SettingsPanel）

### 3. Store 与实时刷新（P4 / P5）
- `src/core/store/autobill.ts`：
  - 新增 `counts`：`Record<AutoBillCandidateStatus, number>`（WAIT_CONFIRM / CONFIRMED / IGNORED 三态计数）
  - 新增 `accessStatus`：`AutoBillAccessStatus`（granted / connected / pendingCount）
  - `load()` 并行拉取三态列表生成 counts；`refreshStatus()` 调 `getAccessStatus()`
- `src/feature/autobill/service/runtime.ts`：`runSyncOnce()` 同步完成后追加 `store.refreshStatus()`（resume / pendingChanged 事件回来即刷新权限状态，无需重进页面）
- `src/feature/autobill/service/notification-bridge.ts`：`openNotificationAccessSettings()`（直接打开系统通知使用权页面）、`getAccessStatus()`、`requestAutoBillRebind()`、`syncEnabledPackagesToNative()` 完整闭环

### 4. 滑动隔离（回归验证）
- `src/app/usePrimaryPageSwipe.ts`：`MAIN_PAGES = ['/statistics','/accounting','/daily-value']`，子页面（/autobill 等）pointerdown 首行 `canSwipePage()` 拒绝，完全不参与滑动（2.16.3 已有，本阶段回归）

### 5. 测试更新
- `src/feature/autobill/__tests__/autobill-nav.spec.ts`：
  - 20 轮内部切换测试：入口改 push 语义，并新增「Back 一次回 /accounting」断言（覆盖 B1 修复）
  - 设置主页入口 `?panel=settings` 测试：Back 一次回 /settings
  - Header 返回测试：设置 → review（内部）→ 退出模块
- `src/app/__tests__/primary-page-swipe.spec.ts`：SWIPE-11 目标从 `/settings/autobill` 更新为 `/autobill`

### 6. 版本同步
- `package.json` / `package-lock.json` → 2.16.4（lock 历史遗留 2.14.0 一并同步）
- `android/app/build.gradle` → versionCode 73 / versionName "2.16.4"
- `src/core/release-notes.ts` → 新增 2.16.4 条目 + CURRENT_VERSION = "2.16.4"

## 二、关键决策记录

| 决策 | 理由 |
| --- | --- |
| 单路由 + Panel 状态机 | 内部切换零路由成本，杜绝历史污染；设置作为模块内部面板而非独立页面 |
| 主页入口 replace → push | replace 会吞掉父级历史条目导致 Back 失效（真机复现）；push 保持正常返回栈 |
| 系统权限联动刷新走 Runtime | 复用 2.16.2 事件驱动 Runtime，resume 事件天然触发，页面无自带 listener |
| 三态计数由 Store 单点提供 | 审核页 Tab 与（未来）首页入口共用一处数据源，避免多份冗余 |

## 三、遗留与边界（如实标注）

- 真机通知实时刷新（P5 完整链路）：本次在模拟器验证了「Runtime → Store → UI」链路（注入候选后待确认计数即时更新）；真实支付宝支付通知触发需真机验证（模拟器无法安装支付宝产生真实通知），自动记账 2.0 阶段真机验收
- 系统通知使用权授权：模拟器已授权（截图证据），真机 OEM（MIUI / HarmonyOS）跳转行为可能与 AOSP 模拟器不同，需真机复核