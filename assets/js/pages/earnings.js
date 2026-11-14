// Earnings sub-page: next date, typical reaction, history, EPS surprises, upcoming basket calendar.
import { api, num, pct, pctP, usd, date, dateShort, daysUntil, signCls, isNum } from '../util.js';
import { h, card, tile, tag, badge, meter, table, empty, icon } from '../ui.js';
import { cjs, axis, tip, C } from '../charts.js';

export async function render(root, ctx) {
  const sym = ctx.symbol;
  const [e, basket] = await Promise.all([api('earnings', { symbol: sym }), api('basket')]);
  const d = e.data;
  if (!d) { root.append(card({}, empty('No earnings data for this ticker (ETFs and some foreign issuers do not file 8-K earnings releases).'))); return; }
  const next = d.next; const left = next ? daysUntil(next) : null;
  const timing = d.timing === 'amc' ? 'after the close' : d.timing === 'bmo' ? 'before the open' : 'time not confirmed';

  const g = h('div', { class: 'grid g4' });
  g.append(tile({ cls: 'accent', icon: 'calendar', label: 'Next earnings', big: next ? dateShort(next) : '—', tag: isNum(left) ? tag(`in ${left}d`) : null, note: next ? `${date(next)} · ${timing}${d.is_estimate ? ' · estimated' : ''}` : 'No date announced yet' }));
  g.append(tile({ icon: 'activity', label: 'Typical move', big: isNum(d.typical_abs) ? `±${d.typical_abs.toFixed(1)}%` : '—', note: `Average |close-to-close move| over the last ${Math.min(8, d.n)} reports · median ±${isNum(d.median_abs) ? d.median_abs.toFixed(1) : '—'}%`, meter: isNum(d.typical_abs) ? meter(Math.min(10, d.typical_abs / 2), 10, { sm: true }) : null }));
  g.append(tile({ icon: 'bolt', label: 'Options-implied move', big: d.implied ? `±${d.implied.move_pct.toFixed(1)}%` : '—',
    note: d.implied ? `1σ move priced into the ${dateShort(d.implied.expiry)} expiry (ATM IV ${(d.implied.atm_iv * 100).toFixed(0)}%) — covers more days than just the earnings reaction, so it overstates the event move` : 'No options expiry after the report date' }));
  g.append(tile({ icon: 'target', label: 'Direction record', big: isNum(d.up_rate) ? `${Math.round(d.up_rate * 100)}%` : '—', unit: 'up days', note: `Average signed move ${pctP(d.avg_signed, 1, true)} · best ${pctP(d.max_up, 1, true)} · worst ${pctP(d.max_down, 1)}` }));
  root.append(g);

  const ev = [...d.events].reverse();
  const chEl = h('div', { class: 'chart h340' });
  root.append(h('div', { class: 'grid g-3-2' },
    card({ cls: 'white', icon: 'bars', title: 'Reaction to each report', sub: `${sym} close-to-close move on the first session that traded on the news` }, chEl),
    card({ cls: 'white', icon: 'file', title: 'How this is measured' },
      h('div', { class: 'defs' },
        h('div', null, h('b', null, 'Release date & timing'), 'Taken from the 8-K “Results of Operations” (item 2.02) matched to the next 10-Q/10-K. SEC acceptance time decides whether it came after the 16:00 ET close (reaction = next session) or before / during the day (reaction = same session).'),
        h('div', null, h('b', null, 'Move'), 'Close of the reaction session ÷ close before the news − 1. Gaps and the intraday swing are not shown.'),
        h('div', null, h('b', null, 'Typical move'), 'Average absolute move over the last 8 reports. Small samples: one 26% day moves the average by 3 points.')))));
  cjs(chEl, { type: 'bar', data: { labels: ev.map((x) => dateShort(x.d) + ' ’' + x.d.slice(2, 4)), datasets: [{ label: 'Reaction %', data: ev.map((x) => x.move), backgroundColor: ev.map((x) => (x.move >= 0 ? C.accent : C.ink)), borderRadius: 10, maxBarThickness: 34 }] },
    options: { plugins: { legend: { display: false }, tooltip: tip({ callbacks: { title: (it) => `Report ${ev[it[0].dataIndex].d} (${ev[it[0].dataIndex].timing === 'amc' ? 'after close' : 'before/in session'})`, label: (c) => `${c.parsed.y >= 0 ? '+' : ''}${c.parsed.y.toFixed(1)}% on ${ev[c.dataIndex].react}` } }) },
      scales: { x: axis({ grid: { display: false }, ticks: { maxRotation: 55, minRotation: 55, font: { size: 10 } } }), y: axis({ ticks: { callback: (v) => `${v}%` } }) } } });

  root.append(card({ cls: 'white', icon: 'calendar', title: 'Earnings history', sub: `${d.n} reports with a measurable reaction` }, table([
    { k: 'd', label: 'Report date', fmt: (v) => h('b', null, date(v)) }, { k: 'timing', label: 'Timing', fmt: (v) => badge(v === 'amc' ? 'After close' : 'Before / in session') },
    { k: 'react', label: 'Reaction session', fmt: (v) => date(v) }, { k: 'move', label: 'Move', fmt: (v) => h('b', { class: signCls(v) }, `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`) },
    { k: 'move', label: 'vs typical', fmt: (v) => (isNum(d.typical_abs) ? `${(Math.abs(v) / d.typical_abs).toFixed(1)}×` : '—') }], d.events)));

  const eps = (d.eps || []).filter((x) => x.actual != null);
  const upcoming = basket.rows.filter((r) => r.next_earnings).sort((a, b) => (a.next_earnings > b.next_earnings ? 1 : -1));
  root.append(h('div', { class: 'grid g2' },
    card({ cls: 'white', icon: 'dollar', title: 'EPS vs consensus', sub: 'Last reported quarters (Yahoo Finance)' }, eps.length ? table([
      { k: 'quarter', label: 'Quarter end', fmt: (v) => date(v) }, { k: 'actual', label: 'Actual', fmt: (v) => num(v, 2) }, { k: 'estimate', label: 'Estimate', fmt: (v) => num(v, 2) },
      { k: 'surprise_pct', label: 'Surprise', fmt: (v) => (isNum(v) ? h('span', { class: signCls(v) }, `${v >= 0 ? '+' : ''}${(v * 100).toFixed(0)}%`) : '—') }], eps) : empty('No EPS history available.')),
    card({ cls: 'white', icon: 'users', title: 'Upcoming earnings · basket', sub: 'Sorted by date' }, table([
      { k: 'next_earnings', label: 'Date', fmt: (v) => h('b', null, dateShort(v)) }, { k: 'symbol', label: 'Ticker', fmt: (v) => h('a', { href: `#/${v}/earnings`, class: 'src-link' }, v) },
      { k: 'next_earnings', label: 'In', fmt: (v) => `${daysUntil(v)}d` }], upcoming))));
}
