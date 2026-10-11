"""SEC filings feed (all forms) for every ticker -> sec_filings, plus CIK mapping."""
import datetime as dt

import db
import sec
from config import EQUITY_SYMBOLS, FILINGS_LOOKBACK_DAYS
from db import log

# Fallbacks if a ticker is missing from SEC's ticker file (new listings / renamed issuers).
CIK_FALLBACK = {"MSTR": "0001050446"}
KEEP_FORMS = None      # None = keep everything


def ensure_ciks(conn):
    m = sec.cik_map()
    for sym in EQUITY_SYMBOLS:
        cik = m.get(sym.replace("-", ".")) or CIK_FALLBACK.get(sym)
        if cik:
            db.query(conn, "UPDATE tickers SET cik=%s WHERE symbol=%s", (cik, sym))
        else:
            log(f"  ! no CIK for {sym}")


def run(conn):
    ensure_ciks(conn)
    cutoff = dt.date.today() - dt.timedelta(days=FILINGS_LOOKBACK_DAYS)
    total = 0
    for r in db.query(conn, "SELECT symbol, cik FROM tickers WHERE cik IS NOT NULL ORDER BY sort_order"):
        sym, cik = r["symbol"], r["cik"]
        try:
            filings = sec.submissions(cik)
        except Exception as e:
            log(f"  ! {sym} submissions: {str(e)[:80]}")
            continue
        rows = []
        for f in filings:
            filed = dt.date.fromisoformat(f["filed"])
            if filed < cutoff:
                continue
            acc = sec.parse_accepted(f["accepted"])
            rows.append((f["accession"], sym, f["form"], filed, acc, f["report"] or None, f["items"][:78] or None,
                         sec.describe(f["form"], f["items"], f["desc"]), sec.doc_url(cik, f["accession"], f["doc"])))
        db.upsert(conn, "sec_filings", ["accession", "symbol", "form", "filed", "accepted", "report_date", "items", "description", "url"], rows)
        total += len(rows)
        log(f"  {sym:6} cik={cik} filings kept {len(rows)}")
    return f"{total} filings"
