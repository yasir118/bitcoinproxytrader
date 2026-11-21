// Strategy ideas (inside Chain & GEX): concrete, defined-risk option trades built from the real chain quotes, ranked with a visible score.
import { api, num, pct, usd, int, date, dateShort, signCls, isNum, compact } from '../util.js';
import { h, card, tile, tag, badge, table, segmented, empty, icon, verdictBadge } from '../ui.js';
import { cjs, axis, tip, C } from '../charts.js';

const money = (x, d = 0) => (isNum(x) ? `${x < 0 ? '−' : ''}$${Math.abs(x).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })}` : '—');
const exp = (s) => `${dateShort(s)} ’${s.slice(2, 4)}`;
const legTxt = (l) => (l.type === 'STOCK' ? 'Own 100 shares' : `${l.side > 0 ? 'BUY' : 'SELL'} $${l.strike} ${l.type === 'C' ? 'call' : 'put'}`);

export async function render(root, ctx) {
  const sym = ctx.symbol;
  const d = await api('analytics', { symbol: sym, k: 'strategies' }).catch(() => null);
  if (!d) { root.append(card({}, empty('No strategy ideas for this ticker: it needs an options snapshot with liquid quotes (run the collector).'))); return; }
  const cx = d.context; const spot = d.spot;
  const uni = (key) => d.buckets[key];

  root.append(h('div', { class: 'callout' }, h('b', null, 'How to use this. '), 'The tab turns today’s real option quotes into concrete trades and ranks them with a visible score. ',
    'It cannot know which trade will win — it shows what each costs, what you can lose, where it breaks even, and what the chain, volatility and levels say. ', h('b', null, 'Only defined-risk structures are shown'),
    ' (no naked short options). Prices are the last close’s bid/ask mid — use limit orders and re-check live quotes. Education, not advice.'));

  // ---------------------------------------------------------------- context strip
  const g = h('div', { class: 'grid g5', style: { marginTop: '16px' } });
  const vv = cx.vol_view;
  g.append(tile({ icon: 'target', label: 'Regime read (Signals)', body: h('div', null, h('div', { class: `verdict v-${cx.verdict}`, style: { fontSize: '26px' } }, h('span', { class: 'vdot' }), cx.verdict), h('div', { class: 'note' }, `Score ${cx.score > 0 ? '+' : ''}${Math.round(cx.score)} → ${cx.bias === 'bull' ? 'bullish' : cx.bias === 'bear' ? 'bearish' : 'neutral'} tilt`)),
    note: 'Low weight in the ranking: its track record is weak.' }));
  g.append(tile({ cls: vv === 'cheap' ? 'accent' : '', icon: 'bolt', label: 'Options price vs realised vol', big: `${cx.iv_rv.toFixed(2)}×`, tag: tag(vv === 'cheap' ? 'options cheap' : vv === 'rich' ? 'options rich' : 'fair', vv === 'rich' ? 'neg' : vv === 'cheap' ? '' : ''),
    note: `IV30 ${(cx.iv30 * 100).toFixed(0)}% vs realised ${(cx.sigma_rv * 100).toFixed(0)}% (RV20 ${(cx.rv20 * 100).toFixed(0)} · RV60 ${(cx.rv60 * 100).toFixed(0)}). ${vv === 'cheap' ? 'Buying premium is favoured, selling is not.' : vv === 'rich' ? 'Selling premium is favoured.' : 'Neither side has a clear vol edge.'}` }));
  g.append(tile({ icon: 'layers', label: '25Δ skew (30d)', big: isNum(cx.skew25) ? `${cx.skew25 * 100 >= 0 ? '+' : '−'}${Math.abs(cx.skew25 * 100).toFixed(1)}` : '—', unit: 'vol pts',
    note: isNum(cx.skew25) ? (cx.skew25 < 0 ? 'Calls are priced richer than puts: upside is expensive, downside protection is relatively cheap.' : 'Puts are richer than calls: downside protection is expensive; selling puts pays more.') : '' }));
  g.append(tile({ icon: 'gauge', label: 'Gamma context', body: h('div', { style: { fontSize: '30px', letterSpacing: '-0.03em', lineHeight: 1.1 } }, cx.gex_regime === 'dampening' ? 'Dampening' : cx.gex_regime === 'amplifying' ? 'Amplifying' : 'Neutral'), note: `Spot ${usd(spot)} vs flip ${usd(cx.gamma_flip, 2)} · call wall ${usd(cx.call_wall, 0)} · put wall ${usd(cx.put_wall, 0)}. ${cx.gex_regime === 'dampening' ? 'Dealer hedging tends to calm moves (range-bound bias).' : 'Dealer hedging tends to amplify moves.'}` }));
  g.append(tile({ icon: 'calendar', label: 'Event risk', big: cx.earnings ? `${cx.earnings_days}d` : '—', unit: cx.earnings ? 'to earnings' : '', note: cx.earnings ? `Earnings ${date(cx.earnings)}: any expiry after that includes a gap and an implied-vol drop.` : 'No earnings date announced.' }));
  root.append(g);

  // ---------------------------------------------------------------- shortlist
  const rows = [];
  [['weekly', 'Weekly'], ['monthly', '1–2 months'], ['long', 'Long-term']].forEach(([k, lbl]) => {
    const b = uni(k); if (!b) return;
    [['buy', 'BUY'], ['sell', 'SELL'], ['holder', 'IF YOU OWN SHARES']].forEach(([grp, side]) => { if (b[grp][0]) rows.push({ k, lbl, grp, side, i: b[grp][0] }); });
  });
  const shortHost = h('div');
  root.append(card({ cls: 'white', icon: 'target', title: 'Today’s shortlist', sub: 'The top-scoring idea for each horizon and side — click a row to jump to its details', id: 'shortlist' }, shortHost));
  shortHost.append(table([
    { k: 'lbl', label: 'Horizon', fmt: (v) => h('b', null, v) },
    { k: 'side', label: 'Side', fmt: (v) => badge(v, v === 'BUY' ? 'pos' : v === 'SELL' ? 'neg' : 'acc') },
    { k: 'i', label: 'Idea', align: 'l', fmt: (i) => h('div', null, h('b', null, i.name), h('div', { class: 'xs muted' }, `${exp(i.expiry)} · ${i.dte}d`)) },
    { k: 'i', label: 'What to trade', align: 'l', fmt: (i) => h('div', { class: 'wrap', style: { whiteSpace: 'normal', minWidth: '240px' } }, i.legs.filter((l) => l.type !== 'STOCK').map((l) => h('div', null, `${legTxt(l)} @ ${money(l.mid, 2)}`))) },
    { k: 'i', label: 'Net', fmt: (i) => h('b', { class: i.cost_mid > 0 ? '' : 'pos' }, `${i.cost_mid > 0 ? 'Pay' : 'Get'} ${money(Math.abs(i.cost_mid) * 100)}`) },
    { k: 'i', label: 'Max loss', fmt: (i) => (i.kind === 'holder' ? h('span', { class: 'muted' }, 'shares + put') : money(i.max_loss * 100)) },
    { k: 'i', label: 'Breakeven', fmt: (i) => i.breakevens.map((b) => usd(b, 2)).join(' / ') },
    { k: 'i', label: 'PoP', fmt: (i) => `${Math.round(i.pop_imp * 100)}%` },
    { k: 'i', label: 'Score', fmt: (i) => h('span', { class: 'badge dark' }, i.score) },
  ], rows, { onRow: (r) => { const idx = ['weekly', 'monthly', 'long'].indexOf(r.k); if (horizon !== r.k) seg.querySelectorAll('button')[idx].click(); setTimeout(() => { const t = document.getElementById(`idea-${r.i.name}-${r.i.expiry}-${r.i.variant}`.replace(/[^a-zA-Z0-9_-]/g, '_')); t?.scrollIntoView({ behavior: 'smooth', block: 'center' }); t?.querySelector('button.pill')?.click(); }, 120); } }));

  // ---------------------------------------------------------------- horizon tabs
  let horizon = 'weekly';
  const host = h('div', { class: 'stack' });
  const seg = segmented([{ value: 'weekly', label: 'Weekly' }, { value: 'monthly', label: '1–2 months' }, { value: 'long', label: 'Long-term (6 mo+)' }], horizon, (v) => { horizon = v; draw(); });
  root.append(h('div', { class: 'row between', style: { margin: '26px 0 6px' } }, h('div', { class: 'sub-title', style: { margin: 0 } }, 'All ideas by horizon'), seg), host);

  function draw() {
    host.replaceChildren();
    const b = uni(horizon);
    if (!b || (!b.buy.length && !b.sell.length && !b.holder.length)) { host.append(card({}, empty('No liquid expiries in this window for this ticker.'))); return; }
    host.append(h('div', { class: 'small muted' }, `Expiries used: ${b.expiries.map((e) => `${exp(e.expiry)} (${e.dte}d, ATM IV ${isNum(e.atm_iv) ? (e.atm_iv * 100).toFixed(0) : '—'}%, ±1σ ${isNum(e.exp_move_pct) ? e.exp_move_pct.toFixed(1) : '—'}%)`).join(' · ')} · ${b.n_candidates} candidates screened`));
    const favour = (grp) => {
      if (grp === 'buy') return vv === 'cheap' ? { cls: 'info', t: `Buying premium is the favoured side right now: options are priced ${Math.round((1 - cx.iv_rv) * 100)}% below recent realised vol.` } : vv === 'rich' ? { cls: 'warn', t: 'Buying premium is expensive right now: options are priced above recent realised vol, so you start behind.' } : { cls: 'info', t: 'Option prices are close to realised vol: no strong volatility edge either way.' };
      if (grp === 'sell') return vv === 'rich' ? { cls: 'info', t: 'Selling premium is the favoured side: options are priced above realised vol.' } : vv === 'cheap' ? { cls: 'warn', t: `Selling premium is NOT favoured right now: you would be selling options priced ${Math.round((1 - cx.iv_rv) * 100)}% below what the stock has actually been moving. The ideas below are the least-bad ones; their model edge is negative.` } : { cls: 'info', t: 'No strong volatility edge for sellers; probability of profit is high but each loss is larger than each win.' };
      return { cls: 'info', t: 'For investors who already own at least 100 shares per contract: income (covered call), insurance (protective put) or both (collar).' };
    };
    [['buy', 'BUY premium', 'Own the option: you pay up front, your maximum loss is what you paid.'], ['sell', 'SELL premium', 'Collect premium: win more often, lose more when wrong. Spreads cap the loss; cash-secured puts need cash set aside.'], ['holder', 'If you own the shares', 'Covered call · protective put · collar (per 100 shares).']].forEach(([grp, title, sub]) => {
      if (!b[grp].length) return;
      const f2 = favour(grp);
      host.append(h('div', { class: 'sub-title' }, title), h('div', { class: `callout ${f2.cls}`, style: { marginBottom: '12px' } }, sub, ' ', h('b', null, f2.t)));
      const list = h('div', { class: 'stack', style: { gap: '12px' } });
      b[grp].forEach((i, n) => list.append(ideaCard(i, n === 0 && grp === 'buy', spot)));
      host.append(list);
    });
    // single contracts
    host.append(h('div', { class: 'sub-title' }, 'Single contracts that look cheap or rich vs realised vol'));
    const cols = (cheap) => [
      { k: 'type', label: 'Contract', align: 'l', fmt: (v, r) => h('div', null, h('b', null, `$${r.strike} ${v === 'C' ? 'call' : 'put'}`), h('div', { class: 'xs muted' }, `${exp(r.expiry)} · ${r.dte}d`)) },
      { k: 'mid', label: 'Price', fmt: (v, r) => h('span', null, h('b', null, money(v, 2)), h('span', { class: 'xs muted' }, ` (${money(r.bid, 2)}–${money(r.ask, 2)})`)) },
      { k: 'delta', label: 'Δ', fmt: (v) => num(v, 2) }, { k: 'iv', label: 'IV', fmt: (v) => `${(v * 100).toFixed(0)}%` },
      { k: 'theo_rv', label: 'Worth @ realised', fmt: (v) => money(v, 2) },
      { k: 'edge', label: cheap ? 'Cheap by' : 'Rich by', fmt: (v) => h('b', { class: cheap ? 'pos' : 'neg' }, `${Math.abs(v * 100).toFixed(0)}%`) },
      { k: 'oi', label: 'OI', fmt: (v) => int(v) }, { k: 'spread_pct', label: 'Spread', fmt: (v) => `${(v * 100).toFixed(0)}%` }];
    host.append(h('div', { class: 'grid g2' },
      card({ cls: 'white', title: 'Cheap — candidates to BUY', sub: 'Priced below what blended realised vol implies' }, b.cheap.length ? table(cols(true), b.cheap) : empty('Nothing is priced meaningfully cheap in this window.')),
      card({ cls: 'white', title: 'Rich — candidates to SELL', sub: 'Priced above what blended realised vol implies' }, b.rich.length ? table(cols(false), b.rich) : empty('Nothing is priced rich vs realised vol in this window.'))));
  }
  draw();

  // ---------------------------------------------------------------- method
  root.append(h('details', { class: 'card hi', style: { marginTop: '20px' } }, h('summary', null, 'How ideas are built and scored (and what can go wrong)'),
    h('div', { class: 'defs', style: { marginTop: '14px' } },
      h('div', null, h('b', null, 'Candidates'), 'For each horizon (weekly ≤ 2 weeks, 1–2 months, 6 months+) the engine picks strikes from the real chain by delta and width: long calls/puts, bull-call / bear-put debit spreads, bull-put / bear-call credit spreads, iron condors, cash-secured puts, and (for share owners) covered calls, protective puts and collars. Only contracts with a real two-sided quote and some open interest are used.'),
      h('div', null, h('b', null, 'Score 0–100'), 'Regime fit ≤ 20 (capped because the Signals tab shows that read has no proven edge) · volatility fit ≤ 25 (long-vol structures when IV < realised, short-vol when IV > realised) · model edge ≤ 30 · probability of profit ≤ 10 · levels ≤ 10 (short strikes beyond the ±1σ move; dealer-gamma regime) − liquidity penalty ≤ 20 − earnings penalty ≤ 8.'),
      h('div', null, h('b', null, 'Model edge'), 'Each package is valued assuming volatility ends up halfway between today’s implied vol and recent realised vol (zero price drift) and compared with its price. It rewards cheap options and penalises rich ones. It is a model assumption, not a fact — realised vol can fall, and implied vol is usually a bit higher than later realised vol.'),
      h('div', null, h('b', null, 'Probabilities'), 'Log-normal price distribution to expiry. “Market-implied” uses the expiry’s ATM IV; “realised” uses the recent realised vol. Real returns have fatter tails (gaps) than this model.'),
      h('div', null, h('b', null, 'What can go wrong'), 'Quotes are the last close and will move. Spreads cost money to cross (the “natural” price in each card). Short options can be assigned early; cash-secured puts mean owning the stock at the strike; covered calls cap your upside. Taxes, commissions and margin rules are not modelled. Options can lose 100% of what you pay. Earnings and bitcoin gaps are the biggest risks for MSTR.'))));
  root.append(h('div', { class: 'callout warn', style: { marginTop: '14px' } }, h('b', null, 'Not financial advice. '), 'These are screened ideas from a transparent model, not recommendations for your situation. Only trade size you can afford to lose entirely, prefer defined risk, and avoid holding short-dated long options through a binary event unless that is the explicit bet.'));
}

// ------------------------------------------------------------------------------------------------ one idea card
function ideaCard(i, open, spot) {
  const id = `idea-${i.name}-${i.expiry}-${i.variant}`.replace(/[^a-zA-Z0-9_-]/g, '_');
  const opt = i.legs.filter((l) => l.type !== 'STOCK');
  const el = h('div', { class: 'card white', id, style: { padding: '18px 20px' } });
  const action = h('div', { class: 'row', style: { gap: '8px', marginTop: '10px' } });
  i.legs.forEach((l) => {
    if (l.type === 'STOCK') { action.append(h('span', { class: 'badge acc', style: { fontSize: '12.5px', padding: '5px 11px' } }, 'You own 100 shares')); return; }
    action.append(h('span', { class: `badge ${l.side > 0 ? 'pos' : 'neg'}`, style: { fontSize: '12.5px', padding: '5px 11px' } }, `${l.side > 0 ? 'BUY' : 'SELL'} 1× ${exp(l.expiry)} $${l.strike} ${l.type === 'C' ? 'call' : 'put'} @ ${money(l.mid, 2)}`));
  });
  const net = i.cost_mid * 100; const nat = i.cost_nat * 100;
  const kv = (k, v, sub) => h('div', { class: 'perf' }, h('div', { class: 'k' }, k), h('div', { class: 'v', style: { fontSize: '17px' } }, v), sub ? h('div', { class: 'b' }, sub) : null);
  const metrics = h('div', { class: 'perf-grid', style: { marginTop: '12px', gridTemplateColumns: 'repeat(auto-fit, minmax(128px, 1fr))' } },
    kv(net > 0 ? 'YOU PAY' : 'YOU RECEIVE', money(Math.abs(net)), `natural ${money(Math.abs(nat))}`),
    kv('MAX PROFIT', i.max_profit == null ? 'Unlimited' : money(i.max_profit * 100), i.kind === 'collateral' ? 'premium kept' : ''),
    kv('MAX LOSS', i.kind === 'holder' ? `${money(i.max_loss * 100)}` : money(i.max_loss * 100), i.kind === 'collateral' ? 'if stock → $0' : i.kind === 'holder' ? 'incl. share drop' : 'defined'),
    kv('BREAKEVEN', i.breakevens.length ? i.breakevens.map((b) => usd(b, 2)).join(' / ') : '—', i.breakevens.length ? i.breakevens.map((b) => pct(b / spot - 1, 1)).join(' / ') + ' vs spot' : ''),
    kv('CHANCE OF PROFIT', `${Math.round(i.pop_imp * 100)}%`, `${Math.round(i.pop_rv * 100)}% at realised vol`),
    kv('MODEL EDGE', `${i.ev_fc >= 0 ? '+' : '−'}${money(Math.abs(i.ev_fc) * 100)}`, 'per contract, see why'),
    kv('GREEKS /DAY', `Δ ${i.net_delta >= 0 ? '+' : ''}${i.net_delta.toFixed(2)}`, `θ ${i.net_theta * 100 >= 0 ? '+' : '−'}$${Math.abs(i.net_theta * 100).toFixed(0)} · vega ${i.net_vega * 100 >= 0 ? '+' : '−'}$${Math.abs(i.net_vega * 100).toFixed(0)}`));
  el.append(h('div', { class: 'row between', style: { alignItems: 'flex-start' } },
    h('div', null, h('div', { style: { fontSize: '18px', fontWeight: 600, letterSpacing: '-0.01em' } }, i.name, h('span', { class: 'muted', style: { fontWeight: 400, fontSize: '14px' } }, ` · ${i.variant} · ${exp(i.expiry)} (${i.dte}d)`)), action),
    h('div', { style: { textAlign: 'right' } }, h('div', { class: 'xs muted' }, 'SCORE'), h('div', { style: { fontSize: '34px', fontWeight: 500, letterSpacing: '-0.03em', lineHeight: 1 } }, i.score))));
  el.append(metrics);
  const more = h('div', { style: { display: open ? 'block' : 'none', marginTop: '16px' } });
  const btn = h('button', { class: 'pill xs ghost', style: { marginTop: '12px' }, onclick: () => { const show = more.style.display === 'none'; more.style.display = show ? 'block' : 'none'; btn.textContent = show ? 'Hide details ▴' : 'Payoff, why & legs ▾'; if (show && !more.dataset.built) build(); } }, open ? 'Hide details ▴' : 'Payoff, why & legs ▾');
  el.append(btn, more);
  function build() {
    more.dataset.built = '1';
    const chartEl = h('div', { class: 'chart h300' });
    const left = h('div', null, h('div', { class: 'sub-title', style: { margin: '0 0 8px' } }, 'Profit / loss at expiry (per contract)'), chartEl);
    const right = h('div');
    right.append(h('div', { class: 'sub-title', style: { margin: '0 0 8px' } }, 'Why it ranks here'));
    right.append(h('div', { class: 'note-list' }, i.why.map((w) => h('div', { style: { display: 'list-item', listStyle: 'disc', marginLeft: '16px', fontSize: '13px' } }, w))));
    right.append(h('div', { class: 'small muted', style: { margin: '8px 0 4px' } }, `Score parts: regime ${i.comp.regime} · volatility ${i.comp.vol} · model edge ${i.comp.edge} · probability ${i.comp.prob} · levels ${i.comp.levels} · liquidity ${i.comp.liquidity} · event ${i.comp.event}`));
    if (i.flags.length) right.append(h('div', { class: 'callout warn', style: { marginTop: '10px', fontSize: '12.5px' } }, i.flags.map((f2) => h('div', null, '• ', f2))));
    more.append(h('div', { class: 'grid g2', style: { alignItems: 'start' } }, left, right));
    more.append(table([
      { k: 'side', label: 'Action', fmt: (v, l) => badge(l.type === 'STOCK' ? 'OWN' : v > 0 ? 'BUY' : 'SELL', l.type === 'STOCK' ? 'acc' : v > 0 ? 'pos' : 'neg') },
      { k: 'type', label: 'Contract', align: 'l', fmt: (v, l) => (v === 'STOCK' ? '100 shares' : `${exp(l.expiry)} $${l.strike} ${v === 'C' ? 'call' : 'put'}`) },
      { k: 'bid', label: 'Bid', fmt: (v, l) => (l.type === 'STOCK' ? '—' : money(v, 2)) }, { k: 'ask', label: 'Ask', fmt: (v, l) => (l.type === 'STOCK' ? '—' : money(v, 2)) }, { k: 'mid', label: 'Mid', fmt: (v, l) => (l.type === 'STOCK' ? money(v, 2) : money(v, 2)) },
      { k: 'iv', label: 'IV', fmt: (v) => (v ? `${(v * 100).toFixed(0)}%` : '—') }, { k: 'delta', label: 'Δ', fmt: (v, l) => (l.type === 'STOCK' ? '1.00' : num(v, 2)) },
      { k: 'oi', label: 'Open int.', fmt: (v, l) => (l.type === 'STOCK' ? '—' : int(v)) }, { k: 'spread_pct', label: 'Spread', fmt: (v, l) => (l.type === 'STOCK' ? '—' : `${(v * 100).toFixed(0)}%`) },
    ], i.legs));
    // scenario table
    const S0 = spot;
    const shifts = [-0.3, -0.2, -0.1, -0.05, 0, 0.05, 0.1, 0.2, 0.3, 0.5];
    const rowsS = [{ k: 'If price ends at', v: shifts.map((s) => S0 * (1 + s)) }, { k: 'P&L', v: shifts.map((s) => pnl(i, S0 * (1 + s), S0)) }];
    const t = h('table', { class: 'tbl', style: { marginTop: '14px' } });
    t.append(h('thead', null, h('tr', null, h('th', null, 'Price at expiry'), shifts.map((s) => h('th', { style: { textAlign: 'center' } }, `${s > 0 ? '+' : ''}${Math.round(s * 100)}%`)))));
    t.append(h('tbody', null, h('tr', null, h('td', null, h('b', null, 'Stock')), rowsS[0].v.map((x) => h('td', { style: { textAlign: 'center' } }, usd(x, 0)))),
      h('tr', null, h('td', null, h('b', null, 'P&L per contract')), rowsS[1].v.map((x) => h('td', { class: signCls(x), style: { textAlign: 'center', fontWeight: 600 } }, `${x >= 0 ? '+' : '−'}${money(Math.abs(x))}`)))));
    more.append(h('div', { class: 'tbl-wrap' }, t));
    drawPayoff(chartEl, i, S0);
  }
  if (open) setTimeout(build, 0);
  return el;
}

function pnl(i, S, S0) {
  let t = 0;
  for (const l of i.legs) {
    if (l.type === 'STOCK') t += l.side * (S - S0);
    else t += l.side * (l.type === 'C' ? Math.max(S - l.strike, 0) : Math.max(l.strike - S, 0));
  }
  return (t - i.cost_mid) * 100;      // option cost and stock P&L are per share; one contract = 100 shares
}

function drawPayoff(el, i, S0) {
  const ks = i.legs.filter((l) => l.type !== 'STOCK').map((l) => l.strike);
  const lo = Math.max(0.01, Math.min(S0 * 0.6, ...ks.map((k) => k * 0.85))); const hi = Math.max(S0 * 1.45, ...ks.map((k) => k * 1.15));
  const xs = []; for (let n = 0; n <= 160; n++) xs.push(lo + ((hi - lo) * n) / 160);
  ks.forEach((k) => xs.push(k)); xs.sort((a, b) => a - b);
  const data = xs.map((x) => ({ x, y: pnl(i, x, S0) }));
  const sm = i.sigma_move;
  const lines = [{ v: S0, c: C.ink, t: `Spot ${S0.toFixed(1)}` }, ...i.breakevens.map((b) => ({ v: b, c: C.accentDeep, t: `BE ${b.toFixed(1)}`, dash: [2, 3] }))];
  cjs(el, { type: 'line', data: { datasets: [{ data, parsing: false, borderWidth: 3, pointRadius: 0, tension: 0, fill: { target: 'origin', above: 'rgba(30,154,104,.16)', below: 'rgba(212,69,61,.16)' },
    segment: { borderColor: (c) => ((c.p0.parsed.y + c.p1.parsed.y) / 2 >= 0 ? C.pos : C.neg) } }] },
  plugins: [{ id: 'vl', afterDatasetsDraw(ch) { const x = ch.scales.x; const { ctx: c, chartArea: a } = ch; lines.forEach((l, n) => { const px = x.getPixelForValue(l.v); if (px < a.left || px > a.right) return; c.save(); c.setLineDash(l.dash || [5, 4]); c.strokeStyle = l.c; c.lineWidth = 1.5; c.beginPath(); c.moveTo(px, a.top); c.lineTo(px, a.bottom); c.stroke(); c.setLineDash([]); c.fillStyle = l.c; c.font = '600 10.5px Inter Tight, sans-serif'; c.textAlign = 'center'; c.fillText(l.t, Math.min(Math.max(px, a.left + 26), a.right - 26), a.top - 4 - (n % 2) * 11); c.restore(); }); } }],
  options: { layout: { padding: { top: 24 } }, plugins: { legend: { display: false }, tooltip: tip({ callbacks: { title: (it) => `Stock at ${usd(it[0].parsed.x, 2)} (${pct(it[0].parsed.x / S0 - 1, 0)})`, label: (c) => `P&L ${c.parsed.y >= 0 ? '+' : '−'}${money(Math.abs(c.parsed.y))}` } }) },
    scales: { x: { type: 'linear', min: xs[0], max: xs[xs.length - 1], grid: { display: false }, border: { display: false }, ticks: { callback: (v) => usd(v, 0), maxTicksLimit: 8 } },
      y: axis({ ticks: { callback: (v) => `${v < 0 ? '−' : ''}$${Math.abs(v).toLocaleString('en-US')}` } }) } } });
}
