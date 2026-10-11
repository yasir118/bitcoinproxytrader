"""Build the PUBLIC website into  MSTR/site/  (pure files: no PHP, no database, nothing to hack).

    python deploy\\export_static.py                      # uses site_url from collector/config.local.json if present
    python deploy\\export_static.py --site-url https://yourdomain.com
    python deploy\\export_static.py --no-ideas           # LEAVE OUT the "Strategy ideas" (specific option trades) tab

It reads the running local app (http://localhost/cc/MSTR/api/index.php), saves every answer the pages need as site/data/<name>.json,
copies the app, and writes search-engine friendly landing pages (one per ticker), robots.txt, sitemap.xml and cache headers.
The file-name rule in name_for() MUST match staticName() in assets/js/util.js.
"""
import argparse
import datetime as dt
import html
import json
import os
import re
import shutil
import sys
import urllib.error
import urllib.parse
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SITE = os.path.join(ROOT, "site")
API = os.environ.get("MSTR_API", "http://localhost/cc/MSTR/api/index.php")

NAMES = {"MSTR": "Strategy (MicroStrategy)", "COIN": "Coinbase", "IBIT": "iShares Bitcoin Trust ETF", "CRCL": "Circle Internet Group", "ASST": "Strive", "XYZ": "Block",
         "MARA": "MARA Holdings", "RIOT": "Riot Platforms", "IREN": "IREN", "CLSK": "CleanSpark", "BTDR": "Bitdeer", "GLXY": "Galaxy Digital", "XXI": "Twenty One Capital"}


def name_for(route, params=None):
    params = params or {}
    clean = lambda v: re.sub(r"[^A-Za-z0-9.-]", "_", str(v))
    parts = [route]
    if params.get("symbol"):
        parts.append(clean(params["symbol"]))
    for k in sorted(k for k in params if k != "symbol"):
        if params[k] != "" and params[k] is not None:
            parts.append(f"{clean(k)}-{clean(params[k])}")
    return ".".join(parts)


def call(route, **params):
    url = API + "?" + urllib.parse.urlencode({"r": route, **params})
    try:
        with urllib.request.urlopen(url, timeout=60) as r:
            return json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError:
        return None


class Out:
    def __init__(self):
        self.files = 0
        self.bytes = 0

    def save(self, route, params=None, data=None):
        params = params or {}
        if data is None:
            data = call(route, **params)
        if data is None or (isinstance(data, dict) and data.get("error")):
            return None
        path = os.path.join(SITE, "data", name_for(route, params) + ".json")
        os.makedirs(os.path.dirname(path), exist_ok=True)
        txt = json.dumps(data, separators=(",", ":"), ensure_ascii=False)
        with open(path, "w", encoding="utf-8") as fh:
            fh.write(txt)
        self.files += 1
        self.bytes += len(txt.encode("utf-8"))
        return data


# ----------------------------------------------------------------------------------------------- html
def page(template, prefix, title, desc, start, boot, site_url, path, show_ideas):
    h = template
    h = re.sub(r"<title>.*?</title>", f"<title>{html.escape(title)}</title>", h, flags=re.S)
    h = re.sub(r'<meta name="description" content=".*?">', f'<meta name="description" content="{html.escape(desc, quote=True)}">', h, flags=re.S)
    canon = f'<link rel="canonical" href="{site_url}{path}">' if site_url else ""
    og = (f'<meta name="robots" content="index,follow,max-image-preview:large">{canon}'
          f'<meta property="og:type" content="website"><meta property="og:site_name" content="BitcoinProxyTrader">'
          f'<meta property="og:title" content="{html.escape(title, quote=True)}"><meta property="og:description" content="{html.escape(desc, quote=True)}">'
          f'{f"<meta property=og:url content={site_url}{path}>" if site_url else ""}<meta name="twitter:card" content="summary">')
    ld = {"@context": "https://schema.org", "@type": "WebApplication", "name": "BitcoinProxyTrader", "description": desc, "applicationCategory": "FinanceApplication",
          "operatingSystem": "Any", "offers": {"@type": "Offer", "price": "0", "priceCurrency": "USD"}}
    if site_url:
        ld["url"] = site_url + path
    flags = (f"window.STATIC_SITE=true;window.STATIC_BASE='{prefix}data/';window.START_SYMBOL='{start}';" + ("window.SHOW_IDEAS=true;" if show_ideas else ""))
    inject = og + f'<script type="application/ld+json">{json.dumps(ld)}</script><script>{flags}</script>'
    h = h.replace("</head>", inject + "\n</head>", 1)
    h = h.replace('href="assets/', f'href="{prefix}assets/').replace('src="assets/', f'src="{prefix}assets/')
    h = re.sub(r'<div id="boot".*?</div>\s*</main>', lambda m: boot + "\n    </main>", h, flags=re.S)
    return h


def boot_html(tabs, data_through, heading, intro, prefix):
    links = " · ".join(f'<a href="{prefix}{s.lower()}/" style="color:#d97a05">{s}</a>' for s in tabs)
    return f"""<div id="boot" style="font-family:'Segoe UI',system-ui,sans-serif;max-width:760px;margin:8vh auto;padding:28px;background:#fff;border-radius:22px;line-height:1.55;color:#141414">
        <h1 style="margin:0 0 10px;font-weight:600;font-size:26px">{html.escape(heading)}</h1>
        <p style="margin:0 0 12px">{html.escape(intro)}</p>
        <p style="margin:0 0 12px">What you get: price and RSI charts (4-hour to quarterly), moving averages and crosses, beta and correlation to Bitcoin, mNAV and bitcoin treasury,
        VIX and DVOL, implied vs realised volatility, option chains, open interest, max pain and gamma exposure (GEX), seasonality, insider (Form 4) trades, SEC filings, earnings moves and historical tops and lows with RSI.</p>
        <p style="margin:0 0 12px">Tickers: {links}</p>
        <p style="margin:0;color:#666;font-size:13px">Data through {html.escape(str(data_through))}. Educational research only, not investment advice. If you only see this text, enable JavaScript.</p>
      </div>"""


# ----------------------------------------------------------------------------------------------- main
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--site-url", default="")
    ap.add_argument("--no-ideas", action="store_true", help="do NOT publish the Strategy ideas tab (specific option trades)")
    a = ap.parse_args()
    cfg = {}
    cp = os.path.join(ROOT, "collector", "config.local.json")
    if os.path.exists(cp):
        cfg = json.load(open(cp, encoding="utf-8"))
    site_url = (a.site_url or cfg.get("site_url", "")).rstrip("/")
    a.include_ideas = not a.no_ideas and cfg.get("include_ideas", True)

    meta = call("meta")
    if not meta:
        sys.exit("Cannot reach the local app. Start Apache + MySQL in XAMPP first.")
    tabs = [t["symbol"] for t in meta["tickers"] if int(t["is_tab"])]
    print(f"{len(tabs)} tickers, data through {meta['data_through']}")

    os.makedirs(SITE, exist_ok=True)
    for entry in os.listdir(SITE):                      # empty the folder but keep the folder itself (it may be open in a shell / Explorer)
        full = os.path.join(SITE, entry)
        shutil.rmtree(full) if os.path.isdir(full) else os.remove(full)
    os.makedirs(os.path.join(SITE, "data"))
    shutil.copytree(os.path.join(ROOT, "assets"), os.path.join(SITE, "assets"))

    o = Out()
    meta["static_built"] = dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
    o.save("meta", data=meta)
    for s in tabs:
        o.save("overview", {"symbol": s})
        for tf in ("4H", "D", "W", "M", "Q"):
            o.save("bars", {"symbol": s, "tf": tf})
        keys = ["seasonality", "beta", "gex_curve"] + (["treasury"] if s == "MSTR" else []) + (["strategies"] if a.include_ideas else [])
        for k in keys:
            o.save("analytics", {"symbol": s, "k": k})
        base = o.save("options", {"symbol": s})
        if base and base.get("available"):
            for ex in ["all", "next"] + [e["expiry"] for e in base["expiries"]]:
                o.save("options", {"symbol": s, "exp": ex})
            for e in base["expiries"]:
                o.save("chain", {"symbol": s, "exp": e["expiry"]})
        o.save("vol", {"symbol": s})
        o.save("insiders", {"symbol": s})
        f0 = o.save("filings", {"symbol": s, "limit": 40})
        if f0:
            for f in f0["forms"][:11]:
                o.save("filings", {"symbol": s, "form": f["form"], "limit": 40})
        o.save("earnings", {"symbol": s})
        o.save("signals", {"symbol": s})
    for s in ("BTC-USD",):
        o.save("analytics", {"symbol": s, "k": "seasonality"})
        o.save("signals", {"symbol": s})
    o.save("basket")
    o.save("basket_series", {"days": 1500})
    r = call("research")
    if r:
        r["notes"] = []                       # private notes never go public
        o.save("research", data=r)
    o.save("treasury")
    o.save("optwatch")
    print(f"data: {o.files} files, {o.bytes / 1e6:.1f} MB")

    # ---- pages
    template = open(os.path.join(ROOT, "index.html"), encoding="utf-8").read()
    through = meta["data_through"]
    home_intro = ("A free dashboard for MSTR (Strategy), Bitcoin and the bitcoin-proxy stocks — COIN, IBIT, CRCL, ASST, XYZ, MARA, RIOT, IREN, CLSK, BTDR, GLXY and XXI. "
                  "Updated daily after the US market close.")
    pages = [("", "", "MSTR", "BitcoinProxyTrader — MSTR, Bitcoin & bitcoin-proxy stocks: RSI, options, treasury, insiders",
              "Free dashboard for MSTR (Strategy), Bitcoin and bitcoin-proxy stocks: RSI, moving averages, beta to BTC, mNAV, options chain & gamma (GEX), seasonality, insider trades, SEC filings and earnings. Updated daily.",
              "MSTR, Bitcoin and bitcoin-proxy stocks in one dashboard", home_intro, "/")]
    for s in tabs:
        nm = NAMES.get(s, s)
        pages.append((s.lower() + "/", "../", s, f"{nm} ({s}) stock dashboard: RSI, options, bitcoin beta, insiders | BitcoinProxyTrader",
                      f"{nm} ({s}) vs Bitcoin: price & RSI charts, moving averages, beta and correlation to BTC, options chain, open interest and gamma, insider trades, SEC filings, earnings moves and seasonality. Updated daily.",
                      f"{nm} ({s}) — price, RSI, options and Bitcoin beta", f"{nm} ({s}) tracked against Bitcoin with charts, options data, insider trades and SEC filings. Updated daily after the US close.", f"/{s.lower()}/"))
    for folder, prefix, start, title, desc, heading, intro, path in pages:
        os.makedirs(os.path.join(SITE, folder), exist_ok=True)
        with open(os.path.join(SITE, folder, "index.html"), "w", encoding="utf-8") as fh:
            fh.write(page(template, prefix, title, desc, start, boot_html(tabs, through, heading, intro, prefix), site_url, path, a.include_ideas))

    # ---- search + hosting files
    urls = [p[7] for p in pages]
    with open(os.path.join(SITE, "robots.txt"), "w") as fh:
        fh.write("User-agent: *\nAllow: /\n" + (f"Sitemap: {site_url}/sitemap.xml\n" if site_url else ""))
    if site_url:
        with open(os.path.join(SITE, "sitemap.xml"), "w") as fh:
            fh.write('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
                     "".join(f"  <url><loc>{site_url}{u}</loc><lastmod>{through}</lastmod><changefreq>daily</changefreq></url>\n" for u in urls) + "</urlset>\n")
    with open(os.path.join(SITE, "_headers"), "w") as fh:
        fh.write("/data/*\n  Cache-Control: public, max-age=300\n/assets/*\n  Cache-Control: public, max-age=86400\n/*\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: strict-origin-when-cross-origin\n")
    with open(os.path.join(SITE, "vercel.json"), "w") as fh:        # same cache rules for Vercel
        json.dump({"headers": [{"source": "/data/(.*)", "headers": [{"key": "Cache-Control", "value": "public, max-age=300"}]},
                               {"source": "/assets/(.*)", "headers": [{"key": "Cache-Control", "value": "public, max-age=86400"}]}]}, fh, indent=1)
    with open(os.path.join(SITE, "404.html"), "w", encoding="utf-8") as fh:
        fh.write(f'<!doctype html><meta charset="utf-8"><title>Not found</title><body style="font-family:system-ui;max-width:520px;margin:15vh auto"><h1>Page not found</h1><p><a href="{site_url or "."}/">Go to BitcoinProxyTrader</a></p>')
    total = sum(os.path.getsize(os.path.join(b, f)) for b, _, fs in os.walk(SITE) for f in fs)
    nfiles = sum(len(fs) for _, _, fs in os.walk(SITE))
    print(f"site/: {nfiles} files, {total / 1e6:.1f} MB · pages: {len(pages)} · site_url: {site_url or '(not set — sitemap skipped)'}")
    print("Local preview: http://localhost/cc/MSTR/site/")


if __name__ == "__main__":
    main()
