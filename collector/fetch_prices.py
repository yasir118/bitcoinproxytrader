"""Daily + hourly price history for every ticker and the reference series -> MariaDB."""
import datetime as dt
import time

from config import ALL_SYMBOLS, TICKERS, REFERENCE
import db
from db import log
from yahoo import Yahoo

EPOCH_START = int(dt.datetime(1999, 1, 1).timestamp())


def seed_tickers(conn):
    rows = []
    for i, (s, n, k) in enumerate(TICKERS):
        rows.append((s, n, k, i, 1))
    for j, (s, n, k) in enumerate(REFERENCE):
        rows.append((s, n, k, 100 + j, 0))
    db.upsert(conn, "tickers", ["symbol", "name", "kind", "sort_order", "is_tab"], rows)


def _local_date(ts, gmtoffset):
    return (dt.datetime.fromtimestamp(ts + gmtoffset, dt.timezone.utc)).date()


def fetch_daily(conn, y, full=False):
    now = int(time.time()) + 86400
    total = 0
    for sym in ALL_SYMBOLS:
        last = db.one(conn, "SELECT MAX(d) AS d FROM prices_daily WHERE symbol=%s", (sym,))
        if full or not last or not last["d"]:
            p1 = EPOCH_START
        else:
            p1 = int(dt.datetime.combine(last["d"], dt.time()).timestamp()) - 10 * 86400   # overlap to catch revisions
        try:
            res = y.chart(sym, p1, now, "1d")
        except Exception as e:
            log(f"  ! {sym} daily: {e}")
            continue
        off = res["meta"].get("gmtoffset", 0)
        seen = {}
        for ts, o, h, lo, c, v in res["rows"]:
            seen[_local_date(ts, off)] = (sym, _local_date(ts, off), o, h, lo, c, int(v))    # last bar of a date wins
        rows = list(seen.values())
        db.upsert(conn, "prices_daily", ["symbol", "d", "open", "high", "low", "close", "volume"], rows)
        total += len(rows)
        log(f"  {sym:8} daily +{len(rows):5}  through {max(seen) if seen else '-'}")
    return total


def fetch_hourly(conn, y):
    now = int(time.time())
    p1 = now - 729 * 86400
    total = 0
    for sym in ALL_SYMBOLS:
        if sym.startswith("^"):
            continue
        last = db.one(conn, "SELECT MAX(ts) AS t FROM prices_intraday WHERE symbol=%s", (sym,))
        start = p1
        if last and last["t"]:
            start = max(p1, int(last["t"].replace(tzinfo=dt.timezone.utc).timestamp()) - 3 * 86400)
        try:
            res = y.chart(sym, start, now + 3600, "1h")
        except Exception as e:
            log(f"  ! {sym} hourly: {e}")
            continue
        rows = [(sym, dt.datetime.fromtimestamp(ts, dt.timezone.utc).replace(tzinfo=None), o, h, lo, c, int(v))
                for ts, o, h, lo, c, v in res["rows"]]
        db.upsert(conn, "prices_intraday", ["symbol", "ts", "open", "high", "low", "close", "volume"], rows)
        total += len(rows)
        log(f"  {sym:8} 1h    +{len(rows):5}")
    return total


def run(conn, full=False):
    y = Yahoo()
    seed_tickers(conn)
    n1 = fetch_daily(conn, y, full)
    n2 = fetch_hourly(conn, y)
    last = db.one(conn, "SELECT MAX(d) AS d FROM prices_daily WHERE symbol='MSTR'")
    if last and last["d"]:
        db.set_meta(conn, "data_through", last["d"].isoformat())
    return f"daily rows {n1}, hourly rows {n2}"
