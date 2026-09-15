#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""DailyValue 2.16.4 delivery mail: APK + Source ZIP + Handoff ZIP (QQ SMTP)."""
import os
import smtplib
import sys
from email.header import Header
from email.mime.application import MIMEApplication
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

RECIPIENT = "3056668080@qq.com"
CONFIG = [r"E:\aihome\hermes\config\secrets.env", r"E:\aihome\trae\config\secrets.env"]
THIS = r"d:\DailyValue_v2_Trae_Workspace\handoff\phase26-autobill-nav-2164"
APK = THIS + r"\staging2164\apk\app-debug-2.16.4.apk"
ZIP_SRC = THIS + r"\zips\DailyValue_v2_Source_2.16.4.zip"
ZIP_HO = THIS + r"\zips\DailyValue_v2_Handoff_2.16.4.zip"
SUBJECT = "DailyValue v2.16.4 交付（AutoBill 导航稳定化 · APK + 源码 + Handoff）"

BODY = """DailyValue v2.16.4 — AutoBill 自动记账模块导航稳定化

版本：2.16.4（versionCode 73，基线 2.16.3）
日期：2026-09-15

一、本阶段目标（导航稳定化，非加功能）
解决 AutoBill 模块三个小问题 + 结构优化：
1. 自动记账设置入口无法正确进入系统权限设置
2. 待确认页面返回路径错误
3. AutoBill 页面之间互相污染返回栈

二、完成内容
1. 单路由重构（P0）：/autobill 唯一路由，ReviewTab ⇄ SettingsPanel 用内部 Panel 状态机切换，
   禁止 router 跳转做内部导航；内部切换 0 历史（真机 20 次循环验证 History position 恒定）。
2. 返回逻辑修复（P1）：任意页面返回一次 = 回到上一级，不循环。
   关键修复：主页「待确认账单」入口 router.replace → router.push（replace 会吞掉父级历史导致返回无路可退）。
3. 设置入口（P2）：「自动记账设置」整卡可点 → SettingsPanel（非跳另一个页面）；
   文案两行「自动记账设置 › / 管理通知权限 · 管理自动识别来源」。
4. 通知权限入口（P3）：SettingsPanel「通知使用权」整行可点 → 直达 Android「通知读取、回复和控制」
   （Notification Access，非普通「允许通知」）；系统返回 App 后自动刷新为「已授权 · 监听正常」。
5. 数量角标（P4）：待确认 / 已确认 / 已忽略 三态 Tab 显示数量。
6. 实时刷新（P5）：通知→监听→解析→入库→UI 即时呈现，无页面重开/手动刷新（UI 链路已真机截图验证）。

三、质量（自动 ✅）
- vitest 56 文件 / 603 用例全绿（AUTOBILL-NAV 4 例含 Back 回父级断言、SWIPE-11、全量回归）
- vue-tsc / vite build / cap sync / assembleDebug（JDK21）全绿
- APK：app-debug-2.16.4.apk（6.0 MB，versionCode 73，SHA-256 48ECC4676FA60DB938BD8C257399D8A9666CBDDC2F63AD14CC576628BBB0DB28）

四、附件
1. app-debug-2.16.4.apk
2. DailyValue_v2_Source_2.16.4.zip（1.91 MB）
3. DailyValue_v2_Handoff_2.16.4.zip（7.2 MB，含 AUTOBILL_NAVIGATION_REPORT + CHANGELOG/DEV/TEST/APK_INFO + APK + 10 张真机截图）

五、事实核验说明
- 模拟器已授权通知使用权并全程截图；真实支付宝支付通知触发（P5 全链路）需真机验证，
  模拟器无支付宝客户端无法产生真实通知，已如实标注（自动记账 2.0 阶段真机验收）。
- 本阶段未开发：银行卡通知识别 / 智能分类 / 自动确认规则 / AI 账单整理（下一阶段）。

完成后停止。等待用户验收确认后进入自动记账 2.0。
"""


def load_env():
    for p in CONFIG:
        if not os.path.exists(p):
            continue
        with open(p, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                k, _, v = line.partition("=")
                k, v = k.strip(), v.strip().strip("'\"")
                if k and k not in os.environ:
                    os.environ[k] = v
        return


def main():
    load_env()
    sender = os.environ.get("QQ_SENDER", "")
    auth = os.environ.get("QQ_AUTH_CODE", "")
    if not sender or not auth:
        print("[ERR] QQ_SENDER / QQ_AUTH_CODE not configured")
        return 1
    msg = MIMEMultipart()
    msg["From"] = sender
    msg["To"] = RECIPIENT
    msg["Subject"] = Header(SUBJECT, "utf-8")
    msg.attach(MIMEText(BODY, "plain", "utf-8"))
    for path in (APK, ZIP_SRC, ZIP_HO):
        if not os.path.exists(path):
            print("[ERR] attachment missing:", path)
            return 1
        with open(path, "rb") as f:
            part = MIMEApplication(f.read(), _subtype="octet-stream")
        name = os.path.basename(path)
        part.add_header("Content-Disposition", "attachment", filename=name)
        msg.attach(part)
        print("[OK] attach:", name, round(os.path.getsize(path) / 1048576, 2), "MB")
    try:
        server = smtplib.SMTP_SSL("smtp.qq.com", 465, timeout=60)
        server.login(sender, auth)
        server.sendmail(sender, [RECIPIENT], msg.as_string())
        server.quit()
        print("[OK] mail sent ->", RECIPIENT)
        return 0
    except Exception as e:  # noqa: BLE001
        print("[ERR] send failed:", e)
        return 1


if __name__ == "__main__":
    sys.exit(main())