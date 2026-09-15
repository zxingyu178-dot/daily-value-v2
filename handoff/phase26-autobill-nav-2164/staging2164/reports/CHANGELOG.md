# DailyValue v2.16.4 CHANGELOG

版本：2.16.4（versionCode 73，基线 2.16.3 / 72）
日期：2026-09-15
定位：**AutoBill 自动记账模块导航稳定化**（本阶段不新增银行卡识别 / 智能分类 / 自动确认规则）

## 一、AutoBill 导航结构重构（P0）

**问题**：旧结构 `/autoBill` 与 `/settings/autobill` 是两个独立 Route，AutoBill ⇄ Settings 反复切换会不断产生 History，返回表现为「设置 → 主页 → 自动记账 → 设置」循环。

**方案**：收敛为单路由 `/autobill`，页面内部用 Panel 状态机切换：

```
/autobill
 ├── ReviewTab（待确认 / 已确认 / 已忽略 三态分段）
 └── SettingsPanel（内嵌设置面板，非独立路由）
```

- 路由文件只保留 `/autobill`（删除 `/settings/autobill`），见 `src/app/router/index.ts`
- AutoBillPage 内部 `panel: 'review' | 'settings'` 纯状态切换，**禁止 router.push/replace 做内部导航**（P0 硬性约束）
- 内部切换不产生任何 Web History

## 二、返回逻辑修复（P1）

- Header 返回：SettingsPanel → 回 ReviewTab；ReviewTab → 退出模块（router.back() 回父级）
- 记账主页入口：`router.replace('/autobill')` **修复为 `router.push('/autobill')`**
  - 根因：replace 会把历史栈中 `/accounting` 条目直接替换掉，`router.back()` 无路可退（真机实测 Header ‹ 无反应）
  - 修复后：主页 → /autobill → ‹ → /accounting，一次返回回到上一级
- 设置主页入口：`push('/autobill?panel=settings')`，返回一次回设置页

## 三、设置入口交互（P2 / P3）

- 审核页「自动记账设置」入口卡片整卡可点，进入 SettingsPanel（不再跳另一个页面）
- 文案改为两行：「自动记账设置 › / 管理通知权限 · 管理自动识别来源」
- SettingsPanel「通知使用权」整行可点 → 直接打开 Android「设置 → 通知使用权 → 每日的价值」页面
- 系统设置返回 App 后，经 AutoBill Runtime 自动刷新为「已授权 · 监听正常」，无需重新进入页面

## 四、待确认数量显示（P4）

- 三态 Tab 增加数量角标：「待确认 3」「已确认 25」「已忽略 2」
- Store 增加三态计数（`counts`），由 Runtime 同步后统一刷新

## 五、实时通知刷新（P5）

- 通知到达 → NotificationListener → Native Pending Queue → Runtime 同步 → Pinia Store → UI 即时显示
- 无需页面重开 / 手动刷新按钮（沿用 2.16.2 事件驱动 Runtime，本阶段回归验证）

## 六、修复清单（本阶段新增）

| 编号 | 问题 | 修复 |
| --- | --- | --- |
| 2.16.4-B1 | 主页入口用 router.replace 导致返回无路可退 | 改为 router.push（含测试断言补强） |
| 2.16.4-B2 | 内部反复切换累积 History | 单路由 + Panel 状态机，0 历史增长（真机 20 次循环验证） |
| 2.16.4-F1 | 设置入口点击返回上一页 | 整卡进入 SettingsPanel（新结构） |
| 2.16.4-F2 | 用户找不到系统权限入口 | 通知使用权整行可点直达系统页 + 返回自动刷新 |

## 七、本阶段不开发（下一阶段：自动记账 2.0）

- 银行卡通知识别（建设银行消费50元 → 待确认账单）
- 智能分类（商户名称 + 历史记录自动推荐分类）
- 自动确认规则（金额 < 10 元自动确认）
- AI 账单整理（本周外卖消费增加 20% 等）