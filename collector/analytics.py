"""Derived data: multi-timeframe bars + indicators, snapshot tiles, RSI structure, MA table,
beta/correlation vs BTC, seasonality and realised-vol series.  Everything is persisted in MariaDB
(bars_tf table + analytics JSON rows) so the PHP API stays a thin reader."""
import datetime as dt
import math
from bisect import bisect_right

import db
import indicators as ix
from config import BTC, BTC_ERA_START, EQUITY_SYMBOLS, REFERENCE
from db import log

ERA = dt.date.fromisoformat(BTC_ERA_START)
TF_DEFS = ["4H", "D", "W", "M", "Q"]


def f(x):
    return None if x is None else float(x)


def load_daily(conn, sym):
    rows = db.query(conn, "SELECT d,open,high,low,close,volume FROM prices_daily WHERE symbol=%s ORDER BY d", (sym,))
    return [{"t": r["d"], "o": f(r["open"]), "h": f(r["high"]), "l": f(r["low"]), "c": f(r["close"]), "v": int(r["volume"] or 0)} for r in rows]


def load_hourly(conn, sym):
    rows = db.query(conn, "SELECT ts,open,high,low,close,volume FROM prices_intraday WHERE symbol=%s ORDER BY ts", (sym,))
    return [{"t": r["ts"], "o": f(r["open"]), "h": f(r["high"]), "l": f(r["low"]), "c": f(r["close"]), "v": int(r["volume"] or 0)} for r in rows]


def kind_of(sym):
    return "crypto" if sym == BTC else ("index" if sym.startswith("^") else "equity")


def ann_factor(sym):
    return 365 if sym == BTC else 252


# ----------------------------------------------------------------------------- bars_tf
def store_bars(conn, sym, tf, bars):
    rows = []
    for b in bars:
        t = b["t"]
        if isinstance(t, dt.date) and not isinstance(t, dt.datetime):
            t = dt.datetime.combine(t, dt.time())
        rows.append((sym, tf, t, b["o"], b["h"], b["l"], b["c"], b["v"], b.get("rsi"), b.get("sma20"), b.get("sma50"),
                     b.get("sma100"), b.get("sma200"), b.get("ema21")))
    db.upsert(conn, "bars_tf", ["symbol", "tf", "t", "open", "high", "low", "close", "volume", "rsi14", "sma20", "sma50",
                                "sma100", "sma200", "ema21"], rows)


def build_all_bars(conn, daily):
    """daily: {sym: [bars]}; writes bars_tf for D/W/M/Q (+4H from hourly). Returns {sym: {tf: bars_with_indicators}}."""
    out = {}
    for sym, bars in daily.items():
        if not bars:
            continue
        out[sym] = {}
        for tf in ("D", "W", "M", "Q"):
            rb = ix.with_indicators(ix.resample(bars, tf))
            out[sym][tf] = rb
            if sym.startswith("^"):
                if tf != "D":
                    continue
            store_bars(conn, sym, tf, rb)
        if not sym.startswith("^"):
            hb = load_hourly(conn, sym)
            if hb:
                b4 = ix.with_indicators(ix.resample_4h(hb, crypto=(sym == BTC)))
                out[sym]["4H"] = b4
                db.query(conn, "DELETE FROM bars_tf WHERE symbol=%s AND tf='4H'", (sym,))
                store_bars(conn, sym, "4H", b4)
    return out


# ----------------------------------------------------------------------------- helpers
def idx_on_or_before(dates, d):
    i = bisect_right(dates, d) - 1
    return i if i >= 0 else None


def perf_windows(last_date):
    y = last_date.year
    return [
        ("7D", last_date - dt.timedelta(days=7)),
        ("30D", last_date - dt.timedelta(days=30)),
        ("90D", last_date - dt.timedelta(days=90)),
        ("180D", last_date - dt.timedelta(days=180)),
        ("1Y", last_date - dt.timedelta(days=365)),
        ("YTD", dt.date(y - 1, 12, 31)),
        ("SINCE", ERA),
    ]


def perf_table(dates, closes, bdates, bcloses):
    last_date = dates[-1]
    out = {}
    bi_last = idx_on_or_before(bdates, last_date)
    for label, tgt in perf_windows(last_date):
        listed_after = tgt < dates[0]
        if listed_after and label != "SINCE":
            out[label] = None
            continue
        i = idx_on_or_before(dates, tgt) if not listed_after else 0
        if i is None:
            out[label] = None
            continue
        base_d = dates[i]
        ret = closes[-1] / closes[i] - 1.0
        bj = idx_on_or_before(bdates, base_d)
        bret = (bcloses[bi_last] / bcloses[bj] - 1.0) if (bj is not None and bi_last is not None) else None
        out[label] = {"ret": ret, "btc": bret, "base": base_d.isoformat(), "listing": bool(listed_after and label == "SINCE")}
    return out


def pctile(sorted_list, x):
    return ix.percentile_rank(sorted_list, x)


# ----------------------------------------------------------------------------- RSI structure
PIVOT_RSI = {"4H": 9, "D": 10, "W": 10, "M": 10, "Q": 10}
PIVOT_PX = {"4H": 0.10, "D": 0.15, "W": 0.25, "M": 0.35, "Q": 0.45}
RANGE_LOOKBACK = {"4H": 120, "D": 126, "W": 52, "M": 24, "Q": 12}
DIV_FRESH = {"4H": 60, "D": 60, "W": 26, "M": 12, "Q": 6}


def bar_date(b):
    t = b["t"]
    return t.date().isoformat() if isinstance(t, dt.datetime) else t.isoformat()


def rsi_structure(bars, tf):
    rs = [b["rsi"] for b in bars]
    if not bars or rs[-1] is None:
        return None
    cl = [b["c"] for b in bars]
    piv = ix.zigzag(rs, PIVOT_RSI[tf], "abs")
    swing = ix.swing_trend([p for p in piv])
    cur = rs[-1]
    # bars since RSI last crossed the 50 line
    n = 0
    for v in reversed(rs):
        if v is None or (v > 50) != (cur > 50):
            break
        n += 1
    line50 = {"state": "Above 50" if cur > 50 else "Below 50", "bars": n}
    card = ix.cardwell_range(rs, RANGE_LOOKBACK[tf])
    card["support_zone"] = [40, 50] if card["range"].startswith("Bull") else None
    card["resist_zone"] = [50, 60] if card["range"].startswith("Bear") else None
    # price pivots on same timeframe for divergence/reversal definitions
    ppiv = ix.zigzag(cl, PIVOT_PX[tf], "pct")
    ph = [p for p in ppiv if p[2] == "H"]
    pl = [p for p in ppiv if p[2] == "L"]
    flags = []
    fresh = DIV_FRESH[tf]
    n_bars = len(bars)

    def rsi_at(i, lo=True):
        # RSI extreme within +-2 bars of the price pivot (RSI pivots rarely coincide exactly)
        w = [rs[j] for j in range(max(0, i - 2), min(n_bars, i + 3)) if rs[j] is not None]
        return (min(w) if lo else max(w)) if w else None

    if len(pl) >= 2 and n_bars - 1 - pl[-1][0] <= fresh:
        a, b = pl[-2], pl[-1]
        ra, rb = rsi_at(a[0], True), rsi_at(b[0], True)
        if ra and rb:
            if b[1] < a[1] and rb > ra:
                flags.append({"type": "Bullish divergence", "bias": "bull", "d1": bar_date(bars[a[0]]), "d2": bar_date(bars[b[0]]),
                              "px": [round(a[1], 2), round(b[1], 2)], "rsi": [round(ra, 1), round(rb, 1)],
                              "def": "Price makes a lower low while RSI makes a higher low"})
            if b[1] > a[1] and rb < ra:
                flags.append({"type": "Cardwell negative reversal", "bias": "bear", "d1": bar_date(bars[a[0]]), "d2": bar_date(bars[b[0]]),
                              "px": [round(a[1], 2), round(b[1], 2)], "rsi": [round(ra, 1), round(rb, 1)],
                              "def": "Price makes a higher low while RSI makes a lower low"})
    if len(ph) >= 2 and n_bars - 1 - ph[-1][0] <= fresh:
        a, b = ph[-2], ph[-1]
        ra, rb = rsi_at(a[0], False), rsi_at(b[0], False)
        if ra and rb:
            if b[1] > a[1] and rb < ra:
                flags.append({"type": "Bearish divergence", "bias": "bear", "d1": bar_date(bars[a[0]]), "d2": bar_date(bars[b[0]]),
                              "px": [round(a[1], 2), round(b[1], 2)], "rsi": [round(ra, 1), round(rb, 1)],
                              "def": "Price makes a higher high while RSI makes a lower high"})
            if b[1] < a[1] and rb > ra:
                flags.append({"type": "Cardwell positive reversal", "bias": "bull", "d1": bar_date(bars[a[0]]), "d2": bar_date(bars[b[0]]),
                              "px": [round(a[1], 2), round(b[1], 2)], "rsi": [round(ra, 1), round(rb, 1)],
                              "def": "Price makes a lower high while RSI makes a higher high"})
    pivots = [{"d": bar_date(bars[i]), "v": round(v, 2), "k": k, "ok": bool(c)} for i, v, k, c in piv[-10:]]
    return {"rsi": round(cur, 2), "prev": round(rs[-2], 2) if len(rs) > 1 and rs[-2] is not None else None,
            "swing": swing, "line50": line50, "cardwell": card, "flags": flags, "pivots": pivots,
            "bar_date": bar_date(bars[-1])}


def since_rsi_low(bars, tf):
    rs = [b["rsi"] for b in bars]
    piv = ix.zigzag(rs, PIVOT_RSI[tf], "abs")
    lows = [p for p in piv if p[2] == "L" and p[3]]
    if not lows:
        return None
    i, v = lows[-1][0], lows[-1][1]
    px0 = bars[i]["c"]
    seg = bars[i:]
    hi = max(b["h"] for b in seg)
    lo_after = min(b["l"] for b in seg)
    peak = seg[0]["c"]
    mdd = 0.0
    for b in seg:
        peak = max(peak, b["c"])
        mdd = min(mdd, b["c"] / peak - 1.0)
    d0 = bars[i]["t"]
    d0d = d0.date() if isinstance(d0, dt.datetime) else d0

    def last_zone(test):
        for j in range(len(bars) - 1, -1, -1):
            if rs[j] is not None and test(rs[j]):
                return {"date": bar_date(bars[j]), "rsi": round(rs[j], 1), "px": round(bars[j]["c"], 2), "chg_pct": bars[-1]["c"] / bars[j]["c"] - 1.0,
                        "bars_ago": len(bars) - 1 - j}
        return None
    return {"last_oversold": last_zone(lambda v: v < 30), "last_overbought": last_zone(lambda v: v > 70), "tf": tf, "low_date": bar_date(bars[i]), "rsi_low": round(v, 1), "px_low": round(px0, 2), "px_now": round(bars[-1]["c"], 2),
            "chg_pct": bars[-1]["c"] / px0 - 1.0, "bars": len(seg) - 1, "rsi_now": round(rs[-1], 1) if rs[-1] else None,
            "high_since": round(hi, 2), "low_since": round(lo_after, 2), "max_dd_since": mdd,
            "rsi_peak_since": round(max(x for x in rs[i:] if x is not None), 1), "days": (bars[-1]["t"] if not isinstance(bars[-1]["t"], dt.datetime) else bars[-1]["t"].date()).toordinal() - d0d.toordinal()}


# ----------------------------------------------------------------------------- MA table + crosses
MA_KEYS = [("sma20", "SMA 20"), ("sma50", "SMA 50"), ("sma100", "SMA 100"), ("sma200", "SMA 200"), ("ema21", "EMA 21")]


def ma_table(bars):
    if not bars:
        return None
    last = bars[-1]
    rows = []
    for k, label in MA_KEYS:
        v = last.get(k)
        rows.append({"key": k, "label": label, "value": v, "dist": (last["c"] / v - 1.0) if v else None, "above": (last["c"] > v) if v else None})
    return rows


def recent_crosses(bars, tf):
    dates = [bar_date(b) for b in bars]
    out = []
    pairs = [("sma50", "sma200", "50/200 SMA", "Golden cross", "Death cross"),
             ("sma20", "sma50", "20/50 SMA", "Bullish cross", "Bearish cross")]
    for fk, sk, name, up, dn in pairs:
        ev = ix.cross_events([b.get(fk) for b in bars], [b.get(sk) for b in bars], dates, 3)
        for e in ev:
            out.append({"tf": tf, "d": e["d"], "kind": f"{up if e['dir'] == 'up' else dn} ({name})", "dir": e["dir"]})
    # price vs 200
    pc = [b["c"] for b in bars]
    ev = ix.cross_events(pc, [b.get("sma200") for b in bars], dates, 3)
    for e in ev:
        out.append({"tf": tf, "d": e["d"], "kind": f"Price {'above' if e['dir'] == 'up' else 'below'} SMA 200", "dir": e["dir"]})
    out.sort(key=lambda x: x["d"], reverse=True)
    return out[:8]


# ----------------------------------------------------------------------------- BTC beta
def aligned_returns(sdates, scloses, bdates, bcloses):
    out = []
    for i in range(1, len(sdates)):
        j1, j0 = idx_on_or_before(bdates, sdates[i]), idx_on_or_before(bdates, sdates[i - 1])
        if j1 is None or j0 is None:
            continue
        rs = scloses[i] / scloses[i - 1] - 1.0
        rb = bcloses[j1] / bcloses[j0] - 1.0
        out.append((sdates[i], rs, rb))
    return out


def beta_block(sym, sdates, scloses, bdates, bcloses):
    al = aligned_returns(sdates, scloses, bdates, bcloses)
    al_era = [a for a in al if a[0] >= ERA] or al
    if len(al) < 40:
        return None
    wins = [("30D", 30), ("60D", 60), ("90D", 90), ("180D", 180), ("1Y", 252), ("2Y", 504)]
    table = []
    for lab, n in wins:
        w = al[-n:]
        if len(w) < min(n, 25):
            continue
        b, c = ix.beta_corr([a[1] for a in w], [a[2] for a in w])
        sv = ix.stdev([a[1] for a in w]); bv = ix.stdev([a[2] for a in w])
        table.append({"window": lab, "n": len(w), "beta": b, "corr": c, "r2": (c * c) if c is not None else None,
                      "vol_ratio": (sv / bv) if sv and bv else None})
    b, c = ix.beta_corr([a[1] for a in al_era], [a[2] for a in al_era])
    sv = ix.stdev([a[1] for a in al_era]); bv = ix.stdev([a[2] for a in al_era])
    table.append({"window": "Since Aug '20" if al_era[0][0] <= ERA + dt.timedelta(days=10) else "Since listing", "n": len(al_era),
                  "beta": b, "corr": c, "r2": (c * c) if c is not None else None, "vol_ratio": (sv / bv) if sv and bv else None})
    # rolling 60D beta/corr (last ~3.2 years)
    series = []
    W = 60
    start = max(W, len(al) - 800)
    for i in range(start, len(al)):
        w = al[i - W + 1:i + 1]
        bb, cc = ix.beta_corr([a[1] for a in w], [a[2] for a in w])
        series.append([al[i][0].isoformat(), round(bb, 3) if bb is not None else None, round(cc, 3) if cc is not None else None])
    # scatter (last 252 sessions) + regression
    sc = al[-252:]
    sb, sc_c = ix.beta_corr([a[1] for a in sc], [a[2] for a in sc])
    mx = sum(a[2] for a in sc) / len(sc); my = sum(a[1] for a in sc) / len(sc)
    alpha = my - (sb or 0) * mx
    scatter = [[round(a[2] * 100, 3), round(a[1] * 100, 3)] for a in sc]
    # ratio sym/BTC x1000 + 200D sma + percentile
    ratio = []
    for d, c in zip(sdates, scloses):
        j = idx_on_or_before(bdates, d)
        if j is not None and bcloses[j] > 0:
            ratio.append((d, c / bcloses[j] * 1000.0))
    rv = [r[1] for r in ratio]
    r200 = ix.sma(rv, 200)
    era_vals = sorted(r[1] for r in ratio if r[0] >= ERA) or sorted(rv)
    cur = rv[-1]
    ratio_out = [[r[0].isoformat(), round(r[1], 4), round(r200[i], 4) if r200[i] else None] for i, r in enumerate(ratio) if r[0] >= ERA or len(ratio) < 400]
    return {"table": table, "series": series, "scatter": scatter, "reg": {"beta": sb, "alpha": alpha, "corr": sc_c},
            "ratio": ratio_out, "ratio_now": cur, "ratio_pctile": pctile(era_vals, cur), "ratio_sma200": r200[-1],
            "ratio_min": era_vals[0], "ratio_max": era_vals[-1], "ratio_median": era_vals[len(era_vals) // 2]}


# ----------------------------------------------------------------------------- seasonality
MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
DOWS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]


def agg(vals):
    vals = [v for v in vals if v is not None]
    if not vals:
        return {"n": 0, "avg": None, "median": None, "win": None}
    return {"n": len(vals), "avg": sum(vals) / len(vals), "median": ix.median(vals), "win": sum(1 for v in vals if v > 0) / len(vals)}


def seasonality(bars):
    """bars: daily bars (ascending)."""
    if len(bars) < 60:
        return None
    dates = [b["t"] for b in bars]
    cl = [b["c"] for b in bars]
    today_m = (dates[-1].year, dates[-1].month)
    # month-end closes
    last_of_month = {}
    for d, c in zip(dates, cl):
        last_of_month[(d.year, d.month)] = (d, c)
    keys = sorted(last_of_month)
    mret = {}
    prev = None
    first_close = cl[0]
    for k in keys:
        c = last_of_month[k][1]
        base = prev if prev is not None else first_close
        mret[k] = c / base - 1.0
        prev = c
    years = sorted({k[0] for k in keys})
    matrix = []
    for y in years:
        row = [None] * 12
        for m in range(1, 13):
            if (y, m) in mret:
                row[m - 1] = mret[(y, m)]
        matrix.append({"year": y, "m": row, "partial_month": today_m[1] if y == today_m[0] else None})
    # month averages (exclude the unfinished month)
    def month_stats(since):
        res = []
        for m in range(1, 13):
            vals = [mret[(y, m)] for y in years if (y, m) in mret and (y, m) != today_m and dt.date(y, m, 28) >= since]
            a = agg(vals)
            a["month"] = MONTHS[m - 1]
            res.append(a)
        return res
    # day of week + daily moves
    rets = [(dates[i], cl[i] / cl[i - 1] - 1.0) for i in range(1, len(cl))]

    def dow_stats(since):
        res = []
        for wd in range(7):
            vals = [r for d, r in rets if d.weekday() == wd and d >= since]
            if not vals:
                continue
            a = agg(vals)
            a["dow"] = DOWS[wd]
            a["avg_abs"] = sum(abs(v) for v in vals) / len(vals)
            res.append(a)
        return res

    def last5(since):
        idx = [i for i, d in enumerate(dates) if d >= since]
        if not idx:
            return None
        lo = idx[0]
        # baseline: all rolling 5-session returns in the sample
        base = [cl[i] / cl[i - 5] - 1.0 for i in range(max(lo, 5), len(cl))]
        per_month = {}
        months = {}
        for i in range(lo, len(cl)):
            months.setdefault((dates[i].year, dates[i].month), []).append(i)
        wins = []
        for k, ids in sorted(months.items()):
            if k == today_m or len(ids) < 8 or ids[0] < 6:
                continue
            e = ids[-1]; s = ids[-5]
            r = cl[e] / cl[s - 1] - 1.0
            wins.append((k, r))
            per_month.setdefault(k[1], []).append(r)
        return {"last5": agg([r for _, r in wins]), "baseline": agg(base),
                "by_month": [dict(agg(per_month.get(m, [])), month=MONTHS[m - 1]) for m in range(1, 13)],
                "recent": [{"ym": f"{k[0]}-{k[1]:02d}", "ret": r} for k, r in wins[-18:]]}

    def moves_by_year():
        res = []
        for y in sorted({d.year for d, _ in rets}):
            v = [r for d, r in rets if d.year == y]
            if len(v) < 10:
                continue
            best = max(((r, d) for d, r in rets if d.year == y))
            worst = min(((r, d) for d, r in rets if d.year == y))
            sd = ix.stdev(v)
            res.append({"year": y, "n": len(v), "avg": sum(v) / len(v), "std": sd, "avg_abs": sum(abs(x) for x in v) / len(v),
                        "up_pct": sum(1 for x in v if x > 0) / len(v), "gt5": sum(1 for x in v if abs(x) >= 0.05) / len(v),
                        "gt10": sum(1 for x in v if abs(x) >= 0.10) / len(v),
                        "best": {"d": best[1].isoformat(), "r": best[0]}, "worst": {"d": worst[1].isoformat(), "r": worst[0]}})
        return res

    return {"matrix": matrix, "month_all": month_stats(dt.date(1900, 1, 1)), "month_era": month_stats(ERA),
            "dow_all": dow_stats(dt.date(1900, 1, 1)), "dow_era": dow_stats(ERA),
            "last5_all": last5(dt.date(1900, 1, 1)), "last5_era": last5(ERA), "moves_by_year": moves_by_year(),
            "first": dates[0].isoformat(), "last": dates[-1].isoformat()}


# ----------------------------------------------------------------------------- vol series
def vol_block(sym, bars):
    dates = [b["t"] for b in bars]
    cl = [b["c"] for b in bars]
    ann = ann_factor(sym)
    rv20 = ix.realized_vol(cl, 20, ann)
    rv30 = ix.realized_vol(cl, 30, ann)
    rv60 = ix.realized_vol(cl, 60, ann)
    hist = sorted(v for v, d in zip(rv20, dates) if v is not None and d >= ERA) or sorted(v for v in rv20 if v is not None)
    series = [[d.isoformat(), round(a, 4) if a else None, round(b, 4) if b else None]
              for d, a, b in zip(dates, rv20, rv30) if d >= dates[-1] - dt.timedelta(days=1100)]
    return {"rv20": rv20[-1], "rv30": rv30[-1], "rv60": rv60[-1], "rv20_pctile": pctile(hist, rv20[-1]) if rv20[-1] else None,
            "series": series, "ann": ann}


# ----------------------------------------------------------------------------- snapshot
def build_snapshot(sym, tfbars, daily, btc):
    D = tfbars["D"]
    dates = [b["t"] for b in D]
    cl = [b["c"] for b in D]
    last = D[-1]
    prev = D[-2] if len(D) > 1 else last
    bdates = [b["t"] for b in btc["D"]]
    bcl = [b["c"] for b in btc["D"]]
    ath_i = max(range(len(cl)), key=lambda i: cl[i])
    y1 = [b for b in D if b["t"] >= dates[-1] - dt.timedelta(days=365)]
    snap = {"symbol": sym, "last_date": dates[-1].isoformat(), "close": last["c"], "prev_close": prev["c"],
            "chg": last["c"] - prev["c"], "chg_pct": last["c"] / prev["c"] - 1.0,
            "open": last["o"], "high": last["h"], "low": last["l"], "volume": last["v"],
            "perf": perf_table(dates, cl, bdates, bcl),
            "ath": cl[ath_i], "ath_date": dates[ath_i].isoformat(), "from_ath": cl[-1] / cl[ath_i] - 1.0,
            "hi52": max(b["h"] for b in y1), "lo52": min(b["l"] for b in y1),
            "first_date": dates[0].isoformat()}
    rsi = {}
    trend = {}
    for tf in ("D", "W", "M"):
        s = rsi_structure(tfbars[tf], tf)
        if s:
            rsi[tf] = s["rsi"]
            trend[tf] = {"swing": s["swing"], "line50": s["line50"]["state"], "bars": s["line50"]["bars"], "range": s["cardwell"]["range"]}
    snap["rsi"], snap["trend"] = rsi, trend
    ma = []
    for k, label in MA_KEYS[:4]:
        v = last.get(k)
        ma.append({"k": label, "v": v, "above": (last["c"] > v) if v else None})
    snap["ma"] = {"detail": ma, "above": sum(1 for m in ma if m["above"]), "of": sum(1 for m in ma if m["above"] is not None)}
    snap["vs_200d"] = (last["c"] / last["sma200"] - 1.0) if last.get("sma200") else None
    vb = vol_block(sym, D)
    snap["rv20"], snap["rv30"], snap["rv20_pctile"] = vb["rv20"], vb["rv30"], vb["rv20_pctile"]
    # BTC reference tiles
    B = btc["D"]
    bl = B[-1]
    snap["btc"] = {"close": bl["c"], "rsi_d": bl["rsi"], "rsi_w": btc["W"][-1]["rsi"], "dist_200d": (bl["c"] / bl["sma200"] - 1.0) if bl.get("sma200") else None,
                   "sma200": bl.get("sma200"), "date": bl["t"].isoformat()}
    return snap


def corr_matrix(daily):
    """Pairwise correlation of daily returns (matched on calendar date) over the last 60 and 252 sessions of each pair."""
    syms = list(daily)
    rets = {}
    for sym, bars in daily.items():
        r = {}
        for i in range(1, len(bars)):
            r[bars[i]["t"]] = bars[i]["c"] / bars[i - 1]["c"] - 1.0
        rets[sym] = r
    out = {"symbols": syms}
    for name, n in (("w60", 60), ("w252", 252)):
        m = []
        for a in syms:
            row = []
            for b in syms:
                if a == b:
                    row.append(1.0)
                    continue
                common = sorted(set(rets[a]) & set(rets[b]))[-n:]
                if len(common) < 30:
                    row.append(None)
                    continue
                _, c = ix.beta_corr([rets[a][d] for d in common], [rets[b][d] for d in common])
                row.append(round(c, 3) if c is not None else None)
            m.append(row)
        out[name] = m
    return out


# ----------------------------------------------------------------------------- entry point
def run(conn):
    syms = EQUITY_SYMBOLS + [BTC, "^VIX"]
    daily = {s: load_daily(conn, s) for s in syms}
    daily = {s: b for s, b in daily.items() if len(b) > 30}
    log(f"  building multi-timeframe bars for {len(daily)} series ...")
    tf = build_all_bars(conn, daily)
    btc = tf[BTC]
    done = 0
    iv_latest = {r["symbol"]: r for r in db.query(
        conn, "SELECT s.* FROM options_summary s JOIN (SELECT symbol, MAX(snapshot_date) d FROM options_summary GROUP BY symbol) m "
              "ON m.symbol=s.symbol AND m.d=s.snapshot_date")}
    for sym in EQUITY_SYMBOLS + [BTC]:
        if sym not in tf:
            continue
        T = tf[sym]
        snap = build_snapshot(sym, T, daily[sym], btc)
        bb = None
        if sym != BTC:
            bb = beta_block(sym, [b["t"] for b in T["D"]], [b["c"] for b in T["D"]], [b["t"] for b in btc["D"]], [b["c"] for b in btc["D"]])
            if bb:
                snap["beta"] = {r["window"]: {"beta": r["beta"], "corr": r["corr"]} for r in bb["table"]}
                snap["ratio_pctile"] = bb["ratio_pctile"]
        if sym in iv_latest and iv_latest[sym]["iv30"]:
            snap["iv30"] = f(iv_latest[sym]["iv30"])
            snap["iv30_date"] = iv_latest[sym]["snapshot_date"].isoformat()
            if snap["rv20"]:
                snap["iv_rv"] = snap["iv30"] / snap["rv20"]
        db.save_analytics(conn, sym, "snapshot", snap)
        rt = {}
        for t in ("4H", "D", "W", "M"):
            if t in T:
                s = rsi_structure(T[t], t)
                if s:
                    rt[t] = s
        db.save_analytics(conn, sym, "rsi_trend", rt)
        slr = {}
        for t in ("D", "W"):
            s = since_rsi_low(T[t], t)
            if s:
                slr[t] = s
        db.save_analytics(conn, sym, "since_rsi_low", slr)
        mt = {t: ma_table(T[t]) for t in ("D", "W", "M") if t in T}
        crosses = []
        for t in ("D", "W"):
            crosses += recent_crosses(T[t], t)
        crosses.sort(key=lambda x: x["d"], reverse=True)
        db.save_analytics(conn, sym, "ma", {"tables": mt, "crosses": crosses[:10],
                                            "last": {t: (T[t][-1]["c"]) for t in ("D", "W", "M")}})
        D = T["D"]
        dts = [b["t"] for b in D]
        cls = [b["c"] for b in D]
        if bb:
            db.save_analytics(conn, sym, "beta", bb)
        db.save_analytics(conn, sym, "seasonality", seasonality(daily[sym]) or {})
        db.save_analytics(conn, sym, "vol", vol_block(sym, D))
        done += 1
    corr = corr_matrix({s_: daily[s_] for s_ in EQUITY_SYMBOLS + [BTC] if s_ in daily})
    db.save_analytics(conn, "ALL", "corr", corr)
    log(f"  analytics stored for {done} symbols")
    return f"{done} symbols"
