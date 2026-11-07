// Research: correlation matrix, notes, data sources & cost, and how the system works / refreshes.
import { api, num, pct, usd, date, dateShort, dtLocal, ago, signCls, isNum, int, compact, clearCache, IS_STATIC } from '../util.js';
import { h, card, tile, tag, badge, table, segmented, empty, icon, heatColor, toast } from '../ui.js';
import { cjs, axis, tip, C } from '../charts.js';

export async function render(root, ctx) {
  const [r, meta, st] = await Promise.all([api('research'), api('meta', {}, { ttl: 0 }), api('refresh_status', {}, { ttl: 0 })]);
  // ---- correlation matrix
  let w = 'w252';
  const heatHost = h('div');
  const drawHeat = () => {
    const cm = r.corr; const syms = cm.symbols; const M = cm[w];
    const t = h('table', { class: 'tbl' });
    t.append(h('thead', null, h('tr', null, h('th', null, ''), syms.map((s) => h('th', { style: { textAlign: 'center' } }, s === 'BTC-USD' ? 'BTC' : s)))));
    const tb = h('tbody');
    syms.forEach((a, i) => tb.append(h('tr', null, h('td', null, h('b', null, a === 'BTC-USD' ? 'BTC' : a)), M[i].map((v, j) => h('td', { style: { padding: '3px' } },
      isNum(v) ? h('div', { class: 'heat', style: { background: i === j ? '#d9ddd6' : `rgba(247,147,26,${0.08 + 0.8 * Math.max(0, v)})`, color: v > 0.75 ? '#1a1105' : 'inherit' }, title: `${a} vs ${syms[j]}: ${v.toFixed(2)}` }, v.toFixed(2)) : h('div', { class: 'heat muted' }, '—'))))));
    t.append(tb); heatHost.replaceChildren(h('div', { class: 'tbl-wrap' }, t));
  };
  drawHeat();
  root.append(card({ cls: 'white', icon: 'grid', title: 'Correlation of daily returns', sub: 'How much the basket moves together — and with Bitcoin. Darker = more correlated.',
    actions: [segmented([{ value: 'w60', label: '60 sessions' }, { value: 'w252', label: '1 year' }], w, (v) => { w = v; drawHeat(); })] }, heatHost));

  // ---- notes + sources
  const notesHost = h('div');
  const ta = h('textarea', { placeholder: 'Write a research note — thesis, levels, reminders. Saved in your local database.' });
  const symSel = h('select', null, h('option', { value: '' }, 'General'), ...['MSTR', 'COIN', 'IBIT', 'CRCL', 'ASST', 'XYZ', 'MARA', 'RIOT', 'IREN', 'CLSK', 'BTDR', 'GLXY', 'XXI'].map((s) => h('option', { value: s }, s)));
  const drawNotes = async () => {
    const n = (await api('notes', {}, { ttl: 0 })).rows;
    notesHost.replaceChildren(n.length ? h('div', { class: 'stack', style: { gap: '10px' } }, n.map((x) => h('div', { class: 'card hi', style: { padding: '14px 16px', borderRadius: '18px' } },
      h('div', { class: 'row between' }, h('span', { class: 'small muted' }, `${x.symbol ? x.symbol + ' · ' : ''}${dtLocal(x.created_at)}`), h('button', { class: 'pill xs ghost', title: 'Delete', onclick: async () => { await api('notes', { id: x.id }, { method: 'DELETE' }); drawNotes(); } }, icon('trash', 12))),
      h('div', { style: { whiteSpace: 'pre-wrap', marginTop: '6px' } }, x.body)))) : empty('No notes yet.'));
  };
  const noteCard = card({ cls: 'white', icon: 'file', title: 'Research notes' }, h('div', { class: 'stack', style: { gap: '8px', marginBottom: '14px' } }, ta,
    h('div', { class: 'row' }, symSel, h('button', { class: 'btn', onclick: async () => { if (!ta.value.trim()) return; await api('notes', {}, { method: 'POST', body: { body: ta.value, symbol: symSel.value || null } }); ta.value = ''; drawNotes(); } }, 'Save note'))), notesHost);
  const sources = card({ cls: 'white', icon: 'coins', title: 'Data sources & cost', sub: 'What feeds this terminal — and what would be worth paying for' });
  sources.append(table([
    { k: 'name', label: 'Source', align: 'l', fmt: (v, s) => h('a', { class: 'src-link', href: s.url, target: '_blank', rel: 'noopener' }, v) }, { k: 'use', label: 'Used for', align: 'l', fmt: (v) => h('span', { class: 'wrap', style: { display: 'inline-block', maxWidth: '300px' } }, v) },
    { k: 'cost', label: 'Cost' }, { k: 'status', label: 'Status', fmt: (v) => badge(v === 'live' ? '● Live' : v === 'optional' ? 'Optional' : 'Later', v === 'live' ? 'pos' : v === 'optional' ? 'acc' : '') }], r.sources));
  sources.append(h('div', { class: 'callout', style: { marginTop: '14px' } }, h('b', null, 'Cost-efficient path: '), 'everything on the dashboard runs on free sources today ($0/month). The one gap free data cannot fill is historical implied volatility and option prices (IV percentile, the $400-call history). ',
    'A single month of Massive Options Advanced ($199) is enough to back-fill that once (see README → “Back-fill with Massive”); after that the daily snapshots keep it current for free. Stocks Starter ($29/mo) is only worth it if you need real-time quotes — daily data here is end-of-day.'));
  if (IS_STATIC) root.append(sources); else { root.append(h('div', { class: 'grid g2', style: { alignItems: 'start' } }, noteCard, sources)); drawNotes(); }

  // ---- about / refresh
  const c = meta.counts;
  const about = card({ id: 'about', cls: 'hi', icon: 'book', title: 'How it works', sub: 'Collectors → MariaDB → PHP API → this dashboard' });
  about.append(h('div', { class: 'grid g4', style: { margin: '6px 0 16px' } },
    tile({ icon: 'bars', label: 'Daily bars', big: compact(c.daily_rows, 1), note: `Through ${date(meta.data_through)} (BTC ${dateShort(meta.btc_through)})` }),
    tile({ icon: 'activity', label: 'Hourly bars', big: compact(c.hourly_rows, 1), note: 'Drive the 4H chart (2-year window from Yahoo)' }),
    tile({ icon: 'layers', label: 'Option contracts', big: compact(c.option_rows, 1), note: `${c.option_snapshots} daily snapshot${c.option_snapshots === 1 ? '' : 's'} so far — history grows every run` }),
    tile({ icon: 'file', label: 'Filings · Form 4 · 8-K BTC', big: compact(c.filings, 1), note: `${int(c.insider_tx)} insider lines · ${c.btc_statements} bitcoin statements` })));
  const run = h('div', { class: 'row', style: { marginBottom: '12px' } },
    h('button', { class: 'btn accent', onclick: () => ctx.refresh('quick') }, 'Refresh prices, options & signals'),
    h('button', { class: 'btn', onclick: () => ctx.refresh('full') }, 'Full refresh (adds SEC filings, insiders, earnings, treasury)'),
    h('span', { class: 'small muted' }, `Last finished run: ${meta.last_refreshed ? ago(meta.last_refreshed) : 'never'}`));
  if (!IS_STATIC) about.append(run);
  if (!IS_STATIC) about.append(table([{ k: 'job', label: 'Job', align: 'l', fmt: (v) => h('b', null, v) }, { k: 'status', label: 'Status', fmt: (v) => badge(v, v === 'ok' ? 'pos' : v === 'error' ? 'neg' : 'acc') }, { k: 'started', label: 'Started (UTC)' }, { k: 'message', label: 'Result', align: 'l', fmt: (v) => h('span', { class: 'wrap' }, v || '') }], st.log));
  about.append(h('div', { class: 'defs', style: { marginTop: '14px' } },
    IS_STATIC ? h('div', null, h('b', null, 'How often it updates'), 'This public copy is a read-only snapshot, rebuilt after each daily data collection (see “Data through” at the top of every page). It is end-of-day data, not live quotes.') : null,
    IS_STATIC ? null : h('div', null, h('b', null, 'Where the data lives'), 'MariaDB database “mstr_terminal” (open it in phpMyAdmin): prices_daily, prices_intraday, bars_tf (multi-timeframe bars + RSI + MAs), options_chain / options_summary / options_expiry, option_watch, dvol_daily, sec_filings, insider_tx, btc_holdings, treasury_inputs, earnings_events, signals_daily and an analytics table of precomputed JSON.'),
    IS_STATIC ? null : h('div', null, h('b', null, 'Keep it fresh'), 'Run  collector\run_all.bat  daily after the US close, or create a Windows Task Scheduler task for it (README has the one-liner). Options history and OI-change charts need a snapshot every trading day.'),
    h('div', null, h('b', null, 'Honest limits'), 'Free data is end-of-day and Yahoo can throttle. Option IV is our own Black-Scholes on bid/ask mid; GEX is a model. Strategy’s preferred / debt come from the latest 10-Q, so mNAV lags weekly purchases slightly.')));
  root.append(about);
}
