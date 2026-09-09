# GIT_STATUS — 2.10.7 跨页新增入口归属修复

- 当前分支：`main`
- HEAD：`3db7aca`（2.10.7 修复，含 fab 归属/子层清理/测试；本仓库实际历史很短：`1e5f76b init` → `87ac104 2.10.6` → `9766a1e tools` → **`3db7aca` 2.10.7**）
- 提交前工作区：仅源码/测试/版本文件变更（改动清单见 PHASE_REPORT）。
- 本仓库 git 历史仅 4 条（此前各阶段在独立工作树/外部仓库流转，Git 内不含相册级历史；2.10.4 之前的 GIT_STATUS/PHASE_REPORT 属历史交接文档，结论以其当时 HEAD 为准，保留于本目录附录）。

## 本轮提交
```
3db7aca fix(phase14): 2.10.7 -- 跨页新增入口归属修复: DailyValuePage/AccountingPage FAB 与 Sheet 全部 v-if ownsPage(route.path) + openAdd/openEdit/openCreate/openEditBill 首行 guard; Stats 补 onDeactivated import + 区间 Picker 关闭; DVAddSheet 关闭时复位日期/分类子层; 新增 FAB-01..07 真实 App+Router+KeepAlive+Teleport 测试, 三处页面级单测补真实 Router 注入 (414+7=421 passed, 2.10.7/58)
```

## 一致性
package.json=2.10.7 / package-lock root=2.10.7 / packages[""]=2.10.7 / build.gradle=2.10.7·58 / aapt 实测 `versionCode='58' versionName='2.10.7'` 全部一致。