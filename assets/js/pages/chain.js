// Chain & GEX sub-page: key levels, gamma exposure by strike and across price, OI / volume by strike, IV smile and the full chain.
import { api, num, pct, pctP, usd, usdc, compact, int, date, dateShort, signCls, isNum } from '../util.js';
import { h, card, tile, tag, badge, meter, table, segmented, empty, icon } from '../ui.js';
import { cjs, axis, tip, C, lwChart, lineOpts, disposeAll } from '../charts.js';
import { strikeChart, trimStrikes, expiryTable } from '../sections/optcharts.js';

export async function render(root, ctx) {
  const sym = ctx.symbol;
  const ideasOn = !window.STATIC_SITE || !!window.SHOW_IDEAS;       // specific trade ideas are private by default on the public site
  const start = ideasOn && location.hash.split('/')[3] === 'ideas' ? 'ideas' : 'chain';
  const body = h('div', { class: 'stack' });
  const show = async (tab) => {
    disposeAll();
    history.replaceState(null, '', `#/${sym}/chain${tab === 'ideas' ? '/ideas' : ''}`);
    const inner = h('div', { class: 'stack' });
    body.replaceChildren(inner);                      // attach first: charts measure their container while they are built
    inner.append(h('div', { class: 'skeleton', style: { height: '220px' } }));
    const holder = h('div', { class: 'stack' });
    inner.append(holder);
    try {
      if (tab === 'ideas') await (await import('./ideas.js')).render(holder, ctx);
      else await renderChain(holder, ctx);
    } catch (e) { console.error(e); holder.replaceChildren(card({}, empty(String(e.message || e)))); }
    inner.querySelector('.skeleton')?.remove();
  };
  const tabs = h('div', { class: 'pill-row', style: { marginBottom: '14px' } });
  const mk = (id, label, ic) => { const b = h('button', { class: `pill ${id === start ? 'active' : ''}`, onclick: () => { [...tabs.children].forEach((x) => x.classList.remove('active')); b.classList.add('active'); show(id); } }, icon(ic, 15), label); return b; };
  tabs.append(mk('chain', 'Chain & GEX', 'layers'));
  if (ideasOn) tabs.append(mk('ideas', 'Strategy ideas · buy / sell', 'target'));
  root.append(ideasOn ? tabs : h('span'), body);
  await show(start);
}

async function renderChain(root, ctx) {
  const sym = ctx.symbol;
  const opt = await api('options', { symbol: sym });
  if (!opt.available) { root.append(card({}, empty('No options snapshot stored for this ticker yet.'))); return; }
  const curve = await api('analytics', { symbol: sym, k: 'gex_curve' }).catch(() => null);
  const s = opt.summary; const spot = opt.spot;
  const nearest = opt.expiries[0];
  const g = h('div', { class: 'grid g5' });
  const flipDist = isNum(s.gamma_flip) ? s.gamma_flip / spot - 1 : null;
  g.append(tile({ cls: 'accent', icon: 'layers', label: 'Gamma flip', big: isNum(s.gamma_flip) ? usd(s.gamma_flip, 2) : '—', tag: isNum(flipDist) ? tag(`${pct(flipDist, 1)} vs spot`) : null,
    note: isNum(s.gamma_flip) ? (spot > s.gamma_flip ? 'Spot is ABOVE the flip: dealers net long gamma → tends to dampen moves' : 'Spot is BELOW the flip: dealers net short gamma → tends to amplify moves') : 'No sign change found within ±35% of spot' }));
  g.append(tile({ icon: 'gauge', label: 'Net GEX (per 1% move)', big: usdc(s.net_gex, 1), tag: tag(s.net_gex >= 0 ? 'positive' : 'negative', s.net_gex >= 0 ? 'pos' : 'neg'), note: 'Calls counted +, puts −; assumes dealers are long calls / short puts. A model, not a measurement.' }));
  g.append(tile({ icon: 'target', label: 'Call wall · Put wall', body: h('div', { class: 'two-num' }, h('div', null, h('div', { class: 'l' }, 'CALL'), h('div', { class: 'n' }, isNum(s.call_wall) ? usd(s.call_wall, 0) : '—')), h('div', null, h('div', { class: 'l' }, 'PUT'), h('div', { class: 'n' }, isNum(s.put_wall) ? usd(s.put_wall, 0) : '—'))), note: 'Strikes with the largest call / put gamma exposure — common magnets and pins.' }));
  g.append(tile({ icon: 'bars', label: 'Max pain · next expiry', big: nearest && isNum(nearest.max_pain) ? usd(nearest.max_pain, nearest.max_pain % 1 ? 2 : 0) : '—', tag: nearest ? tag(dateShort(nearest.expiry)) : null, note: nearest ? `${pct(nearest.max_pain / spot - 1, 1)} vs spot · ±1σ move to expiry ${nearest.exp_move ? nearest.exp_move.toFixed(1) + '%' : '—'}` : '' }));
  const pc = s.put_oi / Math.max(1, s.call_oi);
  g.append(tile({ icon: 'layers', label: 'Put / call · open interest', big: pc.toFixed(2), tag: tag(`${compact(s.call_oi + s.put_oi, 1)} contracts`), note: `Calls ${compact(s.call_oi, 1)} · puts ${compact(s.put_oi, 1)} · volume P/C ${(s.put_vol / Math.max(1, s.call_vol)).toFixed(2)}`, meter: meter(Math.min(10, pc * 5), 10, { sm: true }) }));
  root.append(g);

  const state = { exp: 'all' };
  const sel = h('select', { onchange: (e) => { state.exp = e.target.value; draw(); } },
    h('option', { value: 'all' }, 'All expiries'), opt.expiries.map((e) => h('option', { value: e.expiry }, `${dateShort(e.expiry)} ’${e.expiry.slice(2, 4)} · ${e.dte}d`)));
  const gexEl = h('div', { class: 'chart h340' }); const curveEl = h('div', { class: 'chart h340' });
  const oiEl = h('div', { class: 'chart h340' }); const volEl = h('div', { class: 'chart h340' }); const smileEl = h('div', { class: 'chart h340' });
  root.append(h('div', { class: 'row between', style: { margin: '18px 0 8px' } }, h('div', { class: 'sub-title', style: { margin: 0 } }, `Strike-level view · ${dateShort(opt.snapshot)} snapshot`), h('div', { class: 'row' }, h('span', { class: 'small muted' }, 'Expiry'), sel)));
  root.append(h('div', { class: 'grid g2' },
    card({ cls: 'white', icon: 'layers', title: 'Gamma exposure by strike', sub: 'Orange = positive (stabilising) · black = negative (destabilising)' }, gexEl),
    card({ cls: 'white', icon: 'activity', title: 'Gamma exposure vs price', sub: 'Total net GEX if the stock moved to each price (IV held constant)' }, curveEl),
    card({ cls: 'white', icon: 'bars', title: 'Open interest by strike', sub: 'Calls up · puts down' }, oiEl),
    card({ cls: 'white', icon: 'bars', title: 'Volume by strike', sub: 'Contracts traded in the snapshot session' }, volEl)));
  root.append(card({ cls: 'white', icon: 'trend', title: 'Implied-volatility smile', sub: 'IV by strike for the selected expiry (OTM options, from bid/ask mid)', actions: [h('span', { class: 'small muted', id: 'smileLbl' })] }, smileEl));

  const charts = [];
  async function draw() {
    charts.splice(0).forEach((c) => c.dispose());
    [gexEl, oiEl, volEl].forEach((el) => el.replaceChildren());
    const o = await api('options', { symbol: sym, exp: state.exp });
    const st = trimStrikes(o.strikes, spot, 0.5, 1.7);
    const lines = [{ value: o.summary.gamma_flip, color: C.neg, label: `Flip ${num(o.summary.gamma_flip, 0)}`, row: 1 }];
    if (isNum(o.summary.call_wall)) lines.push({ value: o.summary.call_wall, color: C.accentDeep, label: `Call wall ${num(o.summary.call_wall, 0)}`, dash: [2, 3], row: 2 });
    if (isNum(o.summary.put_wall) && o.summary.put_wall !== o.summary.call_wall) lines.push({ value: o.summary.put_wall, color: '#4a6fa5', label: `Put wall ${num(o.summary.put_wall, 0)}`, dash: [2, 3], row: 2 });
    charts.push(strikeChart(gexEl, st, spot, 'gex', lines), strikeChart(oiEl, st, spot, 'oi', lines.slice(0, 1)), strikeChart(volEl, st, spot, 'vol'));
  }
  await draw();

  // GEX vs price
  if (curve) {
    cjs(curveEl, { type: 'line', data: { labels: curve.x, datasets: [{ label: 'Net GEX', data: curve.y, borderColor: C.ink, backgroundColor: 'rgba(247,147,26,.18)', fill: { target: 'origin', above: 'rgba(247,147,26,.28)', below: 'rgba(20,20,20,.16)' }, borderWidth: 2.4, pointRadius: 0, tension: 0.25 }] },
      plugins: [{ id: 'vl', afterDatasetsDraw(ch) { const x = ch.scales.x; const { ctx: c, chartArea: a } = ch; const draw1 = (v, col, txt, row) => { const ks = curve.x; let i = ks.findIndex((k) => k >= v); if (i <= 0) return; const idx = i - 1 + (v - ks[i - 1]) / (ks[i] - ks[i - 1]); const px = x.getPixelForValue(idx); c.save(); c.setLineDash([5, 4]); c.strokeStyle = col; c.lineWidth = 1.6; c.beginPath(); c.moveTo(px, a.top); c.lineTo(px, a.bottom); c.stroke(); c.setLineDash([]); c.fillStyle = col; c.font = '600 11px Inter Tight'; c.textAlign = 'center'; c.fillText(txt, Math.min(Math.max(px, a.left + 30), a.right - 30), a.top - 4 - row * 12); c.restore(); };
        draw1(curve.spot, C.ink, `Spot ${curve.spot.toFixed(1)}`, 0); if (curve.flip) draw1(curve.flip, C.neg, `Flip ${curve.flip.toFixed(1)}`, 1); } }],
      options: { layout: { padding: { top: 18 } }, plugins: { legend: { display: false }, tooltip: tip({ callbacks: { title: (it) => `Price ${Number(it[0].label).toFixed(2)}`, label: (c) => `Net GEX ${usdc(c.parsed.y, 1)} per 1%` } }) },
        scales: { x: axis({ grid: { display: false }, ticks: { maxTicksLimit: 9, callback(v) { return Number(curve.x[v]).toFixed(0); } } }), y: axis({ ticks: { callback: (v) => usdc(v, 0) } }) } } });
  } else curveEl.append(empty('Re-run the options step to build the GEX curve.'));

  // IV smile + chain
  const chainHost = h('div');
  const smileLbl = document.getElementById('smileLbl');
  const sel2 = h('select', { onchange: (e) => loadChain(e.target.value) }, opt.expiries.map((e) => h('option', { value: e.expiry }, `${dateShort(e.expiry)} ’${e.expiry.slice(2, 4)} · ${e.dte}d`)));
  smileLbl.replaceWith(sel2);
  root.append(card({ cls: 'white', icon: 'layers', title: 'Option chain', sub: 'Strikes within ±25% of spot · IV from our Black-Scholes on bid/ask mid' }, chainHost));
  let smile;
  async function loadChain(exp) {
    const c = await api('chain', { symbol: sym, exp });
    smile?.dispose(); smileEl.replaceChildren();
    const rows = c.rows.filter((r) => r.k >= spot * 0.4 && r.k <= spot * 1.9);
    const call = rows.map((r) => (r.C && r.C.iv && r.k >= spot * 0.95 ? r.C.iv * 100 : null));
    const put = rows.map((r) => (r.P && r.P.iv && r.k <= spot * 1.05 ? r.P.iv * 100 : null));
    smile = cjs(smileEl, { type: 'line', data: { labels: rows.map((r) => r.k), datasets: [
      { label: 'Call IV (OTM)', data: call, borderColor: C.accent, backgroundColor: C.accent, borderWidth: 2.6, pointRadius: 3, tension: 0.25, spanGaps: true },
      { label: 'Put IV (OTM)', data: put, borderColor: C.ink, backgroundColor: C.ink, borderWidth: 2.6, pointRadius: 3, tension: 0.25, spanGaps: true }] },
    options: { plugins: { legend: { display: true, position: 'bottom', labels: { boxWidth: 10, usePointStyle: true } }, tooltip: tip({ callbacks: { title: (it) => `Strike ${it[0].label}`, label: (x) => `${x.dataset.label} ${x.parsed.y.toFixed(1)}%` } }) },
      scales: { x: axis({ grid: { display: false }, ticks: { maxTicksLimit: 12 } }), y: axis({ ticks: { callback: (v) => `${v}%` } }) } } });
    const near = c.rows.filter((r) => r.k >= spot * 0.75 && r.k <= spot * 1.25);
    const fmt = (x, k, d = 2) => (x && x[k] != null ? num(x[k], d) : '—');
    chainHost.replaceChildren(table([
      { k: (r) => r.C, label: 'Bid', fmt: (x) => fmt(x, 'bid') }, { k: (r) => r.C, label: 'Ask', fmt: (x) => fmt(x, 'ask') }, { k: (r) => r.C, label: 'Vol', fmt: (x) => (x ? int(x.vol) : '—') },
      { k: (r) => r.C, label: 'OI', fmt: (x) => (x ? int(x.oi) : '—') }, { k: (r) => r.C, label: 'IV', fmt: (x) => (x && x.iv ? `${(x.iv * 100).toFixed(0)}%` : '—') }, { k: (r) => r.C, label: 'Δ', fmt: (x) => fmt(x, 'delta', 2) },
      { k: 'k', label: 'Strike', fmt: (v) => h('b', null, usd(v, v % 1 ? 2 : 0)), cls: 'l' },
      { k: (r) => r.P, label: 'Δ', fmt: (x) => fmt(x, 'delta', 2) }, { k: (r) => r.P, label: 'IV', fmt: (x) => (x && x.iv ? `${(x.iv * 100).toFixed(0)}%` : '—') },
      { k: (r) => r.P, label: 'OI', fmt: (x) => (x ? int(x.oi) : '—') }, { k: (r) => r.P, label: 'Vol', fmt: (x) => (x ? int(x.vol) : '—') },
      { k: (r) => r.P, label: 'Bid', fmt: (x) => fmt(x, 'bid') }, { k: (r) => r.P, label: 'Ask', fmt: (x) => fmt(x, 'ask') },
    ], near, { rowCls: (r) => (Math.abs(r.k - spot) === Math.min(...near.map((n) => Math.abs(n.k - spot))) ? 'cur' : '') }));
  }
  await loadChain(opt.expiries[0].expiry);
  root.append(card({ cls: 'white', icon: 'calendar', title: 'Expiration table', sub: 'All expiries, same snapshot' }, expiryTable(opt.expiries, spot, null, null)));
  root.append(h('p', { class: 'disclaimer' }, 'Gamma exposure is modelled from open interest, the assumption that dealers are long customer-sold calls and short customer-bought puts, and our own Black-Scholes greeks on Yahoo quotes. Professional GEX vendors (SpotGamma etc.) use order-flow data and will differ. Open interest updates once per day.'));
}
