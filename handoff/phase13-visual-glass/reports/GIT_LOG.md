# GIT_LOG — 2.10.7 跨页新增入口归属修复

## HEAD
`3db7aca`（分支 main）— fix(phase14): 2.10.7

## 近期提交（本仓库实际历史）
```
3db7aca fix(phase14): 2.10.7 -- 跨页新增入口归属修复（FAB/Sheet v-if ownsPage + guard + 子层清理 + FO-01..07；421 passed；2.10.7/58）
9766a1e chore(tools): 归档 2.10.6 交付邮件脚本
87ac104 fix(phase13): 2.10.6 -- 一级页面 KeepAlive 切走时自动关闭 Teleport 到 body 的 DVSheet（日价/记账面板跨页残留）…
1e5f76b init: Daily Value v2 记账应用项目源码初始化
```

## 本轮主要文件
- src/pages/daily-value/DailyValuePage.vue / accounting/AccountingPage.vue（ownsPage=route.path 门禁；FAB/Sheet v-if；回调 guard）
- src/pages/statistics/StatisticsPage.vue（onDeactivated import + 区间 Picker 关闭）
- src/pages/daily-value/DailyValueAddSheet.vue（关闭时复位日期/分类子 Picker）
- src/pages/__tests__/fab-route-ownership.spec.ts（新增 FO-01..07）
- AccountingPage.spec / polish-ui.spec / QuickEntrySheet.spec（mount 补真实 Router 注入）
- package.json / package-lock.json / android/app/build.gradle（2.10.7 / 58）

## 历史说明
2.10.4/2.10.5 阶段交付为外部工作树产物（报告/镜像已归档于本目录附录与 handoff/archive）；本仓库 Git 自 1e5f76b 起重建源码历史，不覆盖历史事实。