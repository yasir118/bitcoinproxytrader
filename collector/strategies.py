"""Options strategy screener  ->  analytics['strategies'] per ticker.

It does NOT predict anything.  It builds concrete, defined-risk candidate trades from the real bid/ask quotes of the latest
chain snapshot, prices them exactly, and ranks them with a transparent score so the "why" is always visible.

Per candidate we compute (all per share unless marked):  net debit/credit at mid and at the "natural" (worst-case) prices,
exact max profit / max loss / break-evens (payoff is piecewise-linear), probability of profit under (a) the market's own
implied vol and (b) the blended realised vol, the model edge ("EV at realised vol": what the position is worth at realised
vol minus what you pay), net delta / theta / vega.

Score (0-100) = regime fit (<=20) + volatility fit (<=25) + model edge (<=30) + probability (<=10) + levels (<=10)
                - liquidity penalty (<=20) - event penalty (<=8)
Regime fit is deliberately capped at 20: the Signals tab shows the regime read has no demonstrated predictive edge.

Rules: only defined-risk structures (no naked short calls/puts).  Short puts are shown as cash-secured, short calls only
as covered calls / spreads.  Quotes are the last close; live prices will differ.
"""
import datetime as dt
import json
import math

import bsm
import db
from config import OPTIONS_TICKERS
from db import log

BUCKETS = [("weekly", "Weekly", 3, 16, 2, None), ("monthly", "1–2 months", 25, 75, 2, None), ("long", "Long-term (6 mo+)", 170, 800, 3, [260, 380, 540])]
PARAMS = {
    "weekly": {"long_call": [0.50, 0.30], "long_put": [0.50, 0.30], "bull_call": [(0.55, 0.30), (0.50, 0.25)], "bear_put": [(0.55, 0.30), (0.50, 0.25)],
               "credit": [0.25, 0.18], "width": 0.05, "condor": [0.18], "csp": [0.25, 0.18], "cc": [0.30, 0.20], "prot": [0.30, 0.20], "collar": [(0.25, 0.25)]},
    "monthly": {"long_call": [0.55, 0.35], "long_put": [0.55, 0.35], "bull_call": [(0.60, 0.30), (0.55, 0.25)], "bear_put": [(0.60, 0.30), (0.55, 0.25)],
                "credit": [0.25, 0.18], "width": 0.08, "condor": [0.18, 0.14], "csp": [0.25, 0.18], "cc": [0.30, 0.20], "prot": [0.30, 0.20], "collar": [(0.25, 0.25), (0.30, 0.20)]},
    "long": {"long_call": [0.80, 0.65], "long_put": [0.40, 0.30], "bull_call": [(0.75, 0.40), (0.80, 0.35)], "bear_put": [(0.55, 0.30)],
             "credit": [0.25, 0.20], "width": 0.15, "condor": [0.15], "csp": [0.30, 0.20], "cc": [0.30, 0.20], "prot": [0.30, 0.20], "collar": [(0.25, 0.25), (0.20, 0.30)]},
}
SQRT2 = math.sqrt(2.0)


def f(x):
    return None if x is None else float(x)


def ncdf(x):
    return 0.5 * (1.0 + math.erf(x / SQRT2))


# ----------------------------------------------------------------------------- chain access
def load_chain(conn, sym, snap):
    rows = db.query(conn, "SELECT expiry, opt_type, strike, last, bid, ask, volume, oi, iv, delta, contract FROM options_chain WHERE symbol=%s AND snapshot_date=%s", (sym, snap))
    chain = {}
    for r in rows:
        bid, ask, iv, dl = f(r["bid"]), f(r["ask"]), f(r["iv"]), f(r["delta"])
        if not (bid and ask and ask >= bid and iv and dl is not None):
            continue
        mid = (bid + ask) / 2.0
        c = {"expiry": r["expiry"], "type": r["opt_type"], "strike": f(r["strike"]), "bid": bid, "ask": ask, "mid": mid, "iv": iv, "delta": dl,
             "oi": int(r["oi"] or 0), "volume": int(r["volume"] or 0), "contract": r["contract"], "spread_pct": (ask - bid) / mid}
        chain.setdefault(r["expiry"], {"C": {}, "P": {}})[r["opt_type"]][c["strike"]] = c
    return chain


def valid(c, strict=False):
    if c["mid"] < 0.10 or c["oi"] < 10:
        return False
    return c["spread_pct"] <= (0.20 if strict else 0.32) or (c["ask"] - c["bid"]) <= 0.10


def pick(side, target, lo_k=None, hi_k=None):
    """Valid contract whose |delta| is closest to target, optionally restricted to strikes strictly inside (lo_k, hi_k)."""
    best = None
    for k, c in side.items():
        if not valid(c) or (lo_k is not None and k <= lo_k) or (hi_k is not None and k >= hi_k):
            continue
        d = abs(abs(c["delta"]) - target)
        if best is None or d < best[0]:
            best = (d, c)
    return best[1] if best else None


def pick_near(side, target_strike, lo_k=None, hi_k=None):
    best = None
    for k, c in side.items():
        if not valid(c) or (lo_k is not None and k <= lo_k) or (hi_k is not None and k >= hi_k):
            continue
        d = abs(k - target_strike)
        if best is None or d < best[0]:
            best = (d, c)
    return best[1] if best else None


def leg(c, side, typ=None):
    if c is None:
        return None
    return {"side": side, "type": typ or c["type"], "strike": c["strike"], "expiry": c["expiry"].isoformat(), "bid": c["bid"], "ask": c["ask"], "mid": c["mid"], "iv": c["iv"],
            "delta": c["delta"], "oi": c["oi"], "volume": c["volume"], "spread_pct": c["spread_pct"], "contract": c["contract"]}


# ----------------------------------------------------------------------------- candidates
def candidates(bk, ex, dte, cc, pp, spot):
    P = PARAMS[bk]
    out = []

    def add(name, group, bias, vega, kind, legs, variant=""):
        if any(l is None for l in legs):
            return
        out.append({"name": name, "variant": variant, "group": group, "bias": bias, "vega": vega, "kind": kind, "legs": legs, "expiry": ex.isoformat(), "dte": dte})

    for d in P["long_call"]:
        add("Long call", "Directional", "bull", "long", "long", [leg(pick(cc, d), +1)], f"~{int(d * 100)}Δ")
    for d in P["long_put"]:
        add("Long put", "Directional", "bear", "long", "long", [leg(pick(pp, d), +1)], f"~{int(d * 100)}Δ")
    for dl, ds in P["bull_call"]:
        a = pick(cc, dl)
        b = pick(cc, ds, lo_k=a["strike"]) if a else None
        add("Bull call spread", "Directional", "bull", "mixed", "debit", [leg(a, +1), leg(b, -1)], f"{int(dl * 100)}Δ / {int(ds * 100)}Δ")
    for dl, ds in P["bear_put"]:
        a = pick(pp, dl)
        b = pick(pp, ds, hi_k=a["strike"]) if a else None
        add("Bear put spread", "Directional", "bear", "mixed", "debit", [leg(a, +1), leg(b, -1)], f"{int(dl * 100)}Δ / {int(ds * 100)}Δ")
    width = P["width"] * spot
    for d in P["credit"]:
        s = pick(pp, d, hi_k=spot)
        w = pick_near(pp, s["strike"] - width, hi_k=s["strike"]) if s else None
        add("Bull put spread (credit)", "Income", "bull", "short", "credit", [leg(s, -1), leg(w, +1)], f"short ~{int(d * 100)}Δ")
        s2 = pick(cc, d, lo_k=spot)
        w2 = pick_near(cc, s2["strike"] + width, lo_k=s2["strike"]) if s2 else None
        add("Bear call spread (credit)", "Income", "bear", "short", "credit", [leg(s2, -1), leg(w2, +1)], f"short ~{int(d * 100)}Δ")
    for d in P["condor"]:
        sp = pick(pp, d, hi_k=spot)
        wp = pick_near(pp, sp["strike"] - width, hi_k=sp["strike"]) if sp else None
        sc = pick(cc, d, lo_k=spot)
        wc = pick_near(cc, sc["strike"] + width, lo_k=sc["strike"]) if sc else None
        add("Iron condor", "Neutral", "neutral", "short", "credit", [leg(sp, -1), leg(wp, +1), leg(sc, -1), leg(wc, +1)], f"short ~{int(d * 100)}Δ both sides")
    for d in P["csp"]:
        add("Cash-secured put", "Income", "bull", "short", "collateral", [leg(pick(pp, d, hi_k=spot), -1)], f"~{int(d * 100)}Δ")
    # shares-owner strategies
    stock = {"side": 1, "type": "STOCK", "strike": spot, "expiry": ex.isoformat(), "mid": spot, "bid": spot, "ask": spot, "iv": None, "delta": 1.0, "oi": 0, "volume": 0, "spread_pct": 0, "contract": "100 shares"}
    for d in P["cc"]:
        add("Covered call", "Holder", "neutral", "short", "holder", [dict(stock), leg(pick(cc, d, lo_k=spot), -1)], f"~{int(d * 100)}Δ")
    for d in P["prot"]:
        add("Protective put", "Holder", "hedge", "long", "holder", [dict(stock), leg(pick(pp, d, hi_k=spot), +1)], f"~{int(d * 100)}Δ")
    for dp, dc in P["collar"]:
        add("Collar", "Holder", "hedge", "mixed", "holder", [dict(stock), leg(pick(pp, dp, hi_k=spot), +1), leg(pick(cc, dc, lo_k=spot), -1)], f"put {int(dp * 100)}Δ / call {int(dc * 100)}Δ")
    return out


# ----------------------------------------------------------------------------- pricing / risk
def payoff(S, legs):
    tot = 0.0
    for l in legs:
        if l["type"] == "STOCK":
            continue
        k = l["strike"]
        tot += l["side"] * (max(S - k, 0.0) if l["type"] == "C" else max(k - S, 0.0))
    return tot


def evaluate(c, spot, r, sig_imp, sig_rv):
    sig_fc = 0.5 * (sig_imp + sig_rv)                      # forecast vol: halfway between what the market prices and what the stock has done
    legs = c["legs"]
    opt = [l for l in legs if l["type"] != "STOCK"]
    shares = sum(l["side"] for l in legs if l["type"] == "STOCK")
    T = max(c["dte"], 0.5) / 365.0
    cost_mid = sum(l["side"] * l["mid"] for l in opt)
    cost_nat = sum(l["side"] * (l["ask"] if l["side"] > 0 else l["bid"]) for l in opt)
    net_up = sum(l["side"] for l in opt if l["type"] == "C") + shares        # slope of P&L as price -> infinity
    if net_up < 0:
        return None                                                          # naked short call: not allowed
    ks = sorted({l["strike"] for l in opt})
    pts = [0.0] + ks + [max(ks) * 6.0 + spot * 3.0]
    pnl_pts = [payoff(S, legs) - cost_mid + shares * (S - spot) for S in pts]
    max_loss = -min(pnl_pts)
    max_profit = None if net_up > 0 else max(pnl_pts)
    bes = []
    for i in range(1, len(pts)):
        a, b = pnl_pts[i - 1], pnl_pts[i]
        if a == 0:
            bes.append(pts[i - 1])
        elif (a < 0 < b) or (a > 0 > b):
            bes.append(pts[i - 1] + (pts[i] - pts[i - 1]) * (0 - a) / (b - a))
    bes = sorted({round(x, 2) for x in bes if x > 0})
    # probabilities on a log grid that also contains every strike
    n = 420
    lo, hi = spot * 0.04, spot * 5.0
    xs = sorted(set([lo * (hi / lo) ** (i / (n - 1)) for i in range(n)] + ks))
    opt_pnl = [payoff(S, legs) - cost_mid for S in xs]
    tot_pnl = [p + shares * (S - spot) for p, S in zip(opt_pnl, xs)]

    def dist(sig):
        sd = max(sig, 0.05) * math.sqrt(T)
        mu = math.log(spot) + (r - 0.5 * max(sig, 0.05) ** 2) * T
        edges = [-1e9] + [0.5 * (math.log(xs[i]) + math.log(xs[i + 1])) for i in range(len(xs) - 1)] + [1e9]
        cdf = [0.0 if e <= -1e9 else (1.0 if e >= 1e9 else ncdf((e - mu) / sd)) for e in edges]
        return [cdf[i + 1] - cdf[i] for i in range(len(xs))]
    w_i, w_r, w_f = dist(sig_imp), dist(sig_rv), dist(sig_fc)
    pop_i = sum(w for w, p in zip(w_i, tot_pnl) if p > 0)
    pop_r = sum(w for w, p in zip(w_r, tot_pnl) if p > 0)
    ev_r = sum(w * p for w, p in zip(w_f, opt_pnl))            # option legs only (stock drift is not an "edge")
    ev_i = sum(w * p for w, p in zip(w_i, opt_pnl))
    # greeks per share
    dl = th = vg = 0.0
    for l in legs:
        if l["type"] == "STOCK":
            dl += l["side"]
            continue
        Tl = max((dt.date.fromisoformat(l["expiry"]) - dt.date.fromisoformat(c["asof"])).days, 0.5) / 365.0
        dl += l["side"] * l["delta"]
        th += l["side"] * bsm.theta(spot, l["strike"], Tl, r, l["iv"], l["type"])
        vg += l["side"] * bsm.vega(spot, l["strike"], Tl, r, l["iv"])
    gross_vega = sum(abs(bsm.vega(spot, l["strike"], max(c["dte"], 0.5) / 365.0, r, l["iv"])) for l in opt) or 1e-9
    c.update({"cost_mid": cost_mid, "cost_nat": cost_nat, "max_profit": max_profit, "max_loss": max_loss, "breakevens": bes, "pop_imp": pop_i, "pop_rv": pop_r,
              "ev_fc": ev_r, "ev_imp": ev_i, "sig_imp": sig_imp, "sig_fc": sig_fc, "net_delta": dl, "net_theta": th, "net_vega": vg, "vega_frac": min(1.0, abs(vg) / gross_vega),
              "sigma_move": spot * sig_imp * math.sqrt(T), "shares": shares})
    return c


def clip(x, a, b):
    return max(a, min(b, x))


def score(c, ctx):
    bias, ratio = ctx["bias"], ctx["iv_rv"]
    comp, why, flags = {}, [], []
    cb = c["bias"]
    if cb == "hedge":
        fit = 0.5 + (0.25 if bias == "bear" else 0.0)
    elif cb == bias:
        fit = 1.0
    elif cb == "neutral" or bias == "neutral":
        fit = 0.5
    else:
        fit = 0.0
    comp["regime"] = round(20 * fit, 1)
    why.append(f"Regime read is {ctx['verdict']} ({ctx['score']:+.0f}) → {'fits' if fit >= 0.99 else 'partly fits' if fit > 0 else 'works against'} this {cb if cb != 'hedge' else 'hedging'} structure (weight capped at 20 — the regime read has a weak track record).")
    cheap = clip((1.05 - ratio) / 0.40, 0, 1)
    rich = clip((ratio - 0.95) / 0.40, 0, 1)
    edge_dir = cheap - rich
    sign = 1 if c["net_vega"] > 0 else -1
    vp = 12.5 + 12.5 * c["vega_frac"] * sign * edge_dir
    comp["vol"] = round(vp, 1)
    why.append(f"IV30 ÷ realised vol = {ratio:.2f} → options look {'cheap' if ratio < 0.92 else 'rich' if ratio > 1.08 else 'fairly priced'} vs how the stock has actually moved; "
               f"this structure is net {'long' if sign > 0 else 'short'} volatility ({'helps' if sign * edge_dir > 0.05 else 'hurts' if sign * edge_dir < -0.05 else 'neutral'}).")
    capital = c["max_loss"] if c["max_loss"] and c["max_loss"] > 0 else 1e-9
    evr = c["ev_fc"] / capital if c["kind"] != "holder" else c["ev_fc"] / ctx["spot"] * 4
    comp["edge"] = round(30 * clip((evr + 0.05) / 0.30, 0, 1), 1)
    why.append(f"Model edge: if volatility ends up halfway between the market's {c['sig_imp'] * 100:.0f}% and the stock's recent realised {ctx['sig_rv'] * 100:.0f}% (= {c['sig_fc'] * 100:.0f}%), "
               f"the expected profit of this trade is {'+' if c['ev_fc'] >= 0 else '−'}${abs(c['ev_fc']) * 100:,.0f} per contract ({evr * 100:+.0f}% of {'max risk' if c['kind'] != 'holder' else 'the premium base'}), assuming zero price drift.")
    comp["prob"] = round(10 * clip((c["pop_imp"] - 0.35) / 0.45, 0, 1), 1)
    why.append(f"Probability of profit {c['pop_imp'] * 100:.0f}% on market-implied vol, {c['pop_rv'] * 100:.0f}% at realised vol.")
    lv = 0.0
    shorts = [l for l in c["legs"] if l["type"] != "STOCK" and l["side"] < 0]
    sm = c["sigma_move"]
    if shorts and sm > 0:
        out1 = all((l["strike"] >= ctx["spot"] + sm) if l["type"] == "C" else (l["strike"] <= ctx["spot"] - sm) for l in shorts)
        out07 = all((l["strike"] >= ctx["spot"] + 0.7 * sm) if l["type"] == "C" else (l["strike"] <= ctx["spot"] - 0.7 * sm) for l in shorts)
        lv += 5 if out1 else 3 if out07 else 0
        if out1:
            why.append(f"Short strike(s) sit outside the ±1σ expected move (±${sm:,.2f} to expiry).")
    if ctx["gex"] == "dampening" and c["net_vega"] < 0:
        lv += 5
        why.append("Spot is above the gamma flip: dealer hedging tends to dampen moves, which suits selling premium.")
    elif ctx["gex"] == "amplifying" and c["net_vega"] > 0:
        lv += 5
        why.append("Spot is below the gamma flip: dealer hedging tends to amplify moves, which suits owning premium.")
    comp["levels"] = round(lv, 1)
    opt = [l for l in c["legs"] if l["type"] != "STOCK"]
    worst = max(l["spread_pct"] for l in opt)
    min_oi = min(l["oi"] for l in opt)
    pen = 20 * clip((worst - 0.06) / 0.26, 0, 1) * 0.75 + (5 if min_oi < 100 else 0)
    comp["liquidity"] = -round(pen, 1)
    if worst > 0.15:
        flags.append(f"Wide bid/ask on at least one leg ({worst * 100:.0f}% of mid) — expect to pay more than the mid price.")
    if min_oi < 100:
        flags.append(f"Thin open interest on one leg ({min_oi}).")
    ev_pen = 0.0
    if ctx["earn"] and ctx["earn"] <= dt.date.fromisoformat(c["expiry"]):
        ev_pen = (2 if c["dte"] > 150 else (5 if c["net_vega"] > 0 else 6))
        flags.append(f"Earnings ({ctx['earn'].isoformat()}) fall before this expiry: expect a gap and an implied-vol drop afterwards.")
    comp["event"] = -ev_pen
    c["score"] = round(clip(sum(comp.values()), 0, 100), 1)
    c["comp"] = comp
    c["why"] = why
    c["flags"] = flags
    if c["kind"] == "collateral":
        flags.append(f"Needs about ${c['legs'][0]['strike'] * 100:,.0f} of cash set aside per contract; you may be assigned 100 shares.")
    if c["kind"] == "holder":
        flags.append("Requires owning 100 shares per contract; a short call caps your upside and can be assigned early." if any(l["side"] < 0 and l["type"] == "C" for l in opt) else "Requires owning 100 shares per contract.")
    if any(l["side"] < 0 for l in opt) and c["kind"] != "holder":
        flags.append("Short options can be assigned early (especially around dividends/expiry) and need margin; spreads are capped at the max loss shown.")
    return c


def round_c(c):
    for l in c["legs"]:
        for k in ("bid", "ask", "mid", "iv", "delta", "spread_pct"):
            if l.get(k) is not None:
                l[k] = round(l[k], 4)
    for k in ("cost_mid", "cost_nat", "max_loss", "ev_fc", "ev_imp", "net_delta", "net_theta", "net_vega", "sigma_move", "sig_imp", "sig_fc"):
        c[k] = round(c[k], 4)
    if c["max_profit"] is not None:
        c["max_profit"] = round(c["max_profit"], 4)
    for k in ("pop_imp", "pop_rv", "vega_frac"):
        c[k] = round(c[k], 4)
    c.pop("asof", None)
    return c


def single_contracts(chain, snap, expiries, spot, r, sig_rv):
    """Contracts that look cheap (buy) or rich (sell) against the blended realised vol."""
    rows = []
    for ex in expiries:
        dte = (ex - snap).days
        T = max(dte, 0.5) / 365.0
        for typ in ("C", "P"):
            for k, c in chain[ex][typ].items():
                if not valid(c, strict=True) or c["oi"] < 100 or not (0.15 <= abs(c["delta"]) <= 0.85):
                    continue
                theo = bsm.price(spot, k, T, r, sig_rv, typ)
                edge = (theo - c["mid"]) / c["mid"]
                rows.append({"expiry": ex.isoformat(), "dte": dte, "type": typ, "strike": k, "bid": c["bid"], "ask": c["ask"], "mid": round(c["mid"], 3), "iv": round(c["iv"], 4),
                             "delta": round(c["delta"], 3), "oi": c["oi"], "volume": c["volume"], "spread_pct": round(c["spread_pct"], 4), "theo_rv": round(theo, 3), "edge": round(edge, 4)})
    cheap = sorted([x for x in rows if x["edge"] > 0.08], key=lambda x: -x["edge"])[:6]
    rich = sorted([x for x in rows if x["edge"] < -0.08], key=lambda x: x["edge"])[:6]
    return cheap, rich


def pick_expiries(chain, snap, lo, hi, n, targets):
    ex = sorted(e for e in chain if lo <= (e - snap).days <= hi and len(chain[e]["C"]) >= 5 and len(chain[e]["P"]) >= 5)
    if targets:
        out = []
        for t in targets:
            if not ex:
                break
            best = min(ex, key=lambda e: abs((e - snap).days - t))
            if best not in out:
                out.append(best)
        return sorted(out)
    return ex[:n]


def build_symbol(conn, sym):
    summ = db.one(conn, "SELECT * FROM options_summary WHERE symbol=%s ORDER BY snapshot_date DESC LIMIT 1", (sym,))
    if not summ:
        return None
    snap = summ["snapshot_date"]
    spot, r = f(summ["spot"]), f(summ["rate"]) or 0.04
    chain = load_chain(conn, sym, snap)
    if len(chain) < 3:
        return None
    exp_rows = {e["expiry"]: e for e in db.query(conn, "SELECT expiry, atm_iv, exp_move_pct FROM options_expiry WHERE symbol=%s AND snapshot_date=%s", (sym, snap))}
    vol = db.one(conn, "SELECT payload FROM analytics WHERE symbol=%s AND k='vol'", (sym,))
    volp = json.loads(vol["payload"]) if vol else {}
    rv20, rv60 = volp.get("rv20"), volp.get("rv60")
    iv30 = f(summ["iv30"]) or 0.6
    sig_rv = (0.5 * rv20 + 0.5 * rv60) if rv20 and rv60 else (rv20 or iv30)
    sg = db.one(conn, "SELECT verdict, score FROM signals_daily WHERE symbol=%s ORDER BY d DESC LIMIT 1", (sym,))
    verdict, sc = (sg["verdict"], float(sg["score"])) if sg else ("HOLD", 0.0)
    bias = "bull" if verdict in ("BUY", "ACCUMULATE") else "bear" if verdict in ("SELL", "REDUCE") else "neutral"
    prof = db.one(conn, "SELECT next_earnings FROM company_profile WHERE symbol=%s", (sym,))
    earn = prof["next_earnings"] if prof and prof["next_earnings"] and prof["next_earnings"] >= snap else None
    flip = f(summ["gamma_flip"])
    gex = "dampening" if (flip and spot > flip and (f(summ["net_gex"]) or 0) > 0) else "amplifying" if flip and spot < flip else "neutral"
    ratio = iv30 / sig_rv if sig_rv else 1.0
    ctx = {"verdict": verdict, "score": sc, "bias": bias, "iv_rv": ratio, "gex": gex, "earn": earn, "spot": spot, "sig_rv": sig_rv}
    out = {"symbol": sym, "snapshot": snap.isoformat(), "spot": spot, "rate": r,
           "context": {"verdict": verdict, "score": sc, "bias": bias, "iv30": iv30, "rv20": rv20, "rv60": rv60, "sigma_rv": sig_rv, "iv_rv": ratio,
                       "vol_view": "cheap" if ratio < 0.92 else "rich" if ratio > 1.08 else "fair", "skew25": f(summ["skew25"]), "net_gex": f(summ["net_gex"]),
                       "gamma_flip": flip, "gex_regime": gex, "call_wall": f(summ["call_wall"]), "put_wall": f(summ["put_wall"]),
                       "earnings": earn.isoformat() if earn else None, "earnings_days": (earn - snap).days if earn else None},
           "buckets": {}}
    for key, label, lo, hi, n, targets in BUCKETS:
        exps = pick_expiries(chain, snap, lo, hi, n, targets)
        cands = []
        for ex in exps:
            dte = (ex - snap).days
            sig_imp = f(exp_rows[ex]["atm_iv"]) if ex in exp_rows and exp_rows[ex]["atm_iv"] else iv30
            for c in candidates(key, ex, dte, chain[ex]["C"], chain[ex]["P"], spot):
                c["asof"] = snap.isoformat()
                if evaluate(c, spot, r, sig_imp, sig_rv):
                    score(c, ctx)
                    cands.append(c)
        def top(sel, n, per_name=2, floor=0):
            seen, got = {}, []
            for c in sorted([c for c in cands if sel(c)], key=lambda c: -c["score"]):
                if seen.get(c["name"], 0) >= per_name or c["score"] < floor:
                    continue
                seen[c["name"]] = seen.get(c["name"], 0) + 1
                got.append(c)
                if len(got) >= n:
                    break
            return got
        buy = top(lambda c: c["kind"] in ("long", "debit"), 4)
        sell = top(lambda c: c["kind"] in ("credit", "collateral"), 4)
        hold = top(lambda c: c["kind"] == "holder", 4)
        best = sorted(buy + sell, key=lambda c: -c["score"])[:1]
        cheap, rich = single_contracts(chain, snap, exps, spot, r, sig_rv)
        out["buckets"][key] = {"label": label, "expiries": [{"expiry": e.isoformat(), "dte": (e - snap).days, "atm_iv": f(exp_rows[e]["atm_iv"]) if e in exp_rows else None,
                                                             "exp_move_pct": f(exp_rows[e]["exp_move_pct"]) if e in exp_rows else None} for e in exps],
                               "buy": [round_c(c) for c in buy], "sell": [round_c(c) for c in sell], "holder": [round_c(c) for c in hold],
                               "best": [c["name"] + "|" + c["expiry"] + "|" + c["variant"] for c in best], "cheap": cheap, "rich": rich, "n_candidates": len(cands)}
    return out


def run(conn):
    n = 0
    for sym in OPTIONS_TICKERS:
        try:
            res = build_symbol(conn, sym)
        except Exception as e:
            log(f"  ! {sym} strategies failed: {str(e)[:120]}")
            continue
        if not res:
            continue
        db.save_analytics(conn, sym, "strategies", res)
        n += 1
        if sym == "MSTR":
            for key, b in res["buckets"].items():
                tb = b["buy"][0] if b["buy"] else None
                ts = b["sell"][0] if b["sell"] else None
                log(f"  MSTR {key:8} cands={b['n_candidates']:3} BUY: {tb['name'] + ' ' + tb['expiry'] + ' ' + str(tb['score']) if tb else '-'} | SELL: {ts['name'] + ' ' + ts['expiry'] + ' ' + str(ts['score']) if ts else '-'}")
    return f"{n} tickers"
