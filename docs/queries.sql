-- Example queries against the `mstr_terminal` database (run in phpMyAdmin or `mysql -u root mstr_terminal`).

-- 1. MSTR vs BTC closes side by side (this year)
SELECT m.d, m.close AS mstr, b.close AS btc, ROUND(m.close / b.close * 1000, 4) AS ratio_x1000
FROM prices_daily m JOIN prices_daily b ON b.d = m.d AND b.symbol = 'BTC-USD'
WHERE m.symbol = 'MSTR' AND m.d >= MAKEDATE(YEAR(CURDATE()), 1) ORDER BY m.d;

-- 2. Weekly RSI + 200-day average for any ticker/timeframe (4H, D, W, M, Q)
SELECT t, close, rsi14, sma50, sma200 FROM bars_tf WHERE symbol = 'MSTR' AND tf = 'W' ORDER BY t DESC LIMIT 30;

-- 3. Days when MSTR weekly RSI was below 30, and what the price did 13 weeks later
SELECT a.t AS week, a.rsi14, a.close, b.close AS close_13w_later, ROUND((b.close / a.close - 1) * 100, 1) AS pct_13w
FROM bars_tf a LEFT JOIN bars_tf b ON b.symbol = a.symbol AND b.tf = 'W' AND b.t = DATE_ADD(a.t, INTERVAL 13 WEEK)
WHERE a.symbol = 'MSTR' AND a.tf = 'W' AND a.rsi14 < 30 ORDER BY a.t;

-- 4. Signal history (one row per day) — when did the regime read change?
SELECT d, verdict, score, close, rsi_w FROM signals_daily s
WHERE symbol = 'MSTR' AND (SELECT verdict FROM signals_daily p WHERE p.symbol = s.symbol AND p.d < s.d ORDER BY p.d DESC LIMIT 1) <> s.verdict
ORDER BY d DESC LIMIT 30;

-- 5. Strategy's bitcoin purchases (weekly statements) with implied price paid
SELECT as_of, btc, btc_acquired, ROUND(acq_cost_usd / NULLIF(btc_acquired, 0)) AS avg_price_paid, avg_cost_usd, source_url
FROM btc_holdings ORDER BY as_of DESC LIMIT 20;

-- 6. Option open interest by strike for the nearest expiry (latest snapshot)
SELECT strike, SUM(CASE WHEN opt_type = 'C' THEN oi END) AS call_oi, SUM(CASE WHEN opt_type = 'P' THEN oi END) AS put_oi
FROM options_chain
WHERE symbol = 'MSTR' AND snapshot_date = (SELECT MAX(snapshot_date) FROM options_summary WHERE symbol = 'MSTR')
  AND expiry = (SELECT MIN(expiry) FROM options_chain WHERE symbol = 'MSTR' AND snapshot_date = (SELECT MAX(snapshot_date) FROM options_summary WHERE symbol = 'MSTR'))
GROUP BY strike ORDER BY strike;

-- 7. IV30 history (grows by one row per daily run) next to DVOL
SELECT s.snapshot_date, s.spot, ROUND(s.iv30 * 100, 1) AS iv30_pct, d.close AS dvol
FROM options_summary s LEFT JOIN dvol_daily d ON d.d = s.snapshot_date WHERE s.symbol = 'MSTR' ORDER BY s.snapshot_date DESC;

-- 8. Insider open-market sales over the last year, by person
SELECT owner_name, COUNT(*) AS n, SUM(shares) AS shares, ROUND(SUM(value_usd)) AS usd
FROM insider_tx WHERE symbol = 'MSTR' AND code = 'S' AND tx_date >= DATE_SUB(CURDATE(), INTERVAL 365 DAY)
GROUP BY owner_name ORDER BY usd DESC;

-- 9. Earnings reactions, all tickers, biggest first
SELECT symbol, report_date, timing, move_pct FROM earnings_events WHERE move_pct IS NOT NULL ORDER BY ABS(move_pct) DESC LIMIT 25;

-- 10. 8-K filings that mention Item 2.02 (earnings) in the last 2 years
SELECT symbol, filed, description, url FROM sec_filings WHERE form = '8-K' AND items LIKE '%2.02%' AND filed >= DATE_SUB(CURDATE(), INTERVAL 2 YEAR) ORDER BY filed DESC;
