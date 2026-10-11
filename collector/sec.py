"""SEC EDGAR helpers (fair-use compliant: descriptive User-Agent, <= ~7 requests/second)."""
import datetime as dt
import html
import json
import re
import time
import urllib.error
import urllib.request

from config import CFG

_last = [0.0]
GAP = 0.16


def _get(url, retries=4):
    last = None
    for i in range(retries):
        wait = GAP - (time.time() - _last[0])
        if wait > 0:
            time.sleep(wait)
        _last[0] = time.time()
        try:
            req = urllib.request.Request(url, headers={"User-Agent": CFG["sec_user_agent"], "Accept-Encoding": "identity"})
            with urllib.request.urlopen(req, timeout=60) as r:
                return r.read().decode("utf-8", "replace")
        except urllib.error.HTTPError as e:
            last = e
            if e.code == 404:
                raise
            time.sleep(2 * (i + 1))
        except Exception as e:
            last = e
            time.sleep(2 * (i + 1))
    raise RuntimeError(f"SEC GET failed {url[:100]} -> {last}")


def get_json(url):
    return json.loads(_get(url))


def get_text(url):
    """Fetch an HTML filing and return whitespace-collapsed plain text."""
    t = _get(url)
    t = re.sub(r"(?is)<(script|style|ix:header).*?</\1>", " ", t)      # inline-XBRL hidden header is pure noise
    t = re.sub(r"<[^>]+>", " ", t)
    t = html.unescape(t).replace("\xa0", " ").replace("​", "")
    return re.sub(r"\s+", " ", t)


def get_raw(url):
    return _get(url)


def cik_map():
    d = get_json("https://www.sec.gov/files/company_tickers.json")
    return {v["ticker"].upper(): str(v["cik_str"]).zfill(10) for v in d.values()}


def submissions(cik, include_old=False):
    """Return list of filing dicts (recent page, optionally the older archive pages)."""
    pages = [get_json(f"https://data.sec.gov/submissions/CIK{cik}.json")]
    recs = [pages[0]["filings"]["recent"]]
    if include_old:
        for f in pages[0]["filings"].get("files", []):
            recs.append(get_json(f"https://data.sec.gov/submissions/{f['name']}"))
    out = []
    for rec in recs:
        n = len(rec["form"])
        for i in range(n):
            out.append({
                "accession": rec["accessionNumber"][i], "form": rec["form"][i], "filed": rec["filingDate"][i],
                "report": rec.get("reportDate", [""] * n)[i] or None, "accepted": rec.get("acceptanceDateTime", [""] * n)[i] or None,
                "items": rec.get("items", [""] * n)[i] or "", "doc": rec["primaryDocument"][i],
                "desc": rec.get("primaryDocDescription", [""] * n)[i] or ""})
    return out


def doc_url(cik, accession, doc):
    return f"https://www.sec.gov/Archives/edgar/data/{int(cik)}/{accession.replace('-', '')}/{doc}"


def parse_accepted(s):
    """'2026-07-30T20:11:26.000Z' -> naive UTC datetime."""
    if not s:
        return None
    try:
        return dt.datetime.strptime(s[:19], "%Y-%m-%dT%H:%M:%S")
    except ValueError:
        return None


ITEM_NAMES = {
    "1.01": "Material agreement", "1.02": "Agreement terminated", "1.03": "Bankruptcy", "2.01": "Acquisition / disposition",
    "2.02": "Earnings results", "2.03": "Direct financial obligation", "2.04": "Obligation acceleration", "2.05": "Exit costs",
    "2.06": "Impairment", "3.01": "Listing notice", "3.02": "Unregistered equity sales", "3.03": "Security-holder rights",
    "4.01": "Auditor change", "4.02": "Non-reliance on financials", "5.01": "Change in control", "5.02": "Officer / director change",
    "5.03": "Charter / bylaw change", "5.07": "Shareholder vote", "7.01": "Reg FD disclosure", "8.01": "Other events",
    "9.01": "Financial statements & exhibits",
}


def describe(form, items, desc):
    if form.startswith("8-K") and items:
        names = [ITEM_NAMES.get(i.strip(), i.strip()) for i in items.split(",") if i.strip() != "9.01"]
        return (", ".join(names) or "Current report")[:195]
    base = {"10-K": "Annual report", "10-Q": "Quarterly report", "4": "Insider transaction (Form 4)", "3": "Initial insider ownership",
            "5": "Annual insider statement", "DEF 14A": "Proxy statement", "S-3": "Shelf registration", "S-3ASR": "Automatic shelf registration",
            "424B5": "Prospectus supplement", "424B2": "Prospectus supplement", "SC 13G": "Beneficial ownership (passive)",
            "SC 13D": "Beneficial ownership (activist)", "13F-HR": "Institutional holdings", "S-8": "Employee plan registration",
            "FWP": "Free-writing prospectus", "6-K": "Foreign issuer report", "20-F": "Foreign issuer annual report"}
    return (base.get(form) or desc or form)[:195]
