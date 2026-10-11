"""Strategy (MSTR) bitcoin treasury: holdings history from 8-Ks, balance-sheet inputs from SEC XBRL / 10-Qs,
and the derived mNAV card (with the source link of every input) -> btc_holdings, treasury_inputs, analytics['treasury'].

mNAV definitions used here
  mNAV (EV)      = (market cap + debt + preferred liquidation preference - cash) / (BTC held x BTC price)
  mNAV (mkt cap) = market cap / (BTC held x BTC price)
Debt, preferred and cash come from the latest 10-Q (quarter-end) so they lag the weekly holdings updates.
"""
import datetime as dt
import re
from bisect import bisect_right

import db
import sec
from db import log

CIK = "0001050446"
D = r"([A-Z][a-z]+ \d{1,2}, \d{4})"
NUM = r"([\d,]+(?:\.\d+)?)"
DASH = r"[—–-]"
TOK_N = rf"(?:\(?[\d,]+\)?|{DASH})"                                           # 1,229  (3,588)  -
TOK_M = rf"(?:\(?\$\s?[\d.,]+(?: (?:million|billion))?\)?|\$\s?{DASH}|{DASH})"      # $108.8  $1.92 billion  $-  -
TOK_P = rf"(?:\$\s?[\d.,]+|\$\s?{DASH}|{DASH})"
H_ACQ = r"BTC Acquired(?: \(\d\))? Aggregate Purchase Price(?: \(in millions\))?(?: \(\d\))? Average Purchase Price(?: \(\d\))?"
H_HOLD = r"Aggregate BTC Holdings Aggregate Purchase Price(?: \(in billions\))?(?: \(\d\))? Average Purchase Price(?: \(\d\))?"


def pdate(s):
    return dt.datetime.strptime(s.replace(",", "").strip(), "%B %d %Y").date()


def money(s, default_mult):
    """'$1.92 billion' -> 1.92e9 ; '$108.8' -> 108.8*default_mult ; '$-' / '-' -> None ; '(3,588)' handled by fnum."""
    if s is None:
        return None
    t = s.strip()
    neg = t.startswith("(")
    t = t.strip("()").replace("$", "").replace(",", "").strip()
    mult = default_mult
    if t.endswith("billion"):
        mult, t = 1e9, t[:-7].strip()
    elif t.endswith("million"):
        mult, t = 1e6, t[:-7].strip()
    if not t or re.fullmatch(DASH, t):
        return None
    v = float(t) * mult
    return -v if neg else v


def fnum(s):
    if s is None:
        return None
    t = s.strip()
    neg = t.startswith("(")
    t = t.strip("()").replace("$", "").replace(",", "").strip()
    if not t or re.fullmatch(DASH, t):
        return None
    return -float(t) if neg else float(t)


R_T2 = re.compile(
    rf"During Period {D} to {D}\*? {H_ACQ} ({TOK_N}) ({TOK_M}) ({TOK_P}) As of {D},? {H_HOLD} ([\d,]+) ({TOK_M}) \$\s?([\d,.]+)")
R_T1 = re.compile(
    rf"During Period {D} to {D} As of {D} {H_ACQ} {H_HOLD} ({TOK_N}) ({TOK_M}) ({TOK_P}) ([\d,]+) ({TOK_M}) \$\s?([\d,.]+)")
R_P1 = re.compile(
    rf"(?:[Aa]s of) {D},? (?:the Company|MicroStrategy|Strategy|we)[^.]{{0,140}}?(?:held|holds|hold|had)(?: an)? (?:aggregate of )?approximately {NUM} bitcoins?"
    rf"[^.]{{0,100}}?aggregate purchase price of (?:approximately )?\$\s?{NUM} (billion|million)(?: and|,) (?:an )?average purchase price of (?:approximately )?\$\s?{NUM}")
R_P2 = re.compile(
    rf"approximately {NUM} bitcoins? held by[^.]{{0,140}}?as of {D},? were acquired at an aggregate purchase price of (?:approximately )?\$\s?{NUM} (billion|million)"
    rf" and an average purchase price of (?:approximately )?\$\s?{NUM}")
R_ACQ = re.compile(
    rf"(?:purchased|acquired) approximately {NUM} bitcoins? for (?:approximately )?\$\s?{NUM} (million|billion) in cash,? at an average price of (?:approximately )?\$\s?{NUM}")


def parse_btc_8k(text):
    """Returns observations [{as_of, btc, cost, avg, acq_btc, acq_cost}] found in the filing text."""
    obs = []
    for m in R_T2.finditer(text):
        d1, d2, a, ac, aa, asof, btc, cost, avg = m.groups()
        obs.append({"as_of": pdate(asof), "btc": fnum(btc), "cost": money(cost, 1e9), "avg": fnum(avg),
                    "acq_btc": fnum(a), "acq_cost": money(ac, 1e6)})
    for m in R_T1.finditer(text):
        d1, d2, asof, a, ac, aa, btc, cost, avg = m.groups()
        obs.append({"as_of": pdate(asof), "btc": fnum(btc), "cost": money(cost, 1e9), "avg": fnum(avg),
                    "acq_btc": fnum(a), "acq_cost": money(ac, 1e6)})
    if obs:
        return obs
    acq = R_ACQ.search(text)
    for m in R_P1.finditer(text):
        asof, btc, cost, unit, avg = m.groups()
        obs.append({"as_of": pdate(asof), "btc": fnum(btc), "cost": fnum(cost) * (1e9 if unit == "billion" else 1e6), "avg": fnum(avg),
                    "acq_btc": fnum(acq.group(1)) if acq else None,
                    "acq_cost": (fnum(acq.group(2)) * (1e6 if acq.group(3) == "million" else 1e9)) if acq else None})
        break
    if not obs:
        for m in R_P2.finditer(text):
            btc, asof, cost, unit, avg = m.groups()
            obs.append({"as_of": pdate(asof), "btc": fnum(btc), "cost": fnum(cost) * (1e9 if unit == "billion" else 1e6), "avg": fnum(avg),
                        "acq_btc": None, "acq_cost": None})
            break
    return obs


def collect_holdings(conn):
    filings = sec.submissions(CIK, include_old=True)
    todo = [f for f in filings if f["form"] == "8-K" and f["filed"] >= "2020-08-01" and ("8.01" in f["items"] or "7.01" in f["items"])]
    done = {r["accession"] for r in db.query(conn, "SELECT accession FROM filing_parsed WHERE kind='btc'")}
    new = [f for f in todo if f["accession"] not in done]
    log(f"  8-Ks to scan for BTC updates: {len(new)} new of {len(todo)}")
    n_obs = 0
    for f in sorted(new, key=lambda x: x["filed"]):
        url = sec.doc_url(CIK, f["accession"], f["doc"])
        try:
            text = sec.get_text(url)
        except Exception as e:
            log(f"    ! {f['accession']}: {str(e)[:60]}")
            continue
        obs = parse_btc_8k(text)
        rows = []
        for o in obs:
            if not o["btc"] or o["btc"] < 1000:
                continue
            rows.append((o["as_of"], o["btc"], o["cost"], o["avg"], o["acq_btc"], o["acq_cost"], f["accession"], url, "8-K"))
        if rows:
            # keep one row per as_of (a later row in the same filing wins), never overwrite with fewer facts
            db.upsert(conn, "btc_holdings", ["as_of", "btc", "agg_cost_usd", "avg_cost_usd", "btc_acquired", "acq_cost_usd", "accession",
                                             "source_url", "source_kind"], rows)
            last = max(rows, key=lambda r: r[0])
            acq = last[4]
            desc = f"Bitcoin update: {int(last[1]):,} BTC held" + (f" (+{int(acq):,})" if acq else "")
            db.query(conn, "UPDATE sec_filings SET description=%s WHERE accession=%s AND symbol='MSTR'", (desc[:190], f["accession"]))
        db.insert_ignore(conn, "filing_parsed", ["accession", "kind", "symbol", "result"], [(f["accession"], "btc", "MSTR", f"{len(rows)}obs")])
        n_obs += len(rows)
    # derive acquisitions where the filing did not state them (older prose format): delta of consecutive holdings
    rows = db.query(conn, "SELECT as_of, btc, agg_cost_usd, btc_acquired FROM btc_holdings ORDER BY as_of")
    prev = None
    upd = []
    for r in rows:
        if prev and r["btc_acquired"] is None:
            upd.append((float(r["btc"]) - float(prev["btc"]),
                        (float(r["agg_cost_usd"]) - float(prev["agg_cost_usd"])) if r["agg_cost_usd"] and prev["agg_cost_usd"] else None, r["as_of"]))
        prev = r
    with conn.cursor() as cur:
        cur.executemany("UPDATE btc_holdings SET btc_acquired=%s, acq_cost_usd=%s WHERE as_of=%s", upd)
    return n_obs


# ---------------------------------------------------------------------------- balance sheet inputs
def xbrl_series(facts, tag, forms=("10-Q", "10-K")):
    out = {}
    node = facts.get("us-gaap", {}).get(tag)
    if not node:
        return out
    for unit, arr in node["units"].items():
        for x in arr:
            if x["form"] in forms and "start" not in x:               # instant (balance sheet) facts only
                out[x["end"]] = float(x["val"])
    return out


COVER = re.compile(r"the registrant had ([\d,]+) (?:a nd )?(?:and )?([\d,]+) shares of class A common stock and class B common stock outstanding")
COVER2 = re.compile(r"registrant had ([\d,\s]+?) and ([\d,\s]+?) shares of class A common stock and class B")


def collect_inputs(conn):
    facts = sec.get_json(f"https://data.sec.gov/api/xbrl/companyfacts/CIK{CIK}.json")["facts"]
    xurl = f"https://data.sec.gov/api/xbrl/companyfacts/CIK{CIK}.json"
    debt = xbrl_series(facts, "LongTermDebt")
    cash = xbrl_series(facts, "CashAndCashEquivalentsAtCarryingValue")
    pref_lp = xbrl_series(facts, "TemporaryEquityLiquidationPreference")
    pref_cv = xbrl_series(facts, "TemporaryEquityCarryingAmountAttributableToParent")
    rows = []
    periodic = [f for f in sec.submissions(CIK) if f["form"] in ("10-Q", "10-K") and f["report"] and f["filed"] >= "2023-06-01"]
    for f in periodic:
        end = f["report"]
        url = sec.doc_url(CIK, f["accession"], f["doc"])
        if end in debt:
            rows.append((end, "debt", debt[end], "SEC XBRL", xurl, f"LongTermDebt (carrying value) per {f['form']} filed {f['filed']}"))
        if end in cash:
            rows.append((end, "cash", cash[end], "SEC XBRL", xurl, f"CashAndCashEquivalentsAtCarryingValue per {f['form']}"))
        if end in pref_lp:
            rows.append((end, "preferred", pref_lp[end], "SEC XBRL", xurl, "Preferred liquidation preference (STRF/STRC/STRE/STRK/STRD)"))
        elif end in pref_cv:
            rows.append((end, "preferred", pref_cv[end], "SEC XBRL", xurl, "Preferred carrying amount (liquidation preference not tagged that quarter)"))
        have = db.one(conn, "SELECT 1 x FROM treasury_inputs WHERE as_of=%s AND k='shares_out'", (end,))
        if not have:
            try:
                head = sec.get_text(url)[:60000]
                m = COVER.search(head) or COVER2.search(head)
                if m:
                    a = int(re.sub(r"[^\d]", "", m.group(1)))
                    b = int(re.sub(r"[^\d]", "", m.group(2)))
                    split = 10 if dt.date.fromisoformat(end) < dt.date(2024, 8, 8) else 1      # MSTR 10-for-1 split, Aug 2024
                    note = f"{a:,} class A + {b:,} class B shares (cover page)" + (" x10 split-adjusted" if split > 1 else "")
                    rows.append((end, "shares_out", (a + b) * split, f"{f['form']} cover", url, note))
            except Exception as e:
                log(f"    ! cover {f['accession']}: {str(e)[:60]}")
    db.upsert(conn, "treasury_inputs", ["as_of", "k", "value", "source", "source_url", "note"], rows)
    return len(rows)


# ---------------------------------------------------------------------------- derived card
def last_on_or_before(dates, vals, d):
    i = bisect_right(dates, d) - 1
    return vals[i] if i >= 0 else None


def quarter_ends(start, end):
    out = []
    y, q = start.year, (start.month - 1) // 3 + 1
    while True:
        m = q * 3
        d = (dt.date(y, m, 1) + dt.timedelta(days=32)).replace(day=1) - dt.timedelta(days=1)
        if d > end:
            break
        if d >= start:
            out.append(d)
        q += 1
        if q > 4:
            q, y = 1, y + 1
    return out


def build_card(conn):
    hold = db.query(conn, "SELECT * FROM btc_holdings ORDER BY as_of")
    if not hold:
        return None
    hd = [h["as_of"] for h in hold]
    btc_px = {r["d"]: float(r["close"]) for r in db.query(conn, "SELECT d, close FROM prices_daily WHERE symbol='BTC-USD'")}
    bd = sorted(btc_px)
    bv = [btc_px[d] for d in bd]
    mstr_px = {r["d"]: float(r["close"]) for r in db.query(conn, "SELECT d, close FROM prices_daily WHERE symbol='MSTR'")}
    md = sorted(mstr_px)
    mv = [mstr_px[d] for d in md]
    inputs = {}
    for r in db.query(conn, "SELECT * FROM treasury_inputs ORDER BY as_of"):
        inputs.setdefault(r["k"], []).append(r)

    def latest_input(k):
        arr = inputs.get(k)
        return arr[-1] if arr else None

    def input_at(k, d):
        arr = [r for r in inputs.get(k, []) if r["as_of"] <= d]
        return arr[-1] if arr else None

    cur = hold[-1]
    prof = db.one(conn, "SELECT market_cap, shares_out FROM company_profile WHERE symbol='MSTR'")
    btc_now = bv[-1]
    mstr_now = mv[-1]
    mcap = float(prof["market_cap"]) if prof and prof["market_cap"] else None
    nav = float(cur["btc"]) * btc_now
    debt, cash, pref = latest_input("debt"), latest_input("cash"), latest_input("preferred")
    ev = None
    if mcap is not None:
        ev = mcap + (float(debt["value"]) if debt else 0) + (float(pref["value"]) if pref else 0) - (float(cash["value"]) if cash else 0)
    card = {
        "as_of": cur["as_of"].isoformat(), "btc": float(cur["btc"]), "agg_cost": float(cur["agg_cost_usd"]) if cur["agg_cost_usd"] else None,
        "avg_cost": float(cur["avg_cost_usd"]) if cur["avg_cost_usd"] else None, "btc_price": btc_now, "btc_nav": nav,
        "unrealized": (nav - float(cur["agg_cost_usd"])) if cur["agg_cost_usd"] else None,
        "unrealized_pct": (nav / float(cur["agg_cost_usd"]) - 1) if cur["agg_cost_usd"] else None,
        "mstr_price": mstr_now, "market_cap": mcap,
        "debt": float(debt["value"]) if debt else None, "preferred": float(pref["value"]) if pref else None,
        "cash": float(cash["value"]) if cash else None, "ev": ev,
        "mnav_ev": (ev / nav) if ev and nav else None, "mnav_mcap": (mcap / nav) if mcap and nav else None,
        "btc_per_share": (float(cur["btc"]) / (mcap / mstr_now)) if mcap else None,
        "sources": {
            "btc": {"label": f"8-K filed {cur['as_of']}", "url": cur["source_url"]},
            "market_cap": {"label": "Yahoo Finance (price x total shares)", "url": "https://finance.yahoo.com/quote/MSTR/key-statistics/"},
            "btc_price": {"label": "Yahoo Finance BTC-USD daily close", "url": "https://finance.yahoo.com/quote/BTC-USD/"},
            "debt": {"label": f"SEC XBRL, quarter ended {debt['as_of']}" if debt else None, "url": debt["source_url"] if debt else None},
            "preferred": {"label": f"SEC XBRL, quarter ended {pref['as_of']}" if pref else None, "url": pref["source_url"] if pref else None},
            "cash": {"label": f"SEC XBRL, quarter ended {cash['as_of']}" if cash else None, "url": cash["source_url"] if cash else None},
        },
        "inputs_as_of": {"debt": debt["as_of"].isoformat() if debt else None, "preferred": pref["as_of"].isoformat() if pref else None,
                         "cash": cash["as_of"].isoformat() if cash else None},
    }
    # quarterly history
    hist = []
    for qe in quarter_ends(dt.date(2020, 9, 30), dt.date.today()):
        i = bisect_right(hd, qe) - 1
        if i < 0:
            continue
        h = hold[i]
        bp = last_on_or_before(bd, bv, qe)
        mp = last_on_or_before(md, mv, qe)
        nav_q = float(h["btc"]) * bp if bp else None
        prev_q = hist[-1]["btc"] if hist else 0
        sh = input_at("shares_out", qe)
        dbt, csh, prf = input_at("debt", qe), input_at("cash", qe), input_at("preferred", qe)
        have_in = sh and (qe - sh["as_of"]).days <= 100
        mcap_q = (float(sh["value"]) * mp) if (have_in and mp) else None
        ev_q = None
        if mcap_q and dbt and (qe - dbt["as_of"]).days <= 100:
            ev_q = mcap_q + float(dbt["value"]) + (float(prf["value"]) if prf and (qe - prf["as_of"]).days <= 100 else 0) \
                - (float(csh["value"]) if csh and (qe - csh["as_of"]).days <= 100 else 0)
        hist.append({"q": f"{qe.year} Q{(qe.month - 1) // 3 + 1}", "date": qe.isoformat(), "holdings_as_of": h["as_of"].isoformat(),
                     "btc": float(h["btc"]), "added": float(h["btc"]) - prev_q if hist else float(h["btc"]),
                     "avg_cost": float(h["avg_cost_usd"]) if h["avg_cost_usd"] else None,
                     "agg_cost": float(h["agg_cost_usd"]) if h["agg_cost_usd"] else None, "btc_price": bp, "btc_nav": nav_q,
                     "mstr_price": mp, "mnav_mcap": (mcap_q / nav_q) if mcap_q and nav_q else None,
                     "mnav_ev": (ev_q / nav_q) if ev_q and nav_q else None})
    card["quarters"] = hist
    # recent statements (weekly 8-K updates) + purchase/sale markers for the price chart
    card["recent"] = [{"as_of": h["as_of"].isoformat(), "btc": float(h["btc"]), "acquired": float(h["btc_acquired"]) if h["btc_acquired"] is not None else None,
                       "acq_cost": float(h["acq_cost_usd"]) if h["acq_cost_usd"] else None, "avg_cost": float(h["avg_cost_usd"]) if h["avg_cost_usd"] else None,
                       "url": h["source_url"]} for h in hold[-14:]][::-1]
    card["markers"] = [{"d": h["as_of"].isoformat(), "btc": float(h["btc_acquired"]), "cost": float(h["acq_cost_usd"]) if h["acq_cost_usd"] else None}
                       for h in hold if h["btc_acquired"] not in (None, 0)]
    card["n_statements"] = len(hold)
    card["first_as_of"] = hold[0]["as_of"].isoformat()
    return card


def run(conn):
    n = collect_holdings(conn)
    m = collect_inputs(conn)
    card = build_card(conn)
    if card:
        db.save_analytics(conn, "MSTR", "treasury", card)
        log(f"  holdings {card['btc']:,.0f} BTC @ ${card['avg_cost']:,.0f}  mNAV(EV)={card['mnav_ev'] and round(card['mnav_ev'], 3)}  "
            f"mNAV(mkt cap)={card['mnav_mcap'] and round(card['mnav_mcap'], 3)}  statements={card['n_statements']}")
    return f"{n} holdings observations, {m} inputs"
