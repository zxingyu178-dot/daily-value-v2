# APK_INFO — 2.13.2

- package: com.dailyvalue.app
- versionName: 2.13.2
- versionCode: 66
- 输出：android/app/build/outputs/apk/debug/app-debug.apk（副本 staging2132/apk/app-debug-2.13.2.apk）
- 大小：6,030,011 bytes（5.75 MB）
- SHA-256: DACCC0B5BFC75099A0188058FBC6E0C3D59AE7AF50A1361D5B21A7A1897CD0CE
- badging（aapt dump）：package name='com.dailyvalue.app' versionCode='66' versionName='2.13.2' compileSdkVersion='36'
- 装机校验：dumpsys package com.dailyvalue.app → versionCode=66 / versionName=2.13.2（与源码 gradle 一致；非旧包冒充）
- 构建链：vue-tsc --noEmit → vite build → cap sync android（@capacitor/cli）→ assembleDebug（JDK 21，E:\aihome\tools\jdk\jdk-21.0.5+11）
- CODE_HEAD：4c9f554（APK 由此提交内容构建）