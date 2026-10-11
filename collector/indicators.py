"""Pure-python technical-analysis primitives (no numpy needed).

Conventions
-----------
* Series are plain lists; positions without enough history are None.
* RSI is Wilder's RSI(14) -- the same smoothing TradingView / Yahoo use.
* Bars are dicts: {"t": datetime.date|datetime.datetime, "o","h","l","c","v"}.
"""
import datetime as dt
import math
from bisect import bisect_left


# ----------------------------------------------------------------------------- moving averages / RSI
def sma(vals, n):
    out = [None] * len(vals)
    s = 0.0
    for i, v in enumerate(vals):
        s += v
        if i >= n:
            s -= vals[i - n]
        if i >= n - 1:
            out[i] = s / n
    return out


def ema(vals, n):
    out = [None] * len(vals)
    if len(vals) < n:
        return out
    k = 2.0 / (n + 1)
    e = sum(vals[:n]) / n
    out[n - 1] = e
    for i in range(n, len(vals)):
        e = vals[i] * k + e * (1 - k)
        out[i] = e
    return out


def rsi_wilder(closes, n=14):
    out = [None] * len(closes)
    if len(closes) <= n:
        return out
    gains = losses = 0.0
    for i in range(1, n + 1):
        d = closes[i] - closes[i - 1]
        gains += max(d, 0.0)
        losses += max(-d, 0.0)
    ag, al = gains / n, losses / n
    out[n] = 100.0 if al == 0 else 100.0 - 100.0 / (1.0 + ag / al)
    for i in range(n + 1, len(closes)):
        d = closes[i] - closes[i - 1]
        ag = (ag * (n - 1) + max(d, 0.0)) / n
        al = (al * (n - 1) + max(-d, 0.0)) / n
        out[i] = 100.0 if al == 0 else 100.0 - 100.0 / (1.0 + ag / al)
    return out


def pct_change(vals):
    return [None] + [(vals[i] / vals[i - 1] - 1.0) if vals[i - 1] else None for i in range(1, len(vals))]


def log_returns(vals):
    return [None] + [math.log(vals[i] / vals[i - 1]) if vals[i - 1] > 0 and vals[i] > 0 else None for i in range(1, len(vals))]


def stdev(xs):
    n = len(xs)
    if n < 2:
        return None
    m = sum(xs) / n
    return math.sqrt(sum((x - m) ** 2 for x in xs) / (n - 1))


def realized_vol(closes, n, ann=365):
    """Annualised close-to-close realised vol over a trailing window of n returns (None until available)."""
    lr = log_returns(closes)
    out = [None] * len(closes)
    for i in range(n, len(closes)):
        w = lr[i - n + 1:i + 1]
        if None in w:
            continue
        out[i] = stdev(w) * math.sqrt(ann)
    return out


# ----------------------------------------------------------------------------- resampling
def week_start(d):
    return d - dt.timedelta(days=d.weekday())


def month_start(d):
    return d.replace(day=1)


def quarter_start(d):
    return d.replace(month=3 * ((d.month - 1) // 3) + 1, day=1)


_KEYFN = {"W": week_start, "M": month_start, "Q": quarter_start, "D": lambda d: d}


def resample(daily, tf):
    """daily: list of dict(t=date,o,h,l,c,v) ascending.  tf in D/W/M/Q."""
    if tf == "D":
        return [dict(b) for b in daily]
    key = _KEYFN[tf]
    out, cur, ck = [], None, None
    for b in daily:
        k = key(b["t"])
        if k != ck:
            if cur:
                out.append(cur)
            cur = {"t": k, "o": b["o"], "h": b["h"], "l": b["l"], "c": b["c"], "v": b["v"] or 0, "last": b["t"]}
            ck = k
        else:
            cur["h"] = max(cur["h"], b["h"])
            cur["l"] = min(cur["l"], b["l"])
            cur["c"] = b["c"]
            cur["v"] += b["v"] or 0
            cur["last"] = b["t"]
    if cur:
        out.append(cur)
    return out


def us_et_offset_hours(utc):
    """-4 during US daylight time, else -5 (2nd Sun Mar 07:00Z .. 1st Sun Nov 06:00Z)."""
    y = utc.year
    d = dt.datetime(y, 3, 1)
    d += dt.timedelta(days=(6 - d.weekday()) % 7 + 7)       # second Sunday of March
    start = d.replace(hour=7)
    e = dt.datetime(y, 11, 1)
    e += dt.timedelta(days=(6 - e.weekday()) % 7)           # first Sunday of November
    end = e.replace(hour=6)
    return -4 if start <= utc < end else -5


def resample_4h(hourly, crypto):
    """hourly: [{'t': naive-UTC datetime, o,h,l,c,v}].  Crypto: 00/04/08.. UTC buckets.
    Equities: two sessions per day in New-York time (09:30-13:29 and 13:30-16:00)."""
    out, cur, ck = [], None, None
    for b in hourly:
        t = b["t"]
        if crypto:
            k = t.replace(hour=(t.hour // 4) * 4, minute=0, second=0, microsecond=0)
        else:
            et = t + dt.timedelta(hours=us_et_offset_hours(t))
            half = 0 if (et.hour, et.minute) < (13, 30) else 1
            kk = et.replace(hour=9 if half == 0 else 13, minute=30, second=0, microsecond=0)
            k = kk - dt.timedelta(hours=us_et_offset_hours(t))          # back to UTC
        if k != ck:
            if cur:
                out.append(cur)
            cur = {"t": k, "o": b["o"], "h": b["h"], "l": b["l"], "c": b["c"], "v": b["v"] or 0}
            ck = k
        else:
            cur["h"] = max(cur["h"], b["h"])
            cur["l"] = min(cur["l"], b["l"])
            cur["c"] = b["c"]
            cur["v"] += b["v"] or 0
    if cur:
        out.append(cur)
    return out


def with_indicators(bars):
    closes = [b["c"] for b in bars]
    r = rsi_wilder(closes, 14)
    s20, s50, s100, s200 = (sma(closes, n) for n in (20, 50, 100, 200))
    e21 = ema(closes, 21)
    for i, b in enumerate(bars):
        b["rsi"], b["sma20"], b["sma50"], b["sma100"], b["sma200"], b["ema21"] = r[i], s20[i], s50[i], s100[i], s200[i], e21[i]
    return bars


# ----------------------------------------------------------------------------- swings
def zigzag(vals, thresh, mode="abs"):
    """Confirmed swing pivots of a series (classic zig-zag).

    thresh: minimum reversal -- absolute units (RSI points) for mode='abs', a fraction (0.25 = 25 %) for mode='pct'.
    Returns [(index, value, 'H'|'L', confirmed)].  The last element is the still-developing extreme
    (confirmed=False); every earlier pivot was confirmed by a reversal of at least `thresh`.
    """
    pts = [(i, v) for i, v in enumerate(vals) if v is not None]
    if len(pts) < 3:
        return []

    def rise(lo, v):
        return v - lo if mode == "abs" else (v / lo - 1.0 if lo > 0 else 0.0)

    def drop(hi, v):
        return hi - v if mode == "abs" else (1.0 - v / hi if hi > 0 else 0.0)

    out = []
    trend = 0
    hi = lo = pts[0]
    for i, v in pts[1:]:
        if trend == 0:
            if v > hi[1]:
                hi = (i, v)
            if v < lo[1]:
                lo = (i, v)
            if hi[0] > lo[0] and rise(lo[1], hi[1]) >= thresh:
                out.append((lo[0], lo[1], "L", True))
                trend, lo = 1, (i, v)
            elif lo[0] > hi[0] and drop(hi[1], lo[1]) >= thresh:
                out.append((hi[0], hi[1], "H", True))
                trend, hi = -1, (i, v)
        elif trend == 1:
            if v > hi[1]:
                hi = (i, v)
            elif drop(hi[1], v) >= thresh:
                out.append((hi[0], hi[1], "H", True))
                trend, lo = -1, (i, v)
        else:
            if v < lo[1]:
                lo = (i, v)
            elif rise(lo[1], v) >= thresh:
                out.append((lo[0], lo[1], "L", True))
                trend, hi = 1, (i, v)
    if trend == 1:
        out.append((hi[0], hi[1], "H", False))
    elif trend == -1:
        out.append((lo[0], lo[1], "L", False))
    return out


def swing_trend(pivots):
    """Classify RSI/price swing structure from its last two highs and two lows."""
    highs = [p for p in pivots if p[2] == "H"]
    lows = [p for p in pivots if p[2] == "L"]
    if len(highs) < 2 or len(lows) < 2:
        return "n/a"
    hh = highs[-1][1] > highs[-2][1]
    hl = lows[-1][1] > lows[-2][1]
    if hh and hl:
        return "Up"
    if (not hh) and (not hl):
        return "Down"
    return "Widening" if hh and not hl else "Narrowing"


def cardwell_range(rsi_vals, lookback):
    """Cardwell range rules: bull market RSI lives in 40-80 (supports 40-50); bear market 20-60 (resistance 50-60)."""
    w = [v for v in rsi_vals[-lookback:] if v is not None]
    if len(w) < 10:
        return {"range": "n/a", "lo": None, "hi": None}
    lo, hi = min(w), max(w)
    cur = w[-1]
    if hi >= 65 and lo >= 33:
        rng = "Bull range (40-80)"
    elif hi <= 62 and lo <= 42:
        rng = "Bear range (20-60)"
    else:
        rng = "Transition"
    return {"range": rng, "lo": round(lo, 1), "hi": round(hi, 1), "cur": round(cur, 1)}


# ----------------------------------------------------------------------------- stats
def percentile_rank(sorted_vals, x):
    if not sorted_vals:
        return None
    return 100.0 * bisect_left(sorted_vals, x) / len(sorted_vals)


def mean(xs):
    xs = [x for x in xs if x is not None]
    return sum(xs) / len(xs) if xs else None


def median(xs):
    xs = sorted(x for x in xs if x is not None)
    n = len(xs)
    if not n:
        return None
    return xs[n // 2] if n % 2 else (xs[n // 2 - 1] + xs[n // 2]) / 2


def beta_corr(y, x):
    """OLS beta of y on x and their correlation (lists of equal length, no Nones)."""
    n = len(x)
    if n < 5:
        return None, None
    mx, my = sum(x) / n, sum(y) / n
    sxx = sum((a - mx) ** 2 for a in x)
    syy = sum((b - my) ** 2 for b in y)
    sxy = sum((a - mx) * (b - my) for a, b in zip(x, y))
    if sxx == 0 or syy == 0:
        return None, None
    return sxy / sxx, sxy / math.sqrt(sxx * syy)


def cross_events(fast, slow, dates, max_events=6):
    """Dates when `fast` crossed `slow` (up = golden, down = death)."""
    ev = []
    prev = None
    for i in range(len(fast)):
        if fast[i] is None or slow[i] is None:
            continue
        s = 1 if fast[i] > slow[i] else -1
        if prev is not None and s != prev:
            ev.append({"d": dates[i], "dir": "up" if s == 1 else "down"})
        prev = s
    return ev[-max_events:]
