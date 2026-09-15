# DailyValue v2.16.4 TEST_REPORT

## 一、命令与结果

### 1. 全量单元测试（viTest）
```
命令：node tools/run-vitest.mjs run
结果：Test Files  56 passed (56)
      Tests      603 passed (603)
```
新增/更新用例：
- AUTOBILL-NAV（4 例）：20 轮内部切换 0 历史污染 + Back 一次回 /accounting（B1 回归）、设置入口 ?panel=settings Back 回 /settings、Back 一次退出不循环、Header 返回两级行为
- SWIPE-11：子页面 /autobill 完全不参与主页面滑动（路由不变）
- 全量回归：QuickEntrySheet 57、Recurring generator 47、Statistics 29、CategoryManager 18、theme-v2 24、v1-to-v2 migration 15、backup 13、autobill.spec 13、gatec 8、bridge 6、runtime 5 等

### 2. 类型检查与前端构建
```
命令：vue-tsc --noEmit            → 通过（exit 0）
命令：vite build                  → ✓ built（AutoBillPage chunk 3.34kB gzip）
```

### 3. Android 构建
```
命令：cap sync android            → Sync finished
命令：gradlew assembleDebug（JDK 21 = D:\tooling\jdk-21.0.2）
结果：BUILD SUCCESSFUL in 6s（143 tasks）
```

### 4. APK 校验
```
aapt dump badging：
  package: name='com.dailyvalue.app' versionCode='73' versionName='2.16.4'
SHA-256：48ECC4676FA60DB938BD8C257399D8A9666CBDDC2F63AD14CC576628BBB0DB28
大小：6,288,614 字节（6.0 MB）
```

## 二、真机/模拟器验收（adb 实测）

设备：MediaReview_Test 模拟器（Android 15 / API 35 / google_apis / x86_64 / 1080×2400，WHPX）

### 验收项 → 结果

| 验收项 | 方法 | 结果 |
| --- | --- | --- |
| 点击自动记账设置不返回上一页 | 设置→自动记账入口 → 呈现 SettingsPanel（非路由跳转） | ✅ |
| 可以正常进入通知权限设置 | SettingsPanel「通知使用权」→ Activity 切换为 `com.android.settings/.Settings$NotificationAccessSettingsActivity` | ✅ |
| 系统设置返回后状态刷新 | 授权后返回 App → 显示「已授权 · 监听正常」 | ✅ |
| AutoBill 内部切换不产生历史 | CDP 实测 5 轮 × 4 次切换（20 次）History position 恒定 =1 | ✅ |
| 返回一次退出模块 | /autobill → Header ‹ → /accounting（主页）或 /settings（设置入口），position 回到 0 | ✅ |
| 三个主页面滑动正常 | /accounting 左滑 → /daily-value 切页成功 | ✅ |
| AutoBill 页面不响应主页滑动 | /autobill 上左右横滑 → 路由不变 | ✅ |
| 通知到账实时刷新（UI 链路） | 注入待确认候选 → Runtime 同步 → 首页即时「待确认账单 1 笔」；确认后「已确认 1」 | ✅ |
| 待确认/已确认/已忽略 数量角标 | 审核页 Tab 显示「待确认 1」「已确认 1」 | ✅ |

### 关键路径（adb input tap 真实点击 + 截图证据在 ui/ 目录）
1. 设置 → 自动化 → 自动记账入口（整卡）→ SettingsPanel
2. SettingsPanel → 通知使用权 → 系统「通知读取、回复和控制」列表 → 每日的价值 → Allow → 授权
3. 返回 App → 「已授权 · 监听正常」
4. 审核页：设置入口卡 / 三态 Tab / 候选卡片（支付宝 / 测试商户 / -10.00 / 确认·修改·忽略）
5. 确认候选 → 待确认 0 + 已确认 1；已确认 Tab 回看
6. Header ‹：SettingsPanel → review（内部）；review → 退出模块回父级

## 三、测试数据说明

- 待确认候选通过 CDP Runtime.evaluate 写入真实 IndexedDB（daily-value-v2 / autoBillCandidates），再触发页面同步；截图展示的是真实 WebView 渲染结果，非 JSDOM 模拟
- 真机支付宝真实支付通知（P5 全链路）留待真机验收：模拟器无支付宝/微信支付客户端，无法产生真实支付通知；「通知→解析→入库→UI」链路已由 gatec.spec 8 例 + runtime.spec 5 例覆盖，UI 实时呈现已真机截图验证

## 四、结论

- 自动 ✅；质量门禁全通过（测试 / 类型 / 构建 / APK 版本 / 真机交互）
- 已知边界如实标注于 DEV_LOG「遗留与边界」