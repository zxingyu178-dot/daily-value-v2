# Daily Value v2

极简记账 + 日价应用（Capacitor + Vue 3）。

一个面向 Android 的本地优先记账应用，支持账单记录、分类管理、周期记账、统计图表与自定义壁纸视觉模式。所有数据保存在本机（IndexedDB），无需账号与联网。

## 功能

- 账单记账：快速收支记录（收入/支出）、结余展示、账单列表与编辑
- 分类管理：系统分类 + 自定义分类，支持图标与颜色，删除前引用检查
- 周期记账：按月/周等规则自动生成重复账单
- 日价（Daily Value）：记录每日价格，动态计算经过天数与区间统计
- 统计图表：ECharts 收入/支出趋势、分类占比
- 视觉模式：亮色 / 暗色 / 跟随系统，强调色与玻璃质感；支持自定义壁纸（Cropper 裁剪、模糊、遮罩）
- 小组件：Android 桌面小组件展示当日结余

## 技术栈

| 层 | 技术 |
|----|------|
| 前端框架 | Vue 3 `<script setup>` + TypeScript |
| 状态管理 | Pinia |
| 路由 | Vue Router |
| 原生容器 | Capacitor 7（Android） |
| 图表 | ECharts 5 |
| 存储 | IndexedDB（idb 封装） |
| 测试 | Vitest + @vue/test-utils |
| 壁纸编辑 | vue-advanced-cropper |

## 项目结构

```
├── src/                  # Vue 前端源码
│   ├── app/              # 应用壳（Providers、生命周期）
│   ├── components/       # 通用组件
│   ├── core/             # 核心业务逻辑 / 服务
│   ├── modules/          # 功能模块
│   ├── pages/            # 页面
│   ├── theme/            # 主题 Token 与样式
│   └── test/             # 测试配置
├── android/              # Capacitor Android 工程
├── public/               # 静态资源
└── docs/                 # 产品与设计文档
```

## 本地开发

环境要求：Node.js 18+、JDK 21（Android 构建）、Android SDK。

```bash
npm install          # 安装依赖
npm run dev          # Web 开发模式（Vite）
npm test             # 运行单元测试（Vitest）
npm run build        # 类型检查 + 构建
npx cap sync android # 同步到 Android 工程
```

## 构建 APK

```bash
# 在 android/ 目录下执行，或通过 Android Studio 打开 android/ 构建
cd android && ./gradlew assembleDebug
```

## 文档

- [产品需求](docs/DailyValue_v2_Product_Requirements.md)
- [路线图](docs/DailyValue_v2_Roadmap.md)
- [数据模型](docs/DATA_MODEL_V2.md)
- [UI 设计指南](docs/UI_DESIGN_GUIDE.md)
- [验收标准](docs/PHASE_ACCEPTANCE.md)
- [V1 数据分析](docs/V1_DATA_ANALYSIS.md)
- [Web 交付说明](docs/WEB_DEV_HANDOFF.md)

## License

Private. 本仓库仅用于代码展示。