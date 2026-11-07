// Section 1 — Price & momentum.
import { api, num, pct, pctP, usd, date, dateShort, signCls, isNum, int, IS_STATIC } from '../util.js';
import { h, card, segmented, toggle, table, badge, icon, empty, toast, $ } from '../ui.js';
import { lwChart, syncRanges, lineOpts, C, zigzagAbs, lastIdxLE } from '../charts.js';

const TFS = ['4H', 'D', 'W', 'M', 'Q'];
const VIEW = { '4H': 220, D: 300, W: 170, M: 84, Q: 60 };
const SWING = { '4H': 9, D: 10, W: 10, M: 10, Q: 10 };
const MA_DEF = [['sma20', 'SMA 20', C.ma.sma20], ['sma50', 'SMA 50', C.ma.sma50], ['sma100', 'SMA 100', C.ma.sma100], ['sma200', 'SMA 200', C.ma.sma200], ['ema21', 'EMA 21', C.ma.ema21]];
const COL = { t: 0, o: 1, h: 2, l: 3, c: 4, v: 5, rsi: 6, sma20: 7, sma50: 8, sma100: 9, sma200: 10, ema21: 11 };

const tStr = (t) => (typeof t === 'object' && t ? `${t.year}-${String(t.month).padStart(2, '0')}-${String(t.day).padStart(2, '0')}` : t);
const dayNum = (s) => { const [y, m, d] = String(s).slice(0, 10).split('-').map(Number); return Date.UTC(y, m - 1, d) / 86400000; };

export async function render(root, ctx, ov) {
  const sym = ctx.symbol;
  const st = { tf: 'D', mas: { sma20: false, sma50: true, sma100: false, sma200: true, ema21: false }, swings: true, markers: sym === 'MSTR', log: false, lines: true, adding: null };
  const treasury = sym === 'MSTR' ? await api('analytics', { symbol: 'MSTR', k: 'treasury' }).catch(() => null) : null;
  const barsCache = {};
  const loadBars = async (tf) => (barsCache[tf] ||= (await api('bars', { symbol: sym, tf })).rows);
  let lines = [];
  const loadLines = async () => { lines = (await api('rsi_lines', { symbol: sym }, { ttl: 0 })).rows; };
  await loadLines();

  // ---------------------------------------------------------------- chart card
  const pxEl = h('div', { class: 'chart h420' });
  const rsiEl = h('div', { class: 'chart', style: { height: '190px', marginTop: '4px' } });
  const info = h('div', { class: 'chart-legend', style: { top: '6px', left: '10px', maxWidth: 'calc(100% - 20px)' } });
  pxEl.append(info);
  const hint = h('div', { class: 'small muted', style: { marginTop: '6px', minHeight: '18px' } });
  const tfSeg = segmented(TFS.map((t) => ({ value: t, label: t })), st.tf, (v) => { st.tf = v; draw(); });
  const maToggles = MA_DEF.map(([k, lbl, col]) => toggle(lbl, st.mas[k], (on) => { st.mas[k] = on; draw(); }, col));
  const tSwing = toggle('RSI swings', st.swings, (on) => { st.swings = on; draw(); });
  const tMark = sym === 'MSTR' ? toggle('BTC buys / sells', st.markers, (on) => { st.markers = on; draw(); }) : null;
  const tLines = toggle('My RSI lines', st.lines, (on) => { st.lines = on; draw(); });
  const tLog = toggle('Log scale', st.log, (on) => { st.log = on; draw(); });
  const addBtn = IS_STATIC ? null : h('button', { class: 'pill xs accent', onclick: () => startAdd() }, icon('plus', 12), 'Draw RSI line');
  const chartCard = card({ id: 'pxcard', cls: 'white', icon: 'trend', title: 'Price & RSI', sub: `${sym} · RSI(14) Wilder · ${sym === 'BTC-USD' ? 'UTC' : 'US exchange time'}`, actions: [tfSeg] },
    h('div', { class: 'row', style: { marginBottom: '10px', gap: '6px' } }, maToggles, tSwing, tMark, tLines, tLog, addBtn), pxEl, rsiEl, hint);
  root.append(chartCard);

  let charts = [];
  let candles; let rsiSeries; let rows; let rsiByTime = {}; let rowByTime = {};
  async function draw() {
    charts.forEach((c) => c.dispose && c.dispose()); charts = [];
    rows = await loadBars(st.tf);
    if (!rows.length) { pxEl.append(empty('No bars stored for this timeframe yet.')); return; }
    const is4h = st.tf === '4H';
    const tz = sym === 'BTC-USD' ? 'UTC' : 'America/New_York';
    const fmtTime = (ts) => new Date(ts * 1000).toLocaleString('en-US', { timeZone: tz, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: false });
    const opts = { log: st.log, timeVisible: is4h, localization: is4h ? { timeFormatter: fmtTime } : {},
      tickFmt: is4h ? (ts) => new Date(ts * 1000).toLocaleString('en-US', { timeZone: tz, month: 'short', day: 'numeric' }) : undefined };
    const px = lwChart(pxEl, opts);
    const rs = lwChart(rsiEl, { ...opts, log: false, margins: { top: 0.06, bottom: 0.06 } });
    charts = [px, rs];
    // keep the legend overlay (lwChart appends a canvas wrapper; legend sits above)
    candles = px.addCandlestickSeries({ upColor: C.pos, downColor: C.neg, borderVisible: false, wickUpColor: C.pos, wickDownColor: C.neg, priceLineVisible: true, lastValueVisible: true });
    candles.setData(rows.map((r) => ({ time: r[0], open: r[1], high: r[2], low: r[3], close: r[4] })));
    MA_DEF.forEach(([k, lbl, col]) => {
      if (!st.mas[k]) return;
      const s = px.addLineSeries(lineOpts(col, 1.6));
      s.setData(rows.filter((r) => r[COL[k]] != null).map((r) => ({ time: r[0], value: r[COL[k]] })));
    });
    // markers on price: BTC purchases / sales (Strategy 8-Ks)
    const times = rows.map((r) => r[0]);
    const mk = [];
    if (st.markers && treasury?.markers) {
      treasury.markers.forEach((m) => {
        const key = is4h ? Date.UTC(...m.d.split('-').map((x, i) => (i === 1 ? +x - 1 : +x)), 20, 0) / 1000 : m.d;
        const i = lastIdxLE(times, key);
        if (i < 0 || (!is4h && String(times[i]) < String(m.d).slice(0, 4) + '-01-01' && false)) return;
        mk.push({ time: times[i], position: m.btc > 0 ? 'belowBar' : 'aboveBar', color: m.btc > 0 ? C.accent : C.neg, shape: m.btc > 0 ? 'arrowUp' : 'arrowDown', size: m.btc > 0 ? 0.9 : 1.4 });
      });
    }
    mk.sort((a, b) => (a.time > b.time ? 1 : a.time < b.time ? -1 : 0));
    // keep a single marker per bar (largest wins visually)
    const seen = new Set(); candles.setMarkers(mk.filter((m) => (seen.has(m.time) ? false : seen.add(m.time))));
    // RSI
    rsiSeries = rs.addLineSeries({ ...lineOpts(C.ink, 2), autoscaleInfoProvider: () => ({ priceRange: { minValue: 0, maxValue: 100 } }) });
    const rsiData = rows.filter((r) => r[COL.rsi] != null).map((r) => ({ time: r[0], value: r[COL.rsi] }));
    rsiSeries.setData(rsiData);
    [[30, '#9aa097', 2], [50, '#c3c8c0', 0], [70, '#9aa097', 2]].forEach(([v, col, ls]) => rsiSeries.createPriceLine({ price: v, color: col, lineWidth: 1, lineStyle: ls, axisLabelVisible: true, title: '' }));
    if (st.swings) {
      const piv = zigzagAbs(rows.map((r) => r[COL.rsi]), SWING[st.tf]);
      rsiSeries.setMarkers(piv.map(([i, v, k]) => ({ time: rows[i][0], position: k === 'H' ? 'aboveBar' : 'belowBar', color: k === 'H' ? C.accentDeep : C.ink, shape: 'circle', size: 0.7, text: v.toFixed(0) })));
    }
    // saved RSI lines
    if (st.lines && st.tf !== '4H') {
      const lastT = rows[rows.length - 1][0];
      lines.filter((l) => l.tf === st.tf).forEach((l) => {
        const slope = (l.v2 - l.v1) / Math.max(1, dayNum(l.t2) - dayNum(l.t1));
        const endV = l.v2 + slope * (dayNum(lastT) - dayNum(l.t2));
        const s = rs.addLineSeries({ ...lineOpts(C.accent, 2, { lineStyle: 0 }), lastValueVisible: false });
        const pts = [{ time: l.t1.slice(0, 10), value: +l.v1 }, { time: l.t2.slice(0, 10), value: +l.v2 }];
        if (dayNum(lastT) > dayNum(l.t2)) pts.push({ time: lastT, value: +endV.toFixed(2) });
        s.setData(pts.filter((p, i, a) => i === 0 || p.time > a[i - 1].time));
      });
    }
    // view window + sync
    const n = rows.length;
    const range = { from: Math.max(0, n - VIEW[st.tf]), to: n + 3 };
    px.timeScale().setVisibleLogicalRange(range); rs.timeScale().setVisibleLogicalRange(range);
    syncRanges(px, rs);
    // legend / crosshair read-out
    rowByTime = {}; rows.forEach((r) => { rowByTime[r[0]] = r; });
    const show = (r) => {
      info.replaceChildren();
      if (!r) return;
      const chg = r[4] / r[1] - 1;
      const bit = (txt, col) => h('span', { style: col ? { color: col } : null }, txt);
      info.append(bit(is4h ? fmtTime(r[0]) : date(r[0])), bit(`O ${num(r[1])}`), bit(`H ${num(r[2])}`), bit(`L ${num(r[3])}`), bit(`C ${num(r[4])}`),
        bit(pct(chg, 1), chg >= 0 ? C.pos : C.neg), bit(`RSI ${num(r[6], 1)}`));
      MA_DEF.forEach(([k, lbl, col]) => { if (st.mas[k] && r[COL[k]] != null) info.append(h('span', null, h('i', { style: { background: col } }), `${lbl} ${num(r[COL[k]])}`)); });
    };
    show(rows[rows.length - 1]);
    px.subscribeCrosshairMove((p) => { show(p.time ? rowByTime[tStr(p.time)] || rowByTime[p.time] : rows[rows.length - 1]); });
    rs.subscribeCrosshairMove((p) => { if (p.time) show(rowByTime[tStr(p.time)] || rowByTime[p.time]); });
    rs.subscribeClick((p) => onRsiClick(p));
  }

  // ---- click-to-draw RSI trendline
  function startAdd() {
    if (st.tf === '4H') { toast('Switch to D / W / M / Q to draw RSI lines'); return; }
    st.adding = { pts: [] };
    hint.textContent = 'Click the first point on the RSI chart (e.g. an RSI low) …';
    hint.style.color = 'var(--accent-deep)';
  }
  async function onRsiClick(p) {
    if (!st.adding || !p.time || !p.point) return;
    const v = rsiSeries.coordinateToPrice(p.point.y);
    if (v == null) return;
    st.adding.pts.push({ t: tStr(p.time), v: Math.round(v * 10) / 10 });
    if (st.adding.pts.length === 1) { hint.textContent = 'Now click the second point …'; return; }
    const [a, b] = st.adding.pts;
    st.adding = null; hint.textContent = ''; hint.style.color = '';
    const label = window.prompt('Name this RSI line (optional):', `RSI line ${a.t.slice(0, 7)}→${b.t.slice(0, 7)}`) || '';
    await api('rsi_lines', { symbol: sym }, { method: 'POST', body: { tf: st.tf, label, t1: a.t, v1: a.v, t2: b.t, v2: b.v } });
    await loadLines(); draw(); renderLines(); toast('RSI line saved');
  }

  await draw();

  // ---------------------------------------------------------------- RSI trend + since-low
  const rt = ov.rsi_trend || {};
  const trendCard = card({ icon: 'gauge', title: 'RSI trend by timeframe', sub: 'Swing · 50-line · Cardwell range & reversals' });
  const trows = ['4H', 'D', 'W', 'M'].filter((t) => rt[t]).map((t) => ({ tf: t, ...rt[t] }));
  trendCard.append(table([
    { k: 'tf', label: 'TF', fmt: (v) => h('b', null, v) },
    { k: 'rsi', label: 'RSI', fmt: (v, r) => h('span', null, h('b', null, num(v, 1)), ' ', h('span', { class: `small ${signCls(v - r.prev)}` }, isNum(r.prev) ? `${v - r.prev >= 0 ? '+' : ''}${(v - r.prev).toFixed(1)}` : '')) },
    { k: 'swing', label: 'Swing', fmt: (v) => badge(`${v} swing`, v === 'Up' ? 'pos' : v === 'Down' ? 'neg' : '') },
    { k: (r) => r.line50, label: '50-line', fmt: (v) => badge(`${v.state} · ${v.bars} bars`, v.state.startsWith('Above') ? 'pos' : 'neg') },
    { k: (r) => r.cardwell, label: 'Cardwell range', align: 'l', fmt: (v) => h('span', null, v.range, h('span', { class: 'muted' }, v.lo != null ? ` · ${v.lo}–${v.hi}` : '')) },
    { k: 'flags', label: 'Reversals / divergences', align: 'l', fmt: (v) => (v.length ? h('span', null, v.map((f) => h('span', { title: `${f.def} (${dateShort(f.d1)} → ${dateShort(f.d2)}; price ${f.px.join(' → ')}, RSI ${f.rsi.join(' → ')})`, style: { marginRight: '6px', display: 'inline-block' } }, badge(f.type, f.bias === 'bull' ? 'pos' : 'neg')))) : h('span', { class: 'muted' }, '—')) },
  ], trows));
  trendCard.append(h('details', { class: 'card hi', style: { marginTop: '14px', padding: '14px 18px' } }, h('summary', null, 'Definitions used (as implemented)'),
    h('div', { class: 'defs', style: { marginTop: '12px' } },
      h('div', null, h('b', null, 'Swing'), 'RSI zig-zag: a swing high/low counts after RSI reverses ≥ 9–10 points. Up = higher highs and higher lows; Down = lower highs and lower lows; Widening / Narrowing = mixed.'),
      h('div', null, h('b', null, '50-line'), 'Which side of RSI 50 the indicator sits on and for how many bars. Above 50 is the bullish side, below 50 the bearish side.'),
      h('div', null, h('b', null, 'Cardwell ranges'), 'Bull market: RSI oscillates ~40–80 and pullbacks hold 40–50. Bear market: ~20–60 and rallies stall at 50–60. Classified from the min / max over the last 126 D · 52 W · 24 M · 120 4H bars.'),
      h('div', null, h('b', null, 'Divergence'), 'Bullish: price makes a lower low while RSI makes a higher low. Bearish: price higher high while RSI lower high.'),
      h('div', null, h('b', null, 'Cardwell reversals'), 'Positive reversal: price lower high while RSI makes a higher high (bullish). Negative reversal: price higher low while RSI makes a lower low (bearish). Flags show only if the second pivot is recent.'))));

  const slr = ov.since_rsi_low || {};
  let slrTf = slr.W ? 'W' : 'D';
  const slrBody = h('div');
  const drawSlr = () => {
    slrBody.replaceChildren();
    const s = slr[slrTf];
    if (!s) { slrBody.append(empty('No confirmed RSI low yet.')); return; }
    const tfl = slrTf === 'W' ? 'weeks' : 'days';
    slrBody.append(h('p', { style: { margin: '0 0 14px', fontSize: '15px', lineHeight: 1.5 } },
      `${slrTf === 'W' ? 'Weekly' : 'Daily'} RSI last bottomed at `, h('b', null, s.rsi_low), ' on ', h('b', null, date(s.low_date)), ` (price ${usd(s.px_low)}). Since then ${sym} is `,
      h('b', { class: signCls(s.chg_pct) }, pct(s.chg_pct, 1)), ` to ${usd(s.px_now)} over ${s.bars} ${tfl} (${s.days} days).`));
    const g = h('div', { class: 'grid g2', style: { gap: '10px' } });
    const kv = (k, v) => h('div', { class: 'perf' }, h('div', { class: 'k' }, k), h('div', { class: 'v', style: { fontSize: '17px' } }, v));
    g.append(kv('RSI NOW', num(s.rsi_now, 1)), kv('RSI PEAK SINCE', num(s.rsi_peak_since, 1)), kv('HIGH SINCE', usd(s.high_since)), kv('MAX DRAWDOWN SINCE', h('span', { class: 'neg' }, pct(s.max_dd_since, 1))));
    slrBody.append(g);
    const z = h('div', { class: 'mini-list', style: { marginTop: '14px' } });
    [['last_oversold', 'Last RSI < 30 (oversold)'], ['last_overbought', 'Last RSI > 70 (overbought)']].forEach(([k, lbl]) => {
      const x = s[k];
      z.append(h('div', { class: 'r' }, h('span', null, lbl), x ? h('span', null, `${dateShort(x.date)} · RSI ${x.rsi} · ${usd(x.px)} → `, h('b', { class: signCls(x.chg_pct) }, pct(x.chg_pct, 0)), h('span', { class: 'muted' }, ` (${x.bars_ago} ${tfl} ago)`)) : h('span', { class: 'muted' }, 'none in history')));
    });
    slrBody.append(z);
  };
  drawSlr();
  const slrCard = card({ icon: 'activity', title: 'Since the last RSI low', actions: [segmented([{ value: 'W', label: 'Weekly' }, { value: 'D', label: 'Daily' }], slrTf, (v) => { slrTf = v; drawSlr(); })] }, slrBody);
  root.append(h('div', { class: 'grid g-3-2' }, trendCard, slrCard));

  // ---------------------------------------------------------------- MA table + crosses + RSI lines
  const ma = ov.ma;
  let maTf = 'D';
  const maBody = h('div');
  const drawMa = () => {
    maBody.replaceChildren();
    const t = ma?.tables?.[maTf];
    if (!t) { maBody.append(empty('n/a')); return; }
    maBody.append(table([
      { k: 'label', label: 'Average', fmt: (v) => h('b', null, v) },
      { k: 'value', label: 'Value', fmt: (v) => (isNum(v) ? usd(v) : '—') },
      { k: 'dist', label: 'Price vs MA', fmt: (v) => (isNum(v) ? h('span', { class: signCls(v) }, pct(v, 1)) : '—') },
      { k: 'above', label: 'State', fmt: (v) => (v == null ? '—' : badge(v ? 'Above' : 'Below', v ? 'pos' : 'neg')) },
    ], t));
    maBody.append(h('div', { class: 'small muted', style: { marginTop: '8px' } }, `Close ${usd(ma.last[maTf])} · ${maTf === 'D' ? 'daily' : maTf === 'W' ? 'weekly' : 'monthly'} bars`));
  };
  drawMa();
  const crossBody = h('div', { class: 'mini-list' });
  (ma?.crosses || []).forEach((c) => crossBody.append(h('div', { class: 'r' }, h('span', { class: 'muted' }, `${date(c.d)} · ${c.tf}`), h('span', null, badge(c.kind, c.dir === 'up' ? 'pos' : 'neg')))));
  if (!(ma?.crosses || []).length) crossBody.append(empty('No recent crosses.'));
  const maCard = card({ icon: 'bars', title: 'Price vs moving averages', actions: [segmented([{ value: 'D', label: 'Daily' }, { value: 'W', label: 'Weekly' }, { value: 'M', label: 'Monthly' }], maTf, (v) => { maTf = v; drawMa(); })] },
    maBody, h('div', { class: 'sub-title' }, 'Recent crosses'), crossBody);

  const linesBody = h('div');
  function renderLines() {
    linesBody.replaceChildren();
    if (!lines.length) { linesBody.append(h('div', { class: 'small muted' }, 'No saved lines yet. Press “Draw RSI line” above the chart, then click two points on the RSI pane — e.g. connect two RSI lows to track a rising support line. Lines are saved in the database per ticker and timeframe.')); }
    else {
      linesBody.append(table([
        { k: 'label', label: 'Line', align: 'l', fmt: (v, r) => v || `#${r.id}` },
        { k: 'tf', label: 'TF' },
        { k: (r) => `${dateShort(r.t1)} ${(+r.v1).toFixed(0)} → ${dateShort(r.t2)} ${(+r.v2).toFixed(0)}`, label: 'Points', align: 'l' },
        { k: (r) => { const rows2 = barsCache[r.tf]; if (!rows2) return null; const last = rows2[rows2.length - 1]; const slope = (r.v2 - r.v1) / Math.max(1, dayNum(r.t2) - dayNum(r.t1)); const proj = +r.v2 + slope * (dayNum(last[0]) - dayNum(r.t2)); return last[6] - proj; }, label: 'RSI vs line now', fmt: (v) => (isNum(v) ? h('span', { class: signCls(v) }, `${v >= 0 ? '+' : ''}${v.toFixed(1)} pts`) : 'open ' + 'tf') },
        { k: 'id', label: '', fmt: (id) => h('button', { class: 'pill xs ghost', title: 'Delete line', onclick: async () => { await api('rsi_lines', { symbol: sym, id }, { method: 'DELETE' }); await loadLines(); renderLines(); draw(); } }, icon('trash', 12)) },
      ], lines));
    }
    linesBody.append(h('div', { class: 'small muted', style: { marginTop: '10px' } }, 'Reference levels always drawn on the RSI pane: 30 (oversold), 50 (bull/bear line), 70 (overbought).'));
  }
  renderLines();
  const linesCard = card({ icon: 'sliders', title: 'Key RSI lines', sub: 'Your saved trendlines' }, linesBody);
  root.append(IS_STATIC ? maCard : h('div', { class: 'grid g2' }, maCard, linesCard));
}
