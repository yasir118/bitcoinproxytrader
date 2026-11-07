// Section 5 — Insiders & filings.
import { api, num, pct, usd, usdc, compact, int, date, dateShort, signCls, isNum } from '../util.js';
import { h, card, tile, tag, badge, table, segmented, empty, icon } from '../ui.js';
import { cjs, axis, tip, C } from '../charts.js';

const CODE = { P: ['Buy', 'pos'], S: ['Sale', 'neg'], A: ['Award', ''], M: ['Option exercise', ''], F: ['Tax withheld', ''], G: ['Gift', ''], C: ['Conversion', ''], X: ['Option exercise', ''], D: ['Disposed to issuer', ''], J: ['Other', ''], W: ['Will/inheritance', ''], I: ['Discretionary', ''], K: ['Equity swap', ''] };

export async function render(root, ctx) {
  const sym = ctx.symbol;
  const ins = await api('insiders', { symbol: sym });
  insidersBlock(root, sym, ins);
  await filingsBlock(root, sym);
}

function insidersBlock(root, sym, d) {
  if (!d.total) { root.append(card({}, empty('No Form 4 insider transactions parsed for this ticker yet.'))); return; }
  const w = d.w90; const y = d.w365;
  const g = h('div', { class: 'grid g4' });
  const net = (x) => x.buys.usd - x.sells.usd;
  g.append(tile({ cls: 'accent', icon: 'trend', label: 'Open-market buys · 90d', big: int(w.buys.n), unit: 'transactions', tag: tag(`${int(w.buys.people)} insiders`), note: `${usdc(w.buys.usd, 1)} · ${compact(w.buys.shares, 1)} shares (Form 4 code P)` }));
  g.append(tile({ icon: 'activity', label: 'Open-market sells · 90d', big: int(w.sells.n), unit: 'transactions', tag: tag(`${int(w.sells.people)} insiders`, w.sells.n ? 'neg' : ''), note: `${usdc(w.sells.usd, 1)} · ${compact(w.sells.shares, 1)} shares (code S)` }));
  g.append(tile({ icon: 'dollar', label: 'Net · 12 months', big: `${net(y) >= 0 ? '+' : '−'}${usdc(Math.abs(net(y)), 1)}`, tag: tag(net(y) >= 0 ? 'net buying' : 'net selling', net(y) >= 0 ? 'pos' : 'neg'), note: `${int(y.buys.n)} buys (${usdc(y.buys.usd, 1)}) vs ${int(y.sells.n)} sells (${usdc(y.sells.usd, 1)})` }));
  g.append(tile({ icon: 'users', label: 'Parsed Form 4 lines', big: int(d.total), note: 'Awards, exercises, tax withholding and gifts are listed below but not counted as buys or sells.' }));
  root.append(g);

  const mEl = h('div', { class: 'chart h300' });
  const mCard = card({ cls: 'white', icon: 'bars', title: 'Insider buying & selling by month', sub: 'Open-market value in $ (buys up, sells down)' }, mEl);
  const act = card({ cls: 'white', icon: 'users', title: 'Most active insiders', sub: 'Last 24 months, all transaction codes' },
    table([{ k: 'owner_name', label: 'Insider', align: 'l', fmt: (v, r) => h('div', null, h('b', null, v), h('div', { class: 'xs muted wrap' }, (r.role || '').slice(0, 44))) }, { k: 'n', label: 'Tx' },
      { k: 'buys', label: 'Buys', fmt: (v) => (v ? h('span', { class: 'pos' }, v) : '0') }, { k: 'sells', label: 'Sells', fmt: (v) => (v ? h('span', { class: 'neg' }, v) : '0') },
      { k: 'sell_usd', label: 'Sold $', fmt: (v) => (v ? usdc(v, 1) : '—') }, { k: 'last', label: 'Last', fmt: dateShort }], d.active));
  root.append(h('div', { class: 'grid g-3-2' }, mCard, act));
  const m = d.monthly;
  if (m.length) cjs(mEl, { type: 'bar', data: { labels: m.map((r) => r.ym.slice(2)), datasets: [
    { label: 'Buys $', data: m.map((r) => r.buy_usd), backgroundColor: C.accent, borderRadius: 8, stack: 'a', maxBarThickness: 26 },
    { label: 'Sells $', data: m.map((r) => -r.sell_usd), backgroundColor: C.ink, borderRadius: 8, stack: 'a', maxBarThickness: 26 }] },
  options: { plugins: { legend: { display: true, position: 'bottom', labels: { boxWidth: 10, usePointStyle: true } }, tooltip: tip({ callbacks: { label: (c) => `${c.dataset.label} ${usdc(Math.abs(c.parsed.y), 1)} (${c.dataset.label.startsWith('Buys') ? m[c.dataIndex].buy_n : m[c.dataIndex].sell_n} tx)` } }) },
    scales: { x: axis({ grid: { display: false } }), y: axis({ ticks: { callback: (v) => usdc(Math.abs(v), 0) } }) } } });
  else mEl.append(empty('No open-market buys or sells in the last 25 months.'));

  const latest = card({ cls: 'white', icon: 'file', title: 'Latest transactions', sub: 'Newest first · links open the SEC filing' },
    table([{ k: 'tx_date', label: 'Date', fmt: dateShort }, { k: 'owner_name', label: 'Insider', align: 'l', fmt: (v, r) => h('div', null, h('b', null, v), h('div', { class: 'xs muted' }, (r.owner_role || '').slice(0, 38))) },
      { k: 'code', label: 'Type', fmt: (v, r) => { const [t, c] = CODE[v] || [v, '']; return h('span', null, badge(t, c), r.is_10b5_1 == 1 ? h('span', { class: 'xs muted', title: 'Under a 10b5-1 trading plan' }, ' plan') : null); } },
      { k: 'shares', label: 'Shares', fmt: (v) => int(v) }, { k: 'price', label: 'Price', fmt: (v) => (isNum(v) && v > 0 ? usd(v, 2) : '—') }, { k: 'value_usd', label: 'Value', fmt: (v) => (isNum(v) && v > 0 ? usdc(v, 2) : '—') },
      { k: 'shares_after', label: 'Owned after', fmt: (v) => compact(v, 1) }, { k: 'url', label: '', fmt: (u) => (u ? h('a', { class: 'src-link', href: u, target: '_blank', rel: 'noopener' }, 'Form 4 ↗') : '') }], d.latest.slice(0, 25)));
  root.append(latest);
}

async function filingsBlock(root, sym) {
  const host = h('div');
  let form = '';
  const chips = h('div', { class: 'pill-row', style: { margin: '0 0 12px' } });
  const body = h('div');
  const wrap = card({ cls: 'white', icon: 'file', title: 'SEC filings feed', sub: `${sym} · latest first · from EDGAR` }, chips, body);
  root.append(wrap);
  const load = async () => {
    const d = await api('filings', { symbol: sym, form, limit: 40 });
    chips.replaceChildren(h('button', { class: `pill sm ${form === '' ? 'active' : ''}`, onclick: () => { form = ''; load(); } }, 'All'),
      d.forms.slice(0, 11).map((f) => h('button', { class: `pill sm ${form === f.form ? 'active' : ''}`, onclick: () => { form = f.form; load(); } }, f.form, h('span', { class: 'sub' }, f.n))));
    body.replaceChildren(table([{ k: 'filed', label: 'Filed', fmt: (v) => date(v) }, { k: 'form', label: 'Form', fmt: (v) => badge(v, v === '8-K' ? 'acc' : v === '4' ? '' : v.startsWith('10-') ? 'dark' : '') },
      { k: 'description', label: 'What it is', align: 'l', fmt: (v) => h('span', { class: 'wrap' }, v) }, { k: 'url', label: '', fmt: (u) => h('a', { class: 'src-link', href: u, target: '_blank', rel: 'noopener' }, 'Open ↗') }], d.rows));
  };
  await load();
}
