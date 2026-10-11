"""Daily options-chain snapshot (Yahoo, free) -> options_chain / options_expiry / options_summary / option_watch.

Per snapshot we compute (own Black-Scholes on bid/ask mid, Yahoo IV only as fallback):
IV, delta, gamma per contract; ATM IV, 25-delta skew, max pain and 1-sigma move per expiry; a constant-30-day IV;
dealer-style gamma exposure (calls +, puts -) per strike, the gamma-flip level and call/put walls.
"""
import datetime as dt
import math

import bsm
import db
from config import CFG, OPTIONS_STRIKE_BAND, OPTIONS_TICKERS
from db import log
from indicators import us_et_offset_hours
from yahoo import Yahoo


def et_date(ts):
    u = dt.datetime.fromtimestamp(ts, dt.timezone.utc).replace(tzinfo=None)
    return (u + dt.timedelta(hours=us_et_offset_hours(u))).date()


def contract_symbol(sym, typ, strike, expiry):
    return f"{sym}{expiry.strftime('%y%m%d')}{typ}{int(round(strike * 1000)):08d}"


def mid_price(c):
    bid, ask, last = c.get("bid") or 0.0, c.get("ask") or 0.0, c.get("lastPrice") or 0.0
    if bid > 0 and ask > 0 and ask >= bid and (ask - bid) <= max(0.35 * (ask + bid) / 2, 0.15):
        return (bid + ask) / 2.0
    if bid > 0 and ask > 0 and ask >= bid:
        return (bid + ask) / 2.0
    if last > 0 and (c.get("volume") or 0) > 0:
        return last
    return None


def interp(xs, ys, x):
    """Linear interpolation on sorted xs; None outside the sampled range (no extrapolation)."""
    if len(xs) < 2 or x < xs[0] or x > xs[-1]:
        return None
    for i in range(1, len(xs)):
        if x <= xs[i]:
            x0, x1 = xs[i - 1], xs[i]
            return ys[i - 1] if x1 == x0 else ys[i - 1] + (ys[i] - ys[i - 1]) * (x - x0) / (x1 - x0)
    return None


def atm_iv(rows, spot):
    """ATM IV for one expiry: average of call/put IV at the two strikes bracketing spot, interpolated on strike."""
    by = {}
    for r in rows:
        if r["iv"]:
            by.setdefault(r["strike"], []).append(r["iv"])
    ks = sorted(by)
    if len(ks) < 2:
        return None
    avg = {k: sum(v) / len(v) for k, v in by.items()}
    below = [k for k in ks if k <= spot]
    above = [k for k in ks if k >= spot]
    if not below or not above:
        return avg[min(ks, key=lambda k: abs(k - spot))]
    k0, k1 = below[-1], above[0]
    if k0 == k1:
        return avg[k0]
    return avg[k0] + (avg[k1] - avg[k0]) * (spot - k0) / (k1 - k0)


def skew25(rows):
    puts = sorted([(r["delta"], r["iv"]) for r in rows if r["type"] == "P" and r["iv"] and r["delta"] is not None and -0.55 < r["delta"] < -0.04])
    calls = sorted([(r["delta"], r["iv"]) for r in rows if r["type"] == "C" and r["iv"] and r["delta"] is not None and 0.04 < r["delta"] < 0.55])
    if len(puts) < 2 or len(calls) < 2:
        return None
    ip = interp([p[0] for p in puts], [p[1] for p in puts], -0.25)
    ic = interp([c[0] for c in calls], [c[1] for c in calls], 0.25)
    return None if ip is None or ic is None else ip - ic


def max_pain(rows):
    ks = sorted({r["strike"] for r in rows})
    if not ks:
        return None
    best, bk = None, None
    for k in ks:
        tot = 0.0
        for r in rows:
            oi = r["oi"] or 0
            if r["type"] == "C" and k > r["strike"]:
                tot += oi * (k - r["strike"])
            elif r["type"] == "P" and k < r["strike"]:
                tot += oi * (r["strike"] - k)
        if best is None or tot < best:
            best, bk = tot, k
    return bk


def gex_at(S, contracts, r):
    tot = 0.0
    for c in contracts:
        g = bsm.gamma(S, c["strike"], c["T"], r, c["iv"])
        tot += (1 if c["type"] == "C" else -1) * g * c["oi"] * 100.0 * S * S * 0.01
    return tot


def gamma_flip(spot, contracts, r):
    """Price where aggregate dealer gamma changes sign (nearest crossing to spot) + the full GEX-vs-price curve.
    Returns (flip|None, grid, vals)."""
    if not contracts:
        return None, [], []
    grid = [spot * (0.65 + 0.01 * i) for i in range(71)]
    vals = [gex_at(s, contracts, r) for s in grid]
    best = None
    for i in range(1, len(grid)):
        if vals[i - 1] == 0 or (vals[i - 1] < 0) != (vals[i] < 0):
            x = grid[i - 1] + (grid[i] - grid[i - 1]) * (0 - vals[i - 1]) / ((vals[i] - vals[i - 1]) or 1e-12)
            if best is None or abs(x - spot) < abs(best - spot):
                best = x
    return best, grid, vals


def process_symbol(conn, y, sym, rate):
    first = y.options(sym)
    quote = first.get("quote", {})
    spot = quote.get("regularMarketPrice")
    mt = quote.get("regularMarketTime")
    exps = first.get("expirationDates") or []
    if not spot or not exps:
        return None
    snap = et_date(mt) if mt else dt.date.today()
    lo_k, hi_k = spot * OPTIONS_STRIKE_BAND[0], spot * OPTIONS_STRIKE_BAND[1]
    contracts, expiry_blocks = [], {}
    for ets in exps:
        try:
            res = first if ets == first["options"][0]["expirationDate"] else y.options(sym, ets)
        except Exception as e:
            log(f"    ! {sym} {ets}: {str(e)[:70]}")
            continue
        opts = res["options"][0]
        expiry = dt.datetime.fromtimestamp(opts["expirationDate"], dt.timezone.utc).date()
        dte = (expiry - snap).days
        if dte < 0:
            continue
        T = max(dte, 0.25) / 365.0
        rows = []
        for typ, lst in (("C", opts.get("calls", [])), ("P", opts.get("puts", []))):
            for c in lst:
                k = float(c["strike"])
                if k < lo_k or k > hi_k:
                    continue
                oi, vol = c.get("openInterest") or 0, c.get("volume") or 0
                px = mid_price(c)
                if oi == 0 and vol == 0 and px is None:
                    continue
                iv = bsm.implied_vol(px, spot, k, T, rate, typ) if px else None
                yiv = c.get("impliedVolatility")
                if iv is None and yiv and 0.05 < yiv < 5.0 and (c.get("bid") or 0) > 0:
                    iv = float(yiv)
                dlt = gam = None
                if iv:
                    dlt = bsm.delta(spot, k, T, rate, iv, typ)
                    gam = bsm.gamma(spot, k, T, rate, iv)
                rows.append({"type": typ, "strike": k, "contract": c["contractSymbol"], "last": c.get("lastPrice"), "bid": c.get("bid"),
                             "ask": c.get("ask"), "volume": vol, "oi": oi, "iv": iv, "delta": dlt, "gamma": gam, "px": px,
                             "T": T, "expiry": expiry, "dte": dte})
        if rows:
            expiry_blocks[expiry] = rows
            contracts += rows
    if not contracts:
        return None

    # ---- per-expiry summaries
    exp_rows, term = [], []
    for expiry, rows in sorted(expiry_blocks.items()):
        dte = rows[0]["dte"]
        otm = [r for r in rows if (r["type"] == "P" and r["strike"] <= spot) or (r["type"] == "C" and r["strike"] >= spot)]
        a_iv = atm_iv(otm if len(otm) > 6 else rows, spot)
        gex = sum((1 if r["type"] == "C" else -1) * (r["gamma"] or 0) * r["oi"] * 100 * spot * spot * 0.01 for r in rows if r["iv"])
        exp_rows.append({
            "expiry": expiry, "dte": dte,
            "call_oi": sum(r["oi"] for r in rows if r["type"] == "C"), "put_oi": sum(r["oi"] for r in rows if r["type"] == "P"),
            "call_vol": sum(r["volume"] for r in rows if r["type"] == "C"), "put_vol": sum(r["volume"] for r in rows if r["type"] == "P"),
            "atm_iv": a_iv, "max_pain": max_pain(rows), "skew": skew25(otm if len(otm) > 6 else rows),
            "exp_move": (spot * a_iv * math.sqrt(max(dte, 0.25) / 365.0) / spot * 100.0) if a_iv else None, "gex": gex})

    # ---- constant-maturity IV30 + skew30 (variance-linear interpolation between bracketing expiries)
    usable = [e for e in exp_rows if e["atm_iv"] and e["dte"] >= 3]
    iv30 = skew30 = None
    if usable:
        ts = [e["dte"] / 365.0 for e in usable]
        w = [e["atm_iv"] ** 2 * t for e, t in zip(usable, ts)]
        t30 = 30.0 / 365.0
        if t30 <= ts[0]:
            iv30 = usable[0]["atm_iv"]
        elif t30 >= ts[-1]:
            iv30 = usable[-1]["atm_iv"]
        else:
            iv30 = math.sqrt(interp(ts, w, t30) / t30)
        sk = [(e["dte"] / 365.0, e["skew"]) for e in usable if e["skew"] is not None]
        if len(sk) >= 2 and sk[0][0] <= t30 <= sk[-1][0]:
            skew30 = interp([s[0] for s in sk], [s[1] for s in sk], t30)
        elif sk:
            skew30 = min(sk, key=lambda s: abs(s[0] - t30))[1]
    front = next((e for e in exp_rows if e["atm_iv"] and e["dte"] >= 1), None)

    # ---- gamma exposure
    gc = [r for r in contracts if r["iv"] and r["oi"] > 0 and r["T"] > 0.5 / 365 and 0.45 * spot < r["strike"] < 1.9 * spot]
    net_gex = sum((1 if r["type"] == "C" else -1) * r["gamma"] * r["oi"] * 100 * spot * spot * 0.01 for r in contracts if r["iv"] and r["oi"])
    flip, curve_x, curve_y = gamma_flip(spot, gc, rate)
    by_k = {}
    for r in contracts:
        if r["iv"] and r["oi"]:
            g = r["gamma"] * r["oi"] * 100 * spot * spot * 0.01
            d = by_k.setdefault(r["strike"], [0.0, 0.0])
            d[0 if r["type"] == "C" else 1] += g
    call_wall = max(by_k, key=lambda k: by_k[k][0]) if by_k else None
    put_wall = max(by_k, key=lambda k: by_k[k][1]) if by_k else None

    # ---- persist
    db.query(conn, "DELETE FROM options_chain WHERE snapshot_date=%s AND symbol=%s", (snap, sym))
    chain_rows = [(snap, sym, r["expiry"], r["type"], r["strike"], r["contract"], r["last"], r["bid"], r["ask"], r["volume"], r["oi"],
                   round(r["iv"], 5) if r["iv"] else None, round(r["delta"], 6) if r["delta"] is not None else None,
                   round(r["gamma"], 8) if r["gamma"] is not None else None) for r in contracts]
    db.upsert(conn, "options_chain", ["snapshot_date", "symbol", "expiry", "opt_type", "strike", "contract", "last", "bid", "ask",
                                      "volume", "oi", "iv", "delta", "gamma"], chain_rows)
    db.upsert(conn, "options_expiry", ["snapshot_date", "symbol", "expiry", "dte", "call_oi", "put_oi", "call_vol", "put_vol",
                                       "atm_iv", "max_pain", "exp_move_pct", "skew25", "net_gex"],
              [(snap, sym, e["expiry"], e["dte"], e["call_oi"], e["put_oi"], e["call_vol"], e["put_vol"],
                round(e["atm_iv"], 5) if e["atm_iv"] else None, e["max_pain"], round(e["exp_move"], 4) if e["exp_move"] else None,
                round(e["skew"], 5) if e["skew"] is not None else None, round(e["gex"], 2)) for e in exp_rows])
    db.upsert(conn, "options_summary", ["snapshot_date", "symbol", "spot", "iv30", "iv_front", "skew25", "call_oi", "put_oi", "call_vol",
                                        "put_vol", "net_gex", "gamma_flip", "call_wall", "put_wall", "rate"],
              [(snap, sym, spot, round(iv30, 5) if iv30 else None, round(front["atm_iv"], 5) if front else None,
                round(skew30, 5) if skew30 is not None else None,
                sum(e["call_oi"] for e in exp_rows), sum(e["put_oi"] for e in exp_rows),
                sum(e["call_vol"] for e in exp_rows), sum(e["put_vol"] for e in exp_rows), round(net_gex, 2),
                round(flip, 4) if flip else None, call_wall, put_wall, rate)])
    db.save_analytics(conn, sym, "gex_curve", {"date": snap.isoformat(), "spot": spot, "flip": flip,
                                               "x": [round(v, 2) for v in curve_x], "y": [round(v) for v in curve_y]})
    # ---- watched contract
    w = CFG["watch_contract"]
    if w["symbol"] == sym:
        cs = contract_symbol(sym, w["type"], w["strike"], dt.date.fromisoformat(w["expiry"]))
        hit = next((r for r in contracts if r["contract"] == cs), None)
        if hit:
            db.upsert(conn, "option_watch", ["contract", "d", "underlying", "price", "bid", "ask", "iv", "delta", "volume", "oi", "source"],
                      [(cs, snap, spot, round(hit["px"], 4) if hit["px"] else hit["last"], hit["bid"], hit["ask"],
                        round(hit["iv"], 5) if hit["iv"] else None, round(hit["delta"], 6) if hit["delta"] is not None else None,
                        hit["volume"], hit["oi"], "snapshot")])
    return {"snap": snap, "n": len(contracts), "exp": len(exp_rows), "iv30": iv30, "flip": flip, "spot": spot}


def run(conn):
    y = Yahoo(pause=0.2)
    out = []
    for sym in OPTIONS_TICKERS:
        r = db.one(conn, "SELECT close FROM prices_daily WHERE symbol='^IRX' ORDER BY d DESC LIMIT 1")
        rate = float(r["close"]) / 100.0 if r else 0.04
        try:
            res = process_symbol(conn, y, sym, rate)
        except Exception as e:
            log(f"  ! {sym} options failed: {str(e)[:120]}")
            continue
        if res:
            log(f"  {sym:5} {res['snap']}  contracts={res['n']:5} expiries={res['exp']:2} IV30={res['iv30'] and round(res['iv30'] * 100, 1)}% flip={res['flip'] and round(res['flip'], 1)}")
            out.append(sym)
        else:
            log(f"  {sym:5} no options data")
    db.query(conn, "DELETE FROM options_chain WHERE symbol<>'MSTR' AND snapshot_date < DATE_SUB(CURDATE(), INTERVAL 60 DAY)")
    last = db.one(conn, "SELECT MAX(snapshot_date) d FROM options_summary WHERE symbol='MSTR'")
    if last and last["d"]:
        db.set_meta(conn, "options_snapshot", last["d"].isoformat())
    return f"{len(out)} tickers"
