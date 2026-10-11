"""Black-Scholes-Merton helpers (no dividends): price, delta, gamma, implied vol."""
import math

SQRT2 = math.sqrt(2.0)
SQRT2PI = math.sqrt(2.0 * math.pi)


def ncdf(x):
    return 0.5 * (1.0 + math.erf(x / SQRT2))


def npdf(x):
    return math.exp(-0.5 * x * x) / SQRT2PI


def _d1(S, K, T, r, sig):
    return (math.log(S / K) + (r + 0.5 * sig * sig) * T) / (sig * math.sqrt(T))


def price(S, K, T, r, sig, cp):
    if T <= 0 or sig <= 0:
        return max(0.0, (S - K) if cp == "C" else (K - S))
    d1 = _d1(S, K, T, r, sig)
    d2 = d1 - sig * math.sqrt(T)
    if cp == "C":
        return S * ncdf(d1) - K * math.exp(-r * T) * ncdf(d2)
    return K * math.exp(-r * T) * ncdf(-d2) - S * ncdf(-d1)


def delta(S, K, T, r, sig, cp):
    if T <= 0 or sig <= 0:
        return 0.0
    d1 = _d1(S, K, T, r, sig)
    return ncdf(d1) if cp == "C" else ncdf(d1) - 1.0


def gamma(S, K, T, r, sig):
    if T <= 0 or sig <= 0 or S <= 0:
        return 0.0
    d1 = _d1(S, K, T, r, sig)
    return npdf(d1) / (S * sig * math.sqrt(T))


def implied_vol(mkt, S, K, T, r, cp, lo=0.02, hi=8.0):
    """Bisection IV; None if the price violates no-arbitrage bounds."""
    if mkt is None or mkt <= 0 or T <= 0:
        return None
    intrinsic = max(0.0, (S - K * math.exp(-r * T)) if cp == "C" else (K * math.exp(-r * T) - S))
    if mkt < intrinsic + 1e-4 or (cp == "C" and mkt >= S) or (cp == "P" and mkt >= K):
        return None
    if price(S, K, T, r, hi, cp) < mkt:
        return None
    if price(S, K, T, r, lo, cp) > mkt:
        return lo
    for _ in range(60):
        mid = 0.5 * (lo + hi)
        if price(S, K, T, r, mid, cp) > mkt:
            hi = mid
        else:
            lo = mid
        if hi - lo < 1e-5:
            break
    return 0.5 * (lo + hi)


def vega(S, K, T, r, sig):
    """Price change per 1 vol point (0.01)."""
    if T <= 0 or sig <= 0 or S <= 0:
        return 0.0
    return S * npdf(_d1(S, K, T, r, sig)) * math.sqrt(T) / 100.0


def theta(S, K, T, r, sig, cp):
    """Price change per calendar day."""
    if T <= 0 or sig <= 0 or S <= 0:
        return 0.0
    d1 = _d1(S, K, T, r, sig)
    d2 = d1 - sig * math.sqrt(T)
    base = -S * npdf(d1) * sig / (2 * math.sqrt(T))
    if cp == "C":
        return (base - r * K * math.exp(-r * T) * ncdf(d2)) / 365.0
    return (base + r * K * math.exp(-r * T) * ncdf(-d2)) / 365.0
