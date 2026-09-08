# -*- coding: utf-8 -*-
"""2.10.6 Sheet 跨页残留修复交付邮件：Source ZIP + Handoff ZIP + APK"""
import os
import sys
import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from email.mime.application import MIMEApplication
from email.header import Header

ROOT = r"d:\DailyValue_v2_Trae_Workspace"
ENV = r"E:\aihome\hermes\config\secrets.env"


def load_env():
    with open(ENV, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, _, v = line.partition("=")
            os.environ.setdefault(k.strip(), v.strip().strip("'\""))


def main():
    load_env()
    sender = os.environ["QQ_SENDER"]
    auth = os.environ["QQ_AUTH_CODE"]
    receiver = os.environ["QQ_RECEIVER"]
    server_host = os.environ.get("QQ_SMTP_SERVER", "smtp.qq.com")
    server_port = int(os.environ.get("QQ_SMTP_PORT", "465"))

    atts = [
        os.path.join(ROOT, "DailyValue_v2_Source_2.10.6.zip"),
        os.path.join(ROOT, "DailyValue_v2_Handoff_2.10.6.zip"),
        os.path.join(ROOT, "deliverables", "DailyValue-2.10.6.apk"),
    ]

    subject = "【DailyValue 2.10.6】Sheet 跨页残留修复交付（日价/记账面板切页残留已修）"
    body = """DailyValue v2.0 · 2.10.6 / 57 交付（基于 2.10.5 的修复）

你反馈的 Bug（最小修复）：
- 现象：日价页打开「添加日价物品」面板后退出（点左侧记账 Tab / 页面切换），
  记账页仍显示日价的面板；对称地，快速记账开着直接切页也会残留。
- 根因：一级页面被 KeepAlive 缓存（保留滚动位置），切换时只 deactivated 不卸载；
  而 DVSheet 是 Teleport 到 body 的子组件，v-if 依赖的 sheetOpen 在切走时仍为 true →
  deactivated 期间面板 DOM 继续悬浮在 body 上，形成跨页残留。
- 修复（最小、对称）：DailyValuePage + AccountingPage 各加 onDeactivated → 强制
  sheetOpen=false 并清 editingBill。仅新增一个生命周期钩子，不动 KeepAlive/路由/Sheet 结构。
- 回归：新增 SHEET-DEACTIV-01 源级用例，防止未来被删除。

验证：
- npm test：414 passed / 38 files（原 413 全绿 + 新增 1）
- 构建链：vue-tsc --noEmit / vite build / cap sync / assembleDebug（JDK 21）全通过
- APK SHA-256：6EE1201C860BD441712DFA33538909EC44240CC6DB1E2DFEDBBCF153A49BFA53
- aapt 实测 versionCode=57 / versionName=2.10.6，三处版本一致
- Git：HEAD 87ac104，工作区干净

真机复核：日价打开面板 → 不关闭直接点记账 Tab，记账页应干净（无日价面板）；
记账打开快速记账 → 点日价 Tab，同样不残留。打开后再关闭面板的行为不受影响。

附件：
1. DailyValue_v2_Source_2.10.6.zip
2. DailyValue_v2_Handoff_2.10.6.zip
3. DailyValue-2.10.6.apk

交付停在完成态等待审核。
"""
    msg = MIMEMultipart()
    msg["From"] = sender
    msg["To"] = receiver
    msg["Subject"] = Header(subject, "utf-8")
    msg.attach(MIMEText(body, "plain", "utf-8"))

    for p in atts:
        name = os.path.basename(p)
        if not os.path.exists(p):
            print(f"[WARN] 附件不存在: {p}")
            continue
        with open(p, "rb") as f:
            part = MIMEApplication(f.read(), _subtype="octet-stream")
        part.add_header("Content-Disposition", "attachment", filename=("utf-8", "", name))
        msg.attach(part)
        print(f"[OK] attach {name} ({os.path.getsize(p)} B)")

    with smtplib.SMTP_SSL(server_host, server_port) as server:
        server.login(sender, auth)
        server.sendmail(sender, [receiver], msg.as_string())
    print(f"[OK] sent to {receiver}")


if __name__ == "__main__":
    main()
    sys.exit(0)