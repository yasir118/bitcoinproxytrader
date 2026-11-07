// Section 3 — Volatility & options.
import { api, num, pct, pctP, usd, usdc, compact, int, date, dateShort, dateMY, signCls, isNum, IS_STATIC } from '../util.js';
import { h, card, tile, tag, badge, meter, table, segmented, empty, icon } from '../ui.js';
import { lwChart, cjs, axis, tip, lineOpts, C, legend } from '../charts.js';
import { strikeChart, trimStrikes, expiryTable } from './optcharts.js';

const pts = (x) => (isNum(x) ? `${x >= 0 ? '+' : '−'}${Math.abs(x).toFixed(1)}` : '—');

export async function render(root, ctx, ov) {
  const sym = ctx.symbol;
  const [vol, opt, watch] = await Promise.all([api('vol', { symbol: sym }), api('options', { symbol: sym }), sym === 'MSTR' ? api('optwatch') : Promise.resolve(null)]);
  marketVol(root, sym, vol, opt);
  if (opt.available) {
    await volBlock(root, sym, vol, opt, ov);
    await optionsBlock(root, sym, opt);
  } else root.append(card({}, empty('No options snapshot stored for this ticker yet.')));
  if (watch) await watchBlock(root, watch, opt);
}

// ---------------------------------------------------------------- market volatility
function marketVol(root, sym, v, opt) {
  root.append(h('div', { class: 'sub-title', style: { marginTop: '4px' } }, 'Market volatility'));
  const g = h('div', { class: 'grid g5' });
  const pc = (x) => (isNum(x) ? `${Math.round(x)}th pct` : '');
  g.append(tile({ icon: 'activity', label: 'VIX', big: num(v.vix_now, 2), tag: tag(pts(v.vix_chg), v.vix_chg > 0 ? 'neg' : 'pos'), note: `${pc(v.vix_pctile)} of last 4y · 1 wk ago ${num(v.vix_wk, 1)}`, meter: meter(Math.min(10, (v.vix_now || 0) / 4), 10, { sm: true }) }));
  g.append(tile({ cls: 'accent', icon: 'bolt', label: 'Deribit DVOL (BTC IV)', big: num(v.dvol_now, 1), tag: tag(pts(v.dvol_chg), v.dvol_chg > 0 ? 'neg' : 'pos'), note: `${pc(v.dvol_pctile)} since 2021 · 1 wk ago ${num(v.dvol_wk, 1)}`, meter: meter(Math.min(10, (v.dvol_now || 0) / 8), 10, { sm: true }) }));
  const iv30 = opt.available ? opt.summary.iv30 : null;
  const r = isNum(iv30) && isNum(v.dvol_now) ? (iv30 * 100) / v.dvol_now : null;
  g.append(tile({ icon: 'target', label: `${sym} IV30 vs BTC DVOL`, big: isNum(r) ? `${r.toFixed(2)}×` : '—', note: isNum(iv30) ? `${sym} IV30 ${(iv30 * 100).toFixed(1)} vs DVOL ${num(v.dvol_now, 1)} — ${isNum(r) && r > 1 ? 'extra vol premium vs bitcoin' : 'cheaper than bitcoin vol'}` : 'Needs an options snapshot' }));
  const rv30 = v.btc_rv?.rv30; const diff = isNum(rv30) && isNum(v.dvol_now) ? v.dvol_now - rv30 * 100 : null;
  g.append(tile({ icon: 'gauge', label: 'BTC IV − realised', big: isNum(diff) ? pts(diff) : '—', unit: 'vol pts', tag: isNum(diff) ? tag(diff > 0 ? 'IV rich' : 'IV cheap', diff > 0 ? 'neg' : 'pos') : null, note: `DVOL ${num(v.dvol_now, 1)} vs 30d realised ${isNum(rv30) ? (rv30 * 100).toFixed(1) : '—'}` }));
  const sp = isNum(v.dvol_now) && isNum(v.vix_now) ? v.dvol_now / v.vix_now : null;
  g.append(tile({ icon: 'bars', label: 'DVOL vs VIX', big: isNum(sp) ? `${sp.toFixed(2)}×` : '—', note: isNum(sp) ? `Spread ${pts(v.dvol_now - v.vix_now)} vol pts — bitcoin options vs S&P` : '' }));
  root.append(g);

  const aEl = h('div', { class: 'chart h300' });
  const bEl = h('div', { class: 'chart h300' });
  root.append(h('div', { class: 'grid g2' },
    card({ cls: 'white', icon: 'activity', title: 'DVOL vs VIX', sub: 'Implied vol of bitcoin vs the S&P 500, last ~3 years' }, aEl),
    card({ cls: 'white', icon: 'bolt', title: 'BTC implied vs realised vol', sub: 'DVOL against 30-day realised volatility' }, bEl)));
  const a = lwChart(aEl);
  const s1 = a.addLineSeries(lineOpts(C.accent, 2.2, { lastValueVisible: true })); const s2 = a.addLineSeries(lineOpts(C.ink, 2, { lastValueVisible: true }));
  s1.setData(v.dvol.filter((r) => r[1] != null).map((r) => ({ time: r[0], value: r[1] }))); s2.setData(v.vix.filter((r) => r[1] != null).map((r) => ({ time: r[0], value: r[1] })));
  legend(aEl, [{ color: C.accent, label: 'DVOL' }, { color: C.ink, label: 'VIX' }]); a.timeScale().fitContent();
  const b = lwChart(bEl);
  const i1 = b.addLineSeries(lineOpts(C.accent, 2.2, { lastValueVisible: true })); const r1 = b.addLineSeries(lineOpts(C.ink, 2, { lastValueVisible: true }));
  i1.setData(v.dvol.filter((r) => r[1] != null).map((r) => ({ time: r[0], value: r[1] })));
  if (v.btc_rv) r1.setData(v.btc_rv.series.filter((r) => r[2] != null).map((r) => ({ time: r[0], value: r[2] * 100 })));
  legend(bEl, [{ color: C.accent, label: 'DVOL (implied)' }, { color: C.ink, label: 'Realised 30d' }]); b.timeScale().fitContent();
}

// ---------------------------------------------------------------- volatility
async function volBlock(root, sym, v, opt, ov) {
  root.append(h('div', { class: 'sub-title' }, `${sym} volatility`));
  const s = opt.summary; const rv = v.rv || {};
  const nSnap = opt.history.length;
  const g = h('div', { class: 'grid g3' });
  g.append(tile({ cls: 'accent', icon: 'bolt', label: '30-day ATM IV', big: isNum(s.iv30) ? `${(s.iv30 * 100).toFixed(1)}%` : '—', tag: tag(`front ${isNum(s.iv_front) ? (s.iv_front * 100).toFixed(1) : '—'}%`),
    note: `Constant-maturity from the ${dateShort(opt.snapshot)} chain (variance-interpolated)`, meter: meter(Math.min(10, (s.iv30 || 0) * 10), 10, { sm: true }) }));
  g.append(tile({ icon: 'activity', label: 'Realised vol', body: h('div', { class: 'two-num' },
    h('div', null, h('div', { class: 'l' }, 'RV20'), h('div', { class: 'n' }, isNum(rv.rv20) ? `${(rv.rv20 * 100).toFixed(1)}%` : '—')),
    h('div', null, h('div', { class: 'l' }, 'RV30'), h('div', { class: 'n' }, isNum(rv.rv30) ? `${(rv.rv30 * 100).toFixed(1)}%` : '—'))), note: `RV60 ${isNum(rv.rv60) ? (rv.rv60 * 100).toFixed(1) + '%' : '—'} · annualised close-to-close` }));
  const ivrv = isNum(s.iv30) && isNum(rv.rv20) ? (s.iv30 - rv.rv20) * 100 : null;
  g.append(tile({ icon: 'target', label: 'IV − RV (IV30 − RV20)', big: isNum(ivrv) ? pts(ivrv) : '—', unit: 'vol pts', tag: isNum(ivrv) ? tag(ivrv > 0 ? 'options rich' : 'options cheap', ivrv > 0 ? 'neg' : 'pos') : null,
    note: isNum(ivrv) ? (ivrv < 0 ? 'Implied below realised: market is pricing calmer than recent moves' : 'Implied above realised: premium for sellers') : '' }));
  g.append(tile({ icon: 'gauge', label: 'Percentiles', body: h('div', { class: 'mini-list' },
    h('div', { class: 'r' }, h('span', null, 'RV20 since Aug ’20'), h('b', null, isNum(rv.pctile) ? `${Math.round(rv.pctile)}th` : '—')),
    h('div', { class: 'r' }, h('span', null, 'IV30 history'), nSnap >= 30 ? h('b', null, 'see chart') : badge(`building · ${nSnap}/30 days`, 'acc'))),
    note: nSnap < 30 ? 'IV history can’t be reconstructed from free data — each daily run adds a snapshot. Add a Massive Options key to back-fill.' : '' }));
  g.append(tile({ icon: 'layers', label: '25Δ skew (30d)', big: isNum(s.skew25) ? pts(s.skew25 * 100) : '—', unit: 'vol pts', tag: isNum(s.skew25) ? tag(s.skew25 < 0 ? 'call skew' : 'put skew', s.skew25 < 0 ? 'pos' : 'neg') : null,
    note: 'Put IV minus call IV at 25-delta. Positive = downside is priced richer; negative = upside calls are richer.' }));
  const sd = isNum(s.iv30) ? opt.spot * s.iv30 / Math.sqrt(252) : null;
  g.append(tile({ icon: 'dollar', label: '1σ daily move', big: isNum(sd) ? usd(sd, 2) : '—', tag: isNum(sd) ? tag(`±${(s.iv30 / Math.sqrt(252) * 100).toFixed(1)}%`) : null, note: `Implied by IV30 ÷ √252 on ${usd(opt.spot)} — about 68% of days should land inside` }));
  root.append(g);

  const rEl = h('div', { class: 'chart h340' });
  const tEl = h('div', { class: 'chart h340' });
  root.append(h('div', { class: 'grid g-3-2' },
    card({ cls: 'white', icon: 'activity', title: 'Realised vs implied', sub: `${sym} realised vol (RV20 / RV30) and IV30 snapshots` }, rEl),
    card({ cls: 'white', icon: 'layers', title: 'Term structure', sub: `ATM implied vol by expiry · ${dateShort(opt.snapshot)} snapshot` }, tEl)));
  const c = lwChart(rEl);
  const a = c.addLineSeries(lineOpts(C.ink, 2)); const b = c.addLineSeries(lineOpts('#9aa097', 1.6, { lineStyle: 2 }));
  const series = (v.rv?.series || []).filter((r) => r[1] != null);
  a.setData(series.map((r) => ({ time: r[0], value: r[1] * 100 }))); b.setData(series.filter((r) => r[2] != null).map((r) => ({ time: r[0], value: r[2] * 100 })));
  const iv = c.addLineSeries({ ...lineOpts(C.accent, 2.4), pointMarkersVisible: true, pointMarkersRadius: 4, lastValueVisible: true });
  iv.setData(opt.history.filter((r) => r.iv30 != null).map((r) => ({ time: r.d, value: r.iv30 * 100 })));
  legend(rEl, [{ color: C.ink, label: 'RV20' }, { color: '#9aa097', label: 'RV30' }, { color: C.accent, label: `IV30 (${nSnap} snapshot${nSnap > 1 ? 's' : ''})` }]);
  c.timeScale().fitContent();
  const ex = opt.expiries.filter((e) => e.atm_iv && e.dte >= 1);
  cjs(tEl, { type: 'line', data: { labels: ex.map((e) => `${dateShort(e.expiry)} ’${e.expiry.slice(2, 4)}`), datasets: [
    { label: 'ATM IV %', data: ex.map((e) => e.atm_iv * 100), borderColor: C.accent, backgroundColor: C.accent, borderWidth: 3, tension: 0.3, pointRadius: 4, yAxisID: 'y' },
    { label: 'DTE', data: ex.map((e) => e.dte), borderColor: 'transparent', pointRadius: 0, yAxisID: 'y1', hidden: false, showLine: false }] },
  options: { plugins: { legend: { display: false }, tooltip: tip({ callbacks: { label: (c2) => (c2.datasetIndex === 0 ? `ATM IV ${c2.parsed.y.toFixed(1)}%` : `${c2.parsed.y} days`) } }) },
    scales: { x: axis({ grid: { display: false }, ticks: { maxRotation: 55, minRotation: 55, font: { size: 10 } } }), y: axis({ ticks: { callback: (x) => `${x}%` } }), y1: { display: false } } } });
}

// ---------------------------------------------------------------- options
async function optionsBlock(root, sym, opt) {
  root.append(h('div', { class: 'sub-title' }, 'Options'));
  const spot = opt.spot;
  const state = { exp: 'all' };
  const expTable = h('div');
  const drawTable = () => { expTable.replaceChildren(expiryTable(opt.expiries, spot, (r) => { state.exp = r.expiry; sel.value = r.expiry; drawStrikes(); drawTable(); }, state.exp)); };
  drawTable();
  const summary = opt.summary;
  root.append(card({ cls: 'white', icon: 'layers', title: 'Expiration table', sub: `${dateShort(opt.snapshot)} snapshot · ${compact(summary.call_oi + summary.put_oi)} open contracts · P/C OI ${(summary.put_oi / Math.max(1, summary.call_oi)).toFixed(2)} · click a row to focus the strike charts`, actions: [h('a', { class: 'pill xs', href: `#/${sym}/chain` }, 'Full chain & GEX ', icon('arrow', 12))] }, expTable));

  const sel = h('select', { onchange: (e) => { state.exp = e.target.value; drawStrikes(); drawTable(); } },
    h('option', { value: 'all' }, 'All expiries'), h('option', { value: 'next' }, 'Next expiry'), opt.expiries.map((e) => h('option', { value: e.expiry }, `${dateShort(e.expiry)} ’${e.expiry.slice(2, 4)} · ${e.dte}d`)));
  const oiEl = h('div', { class: 'chart h340' });
  const chEl = h('div', { class: 'chart h340' });
  const oiCard = card({ cls: 'white', icon: 'bars', title: 'Open interest by strike', sub: 'Calls up · puts down · dashed line = spot', actions: [sel] }, oiEl);
  const chCard = card({ cls: 'white', icon: 'activity', title: 'Open-interest changes', sub: opt.prev_snapshot ? `Change vs ${dateShort(opt.prev_snapshot)}` : 'Needs two daily snapshots' }, chEl);
  root.append(h('div', { class: 'grid g2' }, oiCard, chCard));
  let oiChart; let chChart;
  async function drawStrikes() {
    const o = await api('options', { symbol: sym, exp: state.exp });
    oiChart?.dispose(); chChart?.dispose();
    oiEl.replaceChildren(); chEl.replaceChildren();
    const st = trimStrikes(o.strikes, spot);
    const lines = [{ value: o.summary.gamma_flip, color: C.neg, label: `Flip ${num(o.summary.gamma_flip, 0)}`, row: 1 }];
    oiChart = strikeChart(oiEl, st, spot, 'oi', lines);
    if (o.prev_snapshot) chChart = strikeChart(chEl, st.filter((s) => s.dcoi != null), spot, 'chg');
    else chEl.append(empty('Open-interest changes appear after the next daily snapshot (Yahoo only exposes the current chain). Run the collector again tomorrow — or schedule it — and this fills in.'));
  }
  await drawStrikes();

  // max pain + daily volume
  const mpEl = h('div', { class: 'chart h300' }); const dvEl = h('div', { class: 'chart h300' });
  root.append(h('div', { class: 'grid g2' },
    card({ cls: 'white', icon: 'target', title: 'Max pain by expiry', sub: 'Strike where option holders lose the most at expiry · line = spot' }, mpEl),
    card({ cls: 'white', icon: 'bars', title: 'Daily options volume', sub: `Total calls vs puts per snapshot (${opt.history.length} stored)` }, dvEl)));
  const ex = opt.expiries.filter((e) => e.max_pain && e.dte <= 400);
  cjs(mpEl, { type: 'bar', data: { labels: ex.map((e) => `${dateShort(e.expiry)} ’${e.expiry.slice(2, 4)}`), datasets: [
    { label: 'Max pain', data: ex.map((e) => e.max_pain), backgroundColor: C.ink, borderRadius: 10, maxBarThickness: 26 },
    { type: 'line', label: 'Spot', data: ex.map(() => spot), borderColor: C.accent, borderWidth: 2.4, pointRadius: 0, borderDash: [6, 4] }] },
  options: { plugins: { legend: { display: false }, tooltip: tip({ callbacks: { label: (c) => (c.datasetIndex === 0 ? `Max pain ${usd(c.parsed.y, 2)} (${pct(c.parsed.y / spot - 1, 1)} vs spot)` : `Spot ${usd(spot)}`) } }) },
    scales: { x: axis({ grid: { display: false }, ticks: { maxRotation: 55, minRotation: 55, font: { size: 10 } } }), y: axis({ beginAtZero: false, ticks: { callback: (x) => usd(x, 0) } }) } } });
  const hist = opt.history.slice(-60);
  cjs(dvEl, { type: 'bar', data: { labels: hist.map((r) => dateShort(r.d)), datasets: [
    { label: 'Call volume', data: hist.map((r) => r.call_vol), backgroundColor: C.accent, borderRadius: 6, stack: 'v', maxBarThickness: 40 },
    { label: 'Put volume', data: hist.map((r) => r.put_vol), backgroundColor: C.ink, borderRadius: 6, stack: 'v', maxBarThickness: 40 }] },
  options: { plugins: { legend: { display: true, position: 'bottom', labels: { boxWidth: 10, usePointStyle: true } }, tooltip: tip({ callbacks: { label: (c) => `${c.dataset.label}: ${int(c.parsed.y)}` } }) },
    scales: { x: axis({ stacked: true, grid: { display: false } }), y: axis({ stacked: true, ticks: { callback: (x) => compact(x, 0) } }) } } });
  if (opt.oi_changes?.length) {
    root.append(card({ cls: 'white', title: 'Largest contract-level OI changes', sub: `vs ${dateShort(opt.prev_snapshot)}` },
      table([{ k: 'contract', label: 'Contract', align: 'l', fmt: (v) => h('b', null, v) }, { k: 'expiry', label: 'Expiry', fmt: dateShort }, { k: 't', label: 'Type' }, { k: 'strike', label: 'Strike', fmt: (v) => usd(+v, 0) },
        { k: 'oi', label: 'OI', fmt: (v) => int(+v) }, { k: 'd_oi', label: 'Δ OI', fmt: (v) => h('span', { class: signCls(+v) }, `${v > 0 ? '+' : ''}${int(+v)}`) }, { k: 'volume', label: 'Volume', fmt: (v) => int(+v) },
        { k: 'iv', label: 'IV', fmt: (v) => (v ? `${(v * 100).toFixed(0)}%` : '—') }], opt.oi_changes)));
  }
}

// ---------------------------------------------------------------- option IV watch
async function watchBlock(root, w, opt) {
  root.append(h('div', { class: 'sub-title' }, 'Option IV watch'));
  const sp = w.spec; const l = w.latest;
  const title = `${sp.symbol} $${sp.strike} ${sp.type === 'C' ? 'call' : 'put'} · ${date(sp.expiry)}`;
  const wrap = card({ cls: 'hi', icon: 'target', title, sub: `${w.contract} · ${w.dte} days to expiry` });
  if (!l) { wrap.append(empty('The contract was not in the latest snapshot.')); root.append(wrap); return; }
  const mid = (isNum(l.bid) && isNum(l.ask) && l.ask > 0) ? (l.bid + l.ask) / 2 : l.last;
  const be = sp.strike + mid;
  const g = h('div', { class: 'grid g5', style: { marginBottom: '14px' } });
  g.append(tile({ cls: 'accent', icon: 'dollar', label: 'Premium (mid)', big: usd(mid, 2), tag: tag(`bid ${num(l.bid)} / ask ${num(l.ask)}`), note: `Last ${num(l.last)} · ×100 = ${usd(mid * 100, 0)} per contract` }));
  g.append(tile({ icon: 'bolt', label: 'Implied vol', big: isNum(l.iv) ? `${(l.iv * 100).toFixed(1)}%` : '—', note: `vs ${sp.symbol} IV30 ${isNum(opt.summary?.iv30) ? (opt.summary.iv30 * 100).toFixed(1) + '%' : '—'} (skew / term premium for far OTM)` }));
  g.append(tile({ icon: 'gauge', label: 'Delta', big: isNum(l.delta) ? l.delta.toFixed(3) : '—', note: `≈ ${isNum(l.delta) ? (l.delta * 100).toFixed(0) : '—'}% risk-neutral chance of finishing in the money`, meter: isNum(l.delta) ? meter(l.delta * 10, 10, { sm: true }) : null }));
  g.append(tile({ icon: 'target', label: 'Breakeven', big: usd(be, 2), tag: tag(`${pct(be / w.spot - 1, 0)} from spot`), note: `Spot ${usd(w.spot)} · strike is ${pct(sp.strike / w.spot - 1, 0)} away` }));
  g.append(tile({ icon: 'layers', label: 'Open interest · volume', big: int(l.oi), unit: 'contracts', note: `${int(l.volume)} traded on ${dateShort(l.date)}` }));
  wrap.append(g);
  const el = h('div', { class: 'chart h300' });
  wrap.append(card({ cls: 'white', title: 'IV and premium history', sub: `${w.history.length} daily snapshot${w.history.length === 1 ? '' : 's'} stored${w.backfill_enabled ? ' (Massive back-fill enabled)' : ''}` }, el));
  if (w.history.length < 15) wrap.append(h('div', { class: 'small muted', style: { marginTop: '10px' } }, IS_STATIC ? 'History builds up with every daily update.' : 'History accumulates with every collector run. To back-fill past months immediately, add your Massive.com Options key to collector/config.local.json (see README) and run  python run_all.py --only watchfill.'));
  root.append(wrap);
  const hs = w.history;
  cjs(el, { type: 'line', data: { labels: hs.map((r) => dateShort(r.d)), datasets: [
    { label: 'IV %', data: hs.map((r) => (r.iv ? r.iv * 100 : null)), borderColor: C.accent, backgroundColor: C.accent, borderWidth: 3, pointRadius: hs.length < 40 ? 5 : 0, tension: 0.25, yAxisID: 'y', spanGaps: true },
    { label: 'Premium $', data: hs.map((r) => r.price), borderColor: C.ink, backgroundColor: C.ink, borderWidth: 2, pointRadius: hs.length < 40 ? 4 : 0, tension: 0.25, yAxisID: 'y1', spanGaps: true }] },
  options: { plugins: { legend: { display: true, position: 'bottom', labels: { boxWidth: 10, usePointStyle: true } }, tooltip: tip() },
    scales: { x: axis({ grid: { display: false } }), y: axis({ ticks: { callback: (x) => `${x}%` } }), y1: { position: 'right', grid: { display: false }, border: { display: false }, ticks: { callback: (x) => `$${x}` } } } } });
}
