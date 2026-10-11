"""OPTIONAL — Massive.com (formerly Polygon.io) back-fill for the watched option contract.

Free sources only give today's option chain, so the IV history of the watched contract (e.g. the $400 call expiring
2027-06-17) starts the day you first run the collector.  If you have a Massive "Options" plan you can back-fill the
daily price history once:

    1. put your key in collector/config.local.json:   {"massive_api_key": "YOUR_KEY"}
    2. python run_all.py --only watchfill

Endpoint used (Polygon-compatible):  GET {base}/v2/aggs/ticker/O:<contract>/range/1/day/<from>/<to>?apiKey=...
Daily closes are converted to implied vol with our Black-Scholes using the underlying's close and the T-bill rate.
NOTE: written against Massive's documented Polygon-style API but NOT exercised here (no key available) — check the
first run's output. Rows from live snapshots are never overwritten.
"""
import datetime as dt
import json
import urllib.error
import urllib.request
from bisect import bisect_right

import bsm
import db
from config import CFG
from db import log
from fetch_options import contract_symbol


def run(conn):
    key = CFG.get("massive_api_key")
    if not key:
        return "skipped (no massive_api_key in config.local.json)"
    w = CFG["watch_contract"]
    expiry = dt.date.fromisoformat(w["expiry"])
    cs = contract_symbol(w["symbol"], w["type"], w["strike"], expiry)
    start = (dt.date.today() - dt.timedelta(days=800)).isoformat()
    end = dt.date.today().isoformat()
    url = f"{CFG['massive_base_url']}/v2/aggs/ticker/O:{cs}/range/1/day/{start}/{end}?adjusted=true&sort=asc&limit=50000&apiKey={key}"
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "BitcoinProxyTrader"}), timeout=60) as r:
            data = json.loads(r.read())
    except urllib.error.HTTPError as e:
        return f"Massive HTTP {e.code}: {e.read()[:160]!r}"
    bars = data.get("results") or []
    if not bars:
        return f"no bars returned for {cs} (status {data.get('status')})"
    px = {r["d"]: float(r["close"]) for r in db.query(conn, "SELECT d, close FROM prices_daily WHERE symbol=%s", (w["symbol"],))}
    rates = db.query(conn, "SELECT d, close FROM prices_daily WHERE symbol='^IRX' ORDER BY d")
    rd = [r["d"] for r in rates]
    rv = [float(r["close"]) / 100.0 for r in rates]
    have_snap = {r["d"] for r in db.query(conn, "SELECT d FROM option_watch WHERE contract=%s AND source='snapshot'", (cs,))}
    rows = []
    for b in bars:
        d = dt.datetime.fromtimestamp(b["t"] / 1000, dt.timezone.utc).date()
        if d in have_snap or d not in px or d >= expiry:
            continue
        i = bisect_right(rd, d) - 1
        r = rv[i] if i >= 0 else 0.04
        T = (expiry - d).days / 365.0
        S, K, c = px[d], float(w["strike"]), float(b["c"])
        iv = bsm.implied_vol(c, S, K, T, r, w["type"])
        dl = bsm.delta(S, K, T, r, iv, w["type"]) if iv else None
        rows.append((cs, d, S, c, None, None, round(iv, 5) if iv else None, round(dl, 6) if dl is not None else None, int(b.get("v") or 0), None, "massive"))
    db.upsert(conn, "option_watch", ["contract", "d", "underlying", "price", "bid", "ask", "iv", "delta", "volume", "oi", "source"], rows)
    log(f"  {cs}: back-filled {len(rows)} daily rows")
    return f"{len(rows)} rows"
