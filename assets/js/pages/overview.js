// Overview: hero, snapshot tiles, jump bar and the five sections.
import { api, num, pct, pctP, usd, usdc, compact, date, dateShort, daysUntil, signCls, isNum } from '../util.js';
import { h, icon, tile, tag, badge, meter, logoBadge, delta, card, skeleton, errorBox, verdictBadge, $ } from '../ui.js';

export async function render(root, ctx) {
  const ov = await api('overview', { symbol: ctx.symbol });
  const layout = h('div', { class: 'layout' });
  const left = h('div', { class: 'stack' });
  left.append(hero(ov, ctx), tiles(ov, ctx));
  layout.append(left, rightRail(ov, ctx));
  root.append(layout);

  const sections = [
    ['price', 'Price & momentum', 'trend'],
    ['btc', 'Bitcoin & treasury', 'coins'],
    ['vol', 'Volatility & options', 'bolt'],
    ['season', 'Seasonality', 'wave'],
    ['insiders', 'Insiders & filings', 'users'],
  ];
  const jump = h('div', { class: 'jump' }, sections.map(([id, label, ic]) => h('a', { class: 'pill sm', href: `#${id}`, onclick: (e) => { e.preventDefault(); document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); } }, icon(ic, 14), label)));
  root.append(h('div', { style: { height: '22px' } }), jump);

  const loaders = {
    price: () => import('../sections/price.js').then((m) => m.render),
    btc: () => import('../sections/btc.js').then((m) => m.render),
    vol: () => import('../sections/volopts.js').then((m) => m.render),
    season: () => import('../sections/season.js').then((m) => m.render),
    insiders: () => import('../sections/insiders.js').then((m) => m.render),
  };
  const blurbs = {
    price: 'Candles with RSI swings, moving averages and Strategy’s BTC buys/sells; RSI structure by timeframe.',
    btc: `${ctx.symbol} against Bitcoin: beta, correlation, ratio and (for Strategy) the treasury.`,
    vol: 'VIX and DVOL, implied vs realised vol, skew, the option chain and the watched $400 call.',
    season: 'Monthly, weekday and year-by-year behaviour — MSTR next to Bitcoin.',
    insiders: 'Form 4 buys and sells, who is most active, and the SEC filings feed.',
  };
  for (let i = 0; i < sections.length; i++) {
    const [id, label] = sections[i];
    const box = h('section', { id });
    box.append(h('div', { class: 'section-title' }, h('span', { class: 'num' }, `0${i + 1}`), h('h2', null, label), h('p', null, blurbs[id])));
    const body = h('div', { class: 'stack' }, skeleton(200));
    box.append(body);
    root.append(box);
    // load sequentially so the page stays responsive and ordering of chart creation is deterministic
    try {
      const fn = await loaders[id]();
      if (!ctx.token()) return;
      body.replaceChildren();
      await fn(body, ctx, ov);
    } catch (e) {
      console.error(id, e);
      body.replaceChildren(errorBox(e));
    }
  }
  root.append(h('p', { class: 'disclaimer' }, 'Data: Yahoo Finance (prices, options), SEC EDGAR (filings, Form 4, bitcoin 8-Ks), Deribit (DVOL). Calculations are done locally and stored in MariaDB. ',
    'Educational research tool — nothing here is investment advice or a prediction.'));
}

// ---------------------------------------------------------------- hero
function hero(ov, ctx) {
  const s = ov.snapshot;
  const e = ov.earnings;
  const el = h('div', { class: 'hero' });
  const left = h('div');
  left.append(h('div', { class: 'company' }, logoBadge(ctx.symbol), h('div', null, h('div', { class: 'tk' }, ctx.symbol), h('div', { class: 'nm' }, ov.name + (ov.exchange ? ` · ${ov.exchange}` : '')))));
  left.append(h('div', { class: 'price-line' }, h('div', { class: 'price' }, usd(s.close)), delta(s.chg_pct), h('span', { class: `small ${signCls(s.chg)}` }, `${s.chg >= 0 ? '+' : '−'}${usd(Math.abs(s.chg))} today`)));
  const chips = h('div', { class: 'meta-line' });
  chips.append(h('div', { class: 'meta-chip' }, 'Close ', h('b', null, date(s.last_date))));
  if (ov.profile?.next_earnings) {
    const d = daysUntil(ov.profile.next_earnings);
    const when = ov.profile.earnings_timing === 'amc' ? 'after close' : ov.profile.earnings_timing === 'bmo' ? 'before open' : e?.timing === 'amc' ? 'after close' : e?.timing === 'bmo' ? 'before open' : '';
    chips.append(h('div', { class: 'meta-chip accent' }, icon('calendar', 14), 'Next earnings ', h('b', null, dateShort(ov.profile.next_earnings)), when ? ` · ${when}` : '', isNum(d) ? ` · in ${d}d` : '',
      +ov.profile.earnings_is_est ? ' (est.)' : ''));
    if (e && isNum(e.typical_abs)) chips.append(h('div', { class: 'meta-chip' }, 'Typical move ', h('b', null, `±${e.typical_abs.toFixed(1)}%`), h('span', { class: 'muted' }, ` avg of last ${Math.min(8, e.n)}`),
      e.implied ? [' · options 1σ to ', dateShort(e.implied.expiry), ' ', h('b', null, `±${e.implied.move_pct.toFixed(1)}%`)] : null));
  }
  chips.append(h('div', { class: 'meta-chip' }, 'From ATH ', h('b', { class: signCls(s.from_ath) }, pct(s.from_ath, 1)), h('span', { class: 'muted' }, ` (${usd(s.ath, 0)} · ${dateShort(s.ath_date)})`)));
  chips.append(h('div', { class: 'meta-chip' }, '52w ', h('b', null, `${usd(s.lo52, 2)} – ${usd(s.hi52, 2)}`)));
  left.append(chips);

  const labels = [['7D', '7D'], ['30D', '30D'], ['90D', '90D'], ['180D', '180D'], ['1Y', '1Y'], ['YTD', 'YTD'], ['SINCE', "Since Aug ’20"]];
  const grid = h('div', { class: 'perf-grid' });
  labels.forEach(([k, lbl]) => {
    const p = s.perf?.[k];
    const label = k === 'SINCE' && p?.listing ? 'Since listing' : lbl;
    grid.append(h('div', { class: 'perf' },
      h('div', { class: 'k' }, label.toUpperCase()),
      h('div', { class: `v ${p ? signCls(p.ret) : 'muted'}` }, p ? pct(p.ret, Math.abs(p.ret) >= 1 ? 0 : 1) : '—'),
      h('div', { class: 'b' }, h('i', null, '₿'), p && isNum(p.btc) ? pct(p.btc, Math.abs(p.btc) >= 1 ? 0 : 1) : '—')));
  });
  const b = s.btc;
  grid.append(h('div', { class: 'perf', style: { background: 'var(--ink)', color: '#fff' } },
    h('div', { class: 'k', style: { color: '#aaa' } }, 'BITCOIN'), h('div', { class: 'v' }, usd(b.close, 0)),
    h('div', { class: 'b', style: { color: '#aaa' } }, `as of ${dateShort(b.date)}`)));
  el.append(left, grid);
  return el;
}

// ---------------------------------------------------------------- tiles
function zoneBar(d, w) {
  const bar = h('div', { class: 'zone-bar' });
  if (isNum(d)) bar.append(h('div', { class: 'mk', style: { left: `${Math.min(100, Math.max(0, d))}%` }, title: `Daily ${d.toFixed(1)}` }));
  if (isNum(w)) bar.append(h('div', { class: 'mk w', style: { left: `${Math.min(100, Math.max(0, w))}%` }, title: `Weekly ${w.toFixed(1)}` }));
  return h('div', null, bar, h('div', { class: 'zone-labels' }, h('span', null, '0'), h('span', null, '30'), h('span', null, '50'), h('span', null, '70'), h('span', null, '100')));
}
function trendRows(s) {
  const rows = h('div', { class: 'mini-list' });
  [['D', 'Daily'], ['W', 'Weekly'], ['M', 'Monthly']].forEach(([k, lbl]) => {
    const t = s.trend?.[k];
    if (!t) return;
    const up = t.swing === 'Up'; const dn = t.swing === 'Down';
    rows.append(h('div', { class: 'r' }, h('span', null, lbl),
      h('span', null, badge(`${t.swing} swing`, up ? 'pos' : dn ? 'neg' : ''), ' ', badge(`${t.line50.startsWith('Above') ? '▲' : '▼'} 50 · ${t.bars}`, t.line50.startsWith('Above') ? 'pos' : 'neg'))));
  });
  return rows;
}
function tiles(ov, ctx) {
  const s = ov.snapshot;
  const grid = h('div', { class: 'grid g4' });
  const rd = s.rsi?.D; const rw = s.rsi?.W;
  const card1 = ov.rsi_trend?.W?.cardwell?.range;
  grid.append(tile({ icon: 'gauge', label: 'RSI · daily & weekly', body: h('div', null,
    h('div', { class: 'two-num' }, h('div', null, h('div', { class: 'l' }, 'DAILY'), h('div', { class: 'n' }, num(rd, 1))), h('div', null, h('div', { class: 'l' }, 'WEEKLY'), h('div', { class: 'n' }, num(rw, 1)))),
    zoneBar(rd, rw)), note: card1 ? `Weekly: ${card1}` : '' }));
  grid.append(tile({ icon: 'trend', label: 'Trend · swing & 50-line', body: trendRows(s), note: 'Swing = RSI higher-highs / higher-lows. 50-line = RSI side + bars since cross.' }));
  const ma = s.ma;
  const dots = h('div', { class: 'ma-dots' }, ma.detail.map((m) => h('span', { class: m.above ? 'on' : 'off' }, h('i'), m.k.replace('SMA ', ''))));
  grid.append(tile({ icon: 'bars', label: 'Above moving averages', big: `${ma.above}/${ma.of}`, unit: 'SMAs', body: dots, note: `vs 200-day: ${pct(s.vs_200d, 1)}` }));
  const ivrv = isNum(s.iv30) && isNum(s.rv20) ? s.iv30 / s.rv20 : null;
  grid.append(tile({ icon: 'bolt', label: 'IV30 / RV20', big: isNum(s.iv30) ? `${(s.iv30 * 100).toFixed(1)}%` : '—', unit: `/ ${isNum(s.rv20) ? (s.rv20 * 100).toFixed(1) + '%' : '—'}`,
    tag: isNum(ivrv) ? tag(`${ivrv.toFixed(2)}×`, ivrv < 0.9 ? 'neg' : ivrv > 1.1 ? 'pos' : '') : null,
    meter: isNum(ivrv) ? meter(Math.min(10, (ivrv / 2) * 10), 10, { sm: true }) : null,
    note: isNum(ivrv) ? (ivrv < 1 ? 'Options price less vol than the stock is realising' : 'Options price more vol than realised') + ` · snapshot ${dateShort(s.iv30_date)}` : 'No options snapshot yet' }));
  // slot 5: mNAV for MSTR (accent card), beta for everyone else
  if (ctx.symbol === 'MSTR' && ov.treasury && isNum(ov.treasury.mnav_ev)) {
    grid.append(tile({ cls: 'accent', icon: 'coins', label: 'mNAV · EV / BTC NAV', big: `${ov.treasury.mnav_ev.toFixed(2)}×`,
      tag: tag(`${ov.treasury.mnav_mcap.toFixed(2)}× mkt cap`), meter: meter(Math.min(10, (ov.treasury.mnav_ev / 2.5) * 10), 10),
      note: `${compact(ov.treasury.btc, 0)} BTC @ ${usd(ov.treasury.avg_cost, 0)} avg · as of ${dateShort(ov.treasury.as_of)}` }));
  } else {
    const b1 = s.beta?.['1Y'];
    grid.append(tile({ cls: 'accent', icon: 'coins', label: 'Beta to Bitcoin · 1Y', big: b1 ? b1.beta.toFixed(2) : '—', tag: b1 ? tag(`corr ${b1.corr.toFixed(2)}`) : null,
      meter: b1 ? meter(Math.min(10, (b1.beta / 3) * 10), 10) : null, note: 'Daily-return regression slope vs BTC-USD' }));
  }
  const b = s.btc;
  grid.append(tile({ icon: 'dollar', label: 'Bitcoin · RSI & 200-day', body: h('div', null,
    h('div', { class: 'two-num' }, h('div', null, h('div', { class: 'l' }, 'DAILY'), h('div', { class: 'n' }, num(b.rsi_d, 1))), h('div', null, h('div', { class: 'l' }, 'WEEKLY'), h('div', { class: 'n' }, num(b.rsi_w, 1))))),
    note: `${pct(b.dist_200d, 1)} vs its 200-day average (${usd(b.sma200, 0)})`, tag: tag(pct(b.dist_200d, 1), b.dist_200d >= 0 ? 'pos' : 'neg') }));
  if (ctx.symbol !== 'BTC-USD') {
    const pc = s.ratio_pctile;
    grid.append(tile({ icon: 'target', label: `${ctx.symbol} / BTC ratio percentile`, big: isNum(pc) ? `${Math.round(pc)}` : '—', unit: 'th percentile', meter: isNum(pc) ? meter(pc / 10, 10) : null,
      note: ov.beta ? `Ratio ×1000 now ${ov.beta.ratio_now.toFixed(2)} vs median ${ov.beta.ratio_median.toFixed(2)} (since Aug ’20)` : '' }));
  }
  // dark promo -> Signals
  const sig = ov.signal;
  const promo = h('div', { class: 'tile dark', style: { background: 'radial-gradient(120% 120% at 100% 0%, #5a3408 0%, #141414 55%)', justifyContent: 'space-between' } });
  promo.append(h('div', { class: 'head' }, h('div', { class: 'ico' }, icon('target', 18)), h('div', { class: 'lbl' }, 'RSI & pivots signal')));
  if (sig) {
    promo.append(h('div', null, h('div', { class: `verdict ${'v-' + sig.verdict}`, style: { fontSize: '34px', color: '#fff' } }, h('span', { class: 'vdot' }), sig.verdict),
      h('div', { class: 'note', style: { marginTop: '8px' } }, `Score ${sig.score > 0 ? '+' : ''}${sig.score} · since ${dateShort(sig.since)}. A regime read with its track record — not a forecast.`)));
  } else promo.append(h('div', { class: 'note' }, 'Not enough history for a signal on this ticker.'));
  promo.append(h('a', { class: 'pill accent', href: `#/${ctx.symbol}/signals`, style: { alignSelf: 'flex-start', marginTop: '10px' } }, 'Open signals ', icon('arrow', 15)));
  grid.append(promo);
  return grid;
}

function rightRail(ov, ctx) {
  const rail = h('div', { class: 'rightrail' });
  const mini = (ic, t, href) => h('a', { class: 'link-card mini', href }, h('div', { class: 'ico' }, icon(ic, 18)), h('div', { class: 't' }, t));
  rail.append(h('div', { class: 'rail-pair' }, mini('calendar', 'Earnings', `#/${ctx.symbol}/earnings`), mini('wave', 'Seasonality', `#/${ctx.symbol}/seasonality`)));
  const li = (ic, t, d, href, onclick) => {
    const a = h('a', { class: 'link-card', href }, h('div', { class: 'ico' }, icon(ic, 18)), h('div', { class: 't' }, t), h('div', { class: 'd' }, d), h('span', { class: 'go' }, icon('arrow', 16)));
    if (onclick) a.addEventListener('click', (e) => { e.preventDefault(); onclick(); });
    return a;
  };
  const jumpTo = (id) => () => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });
  rail.append(li('layers', 'Chain & GEX', 'Strike-by-strike OI, gamma flip, walls and the full chain', `#/${ctx.symbol}/chain`));
  rail.append(li('target', 'Signals', 'Historical tops & lows, RSI zones and a Buy / Hold / Sell regime read', `#/${ctx.symbol}/signals`));
  rail.append(li('coins', 'Treasury', 'Holdings, cost basis and mNAV with sources', '#btc', jumpTo('btc')));
  rail.append(li('file', 'SEC filings', 'Latest 8-Ks, 10-Qs and Form 4s with a type filter', '#insiders', jumpTo('insiders')));
  return rail;
}
