"""Thin PyMySQL helpers: connection, bulk upsert, meta keys, job logging."""
import datetime as dt
import json
import os
import re
import sys
import time

import pymysql

from config import CFG, ROOT


def connect(use_db=True):
    c = CFG["db"]
    return pymysql.connect(
        host=c["host"], port=int(c["port"]), user=c["user"], password=c["password"],
        database=c["name"] if use_db else None, charset="utf8mb4", autocommit=True,
        cursorclass=pymysql.cursors.DictCursor,
    )


def init_schema():
    """Create the database (if missing) and every table."""
    c = CFG["db"]
    conn = connect(use_db=False)
    with conn.cursor() as cur:
        cur.execute(f"CREATE DATABASE IF NOT EXISTS `{c['name']}` CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci")
    conn.close()
    conn = connect()
    with open(os.path.join(ROOT, "schema.sql"), "r", encoding="utf-8") as fh:
        sql = fh.read()
    sql = re.sub(r"--[^\n]*", "", sql)          # strip comments
    with conn.cursor() as cur:
        for stmt in [s.strip() for s in sql.split(";") if s.strip()]:
            cur.execute(stmt)
    return conn


def upsert(conn, table, cols, rows, chunk=1500):
    """INSERT ... ON DUPLICATE KEY UPDATE for every non-key column present in `cols`."""
    if not rows:
        return 0
    col_sql = ",".join(f"`{c}`" for c in cols)
    ph = ",".join(["%s"] * len(cols))
    upd = ",".join(f"`{c}`=VALUES(`{c}`)" for c in cols)
    sql = f"INSERT INTO `{table}` ({col_sql}) VALUES ({ph}) ON DUPLICATE KEY UPDATE {upd}"
    n = 0
    with conn.cursor() as cur:
        for i in range(0, len(rows), chunk):
            part = rows[i:i + chunk]
            cur.executemany(sql, part)
            n += len(part)
    return n


def insert_ignore(conn, table, cols, rows, chunk=1500):
    if not rows:
        return 0
    col_sql = ",".join(f"`{c}`" for c in cols)
    ph = ",".join(["%s"] * len(cols))
    sql = f"INSERT IGNORE INTO `{table}` ({col_sql}) VALUES ({ph})"
    with conn.cursor() as cur:
        for i in range(0, len(rows), chunk):
            cur.executemany(sql, rows[i:i + chunk])
    return len(rows)


def query(conn, sql, args=None):
    with conn.cursor() as cur:
        if args:
            cur.execute(sql, args)
        else:
            cur.execute(sql)                 # no args: leave literal % (LIKE patterns) untouched
        return cur.fetchall()


def one(conn, sql, args=None):
    rows = query(conn, sql, args)
    return rows[0] if rows else None


def set_meta(conn, k, v):
    with conn.cursor() as cur:
        cur.execute("INSERT INTO meta (k, v) VALUES (%s,%s) ON DUPLICATE KEY UPDATE v=VALUES(v), updated_at=NOW()", (k, str(v)))


def get_meta(conn, k, default=None):
    r = one(conn, "SELECT v FROM meta WHERE k=%s", (k,))
    return r["v"] if r else default


def save_analytics(conn, symbol, key, obj):
    payload = json.dumps(obj, separators=(",", ":"), default=_json_default)
    with conn.cursor() as cur:
        cur.execute(
            "INSERT INTO analytics (symbol,k,payload) VALUES (%s,%s,%s) "
            "ON DUPLICATE KEY UPDATE payload=VALUES(payload), updated_at=NOW()", (symbol, key, payload))


def _json_default(o):
    if isinstance(o, (dt.date, dt.datetime)):
        return o.isoformat()
    if hasattr(o, "__float__"):
        return float(o)
    raise TypeError(type(o))


class Job:
    """Context manager that records a run in refresh_log and never lets one failing job kill the pipeline."""

    def __init__(self, conn, name):
        self.conn, self.name = conn, name

    def __enter__(self):
        self.t0 = time.time()
        with self.conn.cursor() as cur:
            cur.execute("INSERT INTO refresh_log (job, started, status) VALUES (%s, UTC_TIMESTAMP(), 'running')", (self.name,))
            self.id = cur.lastrowid
        log(f"▶ {self.name}")
        return self

    def done(self, msg=""):
        self.msg = msg

    def __exit__(self, et, ev, tb):
        status = "ok" if et is None else "error"
        msg = getattr(self, "msg", "") if et is None else f"{et.__name__}: {ev}"
        with self.conn.cursor() as cur:
            cur.execute("UPDATE refresh_log SET finished=UTC_TIMESTAMP(), status=%s, message=%s WHERE id=%s",
                        (status, str(msg)[:390], self.id))
        if et is None:
            log(f"✔ {self.name} ({time.time() - self.t0:.1f}s) {msg}")
        else:
            log(f"✖ {self.name} FAILED: {ev}")
            import traceback
            traceback.print_exception(et, ev, tb, file=sys.stderr)
        return True        # swallow: pipeline continues with the next job


def log(msg):
    sys.stdout.write(f"[{dt.datetime.now().strftime('%H:%M:%S')}] {msg}\n")
    sys.stdout.flush()
