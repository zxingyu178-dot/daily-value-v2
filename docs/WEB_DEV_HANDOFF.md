# DailyValue v2 —— Web 开发交接文档

> 面向 **只能开发网页的 agent** 的接力开发文档。你只负责 **Web 层（src/ 等）** 的开发和自测；
> Android 构建、发布、交付由接棒人（收尾 agent）负责。**读完本文件再动手。**

- 当前版本：2.10.3 / versionCode 54（`package.json`、`package-lock.json`、`android/app/build.gradle` 三处一致）
- 上一轮遗留：真机手势验收 A~J + ANIM-01..06 **未执行**（清单见文档末尾「真机验收」）

---

## 1. 项目本质

**Hybrid App（混合应用）**：业务代码 100% 是 Web（Vue 3 单页应用），
用 Capacitor 把 `dist/` 静态产物包进 Android WebView 形成 APK。

- 你日常开发的就是一个普通 Web 项目：`npm run dev` 起 Vite，浏览器可调试。
- **但**：真机触摸行为（`touch-action`、系统返回手势、pointer capture）只能在 Android WebView 里验证，
  浏览器模拟 ≠ 真机（项目曾因「单测 PASS 就交付」踩坑，见第 6 节）。
- 你**不碰** `android/` 目录（gradle/versionCode/versionName 由收尾者管理），
  也**不执行** gradle / cap 命令（`build.gradle` 版本号由收尾者同步）。

## 2. 技术栈与依赖

| 层 | 选型 |
|----|------|
| 框架 | Vue 3.5（`<script setup>`）+ TypeScript 5.7（strict） |
| 构建 | Vite 6；`vue-tsc --noEmit` 做类型检查 |
| 状态 | Pinia 3（`src/core/store/`：app / bill / category / recurring / settings） |
| 路由 | vue-router 4（`src/app/router/index.ts`，Web History 模式） |
| 存储 | IndexedDB（`idb` 封装，`src/core/db/database.ts`；service 层 `src/core/services/`） |
| 测试 | Vitest 4 + jsdom + `@vue/test-utils` + `fake-indexeddb` |
| 图表 | ECharts 5（仅 Statistics 页面，`import * as echarts`） |
| 原生桥 | `@capacitor/app`（resume 刷新、Android Back）、`@capacitor/core`（`Capacitor.isNativePlatform()`）、splash-screen |

## 3. 目录速览

```
src/
├─ App.vue                  # 根壳：Header + Nav + app-shell__content + primary-page-stage(动画舞台)
├─ app/
│  ├─ navigation.ts         # 一级导航定义（统计|记账|日价）
│  ├─ router/index.ts       # 路由（/ 重定向到 /accounting）
│  └─ usePrimaryPageSwipe.ts# 一级页面左右滑动切换状态机（2.10.2 重写，重点文件）
├─ pages/
│  ├─ accounting/           # 记账页（主页）：月份绿色卡 + 账单时间线 + QuickEntrySheet
│  ├─ statistics/           # 统计页：月汇总 + ECharts 分类环图/趋势图 + 自定义日期区间统计
│  ├─ daily-value/          # 日价页：每日总花费 + 物品清单 + DailyValueAddSheet
│  ├─ settings/             # 设置 / 壁纸设置 / 周期记账
│  └─ design/               # Design System 演示页（非业务）
├─ components/
│  ├─ design/               # DV* 设计系统组件（DVCard/DVSheet/DVConfirmDialog/DVToast/DVDateTimeWheelPicker…）
│  │   └─ back-handler.ts   # Android 双 Back 退出（业务判定由 App 层注入）
│  └─ category/             # DVCategoryIcon / Picker / Manager
├─ core/
│  ├─ store/                # Pinia stores
│  ├─ services/             # idb / memory / types（页面禁止直连 DB）
│  ├─ db/  migration/  models/  recurring/  widget/  systembars.ts
│  └─ theme/  base.css tokens.ts useTheme.ts   # 设计 Token（CSS 变量）
└─ test/setup.ts            # 测试环境初始化（fake-indexeddb 等）
```

## 4. 开发命令（重要：本机环境特殊性）

⚠️ **`npm` 不在默认 PATH**，不要用 `npm run xxx`。用 `.cmd` 直接调用：

```powershell
# 开发服务器（可选，浏览器调试）
node node_modules\.bin\vite.cmd

# 单元测试（全量串行，约 70~110s；test/setup.ts 已就位）
node node_modules\.bin\vitest.cmd run

# 只跑单个测试文件 / 单个用例
node node_modules\.bin\vitest.cmd run src/pages/accounting/__tests__/AccountingPage.spec.ts
node node_modules\.bin\vitest.cmd run src/app/__tests__/primary-page-swipe.spec.ts -t "MONTH-02"

# 类型检查（收尾者构建前也会跑，你提交前必须自测通过）
node node_modules\.bin\vue-tsc.cmd --noEmit
```

- 测试配置：`vite.config.ts` 里 `fileParallelism: false`（**不要改**，串行防 IndexedDB 串扰）；
  环境 jsdom；CSS 不参与（断言「样式存在」要做源码级校验，见 5.3）。
- 你**不需要**跑 `vite build` / `cap sync` / `gradle`（收尾者负责），但类型检查必须干净。

## 5. 关键架构约定（改代码前必读）

### 5.1 一级页面与手势（最高敏感区域）
- 一级页面：`/statistics`、`/accounting`、`/daily-value`；`App.vue` 对这三个页面做 **KeepAlive 缓存**（`include` 按组件名：`AccountingPage/StatisticsPage/DailyValuePage`——页面组件里 `defineOptions({ name })` 不可改名）。
- 一级页面 Tab 切换一律 `router.replace()`（**不进 Back History**），否则 Android 双 Back 语义被破坏。
- 横向滑动切页由 `src/app/usePrimaryPageSwipe.ts` 的 **Primary Pager** 统一处理（挂 `.app-shell__content`，通过 Pointer Events）。**只准通过这个文件改手势**，不要在各页面自己监听 touch/pointer 实现切页。
- 状态机：`idle → tracking → horizontal/vertical → animating`；方向锁定在 `pointermove`（满足 `abs(dx) > abs(dy)*1.15` 才 `setPointerCapture`）；纵向交浏览器滚动。
- **不要**给一级 RouterView 套 `<Transition out-in>`：2.9.6 曾因此触发整页空白 P0。动画已由 Pager 通过 `primary-page-stage` 的 transform/opacity 承担。
- 起始忽略：屏幕左右边缘 24px（留给系统 Back）、`input/textarea/select/[role=slider]/[data-page-swipe-ignore]`（记账月份卡自带 `data-page-swipe-ignore`，卡内横滑只切月）。**不要**用 `button/a/[role=button]` 一刀切排除（账单行必须可横滑切页）。
- 横滑成功后有 400ms click suppression（吞误触点击），轻点账单仍正常编辑。

### 5.2 CSS 两个血泪教训（新功能必看）
1. **touch-action 不继承**：一级页面主内容里凡是 `overflow-y: auto` 的内部滚动容器，
   必须挂全局类 `dv-primary-scroll-surface`（定义在 `src/theme/base.css`，
   `touch-action: pan-y` + `overscroll-behavior-x: none`）。
   只挂父层没用——Android WebView 会接管横向 pan 抛 `pointercancel` 导致滑动失效（2.10.1 真机翻车根因）。
   当前已挂：`.app-shell__content`、`.accounting__timeline`。
2. **transform 会劫持 fixed 定位**：`primary-page-stage` 滑动/动画时有 inline `transform`，
   容器内的 `position: fixed` 元素（如右下角 FAB）会被带着走。修复方式是 `<Teleport to="body">`
   （2.10.3 对日价/记账 FAB 已应用）。**新增任何 fixed 悬浮按钮，一律 Teleport 到 body。**

### 5.3 测试写法注意事项
- jsdom 不应用 CSS；要断言「样式正确」请对 SFC 源文件做字符串校验
  （参考 `src/app/__tests__/primary-page-swipe.spec.ts` 的 SWIPE-CSS-01，
  用 `readFileSync(join(process.cwd(), 'src/...'))` 读源码文本）。
- **测试禁止写死日期**：`AccountingPage` 默认月份 = 真实「今天」。凡涉及月份/日期断言，
  用相对当前月的动态值（参考该文件里的 `offsetYM(delta)` 工具），否则隔几天就红（之前踩过 2026-08 写死漂移的坑）。
- Teleport 到 body 的元素（Sheet/FAB/Picker/Dialog）不要用 `wrapper.find` 找，用 `document.body.querySelector`。
- 纯逻辑优先提取成纯函数并单测（参考 Pager 的 `resolveGestureIntent` / `shouldCommitSwipe` / `visualDragOffset`）。

### 5.4 产品硬规则（不可改）
- 支出=绿、收入=红（Token `--dv-expense` / `--dv-income`）；记账月份卡固定品牌绿。
- 金额格式：`zh-CN`、两位小数、`tabular-nums`。
- 日期一律 `yyyy-MM-dd` 字符串比较（本地 Calendar 语义），**禁止** `toISOString().slice(0,10)`（UTC 漂移）。
- 删除账单、周期、壁纸等危险操作必须二次确认（DVConfirmDialog）。
- 设计 Token 优先（`src/theme/`），禁止页面硬编码颜色/间距/圆角/z-index。
- 冻结区：Statistics 日期区间/ECharts 生命周期、Bill 删除、Category、Wallpaper、Widget、Recurring、Startup、双 Back 退出——**本轮交接中如无明确指令不要动**。

## 6. 本轮遗留（接棒后优先做）

1. **Android 真机手势验收未执行**（2.10.2/2.10.3 都未完成，用户强调「未真实执行不得标完成」）：
   A. Accounting 账单时间线中部左滑 → DailyValue
   B. Accounting 时间线中部右滑 → Statistics
   C. Statistics 中部左滑 → Accounting
   D. DailyValue 中部右滑 → Accounting
   E. 月份卡左右滑 → 只切月、route 不变
   F. 时间线快速上下滚 → 不换页
   G. 账单行轻点 → 编辑
   H. 账单行横滑 → 切页且不打开编辑
   I. 屏幕左边缘系统 Back → 不被 Pager 抢
   J. 每个方向连续 20 次无异常
   动画：ANIM-01 慢拖 40px 跟手回弹 / ANIM-02·03 甩动切页退场入场 / ANIM-04·05 边界阻尼回弹 / ANIM-06 动画中无白屏/Header 闪烁
   （清单完整版：`handoff/phase12-interaction-pager/reports/DEVICE_UI_TEST.md`。接棒 agent 只开发 Web，
   此项由收尾者或用户真机执行；**若你发现 Web 层有可修正的根因，修正它并写明**。）
2. 交付基线：当前 HEAD `6470b94`，工作区干净；构建链基线=全量测试 402 passed。

## 7. 收尾分工（接棒人完成开发后交给「收尾 agent」的清单）

**你（接棒 Web agent）完成并提交后，把下面状态回传：**
- [ ] 修改文件清单 + 每个文件的根因/方案摘要
- [ ] `vue-tsc --noEmit` 无错误
- [ ] `vitest run` 全量通过（记录通过数）+ 新增用例清单
- [ ] 版本号：`package.json` 若需升版，只改这一处（收尾者负责同步 package-lock / build.gradle / APK）
- [ ] 是否涉及新「内部滚动容器」或「fixed 悬浮元素」（已按 5.2 规则处理）

**收尾者（我）拿到后负责：**
- 同步 `package-lock.json` 与 `android/app/build.gradle`（version + versionCode+1），三处一致性核对
- `vite build` → `cap sync android` → `gradlew assembleDebug`（JDK 21，`JAVA_HOME=E:\aihome\tools\jdk\jdk-21.0.5+11`）→ `aapt` 实测版本
- 更新 Handoff 报告（PHASE/CHANGELOG/TEST/APK_INFO/DEV_LOG/GIT_*）+ `HANDOFF_INDEX`
- 生成 `DailyValue_v2_Source_X` / `DailyValue_v2_Handoff_X` ZIP + 复制 APK 到 `deliverables/`
- 复用 `tools/archive/_2xx_send_delivery.py` 模式发交付邮件（含真机验收清单提醒）
- git 提交（遵循仓库提交风格：`类型(scope): 版本 摘要`）

## 8. 注意事项（防翻车清单）

- 别把 `vite.config.ts` 的 `fileParallelism` 改回并行；别删 `src/test/setup.ts` 的 mock。
- 页面组件保持**单一根节点**（KeepAlive + RouterView 的既有稳定性约束）。
- 任何新 Sheet/Picker/Dialog 用自己的 Teleport 组件，不要塞进一级页面根节点。
- 改 `usePrimaryPageSwipe` 后必须跑 `primary-page-swipe.spec.ts` 全量用例。
- 新增可交互可滚动区域时先问自己：① 会不会触发 WebView pan 接管（→ 挂 `dv-primary-scroll-surface`）；
  ② 里面有没有 fixed 元素（→ Teleport）；③ 月/日相关断言会不会漂移（→ 动态日期）。