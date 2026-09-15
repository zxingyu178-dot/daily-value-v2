# DailyValue v2.16.4 AUTOBILL_NAVIGATION_REPORT

## 一、背景：旧导航结构的问题

v2.16.3 及之前 AutoBill 由两个独立路由组成：

```
/autoBill          （审核页）
/settings/autobill （独立设置页）
```

用户往返操作时：

```
自动记账(AutoBill) → 设置(Settings) → 自动记账(AutoBill) → 设置(Settings) ...
```

每次都产生新的 History 条目。真正机上表现为：
1. 自动记账设置入口点击「返回」回到的竟然是上一页（路由栈混乱）；
2. 待确认页面返回路径错误（跳回主页或另一个 AutoBill 页面）；
3. 反复切换后返回需要多次按键，形成「设置 → 主页 → 自动记账 → 设置」死循环。

## 二、新结构：/autobill 单路由 + 内部 Panel 状态机（P0）

```
/autobill（唯一路由）
 ├── ReviewTab
 │     ├── 待确认（WAIT_CONFIRM）
 │     ├── 已确认（CONFIRMED）
 │     └── 已忽略（IGNORED）
 └── SettingsPanel
       ├── 自动记账总开关
       ├── 通知使用权（整行可点 → 系统设置）
       ├── 自动识别来源（支付宝 / 微信支付）
       └── 银行卡通知（占位）
```

**内部切换一律使用纯状态，禁止 router.push / router.replace：**

```ts
panel = ref<'review' | 'settings'>(route.query.panel === 'settings' ? 'settings' : 'review');

function openPanel(name: 'review' | 'settings') {
  panel.value = name;   // 唯一切换方式，零路由成本
}
```

**Header 返回逻辑（goBack）：**

```ts
function goBack() {
  if (isSettings.value) { openPanel('review'); return; }   // 设置面板 → 回审核（内部）
  router.back();                                          // 审核 → 退出模块（回父级）
}
```

## 三、返回行为矩阵（P1 目标态）

| 入口 | 路径 | Header ‹ | Android 系统返回 |
| --- | --- | --- | --- |
| 记账主页入口 | /accounting → push /autobill | /accounting ✓ | /accounting ✓ |
| 设置主页入口 | /settings → push /autobill?panel=settings | /settings ✓ | /settings ✓ |
| SettingsPanel 内 | — | 回 ReviewTab（内部，无路由） | 回 ReviewTab ✓ |
| ReviewTab 内 | — | router.back() 退出模块 | 退出模块 ✓ |

任何页面：**返回一次 = 回到上一级，不会循环**。

## 四、关键修复：主页入口 replace → push（2.16.4-B1）

### 现象（真机复现）
记账主页「待确认账单 N 笔」入口原本是：

```ts
router.replace('/autobill')
```

`replace` 会**替换历史栈中当前条目**（即 /accounting 被 /autobill 顶替），于是 `router.back()` 无（可退的）条目，点击 Header ‹ 完全无反应，用户只能靠系统返回收口，且路径错乱。

### 修复

```ts
router.push('/autobill')   // 保留下方 /accounting 条目，正常返回
```

### 回归测试（autobill-nav.spec.ts A1）
- 进入 /autobill（push）→ 内部 待确认⇄设置 20 轮 → 路由不变、History position 不增长
- `router.back()` → `/accounting`（一次返回到达父级）

## 五、真机循环验证（20 轮，无历史污染）

CDP 在真实 WebView 中执行（真实按钮 click，非 console 模拟）：

```
进入          /autobill   pos=1
5 轮 × 4 次：设置⇄待确认   pos=1 恒定（20 次内部切换 0 增长）
退出（Header ‹） /accounting  pos=0
```

历史栈全程只有 2 个条目（accounting → autobill），退出后回到 0。

## 六、通知权限调用方式（P3）

```
SettingsPanel「通知使用权」整行（44dp 热区）
  → openNotificationAccessSettings() → AutoBill 插件 openAccessSettings()
  → Android ACTION_NOTIFICATION_LISTENER_SETTINGS
  → 系统「通知读取、回复和控制」→ 每日的价值 → Allow notification access
  → 返回 App：resume 事件 → Runtime.syncAndRefreshAutoBill('resume')
  → store.refreshStatus() → 界面即时「已授权 · 监听正常」
```

关键点：
- 入口直达系统**通知使用权**（Notification Access / NotificationListenerService），不是普通「允许通知」POST_NOTIFICATIONS
- 返回自动刷新，无需重新进入页面（复用 2.16.2 Runtime，本页面无自带 listener）
- 已授权但监听未连接时显示「重新连接」按钮（requestAutoBillRebind）

## 七、验收总结（对照本阶段验收标准）

- ✅ 点击自动记账设置不会返回上一页（SettingsPanel 整卡入口）
- ✅ 可以正常进入通知权限设置（Activity 切换证据）
- ✅ 系统设置返回后状态刷新（已授权 · 监听正常）
- ✅ AutoBill 内部切换不产生历史（20 次循环 position 恒定）
- ✅ 返回一次退出模块（/accounting 或 /settings）
- ✅ 三个主页面滑动正常（accounting → daily-value）
- ✅ AutoBill 页面不响应主页滑动（route 不变）
- ✅ 通知到账实时刷新（UI 链路真机验证）

## 八、截图证据（ui/ 目录）

1. `2164_设置面板_自动记账开关OFF.png` — SettingsPanel
2. `2164_系统通知使用权列表.png` — 系统通知使用权页面
3. `2164_系统通知使用权_每日价值详情.png` — 每日的价值详情页
4. `2164_系统授权确认.png` — Allow 授权确认
5. `2164_返回已授权监听正常.png` — 返回 App 自动刷新
6. `2164_审核页_三态Tab.png` — 审核页三态分段
7. `2164_首页_待确认账单1笔入口.png` — 首页实时入口
8. `2164_审核页_待确认1计数_候选.png` — Tab 计数 + 候选
9. `2164_确认后_待确认0已确认1.png` — 确认状态流转
10. `2164_已确认列表.png` — 已确认回看