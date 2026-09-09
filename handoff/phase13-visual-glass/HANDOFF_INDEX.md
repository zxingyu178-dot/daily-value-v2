# HANDOFF INDEX — 2.10.7（跨页新增入口归属修复）

> 基线 2.10.6 / 57（SHA `6EE1201C…`）→ **2.10.7 / 58**（SHA `1F9E8D3C…`）。本轮只修「跨页加号与弹层归属」及直接相关生命周期。2.10.4/2.10.5/2.10.6 历史记录保留于 reports/CHANGELOG 与附录，不覆盖历史事实。

## 修复内容
- **入口归属**：DailyValuePage / AccountingPage 各加 `ownsPage = computed(() => route.path === …)`；`<Teleport to="body">` 的 FAB 与对应 Sheet（含日期/分类/管理子弹层树）均 `v-if="ownsPage"`；`openAdd/openEdit/openCreate/openEditBill` 首行 guard。非当前页按钮不再进入可点击 DOM（非透明、非提 z-index）。
- **子层清理**：统计页补 onDeactivated import + 切走关区间日期 Picker；DailyValueAddSheet 关闭时复位日期/分类子 Picker；均不销毁 ECharts 主体。
- **数据语义不变**：记账新增=normal；日价独立新增=daily-value-only。未批量转换历史数据。

## 交付物
| 文件 | 说明 |
|------|------|
| `app-debug.apk` | 2.10.7 / 58，SHA-256 `1F9E8D3CD3764FA1B3170571C41444F1C9E56571F53C44934005AA076CE672B6`，5,997,298 B，见 reports/APK_INFO.md |
| `DailyValue_v2_Source_2.10.7.zip` | 受控源码（git HEAD `3db7aca`，排除 dist/handoff/apk/log/node_modules） |
| `DailyValue_v2_Handoff_2.10.7.zip` | 本索引 + reports/（8 份报告）+ ui/（关键截图） |
| Git | `main` @ `3db7aca`（仅追加 commit） |

## 已验证（Evidence）
| 项 | 结果 | 证据 |
|----|------|------|
| 单测 | 421 passed / 39 files（FO-01..07 新增全绿） | reports/TEST_REPORT.md |
| 类型/构建 | vue-tsc / vite build / cap sync / assembleDebug 全过 | reports/PHASE_REPORT.md |
| 浏览器实测 | FAB-01..07；elementFromPoint+真实坐标点击；关键复现「记账→日价→关闭→回记账→点右下角=快速记账」；统计/设置 0 FAB；20 轮往返 | `ui/browser_evidence.json` + 浏览器截图 |
| Android 实测 | MediaReview_Test(API35/1080×2400) 安装 dumpsys=2.10.7/58；adb tap 往返 2 轮 + 统计无 FAB | ui/01..11_*.png |
| 账务作用域（脚本实测） | 记账=normal 进时间线；日价=daily-value-only 不进时间线仅日价展示 | reports/TEST_REPORT.md §场景化验证 |

## 请用户验收（重点）
1. 记账页右下角 → 「快速记账」；日价页右下角 → 「添加日价物品」；两页互切后各只有自己的加号。
2. 关键复现：记账 → 日价 → 点日价右下角打开「添加日价物品」并关闭 → 回记账 → 点右下角 → 必须出现「快速记账」（不得出现「添加日价物品」）。
3. 统计 / 设置页：右下角无加号。
4. 打开「添加日价物品」后再进入日期/分类子弹层，直接切页：无残留弹层、返回键不粘连。
5. 保存作用域：记账新增进时间线与统计；仅日价新增不进统计（如需现测，可先在模拟器/浏览器验证，勿污染真实数据）。
6. API/版本核对：`adb shell dumpsys package com.dailyvalue.app` → versionName=2.10.7 / versionCode=58（与 APK_INFO 一致）。

> 说明：本轮 Android 实测在无窗口模拟器完成；真机（用户设备）建议重复 2/3/4 项后回填。模拟器已 `adb emu kill` 还原环境；浏览器实测使用临时 IDB，未触碰真实数据。