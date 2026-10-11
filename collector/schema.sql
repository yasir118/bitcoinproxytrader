-- BitcoinProxyTrader schema (MariaDB / MySQL).  Idempotent: safe to run repeatedly.
-- All timestamps are UTC unless the column name says otherwise. Dates are exchange-local trading dates.

CREATE TABLE IF NOT EXISTS tickers (
  symbol      VARCHAR(16)  NOT NULL,
  name        VARCHAR(80)  NOT NULL,
  kind        VARCHAR(10)  NOT NULL,            -- equity | etf | crypto | index
  sort_order  SMALLINT     NOT NULL DEFAULT 0,
  is_tab      TINYINT(1)   NOT NULL DEFAULT 1,  -- shown as a ticker tab
  cik         VARCHAR(10)  NULL,                -- SEC CIK, zero padded
  PRIMARY KEY (symbol)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS prices_daily (
  symbol  VARCHAR(16)   NOT NULL,
  d       DATE          NOT NULL,
  open    DECIMAL(18,6) NULL,
  high    DECIMAL(18,6) NULL,
  low     DECIMAL(18,6) NULL,
  close   DECIMAL(18,6) NOT NULL,               -- split-adjusted, not dividend-adjusted
  volume  BIGINT        NULL,
  PRIMARY KEY (symbol, d)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS prices_intraday (    -- 1-hour bars, ~2y rolling window from Yahoo
  symbol  VARCHAR(16)   NOT NULL,
  ts      DATETIME      NOT NULL,               -- bar open, UTC
  open    DECIMAL(18,6) NULL,
  high    DECIMAL(18,6) NULL,
  low     DECIMAL(18,6) NULL,
  close   DECIMAL(18,6) NOT NULL,
  volume  BIGINT        NULL,
  PRIMARY KEY (symbol, ts)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Derived bars + indicators for every timeframe the chart can show (single source of truth for RSI / MAs).
CREATE TABLE IF NOT EXISTS bars_tf (
  symbol  VARCHAR(16)   NOT NULL,
  tf      VARCHAR(2)    NOT NULL,               -- 4H | D | W | M | Q
  t       DATETIME      NOT NULL,               -- bar open (UTC for 4H, date for the rest)
  open    DECIMAL(18,6) NOT NULL,
  high    DECIMAL(18,6) NOT NULL,
  low     DECIMAL(18,6) NOT NULL,
  close   DECIMAL(18,6) NOT NULL,
  volume  BIGINT        NULL,
  rsi14   DECIMAL(8,4)  NULL,
  sma20   DECIMAL(18,6) NULL,
  sma50   DECIMAL(18,6) NULL,
  sma100  DECIMAL(18,6) NULL,
  sma200  DECIMAL(18,6) NULL,
  ema21   DECIMAL(18,6) NULL,
  PRIMARY KEY (symbol, tf, t)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Arbitrary computed payloads (snapshot tiles, seasonality, beta, signals, ...) as JSON.
CREATE TABLE IF NOT EXISTS analytics (
  symbol      VARCHAR(16) NOT NULL,
  k           VARCHAR(40) NOT NULL,
  payload     LONGTEXT    NOT NULL,
  updated_at  TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (symbol, k)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS company_profile (
  symbol            VARCHAR(16)   NOT NULL,
  name              VARCHAR(120)  NULL,
  exchange          VARCHAR(30)   NULL,
  shares_out        BIGINT        NULL,
  market_cap        DECIMAL(24,2) NULL,
  total_debt        DECIMAL(24,2) NULL,
  total_cash        DECIMAL(24,2) NULL,
  next_earnings     DATE          NULL,
  earnings_is_est   TINYINT(1)    NULL,
  earnings_timing   VARCHAR(8)    NULL,
  updated_at        TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (symbol)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS earnings_events (
  symbol       VARCHAR(16)  NOT NULL,
  report_date  DATE         NOT NULL,           -- date of the press release / 8-K
  timing       VARCHAR(4)   NOT NULL,           -- amc (after close) | bmo (before open / intraday)
  react_date   DATE         NULL,               -- first session that traded on the news
  move_pct     DECIMAL(9,4) NULL,               -- close-to-close % move on react_date
  source       VARCHAR(40)  NULL,
  PRIMARY KEY (symbol, report_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ------------------------------------------------------------------ options
CREATE TABLE IF NOT EXISTS options_chain (
  snapshot_date DATE          NOT NULL,         -- trading date the quotes belong to
  symbol        VARCHAR(16)   NOT NULL,
  expiry        DATE          NOT NULL,
  opt_type      CHAR(1)       NOT NULL,         -- C | P
  strike        DECIMAL(14,4) NOT NULL,
  contract      VARCHAR(32)   NOT NULL,
  last          DECIMAL(14,4) NULL,
  bid           DECIMAL(14,4) NULL,
  ask           DECIMAL(14,4) NULL,
  volume        INT           NULL,
  oi            INT           NULL,
  iv            DECIMAL(10,5) NULL,             -- our own BSM IV from mid (fallback: Yahoo IV)
  delta         DECIMAL(9,6)  NULL,
  gamma         DECIMAL(12,8) NULL,
  PRIMARY KEY (snapshot_date, contract),
  KEY ix_sym_snap_exp (symbol, snapshot_date, expiry),
  KEY ix_contract (contract)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS options_summary (
  snapshot_date DATE          NOT NULL,
  symbol        VARCHAR(16)   NOT NULL,
  spot          DECIMAL(14,4) NULL,
  iv30          DECIMAL(10,5) NULL,
  iv_front      DECIMAL(10,5) NULL,
  skew25        DECIMAL(10,5) NULL,             -- 25d put IV - 25d call IV, interpolated to 30d
  call_oi       BIGINT        NULL,
  put_oi        BIGINT        NULL,
  call_vol      BIGINT        NULL,
  put_vol       BIGINT        NULL,
  net_gex       DECIMAL(24,2) NULL,             -- $ gamma per 1% move, calls +, puts -
  gamma_flip    DECIMAL(14,4) NULL,
  call_wall     DECIMAL(14,4) NULL,
  put_wall      DECIMAL(14,4) NULL,
  rate          DECIMAL(8,5)  NULL,
  PRIMARY KEY (snapshot_date, symbol)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS options_expiry (
  snapshot_date DATE          NOT NULL,
  symbol        VARCHAR(16)   NOT NULL,
  expiry        DATE          NOT NULL,
  dte           INT           NOT NULL,
  call_oi       BIGINT        NULL,
  put_oi        BIGINT        NULL,
  call_vol      BIGINT        NULL,
  put_vol       BIGINT        NULL,
  atm_iv        DECIMAL(10,5) NULL,
  max_pain      DECIMAL(14,4) NULL,
  exp_move_pct  DECIMAL(9,4)  NULL,             -- 1 sigma move implied by ATM IV to expiry
  skew25        DECIMAL(10,5) NULL,
  net_gex       DECIMAL(24,2) NULL,
  PRIMARY KEY (snapshot_date, symbol, expiry)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- history for the single "watched" contract (snapshots + optional Massive back-fill)
CREATE TABLE IF NOT EXISTS option_watch (
  contract  VARCHAR(32)   NOT NULL,
  d         DATE          NOT NULL,
  underlying DECIMAL(14,4) NULL,
  price     DECIMAL(14,4) NULL,                 -- mid (snapshots) or close (back-fill)
  bid       DECIMAL(14,4) NULL,
  ask       DECIMAL(14,4) NULL,
  iv        DECIMAL(10,5) NULL,
  delta     DECIMAL(9,6)  NULL,
  volume    INT           NULL,
  oi        INT           NULL,
  source    VARCHAR(16)   NULL,
  PRIMARY KEY (contract, d)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ------------------------------------------------------------------ volatility
CREATE TABLE IF NOT EXISTS dvol_daily (
  d      DATE         NOT NULL,
  open   DECIMAL(10,4) NULL,
  high   DECIMAL(10,4) NULL,
  low    DECIMAL(10,4) NULL,
  close  DECIMAL(10,4) NOT NULL,
  PRIMARY KEY (d)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ------------------------------------------------------------------ SEC
CREATE TABLE IF NOT EXISTS sec_filings (
  accession   VARCHAR(24)  NOT NULL,
  symbol      VARCHAR(16)  NOT NULL,
  form        VARCHAR(16)  NOT NULL,
  filed       DATE         NOT NULL,
  accepted    DATETIME     NULL,                -- UTC
  report_date DATE         NULL,
  items       VARCHAR(80)  NULL,
  description VARCHAR(200) NULL,
  url         VARCHAR(300) NOT NULL,
  PRIMARY KEY (accession, symbol),
  KEY ix_sym_filed (symbol, filed)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS insider_tx (
  id          BIGINT AUTO_INCREMENT PRIMARY KEY,
  accession   VARCHAR(24)  NOT NULL,
  line_no     SMALLINT     NOT NULL,
  symbol      VARCHAR(16)  NOT NULL,
  owner_name  VARCHAR(100) NOT NULL,
  owner_role  VARCHAR(100) NULL,
  tx_date     DATE         NOT NULL,
  code        CHAR(2)      NOT NULL,            -- P buy, S sale, A award, M exercise, F tax withholding, G gift ...
  acq_disp    CHAR(1)      NULL,                -- A acquired | D disposed
  shares      DECIMAL(20,4) NULL,
  price       DECIMAL(14,4) NULL,
  value_usd   DECIMAL(22,2) NULL,
  shares_after DECIMAL(20,4) NULL,
  is_10b5_1   TINYINT(1)   NULL,
  filed       DATE         NULL,
  url         VARCHAR(300) NULL,
  UNIQUE KEY uq_tx (accession, line_no),
  KEY ix_sym_date (symbol, tx_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ------------------------------------------------------------------ treasury
CREATE TABLE IF NOT EXISTS btc_holdings (
  as_of        DATE          NOT NULL,
  btc          DECIMAL(16,4) NOT NULL,          -- aggregate BTC held
  agg_cost_usd DECIMAL(22,2) NULL,
  avg_cost_usd DECIMAL(16,2) NULL,
  btc_acquired DECIMAL(16,4) NULL,              -- acquired in the reporting period (negative = sold)
  acq_cost_usd DECIMAL(22,2) NULL,
  accession    VARCHAR(24)   NULL,
  source_url   VARCHAR(300)  NULL,
  source_kind  VARCHAR(12)   NULL,              -- 8-K | 10-Q | 10-K | manual
  PRIMARY KEY (as_of)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS treasury_inputs (    -- balance-sheet inputs to mNAV, each with its provenance
  as_of      DATE          NOT NULL,
  k          VARCHAR(40)   NOT NULL,            -- debt | preferred_notional | cash | shares_out ...
  value      DECIMAL(26,2) NOT NULL,
  source     VARCHAR(40)   NULL,
  source_url VARCHAR(300)  NULL,
  note       VARCHAR(200)  NULL,
  PRIMARY KEY (as_of, k)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ------------------------------------------------------------------ signals
CREATE TABLE IF NOT EXISTS signals_daily (
  symbol  VARCHAR(16)  NOT NULL,
  d       DATE         NOT NULL,
  score   DECIMAL(7,2) NOT NULL,                -- -100 (sell) .. +100 (buy)
  verdict VARCHAR(12)  NOT NULL,                -- BUY | ACCUMULATE | HOLD | REDUCE | SELL
  close   DECIMAL(18,6) NULL,
  rsi_d   DECIMAL(8,4) NULL,
  rsi_w   DECIMAL(8,4) NULL,
  PRIMARY KEY (symbol, d)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ------------------------------------------------------------------ user data
CREATE TABLE IF NOT EXISTS rsi_lines (          -- "Key RSI lines (your saved trendlines)"
  id         INT AUTO_INCREMENT PRIMARY KEY,
  symbol     VARCHAR(16)  NOT NULL,
  tf         VARCHAR(2)   NOT NULL,
  label      VARCHAR(60)  NULL,
  t1         DATE         NOT NULL,
  v1         DECIMAL(8,3) NOT NULL,
  t2         DATE         NOT NULL,
  v2         DECIMAL(8,3) NOT NULL,
  created_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY ix_sym_tf (symbol, tf)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS notes (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  symbol     VARCHAR(16)  NULL,
  body       TEXT         NOT NULL,
  created_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ------------------------------------------------------------------ housekeeping
CREATE TABLE IF NOT EXISTS meta (
  k          VARCHAR(40)  NOT NULL,
  v          VARCHAR(400) NULL,
  updated_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (k)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS refresh_log (
  id        INT AUTO_INCREMENT PRIMARY KEY,
  job       VARCHAR(40)  NOT NULL,
  started   DATETIME     NOT NULL,
  finished  DATETIME     NULL,
  status    VARCHAR(10)  NOT NULL,
  message   VARCHAR(400) NULL,
  KEY ix_started (started)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- remembers which SEC documents were already parsed (8-K bitcoin updates, Form 4s) so refreshes are incremental
CREATE TABLE IF NOT EXISTS filing_parsed (
  accession  VARCHAR(24) NOT NULL,
  kind       VARCHAR(12) NOT NULL,
  symbol     VARCHAR(16) NULL,
  result     VARCHAR(40) NULL,
  parsed_at  TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (accession, kind)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
