"""Insider transactions: parse SEC Form 4 XML (non-derivative table) -> insider_tx.

Transaction codes kept as filed: P open-market buy, S open-market sale, A award, M option exercise,
F tax withholding, G gift, C conversion ... The dashboard tiles only count P and S as 'buys' / 'sells'.
"""
import datetime as dt
import xml.etree.ElementTree as ET

import db
import sec
from config import INSIDER_LOOKBACK_DAYS, INSIDER_MAX_FILINGS
from db import log

PER_SYMBOL_CAP = {"MSTR": 340}


def _txt(node, path):
    if node is None:
        return None
    n = node.find(path)
    return n.text.strip() if n is not None and n.text else None


def _num(s):
    try:
        return float(s.replace(",", "")) if s else None
    except ValueError:
        return None


def parse_form4(xml_text):
    root = ET.fromstring(xml_text)
    out = []
    owner = root.find("reportingOwner")
    name = _txt(owner, "reportingOwnerId/rptOwnerName") or "Unknown"
    rel = owner.find("reportingOwnerRelationship") if owner is not None else None
    roles = []
    if rel is not None:
        if _txt(rel, "isOfficer") in ("1", "true"):
            roles.append(_txt(rel, "officerTitle") or "Officer")
        if _txt(rel, "isDirector") in ("1", "true"):
            roles.append("Director")
        if _txt(rel, "isTenPercentOwner") in ("1", "true"):
            roles.append("10% Owner")
        if _txt(rel, "isOther") in ("1", "true"):
            roles.append(_txt(rel, "otherText") or "Other")
    plan = _txt(root, "aff10b5One")
    is_plan = 1 if plan in ("1", "true") else (0 if plan in ("0", "false") else None)
    for i, tx in enumerate(root.findall("nonDerivativeTable/nonDerivativeTransaction")):
        d = _txt(tx, "transactionDate/value")
        code = _txt(tx, "transactionCoding/transactionCode")
        if not d or not code:
            continue
        shares = _num(_txt(tx, "transactionAmounts/transactionShares/value"))
        price = _num(_txt(tx, "transactionAmounts/transactionPricePerShare/value"))
        ad = _txt(tx, "transactionAmounts/transactionAcquiredDisposedCode/value")
        after = _num(_txt(tx, "postTransactionAmounts/sharesOwnedFollowingTransaction/value"))
        out.append({"line": i, "name": name, "role": ", ".join(roles)[:98] or None, "date": dt.date.fromisoformat(d), "code": code[:2],
                    "ad": ad, "shares": shares, "price": price, "value": (shares * price) if (shares and price) else None,
                    "after": after, "plan": is_plan})
    return out


def run(conn):
    cutoff = dt.date.today() - dt.timedelta(days=INSIDER_LOOKBACK_DAYS)
    total_tx, total_f = 0, 0
    syms = [r["symbol"] for r in db.query(conn, "SELECT symbol FROM tickers WHERE is_tab=1 ORDER BY sort_order")]
    for sym in syms:
        cap = PER_SYMBOL_CAP.get(sym, INSIDER_MAX_FILINGS)
        todo = db.query(conn, """SELECT f.accession, f.filed, f.url FROM sec_filings f
                                 LEFT JOIN filing_parsed p ON p.accession=f.accession AND p.kind='form4'
                                 WHERE f.symbol=%s AND f.form IN ('4','4/A') AND f.filed>=%s AND p.accession IS NULL
                                 ORDER BY f.filed DESC LIMIT %s""", (sym, cutoff, cap))
        if not todo:
            continue
        n_ok = 0
        for f in todo:
            url = f["url"]            # .../<accession>/xslF345X06/ownership.xml  (HTML view) -> raw XML sits one level up
            if "/xsl" in url:
                head, tail = url.rsplit("/xsl", 1)
                xml_url = head + "/" + tail.split("/", 1)[1]
            else:
                xml_url = url
            try:
                parsed = parse_form4(sec.get_raw(xml_url))
            except Exception as e:
                db.insert_ignore(conn, "filing_parsed", ["accession", "kind", "symbol", "result"], [(f["accession"], "form4", sym, "err")])
                log(f"    ! {sym} {f['accession']}: {str(e)[:70]}")
                continue
            rows = [(f["accession"], p["line"], sym, p["name"], p["role"], p["date"], p["code"], p["ad"], p["shares"], p["price"],
                     p["value"], p["after"], p["plan"], f["filed"], f["url"]) for p in parsed]
            db.upsert(conn, "insider_tx", ["accession", "line_no", "symbol", "owner_name", "owner_role", "tx_date", "code", "acq_disp",
                                           "shares", "price", "value_usd", "shares_after", "is_10b5_1", "filed", "url"], rows)
            db.insert_ignore(conn, "filing_parsed", ["accession", "kind", "symbol", "result"], [(f["accession"], "form4", sym, f"{len(rows)}tx")])
            total_tx += len(rows)
            n_ok += 1
        total_f += n_ok
        log(f"  {sym:6} Form 4 parsed {n_ok}/{len(todo)}")
    return f"{total_f} Form 4 filings, {total_tx} transactions"
