"""Historical tops/lows + RSI  ->  rule-based BUY / ACCUMULATE / HOLD / REDUCE / SELL signal, with an honest backtest.

DESIGN RULES (so the output can be trusted for what it is):
* Fully causal: the score on day t only uses data available at the close of day t (weekly RSI is the *in-progress*
  week; zig-zag pivots count only after the reversal that confirms them).
* Textbook ingredients (RSI 50-line, 200-day average, 35 % swings); weights were set by judgement, not grid-searched.  They were chosen after
  looking at this history, so the backtest is IN-SAMPLE and flatters the rule -- see the cross-ticker robustness table.
* The backtest compares against plain buy-and-hold and a constant 50 % exposure, splits results by calendar year, and
  charges a trading cost, so over-fitting and luck are visible instead of hidden.
It is a decision aid, not a prediction.  No indicator knows the future.
"""
import datetime as dt
import math
from bisect import bisect_left, insort

import db
import indicators as ix
from analytics import ann_factor, load_daily
from config import BTC, BTC_ERA_START, EQUITY_SYMBOLS
from db import log

ERA = dt.date.fromisoformat(BTC_ERA_START)
VERDICTS = ["SELL", "REDUCE", "HOLD", "ACCUMULATE", "BUY"]
EXPOSURE = {"SELL": 0.0, "REDUCE": 0.25, "HOLD": 0.5, "ACCUMULATE": 0.75, "BUY": 1.0}
WEIGHTS = {"trend": 25, "mom_w": 25, "mom_d": 10, "exhaust": 20, "value": 10, "phase": 15}
BUY_T, ACC_T, RED_T, SELL_T = 40.0, 15.0, -15.0, -40.0
DEBOUNCE = 3                       # a new verdict must hold for 3 sessions before it is "confirmed"
FEE = 0.001                        # 0.10 % cost per unit of exposure traded
PIVOT_THRESHOLDS = [0.25, 0.35, 0.50]
FWD_D = [5, 21, 63, 126]
FWD_W = [4, 13, 26, 52]


def clip(x, lo=-1.0, hi=1.0):
    return max(lo, min(hi, x))


def ramp(x, x0, y0, x1, y1):
    if x1 == x0:
        return y1
    t = (x - x0) / (x1 - x0)
    return y0 + (y1 - y0) * clip(t, 0.0, 1.0)


# ----------------------------------------------------------------------------- component scorers (each in [-1, +1])
def s_mom(r):
    """RSI 50-line momentum: +1 at RSI 70, -1 at RSI 30 (Cardwell: strength above 50 is bullish, below 50 bearish)."""
    return 0.0 if r is None else clip((r - 50.0) / 20.0)


def s_trend(dist):
    """Distance from the 200-day average, saturating at roughly +/-30 %."""
    return 0.0 if dist is None else math.tanh(dist / 0.30)


def s_exhaust(rsi_w, pct):
    """Negative-only overlay: weekly RSI above ~75-85 and/or price stretched above the 90th-99th percentile of its own history."""
    a = ramp(rsi_w, 75, 0.0, 85, -1.0) if rsi_w is not None else 0.0
    b = ramp(pct, 90, 0.0, 99, -1.0) if pct is not None else 0.0
    return clip(a + b, -1.0, 0.0)


def s_value(pct):
    """Positive-only overlay: price in the bottom ~15 % of its own history of distance-from-200-day (capitulation zone)."""
    return 0.0 if pct is None or pct > 15 else ramp(pct, 15, 0.0, 2, 1.0)


def verdict_of(score):
    if score >= BUY_T:
        return "BUY"
    if score >= ACC_T:
        return "ACCUMULATE"
    if score > RED_T:
        return "HOLD"
    if score > SELL_T:
        return "REDUCE"
    return "SELL"


# ----------------------------------------------------------------------------- causal building blocks
def zigzag_causal(vals, thresh):
    """Zig-zag on closes (pct reversal).  Returns pivots [(idx, val, 'H'|'L', confirm_idx|None)] -- confirm_idx is the
    first bar at which the reversal was large enough to *know* the pivot (None for the developing extreme)."""
    out = []
    pts = list(enumerate(vals))
    trend = 0
    hi = lo = pts[0]
    for i, v in pts[1:]:
        if trend == 0:
            if v > hi[1]:
                hi = (i, v)
            if v < lo[1]:
                lo = (i, v)
            if hi[0] > lo[0] and hi[1] / lo[1] - 1 >= thresh:
                out.append([lo[0], lo[1], "L", i])
                trend, lo = 1, (i, v)
            elif lo[0] > hi[0] and 1 - lo[1] / hi[1] >= thresh:
                out.append([hi[0], hi[1], "H", i])
                trend, hi = -1, (i, v)
        elif trend == 1:
            if v > hi[1]:
                hi = (i, v)
            elif 1 - v / hi[1] >= thresh:
                out.append([hi[0], hi[1], "H", i])
                trend, lo = -1, (i, v)
        else:
            if v < lo[1]:
                lo = (i, v)
            elif v / lo[1] - 1 >= thresh:
                out.append([lo[0], lo[1], "L", i])
                trend, hi = 1, (i, v)
    if trend == 1:
        out.append([hi[0], hi[1], "H", None])
    elif trend == -1:
        out.append([lo[0], lo[1], "L", None])
    return [tuple(p) for p in out]


def weekly_rsi_causal(dates, closes, n=14):
    """RSI(14) of weekly closes, where the current week uses the latest daily close (what you could see that day)."""
    wk = [ix.week_start(d) for d in dates]
    week_idx, widx = [], -1
    prev = None
    wclose = []
    for i, k in enumerate(wk):
        if k != prev:
            widx += 1
            wclose.append(closes[i])
            prev = k
        else:
            wclose[widx] = closes[i]
        week_idx.append(widx)
    # Wilder state after each completed week
    ag = [None] * len(wclose)
    al = [None] * len(wclose)
    if len(wclose) > n:
        g = l = 0.0
        for j in range(1, n + 1):
            d = wclose[j] - wclose[j - 1]
            g += max(d, 0.0)
            l += max(-d, 0.0)
        ag[n], al[n] = g / n, l / n
        for j in range(n + 1, len(wclose)):
            d = wclose[j] - wclose[j - 1]
            ag[j] = (ag[j - 1] * (n - 1) + max(d, 0.0)) / n
            al[j] = (al[j - 1] * (n - 1) + max(-d, 0.0)) / n
    out = []
    for i, k in enumerate(week_idx):
        j = k - 1                                          # last completed week
        if j < n or ag[j] is None:
            out.append(None)
            continue
        d = closes[i] - wclose[j]
        a = (ag[j] * (n - 1) + max(d, 0.0)) / n
        b = (al[j] * (n - 1) + max(-d, 0.0)) / n
        out.append(100.0 if b == 0 else 100.0 - 100.0 / (1.0 + a / b))
    return out, week_idx, wclose


# ----------------------------------------------------------------------------- the model
def score_series(dates, closes):
    n = len(closes)
    rsi_d = ix.rsi_wilder(closes, 14)
    rsi_w, week_idx, wclose = weekly_rsi_causal(dates, closes)
    sma200 = ix.sma(closes, 200)
    zz = zigzag_causal(closes, 0.35)
    confirm_at = {}                                         # bar index -> last confirmed pivot kind known on that bar
    last_kind = None
    ev = {}
    for p in zz:
        if p[3] is not None:
            ev[p[3]] = p[2]
    phase = []
    for i in range(n):
        if i in ev:
            last_kind = ev[i]
        phase.append(last_kind)
    # expanding percentile of the stretch (close / SMA200) measured on the BTC era only
    hist, pct = [], [None] * n
    era_start = ERA - dt.timedelta(days=400)
    for i in range(n):
        if sma200[i] is None or dates[i] < era_start:
            continue
        v = closes[i] / sma200[i]
        if len(hist) >= 150:
            pct[i] = 100.0 * bisect_left(hist, v) / len(hist)
        insort(hist, v)
    rows = []
    for i in range(n):
        if rsi_d[i] is None or rsi_w[i] is None or sma200[i] is None:
            rows.append(None)
            continue
        dist = closes[i] / sma200[i] - 1.0
        comp = {
            "trend": s_trend(dist), "mom_w": s_mom(rsi_w[i]), "mom_d": s_mom(rsi_d[i]), "exhaust": s_exhaust(rsi_w[i], pct[i]),
            "value": s_value(pct[i]), "phase": 0.0 if phase[i] is None else (1.0 if phase[i] == "L" else -1.0),
        }
        score = sum(comp[k] * WEIGHTS[k] for k in comp)
        rows.append({"score": score, "comp": comp, "rsi_d": rsi_d[i], "rsi_w": rsi_w[i], "dist": dist, "pct": pct[i], "phase": phase[i]})
    return rows, zz, rsi_d, rsi_w, sma200


def debounce(raw):
    """Confirmed verdict series: switch only after the new raw verdict has held DEBOUNCE sessions."""
    cur, cand, cnt = None, None, 0
    out = []
    for v in raw:
        if v is None:
            out.append(None)
            continue
        if cur is None:
            cur = v
        elif v == cur:
            cand, cnt = None, 0
        else:
            if v == cand:
                cnt += 1
            else:
                cand, cnt = v, 1
            if cnt >= DEBOUNCE:
                cur, cand, cnt = v, None, 0
        out.append(cur)
    return out


# ----------------------------------------------------------------------------- statistics
def max_drawdown(eq):
    peak, mdd = eq[0], 0.0
    for v in eq:
        peak = max(peak, v)
        mdd = min(mdd, v / peak - 1.0)
    return mdd


def perf_stats(rets, ann):
    if not rets:
        return None
    eq = [1.0]
    for r in rets:
        eq.append(eq[-1] * (1 + r))
    yrs = len(rets) / ann
    sd = ix.stdev(rets) or 0.0
    return {"total": eq[-1] - 1.0, "cagr": (eq[-1] ** (1 / yrs) - 1.0) if yrs > 0.25 and eq[-1] > 0 else None,
            "vol": sd * math.sqrt(ann), "maxdd": max_drawdown(eq), "ret_per_vol": ((sum(rets) / len(rets)) * ann / (sd * math.sqrt(ann))) if sd else None}


def run_rule(closes, positions, start_i, end_i):
    """Daily returns of a rule: position decided at close t is held for session t+1; fee on every change."""
    rets, pos = [], None
    for i in range(start_i, end_i):
        e = positions[i]
        if e is None:
            continue
        r = closes[i + 1] / closes[i] - 1.0
        cost = FEE * abs(e - pos) if pos is not None else 0.0
        pos = e
        rets.append(e * r - cost)
    return rets


def curve(rs):
    eq, c = [], 1.0
    for r in rs:
        c *= 1 + r
        eq.append(c)
    return eq


def backtest(dates, closes, verdicts, start_i, ann, extra):
    """Signal at close t -> exposure applied to the return of session t+1 (i.e. you trade at the close you saw).
    extra: {name: positions[]} baseline rules to compare against (same lag and fees)."""
    n = len(closes)
    pos_main = [EXPOSURE[v] if v else None for v in verdicts]
    first = next((i for i in range(start_i, n - 1) if pos_main[i] is not None), None)
    if first is None:
        return None
    end = n - 1
    out_dates = [dates[i + 1] for i in range(first, end) if pos_main[i] is not None]
    strat = run_rule(closes, pos_main, first, end)
    bh = [closes[i + 1] / closes[i] - 1.0 for i in range(first, end) if pos_main[i] is not None]
    half = [0.5 * r for r in bh]
    expo = [pos_main[i] for i in range(first, end) if pos_main[i] is not None]
    trades, prev = 0, None
    for e in expo:
        if prev is not None and abs(e - prev) > 1e-9:
            trades += 1
        prev = e
    base = {}
    for name, positions in extra.items():
        rs = run_rule(closes, positions, first, end)
        live = [p for p in positions[first:end] if p is not None]
        base[name] = dict(perf_stats(rs, ann), avg_exposure=sum(live) / max(1, len(live)))
        base[name]["curve"] = curve(rs)
    es, eb, eh = curve(strat), curve(bh), curve(half)
    by_year = []
    for y in sorted({d.year for d in out_dates}):
        idx = [k for k, d in enumerate(out_dates) if d.year == y]
        if len(idx) < 20:
            continue

        def prod(rs):
            c = 1.0
            for k in idx:
                c *= 1 + rs[k]
            return c - 1.0
        row = {"year": y, "n": len(idx), "strategy": prod(strat), "buy_hold": prod(bh), "half": prod(half),
               "avg_exposure": sum(expo[k] for k in idx) / len(idx)}
        for name in base:
            ec = base[name]["curve"]
            row[name] = ec[idx[-1]] / (ec[idx[0] - 1] if idx[0] > 0 else 1.0) - 1.0
        by_year.append(row)
    step = max(1, len(out_dates) // 420)
    ks = list(range(0, len(out_dates), step))
    if ks[-1] != len(out_dates) - 1:
        ks.append(len(out_dates) - 1)
    curve_pts = [[out_dates[k].isoformat(), round(es[k], 4), round(eb[k], 4), round(eh[k], 4)] + [round(base[nm]["curve"][k], 4) for nm in base] for k in ks]
    for nm in base:
        base[nm].pop("curve")
    return {"start": out_dates[0].isoformat(), "end": out_dates[-1].isoformat(), "days": len(strat), "curve_cols": ["d", "strategy", "buy_hold", "half"] + list(base),
            "strategy": dict(perf_stats(strat, ann), avg_exposure=sum(expo) / len(expo), trades=trades, fee=FEE),
            "buy_hold": perf_stats(bh, ann), "half": perf_stats(half, ann), "baselines": base, "by_year": by_year, "curve": curve_pts}


def verdict_forward(dates, closes, verdicts, start_i):
    """Average forward return of every session spent in each confirmed verdict (overlapping windows -> descriptive only)."""
    res = []
    n = len(closes)
    for v in VERDICTS:
        row = {"verdict": v}
        idx = [i for i in range(start_i, n) if verdicts[i] == v]
        row["days"] = len(idx)
        for h in FWD_D[1:]:
            vals = [closes[i + h] / closes[i] - 1.0 for i in idx if i + h < n]
            row[f"f{h}"] = {"n": len(vals), "avg": (sum(vals) / len(vals)) if vals else None, "median": ix.median(vals) if vals else None,
                            "win": (sum(1 for x in vals if x > 0) / len(vals)) if vals else None}
        res.append(row)
    return res


def zone_stats_weekly(dates, closes, rsi_w, week_idx, wclose, start_date):
    """RSI(weekly) bucket at each completed week close -> forward returns over the next 4/13/26/52 weeks."""
    last_of_week = {}
    for i, k in enumerate(week_idx):
        last_of_week[k] = i
    wk_rows = []
    for k in range(len(wclose) - 1):                         # exclude the in-progress week
        i = last_of_week[k]
        if dates[i] < start_date or rsi_w[i] is None:
            continue
        wk_rows.append((k, rsi_w[i], dates[i]))
    buckets = [("< 30", 0, 30), ("30-40", 30, 40), ("40-50", 40, 50), ("50-60", 50, 60), ("60-70", 60, 70), ("70-80", 70, 80), ("80+", 80, 101)]
    out = []
    for name, lo, hi in buckets:
        sel = [(k, r, d) for k, r, d in wk_rows if lo <= r < hi]
        row = {"zone": name, "lo": lo, "hi": hi, "n": len(sel)}
        for h in FWD_W:
            vals = [wclose[k + h] / wclose[k] - 1.0 for k, _, _ in sel if k + h < len(wclose)]
            row[f"f{h}"] = {"n": len(vals), "avg": (sum(vals) / len(vals)) if vals else None, "median": ix.median(vals) if vals else None,
                            "win": (sum(1 for x in vals if x > 0) / len(vals)) if vals else None,
                            "worst": min(vals) if vals else None, "best": max(vals) if vals else None}
        out.append(row)
    return out


def pivot_table(dates, closes, rsi_d, rsi_w, zz, thresh, start_date):
    rows = []
    prev = None
    n = len(closes)
    for p in zz:
        i, v, kind, conf = p
        if dates[i] < start_date:
            prev = p
            continue
        def window(arr, lo_side):
            seg = [arr[j] for j in range(max(0, i - 15), min(n, i + 16)) if arr[j] is not None]
            return (min(seg) if lo_side else max(seg)) if seg else None
        rows.append({
            "d": dates[i].isoformat(), "k": "top" if kind == "H" else "low", "px": round(v, 2),
            "rsi_d": round(rsi_d[i], 1) if rsi_d[i] is not None else None, "rsi_w": round(rsi_w[i], 1) if rsi_w[i] is not None else None,
            "rsi_w_ext": round(window(rsi_w, kind == "L"), 1) if window(rsi_w, kind == "L") is not None else None,
            "move": (v / prev[1] - 1.0) if prev else None, "days": (dates[i] - dates[prev[0]]).days if prev else None,
            "confirmed": conf is not None, "confirm_d": dates[conf].isoformat() if conf is not None else None,
            "confirm_px": round(closes[conf], 2) if conf is not None else None,
            "lag_pct": (closes[conf] / v - 1.0) if conf is not None else None,
        })
        prev = p
    tops = [r for r in rows if r["k"] == "top" and r["confirmed"]]
    lows = [r for r in rows if r["k"] == "low" and r["confirmed"]]

    def stat(rs, key):
        vals = [r[key] for r in rs if r[key] is not None]
        return {"n": len(vals), "avg": (sum(vals) / len(vals)) if vals else None, "median": ix.median(vals) if vals else None,
                "min": min(vals) if vals else None, "max": max(vals) if vals else None}
    stats = {"tops_rsi_w": stat(tops, "rsi_w"), "lows_rsi_w": stat(lows, "rsi_w"), "tops_rsi_w_ext": stat(tops, "rsi_w_ext"),
             "lows_rsi_w_ext": stat(lows, "rsi_w_ext"), "tops_rsi_d": stat(tops, "rsi_d"), "lows_rsi_d": stat(lows, "rsi_d"),
             "tops_hit70": (sum(1 for r in tops if (r["rsi_w_ext"] or 0) >= 70) / len(tops)) if tops else None,
             "lows_hit35": (sum(1 for r in lows if (r["rsi_w_ext"] or 100) <= 35) / len(lows)) if lows else None,
             "avg_lag_top": ix.mean([r["lag_pct"] for r in tops]), "avg_lag_low": ix.mean([r["lag_pct"] for r in lows]),
             "avg_up_leg": ix.mean([r["move"] for r in rows if r["k"] == "top" and r["move"] is not None]),
             "avg_down_leg": ix.mean([r["move"] for r in rows if r["k"] == "low" and r["move"] is not None])}
    return {"threshold": thresh, "rows": rows, "stats": stats}


def edge_check(by_verdict, bt):
    """Did bullish verdicts (BUY/ACCUMULATE) actually precede better returns than bearish ones (SELL/REDUCE)?  Descriptive only."""
    def pool(names, key):
        n = tot = wins = 0
        for r in by_verdict:
            if r["verdict"] in names and r[key]["n"]:
                n += r[key]["n"]
                tot += r[key]["avg"] * r[key]["n"]
                wins += (r[key]["win"] or 0) * r[key]["n"]
        return {"n": n, "avg": tot / n if n else None, "win": wins / n if n else None}
    out = {}
    for key in ("f21", "f63", "f126"):
        bull, bear = pool(("BUY", "ACCUMULATE"), key), pool(("SELL", "REDUCE"), key)
        out[key] = {"bull": bull, "bear": bear, "spread": (bull["avg"] - bear["avg"]) if bull["avg"] is not None and bear["avg"] is not None else None}
    st, bh = bt["strategy"], bt["buy_hold"]
    out["risk"] = {"dd_saved": st["maxdd"] - bh["maxdd"], "rpv_strategy": st["ret_per_vol"], "rpv_bh": bh["ret_per_vol"],
                   "beats_bh_return": st["total"] > bh["total"], "beats_bh_rpv": (st["ret_per_vol"] or 0) > (bh["ret_per_vol"] or 0)}
    sp = out["f63"]["spread"]
    wd = (out["f63"]["bull"]["win"] or 0) - (out["f63"]["bear"]["win"] or 0)
    if sp is None:
        out["reading"] = "Not enough history."
    elif sp > 0.05 and wd > 0.05:
        out["reading"] = "In this sample bullish states preceded better 63-day returns than bearish states (in-sample)."
    elif sp > 0:
        out["reading"] = "Bullish states did slightly better than bearish states, but the gap is small and unreliable."
    else:
        out["reading"] = "Bullish states did NOT beat bearish states: the signal showed no edge on this ticker."
    return out


def explain(comp, row):
    rw, rd, dist, pct, ph = row["rsi_w"], row["rsi_d"], row["dist"], row["pct"], row["phase"]
    r = [
        ("trend", "Trend: price vs 200-day average", f"{dist * 100:+.1f}%",
         "Above the 200-day average is bullish, below is bearish (saturates around +/-30 %)."),
        ("mom_w", "Weekly RSI momentum (50-line)", f"{rw:.1f}",
         "Cardwell: weekly RSI holding above 50 (bull range 40-80) = bullish; below 50 (bear range 20-60) = bearish. +1 at 70, -1 at 30."),
        ("mom_d", "Daily RSI momentum (50-line)", f"{rd:.1f}", "Same 50-line read on the daily chart, lower weight (more noise)."),
        ("exhaust", "Exhaustion overlay (never positive)", "n/a" if pct is None else f"RSI-w {rw:.0f} / {pct:.0f}th pct",
         "Penalty when weekly RSI is 75-85+ and/or price is stretched past the 90th-99th percentile of its own distance-from-200d history."),
        ("value", "Capitulation overlay (never negative)", "n/a" if pct is None else f"{pct:.0f}th pct",
         "Bonus when price sits in the bottom ~15 % of its own distance-from-200d history (washed-out zone)."),
        ("phase", "Swing phase (last confirmed pivot)", {"L": "after a low", "H": "after a top", None: "none yet"}[ph],
         "Up-phase after a confirmed >=35 % rally off a low, down-phase after a confirmed >=35 % drop from a top."),
    ]
    return [{"k": k, "label": lab, "value": val, "score": round(comp[k], 3), "weight": WEIGHTS[k], "contrib": round(comp[k] * WEIGHTS[k], 1), "why": why}
            for k, lab, val, why in r]


# ----------------------------------------------------------------------------- driver
def analyse(conn, sym):
    bars = load_daily(conn, sym)
    if len(bars) < 500:
        return None
    dates = [b["t"] for b in bars]
    closes = [b["c"] for b in bars]
    rows, zz_main, rsi_d, rsi_w, sma200 = score_series(dates, closes)
    raw = [verdict_of(r["score"]) if r else None for r in rows]
    conf = debounce(raw)
    ann = ann_factor(sym)
    start_date = ERA if sym != BTC else dt.date(2015, 1, 1)
    start_i = next((i for i, d in enumerate(dates) if d >= start_date and rows[i] is not None), None)
    if start_i is None:
        return None
    # ---- persist the daily series (queryable later)
    sd_rows = [(sym, dates[i], round(rows[i]["score"], 2), conf[i], closes[i], round(rows[i]["rsi_d"], 3), round(rows[i]["rsi_w"], 3))
               for i in range(start_i, len(dates)) if rows[i] is not None]
    db.query(conn, "DELETE FROM signals_daily WHERE symbol=%s", (sym,))
    db.upsert(conn, "signals_daily", ["symbol", "d", "score", "verdict", "close", "rsi_d", "rsi_w"], sd_rows)
    # ---- current reading
    last = len(dates) - 1
    cur = rows[last]
    since = last
    while since > 0 and conf[since - 1] == conf[last]:
        since -= 1
    # trailing score history for the little sparkline
    spark = [[dates[i].isoformat(), round(rows[i]["score"], 1)] for i in range(max(start_i, last - 260), last + 1) if rows[i]]
    week_rsi_series, week_idx, wclose = weekly_rsi_causal(dates, closes)
    out = {
        "symbol": sym, "as_of": dates[last].isoformat(), "close": closes[last], "start": dates[start_i].isoformat(),
        "now": {"score": round(cur["score"], 1), "raw": raw[last], "verdict": conf[last], "since": dates[since].isoformat(),
                "days_in": (dates[last] - dates[since]).days, "components": explain(cur["comp"], cur),
                "rsi_w": round(cur["rsi_w"], 1), "rsi_d": round(cur["rsi_d"], 1)},
        "thresholds": {"buy": BUY_T, "accumulate": ACC_T, "reduce": RED_T, "sell": SELL_T, "weights": WEIGHTS, "debounce": DEBOUNCE,
                       "exposure": EXPOSURE, "fee": FEE},
        "spark": spark,
        "pivots": {str(t): pivot_table(dates, closes, rsi_d, rsi_w, zigzag_causal(closes, t), t, start_date) for t in PIVOT_THRESHOLDS},
        "zones_w": zone_stats_weekly(dates, closes, rsi_w, week_idx, wclose, start_date),
        "backtest": backtest(dates, closes, conf, start_i, ann, {
            "trend200": [(1.0 if closes[i] > sma200[i] else 0.0) if sma200[i] is not None else None for i in range(len(closes))],
            "rsi50": [(1.0 if rsi_w[i] > 50 else 0.0) if rsi_w[i] is not None else None for i in range(len(closes))],
        }),
        "by_verdict": verdict_forward(dates, closes, conf, start_i),
    }
    out["edge"] = edge_check(out["by_verdict"], out["backtest"])
    # daily-RSI zone table (secondary)
    dz = []
    for name, lo, hi in [("< 25", 0, 25), ("25-35", 25, 35), ("35-45", 35, 45), ("45-55", 45, 55), ("55-65", 55, 65), ("65-75", 65, 75), ("75-85", 75, 85), ("85+", 85, 101)]:
        idx = [i for i in range(start_i, len(dates)) if rsi_d[i] is not None and lo <= rsi_d[i] < hi]
        row = {"zone": name, "n": len(idx)}
        for h in FWD_D[1:]:
            vals = [closes[i + h] / closes[i] - 1.0 for i in idx if i + h < len(closes)]
            row[f"f{h}"] = {"n": len(vals), "avg": (sum(vals) / len(vals)) if vals else None, "median": ix.median(vals) if vals else None,
                            "win": (sum(1 for x in vals if x > 0) / len(vals)) if vals else None}
        dz.append(row)
    out["zones_d"] = dz
    return out


def run(conn):
    done = {}
    for sym in [BTC] + EQUITY_SYMBOLS:
        res = analyse(conn, sym)
        if not res:
            log(f"  {sym:7} skipped (not enough history)")
            continue
        done[sym] = res
    btc = done.get(BTC)
    for sym, res in done.items():
        res["context"] = {"btc_verdict": btc["now"]["verdict"] if btc else None, "btc_score": btc["now"]["score"] if btc else None}
        db.save_analytics(conn, sym, "signals", res)
        bt = res["backtest"]
        log(f"  {sym:7} now {res['now']['verdict']:10} score {res['now']['score']:6.1f}  | backtest strat {bt['strategy']['total'] * 100:8.0f}% "
            f"(DD {bt['strategy']['maxdd'] * 100:.0f}%)  B&H {bt['buy_hold']['total'] * 100:8.0f}% (DD {bt['buy_hold']['maxdd'] * 100:.0f}%)")
    rob = []
    for sym, res in done.items():
        bt, ed = res["backtest"], res["edge"]
        rob.append({"symbol": sym, "verdict": res["now"]["verdict"], "score": res["now"]["score"], "start": bt["start"],
                    "strat": bt["strategy"]["total"], "bh": bt["buy_hold"]["total"], "dd_strat": bt["strategy"]["maxdd"], "dd_bh": bt["buy_hold"]["maxdd"],
                    "rpv_strat": bt["strategy"]["ret_per_vol"], "rpv_bh": bt["buy_hold"]["ret_per_vol"], "exposure": bt["strategy"]["avg_exposure"],
                    "spread63": ed["f63"]["spread"], "bull63": ed["f63"]["bull"]["avg"], "bear63": ed["f63"]["bear"]["avg"],
                    "trend200_rpv": bt["baselines"]["trend200"]["ret_per_vol"], "trend200_dd": bt["baselines"]["trend200"]["maxdd"]})
    summary = {"tickers": rob, "n": len(rob),
               "spread_positive": sum(1 for r in rob if (r["spread63"] or 0) > 0),
               "dd_better": sum(1 for r in rob if r["dd_strat"] > r["dd_bh"]),
               "rpv_better": sum(1 for r in rob if (r["rpv_strat"] or -9) > (r["rpv_bh"] or -9)),
               "return_better": sum(1 for r in rob if r["strat"] > r["bh"]),
               "t200_rpv_better": sum(1 for r in rob if (r["trend200_rpv"] or -9) > (r["rpv_bh"] or -9)),
               "t200_dd_better": sum(1 for r in rob if r["trend200_dd"] > r["dd_bh"])}
    db.save_analytics(conn, "ALL", "signals_robust", summary)
    log(f"  robustness: bullish>bearish 63d in {summary['spread_positive']}/{summary['n']}; lower drawdown {summary['dd_better']}/{summary['n']}; "
        f"better ret/vol {summary['rpv_better']}/{summary['n']}; higher return {summary['return_better']}/{summary['n']}")
    db.set_meta(conn, "signals_updated", dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M:%S"))
    return f"{len(done)} symbols"
