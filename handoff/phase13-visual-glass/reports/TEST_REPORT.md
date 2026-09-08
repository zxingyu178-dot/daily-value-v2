# TEST REPORT — 2.10.4 Visual Polish

## 覆盖（全量 vitest run 全绿）

```
Test Files  38 passed (38)
     Tests  412 passed (412)
```

配置：`vite.config.ts` 保持 `fileParallelism: false`。

## 新增用例（较 2.10.3 的 402 净增 10）

### 1. theme.spec.ts — 玻璃 Token 与 store 链路
| 用例 | 断言 |
|------|------|
| GLASS-TOKEN-01 | glassStyleList 覆盖 5 档且各有 label/chip/accent/glow/tint；GLASS_ACCENT_DEFAULT = off |
| GLASS-TOKEN-02 | GLASS_CHART（#4DFF88/#FF4D4D）与 4 色 GLASS_CATEGORY_PALETTE |
| APP-GLASS-01 | setThemeGlass('crimson'/'ice') 写 data-theme-glass；默认/undefined 回落 off |
| SET-GLASS-01 | settings.update({themeGlass:'ice'}) 持久化 + 同步 appStore + document |

### 2. SettingsPage.spec.ts — 玻璃 UI
| 用例 | 断言 |
|------|------|
| SETTINGS-GLASS-01 | 渲染「玻璃强调色（深色）」块（关/绯红/琥珀/冰蓝），默认激活「关闭」 |
| SETTINGS-GLASS-02 | 点击「冰蓝」→ settings.themeGlass=ice |

### 3. glass-css.spec.ts（新文件，源级读 base.css）
| 用例 | 断言 |
|------|------|
| GLASS-CSS-01 | :root 默认回落实况（--dv-card-bg:var(--dv-surface)、accent transparent、fab 回 primary、非半透明） |
| GLASS-CSS-02 | 强调色块 + 深色换肤块（玻璃 surface + color-mix 月卡）+ 全部门禁 |
| GLASS-CSS-03 | 背景光晕规则含 `:not([data-wallpaper='on'])` 门禁 |
| GLASS-CSS-04 | 两个 FAB 玻璃规则存在且带深色门禁 |

## 测试基建修复（本轮踩坑，已沉淀）
1. **vitest `.vite-temp` 陈旧 transform 缓存**：连续编辑文件后 vitest 偶发用旧 SFC 编译（表现为「class 引用存在但 script 丢失」类 ReferenceError / Vue warn）。根因为 node_modules/.vite-temp 残留旧编译；修复=清理 `.vite` 与 `.vite-temp` 后再跑（后续如再遇直接清两个目录）。
2. **SettingsPage 用例 fake-indexeddb 首次 open 竞态**：services 是 IndexedDB 实现，测试文件未初始化 DB 时 `settings.update` 的 `db.put` 依赖宏任务可挂起 → 断言读到旧值。修复=玻璃组 beforeEach `await openDatabase()` + 点击后 `await setTimeout(10)`。
3. Edit 工具在此环境偶发「部分写入回退」（曾致 import 段丢失）；已用 grep 批量校验 + 关键文件 Write 全量重写兜底。

## 回归
- 原 402 用例（Pager/统计/删除/账单/壁纸/周期/Back/迁移等）全部保持绿色。
- 冻结区零改动；统计图表生命周期（init/render/resize）不变。