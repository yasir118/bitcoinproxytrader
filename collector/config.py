"""Central configuration for the BitcoinProxyTrader collector.

Defaults work out-of-the-box with a stock XAMPP install (MariaDB root, no password).
Override anything by creating  collector/config.local.json  (never commit it), e.g.

    {
      "db": {"host": "127.0.0.1", "port": 3306, "user": "root", "password": "", "name": "mstr_terminal"},
      "sec_user_agent": "BitcoinProxyTrader you@example.com",
      "massive_api_key": "xxxxxxxx",
      "watch_contract": {"symbol": "MSTR", "type": "C", "strike": 400, "expiry": "2027-06-17"}
    }

The PHP API reads the same file, so database credentials live in exactly one place.
"""
import json
import os

ROOT = os.path.dirname(os.path.abspath(__file__))
LOG_DIR = os.path.join(ROOT, "logs")

# ticker, display name, kind.  Order == tab order in the UI.
TICKERS = [
    ("MSTR", "Strategy Inc", "equity"),
    ("COIN", "Coinbase Global, Inc.", "equity"),
    ("IBIT", "iShares Bitcoin Trust ETF", "etf"),
    ("CRCL", "Circle Internet Group", "equity"),
    ("ASST", "Strive, Inc.", "equity"),
    ("XYZ", "Block, Inc.", "equity"),
    ("MARA", "MARA Holdings, Inc.", "equity"),
    ("RIOT", "Riot Platforms, Inc.", "equity"),
    ("IREN", "IREN Limited", "equity"),
    ("CLSK", "CleanSpark, Inc.", "equity"),
    ("BTDR", "Bitdeer Technologies Group", "equity"),
    ("GLXY", "Galaxy Digital", "equity"),
    ("XXI", "Twenty One Capital, Inc.", "equity"),
]
# Reference series stored next to the tickers but not shown as tabs.
REFERENCE = [
    ("BTC-USD", "Bitcoin", "crypto"),
    ("^VIX", "CBOE Volatility Index", "index"),
    ("^IRX", "13-Week Treasury Bill Yield", "index"),
]

BTC = "BTC-USD"
EQUITY_SYMBOLS = [t[0] for t in TICKERS]
ALL_SYMBOLS = EQUITY_SYMBOLS + [r[0] for r in REFERENCE]

# MSTR's first bitcoin purchase was announced on 2020-08-11; "since Aug '20" performance starts here.
BTC_ERA_START = "2020-08-11"

# Which tickers get an options-chain snapshot every run.
OPTIONS_TICKERS = EQUITY_SYMBOLS
# Option contracts further than this multiple of spot are dropped to keep the table lean.
OPTIONS_STRIKE_BAND = (0.35, 2.6)
# The single contract highlighted in "Option IV watch".
WATCH_CONTRACT = {"symbol": "MSTR", "type": "C", "strike": 400.0, "expiry": "2027-06-17"}

# Form 4 insider parsing: look-back window and max filings per ticker per run.
INSIDER_LOOKBACK_DAYS = 760
INSIDER_MAX_FILINGS = 260
# How many days of SEC filings to keep in the feed.
FILINGS_LOOKBACK_DAYS = 1500

DEFAULTS = {
    "db": {"host": "127.0.0.1", "port": 3306, "user": "root", "password": "", "name": "mstr_terminal"},
    # SEC requires a descriptive User-Agent with contact info.
    "sec_user_agent": "BitcoinProxyTrader research (open-source dashboard) noreply@users.noreply.github.com",
    # Optional paid sources (leave empty = skipped).
    "massive_api_key": "",
    "massive_base_url": "https://api.massive.com",
    "watch_contract": WATCH_CONTRACT,
}


def load():
    cfg = json.loads(json.dumps(DEFAULTS))
    path = os.path.join(ROOT, "config.local.json")
    if os.path.exists(path):
        with open(path, "r", encoding="utf-8") as fh:
            user = json.load(fh)
        for k, v in user.items():
            if isinstance(v, dict) and isinstance(cfg.get(k), dict):
                cfg[k].update(v)
            else:
                cfg[k] = v
    return cfg


CFG = load()
