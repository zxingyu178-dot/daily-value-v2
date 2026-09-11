# GIT_STATUS — 2.13.2 稳定基线

## 头部关系（2.13.2 正式澄清）

| 头 | 提交 | 含义 |
|---|---|---|
| **CODE_HEAD** | `4c9f554` | 2.13.2 业务源码 + 测试 的完整提交；同时补齐 2.10.8→2.13.x 期间的统计模块与 Theme 源码基线 |
| **APK_BUILD_HEAD** | `4c9f554` | assembleDebug 构建时的工作区树 == CODE_HEAD 提交内容（构建在提交前执行，二者文件内容一致；提交只增加提交元数据） |
| **DELIVERY_HEAD** | （本次报告提交，见下） | 仅追加交付报告（handoff 文档），不含代码改动 |

- 请用户做最终验收后再决定是否推送远端；本地不得 amend/reset/rebase 以上提交。
- 版本一致性核对：package.json 2.13.2 / package-lock 2.13.2 / gradle versionName 2.13.2 versionCode 66 / APK badging 一致 / Release Notes 2.13.2 条目存在。

## 工作区状态
- 源码（src/、android build.gradle、package*.json）已提交，工作树干净（除 handoff/docs/tools 等交付目录未纳入版本管理）
- 交付物（APK/ZIP/截图/报告）保存在 handoff/，按仓库惯例不入库

## 交付包体积治理（2.13.2）
- Source ZIP：仅源码 + 配置 + 测试，排除 node_modules、dist、build、.gradle、.idea、android assets（cap sync 生成）、旧 handoff、旧 zip、APK、local.properties、env/secrets/keystore
- Handoff ZIP：8 份报告 + 6 张关键截图 + APK_INFO，不再复制旧主题几十张重复截图