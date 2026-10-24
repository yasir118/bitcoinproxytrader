// Signals sub-page: historical tops & lows with RSI, RSI-zone forward returns, a rule-based BUY/HOLD/SELL regime read, and its honest track record.
import { api, num, pct, pctP, usd, int, date, dateShort, signCls, isNum, compact } from '../util.js';
import { h, card, tile, tag, badge, meter, table, segmented, toggle, capsules, heatColor, empty, icon, verdictBadge } from '../ui.js';
import { lwChart, syncRanges, lineOpts, C, cjs, axis, tip, legend } from '../charts.js';

const VC = { SELL: '#d4453d', REDUCE: '#e0872a', HOLD: '#9aa097', ACCUMULATE: '#6bb36b', BUY: '#1e9a68' };
const VNAMES = ['SELL', 'REDUCE', 'HOLD', 'ACCUMULATE', 'BUY'];

export async function render(root, ctx) {
  let sym = ctx.symbol;
  const host = h('div', { class: 'stack' });
  const bar = h('div', { class: 'row between' },
    h('div', { class: 'callout info', style: { flex: 1, minWidth: '280px' } }, h('b', null, 'Read this first. '), 'This page measures what price and RSI did around past tops and lows, then turns the current reading into a plain-language regime label (BUY / ACCUMULATE / HOLD / REDUCE / SELL). It is a transparent rule set with its own track record shown below — ',
      h('b', null, 'not a forecast and not financial advice.')),
    ctx.symbol !== 'BTC-USD' ? segmented([{ value: ctx.symbol, label: ctx.symbol }, { value: 'BTC-USD', label: 'Bitcoin' }], sym, (v) => { sym = v; load(); }) : null);
  root.append(bar, host);
  async function load() {
    host.replaceChildren(h('div', { class: 'skeleton', style: { height: '300px' } }));
    let d;
    try { d = await api('signals', { symbol: sym }); } catch (e) { host.replaceChildren(card({}, empty(`${e.message}. Signals need ~2 years of daily history.`))); return; }
    host.replaceChildren();
    draw(host, sym, d);
  }
  await load();
}

// ------------------------------------------------------------------------------------------------ main drawing
function draw(host, sym, d) {
  const now = d.now; const edge = d.edge; const rob = d.robust; const bt = d.backtest;

  // reliability score (transparent): 3 simple tests
  const t1 = (edge.f63.spread || 0) > 0.05 && ((edge.f63.bull.win || 0) - (edge.f63.bear.win || 0)) > 0.05;
  const t2 = rob && rob.spread_positive > rob.n / 2;
  const t3 = rob && rob.rpv_better > rob.n / 2;
  const score = [t1, t2, t3].filter(Boolean).length;
  const rel = ['No demonstrated edge', 'Weak evidence', 'Mixed evidence', 'Some evidence (in-sample)'][score];

  // ---------------------------------------------------------------- verdict + breakdown + track record
  const gaugePos = Math.max(0, Math.min(100, ((now.score + 100) / 200) * 100));
  const verdict = h('div', { class: 'card dark', style: { background: 'radial-gradient(120% 120% at 100% 0%, #5a3408 0%, #141414 58%)' } },
    h('div', { class: 'card-head' }, h('div', { class: 'ico' }, icon('target', 20)), h('div', null, h('h3', null, `${sym} · regime read`), h('div', { class: 'sub' }, `As of ${date(d.as_of)} close ${usd(d.close)}`))),
    h('div', { class: `verdict v-${now.verdict}`, style: { color: '#fff', marginBottom: '6px' } }, h('span', { class: 'vdot' }), now.verdict),
    h('div', { style: { opacity: 0.75, fontSize: '13.5px' } }, `Score ${now.score > 0 ? '+' : ''}${now.score} of ±100 · in this state for ${now.days_in} days (since ${dateShort(now.since)})${now.raw !== now.verdict ? ` · raw today: ${now.raw} (needs ${d.thresholds.debounce} sessions to confirm)` : ''}`),
    h('div', { class: 'gauge' }, h('div', { class: 'needle', style: { left: `${gaugePos}%` } })),
    h('div', { class: 'gauge-labels', style: { color: '#bbb' } }, h('span', null, 'SELL'), h('span', null, 'REDUCE'), h('span', null, 'HOLD'), h('span', null, 'ACCUM.'), h('span', null, 'BUY')),
    h('div', { class: 'mini-list', style: { marginTop: '16px', color: '#ddd' } },
      d.btc_context ? h('div', { class: 'r' }, h('span', null, 'Bitcoin itself'), h('span', null, verdictBadge(d.btc_context.verdict), ` ${d.btc_context.score > 0 ? '+' : ''}${d.btc_context.score}`)) : null,
      d.mnav ? h('div', { class: 'r' }, h('span', null, 'Strategy mNAV (not scored)'), h('b', null, `${d.mnav.mnav_ev?.toFixed(2)}× EV · ${d.mnav.mnav_mcap?.toFixed(2)}× mkt cap`)) : null,
      h('div', { class: 'r' }, h('span', null, 'Weekly / daily RSI'), h('b', null, `${now.rsi_w} / ${now.rsi_d}`))),
    h('div', { class: 'small', style: { marginTop: '14px', opacity: 0.6 } }, 'Verdict mapping: BUY ≥ +40 · ACCUMULATE ≥ +15 · HOLD −15…+15 · REDUCE ≤ −15 · SELL ≤ −40.'));

  const comps = card({ cls: 'white', icon: 'bars', title: 'Why: what drives the score', sub: 'Each factor is scored −1…+1 and weighted' });
  now.components.forEach((c) => {
    const w = Math.abs(c.score) * 50;
    comps.append(h('div', { class: 'comp-row', title: c.why }, h('div', null, h('b', null, c.label), h('div', { class: 'xs muted' }, c.why.slice(0, 92) + (c.why.length > 92 ? '…' : ''))), h('div', { class: 'mono' }, c.value),
      h('div', { class: 'comp-bar' }, h('i', { style: { left: c.score >= 0 ? '50%' : `${50 - w}%`, width: `${w}%`, background: c.contrib >= 0 ? C.pos : C.neg } })),
      h('b', { class: signCls(c.contrib) }, `${c.contrib > 0 ? '+' : ''}${c.contrib}`)));
  });
  comps.append(h('div', { class: 'row between', style: { marginTop: '10px' } }, h('b', null, 'Total'), h('b', { style: { fontSize: '18px' } }, `${now.score > 0 ? '+' : ''}${now.score}`)));

  const f = (x) => (isNum(x) ? pct(x, 0) : '—');
  const track = card({ cls: 'hi', icon: 'shield', title: 'Does this signal work?', sub: 'Track record on this same history' });
  track.append(h('div', { style: { display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '10px' } }, h('span', { class: `badge ${score >= 3 ? 'pos' : score === 2 ? 'acc' : 'neg'}`, style: { fontSize: '13px', padding: '4px 12px' } }, rel), h('span', { class: 'small muted' }, `${score}/3 tests passed`)));
  const test = (ok, txt) => h('div', { class: 'r', style: { display: 'flex', gap: '8px', alignItems: 'flex-start' } }, h('span', { class: ok ? 'pos' : 'neg', style: { fontWeight: 700 } }, ok ? '✓' : '✗'), h('span', null, txt));
  track.append(h('div', { class: 'mini-list' },
    test(t1, `On ${sym}, 63-day forward return after bullish states ${f(edge.f63.bull.avg)} vs ${f(edge.f63.bear.avg)} after bearish states (win rate ${f(edge.f63.bull.win)} vs ${f(edge.f63.bear.win)}).`),
    rob ? test(t2, `Same rule on ${rob.n} tickers: bullish beat bearish in ${rob.spread_positive} of ${rob.n}.`) : null,
    rob ? test(t3, `Better return per unit of risk than buy-and-hold in ${rob.rpv_better} of ${rob.n}; lower max drawdown in ${rob.dd_better} of ${rob.n}; higher total return in ${rob.return_better} of ${rob.n}.`) : null));
  track.append(h('div', { class: 'callout', style: { marginTop: '14px' } }, edge.reading + ' ',
    `Following the rule on ${sym} returned ${pct(bt.strategy.total, 0)} vs ${pct(bt.buy_hold.total, 0)} buy-and-hold, with max drawdown ${pct(bt.strategy.maxdd, 0)} vs ${pct(bt.buy_hold.maxdd, 0)}. `,
    h('b', null, 'Everything here is in-sample (the weights were chosen after seeing this history), so real results would likely be worse.')));
  host.append(h('div', { class: 'sig-top', id: 'sigtop' }, verdict, comps, track));

  // ---------------------------------------------------------------- chart: price + pivots + RSI + score
  const state = { thr: '0.35', log: true, confirm: false, range: sym === 'BTC-USD' ? '3Y' : 'ALL' };
  const pxEl = h('div', { class: 'chart', style: { height: '360px' } }); const rsEl = h('div', { class: 'chart', style: { height: '170px', marginTop: '2px' } }); const scEl = h('div', { class: 'chart', style: { height: '150px', marginTop: '2px' } });
  const thrSeg = segmented([{ value: '0.25', label: '25% swings' }, { value: '0.35', label: '35% swings' }, { value: '0.5', label: '50% swings' }], state.thr, (v) => { state.thr = v; drawChart(); drawPivots(); });
  const rangeSeg = segmented(['1Y', '3Y', 'ALL'], state.range, (v) => { state.range = v; setRange(); });
  const chartCard = card({ cls: 'white', icon: 'trend', title: 'Tops, lows and RSI', sub: `${sym} daily close · ▼ confirmed tops, ▲ confirmed lows (label = weekly RSI at the pivot) · bottom pane = score coloured by verdict`,
    actions: [thrSeg, rangeSeg] },
  h('div', { class: 'row', style: { marginBottom: '8px' } }, toggle('Log price', state.log, (on) => { state.log = on; drawChart(); }), toggle('Show when each pivot was confirmed', state.confirm, (on) => { state.confirm = on; drawChart(); })), pxEl, rsEl, scEl,
  h('div', { class: 'legend-inline', style: { marginTop: '8px' } }, VNAMES.map((v) => h('span', null, h('i', { style: { background: VC[v] } }), v))));
  host.append(chartCard);
  let charts = [];
  const S = d.series; const times = S.map((r) => r[0]);
  function setRange() {
    const n = S.length; const k = state.range === '1Y' ? 252 : state.range === '3Y' ? 756 : n;
    charts[0]?.timeScale().setVisibleLogicalRange({ from: Math.max(0, n - k), to: n + 4 });
  }
  function drawChart() {
    charts.forEach((c) => c.dispose()); charts = [];
    const px = lwChart(pxEl, { log: state.log }); const rs = lwChart(rsEl, { margins: { top: 0.06, bottom: 0.06 } }); const sc = lwChart(scEl);
    charts = [px, rs, sc];
    const line = px.addLineSeries({ ...lineOpts(C.ink, 2), lastValueVisible: true, priceLineVisible: true });
    line.setData(S.map((r) => ({ time: r[0], value: r[1] })));
    const piv = d.pivots[state.thr].rows; const mk = [];
    piv.forEach((p) => {
      if (!times.includes(p.d)) return;
      mk.push({ time: p.d, position: p.k === 'top' ? 'aboveBar' : 'belowBar', color: p.k === 'top' ? C.neg : C.pos, shape: p.k === 'top' ? 'arrowDown' : 'arrowUp', size: 1.3, text: isNum(p.rsi_w) ? String(Math.round(p.rsi_w)) : '' });
      if (state.confirm && p.confirmed && p.confirm_d && times.includes(p.confirm_d)) mk.push({ time: p.confirm_d, position: p.k === 'top' ? 'aboveBar' : 'belowBar', color: '#9aa097', shape: 'circle', size: 0.6, text: '' });
    });
    mk.sort((a, b) => (a.time > b.time ? 1 : a.time < b.time ? -1 : 0));
    const seen = new Map(); mk.forEach((m) => { if (!seen.has(m.time + m.shape)) seen.set(m.time + m.shape, m); });
    line.setMarkers([...seen.values()]);
    const rd = rs.addLineSeries({ ...lineOpts('#9aa097', 1.4), autoscaleInfoProvider: () => ({ priceRange: { minValue: 0, maxValue: 100 } }) });
    const rw = rs.addLineSeries({ ...lineOpts(C.accent, 2.4), autoscaleInfoProvider: () => ({ priceRange: { minValue: 0, maxValue: 100 } }) });
    rd.setData(S.map((r) => ({ time: r[0], value: r[2] }))); rw.setData(S.map((r) => ({ time: r[0], value: r[3] })));
    [[30, 2], [50, 0], [70, 2]].forEach(([v, ls]) => rw.createPriceLine({ price: v, color: '#b5bab2', lineWidth: 1, lineStyle: ls, axisLabelVisible: true, title: '' }));
    legend(rsEl, [{ color: C.accent, label: 'Weekly RSI' }, { color: '#9aa097', label: 'Daily RSI' }]);
    const hs = sc.addHistogramSeries({ priceLineVisible: false, lastValueVisible: false });
    hs.setData(S.map((r) => ({ time: r[0], value: r[4], color: VC[VNAMES[r[5]]] })));
    [d.thresholds.buy, d.thresholds.sell].forEach((v) => hs.createPriceLine({ price: v, color: '#b5bab2', lineWidth: 1, lineStyle: 2, axisLabelVisible: false }));
    legend(scEl, [{ color: '#141414', label: 'Score (bars coloured by confirmed verdict)' }]);
    syncRanges(px, rs); syncRanges(px, sc); syncRanges(rs, sc);
    setRange();
  }
  drawChart();

  // ---------------------------------------------------------------- tops & lows table
  const pivHost = h('div');
  function drawPivots() {
    const P = d.pivots[state.thr]; const st = P.stats;
    pivHost.replaceChildren();
    const sm = h('div', { class: 'grid g4', style: { marginBottom: '14px' } });
    sm.append(tile({ cls: 'accent', icon: 'activity', label: 'Weekly RSI near tops', big: isNum(st.tops_rsi_w_ext.avg) ? st.tops_rsi_w_ext.avg.toFixed(0) : '—', unit: 'avg peak', note: `Highest weekly RSI within ±15 days of ${st.tops_rsi_w_ext.n} confirmed tops · range ${num(st.tops_rsi_w_ext.min, 0)}–${num(st.tops_rsi_w_ext.max, 0)}` }));
    sm.append(tile({ icon: 'activity', label: 'Weekly RSI near lows', big: isNum(st.lows_rsi_w_ext.avg) ? st.lows_rsi_w_ext.avg.toFixed(0) : '—', unit: 'avg trough', note: `Lowest weekly RSI within ±15 days of ${st.lows_rsi_w_ext.n} confirmed lows · range ${num(st.lows_rsi_w_ext.min, 0)}–${num(st.lows_rsi_w_ext.max, 0)}` }));
    sm.append(tile({ icon: 'target', label: 'Hit rates', body: h('div', { class: 'mini-list' }, h('div', { class: 'r' }, h('span', null, 'Tops with weekly RSI ≥ 70'), h('b', null, isNum(st.tops_hit70) ? `${Math.round(st.tops_hit70 * 100)}%` : '—')), h('div', { class: 'r' }, h('span', null, 'Lows with weekly RSI ≤ 35'), h('b', null, isNum(st.lows_hit35) ? `${Math.round(st.lows_hit35 * 100)}%` : '—'))), note: 'How often the classic overbought / oversold levels actually coincided with a turning point.' }));
    sm.append(tile({ icon: 'shield', label: 'Detection lag', body: h('div', { class: 'mini-list' }, h('div', { class: 'r' }, h('span', null, 'Top confirmed after'), h('b', { class: 'neg' }, pct(st.avg_lag_top, 0))), h('div', { class: 'r' }, h('span', null, 'Low confirmed after'), h('b', { class: 'pos' }, pct(st.avg_lag_low, 0)))), note: `A swing is only known after a ≥${Math.round(P.threshold * 100)}% reversal — the average move already made by then.` }));
    pivHost.append(sm);
    pivHost.append(table([
      { k: 'd', label: 'Pivot date', fmt: (v) => h('b', null, date(v)) }, { k: 'k', label: 'Type', fmt: (v) => badge(v === 'top' ? '▼ Top' : '▲ Low', v === 'top' ? 'neg' : 'pos') }, { k: 'px', label: 'Price', fmt: (v) => usd(v) },
      { k: 'rsi_w', label: 'RSI-W', fmt: (v) => num(v, 0) }, { k: 'rsi_w_ext', label: 'RSI-W extreme ±15d', fmt: (v, r) => h('b', { class: r.k === 'top' ? (v >= 70 ? 'neg' : '') : (v <= 35 ? 'pos' : '') }, num(v, 0)) }, { k: 'rsi_d', label: 'RSI-D', fmt: (v) => num(v, 0) },
      { k: 'move', label: 'Move from prior pivot', fmt: (v) => (isNum(v) ? h('span', { class: signCls(v) }, pct(v, 0)) : '—') }, { k: 'days', label: 'Days', fmt: (v) => (v ? int(v) : '—') },
      { k: 'confirm_d', label: 'Confirmed on', fmt: (v, r) => (v ? h('span', null, dateShort(v), h('span', { class: 'muted small' }, ` @ ${usd(r.confirm_px, 2)} (${pct(r.lag_pct, 0)})`)) : h('span', { class: 'badge acc' }, 'developing')) }].map((c) => c),
    [...P.rows].reverse()));
  }
  host.append(card({ cls: 'white', icon: 'calendar', title: 'Historical tops & lows', sub: `Zig-zag pivots on daily closes since ${date(d.start)} · a swing counts after a reversal of at least 25 / 35 / 50% (set with the switch above the chart)` }, pivHost));
  drawPivots();

  // ---------------------------------------------------------------- RSI zones
  let ztf = 'W';
  const zHost = h('div');
  const drawZones = () => {
    zHost.replaceChildren();
    const rows = ztf === 'W' ? d.zones_w : d.zones_d;
    const hs = ztf === 'W' ? [['f4', '4 wks'], ['f13', '13 wks'], ['f26', '26 wks'], ['f52', '52 wks']] : [['f21', '21 d'], ['f63', '63 d'], ['f126', '126 d']];
    const cols = [{ k: 'zone', label: ztf === 'W' ? 'Weekly RSI' : 'Daily RSI', fmt: (v) => h('b', null, v) }, { k: 'n', label: ztf === 'W' ? 'Weeks' : 'Days' }];
    hs.forEach(([k, lbl]) => {
      cols.push({ k: (r) => r[k], label: `${lbl} avg`, fmt: (v) => (v && isNum(v.avg) ? h('span', { class: 'heat', style: { background: heatColor(v.avg, ztf === 'W' ? 0.6 : 0.3), display: 'inline-block', minWidth: '58px' } }, pct(v.avg, 0)) : '—') });
      cols.push({ k: (r) => r[k], label: 'median', fmt: (v) => (v && isNum(v.median) ? pct(v.median, 0) : '—') });
      cols.push({ k: (r) => r[k], label: 'win', fmt: (v) => (v && isNum(v.win) ? `${Math.round(v.win * 100)}%` : '—'), cls: (v) => (v && isNum(v.win) ? (v.win >= 0.6 ? 'pos' : v.win <= 0.4 ? 'neg' : '') : '') });
    });
    zHost.append(table(cols, rows));
    const best = rows.filter((r) => r.n >= 8 && r[hs[1][0]]?.avg != null).sort((a, b) => b[hs[1][0]].avg - a[hs[1][0]].avg);
    if (best.length) zHost.append(h('div', { class: 'small', style: { marginTop: '10px' } }, `Best ${hs[1][1]} forward average (≥8 observations): RSI ${best[0].zone} → ${pct(best[0][hs[1][0]].avg, 0)} (median ${pct(best[0][hs[1][0]].median, 0)}, ${Math.round(best[0][hs[1][0]].win * 100)}% positive). Worst: RSI ${best[best.length - 1].zone} → ${pct(best[best.length - 1][hs[1][0]].avg, 0)}.`));
  };
  drawZones();
  host.append(card({ cls: 'white', icon: 'gauge', title: 'What happened after each RSI zone', sub: `${sym} forward returns after the RSI closed in each bucket, since ${date(d.start)} · windows overlap, so treat as descriptive`,
    actions: [segmented([{ value: 'W', label: 'Weekly RSI' }, { value: 'D', label: 'Daily RSI' }], ztf, (v) => { ztf = v; drawZones(); })] }, zHost,
  h('div', { class: 'callout info', style: { marginTop: '12px' } }, h('b', null, 'How to read it: '), 'for trending assets like bitcoin and its proxies, strong RSI (50–80) has often been followed by continued strength, while very low RSI has often been followed by more weakness before a bottom. Extreme readings above 80 are where returns historically faded. Few observations in a zone means the number is fragile.')));

  // ---------------------------------------------------------------- backtest
  host.append(backtestCard(sym, d));

  // ---------------------------------------------------------------- verdict-state forward returns
  host.append(card({ cls: 'white', icon: 'layers', title: 'Forward returns by verdict state', sub: 'Average return of the 21 / 63 / 126 sessions after each day spent in a confirmed state' }, table([
    { k: 'verdict', label: 'State', fmt: (v) => verdictBadge(v) }, { k: 'days', label: 'Days in state', fmt: (v) => int(v) },
    ...[['f21', '21d'], ['f63', '63d'], ['f126', '126d']].flatMap(([k, l]) => [
      { k: (r) => r[k], label: `${l} avg`, fmt: (v) => (v && isNum(v.avg) ? h('span', { class: 'heat', style: { background: heatColor(v.avg, k === 'f21' ? 0.2 : 0.5), display: 'inline-block', minWidth: '58px' } }, pct(v.avg, 0)) : '—') },
      { k: (r) => r[k], label: 'win', fmt: (v) => (v && isNum(v.win) ? `${Math.round(v.win * 100)}%` : '—') }]),
  ], d.by_verdict), h('div', { class: 'small muted', style: { marginTop: '8px' } }, 'If the signal had predictive power, this table would climb from SELL (low) to BUY (high). Check whether it does before trusting the label.')));

  // ---------------------------------------------------------------- cross-ticker robustness
  if (rob) {
    host.append(card({ cls: 'white', icon: 'users', title: 'Robustness: the same fixed rules on every ticker', sub: `Not tuned per ticker · ${rob.n} tickers · since each ticker's own start (Aug ’20 or listing)` }, table([
      { k: 'symbol', label: 'Ticker', fmt: (v) => h('a', { class: 'src-link', href: `#/${v === 'BTC-USD' ? 'MSTR' : v}/signals` }, v) }, { k: 'verdict', label: 'Now', fmt: (v) => verdictBadge(v) },
      { k: 'strat', label: 'Rule return', fmt: (v) => pct(v, 0) }, { k: 'bh', label: 'Buy & hold', fmt: (v) => pct(v, 0) },
      { k: 'dd_strat', label: 'Max DD rule', fmt: (v) => pct(v, 0) }, { k: 'dd_bh', label: 'Max DD B&H', fmt: (v) => pct(v, 0) },
      { k: 'rpv_strat', label: 'Ret/vol rule', fmt: (v) => num(v, 2) }, { k: 'rpv_bh', label: 'Ret/vol B&H', fmt: (v) => num(v, 2) },
      { k: 'spread63', label: 'Bull − bear 63d', fmt: (v) => (isNum(v) ? h('span', { class: signCls(v) }, pct(v, 0)) : '—') },
    ], rob.tickers), h('div', { class: 'small', style: { marginTop: '10px' } }, `Summary: bullish states beat bearish in ${rob.spread_positive}/${rob.n}; rule had a smaller max drawdown in ${rob.dd_better}/${rob.n}; better return per unit of risk in ${rob.rpv_better}/${rob.n}; higher total return in ${rob.return_better}/${rob.n}. `,
      `For reference, a plain “above the 200-day average = invested” rule: lower drawdown in ${rob.t200_dd_better}/${rob.n}, better return per unit of risk in ${rob.t200_rpv_better}/${rob.n}. `, 'A rule that mostly cuts exposure will nearly always reduce drawdown — the real question is whether it improves return per unit of risk, and across these tickers it generally does not. Treat any label here as a risk gauge, not a market-timing edge.')));
  }

  // ---------------------------------------------------------------- method
  host.append(h('details', { class: 'card hi' }, h('summary', null, 'How the signal is built (and its limits)'),
    h('div', { class: 'defs', style: { marginTop: '14px' } },
      h('div', null, h('b', null, 'Score (−100…+100)'), `Trend (price vs 200-day average) ${d.thresholds.weights.trend} · weekly RSI 50-line momentum ${d.thresholds.weights.mom_w} · daily RSI momentum ${d.thresholds.weights.mom_d} · exhaustion overlay (weekly RSI 75–85+ and/or extreme stretch vs own history) up to −${d.thresholds.weights.exhaust} · capitulation overlay (bottom ~15% of its own distance-from-200d history) up to +${d.thresholds.weights.value} · swing phase after the last confirmed ≥35% pivot ±${d.thresholds.weights.phase}.`),
      h('div', null, h('b', null, 'Causal'), 'Each day uses only data available at that day’s close; the in-progress week is used for weekly RSI; pivots only count after the reversal that confirms them. No look-ahead.'),
      h('div', null, h('b', null, 'Backtest rules'), `Exposure: SELL 0% · REDUCE 25% · HOLD 50% · ACCUMULATE 75% · BUY 100%; a new verdict must hold ${d.thresholds.debounce} sessions; ${(d.thresholds.fee * 100).toFixed(2)}% cost per unit of exposure traded; no leverage, no shorting, trades at the close you saw.`),
      h('div', null, h('b', null, 'Why you should be sceptical'), 'The weights were chosen with this price history in view (in-sample). Bitcoin-proxy history is short (one bull/bear cycle and a half), highly correlated across tickers, and dominated by a handful of huge moves. Regimes change: MSTR’s premium to NAV, ETF flows and leverage all shift the rules.'),
      h('div', null, h('b', null, 'What would improve it'), 'Out-of-sample testing as data accrues, on-chain and flow data (see Research → data sources), and position sizing based on volatility rather than a fixed label.'))));
  host.append(h('div', { class: 'callout warn' }, h('b', null, 'Risk reminder. '), `${sym} has had drawdowns of ${pct(bt.buy_hold.maxdd, 0)} in this history. No indicator reliably avoids them. Size positions so that a −80% outcome would not change your life, avoid leverage, and never rely on a single signal. This is an educational research tool, not investment advice.`));
}

// ------------------------------------------------------------------------------------------------ backtest card
function backtestCard(sym, d) {
  const bt = d.backtest; const base = bt.baselines || {};
  const el = h('div', { class: 'chart', style: { height: '340px' } });
  const rows = [
    ['Follow the signal (BUY…SELL)', bt.strategy, true], ['Buy & hold (100%)', bt.buy_hold], ['Constant 50% invested', bt.half],
    ['Simple: above 200-day avg = 100%', base.trend200], ['Simple: weekly RSI > 50 = 100%', base.rsi50],
  ];
  const cols = bt.curve_cols;
  const names = { strategy: ['Signal rule', C.accent], buy_hold: ['Buy & hold', C.ink], half: ['50% invested', '#9aa097'], trend200: ['200-day rule', '#4a6fa5'], rsi50: ['RSI-50 rule', '#7a5ea8'] };
  const wrap = card({ cls: 'white', icon: 'trend', title: 'Backtest: following the signal vs simply holding', sub: `${sym} · ${date(bt.start)} → ${date(bt.end)} · growth of 1.00 (log scale) · costs and 1-day lag included` }, el,
    h('div', { style: { height: '14px' } }),
    table([{ k: 0, label: 'Strategy', align: 'l', fmt: (v, r) => (r[2] ? h('b', null, v) : v) }, { k: (r) => r[1].total, label: 'Total return', fmt: (v) => pct(v, 0) }, { k: (r) => r[1].cagr, label: 'CAGR', fmt: (v) => pct(v, 0) },
      { k: (r) => r[1].vol, label: 'Volatility', fmt: (v) => pct(v, 0, false) }, { k: (r) => r[1].maxdd, label: 'Max drawdown', fmt: (v) => h('span', { class: 'neg' }, pct(v, 0)) },
      { k: (r) => r[1].ret_per_vol, label: 'Return / vol', fmt: (v) => num(v, 2) }, { k: (r) => r[1].avg_exposure, label: 'Avg invested', fmt: (v) => (isNum(v) ? `${Math.round(v * 100)}%` : '100%') },
      { k: (r) => r[1].trades, label: 'Trades', fmt: (v) => (v != null ? v : '—') }], rows.filter((r) => r[1])),
    h('div', { class: 'sub-title' }, 'Calendar-year results'),
    table([{ k: 'year', label: 'Year', fmt: (v) => h('b', null, v) }, { k: 'strategy', label: 'Signal rule', fmt: (v) => h('span', { class: signCls(v) }, pct(v, 0)) }, { k: 'buy_hold', label: 'Buy & hold', fmt: (v) => h('span', { class: signCls(v) }, pct(v, 0)) },
      { k: 'half', label: '50% invested', fmt: (v) => pct(v, 0) }, { k: 'trend200', label: '200-day rule', fmt: (v) => pct(v, 0) }, { k: 'rsi50', label: 'RSI-50 rule', fmt: (v) => pct(v, 0) },
      { k: 'avg_exposure', label: 'Avg invested', fmt: (v) => `${Math.round(v * 100)}%` }], bt.by_year));
  setTimeout(() => {
    const c = lwChart(el, { log: true });
    cols.slice(1).forEach((k, i) => {
      const s = c.addLineSeries({ ...lineOpts(names[k][1], k === 'strategy' ? 2.6 : 1.6, { lineStyle: k === 'half' ? 2 : 0 }), lastValueVisible: true });
      s.setData(bt.curve.map((r) => ({ time: r[0], value: r[i + 1] })));
    });
    legend(el, cols.slice(1).map((k) => ({ color: names[k][1], label: names[k][0] })));
    c.timeScale().fitContent();
  }, 0);
  return wrap;
}
