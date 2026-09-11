# CHANGELOG — 2.13.2

## 用户可见
- 优化统计模块管理，至少保留一个常用统计模块
- 完善自定义主题颜色编辑与预览体验

## 内部
- 统计模块：normalizeStatisticsModules 兼容修复（空/非法/重复→默认每日花费趋势）；setStatisticsModules 空数组拒写返回 false；load 启动自动修复旧 Settings
- Custom Color：hexToHue 恢复 Hue 滑块位置（HEX→HSL→hue）；mini Hero 预览（复用 --dv-hero-* Token）
- 语义色（支出绿/收入红/danger红/warning橙）与 Theme V2 其余成果（Tooltip、Hero、Wallpaper）不回退

## 版本
- package.json / package-lock.json：2.13.2
- android versionName 2.13.2 / versionCode 66
- Release Notes：RELEASE_NOTES 顶部新增 2.13.2 条目