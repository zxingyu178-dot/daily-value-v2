"""Daily Value v2 - 交付物邮箱发送工具（正式接回 v2 工程）

用法:
  python tools/send_delivery.py <file1> [<file2> ...] [--subject <主题>] [--recipient <邮箱>]

说明:
- 复用外部 QQ SMTP 配置（E:\\aihome\\hermes\\config\\secrets.env：
  QQ_SMTP_SERVER / QQ_SMTP_PORT / QQ_SENDER / QQ_AUTH_CODE / QQ_RECEIVER）。
- secrets.env 位于 v2 工程之外，禁止复制 / 提交进仓库。
- 附件使用 MIMEApplication(application/octet-stream)，支持 APK / ZIP。
"""
import argparse
import datetime
import os
import smtplib
import sys
from email.header import Header
from email.mime.application import MIMEApplication
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

# 外部 SMTP 配置位置（不随仓库分发）
SECRETS_CANDIDATES = [
    r"E:\aihome\hermes\config\secrets.env",
    r"E:\aihome\trae\config\secrets.env",
]
DEFAULT_RECIPIENT = "3056668080@qq.com"


def load_env() -> None:
    for env_path in SECRETS_CANDIDATES:
        if not os.path.exists(env_path):
            continue
        with open(env_path, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                key, _, val = line.partition("=")
                if key.strip() not in os.environ:
                    os.environ[key.strip()] = val.strip().strip("'\"")


def main() -> int:
    parser = argparse.ArgumentParser(description="发送交付物（APK/ZIP）到指定邮箱")
    parser.add_argument("files", nargs="+", help="要发送的文件路径（APK / ZIP）")
    parser.add_argument("--subject", default="", help="邮件主题（默认自动生成）")
    parser.add_argument("--recipient", default="", help="收件邮箱（默认取 QQ_RECEIVER）")
    parser.add_argument("--body", default="", help="邮件正文（可选）")
    args = parser.parse_args()

    load_env()

    sender = os.environ.get("QQ_SENDER", "")
    auth_code = os.environ.get("QQ_AUTH_CODE", "")
    smtp_server = os.environ.get("QQ_SMTP_SERVER", "smtp.qq.com")
    smtp_port = int(os.environ.get("QQ_SMTP_PORT", "465"))
    recipient = args.recipient or os.environ.get("QQ_RECEIVER", DEFAULT_RECIPIENT)

    if not sender or not auth_code:
        print("[ERR] QQ_SENDER / QQ_AUTH_CODE 未配置（请检查外部 secrets.env）")
        return 1

    files = [os.path.abspath(p) for p in args.files]
    missing = [p for p in files if not os.path.exists(p)]
    if missing:
        print(f"[ERR] 文件不存在: {missing}")
        return 1

    names = [os.path.basename(p) for p in files]
    total_mb = sum(os.path.getsize(p) for p in files) / (1024 * 1024)
    timestamp = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    subject = args.subject or f"Daily Value v2 交付物 - {', '.join(names)}"
    body = args.body or (
        f"Daily Value v2 交付物已打包\n\n"
        f"时间: {timestamp}\n"
        f"文件: {', '.join(names)}\n"
        f"大小: {total_mb:.2f} MB\n"
    )

    msg = MIMEMultipart()
    msg["From"] = sender
    msg["To"] = recipient
    msg["Subject"] = Header(subject, "utf-8")
    msg.attach(MIMEText(body, "plain", "utf-8"))

    for path, name in zip(files, names):
        with open(path, "rb") as f:
            data = f.read()
        part = MIMEApplication(data, _subtype="octet-stream", Name=name)
        part.add_header("Content-Disposition", "attachment", filename=name)
        msg.attach(part)

    try:
        server = smtplib.SMTP_SSL(smtp_server, smtp_port, timeout=30)
        server.login(sender, auth_code)
        server.sendmail(sender, [recipient], msg.as_string())
        server.quit()
        print(f"[OK] 已发送 {len(files)} 个文件到 {recipient}: {', '.join(names)}")
        return 0
    except smtplib.SMTPAuthenticationError:
        print("[ERR] SMTP 认证失败，请检查 QQ_AUTH_CODE")
        return 1
    except Exception as e:  # noqa: BLE001
        print(f"[ERR] 发送失败: {e}")
        return 1


if __name__ == "__main__":
    sys.exit(main())
