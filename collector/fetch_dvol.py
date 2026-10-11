"""Deribit DVOL (30-day BTC implied-vol index), daily candles. Public endpoint, no key."""
import datetime as dt
import json
import time
import urllib.request

import db
from db import log

URL = ("https://www.deribit.com/api/v2/public/get_volatility_index_data"
       "?currency=BTC&resolution=1D&start_timestamp={s}&end_timestamp={e}")


def fetch(start_ms, end_ms):
    rows, cur_end = [], end_ms
    for _ in range(40):                       # paginate backwards via `continuation`
        req = urllib.request.Request(URL.format(s=start_ms, e=cur_end), headers={"User-Agent": "BitcoinProxyTrader"})
        with urllib.request.urlopen(req, timeout=40) as r:
            res = json.loads(r.read())["result"]
        rows += res["data"]
        cont = res.get("continuation")
        if not cont or cont <= start_ms:
            break
        cur_end = cont
        time.sleep(0.3)
    return rows


def run(conn, full=False):
    last = db.one(conn, "SELECT MAX(d) AS d FROM dvol_daily")
    start = dt.datetime(2021, 3, 1, tzinfo=dt.timezone.utc)
    if last and last["d"] and not full:
        start = dt.datetime.combine(last["d"], dt.time(), tzinfo=dt.timezone.utc) - dt.timedelta(days=7)
    end = dt.datetime.now(dt.timezone.utc) + dt.timedelta(days=1)
    data = fetch(int(start.timestamp() * 1000), int(end.timestamp() * 1000))
    seen = {}
    for ts, o, h, l, c in data:
        d = dt.datetime.fromtimestamp(ts / 1000, dt.timezone.utc).date()
        seen[d] = (d, o, h, l, c)
    db.upsert(conn, "dvol_daily", ["d", "open", "high", "low", "close"], list(seen.values()))
    log(f"  DVOL rows {len(seen)}  latest {max(seen)} = {seen[max(seen)][4]}")
    return f"{len(seen)} rows"
