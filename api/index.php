<?php
/**
 * BitcoinProxyTrader JSON API  --  thin read layer over the MariaDB database filled by collector/*.py
 * Usage: api/index.php?r=<route>&symbol=MSTR ...
 */
declare(strict_types=1);
require __DIR__ . '/config.php';

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

try {
    $r = $_GET['r'] ?? 'meta';
    $routes = [
        'meta' => 'r_meta', 'overview' => 'r_overview', 'bars' => 'r_bars', 'analytics' => 'r_analytics', 'basket' => 'r_basket',
        'basket_series' => 'r_basket_series', 'options' => 'r_options', 'optwatch' => 'r_optwatch', 'vol' => 'r_vol',
        'insiders' => 'r_insiders', 'filings' => 'r_filings', 'treasury' => 'r_treasury', 'signals' => 'r_signals',
        'earnings' => 'r_earnings', 'research' => 'r_research', 'rsi_lines' => 'r_rsi_lines', 'notes' => 'r_notes',
        'chain' => 'r_chain', 'refresh' => 'r_refresh', 'refresh_status' => 'r_refresh_status',
    ];
    if (!isset($routes[$r])) {
        out(['error' => 'unknown route'], 404);
    }
    out($routes[$r]());
} catch (Throwable $e) {
    out(['error' => $e->getMessage()], 500);
}

// ------------------------------------------------------------------------------------------------ helpers
function out($data, int $code = 200): void
{
    http_response_code($code);
    echo json_encode($data, JSON_UNESCAPED_SLASHES | JSON_INVALID_UTF8_SUBSTITUTE | JSON_PARTIAL_OUTPUT_ON_ERROR);
    exit;
}

function sym(): string
{
    $s = strtoupper(trim((string)($_GET['symbol'] ?? 'MSTR')));
    if (!preg_match('/^[A-Z0-9.\^-]{1,16}$/', $s)) {
        out(['error' => 'bad symbol'], 400);
    }
    return $s;
}

function q(string $sql, array $args = []): array
{
    $st = db()->prepare($sql);
    $st->execute($args);
    return $st->fetchAll();
}

function q1(string $sql, array $args = []): ?array
{
    $rows = q($sql, $args);
    return $rows[0] ?? null;
}

function f($v): ?float
{
    return ($v === null || $v === '') ? null : (float)$v;
}

function an(string $symbol, string $key)
{
    $row = q1('SELECT payload, updated_at FROM analytics WHERE symbol=? AND k=?', [$symbol, $key]);
    return $row ? json_decode($row['payload'], true) : null;
}

function body(): array
{
    $j = json_decode(file_get_contents('php://input') ?: '[]', true);
    return is_array($j) ? $j : [];
}

/** Trusted clients may start a data refresh: this machine itself, or a device on your own Tailscale network (100.64.0.0/10). */
function is_local(): bool
{
    $ip = $_SERVER['REMOTE_ADDR'] ?? '';
    if (in_array($ip, ['127.0.0.1', '::1'], true)) {
        return true;
    }
    if (filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_IPV4)) {
        $n = ip2long($ip);
        return $n !== false && (($n & 0xFFC00000) === 0x64400000);
    }
    return false;
}

// ------------------------------------------------------------------------------------------------ routes
function r_meta(): array
{
    $tickers = q('SELECT symbol,name,kind,sort_order,is_tab FROM tickers ORDER BY sort_order');
    $meta = [];
    foreach (q('SELECT k,v,updated_at FROM meta') as $m) {
        $meta[$m['k']] = $m['v'];
    }
    $through = q1("SELECT MAX(d) d FROM prices_daily WHERE symbol='MSTR'");
    $btc = q1("SELECT MAX(d) d FROM prices_daily WHERE symbol='BTC-USD'");
    $snap = q1("SELECT MAX(snapshot_date) d FROM options_summary WHERE symbol='MSTR'");
    $dvol = q1('SELECT MAX(d) d FROM dvol_daily');
    $counts = [
        'daily_rows' => (int)q1('SELECT COUNT(*) n FROM prices_daily')['n'],
        'hourly_rows' => (int)q1('SELECT COUNT(*) n FROM prices_intraday')['n'],
        'option_rows' => (int)q1('SELECT COUNT(*) n FROM options_chain')['n'],
        'option_snapshots' => (int)q1('SELECT COUNT(DISTINCT snapshot_date) n FROM options_summary')['n'],
        'filings' => (int)q1('SELECT COUNT(*) n FROM sec_filings')['n'],
        'insider_tx' => (int)q1('SELECT COUNT(*) n FROM insider_tx')['n'],
        'btc_statements' => (int)q1('SELECT COUNT(*) n FROM btc_holdings')['n'],
    ];
    return [
        'tickers' => $tickers,
        'data_through' => $through['d'] ?? null, 'btc_through' => $btc['d'] ?? null,
        'options_snapshot' => $snap['d'] ?? null, 'dvol_through' => $dvol['d'] ?? null,
        'last_refreshed' => $meta['last_refreshed'] ?? null, 'signals_updated' => $meta['signals_updated'] ?? null,
        'counts' => $counts, 'server_time' => gmdate('Y-m-d H:i:s'),
    ];
}

function r_overview(): array
{
    $s = sym();
    $snap = an($s, 'snapshot');
    if (!$snap) {
        out(['error' => "no analytics for $s yet - run the collector"], 404);
    }
    $prof = q1('SELECT * FROM company_profile WHERE symbol=?', [$s]);
    $tk = q1('SELECT name,kind,cik FROM tickers WHERE symbol=?', [$s]);
    $earn = an($s, 'earnings');
    $opt = q1('SELECT * FROM options_summary WHERE symbol=? ORDER BY snapshot_date DESC LIMIT 1', [$s]);
    $treasury = $s === 'MSTR' ? an('MSTR', 'treasury') : null;
    $trend = an($s, 'rsi_trend');
    $since = an($s, 'since_rsi_low');
    $ma = an($s, 'ma');
    $beta = an($s, 'beta');
    $sig = an($s, 'signals');
    return [
        'symbol' => $s, 'name' => $prof['name'] ?? $tk['name'] ?? $s, 'kind' => $tk['kind'] ?? 'equity', 'exchange' => $prof['exchange'] ?? null,
        'snapshot' => $snap,
        'profile' => $prof ? [
            'shares_out' => f($prof['shares_out']), 'market_cap' => f($prof['market_cap']), 'total_debt' => f($prof['total_debt']),
            'total_cash' => f($prof['total_cash']), 'next_earnings' => $prof['next_earnings'], 'earnings_is_est' => $prof['earnings_is_est'],
            'earnings_timing' => $prof['earnings_timing'], 'updated_at' => $prof['updated_at'],
        ] : null,
        'earnings' => $earn ? array_diff_key($earn, ['events' => 1, 'eps' => 1]) : null,
        'options' => $opt ? [
            'date' => $opt['snapshot_date'], 'iv30' => f($opt['iv30']), 'iv_front' => f($opt['iv_front']), 'skew25' => f($opt['skew25']),
            'spot' => f($opt['spot']), 'net_gex' => f($opt['net_gex']), 'gamma_flip' => f($opt['gamma_flip']),
        ] : null,
        'treasury' => $treasury ? [
            'btc' => $treasury['btc'], 'avg_cost' => $treasury['avg_cost'], 'mnav_ev' => $treasury['mnav_ev'], 'mnav_mcap' => $treasury['mnav_mcap'],
            'as_of' => $treasury['as_of'],
        ] : null,
        'rsi_trend' => $trend, 'since_rsi_low' => $since, 'ma' => $ma,
        'beta' => $beta ? ['table' => $beta['table'], 'ratio_now' => $beta['ratio_now'], 'ratio_pctile' => $beta['ratio_pctile'],
            'ratio_sma200' => $beta['ratio_sma200'], 'ratio_min' => $beta['ratio_min'], 'ratio_max' => $beta['ratio_max'],
            'ratio_median' => $beta['ratio_median']] : null,
        'signal' => $sig ? ['verdict' => $sig['now']['verdict'], 'score' => $sig['now']['score'], 'since' => $sig['now']['since']] : null,
    ];
}

function r_bars(): array
{
    $s = sym();
    $tf = strtoupper((string)($_GET['tf'] ?? 'D'));
    if (!in_array($tf, ['4H', 'D', 'W', 'M', 'Q'], true)) {
        out(['error' => 'bad tf'], 400);
    }
    $limits = ['4H' => 1400, 'D' => 2600, 'W' => 900, 'M' => 400, 'Q' => 200];
    $limit = min((int)($_GET['limit'] ?? $limits[$tf]), 8000);
    $rows = q("SELECT t,open,high,low,close,volume,rsi14,sma20,sma50,sma100,sma200,ema21 FROM bars_tf WHERE symbol=? AND tf=? ORDER BY t DESC LIMIT $limit", [$s, $tf]);
    $rows = array_reverse($rows);
    $o = [];
    foreach ($rows as $r) {
        $t = $tf === '4H' ? strtotime($r['t'] . ' UTC') : substr($r['t'], 0, 10);
        $o[] = [$t, f($r['open']), f($r['high']), f($r['low']), f($r['close']), (int)$r['volume'], f($r['rsi14']), f($r['sma20']), f($r['sma50']),
            f($r['sma100']), f($r['sma200']), f($r['ema21'])];
    }
    return ['symbol' => $s, 'tf' => $tf, 'cols' => ['t', 'o', 'h', 'l', 'c', 'v', 'rsi', 's20', 's50', 's100', 's200', 'e21'], 'rows' => $o];
}

function r_analytics(): array
{
    $s = sym();
    $k = (string)($_GET['k'] ?? '');
    $allowed = ['snapshot', 'rsi_trend', 'since_rsi_low', 'ma', 'beta', 'seasonality', 'vol', 'earnings', 'treasury', 'signals', 'corr', 'signals_robust', 'gex_curve', 'strategies'];
    if (!in_array($k, $allowed, true)) {
        out(['error' => 'bad key'], 400);
    }
    $v = an($s, $k);
    if ($v === null) {
        out(['error' => 'not found'], 404);
    }
    return $v;
}

function r_basket(): array
{
    $rows = q("SELECT t.symbol,t.name,t.sort_order FROM tickers t WHERE t.is_tab=1 ORDER BY t.sort_order");
    $res = [];
    foreach ($rows as $t) {
        $s = $t['symbol'];
        $snap = an($s, 'snapshot');
        if (!$snap) {
            continue;
        }
        $e = q1('SELECT next_earnings FROM company_profile WHERE symbol=?', [$s]);
        $sg = q1("SELECT verdict, score FROM signals_daily WHERE symbol=? ORDER BY d DESC LIMIT 1", [$s]);
        $res[] = [
            'symbol' => $s, 'name' => $t['name'], 'close' => $snap['close'], 'chg_pct' => $snap['chg_pct'], 'perf' => $snap['perf'],
            'rsi' => $snap['rsi'], 'trend' => $snap['trend'], 'ma' => $snap['ma']['above'] . '/' . $snap['ma']['of'], 'vs_200d' => $snap['vs_200d'],
            'rv20' => $snap['rv20'], 'iv30' => $snap['iv30'] ?? null, 'beta' => $snap['beta'] ?? null, 'from_ath' => $snap['from_ath'],
            'next_earnings' => $e['next_earnings'] ?? null, 'ratio_pctile' => $snap['ratio_pctile'] ?? null, 'last_date' => $snap['last_date'],
            'verdict' => $sg['verdict'] ?? null, 'score' => isset($sg['score']) ? (float)$sg['score'] : null,
        ];
    }
    $btc = an('BTC-USD', 'snapshot');
    return ['rows' => $res, 'btc' => $btc ? ['close' => $btc['close'], 'chg_pct' => $btc['chg_pct'], 'perf' => $btc['perf'], 'rsi' => $btc['rsi'],
        'trend' => $btc['trend'], 'vs_200d' => $btc['vs_200d'], 'rv20' => $btc['rv20'], 'from_ath' => $btc['from_ath'], 'last_date' => $btc['last_date']] : null];
}

function r_basket_series(): array
{
    $days = max(30, min((int)($_GET['days'] ?? 365), 3000));
    $since = date('Y-m-d', strtotime("-$days days"));
    $syms = array_column(q('SELECT symbol FROM tickers WHERE is_tab=1 ORDER BY sort_order'), 'symbol');
    $syms[] = 'BTC-USD';
    $in = implode(',', array_fill(0, count($syms), '?'));
    $rows = q("SELECT symbol,d,close FROM prices_daily WHERE symbol IN ($in) AND d>=? ORDER BY d", array_merge($syms, [$since]));
    $dates = [];
    $by = [];
    foreach ($rows as $r) {
        $dates[$r['d']] = true;
        $by[$r['symbol']][$r['d']] = (float)$r['close'];
    }
    // trading-day axis = days when MSTR traded
    $axis = array_keys($by['MSTR'] ?? []);
    sort($axis);
    $series = [];
    foreach ($by as $s => $m) {
        $arr = [];
        foreach ($axis as $d) {
            $arr[] = $m[$d] ?? null;
        }
        $series[$s] = $arr;
    }
    return ['dates' => $axis, 'series' => $series];
}

function r_options(): array
{
    $s = sym();
    $snap = q1('SELECT MAX(snapshot_date) d FROM options_summary WHERE symbol=?', [$s])['d'] ?? null;
    if (!$snap) {
        return ['symbol' => $s, 'available' => false];
    }
    $prev = q1('SELECT MAX(snapshot_date) d FROM options_summary WHERE symbol=? AND snapshot_date<?', [$s, $snap])['d'] ?? null;
    $sum = q1('SELECT * FROM options_summary WHERE symbol=? AND snapshot_date=?', [$s, $snap]);
    $spot = (float)$sum['spot'];
    $exp = q('SELECT * FROM options_expiry WHERE symbol=? AND snapshot_date=? ORDER BY expiry', [$s, $snap]);
    $sel = (string)($_GET['exp'] ?? 'all');
    $where = ' WHERE symbol=? AND snapshot_date=?';
    $args = [$s, $snap];
    if (preg_match('/^\d{4}-\d{2}-\d{2}$/', $sel)) {
        $where .= ' AND expiry=?';
        $args[] = $sel;
    } elseif ($sel === 'next') {
        $where .= ' AND expiry=?';
        $args[] = $exp[0]['expiry'] ?? $snap;
    }
    $agg = "SELECT strike,
        SUM(CASE WHEN opt_type='C' THEN oi ELSE 0 END) call_oi, SUM(CASE WHEN opt_type='P' THEN oi ELSE 0 END) put_oi,
        SUM(CASE WHEN opt_type='C' THEN volume ELSE 0 END) call_vol, SUM(CASE WHEN opt_type='P' THEN volume ELSE 0 END) put_vol,
        SUM((CASE WHEN opt_type='C' THEN 1 ELSE -1 END) * COALESCE(gamma,0) * COALESCE(oi,0) * 100 * ? * ? * 0.01) gex
        FROM options_chain $where GROUP BY strike ORDER BY strike";
    $strikes = q($agg, array_merge([$spot, $spot], $args));
    $prevMap = [];
    if ($prev) {
        $pargs = $args;
        $pargs[1] = $prev;
        foreach (q("SELECT strike, SUM(CASE WHEN opt_type='C' THEN oi ELSE 0 END) call_oi, SUM(CASE WHEN opt_type='P' THEN oi ELSE 0 END) put_oi
                    FROM options_chain $where GROUP BY strike", $pargs) as $p) {
            $prevMap[(string)(float)$p['strike']] = [(int)$p['call_oi'], (int)$p['put_oi']];
        }
    }
    $st = [];
    foreach ($strikes as $r) {
        $k = (float)$r['strike'];
        if ($k < $spot * 0.3 || $k > $spot * 2.4) {
            continue;
        }
        $p = $prevMap[(string)$k] ?? null;
        $st[] = ['k' => $k, 'coi' => (int)$r['call_oi'], 'poi' => (int)$r['put_oi'], 'cv' => (int)$r['call_vol'], 'pv' => (int)$r['put_vol'],
            'gex' => round((float)$r['gex']), 'dcoi' => $p ? (int)$r['call_oi'] - $p[0] : null, 'dpoi' => $p ? (int)$r['put_oi'] - $p[1] : null];
    }
    $hist = q('SELECT snapshot_date d, iv30, iv_front, skew25, call_oi, put_oi, call_vol, put_vol, net_gex, spot FROM options_summary
               WHERE symbol=? ORDER BY snapshot_date DESC LIMIT 500', [$s]);
    $hist = array_reverse($hist);
    foreach ($hist as &$h) {
        foreach (['iv30', 'iv_front', 'skew25', 'spot'] as $c) {
            $h[$c] = f($h[$c]);
        }
        $h['net_gex'] = f($h['net_gex']);
        foreach (['call_oi', 'put_oi', 'call_vol', 'put_vol'] as $c) {
            $h[$c] = (int)$h[$c];
        }
    }
    unset($h);
    $expOut = [];
    foreach ($exp as $e) {
        $expOut[] = ['expiry' => $e['expiry'], 'dte' => (int)$e['dte'], 'call_oi' => (int)$e['call_oi'], 'put_oi' => (int)$e['put_oi'],
            'call_vol' => (int)$e['call_vol'], 'put_vol' => (int)$e['put_vol'], 'atm_iv' => f($e['atm_iv']), 'max_pain' => f($e['max_pain']),
            'exp_move' => f($e['exp_move_pct']), 'skew25' => f($e['skew25']), 'gex' => f($e['net_gex'])];
    }
    // contracts with the biggest OI change vs previous snapshot
    $chg = [];
    if ($prev) {
        $chg = q("SELECT c.contract, c.expiry, c.opt_type t, c.strike, c.oi, c.oi - COALESCE(p.oi,0) d_oi, c.volume, c.iv
                  FROM options_chain c LEFT JOIN options_chain p ON p.contract=c.contract AND p.snapshot_date=?
                  WHERE c.symbol=? AND c.snapshot_date=? ORDER BY ABS(c.oi - COALESCE(p.oi,0)) DESC LIMIT 14", [$prev, $s, $snap]);
    }
    return ['symbol' => $s, 'available' => true, 'snapshot' => $snap, 'prev_snapshot' => $prev, 'spot' => $spot,
        'summary' => ['iv30' => f($sum['iv30']), 'iv_front' => f($sum['iv_front']), 'skew25' => f($sum['skew25']), 'call_oi' => (int)$sum['call_oi'],
            'put_oi' => (int)$sum['put_oi'], 'call_vol' => (int)$sum['call_vol'], 'put_vol' => (int)$sum['put_vol'], 'net_gex' => f($sum['net_gex']),
            'gamma_flip' => f($sum['gamma_flip']), 'call_wall' => f($sum['call_wall']), 'put_wall' => f($sum['put_wall']), 'rate' => f($sum['rate'])],
        'expiries' => $expOut, 'strikes' => $st, 'selected' => $sel, 'history' => $hist, 'oi_changes' => $chg];
}

function r_optwatch(): array
{
    $w = json_decode(@file_get_contents(__DIR__ . '/../collector/config.local.json') ?: '{}', true)['watch_contract'] ?? null;
    $w = $w ?: ['symbol' => 'MSTR', 'type' => 'C', 'strike' => 400.0, 'expiry' => '2027-06-17'];
    $cs = sprintf('%s%s%s%08d', $w['symbol'], date('ymd', strtotime($w['expiry'])), $w['type'], (int)round($w['strike'] * 1000));
    $hist = q('SELECT d, underlying, price, bid, ask, iv, delta, volume, oi, source FROM option_watch WHERE contract=? ORDER BY d', [$cs]);
    foreach ($hist as &$h) {
        foreach (['underlying', 'price', 'bid', 'ask', 'iv', 'delta'] as $c) {
            $h[$c] = f($h[$c]);
        }
    }
    unset($h);
    $latest = q1('SELECT * FROM options_chain WHERE contract=? ORDER BY snapshot_date DESC LIMIT 1', [$cs]);
    $spot = q1("SELECT close FROM prices_daily WHERE symbol=? ORDER BY d DESC LIMIT 1", [$w['symbol']]);
    $dte = (int)((strtotime($w['expiry']) - strtotime(date('Y-m-d'))) / 86400);
    return ['contract' => $cs, 'spec' => $w, 'dte' => $dte, 'spot' => f($spot['close'] ?? null), 'latest' => $latest ? [
        'date' => $latest['snapshot_date'], 'last' => f($latest['last']), 'bid' => f($latest['bid']), 'ask' => f($latest['ask']), 'volume' => (int)$latest['volume'],
        'oi' => (int)$latest['oi'], 'iv' => f($latest['iv']), 'delta' => f($latest['delta']), 'gamma' => f($latest['gamma'])] : null, 'history' => $hist,
        'backfill_enabled' => !empty(json_decode(@file_get_contents(__DIR__ . '/../collector/config.local.json') ?: '{}', true)['massive_api_key'])];
}


function r_chain(): array
{
    $s = sym();
    $snap = q1('SELECT MAX(snapshot_date) d FROM options_summary WHERE symbol=?', [$s])['d'] ?? null;
    if (!$snap) {
        return ['available' => false];
    }
    $sum = q1('SELECT spot FROM options_summary WHERE symbol=? AND snapshot_date=?', [$s, $snap]);
    $spot = (float)$sum['spot'];
    $exps = array_column(q('SELECT expiry FROM options_expiry WHERE symbol=? AND snapshot_date=? ORDER BY expiry', [$s, $snap]), 'expiry');
    $exp = (string)($_GET['exp'] ?? ($exps[0] ?? ''));
    if (!in_array($exp, $exps, true)) {
        $exp = $exps[0] ?? '';
    }
    $rows = q("SELECT opt_type t, strike, last, bid, ask, volume, oi, iv, delta, gamma FROM options_chain WHERE symbol=? AND snapshot_date=? AND expiry=? ORDER BY strike", [$s, $snap, $exp]);
    $by = [];
    foreach ($rows as $r) {
        $k = (string)(float)$r['strike'];
        $by[$k]['k'] = (float)$r['strike'];
        $by[$k][$r['t']] = ['last' => f($r['last']), 'bid' => f($r['bid']), 'ask' => f($r['ask']), 'vol' => (int)$r['volume'], 'oi' => (int)$r['oi'],
            'iv' => f($r['iv']), 'delta' => f($r['delta']), 'gamma' => f($r['gamma'])];
    }
    ksort($by, SORT_NUMERIC);
    return ['available' => true, 'symbol' => $s, 'snapshot' => $snap, 'spot' => $spot, 'expiry' => $exp, 'expiries' => $exps, 'rows' => array_values($by)];
}

function r_vol(): array
{
    $s = sym();
    $dvol = array_reverse(q('SELECT d, close FROM dvol_daily ORDER BY d DESC LIMIT 1100'));
    $vix = array_reverse(q("SELECT d, close FROM prices_daily WHERE symbol='^VIX' ORDER BY d DESC LIMIT 1100"));
    $btcVol = an('BTC-USD', 'vol');
    $symVol = an($s, 'vol');
    $iv = q('SELECT snapshot_date d, iv30, iv_front, skew25 FROM options_summary WHERE symbol=? ORDER BY snapshot_date', [$s]);
    $ivBtc = null;
    $dv = array_map(fn($r) => [$r['d'], f($r['close'])], $dvol);
    $vx = array_map(fn($r) => [$r['d'], f($r['close'])], $vix);
    $lastDv = end($dv) ?: null;
    $lastVx = end($vx) ?: null;
    $pct = function (array $series, ?float $cur) {
        $v = array_values(array_filter(array_map(fn($x) => $x[1], $series), fn($x) => $x !== null));
        sort($v);
        if (!$v || $cur === null) {
            return null;
        }
        $n = 0;
        foreach ($v as $x) {
            if ($x < $cur) {
                $n++;
            }
        }
        return 100.0 * $n / count($v);
    };
    $prev = function (array $series, int $back) {
        $i = count($series) - 1 - $back;
        return $i >= 0 ? $series[$i][1] : null;
    };
    return [
        'symbol' => $s, 'dvol' => $dv, 'vix' => $vx,
        'dvol_now' => $lastDv[1] ?? null, 'dvol_chg' => isset($lastDv[1], $dv[count($dv) - 2][1]) ? $lastDv[1] - $dv[count($dv) - 2][1] : null,
        'vix_now' => $lastVx[1] ?? null, 'vix_chg' => isset($lastVx[1], $vx[count($vx) - 2][1]) ? $lastVx[1] - $vx[count($vx) - 2][1] : null,
        'dvol_pctile' => $pct($dv, $lastDv[1] ?? null), 'vix_pctile' => $pct($vx, $lastVx[1] ?? null),
        'dvol_wk' => $prev($dv, 7), 'vix_wk' => $prev($vx, 5),
        'btc_rv' => $btcVol ? ['rv20' => $btcVol['rv20'], 'rv30' => $btcVol['rv30'], 'series' => $btcVol['series']] : null,
        'rv' => $symVol ? ['rv20' => $symVol['rv20'], 'rv30' => $symVol['rv30'], 'rv60' => $symVol['rv60'], 'pctile' => $symVol['rv20_pctile'], 'series' => $symVol['series']] : null,
        'iv' => array_map(fn($r) => ['d' => $r['d'], 'iv30' => f($r['iv30']), 'front' => f($r['iv_front']), 'skew' => f($r['skew25'])], $iv),
    ];
}

function r_insiders(): array
{
    $s = sym();
    $win = function (int $days) use ($s) {
        $since = date('Y-m-d', strtotime("-$days days"));
        $o = ['buys' => ['n' => 0, 'shares' => 0.0, 'usd' => 0.0, 'people' => 0], 'sells' => ['n' => 0, 'shares' => 0.0, 'usd' => 0.0, 'people' => 0]];
        foreach (q("SELECT code, COUNT(*) n, SUM(shares) sh, SUM(value_usd) usd, COUNT(DISTINCT owner_name) people FROM insider_tx
                    WHERE symbol=? AND tx_date>=? AND code IN ('P','S') GROUP BY code", [$s, $since]) as $r) {
            $k = $r['code'] === 'P' ? 'buys' : 'sells';
            $o[$k] = ['n' => (int)$r['n'], 'shares' => (float)$r['sh'], 'usd' => (float)$r['usd'], 'people' => (int)$r['people']];
        }
        return $o;
    };
    $monthly = q("SELECT DATE_FORMAT(tx_date,'%Y-%m') ym,
                  SUM(CASE WHEN code='P' THEN value_usd ELSE 0 END) buy_usd, SUM(CASE WHEN code='S' THEN value_usd ELSE 0 END) sell_usd,
                  SUM(CASE WHEN code='P' THEN 1 ELSE 0 END) buy_n, SUM(CASE WHEN code='S' THEN 1 ELSE 0 END) sell_n
                  FROM insider_tx WHERE symbol=? AND tx_date>=DATE_SUB(CURDATE(), INTERVAL 25 MONTH) AND code IN ('P','S')
                  GROUP BY ym ORDER BY ym", [$s]);
    $active = q("SELECT owner_name, MAX(owner_role) role, COUNT(*) n, SUM(CASE WHEN code='P' THEN 1 ELSE 0 END) buys, SUM(CASE WHEN code='S' THEN 1 ELSE 0 END) sells,
                 SUM(CASE WHEN code='P' THEN value_usd ELSE 0 END) buy_usd, SUM(CASE WHEN code='S' THEN value_usd ELSE 0 END) sell_usd, MAX(tx_date) last
                 FROM insider_tx WHERE symbol=? AND tx_date>=DATE_SUB(CURDATE(), INTERVAL 24 MONTH) GROUP BY owner_name ORDER BY n DESC, sell_usd DESC LIMIT 10", [$s]);
    $latest = q("SELECT tx_date, owner_name, owner_role, code, acq_disp, shares, price, value_usd, shares_after, is_10b5_1, filed, url
                 FROM insider_tx WHERE symbol=? ORDER BY tx_date DESC, id DESC LIMIT 60", [$s]);
    $cast = function (array $rows, array $nums) {
        foreach ($rows as &$r) {
            foreach ($nums as $c) {
                if (array_key_exists($c, $r)) {
                    $r[$c] = f($r[$c]);
                }
            }
        }
        return $rows;
    };
    return ['symbol' => $s, 'w90' => $win(90), 'w365' => $win(365), 'monthly' => $cast($monthly, ['buy_usd', 'sell_usd']),
        'active' => $cast($active, ['buy_usd', 'sell_usd']), 'latest' => $cast($latest, ['shares', 'price', 'value_usd', 'shares_after']),
        'total' => (int)q1('SELECT COUNT(*) n FROM insider_tx WHERE symbol=?', [$s])['n']];
}

function r_filings(): array
{
    $s = sym();
    $form = trim((string)($_GET['form'] ?? ''));
    $limit = min((int)($_GET['limit'] ?? 60), 300);
    $forms = q('SELECT form, COUNT(*) n FROM sec_filings WHERE symbol=? GROUP BY form ORDER BY n DESC', [$s]);
    $args = [$s];
    $where = 'WHERE symbol=?';
    if ($form !== '' && preg_match('/^[A-Za-z0-9 \/\-]{1,16}$/', $form)) {
        $where .= ' AND form=?';
        $args[] = $form;
    }
    $rows = q("SELECT accession, form, filed, items, description, url FROM sec_filings $where ORDER BY filed DESC, accepted DESC LIMIT $limit", $args);
    return ['symbol' => $s, 'forms' => $forms, 'rows' => $rows];
}

function r_treasury(): array
{
    $t = an('MSTR', 'treasury');
    return $t ?: ['error' => 'no treasury data'];
}

function r_signals(): array
{
    $s = sym();
    $sig = an($s, 'signals');
    if (!$sig) {
        out(['error' => "no signal data for $s (not enough history)"], 404);
    }
    $robust = an('ALL', 'signals_robust');
    $rows = q('SELECT d, verdict, score, close, rsi_d, rsi_w FROM signals_daily WHERE symbol=? ORDER BY d', [$s]);
    // compact daily series: [date, close, rsi_d, rsi_w, score, verdictIndex]
    $idx = ['SELL' => 0, 'REDUCE' => 1, 'HOLD' => 2, 'ACCUMULATE' => 3, 'BUY' => 4];
    $series = [];
    foreach ($rows as $r) {
        $series[] = [$r['d'], round((float)$r['close'], 4), round((float)$r['rsi_d'], 2), round((float)$r['rsi_w'], 2), round((float)$r['score'], 1), $idx[$r['verdict']] ?? 2];
    }
    $btc = $s === 'BTC-USD' ? null : an('BTC-USD', 'signals');
    $sig['series'] = $series;
    $sig['robust'] = $robust;
    $sig['btc_context'] = $btc ? ['verdict' => $btc['now']['verdict'], 'score' => $btc['now']['score'], 'rsi_w' => $btc['now']['rsi_w']] : null;
    $tr = $s === 'MSTR' ? an('MSTR', 'treasury') : null;
    $sig['mnav'] = $tr ? ['mnav_ev' => $tr['mnav_ev'], 'mnav_mcap' => $tr['mnav_mcap']] : null;
    return $sig;
}

function r_earnings(): array
{
    $s = sym();
    $e = an($s, 'earnings');
    $prof = q1('SELECT next_earnings, earnings_is_est, earnings_timing FROM company_profile WHERE symbol=?', [$s]);
    return ['symbol' => $s, 'data' => $e, 'profile' => $prof];
}

function r_research(): array
{
    return ['corr' => an('ALL', 'corr'), 'robust' => an('ALL', 'signals_robust'),
        'sources' => [
            ['name' => 'Yahoo Finance', 'use' => 'Daily + hourly prices, option chains, shares / debt, earnings dates', 'cost' => 'Free', 'status' => 'live', 'url' => 'https://finance.yahoo.com'],
            ['name' => 'SEC EDGAR', 'use' => 'Filings feed, Form 4 insider trades, bitcoin 8-Ks, 10-Q balance sheet', 'cost' => 'Free', 'status' => 'live', 'url' => 'https://www.sec.gov/edgar'],
            ['name' => 'Deribit DVOL', 'use' => 'Bitcoin 30-day implied-volatility index', 'cost' => 'Free', 'status' => 'live', 'url' => 'https://www.deribit.com'],
            ['name' => 'Nasdaq', 'use' => 'Next earnings date + timing (cross-check of Yahoo)', 'cost' => 'Free', 'status' => 'live', 'url' => 'https://www.nasdaq.com/market-activity/stocks/mstr/option-chain'],
            ['name' => 'Massive.com - Stocks Starter', 'use' => 'Cleaner stock aggregates / real-time quotes', 'cost' => '$29/mo', 'status' => 'optional', 'url' => 'https://massive.com/pricing?product=stocks'],
            ['name' => 'Massive.com - Options Advanced', 'use' => 'Historical option prices -> back-fills IV history and the $400 call watch', 'cost' => '$199/mo', 'status' => 'optional', 'url' => 'https://massive.com/pricing?product=options'],
            ['name' => 'SpotGamma Options Edge', 'use' => 'Professional GEX / key levels (this app computes its own GEX from Yahoo OI)', 'cost' => '$10/mo', 'status' => 'future', 'url' => 'https://spotgamma.com'],
            ['name' => 'Unusual Whales', 'use' => 'Options flow + unusual activity', 'cost' => '$30/mo', 'status' => 'future', 'url' => 'https://unusualwhales.com'],
            ['name' => 'Token Terminal', 'use' => 'On-chain / crypto fundamentals', 'cost' => '$10/mo', 'status' => 'future', 'url' => 'https://tokenterminal.com'],
            ['name' => 'Nasdaq Investor Intelligence', 'use' => 'Sentiment / positioning', 'cost' => '$10/mo', 'status' => 'future', 'url' => 'https://www.nasdaq.com'],
        ],
        'notes' => q('SELECT id, symbol, body, created_at FROM notes ORDER BY created_at DESC LIMIT 100')];
}

function r_rsi_lines(): array
{
    $s = sym();
    $m = $_SERVER['REQUEST_METHOD'];
    if ($m === 'POST') {
        $b = body();
        $tf = in_array(($b['tf'] ?? 'D'), ['4H', 'D', 'W', 'M', 'Q'], true) ? $b['tf'] : 'D';
        q('INSERT INTO rsi_lines (symbol, tf, label, t1, v1, t2, v2) VALUES (?,?,?,?,?,?,?)',
            [$s, $tf, substr((string)($b['label'] ?? ''), 0, 60), substr((string)$b['t1'], 0, 10), (float)$b['v1'], substr((string)$b['t2'], 0, 10), (float)$b['v2']]);
        return ['ok' => true];
    }
    if ($m === 'DELETE') {
        q('DELETE FROM rsi_lines WHERE id=? AND symbol=?', [(int)($_GET['id'] ?? 0), $s]);
        return ['ok' => true];
    }
    $tf = $_GET['tf'] ?? null;
    $rows = $tf ? q('SELECT * FROM rsi_lines WHERE symbol=? AND tf=? ORDER BY id', [$s, $tf]) : q('SELECT * FROM rsi_lines WHERE symbol=? ORDER BY id', [$s]);
    return ['rows' => $rows];
}

function r_notes(): array
{
    $m = $_SERVER['REQUEST_METHOD'];
    if ($m === 'POST') {
        $b = body();
        $text = trim((string)($b['body'] ?? ''));
        if ($text === '') {
            out(['error' => 'empty note'], 400);
        }
        q('INSERT INTO notes (symbol, body) VALUES (?,?)', [isset($b['symbol']) ? strtoupper(substr((string)$b['symbol'], 0, 16)) : null, substr($text, 0, 4000)]);
        return ['ok' => true];
    }
    if ($m === 'DELETE') {
        q('DELETE FROM notes WHERE id=?', [(int)($_GET['id'] ?? 0)]);
        return ['ok' => true];
    }
    return ['rows' => q('SELECT id, symbol, body, created_at FROM notes ORDER BY created_at DESC LIMIT 100')];
}

function r_refresh_status(): array
{
    $p = __DIR__ . '/../collector/logs/last_run.json';
    $st = is_file($p) ? json_decode((string)file_get_contents($p), true) : ['state' => 'never'];
    $log = q('SELECT job, started, finished, status, message FROM refresh_log ORDER BY id DESC LIMIT 14');
    $running = ($st['state'] ?? '') === 'running' && isset($st['updated']) && (time() - strtotime($st['updated'])) < 1500;
    return ['status' => $st, 'running' => $running, 'log' => $log];
}

function r_refresh(): array
{
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
        out(['error' => 'POST required'], 405);
    }
    if (!is_local()) {
        out(['error' => 'refresh is only allowed from this computer or your own Tailscale devices'], 403);
    }
    $st = r_refresh_status();
    if ($st['running']) {
        return ['started' => false, 'message' => 'A refresh is already running'];
    }
    $cfg = json_decode(@file_get_contents(__DIR__ . '/../collector/config.local.json') ?: '{}', true) ?: [];
    $win = DIRECTORY_SEPARATOR === '\\';
    $py = $cfg['python'] ?? ($win ? 'python' : 'python3');
    $scope = ($_GET['scope'] ?? 'quick') === 'full' ? '' : '--only prices,profile,dvol,options,analytics,signals,strategies';
    $dir = realpath(__DIR__ . '/../collector');
    $logf = $dir . DIRECTORY_SEPARATOR . 'logs' . DIRECTORY_SEPARATOR . 'refresh.log';
    $script = $dir . DIRECTORY_SEPARATOR . 'run_all.py';
    // absolute paths everywhere: the script locates its own folder, so the working directory does not matter
    if ($win) {
        $cmd = 'start /B "" "' . $py . '" -I "' . $script . '" ' . $scope . ' > "' . $logf . '" 2>&1';
        pclose(popen($cmd, 'r'));
    } else {
        $cmd = 'nohup ' . escapeshellarg($py) . ' -I ' . escapeshellarg($script) . ' ' . $scope . ' > ' . escapeshellarg($logf) . ' 2>&1 &';
        exec($cmd);
    }
    return ['started' => true, 'scope' => $scope === '' ? 'full' : 'quick'];
}
