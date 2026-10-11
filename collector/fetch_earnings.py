"""Earnings history: release dates from 8-K item 2.02 (matched to the following 10-Q/10-K), the stock's reaction,
and Yahoo's EPS surprise history -> earnings_events + analytics['earnings'].

Reaction = close-to-close move on the first session that could trade on the news:
  released after the 16:00 ET close  ->  next session close vs release-day close
  released before/while open         ->  release-day close vs previous close
"""
import datetime as dt
from bisect import bisect_left, bisect_right

import db
from config import EQUITY_SYMBOLS
from db import log
from indicators import median, us_et_offset_hours
from yahoo import Yahoo, raw


def et_of(utc):
    return utc + dt.timedelta(hours=us_et_offset_hours(utc))


def release_candidates(filings):
    """filings: rows from sec_filings (newest first). Returns [(release_date, timing, accepted_et)]."""
    k8 = [f for f in filings if f["form"] == "8-K" and "2.02" in (f["items"] or "")]
    periodic = sorted([f["filed"] for f in filings if f["form"] in ("10-Q", "10-K")])
    chosen = {}
    for p in periodic:
        cand = [f for f in k8 if p - dt.timedelta(days=24) <= f["filed"] <= p]
        if cand:
            f = max(cand, key=lambda x: x["filed"])
            chosen[f["accession"]] = f
    latest_p = periodic[-1] if periodic else dt.date(1900, 1, 1)
    for f in k8:                                     # fresh release not yet followed by a 10-Q
        if f["filed"] > latest_p and (dt.date.today() - f["filed"]).days <= 45:
            chosen[f["accession"]] = f
    out = []
    for f in chosen.values():
        acc = f["accepted"]
        if acc:
            e = et_of(acc)
            rd = e.date()
            timing = "amc" if (e.hour, e.minute) >= (16, 0) else "bmo"
        else:
            rd, timing = f["filed"], "amc"
        out.append((rd, timing))
    return sorted(set(out))


def reaction(dates, closes, rd, timing):
    if timing == "amc":
        i0 = bisect_right(dates, rd) - 1              # last session on/before release day
        i1 = bisect_right(dates, rd)                  # first session after it
    else:
        i1 = bisect_left(dates, rd)                   # release-day session (or next if holiday)
        i0 = i1 - 1
    if i0 < 0 or i1 >= len(dates):
        return None, None
    return dates[i1], closes[i1] / closes[i0] - 1.0


def run(conn):
    y = Yahoo(pause=0.35)
    n = 0
    for sym in EQUITY_SYMBOLS:
        if sym == "IBIT":
            continue
        filings = db.query(conn, "SELECT form, filed, accepted, items, accession FROM sec_filings WHERE symbol=%s ORDER BY filed DESC", (sym,))
        px = db.query(conn, "SELECT d, close FROM prices_daily WHERE symbol=%s ORDER BY d", (sym,))
        if not px:
            continue
        dates = [r["d"] for r in px]
        closes = [float(r["close"]) for r in px]
        rows = []
        for rd, timing in release_candidates(filings):
            rdate, mv = reaction(dates, closes, rd, timing)
            if mv is None:
                rows.append((sym, rd, timing, None, None, "sec-8k"))
            else:
                rows.append((sym, rd, timing, rdate, round(mv * 100, 4), "sec-8k"))
        db.upsert(conn, "earnings_events", ["symbol", "report_date", "timing", "react_date", "move_pct", "source"], rows)
        # EPS surprise history from Yahoo (last 4 quarters)
        eps = []
        try:
            q = y.quote_summary(sym, ["earningsHistory"])
            for h in (q.get("earningsHistory") or {}).get("history", []):
                eps.append({"quarter": (h.get("quarter") or {}).get("fmt"), "period": h.get("period"), "actual": raw(h.get("epsActual")),
                            "estimate": raw(h.get("epsEstimate")), "surprise_pct": raw(h.get("surprisePercent"))})
        except Exception:
            pass
        build_analytics(conn, sym, eps)
        n += 1
        log(f"  {sym:6} releases={len(rows)}")
    return f"{n} tickers"


def build_analytics(conn, sym, eps):
    ev = db.query(conn, "SELECT report_date, timing, react_date, move_pct FROM earnings_events WHERE symbol=%s AND move_pct IS NOT NULL "
                        "ORDER BY report_date DESC LIMIT 16", (sym,))
    moves = [float(r["move_pct"]) for r in ev]
    last8 = moves[:8]
    prof = db.one(conn, "SELECT next_earnings, earnings_is_est, earnings_timing FROM company_profile WHERE symbol=%s", (sym,))
    nxt = prof["next_earnings"] if prof else None
    timing = (prof["earnings_timing"] if prof and prof["earnings_timing"] else None)
    if not timing and ev:
        ts = [r["timing"] for r in ev]
        timing = max(set(ts), key=ts.count)
    implied = None
    if nxt:
        r = db.one(conn, "SELECT e.expiry, e.exp_move_pct, e.atm_iv FROM options_expiry e JOIN "
                         "(SELECT MAX(snapshot_date) d FROM options_expiry WHERE symbol=%s) m ON m.d=e.snapshot_date "
                         "WHERE e.symbol=%s AND e.expiry>%s ORDER BY e.expiry LIMIT 1", (sym, sym, nxt))
        if r and r["exp_move_pct"] is not None:
            implied = {"expiry": r["expiry"].isoformat(), "move_pct": float(r["exp_move_pct"]), "atm_iv": float(r["atm_iv"]) if r["atm_iv"] else None}
    out = {
        "next": nxt.isoformat() if nxt else None, "is_estimate": bool(prof["earnings_is_est"]) if prof and prof["earnings_is_est"] is not None else None,
        "timing": timing,
        "events": [{"d": r["report_date"].isoformat(), "timing": r["timing"], "react": r["react_date"].isoformat() if r["react_date"] else None,
                    "move": float(r["move_pct"])} for r in ev],
        "typical_abs": (sum(abs(m) for m in last8) / len(last8)) if last8 else None,
        "median_abs": median([abs(m) for m in last8]) if last8 else None,
        "avg_signed": (sum(last8) / len(last8)) if last8 else None,
        "up_rate": (sum(1 for m in last8 if m > 0) / len(last8)) if last8 else None,
        "max_up": max(moves) if moves else None, "max_down": min(moves) if moves else None,
        "n": len(moves), "implied": implied, "eps": eps,
    }
    db.save_analytics(conn, sym, "earnings", out)
