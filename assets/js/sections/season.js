// Section 4 — Seasonality (also used as the full Seasonality sub-page).
import { api, num, pct, pctP, date, dateShort, MONTHS, signCls, isNum, int } from '../util.js';
import { h, card, table, segmented, capsules, heatColor, badge, tile, tag, empty, meter, icon } from '../ui.js';
import { cjs, axis, tip, C } from '../charts.js';

export async function render(root, ctx) {
  const sym = ctx.symbol;
  const [a, b] = await Promise.all([api('analytics', { symbol: sym, k: 'seasonality' }), sym === 'BTC-USD' ? Promise.resolve(null) : api('analytics', { symbol: 'BTC-USD', k: 'seasonality' })]);
  let era = 'era';
  const host = h('div', { class: 'stack' });
  const controls = h('div', { class: 'row between' },
    h('div', { class: 'small muted' }, `${sym} daily history ${date(a.first)} → ${date(a.last)}. Seasonal averages are noisy: with only ~6 years of bitcoin-era data each month has about 6 observations.`),
    segmented([{ value: 'era', label: 'Since Aug ’20' }, { value: 'all', label: 'All history' }], era, (v) => { era = v; draw(); }));
  root.append(controls, host);
  const draw = () => { host.replaceChildren(); blocks(host, sym, a, b, era); };
  draw();
}

function blocks(host, sym, a, b, era) {
  const key = (n) => `${n}_${era}`;
  // ---- 1. month chart
  const ma = a[key('month')]; const mb = b ? b[key('month')] : null;
  const items = ma.map((m, i) => ({ label: m.month, a: m.avg, b: mb ? mb[i].avg : undefined }));
  const hl = h('div', { class: 'legend-inline', style: { marginBottom: '8px' } }, h('span', null, h('i', { style: { background: C.accent } }), `${sym} average monthly return`), b ? h('span', null, h('i', { style: { background: C.ink } }), 'Bitcoin') : null);
  const best = [...ma].filter((m) => isNum(m.avg)).sort((x, y) => y.avg - x.avg);
  const monthCard = card({ cls: 'white', icon: 'wave', title: 'Seasonality by month', sub: era === 'era' ? 'Average calendar-month return since Aug 2020 (first BTC purchase)' : `Average calendar-month return, full history` },
    hl, capsules(items),
    h('div', { class: 'small', style: { marginTop: '10px' } }, best.length ? `Best ${sym} months: ${best.slice(0, 3).map((m) => `${m.month} (${pct(m.avg, 1)}, ${Math.round(m.win * 100)}% up)`).join(' · ')}. Weakest: ${best.slice(-2).reverse().map((m) => `${m.month} (${pct(m.avg, 1)})`).join(' · ')}.` : ''));
  const tbl = table([
    { k: 'month', label: 'Month', fmt: (v) => h('b', null, v) },
    { k: 'avg', label: `${sym} avg`, fmt: (v) => cell(v) }, { k: 'median', label: 'Median', fmt: (v) => pct(v, 1) }, { k: 'win', label: 'Win %', fmt: (v) => (isNum(v) ? `${Math.round(v * 100)}%` : '—') }, { k: 'n', label: 'n' },
    ...(mb ? [{ k: (r, i) => mb[ma.indexOf(r)], label: 'BTC avg', fmt: (v) => cell(v?.avg) }, { k: (r) => mb[ma.indexOf(r)], label: 'BTC win', fmt: (v) => (isNum(v?.win) ? `${Math.round(v.win * 100)}%` : '—') }] : []),
  ], ma);
  host.append(h('div', { class: 'grid g-3-2' }, monthCard, card({ cls: 'white', title: 'Month table', sub: 'Mean, median, win rate, observations' }, tbl)));

  // ---- 2. last 5 trading days
  host.append(h('div', { class: 'sub-title' }, 'Last 5 trading days of the month vs baseline'));
  const l5 = (s) => s[key('last5')];
  const grid = h('div', { class: 'grid g4' });
  const l5tile = (name, d) => {
    if (!d) return null;
    const diff = d.last5.avg - d.baseline.avg;
    return tile({ cls: name === sym ? 'accent' : '', icon: 'calendar', label: `${name} · last 5 days of month`, big: pct(d.last5.avg, 1), tag: tag(`${diff >= 0 ? '+' : ''}${(diff * 100).toFixed(1)} pts vs baseline`, diff >= 0 ? 'pos' : 'neg'),
      note: `Baseline any 5-day window ${pct(d.baseline.avg, 1)} (${Math.round(d.baseline.win * 100)}% up) · last-5 window ${Math.round(d.last5.win * 100)}% up · ${d.last5.n} months`, meter: meter(d.last5.win * 10, 10, { sm: true }) });
  };
  grid.append(l5tile(sym, l5(a)), b ? l5tile('Bitcoin', l5(b)) : null);
  const recent = l5(a)?.recent || [];
  const rec = card({ cls: 'white', title: `${sym}: last-5-day return, recent months`, sub: 'Each bar = return from the close before the last 5 sessions to month-end' });
  rec.append(capsules(recent.slice(-12).map((r) => ({ label: r.ym.slice(2), a: r.ret }))));
  grid.append(h('div', { class: 'span2' }, rec));
  host.append(grid);
  const bm = l5(a)?.by_month || [];
  host.append(card({ cls: 'white', title: 'By calendar month', sub: `${sym} · average return of the final 5 sessions` }, table(
    [{ k: 'month', label: 'Month', fmt: (v) => h('b', null, v) }, { k: 'n', label: 'n' }, { k: 'avg', label: 'Avg', fmt: cell }, { k: 'median', label: 'Median', fmt: (v) => pct(v, 1) }, { k: 'win', label: 'Win %', fmt: (v) => (isNum(v) ? `${Math.round(v * 100)}%` : '—') }], bm)));

  // ---- 3. heatmap
  host.append(h('div', { class: 'sub-title' }, 'Monthly returns by year'));
  const heatHost = h('div');
  let which = sym;
  const drawHeat = () => { heatHost.replaceChildren(heat(which === sym ? a : b)); };
  const head = h('div', { class: 'row between', style: { marginBottom: '10px' } }, h('div', { class: 'small muted' }, 'Calendar-month close-to-close return. * = month in progress.'),
    b ? segmented([sym, 'BTC-USD'], which, (v) => { which = v; drawHeat(); }) : null);
  host.append(card({ cls: 'white' }, head, heatHost));
  drawHeat();

  // ---- 4. day of week + daily moves
  const dw = (s) => s[key('dow')];
  const dowCols = [{ k: 'dow', label: 'Day', fmt: (v) => h('b', null, v) }, { k: 'avg', label: 'Avg', fmt: cell }, { k: 'median', label: 'Median', fmt: (v) => pct(v, 2) }, { k: 'win', label: 'Win %', fmt: (v) => (isNum(v) ? `${Math.round(v * 100)}%` : '—') },
    { k: 'avg_abs', label: 'Avg |move|', fmt: (v) => pct(v, 1, false) }, { k: 'n', label: 'n' }];
  host.append(h('div', { class: 'grid g2' },
    card({ cls: 'white', icon: 'calendar', title: `${sym} by day of week`, sub: 'Close-to-close' }, table(dowCols, dw(a))),
    b ? card({ cls: 'white', icon: 'calendar', title: 'Bitcoin by day of week', sub: 'Includes weekends (24/7 market)' }, table(dowCols, dw(b))) : null));
  host.append(h('div', { class: 'sub-title' }, 'Daily moves by year'));
  const my = a.moves_by_year;
  const yr = card({ cls: 'white', title: `${sym}: how big are the daily moves?`, sub: 'All trading days of each calendar year' });
  yr.append(capsules(my.slice(-10).map((r) => ({ label: String(r.year).slice(2), a: r.avg_abs }))));
  yr.append(h('div', { class: 'small muted', style: { margin: '2px 0 12px' } }, 'Bars = average absolute daily move.'));
  yr.append(table([{ k: 'year', label: 'Year', fmt: (v) => h('b', null, v) }, { k: 'n', label: 'Days' }, { k: 'avg', label: 'Avg', fmt: (v) => pct(v, 2) }, { k: 'std', label: 'σ daily', fmt: (v) => pct(v, 1, false) },
    { k: 'avg_abs', label: 'Avg |move|', fmt: (v) => pct(v, 1, false) }, { k: 'up_pct', label: 'Up days', fmt: (v) => `${Math.round(v * 100)}%` }, { k: 'gt5', label: '≥ ±5%', fmt: (v) => `${Math.round(v * 100)}%` },
    { k: 'gt10', label: '≥ ±10%', fmt: (v) => `${(v * 100).toFixed(1)}%` }, { k: 'best', label: 'Best day', fmt: (v) => h('span', { class: 'pos' }, `${pct(v.r, 1)} ${dateShort(v.d)}`) }, { k: 'worst', label: 'Worst day', fmt: (v) => h('span', { class: 'neg' }, `${pct(v.r, 1)} ${dateShort(v.d)}`) }], [...my].reverse()));
  host.append(yr);
}

const cell = (v) => (isNum(v) ? h('span', { class: 'heat', style: { background: heatColor(v, 0.15), display: 'inline-block', minWidth: '62px' } }, pct(v, 1)) : h('span', { class: 'muted' }, '—'));

function heat(s) {
  const wrap = h('div', { class: 'tbl-wrap' });
  const t = h('table', { class: 'tbl' });
  t.append(h('thead', null, h('tr', null, h('th', null, 'Year'), MONTHS.map((m) => h('th', { style: { textAlign: 'center' } }, m)), h('th', null, 'Year'))));
  const body = h('tbody');
  [...s.matrix].reverse().forEach((r) => {
    const tr = h('tr', null, h('td', null, h('b', null, r.year)));
    let tot = 1; let cnt = 0;
    r.m.forEach((v, i) => {
      tr.append(h('td', { style: { padding: '3px' } }, isNum(v) ? h('div', { class: 'heat', style: { background: heatColor(v, 0.3) }, title: `${MONTHS[i]} ${r.year}: ${pct(v, 1)}` }, `${(v * 100).toFixed(0)}${r.partial_month === i + 1 ? '*' : ''}`) : h('div', { class: 'heat muted' }, '')));
      if (isNum(v)) { tot *= 1 + v; cnt++; }
    });
    tr.append(h('td', { style: { textAlign: 'right' }, class: cnt >= 6 ? signCls(tot - 1) : 'muted' }, cnt >= 6 ? pct(tot - 1, 0) : '—'));
    body.append(tr);
  });
  t.append(body); wrap.append(t);
  return wrap;
}
