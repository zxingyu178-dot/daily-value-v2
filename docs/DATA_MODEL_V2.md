# Daily Value v2 数据模型（DATA_MODEL_V2）

> v1.1 规范文档：本文件为 v2 数据模型正式定义，作为各 Phase 实现依据。
> 权威代码：`src/core/models/types.ts`；两者不一致时以代码为准并同步更新本文件。

## 1. 设计原则

- **核心：Bill**。所有模块（记账/统计/日价）从 Bill 派生。
- **DailyValue 是 Bill 的扩展对象**（`enabled/mode/startDate`），不单独维护第二套数据。
- **日价为动态计算模型**：`currentDailyValue = amount / elapsedDays(startDate, 今天)`，不持久化固定摊销天数（`durationDays`/`elapsedDays` 均不存储），与 v1 实际口径一致，每天随已使用天数自动重算。计算见 `src/core/models/daily-value.ts`，必须使用本地业务日期，避免 UTC 跨天偏差。
- **ledgerImpact 明确账务作用域**：`normal` 进入账单/统计；`daily-value-only`（v1 独立日价物品迁移）仅在日价模块展示，不进入账单时间线/月度支出/统计，避免污染用户原有现金流。
- 金额一律以 **CNY** 存储；显示币种由 Settings.currency 决定（汇率换算仅显示层）。
- 业务日期 `date` 使用本地时区 `yyyy-MM-dd`（吸取 v1 跨天/时区教训）。

## 2. Bill（账单 / 核心实体）

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| id | string | ✅ | 唯一 id |
| type | `'expense' \| 'income'` | ✅ | 支出 / 收入 |
| amount | number | ✅ | 金额（CNY） |
| categoryId | string | ✅ | 关联 Category.id |
| categoryEmoji | string | ✅ | 分类 emoji 快照（冗余，免联表） |
| categoryName | string | ✅ | 分类名称快照（冗余，免联表） |
| title | string | ❌ | **用户可见名称**（Phase 3 前置修正 F）：日价物品名称存此字段（如"MacBook"），categoryName 只存真实分类名；普通账单可省略。旧数据向前兼容（读取用 `title ?? categoryName`） |
| note | string | ✅ | 备注 |
| date | string | ✅ | 业务日期 `yyyy-MM-dd`（本地时区） |
| timestamp | number | ✅ | 毫秒时间戳 |
| source | `'manual' \| 'recurring' \| 'import'` | ✅ | 来源：手动 / 周期 / 导入 |
| recurringRuleId | string | ❌ | 周期规则 id（source=recurring 时） |
| ledgerImpact | `'normal' \| 'daily-value-only'` | ✅ | **账务作用域**：normal 进入账单/统计；daily-value-only（v1 独立日价物品迁移）仅在日价模块展示 |
| transferDirection | `'out' \| 'in'` | ❌ | **v1 转账方向兼容字段，UI 暂不展示** |
| dailyValue | DailyValue | ❌ | 日价扩展对象；未启用日价的普通账单为 undefined |

## 3. DailyValue（日价扩展对象，Bill 内嵌）

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| enabled | boolean | ✅ | 是否参与日价计算 |
| mode | `'elapsed'` | ❌ | 日价模式：按购买日起至今已使用天数动态摊销（v1 实际口径） |
| startDate | string | ✅ | 日价起算日期 `yyyy-MM-dd`（迁移自 v1 purchaseDate） |

- 日价 = `amount / elapsedDays(startDate, 今天)`（动态计算），其中 `elapsedDays = max(1, localToday - startDate)`（含当天起算，至少 1 天）。见 `src/core/models/daily-value.ts`。
- **不持久化 `durationDays`/`elapsedDays` 等固定摊销参数**——天数随日期变化动态变化，禁止在迁移当天固化为固定值。
- v1 日价物品迁移：`{ enabled: true, mode: 'elapsed', startDate: purchaseDate }`，且对应 Bill 的 `ledgerImpact = 'daily-value-only'`（见 V1_DATA_ANALYSIS.md §4.2）。

## 4. Category（分类）

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| id | string | ✅ | 唯一 id |
| name | string | ✅ | 分类名（中文） |
| emoji | string | ✅ | 分类 emoji |
| builtin | boolean | ✅ | 是否系统内置（内置不可删除） |
| sort | number | ✅ | 排序 |

- 系统内置 5 类：餐饮🍚 / 交通🚗 / 购物🛍️ / 娱乐🎮 / 生活🏠。
- 迁移规则：只迁移账单中实际使用过的分类。

## 5. RecurringRule（周期规则，预留）

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| id | string | ✅ | 唯一 id |
| enabled | boolean | ✅ | 是否启用 |
| type | `'expense' \| 'income'` | ✅ | 生成账单类型 |
| amount | number | ✅ | 金额（CNY） |
| categoryId / categoryEmoji / categoryName | string | ✅ | 分类引用 + 快照 |
| note | string | ✅ | 备注 |
| frequency | `'daily' \| 'weekly' \| 'monthly' \| 'yearly'` | ✅ | 频率 |
| interval | number | ✅ | 间隔（默认 1） |
| day | number | ✅ | 周期内触发日 |
| month | number | ❌ | yearly 时月份（1-12） |
| startDate | string | ✅ | 开始日期 `yyyy-MM-dd` |
| lastGeneratedDate | string | ❌ | 最后生成日期（防重复） |
| createdAt | number | ✅ | 创建时间 |

- Phase 7 开放周期业务；不参与 v1 迁移。

## 6. Settings（设置）

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| currency | Currency（符号枚举） | ✅ | 显示币种，存储仍为 CNY |
| theme | `'auto' \| 'light' \| 'dark'` | ✅ | 主题 |
| sort | string | ✅ | 默认排序 |

- 不参与 v1 迁移。

## 7. 存储布局（IndexedDB）

数据库 `daily-value-v2`，版本 `1`（`src/core/db/database.ts`）：

| Object Store | keyPath | 索引 |
|--------------|---------|------|
| bills | id | by-date (date) |
| categories | id | — |
| recurringRules | id | — |
| settings | key | — |
| meta | key | — |

- `meta` 存放数据版本（`dataVersion`）、迁移标记（`v1-migrated:<key>`）、迁移前备份（`v1-backup`）。
- 页面禁止直接访问本层，必须经 `src/core/services` 的 service 接口（架构：Page → Store → Service → Database）。

## 8. 与 v1 的差异要点

| 维度 | v1 | v2 |
|------|----|----|
| 存储 | localStorage + IDB 混合 | 统一 IndexedDB |
| 日价 | 独立物品实体 | Bill 内嵌 DailyValue（elapsed 动态计算，不固化天数） |
| 账务作用域 | 无（日价物品独立，不入账本） | ledgerImpact：normal / daily-value-only |
| 转账 | type=transfer | 移除业务类型，仅 transferDirection 兼容字段 |
| 分类 | 名称+emoji 字符串 | Category 实体（id/builtin/sort） |
| 访问层 | 页面直连存储 | Store → Service → Database 强制 |
