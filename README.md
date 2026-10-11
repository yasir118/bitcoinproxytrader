# BitcoinProxyTrader

A local dashboard + database for **MSTR, Bitcoin and the bitcoin-proxy basket** (COIN, IBIT, CRCL, ASST, XYZ, MARA, RIOT, IREN, CLSK, BTDR, GLXY, XXI).
Python collects the data into **MariaDB** (XAMPP), PHP serves it as JSON, and a plain-JavaScript front end draws it.

Open it at **http://localhost/cc/MSTR/** (Apache + MySQL running in the XAMPP control panel).

```
collector/   Python (stdlib + PyMySQL): fetchers, analytics, signals      -> writes MariaDB
api/         PHP JSON API (read-only except notes / saved RSI lines / refresh)
assets/      CSS, JS (no build step), vendored chart libraries
index.html   the app
```

## First run

Everything is already installed and loaded on this machine. To rebuild from scratch:

```
collector\setup.bat          :: installs PyMySQL, creates DB `mstr_terminal`, downloads full history (~5 min)
```

Daily refresh (incremental, ~2 min):

```
collector\run_all.bat                          :: everything
collector\run_all.bat --only prices,options,analytics,signals
collector\run_all.bat --full                   :: re-download full price history
```

…or press the **refresh icon** in the dashboard header (runs the same collector; only works from this computer).
Research → *Full refresh* also re-reads SEC filings, Form 4s, earnings dates and Strategy’s bitcoin 8-Ks.

### Schedule it (Windows Task Scheduler)

Option history and open-interest-change charts need **one snapshot per trading day**, so schedule a run after the US close
(≈ 4:15 pm New York time; adjust the clock for your timezone):

```
schtasks /Create /SC DAILY /ST 23:30 /TN "BitcoinProxyTrader refresh" /TR "C:\xampp\htdocs\cc\MSTR\collector\run_all.bat"
```

## Public website (automatic, free)

`deploy/GO-LIVE.md`: push the project to GitHub once; a daily GitHub Actions job collects data, rebuilds the read-only site and publishes it on GitHub Pages — no PC needed.

## Hosting it on a server (phone access from anywhere)

`deploy/DEPLOY.md` walks through a ~$5/month cloud server joined to your Tailscale network: it collects data every day (PC can be off) and serves the dashboard only to
your own devices at `http://mstr-server/`. `deploy/make-package.bat` builds the upload files; `deploy/server-setup.sh` does the whole server install.

## What is on the dashboard

| Page | Contents |
|---|---|
| **Overview** (per ticker) | Hero (price, next earnings + typical move, 7D…since Aug ’20 performance vs BTC), snapshot tiles, then 5 sections: **Price & momentum** (candles 4H/D/W/M/Q, RSI, MAs, RSI swings, Strategy BTC buy/sell markers, RSI trend table with Cardwell definitions, “since last RSI low”, price-vs-MA table & crosses, your own RSI lines) · **Bitcoin & treasury** (beta, correlation, ratio vs 200-day, rolling beta, scatter, treasury card with sources & quarterly history) · **Volatility & options** (VIX/DVOL, IV vs RV, skew, term structure, expirations, OI by strike, OI changes, max pain, volume, $400-call IV watch) · **Seasonality** · **Insiders & filings** |
| **Earnings** | Next date, typical vs options-implied move, every past reaction, EPS vs consensus, basket calendar |
| **Seasonality** | Month, last-5-days-of-month, month×year heatmap, weekday, daily moves by year (MSTR next to BTC) |
| **Chain & GEX** | Gamma flip, call/put walls, GEX by strike and vs price, OI/volume by strike, IV smile, full option chain. Second tab, **Strategy ideas · buy / sell**: real, defined-risk trades built from the chain for weekly, 1–2 month and long-term (6 mo+) expiries — long calls/puts, debit and credit spreads, iron condors, cash-secured puts, and covered calls / protective puts / collars for share owners — each with strikes, mid and natural price, max profit/loss, break-evens, chance of profit, payoff chart and a visible score (regime fit, volatility fit, model edge, levels, liquidity, earnings) |
| **Signals** | Historical tops & lows with RSI, RSI-zone forward returns, BUY/ACCUMULATE/HOLD/REDUCE/SELL regime read, backtest and cross-ticker robustness (see below) |
| **Basket** | All tickers side by side + rebased performance chart + excess return vs BTC |
| **Research** | Correlation matrix, notes, data sources & cost, refresh log |

## Data sources

| Source | Cost | Used for |
|---|---|---|
| Yahoo Finance | free | daily + hourly bars, option chains, shares/market cap, earnings dates |
| SEC EDGAR | free | filings feed, **Form 4** insider trades, Strategy’s weekly **bitcoin 8-Ks**, 10-Q debt / cash / preferred |
| Deribit | free | DVOL (bitcoin 30-day implied vol) |
| Nasdaq | free | next-earnings date / timing cross-check |
| Massive.com (Options Advanced, $199) | optional | back-fills the IV history of the watched option (see below) |

Everything on the dashboard runs on the free sources. The one thing free data cannot provide is **historical implied volatility**;
until a few months of daily snapshots accumulate, IV percentiles show “building”.

### Back-fill with Massive (optional, untested without a key)

1. Put the key in `collector/config.local.json`: `{"massive_api_key": "YOUR_KEY", "python": "…"}` (that file is blocked from web access).
2. `collector\run_all.bat --only watchfill` — pulls daily bars for the watched contract and converts them to IV.
   The contract is set by `watch_contract` in `collector/config.py` (default **MSTR $400 call, 2027-06-17**).

## Database

Database `mstr_terminal` (phpMyAdmin → http://localhost/phpmyadmin). Main tables:

`prices_daily`, `prices_intraday` (1h), `bars_tf` (4H/D/W/M/Q bars + RSI14 + SMAs, computed in Python — single source of truth),
`options_chain` (every contract of every snapshot, with our IV/delta/gamma), `options_summary`, `options_expiry`, `option_watch`, `dvol_daily`,
`sec_filings`, `insider_tx`, `btc_holdings`, `treasury_inputs`, `earnings_events`, `signals_daily`, `rsi_lines`, `notes`, and `analytics`
(precomputed JSON payloads: snapshot tiles, beta, seasonality, signals, …). Example queries are in `docs/queries.sql`.

Credentials: XAMPP default (`root`, no password). To change, create `collector/config.local.json` with a `"db": {…}` block — Python and PHP both read it.
If Apache is reachable from other machines, set a MySQL password.

## The Signals tab — what it is and is not

* **Tops & lows**: zig-zag pivots on closes (25 / 35 / 50 % reversals). A pivot is only *known* after that reversal, so the table also shows when each
  one was confirmed and how far price had already moved by then.
* **RSI**: Wilder RSI(14) on daily/weekly closes; the weekly value uses the in-progress week (what you could see on the day).
* **Score & verdict**: transparent, causal rule set — trend vs 200-day, weekly/daily RSI 50-line momentum, an exhaustion penalty (weekly RSI ≥ 75–85 / extreme stretch),
  a capitulation bonus, and the swing phase after the last confirmed ≥ 35 % pivot. A new verdict must hold 3 sessions.
* **Track record** (shown next to every verdict): forward returns after each state, the rule vs buy-and-hold, vs simple benchmarks (200-day rule, RSI-50 rule),
  year by year, and the same fixed rules on all 12 tickers.

**Honest finding on this data:** the rules reliably *reduce drawdown* (they hold less), but across the 12 tickers they did **not** reliably beat buy-and-hold per unit of risk,
and bullish states out-performed bearish ones on only 4 of 12. On MSTR, bullish states did precede better 63-day returns, yet the long/flat rule still lagged buy-and-hold in total return.
All of it is in-sample (weights were set after seeing this history). Use the page as a **risk gauge and a map of what RSI did around past tops/lows**, not as a prediction.
Not investment advice.

## The Strategy ideas tab

Built by `collector/strategies.py` after every refresh (stored in `analytics`, key `strategies`). It screens real bid/ask quotes, never invents prices, and only shows
defined-risk structures. **Buy** ideas, **sell** ideas and **share-owner** ideas are ranked separately, because whether buying or selling premium is favoured depends on
IV vs realised volatility (it says so on the page). The "model edge" assumes volatility ends up halfway between today’s implied and recent realised vol with zero drift —
an assumption, not a fact. Probabilities use a log-normal model (fat-tail gaps are worse than modelled). Quotes are the last close; always re-check live.

## Known limits

* Free data is end-of-day; Yahoo may throttle (the collector retries). Options open interest updates once per day.
* Option IV/Greeks are our own Black-Scholes on bid/ask mid; GEX assumes dealers are long calls / short puts — a model, not a measurement.
* Strategy’s debt / preferred / cash come from the latest 10-Q, so mNAV lags weekly purchases slightly; shares come from Yahoo’s market cap.
* BTC holdings history is parsed from SEC 8-K text; a handful of weekly filings in older formats may be missing (gaps appear in the statement list).
* Logos load from a public favicon service; if offline they fall back to monograms.
