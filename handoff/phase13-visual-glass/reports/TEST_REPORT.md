# TEST REPORT — 2.10.7 跨页新增入口归属

## 覆盖（全量 vitest run 全绿）
```
Test Files  39 passed (39)
     Tests  421 passed (421)
```
配置：`vite.config.ts` 保持 `fileParallelism: false`。口径：414（2.10.6）+ 7（本轮新增）= 421。

## 新增用例：fab-route-ownership.spec.ts（真实 App + Router + KeepAlive + Teleport，不 stub）
| 用例 | 断言 |
|------|------|
| FO-01 首次访问日价再回记账 | 记账页 body 仅 1 个「快速记账」FAB（日价 FAB 不残留） |
| FO-02 反向顺序 + 统计/设置 | 日价→记账→日价 顺序无关；统计/设置均无主页面 FAB |
| FO-03 日价开表单→关闭→回记账→点右下角 | 只出 `.qe`（快速记账），不出 `.dvas`，.dv-sheet 恰 1 个 |
| FO-04 陈旧按钮防御 | 缓存页 handler 带 ownsPage guard，即使被调用也开不了日价 Sheet |
| FO-05 日价日期 Picker 打开时切页 | 主 Sheet + 日期 Picker 全卸载，Back 回调栈归零 |
| FO-06 导航点击往返 20 轮 | 每轮 body FAB 归属正确、无残留 Sheet |
| FO-07 统计往返 | 统计按下/回退/再进，ECharts 不因 KeepAlive 销毁 |

## 配套修正（既有用例）
页面新增 `useRoute()` 门禁后，以下 mount 补**真实 Router 注入**（createMemoryHistory 推到本页，与运行环境一致）：
- AccountingPage.spec.ts `mountPage()`：Router @ /accounting
- polish-ui.spec.ts POLISH-02 两例（DailyValuePage）：Router @ /daily-value（新增 makeDvRouter 助手）
- QuickEntrySheet.spec.ts DATE-08（DailyValuePage）：Router @ /daily-value

## 场景化验证（非单测，已实测）
- **浏览器（vite preview 生产构建 + 系统 Chrome/puppeteer-core）**：FAB-01..07 全过；elementFromPoint 命中 + `page.mouse` 真实坐标点击；「记账→日价→关闭→回记账→点右下角」→ **快速记账**；统计/设置 0 FAB；往返 20 轮无串页。
- **Android（MediaReview_Test，API 35/1080×2400，dumpsys=2.10.7/58）**：adb 真实 `input tap` + 逐屏截图——记账 FAB→「快速记账」；日价 FAB→「添加日价物品」；往返后点右下角→「快速记账」；统计页无 FAB。截图在 `tools/_shots_android/`，同步进 Handoff ui/。
- **账务作用域（浏览器临时 IDB，未触碰真实数据）**：记账入口保存 125 → `ledgerImpact=normal` 且时间线可见；日价入口保存 咖啡机 300 → `ledgerImpact='daily-value-only'` + dailyValue.enabled，不进记账时间线、仅日价展示。

## 待验（交付后用户真机）
- 真机（用户设备）重复以上 往返链路与保存作用域核对；建议半个月频次使用后回查日价历史是否混入 normal（本轮未批量转换历史数据，是否存在误录由用户核对）。

## 附录：2.10.4 测试记录（历史）
- 412 passed / 38 files；新增 GLASS-TOKEN-01/02、APP-GLASS-01、SET-GLASS-01、SETTINGS-GLASS-01/02、GLASS-CSS-01..04（+2.10.5 增 GLASS-CSS-05→413）。
- 基建踩坑：vitest `.vite-temp` 陈旧 transform 缓存（清理 `.vite`+`.vite-temp`）；SettingsPage fake-indexeddb 首次 open 宏任务竞态（预 `await openDatabase()`）。