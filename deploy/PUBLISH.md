# Put the dashboard on the internet (normal public website)

> **Simplest, fully automatic route: `deploy/GO-LIVE.md` (GitHub — updates itself daily, PC off).** The Netlify route below is the manual alternative.

The `site` folder (`C:\xampp\htdocs\cc\MSTR\site`) **is the website**: plain files, no server or database. Any static host serves it.
Recommended: **Netlify** (free plan is enough; HTTPS and custom domains included).

## 1. Get it online (5 minutes)
1. Make a free account at https://app.netlify.com (use Google/GitHub/email).
2. Open https://app.netlify.com/drop and **drag the `site` folder** onto the page.
3. You instantly get an address like `https://random-name-123.netlify.app`. Open it — that is the public site.

## 2. Your own name (optional, ~$10–15 / year)
1. Buy a domain (Namecheap, Cloudflare, GoDaddy…), e.g. `bitcoinproxytrader.com`.
2. Netlify → *Domain management* → *Add a domain* → follow the steps. HTTPS is automatic.

## 3. Make Google & Bing find it
1. Tell the build your address, then rebuild:  `python deploy\export_static.py --site-url https://yourdomain.com`  (or put `"site_url": "https://yourdomain.com"` in `collector\config.local.json`), and drag `site` onto Netlify again.
   This adds the sitemap and canonical links. Each ticker also has its own page: `/mstr/`, `/coin/`, `/ibit/` …
2. https://search.google.com/search-console → add your site → submit `https://yourdomain.com/sitemap.xml`. Do the same at https://www.bing.com/webmasters.
3. Be patient: new sites usually take days to weeks to appear, and ranking for competitive words like “MSTR” takes much longer. Searching the exact name “BitcoinProxyTrader” will find it first.

## 4. Keep it fresh
The public site is a **snapshot**. `deploy\publish.bat` collects new data, rebuilds the site and uploads it.
* Manual: double-click `deploy\publish.bat` (XAMPP running), then drag `site` to Netlify (or automate with the two values below).
* Automatic upload: in Netlify create a *Personal access token* (User settings → Applications) and copy the *Site ID* (Site configuration). Put them in `collector\config.local.json`:
  `"netlify_token": "…", "netlify_site_id": "…", "site_url": "https://yourdomain.com"` and the script uploads by itself.
* Schedule it daily with Windows Task Scheduler (PC must be on), or later move collection to a cloud server (`deploy\DEPLOY.md`) so it runs 24/7.

## What is (not) public
* Public: all dashboards, charts, signals, option chains, filings, insiders. Read-only. Footer says “not investment advice”.
* **Not** published: your notes and saved RSI lines and the refresh button. The **Strategy ideas** tab *is* published; to leave it out use `python deploy\export_static.py --no-ideas`.

## Please think about these before promoting it
* **Data terms.** Prices and option quotes come from Yahoo Finance, whose terms allow personal use, not redistribution. For a public product use a licensed data source (e.g. Massive.com’s plans that permit display) — SEC and Deribit data are fine.
* **Financial promotion rules.** Publishing BUY / SELL labels or specific trade ideas to the public can be a regulated activity in some countries (for example the UK). The site is labelled educational, but if you plan to promote it, check with the local regulator or a lawyer.
