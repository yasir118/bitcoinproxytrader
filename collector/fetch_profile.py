"""Company profile, shares/market-cap/debt/cash and the NEXT earnings date (Yahoo + Nasdaq)."""
import datetime as dt
import json
import re
import urllib.request

import db
from config import EQUITY_SYMBOLS, TICKERS
from db import log
from yahoo import Yahoo, raw, UA

NAMES = {s: n for s, n, _ in TICKERS}


def nasdaq_earnings(sym):
    """Returns (date, timing) from Nasdaq's free earnings-date text, or (None, None)."""
    try:
        req = urllib.request.Request(f"https://api.nasdaq.com/api/analyst/{sym}/earnings-date",
                                     headers={"User-Agent": UA, "Accept": "application/json"})
        with urllib.request.urlopen(req, timeout=25) as r:
            d = json.loads(r.read())
        txt = ((d.get("data") or {}).get("reportText")) or ""
        m = re.search(r"report earnings on\s+(\d{1,2})/(\d{1,2})/(\d{4})", txt)
        if not m:
            return None, None
        date = dt.date(int(m.group(3)), int(m.group(1)), int(m.group(2)))
        low = txt.lower()
        timing = "amc" if "after market close" in low else ("bmo" if "before market open" in low else None)
        return date, timing
    except Exception:
        return None, None


def run(conn):
    y = Yahoo(pause=0.35)
    n = 0
    for sym in EQUITY_SYMBOLS:
        row = {"name": NAMES.get(sym), "exchange": None, "shares": None, "mcap": None, "debt": None, "cash": None,
               "next": None, "est": None, "timing": None}
        try:
            q = y.quote_summary(sym, ["price", "defaultKeyStatistics", "financialData", "calendarEvents", "summaryDetail"])
            p = q.get("price", {})
            row["name"] = p.get("longName") or p.get("shortName") or row["name"]
            row["exchange"] = p.get("exchangeName")
            row["mcap"] = raw(p.get("marketCap")) or raw(q.get("summaryDetail", {}).get("marketCap"))
            ks = q.get("defaultKeyStatistics", {})
            row["shares"] = raw(ks.get("sharesOutstanding")) or raw(ks.get("impliedSharesOutstanding"))
            fd = q.get("financialData", {})
            row["debt"], row["cash"] = raw(fd.get("totalDebt")), raw(fd.get("totalCash"))
            ce = (q.get("calendarEvents") or {}).get("earnings") or {}
            ed = ce.get("earningsDate") or []
            if ed:
                row["next"] = dt.datetime.fromtimestamp(raw(ed[0]), dt.timezone.utc).date()
                row["est"] = 1 if ce.get("isEarningsDateEstimate") else 0
        except Exception as e:
            log(f"  ! {sym} profile: {str(e)[:90]}")
        nd, nt = nasdaq_earnings(sym)
        if nd and (row["next"] is None or row["est"]):
            row["next"], row["est"] = nd, 0
        row["timing"] = nt
        # drop a stale 'next' date that is already in the past
        if row["next"] and row["next"] < dt.date.today() - dt.timedelta(days=1):
            row["next"] = nd if (nd and nd >= dt.date.today()) else None
        db.upsert(conn, "company_profile",
                  ["symbol", "name", "exchange", "shares_out", "market_cap", "total_debt", "total_cash", "next_earnings",
                   "earnings_is_est", "earnings_timing"],
                  [(sym, row["name"], row["exchange"], row["shares"], row["mcap"], row["debt"], row["cash"], row["next"],
                    row["est"], row["timing"])])
        n += 1
        log(f"  {sym:6} shares={row['shares']} mcap={row['mcap']} next_earn={row['next']} {row['timing'] or ''}")
    return f"{n} profiles"
