// Basket: every ticker side by side — performance vs Bitcoin, RSI, trend, beta, IV, earnings and the signal read.
import { api, num, pct, pctP, usd, date, dateShort, daysUntil, signCls, isNum } from '../util.js';
import { h, card, tile, tag, badge, table, segmented, toggle, empty, icon, logoBadge, verdictBadge, heatColor } from '../ui.js';
import { lwChart, lineOpts, C, legend } from '../charts.js';

const PALETTE = { MSTR: '#f7931a', 'BTC-USD': '#141414', COIN: '#4a6fa5', IBIT: '#c8a24a', CRCL: '#7a5ea8', ASST: '#1e9a68', XYZ: '#2b8aa6', MARA: '#d4453d', RIOT: '#8a5a3c', IREN: '#5b8c5a', CLSK: '#b05a9a', BTDR: '#6d7a8a', GLXY: '#c27c4a', XXI: '#9aa097' };

export async function render(root, ctx) {
  const b = await api('basket');
  const rows = b.rows;
  const btc = b.btc;
  // ---- summary tiles
  const adv = rows.filter((r) => r.chg_pct > 0).length;
  const above200 = rows.filter((r) => r.vs_200d > 0).length;
  const best = [...rows].sort((a, c) => (c.perf['30D']?.ret ?? -9) - (a.perf['30D']?.ret ?? -9))[0];
  const worst = [...rows].sort((a, c) => (a.perf['30D']?.ret ?? 9) - (c.perf['30D']?.ret ?? 9))[0];
  const g = h('div', { class: 'grid g4' });
  g.append(tile({ cls: 'accent', icon: 'dollar', label: 'Bitcoin', big: usd(btc.close, 0), tag: tag(pct(btc.chg_pct, 2), btc.chg_pct >= 0 ? 'pos' : 'neg'), note: `RSI ${num(btc.rsi.D, 0)} D · ${num(btc.rsi.W, 0)} W · ${pct(btc.vs_200d, 0)} vs 200d · ${pct(btc.from_ath, 0)} from ATH` }));
  g.append(tile({ icon: 'bars', label: 'Breadth today', big: `${adv}/${rows.length}`, unit: 'up', note: `${above200} of ${rows.length} above their 200-day average` }));
  g.append(tile({ icon: 'trend', label: 'Best · 30 days', big: best?.symbol || '—', tag: best ? tag(pct(best.perf['30D']?.ret, 0), 'pos') : null, note: best ? `BTC ${pct(best.perf['30D']?.btc, 0)} over the same window` : '' }));
  g.append(tile({ icon: 'activity', label: 'Weakest · 30 days', big: worst?.symbol || '—', tag: worst ? tag(pct(worst.perf['30D']?.ret, 0), 'neg') : null, note: worst ? `BTC ${pct(worst.perf['30D']?.btc, 0)} over the same window` : '' }));
  root.append(g);

  // ---- performance table
  const periods = [['7D', '7D'], ['30D', '30D'], ['90D', '90D'], ['YTD', 'YTD'], ['1Y', '1Y']];
  const mk = (r) => ({ ...r });
  const all = [{ symbol: 'BTC-USD', name: 'Bitcoin', close: btc.close, chg_pct: btc.chg_pct, perf: Object.fromEntries(Object.entries(btc.perf).map(([k, v]) => [k, { ret: v.ret, btc: v.ret }])), rsi: btc.rsi, trend: btc.trend, vs_200d: btc.vs_200d, rv20: btc.rv20, from_ath: btc.from_ath, isBtc: true }, ...rows.map(mk)];
  let sortKey = null; let sortDir = -1;
  const tbHost = h('div');
  const cols = [
    { k: 'symbol', label: 'Ticker', align: 'l', fmt: (v, r) => h('div', { style: { display: 'flex', alignItems: 'center', gap: '10px' } }, logoBadge(v, 30), h('div', null, h('b', null, v === 'BTC-USD' ? 'BTC' : v), h('div', { class: 'xs muted' }, (r.name || '').slice(0, 22)))) },
    { k: 'close', label: 'Price', fmt: (v) => usd(v, v >= 1000 ? 0 : 2) },
    { k: 'chg_pct', label: '1D', fmt: (v) => h('span', { class: signCls(v) }, pct(v, 1)) },
    ...periods.map(([k, l]) => ({ k: (r) => r.perf?.[k]?.ret, key: `p${k}`, label: l, fmt: (v) => (isNum(v) ? h('span', { class: 'heat', style: { background: heatColor(v, k === '1Y' ? 0.8 : k === '90D' ? 0.5 : 0.25), display: 'inline-block', minWidth: '56px' } }, pct(v, 0)) : '—') })),
    { k: (r) => r.rsi?.D, key: 'rsiD', label: 'RSI D', fmt: (v) => num(v, 0) }, { k: (r) => r.rsi?.W, key: 'rsiW', label: 'RSI W', fmt: (v) => h('b', null, num(v, 0)) },
    { k: (r) => r.trend?.W?.swing, key: 'trendW', label: 'W swing', fmt: (v) => (v ? badge(v, v === 'Up' ? 'pos' : v === 'Down' ? 'neg' : '') : '—') },
    { k: 'vs_200d', label: 'vs 200d', fmt: (v) => h('span', { class: signCls(v) }, pct(v, 0)) },
    { k: (r) => r.beta?.['1Y']?.beta, key: 'beta', label: 'β 1Y', fmt: (v) => (isNum(v) ? v.toFixed(2) : '—') },
    { k: 'iv30', label: 'IV30', fmt: (v) => (isNum(v) ? `${(v * 100).toFixed(0)}%` : '—') },
    { k: 'from_ath', label: 'From ATH', fmt: (v) => h('span', { class: signCls(v) }, pct(v, 0)) },
    { k: 'next_earnings', label: 'Earnings', fmt: (v) => (v ? `${dateShort(v)} · ${daysUntil(v)}d` : '—') },
    { k: 'verdict', label: 'Signal', fmt: (v) => (v ? verdictBadge(v) : '—') },
  ];
  const drawTable = () => {
    let data = [...all];
    if (sortKey) {
      const c = cols.find((x) => (x.key || x.k) === sortKey);
      const val = (r) => (typeof c.k === 'function' ? c.k(r) : r[c.k]);
      data.sort((a, z) => { const x = val(a); const y = val(z); if (x == null) return 1; if (y == null) return -1; return typeof x === 'string' ? sortDir * x.localeCompare(y) : sortDir * (x - y); });
    }
    const t = table(cols, data, { onRow: (r) => { if (!r.isBtc) location.hash = `#/${r.symbol}/overview`; }, rowCls: (r) => (r.isBtc ? 'cur' : '') });
    t.querySelectorAll('th').forEach((th, i) => { th.style.cursor = 'pointer'; th.title = 'Sort'; th.addEventListener('click', () => { const k = cols[i].key || cols[i].k; sortDir = sortKey === k ? -sortDir : -1; sortKey = k; drawTable(); }); });
    tbHost.replaceChildren(t);
  };
  drawTable();
  root.append(card({ cls: 'white', icon: 'grid', title: 'Bitcoin-proxy basket', sub: `${rows.length} tickers · ${date(rows[0]?.last_date)} close · click a column to sort, a row to open the ticker` }, tbHost));

  // ---- rebased chart
  const sel = new Set(['MSTR', 'COIN', 'IBIT', 'MARA', 'BTC-USD']);
  let days = 365;
  const chEl = h('div', { class: 'chart h420' });
  const chips = h('div', { class: 'pill-row', style: { margin: '0 0 10px' } });
  const rangeSeg = segmented([{ value: 90, label: '3M' }, { value: 180, label: '6M' }, { value: 365, label: '1Y' }, { value: 730, label: '2Y' }, { value: 1460, label: '4Y' }], days, (v) => { days = v; drawChart(); });
  root.append(card({ cls: 'white', icon: 'trend', title: 'Relative performance', sub: 'Rebased to 100 at the start of the window · log scale', actions: [rangeSeg] }, chips, chEl));
  const series = await api('basket_series', { days: 1500 });
  let chart;
  const drawChips = () => {
    chips.replaceChildren(...['BTC-USD', ...rows.map((r) => r.symbol)].map((s) => h('button', { class: `toggle ${sel.has(s) ? 'on' : ''}`, onclick: () => { sel.has(s) ? sel.delete(s) : sel.add(s); drawChips(); drawChart(); } }, h('span', { class: 'sw', style: { background: PALETTE[s] } }), s === 'BTC-USD' ? 'BTC' : s)));
  };
  function drawChart() {
    chart?.dispose(); chEl.replaceChildren();
    chart = lwChart(chEl, { log: true });
    const n = series.dates.length; const start = Math.max(0, n - Math.round(days * 0.69));       // ~252 trading days per 365
    const cutoff = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
    const i0 = Math.max(0, series.dates.findIndex((d) => d >= cutoff));
    [...sel].forEach((s) => {
      const arr = series.series[s]; if (!arr) return;
      const base = arr.slice(i0).find((v) => v != null); if (!base) return;
      const ls = chart.addLineSeries({ ...lineOpts(PALETTE[s] || '#888', s === 'MSTR' || s === 'BTC-USD' ? 2.6 : 1.6, { lineStyle: s === 'BTC-USD' ? 2 : 0 }), lastValueVisible: true, title: s === 'BTC-USD' ? 'BTC' : s });
      ls.setData(series.dates.slice(i0).map((d, k) => ({ time: d, value: arr[i0 + k] == null ? undefined : (arr[i0 + k] / base) * 100 })).filter((p) => p.value != null));
    });
    chart.timeScale().fitContent();
  }
  drawChips(); drawChart();

  // ---- excess return vs BTC
  const ex = card({ cls: 'white', icon: 'target', title: 'Excess return vs Bitcoin', sub: 'Stock return minus BTC return over the same window (percentage points)' }, table([
    { k: 'symbol', label: 'Ticker', fmt: (v) => h('a', { class: 'src-link', href: `#/${v}/overview` }, v) },
    ...[['7D', '7D'], ['30D', '30D'], ['90D', '90D'], ['180D', '180D'], ['YTD', 'YTD'], ['1Y', '1Y'], ['SINCE', 'Since Aug ’20']].map(([k, l]) => ({ k: (r) => (r.perf?.[k] && isNum(r.perf[k].btc) ? r.perf[k].ret - r.perf[k].btc : null), label: l,
      fmt: (v) => (isNum(v) ? h('span', { class: 'heat', style: { background: heatColor(v, k === '1Y' || k === 'SINCE' ? 1 : 0.3), display: 'inline-block', minWidth: '56px' } }, `${v >= 0 ? '+' : ''}${(v * 100).toFixed(0)}`) : '—') })),
  ], rows));
  root.append(ex);
  root.append(h('p', { class: 'disclaimer' }, 'Windows are measured on each ticker’s own last close (Bitcoin on the same calendar dates). CRCL and GLXY listed in 2025, XXI in late 2025, so their long windows are shorter or blank.'));
}
