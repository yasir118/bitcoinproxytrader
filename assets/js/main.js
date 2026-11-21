// App shell: sidebar rail, header (brand + data freshness), ticker tabs, sub-page tabs, hash router.
import { api, clearCache, date, dateShort, ago, IS_STATIC } from './util.js';
import { h, $, clear, icon, btcLogo, logoBadge, errorBox, skeleton, toast } from './ui.js';
import { disposeAll } from './charts.js';

const SHORT = { MSTR: 'Strategy', COIN: 'Coinbase', IBIT: 'iShares Bitcoin', CRCL: 'Circle', ASST: 'Strive', XYZ: 'Block', MARA: 'MARA', RIOT: 'Riot',
  IREN: 'IREN', CLSK: 'CleanSpark', BTDR: 'Bitdeer', GLXY: 'Galaxy', XXI: 'Twenty One' };
const SUBPAGES = [
  { id: 'overview', label: 'Overview', icon: 'home' },
  { id: 'earnings', label: 'Earnings', icon: 'calendar' },
  { id: 'seasonality', label: 'Seasonality', icon: 'wave' },
  { id: 'chain', label: 'Chain & GEX', icon: 'layers' },
  { id: 'signals', label: 'Signals', icon: 'target' },
];
const PAGES = { overview: () => import('./pages/overview.js'), earnings: () => import('./pages/earnings.js'), seasonality: () => import('./pages/seasonality.js'),
  chain: () => import('./pages/chain.js'), signals: () => import('./pages/signals.js'), basket: () => import('./pages/basket.js'), research: () => import('./pages/research.js') };

const state = { meta: null, route: null, token: 0 };
export const app = state;

function parseHash() {
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  if (!parts.length) return { symbol: window.START_SYMBOL || 'MSTR', page: 'overview' };
  if (parts[0] === 'basket' || parts[0] === 'research') return { symbol: null, page: parts[0] };
  const symbol = parts[0].toUpperCase();
  const page = SUBPAGES.some((s) => s.id === parts[1]) ? parts[1] : 'overview';
  return { symbol, page };
}
export const go = (hash) => { if (location.hash === hash) route(); else location.hash = hash; };
const lastSymbol = () => (state.route && state.route.symbol) || sessionStorage.getItem('sym') || 'MSTR';

// ---------------------------------------------------------------- chrome
function buildRail() {
  const rail = clear($('#rail'));
  const r = state.route;
  const sym = r.symbol || lastSymbol();
  rail.append(h('div', { class: 'logo', title: 'BitcoinProxyTrader' }, btcLogo(30)));
  SUBPAGES.forEach((p) => rail.append(navBtn(p.icon, p.label, `#/${sym}/${p.id}`, r.page === p.id && r.symbol)));
  rail.append(h('div', { class: 'sep' }));
  rail.append(navBtn('grid', 'Basket', '#/basket', r.page === 'basket'));
  rail.append(navBtn('flask', 'Research', '#/research', r.page === 'research'));
  rail.append(h('div', { class: 'grow' }));
  rail.append(navBtn('book', 'How it works', '#/research', false, () => { go('#/research'); setTimeout(() => document.getElementById('about')?.scrollIntoView({ behavior: 'smooth' }), 350); }));
  rail.append(h('div', { class: 'avatar', title: 'Local workspace' }, 'Y'));
}
function navBtn(ic, label, hash, active, onclick) {
  const a = h('a', { class: `nav-btn ${active ? 'active' : ''}`, href: hash, 'aria-label': label }, icon(ic, 21), h('span', { class: 'tip' }, label));
  if (onclick) a.addEventListener('click', (e) => { e.preventDefault(); onclick(); });
  return a;
}

function freshness() {
  const m = state.meta;
  const wrap = h('div', { class: 'fresh' });
  if (!m) return wrap;
  const age = m.data_through ? Math.round((Date.now() - new Date(m.data_through + 'T20:00:00Z').getTime()) / 86400000) : 99;
  wrap.append(
    h('span', { class: 'f-chip', title: 'Latest daily bar stored for MSTR' }, h('span', { class: `dot ${age > 4 ? 'stale' : ''}` }), 'Data through ', h('b', null, date(m.data_through))),
    h('span', { class: 'f-chip', title: 'Last time the collector finished a run' }, 'Refreshed ', h('b', null, m.last_refreshed ? ago(m.last_refreshed) : 'never')),
    h('span', { class: 'f-chip', title: 'Date of the latest options-chain snapshot' }, 'Options snapshot ', h('b', null, m.options_snapshot ? dateShort(m.options_snapshot) : '—')),
  );
  if (!IS_STATIC) {
    const btn = h('button', { class: 'icon-btn', id: 'refreshBtn', title: 'Refresh data now (runs the Python collector)', onclick: () => refresh() }, icon('refresh', 18));
    wrap.append(btn);
  }
  return wrap;
}

function buildHeader() {
  const main = $('#main');
  const r = state.route;
  const top = h('div', { class: 'topbar' },
    h('div', { class: 'brand' }, btcLogo(34), 'BitcoinProxyTrader'),
    freshness());
  const chips = headingFor(r);
  const tabs = h('div', { class: 'pill-row scroll', role: 'tablist' });
  tabs.append(h('a', { class: `pill ${r.page === 'basket' ? 'active' : ''}`, href: '#/basket' }, icon('grid', 15), 'Basket'));
  tabs.append(h('a', { class: `pill ${r.page === 'research' ? 'active' : ''}`, href: '#/research' }, icon('flask', 15), 'Research'));
  (state.meta?.tickers || []).filter((t) => +t.is_tab).forEach((t) => {
    const sub = r.symbol ? r.page : 'overview';
    tabs.append(h('a', { class: `pill ${r.symbol === t.symbol ? 'active' : ''}`, href: `#/${t.symbol}/${sub}` }, t.symbol));
  });
  main.append(top, chips, tabs);
  if (r.symbol) {
    const nav = h('nav', { class: 'subnav' });
    SUBPAGES.forEach((p) => nav.append(h('a', { class: r.page === p.id ? 'active' : '', href: `#/${r.symbol}/${p.id}` }, p.label)));
    main.append(nav);
  } else main.append(h('div', { style: { height: '12px' } }));
}

function headingFor(r) {
  const t = h('h1', { class: 'hero-title' });
  const sym = r.symbol;
  const nm = sym ? (SHORT[sym] || sym) : '';
  const chip = (txt, cls = '') => h('span', { class: `chip-ico ${cls}` }, txt);
  const btc = () => h('span', { class: 'title-btc' }, btcLogo(48));
  if (r.page === 'basket') t.append('Watching the ', chip('₿ proxies', 'accent'), ' basket and its ', btc(), ' beta');
  else if (r.page === 'research') t.append('Researching the ', chip('proxy trade', 'dark'), ' with real data');
  else if (r.page === 'earnings') t.append(chip(sym, 'accent'), nm, ' earnings and how the stock reacts');
  else if (r.page === 'seasonality') t.append('When ', chip(sym, 'accent'), ' and ', btc(), ' Bitcoin tend to move');
  else if (r.page === 'chain') t.append('The options chain and gamma behind ', chip(sym, 'accent'));
  else if (r.page === 'signals') t.append('Tops, lows and RSI: ', chip('signals', 'dark'), ' for ', chip(sym, 'accent'));
  else t.append('Tracking ', chip(sym, 'accent'), nm, ' and ', btc(), ' Bitcoin');
  return t;
}

// ---------------------------------------------------------------- refresh button
let polling = null;
async function refresh(scope = 'quick') {
  const btn = $('#refreshBtn');
  try {
    const res = await api('refresh', { scope }, { method: 'POST' });
    if (!res.started) { toast(res.message || 'Refresh is already running'); }
    else toast(`Refreshing data (${res.scope}) — this takes ${res.scope === 'full' ? 'a few minutes' : '1–2 minutes'}…`, 5000);
    btn?.classList.add('spin');
    clearInterval(polling);
    polling = setInterval(async () => {
      try {
        const s = await api('refresh_status', {}, { ttl: 0 });
        if (!s.running) {
          clearInterval(polling); btn?.classList.remove('spin');
          clearCache(); await loadMeta(); route();
          toast('Data refreshed ✔');
        }
      } catch (e) { /* keep polling */ }
    }, 4000);
  } catch (e) { toast(`Refresh failed: ${e.message}`, 6000); }
}
window.__refresh = refresh;

// ---------------------------------------------------------------- router
async function loadMeta() { state.meta = await api('meta', {}, { ttl: 0 }); }

export async function route() {
  const token = ++state.token;
  disposeAll();
  state.route = parseHash();
  if (state.route.symbol) sessionStorage.setItem('sym', state.route.symbol);
  const main = clear($('#main'));
  buildRail();
  buildHeader();
  const page = h('div', { id: 'page' }, skeleton(260));
  main.append(page);
  const PT = { overview: 'dashboard: RSI, options, Bitcoin beta', earnings: 'earnings moves', seasonality: 'seasonality', chain: 'options chain & gamma (GEX)', signals: 'tops, lows & RSI signals' };
  const rs = state.route.symbol;
  document.title = rs ? `${SHORT[rs] || rs} (${rs}) ${PT[state.route.page]} · BitcoinProxyTrader` : `${state.route.page === 'basket' ? 'Bitcoin-proxy basket' : 'Research'} · BitcoinProxyTrader`;
  try {
    const mod = await PAGES[state.route.page]();
    if (token !== state.token) return;
    clear(page);
    await mod.render(page, { symbol: state.route.symbol, meta: state.meta, name: SHORT[state.route.symbol] || state.route.symbol, go, refresh, token: () => token === state.token });
  } catch (e) {
    console.error(e);
    if (token === state.token) { clear(page); page.append(errorBox(e)); }
  }
  if (token === state.token) {
    if (IS_STATIC && !$('#sitefoot')) {
      main.append(h('div', { id: 'sitefoot', class: 'disclaimer', style: { borderTop: '1px solid var(--line)', paddingTop: '16px' } },
        h('b', null, 'Educational research only — not investment advice. '), 'Prices and options come from Yahoo Finance (end-of-day / delayed), filings from SEC EDGAR, bitcoin volatility from Deribit; ',
        'figures are calculated automatically and may contain errors or be out of date. Signals and statistics describe the past and do not predict the future. ',
        'Trading stocks, options and crypto involves substantial risk of loss.'));
    }
    window.scrollTo({ top: 0 });
  }
}

window.addEventListener('hashchange', route);
(async () => {
  document.getElementById('boot')?.remove();      // static 'open via localhost' fallback is only for when this script never runs
  try { await loadMeta(); } catch (e) { $('#main').append(errorBox(e)); return; }
  if (!location.hash) location.hash = `#/${window.START_SYMBOL || 'MSTR'}/overview`; else route();
})();
