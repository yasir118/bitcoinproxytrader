"""Build the two files to upload to the server:  deploy/out/mstr-app.zip  and  deploy/out/mstr_terminal.sql.gz

    python deploy\\make-package.py            (or double-click deploy\\make-package.bat)

The zip holds the app WITHOUT secrets (config.local.json), logs, caches or Windows-only helpers.
The dump is your current MariaDB database so all history (bars, options snapshot, holdings, notes, saved RSI lines) moves with you.
"""
import gzip
import json
import os
import subprocess
import sys
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
OUT = os.path.join(HERE, "out")
SKIP_DIRS = {"__pycache__", "logs", "out", ".git", ".claude", "site"}
SKIP_FILES = {"config.local.json", "Open dashboard.bat", "run_all.bat", "setup.bat"}
SKIP_SUFFIX = (".pyc",)

os.makedirs(OUT, exist_ok=True)

# ---- 1. application zip
zpath = os.path.join(OUT, "mstr-app.zip")
n = 0
with zipfile.ZipFile(zpath, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as z:
    for base, dirs, files in os.walk(ROOT):
        dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
        for f in files:
            if f in SKIP_FILES or f.endswith(SKIP_SUFFIX):
                continue
            full = os.path.join(base, f)
            z.write(full, os.path.relpath(full, ROOT).replace("\\", "/"))
            n += 1
print(f"mstr-app.zip       {n} files, {os.path.getsize(zpath) / 1e6:.1f} MB")

# ---- 2. database dump (uses the same credentials as the app)
cfg = {"host": "127.0.0.1", "port": 3306, "user": "root", "password": "", "name": "mstr_terminal"}
cfile = os.path.join(ROOT, "collector", "config.local.json")
if os.path.exists(cfile):
    cfg.update(json.load(open(cfile, encoding="utf-8")).get("db", {}))
dump = next((p for p in (r"C:\xampp\mysql\bin\mysqldump.exe", "mysqldump") if p == "mysqldump" or os.path.exists(p)), "mysqldump")
cmd = [dump, f"--host={cfg['host']}", f"--port={cfg['port']}", f"--user={cfg['user']}", "--single-transaction", "--quick", "--default-character-set=utf8mb4", cfg["name"]]
if cfg["password"]:
    cmd.insert(4, f"--password={cfg['password']}")
dpath = os.path.join(OUT, "mstr_terminal.sql.gz")
try:
    p = subprocess.run(cmd, capture_output=True, check=True)
    with gzip.open(dpath, "wb", compresslevel=9) as g:
        g.write(p.stdout)
    print(f"mstr_terminal.sql.gz  {os.path.getsize(dpath) / 1e6:.1f} MB  ({len(p.stdout) / 1e6:.1f} MB uncompressed)")
except Exception as e:
    print("!! database dump failed:", e)
    sys.exit(1)
print("\nNext: upload deploy/out/* and deploy/server-setup.sh to the server (see deploy/DEPLOY.md, step 3).")
