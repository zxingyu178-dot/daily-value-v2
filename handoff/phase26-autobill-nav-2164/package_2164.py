#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""DailyValue 2.16.4 Source / Handoff ZIP 打包。"""
import os
import zipfile
import fnmatch

ROOT = r"d:\DailyValue_v2_Trae_Workspace"
PHASE = os.path.join(ROOT, "handoff", "phase26-autobill-nav-2164")
SRC_OUT = os.path.join(PHASE, "zips", "DailyValue_v2_Source_2.16.4.zip")
HO_OUT = os.path.join(PHASE, "zips", "DailyValue_v2_Handoff_2.16.4.zip")
STAGING = os.path.join(PHASE, "staging2164")

SRC_ROOT_FILES = [
    "package.json", "package-lock.json", "capacitor.config.ts", "index.html",
    "tsconfig.json", "tsconfig.node.json", "vite.config.ts", "README.md", ".gitignore",
]
SRC_DIRS = ["src", "android", "tools"]
SRC_EXCLUDE_DIRNAMES = {
    "node_modules", "dist", "build", ".gradle", ".idea", ".delivery", "handoff",
    "docs", "templates", "rules", "verify_tmp", "_shots_browser", ".trae", "__pycache__", "archive",
}
SRC_TOOLS_KEEP = {"run-vitest.mjs", "send_delivery.py"}
SRC_EXCLUDE_FILENAMES = {"local.properties", "release.keystore", "secrets.env"}
SRC_EXCLUDE_PATTERNS = [
    "*.zip", "*.apk", "*.aab", "*.jks", "*.env", "*.pyc", "*.log",
    ".DS_Store", "Thumbs.db", "_cdp.py", "README_START_HERE.md",
]

def src_excluded(rel, is_dir):
    parts = rel.split("/")
    if parts[0] in SRC_EXCLUDE_DIRNAMES:
        return True
    if parts[0] == "tools" and not is_dir and os.path.basename(rel) not in SRC_TOOLS_KEEP:
        return True
    if not is_dir and os.path.basename(rel) in SRC_EXCLUDE_FILENAMES:
        return True
    if not is_dir and any(fnmatch.fnmatch(os.path.basename(rel), p) for p in SRC_EXCLUDE_PATTERNS):
        return True
    if parts[0] == "android" and ("public" in parts or any(x in parts for x in ("build", ".gradle", ".idea"))):
        return True
    return False

def add_tree(zf, base, prefix):
    for dirpath, dirnames, filenames in os.walk(base):
        dirnames[:] = [d for d in dirnames if not src_excluded(os.path.join(prefix, d), True)]
        for fn in sorted(filenames):
            full = os.path.join(dirpath, fn)
            rel = os.path.relpath(full, ROOT).replace("\\", "/")
            if src_excluded(rel, False):
                continue
            zf.write(full, rel)

def main():
    with zipfile.ZipFile(SRC_OUT, "w", zipfile.ZIP_DEFLATED) as zf:
        for f in SRC_ROOT_FILES:
            p = os.path.join(ROOT, f)
            if os.path.exists(p):
                zf.write(p, f)
        for d in SRC_DIRS:
            add_tree(zf, os.path.join(ROOT, d), d)
    print("[SRC] entries:", sum(1 for _ in zipfile.ZipFile(SRC_OUT).infolist()))

    with zipfile.ZipFile(HO_OUT, "w", zipfile.ZIP_DEFLATED) as zf:
        for dirpath, dirnames, filenames in os.walk(STAGING):
            for fn in sorted(filenames):
                full = os.path.join(dirpath, fn)
                rel = os.path.relpath(full, STAGING).replace("\\", "/")
                zf.write(full, "staging2164/" + rel)
    print("[HO] entries:", sum(1 for _ in zipfile.ZipFile(HO_OUT).infolist()))
    print("[OK]", round(os.path.getsize(SRC_OUT) / 1048576, 2), "MB /", round(os.path.getsize(HO_OUT) / 1048576, 2), "MB")

if __name__ == "__main__":
    main()