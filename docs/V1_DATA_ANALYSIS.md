# Daily Value v1 数据迁移分析（V1_DATA_ANALYSIS）

> Phase 0 输出：只读分析 v1 工程（`d:\daily`，版本 v1.20.2，versionCode 24）的数据结构与迁移方案。
> 用途：作为 Phase 2「v1 → v2 数据迁移」的设计输入。
> 说明：本文件仅做分析，不修改 v1；v2 代码不引用 v1 类型定义。

## 1. v1 总体情况

| 项 | 值 |
|----|----|
| 应用名 | 每日的价值 |
| applicationId | `com.dailyvalue.app` |
| 最新版本 | v1.20.2（versionCode 24） |
| 技术形态 | Vanilla JS + Capacitor（WebView），`www/` 为前端源 |
| 数据存储 | localStorage（业务数据）+ IndexedDB（大体积图片/壁纸） |

## 2. v1 存储布局（全部键清单）

### 2.1 localStorage

| 键 | 含义 | 迁移决策 |
|----|------|----------|
| `item-value-calculator:v1` | 日价物品列表 | ✅ 迁移（日价数据） |
| `dv-ledger:v1` | 账目（Bill）列表 | ✅ 迁移（账单数据） |
| `dv-settings:v1` | 设置 { sort, currency, mode, theme } | ❌ 不迁移 |
| `dv-ledger-cats:v1` | 自定义分类 [{emoji,name}] | ❌ 不迁移（v2 重建分类） |
| `dv-ledger-tpl:v1` | 记账模板 | ❌ 不迁移 |
| `dv-recurring:v1` / `dv-recurring-pending:v1` | 周期规则 / 待确认 | ❌ 不迁移（周期属扩展功能，Phase 7 扩展阶段重建） |
| `dv-budget:v1` / `dv-budget-alert:v1` | 预算 | ❌ 不迁移（v2 明确禁止预算） |
| `dv-wallpaper:v1` / `dv-wallpaper-migrated` / `dv-wallpaper-params:v1` | 壁纸 | ❌ 不迁移（v2 重做） |
| `dv-stats-range:v1` | 统计区间 | ❌ 不迁移（UI 状态） |
| `dv-backup-remind:v1` | 备份提醒时间 | ❌ 不迁移 |

### 2.2 IndexedDB

| 数据库 | 存储 | 内容 | 决策 |
|--------|------|------|------|
| `dv-images` | `images` | 物品图片 base64、壁纸 base64 | ❌ 不迁移（壁纸不迁移；物品图片随日价数据，v2 是否携带待定，见 §5 风险） |

> 注：v1 中物品图片在 localStorage 存轻量标记 `idb:<key>`，实际 base64 在 IndexedDB `dv-images/images`。

## 3. 迁移目标数据：结构定义（v1 侧）

### 3.1 账目（Bill 数据，来源 `dv-ledger:v1`）

```js
{
  id: string,            // Date.now()+"" 生成的字符串 id
  type: 'expense'|'income'|'transfer',
  amount: number,        // 金额，统一以 CNY 存储（记账时经 toCNY 换算）
  category?: string,     // 分类名（中文，如 "餐饮"）
  emoji?: string,        // 分类 emoji（如 "🍚"）
  direction?: 'out'|'in',// 仅 transfer 时有意义（转出=支出、转入=收入）
  note?: string,         // 备注
  date: string,          // 业务日期 'yyyy-mm-dd'（本地时区）
  timestamp?: number,    // 毫秒时间戳
}
```

要点：
- `amount` 以 CNY 存储，显示时按当前币种换算（`RATES` 汇率表为近似离线值）。
- `type: 'transfer'` 在 v2 模型不存在——v2 只有 `expense`/`income`。迁移时需决策映射（见 §5 风险）。
- 系统内置分类：餐饮🍚、交通🚗、购物🛍️、娱乐🎮、生活🏠。

### 3.2 日价物品（日价数据，来源 `item-value-calculator:v1`）

```js
{
  id?: string,           // 形如 Date.now().toString(36)+rand
  name?: string,         // 物品名
  price?: number,        // 价格（CNY）
  purchaseDate?: string, // 购买日期 'yyyy-mm-dd'
  note?: string,
  image?: string,        // 'idb:<key>' 标记，或旧格式 base64 data URL
  tags?: string[],       // 标签
  createdAt?: number,
}
```

日价口径（v1 实现参考，v2 是否沿用待定）：
- 每日价值 = `price / daysSince(purchaseDate)`，其中 `daysSince` 为距购买日天数（至少 1）。
- Widget 摘要中的 dailyValue = 所有物品 price/days 之和。

## 4. v1 → v2 模型映射建议

### 4.1 账目 → v2 Bill

| v1 字段 | v2 Bill 字段 | 处理（已确认） |
|---------|--------------|------|
| id | id | 直接沿用（唯一性可保证，v1 id 为时间戳字符串） |
| type | type | `expense`/`income` 直接映射；`transfer`：`direction=out`→`expense`、`direction=in`→`income`，并写 `transferDirection` 兼容字段 |
| amount | amount | 直接沿用（同为 CNY） |
| category | categoryId + categoryName + categoryEmoji | 建分类字典（见下） |
| emoji | categoryEmoji | 随分类字典 |
| direction | transferDirection | transfer 专用，**v2 Bill 保留兼容字段，UI 不展示** |
| note | note | 直接沿用 |
| date | date | 直接沿用 |
| timestamp | timestamp | 直接沿用 |
| — | source | 统一写 `import`（迁移导入） |
| — | dailyValueEnabled / dailyValueDays | 普通账目默认 false / 0；日价物品按 §4.2 迁移 |

分类映射（已确认）：
- 系统内置 5 类：预置到 v2 categories（固定 id，如 c-food/c-transport/c-shopping/c-fun/c-life）。
- **只迁移账单中实际使用过的分类**：扫描 `dv-ledger:v1` 中出现的分类名，建立/关联对应 Category；未被任何账目引用的 v1 分类（含自定义分类）一律不迁移。

### 4.2 日价物品 → v2（Phase 2 定稿：Bill + dailyValue + ledgerImpact=daily-value-only）

v2 基线「日价是 Bill 的扩展属性」。**v1 独立日价物品迁移为带 dailyValue 扩展属性的 Bill，且 `ledgerImpact='daily-value-only'`**：

| v1 物品字段 | v2 Bill | 处理 |
|-------------|---------|------|
| id | id | 稳定迁移 id：`dv-<v1 id>`（防与账单 id 冲突） |
| name | categoryName / note | 名称写入 categoryName（物品名） |
| price | amount | 直接沿用（CNY） |
| purchaseDate | date / dailyValue.startDate | 直接沿用 |
| note | note | 直接沿用 |
| createdAt | timestamp | 有则保留 |
| — | type | `expense` |
| — | source | `import` |
| — | ledgerImpact | `daily-value-only`（**关键**：不进入账单时间线/月度支出/统计） |
| — | dailyValue | `{ enabled: true, mode: 'elapsed', startDate: purchaseDate }`（动态计算，不固化 durationDays） |

日价 = `amount / elapsedDays(startDate, 今天)`，`elapsedDays = max(1, localToday - startDate)`，**每天随已使用天数动态变化，禁止在迁移当天固化为固定摊销天数**。

> **作用域隔离**（防污染统计）：v1 的 `item-value-calculator:v1` 与 `dv-ledger:v1` 是两套独立记录。某物品可能同时存在于账单与日价（如"电脑 10000"）。若把日价记录再生成一条普通 expense Bill，账单会从 10000 变成 20000，统计被污染。因此 v1 独立日价物品一律迁移为 `daily-value-only`：可出现在日价模块、计算每日价值，但不进入账单/统计、不改变用户原有现金流。
> 后续用户在正常「记账」时勾选日价，则是 `normal Bill + dailyValue`：同时出现在账单、进入统计、出现在日价。

## 5. 风险与待确认项

1. **transfer（转账）类型** — ✅ 已确认：v2 Bill 保留 `transferDirection` 兼容字段，迁移为 expense/income + 方向字段，UI 不展示。
2. **自定义分类** — ✅ 已确认：只迁移账单中实际使用过的分类，未使用的（含自定义分类）不迁移；重名合并、缺失 emoji→📦、空分类→「未分类📦」。
3. **日价物品与 v2 Bill 架构冲突 / 统计污染** — ✅ 已确认：v1 独立日价物品迁移为 `ledgerImpact='daily-value-only'` 的 Bill，不进入账单/统计（§4.2）。
4. **物品图片** — ✅ 已确认（Phase 2 决策）：本阶段**不迁移图片**（v1 图片 base64 存于 `dv-images` IDB，大体积搬运风险高），优先保证账单 + 日价核心数据 100% 安全迁移；图片迁移结果单独记录在 MIGRATION_REPORT，待后续阶段处理。
5. **v1 数据残留**：迁移完成后不清理 v1 localStorage 键，仅标记已迁移（`v1-migrated:*`），便于回滚排查；备份写入 `v1-backup`。
6. **首次安装 vs 升级**：全新安装无 v1 数据，直接初始化 v2 版本号；升级安装才执行迁移。
7. **迁移前备份与完整校验** — ✅ 已纳入（Phase 2 定稿）：迁移前将 v1 localStorage 快照写入 IndexedDB meta（`v1-backup`，幂等）；迁移步骤内登记数量校验（CountCheck）+ 内容校验（ContentCheck，含金额合计/transfer 映射/日价作用域隔离/未固化天数/图片记录）。
8. **失败可恢复（不允许"假完成"）** — ✅ 已纳入（Phase 2 定稿）：任何失败（备份失败/步骤抛错/校验不通过）都**不更新 dataVersion、不写 migrated 标记**，`to === from`，下次启动可重试；未注册实际 Migration 时明确失败而非返回"迁移完成"。main.ts 检测到 v1 数据 + 迁移失败 → 进入「数据升级未完成」安全页，不进入空账单 App。

## 6. 迁移执行流程（Phase 2 落地）

1. 启动读 `meta.dataVersion`。
2. 若 < CURRENT_DATA_VERSION：
   - 全新安装（无 v1 数据且版本 0）→ 直接置当前版本。
   - 升级（有 v1 数据）→
     - **迁移前备份**：快照 v1 localStorage 到 IndexedDB meta（`v1-backup`，幂等）。
     - 执行已注册 Migration：
       - 读 `dv-ledger:v1` → 映射写 normal bills（含"仅迁移实际使用过的分类"的分类字典建立）。
       - 读 `item-value-calculator:v1` → 迁移为 `daily-value-only` Bill + dailyValue（§4.2）。
       - 每步登记数量校验（CountCheck）+ 内容校验（ContentCheck）。
     - **完整验证**（数量 + 内容全部通过）→ **最后才更新 dataVersion** → **最后才写 `v1-migrated:done`**。
   - 任一失败：不更新 dataVersion、不写 migrated，下次启动可重试；main.ts 进入「数据升级未完成」安全页（保留 v1 原始数据与 backup，可重新尝试迁移）。

> 本分析对应的只读读取实现骨架见 `src/core/migration/v1-reader.ts`；管理器实现见 `src/core/migration/manager.ts`；迁移步骤见 `src/core/migration/migrations/v1-to-v2.ts`。
