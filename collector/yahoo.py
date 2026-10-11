"""Minimal Yahoo Finance client (stdlib only): chart bars, quoteSummary, option chains.

Yahoo needs a cookie + crumb for quoteSummary/options; chart data does not.
"""
import http.cookiejar
import json
import time
import urllib.error
import urllib.parse
import urllib.request

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) "
      "Chrome/124.0.0.0 Safari/537.36")


class Yahoo:
    def __init__(self, pause=0.25):
        self.jar = http.cookiejar.CookieJar()
        self.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.jar))
        self.crumb = None
        self.pause = pause

    # ------------------------------------------------------------------ http
    def _get(self, url, retries=4):
        last = None
        for i in range(retries):
            try:
                req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "*/*"})
                with self.opener.open(req, timeout=40) as r:
                    data = r.read().decode("utf-8", "replace")
                time.sleep(self.pause)
                return data
            except urllib.error.HTTPError as e:
                last = e
                if e.code in (401, 403):
                    self.crumb = None            # force a fresh cookie/crumb next time
                if e.code in (404,):
                    raise
                time.sleep(1.5 * (i + 1))
            except Exception as e:                # network hiccup
                last = e
                time.sleep(1.5 * (i + 1))
        raise RuntimeError(f"GET failed: {url[:110]} -> {last}")

    def _ensure_crumb(self):
        if self.crumb:
            return self.crumb
        try:
            self._get("https://fc.yahoo.com", retries=1)
        except Exception:
            pass                                   # fc.yahoo.com answers 404 but still sets the cookie
        self.crumb = self._get("https://query1.finance.yahoo.com/v1/test/getcrumb").strip()
        if not self.crumb or "<" in self.crumb:
            self.crumb = None
            raise RuntimeError("could not obtain Yahoo crumb")
        return self.crumb

    # ------------------------------------------------------------------ chart
    def chart(self, symbol, period1, period2, interval="1d"):
        """Return dict(meta, rows=[(ts_utc, o,h,l,c,v)]) skipping empty bars."""
        q = urllib.parse.urlencode({"period1": int(period1), "period2": int(period2), "interval": interval,
                                    "includePrePost": "false", "events": "div,split"})
        url = f"https://query1.finance.yahoo.com/v8/finance/chart/{urllib.parse.quote(symbol)}?{q}"
        d = json.loads(self._get(url))
        res = (d.get("chart") or {}).get("result")
        if not res:
            raise RuntimeError(f"no chart data for {symbol}: {(d.get('chart') or {}).get('error')}")
        r = res[0]
        ts = r.get("timestamp") or []
        qt = r["indicators"]["quote"][0]
        rows = []
        for i, t in enumerate(ts):
            c = qt["close"][i]
            if c is None:
                continue
            o = qt["open"][i] if qt["open"][i] is not None else c
            h = qt["high"][i] if qt["high"][i] is not None else c
            lo = qt["low"][i] if qt["low"][i] is not None else c
            v = qt["volume"][i] or 0
            rows.append((t, o, h, lo, c, v))
        return {"meta": r["meta"], "rows": rows}

    # ------------------------------------------------------------------ quoteSummary
    def quote_summary(self, symbol, modules):
        crumb = self._ensure_crumb()
        q = urllib.parse.urlencode({"modules": ",".join(modules), "crumb": crumb})
        url = f"https://query2.finance.yahoo.com/v10/finance/quoteSummary/{urllib.parse.quote(symbol)}?{q}"
        d = json.loads(self._get(url))
        res = (d.get("quoteSummary") or {}).get("result")
        if not res:
            raise RuntimeError(f"no quoteSummary for {symbol}")
        return res[0]

    # ------------------------------------------------------------------ options
    def options(self, symbol, expiry_ts=None):
        crumb = self._ensure_crumb()
        params = {"crumb": crumb}
        if expiry_ts:
            params["date"] = int(expiry_ts)
        url = f"https://query2.finance.yahoo.com/v7/finance/options/{urllib.parse.quote(symbol)}?{urllib.parse.urlencode(params)}"
        d = json.loads(self._get(url))
        res = (d.get("optionChain") or {}).get("result")
        if not res:
            raise RuntimeError(f"no options for {symbol}")
        return res[0]


def raw(v, default=None):
    """quoteSummary values are {'raw': x, 'fmt': '...'} objects (or {} when missing)."""
    if isinstance(v, dict):
        return v.get("raw", default)
    return v if v is not None else default
