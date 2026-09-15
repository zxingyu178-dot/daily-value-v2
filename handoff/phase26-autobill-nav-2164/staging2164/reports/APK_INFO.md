# DailyValue v2.16.4 APK_INFO

## 交付 APK

| 项 | 值 |
| --- | --- |
| 文件名 | app-debug-2.16.4.apk |
| 包名 | com.dailyvalue.app |
| versionName | 2.16.4 |
| versionCode | 73 |
| 应用名 | 每日的价值 |
| 大小 | 6,288,614 字节（6.0 MB） |
| SHA-256 | 48ECC4676FA60DB938BD8C257399D8A9666CBDDC2F63AD14CC576628BBB0DB28 |
| minSdk / targetSdk | 24 / 36（compileSdk 36） |
| 生成时间 | 2026-09-15 |

## 版本一致性核对（VERSION-CHECK）

| 位置 | 值 | 一致 |
| --- | --- | --- |
| package.json | 2.16.4 | ✅ |
| package-lock.json | 2.16.4 | ✅ |
| android/app/build.gradle versionName / versionCode | 2.16.4 / 73 | ✅ |
| src/core/release-notes.ts CURRENT_VERSION | 2.16.4 | ✅ |
| aapt dump badging | versionName=2.16.4 versionCode=73 | ✅ |
| 已安装包（dumpsys package） | versionName=2.16.4 versionCode=73 | ✅ |

## 安装与启停

| 项 | 结果 |
| --- | --- |
| 安装方式 | adb install -r（覆盖安装） |
| 启动 | am start -n com.dailyvalue.app/.MainActivity（COLD，TotalTime 5567ms） |
| 卸载前依赖 | 不卸载其他项目 App；不触碰模拟器无关设置 |

## 构建链

```
vue-tsc --noEmit        → 通过
vite build              → ✓ built
cap sync android        → Sync finished
gradlew assembleDebug   → BUILD SUCCESSFUL（JDK 21 = D:\tooling\jdk-21.0.2）
```

## 交付物清单（本阶段）

1. APK：app-debug-2.16.4.apk（6.0 MB）
2. Source ZIP：DailyValue_v2_Source_2.16.4.zip
3. Handoff ZIP：DailyValue_v2_Handoff_2.16.4.zip
   - 包含 CHANGELOG.md / DEV_LOG.md / TEST_REPORT.md / AUTOBILL_NAVIGATION_REPORT.md / APK_INFO.md / APK / ui/ 截图（10 张）