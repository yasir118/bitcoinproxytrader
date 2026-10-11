// Section 2 — Bitcoin & treasury.
import { api, num, pct, pctP, usd, usdc, compact, int, date, dateShort, dateMY, signCls, isNum } from '../util.js';
import { h, card, tile, tag, badge, meter, table, segmented, empty, icon } from '../ui.js';
import { lwChart, cjs, axis, tip, lineOpts, C, legend } from '../charts.js';

export async function render(root, ctx, ov) {
  const sym = ctx.symbol;
  const beta = await api('analytics', { symbol: sym, k: 'beta' }).catch(() => null);
  if (!beta) { root.append(empty('Beta data not available for this ticker yet.')); }
  else await betaBlock(root, sym, beta);
  if (sym === 'MSTR') await treasuryBlock(root, ov);
  else root.append(card({ cls: 'hi' }, h('div', { class: 'small muted' }, 'The bitcoin-treasury card (holdings, cost basis, mNAV) is built from Strategy’s weekly 8-K statements, so it is shown on the MSTR tab.')));
}

// ---------------------------------------------------------------- beta
async function betaBlock(root, sym, b) {
  const row = (w) => b.table.find((r) => r.window === w) || {};
  const y1 = row('1Y'); const d90 = row('90D'); const all = b.table[b.table.length - 1];
  const g = h('div', { class: 'grid g5' });
  g.append(tile({ cls: 'accent', icon: 'coins', label: `Beta · 1Y`, big: num(y1.beta, 2), tag: tag(`90D ${num(d90.beta, 2)}`), note: `Since ${all.window.replace('Since ', '')}: ${num(all.beta, 2)}`, meter: meter(Math.min(10, ((y1.beta || 0) / 3) * 10), 10, { sm: true }) }));
  g.append(tile({ icon: 'activity', label: 'Correlation · 1Y', big: num(y1.corr, 2), note: `90D ${num(d90.corr, 2)} · 30D ${num(row('30D').corr, 2)}`, meter: meter(Math.max(0, (y1.corr || 0)) * 10, 10, { sm: true }) }));
  g.append(tile({ icon: 'target', label: 'R² · 1Y', big: isNum(y1.r2) ? `${(y1.r2 * 100).toFixed(0)}%` : '—', note: 'Share of daily variance explained by BTC' }));
  g.append(tile({ icon: 'bars', label: `σ ratio (${sym} / BTC)`, big: isNum(y1.vol_ratio) ? `${y1.vol_ratio.toFixed(2)}×` : '—', note: 'Daily-return volatility vs Bitcoin, 1Y' }));
  g.append(tile({ icon: 'gauge', label: `${sym}/BTC ratio percentile`, big: isNum(b.ratio_pctile) ? `${Math.round(b.ratio_pctile)}` : '—', unit: 'th pct', note: `Ratio ×1000: ${b.ratio_now.toFixed(2)} · 200D avg ${b.ratio_sma200 ? b.ratio_sma200.toFixed(2) : '—'}` }));
  root.append(g);

  // ratio + rolling charts
  const ratioEl = h('div', { class: 'chart h340' });
  const rollEl = h('div', { class: 'chart h340' });
  let range = '3Y';
  const ratioCard = card({ cls: 'white', icon: 'trend', title: `${sym} / BTC ratio`, sub: `${sym} price ÷ BTC price × 1,000, with its 200-day average`,
    actions: [segmented(['1Y', '3Y', 'ALL'], range, (v) => { range = v; setRange(); })] }, ratioEl);
  const rollCard = card({ cls: 'white', icon: 'activity', title: 'Rolling beta & correlation', sub: '60-session window vs Bitcoin daily returns' }, rollEl);
  root.append(h('div', { class: 'grid g2' }, ratioCard, rollCard));

  const rc = lwChart(ratioEl, { log: false });
  const rs = rc.addLineSeries({ ...lineOpts(C.accent, 2.2), lastValueVisible: true });
  const r2 = rc.addLineSeries({ ...lineOpts(C.ink, 1.6, { lineStyle: 2 }) });
  rs.setData(b.ratio.map((r) => ({ time: r[0], value: r[1] })));
  r2.setData(b.ratio.filter((r) => r[2] != null).map((r) => ({ time: r[0], value: r[2] })));
  rs.createPriceLine({ price: b.ratio_median, color: '#9aa097', lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: 'median' });
  legend(ratioEl, [{ color: C.accent, label: `${sym}/BTC ×1000` }, { color: C.ink, label: '200-day average' }]);
  const setRange = () => {
    const n = b.ratio.length; const k = range === '1Y' ? 252 : range === '3Y' ? 756 : n;
    rc.timeScale().setVisibleLogicalRange({ from: Math.max(0, n - k), to: n + 2 });
  };
  setRange();

  const lc = lwChart(rollEl, { left: true });
  const bs = lc.addLineSeries({ ...lineOpts(C.accent, 2.2), priceScaleId: 'right' });
  const cs = lc.addLineSeries({ ...lineOpts(C.ink, 1.8), priceScaleId: 'left' });
  bs.setData(b.series.filter((r) => r[1] != null).map((r) => ({ time: r[0], value: r[1] })));
  cs.setData(b.series.filter((r) => r[2] != null).map((r) => ({ time: r[0], value: r[2] })));
  bs.createPriceLine({ price: 1, color: '#9aa097', lineWidth: 1, lineStyle: 2, axisLabelVisible: false });
  legend(rollEl, [{ color: C.accent, label: 'Beta (right axis)' }, { color: C.ink, label: 'Correlation (left axis)' }]);
  lc.timeScale().fitContent();

  // scatter + beta table
  const scEl = h('div', { class: 'chart h340' });
  const reg = b.reg;
  const scCard = card({ cls: 'white', icon: 'dots', title: 'Daily-return scatter', sub: `Last 252 sessions · slope (beta) ${num(reg.beta, 2)} · α ${(reg.alpha * 100).toFixed(2)}%/day · corr ${num(reg.corr, 2)}` }, scEl);
  const tbCard = card({ cls: 'white', icon: 'file', title: 'Beta table', sub: `${sym} daily returns regressed on BTC-USD` });
  tbCard.append(table([
    { k: 'window', label: 'Window', fmt: (v) => h('b', null, v) }, { k: 'n', label: 'Obs' },
    { k: 'beta', label: 'Beta', fmt: (v) => h('b', null, num(v, 2)) }, { k: 'corr', label: 'Corr', fmt: (v) => num(v, 2) },
    { k: 'r2', label: 'R²', fmt: (v) => (isNum(v) ? `${(v * 100).toFixed(0)}%` : '—') }, { k: 'vol_ratio', label: 'σ ratio', fmt: (v) => (isNum(v) ? `${v.toFixed(2)}×` : '—') },
  ], b.table));
  tbCard.append(h('div', { class: 'small muted', style: { marginTop: '10px' } }, 'Beta > 1 means the stock has moved more than Bitcoin on a typical day. It is a statistical average, not a guarantee — it shifts with mNAV, leverage and sentiment.'));
  root.append(h('div', { class: 'grid g-3-2' }, scCard, tbCard));
  const xs = b.scatter.map((p) => p[0]);
  const x0 = Math.min(...xs); const x1 = Math.max(...xs);
  cjs(scEl, { type: 'scatter', data: { datasets: [
    { label: 'Daily returns', data: b.scatter.map(([x, y]) => ({ x, y })), backgroundColor: 'rgba(247,147,26,.55)', pointRadius: 3.2, pointHoverRadius: 5 },
    { type: 'line', label: 'Fit', data: [{ x: x0, y: reg.alpha * 100 + reg.beta * x0 }, { x: x1, y: reg.alpha * 100 + reg.beta * x1 }], borderColor: C.ink, borderWidth: 2, pointRadius: 0 }] },
  options: { plugins: { legend: { display: false }, tooltip: tip({ callbacks: { label: (c) => `BTC ${c.parsed.x.toFixed(1)}% → ${sym} ${c.parsed.y.toFixed(1)}%` } }) },
    scales: { x: axis({ title: { display: true, text: 'BTC daily return %' }, ticks: { callback: (v) => `${v}%` } }), y: axis({ title: { display: true, text: `${sym} daily return %` }, ticks: { callback: (v) => `${v}%` } }) } } });
}

// ---------------------------------------------------------------- treasury (MSTR)
async function treasuryBlock(root, ov) {
  const t = await api('treasury').catch(() => null);
  if (!t || t.error) { root.append(card({}, empty('Treasury data not collected yet — run the “treasury” step.'))); return; }
  const wrap = card({ cls: 'hi', icon: 'coins', title: 'Strategy bitcoin treasury', sub: `Holdings from weekly 8-K statements · inputs from latest 10-Q · ${t.n_statements} statements since ${date(t.first_as_of)}` });
  const g = h('div', { class: 'grid g4', style: { marginBottom: '16px' } });
  g.append(tile({ cls: 'accent', icon: 'coins', label: 'BTC held', big: int(t.btc), unit: 'BTC', note: `As of ${date(t.as_of)} (8-K)`, meter: meter(Math.min(10, t.btc / 100000), 10, { sm: true }) }));
  g.append(tile({ icon: 'dollar', label: 'Average cost', big: usd(t.avg_cost, 0), tag: tag(pct(t.unrealized_pct, 1), t.unrealized_pct >= 0 ? 'pos' : 'neg'), note: `Cost basis ${usdc(t.agg_cost, 2)} · BTC now ${usd(t.btc_price, 0)}` }));
  g.append(tile({ icon: 'bars', label: 'BTC NAV', big: usdc(t.btc_nav, 1), note: `Unrealised ${t.unrealized >= 0 ? '+' : '−'}${usdc(Math.abs(t.unrealized), 1)} on cost` }));
  g.append(tile({ icon: 'gauge', label: 'mNAV', big: isNum(t.mnav_ev) ? `${t.mnav_ev.toFixed(2)}×` : '—', unit: 'EV basis', tag: tag(`${(t.mnav_mcap || 0).toFixed(2)}× mkt cap`), note: 'EV = market cap + debt + preferred − cash' }));
  wrap.append(g);

  const src = (s) => (s && s.url ? h('a', { class: 'src-link', href: s.url, target: '_blank', rel: 'noopener' }, s.label || 'source') : h('span', { class: 'muted' }, s?.label || '—'));
  const inputs = [
    ['BTC held', `${int(t.btc)} BTC`, t.as_of, t.sources.btc],
    ['Aggregate cost basis', usdc(t.agg_cost, 2), t.as_of, t.sources.btc],
    ['BTC price (daily close)', usd(t.btc_price, 0), null, t.sources.btc_price],
    ['Market cap (price × shares)', usdc(t.market_cap, 2), null, t.sources.market_cap],
    ['+ Debt (convertible notes etc.)', usdc(t.debt, 2), t.inputs_as_of.debt, t.sources.debt],
    ['+ Preferred (liquidation preference)', usdc(t.preferred, 2), t.inputs_as_of.preferred, t.sources.preferred],
    ['− Cash', usdc(t.cash, 2), t.inputs_as_of.cash, t.sources.cash],
    ['= Enterprise value', usdc(t.ev, 2), null, { label: 'computed' }],
    ['÷ BTC NAV (BTC × price)', usdc(t.btc_nav, 2), null, { label: 'computed' }],
  ];
  const inCard = card({ cls: 'white', title: 'Inputs & sources', sub: 'Every number links to where it came from' },
    table([{ k: 0, label: 'Input', align: 'l', fmt: (v) => h('b', null, v) }, { k: 1, label: 'Value' }, { k: 2, label: 'As of', fmt: (v) => (v ? dateShort(v) : '—') }, { k: 3, label: 'Source', align: 'l', fmt: (v) => src(v) }], inputs.map((r) => r)));
  inCard.append(h('div', { class: 'small muted', style: { marginTop: '10px' } }, 'Debt, preferred and cash are quarter-end figures from the latest 10-Q, so they lag the weekly holdings updates. Strategy’s own dashboard may differ slightly (it uses principal amounts and its own timing).'));

  const recent = card({ cls: 'white', title: 'Recent statements', sub: 'Weekly 8-K updates (newest first)' },
    table([{ k: 'as_of', label: 'As of', fmt: (v) => dateShort(v) }, { k: 'btc', label: 'BTC held', fmt: (v) => int(v) },
      { k: 'acquired', label: 'Change', fmt: (v) => (isNum(v) ? h('span', { class: signCls(v) }, `${v > 0 ? '+' : ''}${int(v)}`) : '—') },
      { k: 'avg_cost', label: 'Avg cost', fmt: (v) => usd(v, 0) }, { k: 'url', label: '', fmt: (u) => h('a', { class: 'src-link', href: u, target: '_blank', rel: 'noopener' }, '8-K ↗') }], t.recent));
  wrap.append(h('div', { class: 'grid g-3-2', style: { alignItems: 'start' } }, inCard, recent));

  // quarterly history
  const q = t.quarters.slice(-14);
  const chEl = h('div', { class: 'chart h300' });
  const qCard = card({ cls: 'white', icon: 'bars', title: 'Quarterly history', sub: 'BTC held (bars) and mNAV (line) at each quarter-end' }, chEl);
  const qTbl = table([
    { k: 'q', label: 'Quarter', fmt: (v) => h('b', null, v) }, { k: 'btc', label: 'BTC held', fmt: (v) => int(v) },
    { k: 'added', label: 'Added', fmt: (v) => (isNum(v) ? h('span', { class: signCls(v) }, `${v > 0 ? '+' : ''}${int(v)}`) : '—') },
    { k: 'avg_cost', label: 'Avg cost', fmt: (v) => usd(v, 0) }, { k: 'btc_price', label: 'BTC price', fmt: (v) => usd(v, 0) },
    { k: 'btc_nav', label: 'BTC NAV', fmt: (v) => usdc(v, 1) },
    { k: 'mnav_mcap', label: 'mNAV mkt cap', fmt: (v) => (isNum(v) ? `${v.toFixed(2)}×` : '—') }, { k: 'mnav_ev', label: 'mNAV EV', fmt: (v) => (isNum(v) ? h('b', null, `${v.toFixed(2)}×`) : '—') },
  ], [...q].reverse());
  wrap.append(h('div', { class: 'grid g-1-2', style: { marginTop: '16px', alignItems: 'start' } }, qCard, card({ cls: 'white', title: 'Quarter-end table' }, qTbl)));
  root.append(wrap);
  cjs(chEl, { data: { labels: q.map((r) => r.q.replace(' ', ' ')), datasets: [
    { type: 'bar', label: 'BTC held', data: q.map((r) => r.btc), backgroundColor: C.ink, borderRadius: 12, yAxisID: 'y', maxBarThickness: 26 },
    { type: 'line', label: 'mNAV (EV)', data: q.map((r) => r.mnav_ev), borderColor: C.accent, backgroundColor: C.accent, borderWidth: 3, tension: 0.3, pointRadius: 4, yAxisID: 'y1', spanGaps: true }] },
  options: { plugins: { legend: { display: true, position: 'bottom', labels: { boxWidth: 10, usePointStyle: true } }, tooltip: tip({ callbacks: { label: (c) => (c.dataset.yAxisID === 'y1' ? `mNAV ${c.parsed.y?.toFixed(2)}×` : `${int(c.parsed.y)} BTC`) } }) },
    scales: { x: axis({ grid: { display: false } }), y: axis({ ticks: { callback: (v) => compact(v, 0) } }), y1: { position: 'right', grid: { display: false }, border: { display: false }, ticks: { callback: (v) => `${v}×` } } } } });
}
