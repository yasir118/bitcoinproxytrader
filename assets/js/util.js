// API access + number/date formatting shared by every page.
const BASE = 'api/index.php';
const cache = new Map();

// ---------------------------------------------------------------- public (static) site mode
// The public website has no PHP/database: deploy/export_static.py saves every API answer as data/<name>.json and the exporter
// sets window.STATIC_SITE.  The file-name rule below MUST match name_for() in deploy/export_static.py.
export const IS_STATIC = !!window.STATIC_SITE;
export function staticName(route, params = {}) {
  const clean = (v) => String(v).replace(/[^A-Za-z0-9.-]/g, '_');
  const parts = [route];
  if (params.symbol) parts.push(clean(params.symbol));
  Object.keys(params).filter((k) => k !== 'symbol').sort().forEach((k) => {
    if (params[k] !== '' && params[k] != null) parts.push(`${clean(k)}-${clean(params[k])}`);
  });
  return parts.join('.');
}
async function staticApi(route, params, opts) {
  if (opts.method && opts.method !== 'GET') throw new Error('This public site is read-only.');
  if (route === 'notes' || route === 'rsi_lines') return { rows: [] };
  if (route === 'refresh_status') return { status: { state: 'static' }, running: false, log: [] };
  const name = staticName(route, params);
  if (cache.has(name)) return cache.get(name).v;
  const res = await fetch(`${window.STATIC_BASE || 'data/'}${name}.json`);
  const type = res.headers.get('content-type') || '';
  if (!res.ok || !type.includes('json')) throw new Error(`No data published for ${route}${params.symbol ? ' / ' + params.symbol : ''} yet`);
  const data = await res.json();
  cache.set(name, { t: Date.now(), v: data });
  return data;
}

export async function api(route, params = {}, opts = {}) {
  if (IS_STATIC) return staticApi(route, params, opts);
  const qs = new URLSearchParams({ r: route, ...params }).toString();
  const key = `${opts.method || 'GET'}:${qs}`;
  const ttl = opts.ttl ?? 45000;
  if (!opts.method && cache.has(key) && Date.now() - cache.get(key).t < ttl) return cache.get(key).v;
  const res = await fetch(`${BASE}?${qs}`, {
    method: opts.method || 'GET',
    headers: opts.body ? { 'Content-Type': 'application/json' } : undefined,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  let data;
  try { data = await res.json(); } catch (e) { throw new Error(`API ${route}: invalid response`); }
  if (!res.ok || (data && data.error)) throw new Error(data && data.error ? data.error : `API ${route}: ${res.status}`);
  if (!opts.method) cache.set(key, { t: Date.now(), v: data });
  return data;
}
export const clearCache = () => cache.clear();

// ---------------------------------------------------------------- numbers
const nf = (d) => new Intl.NumberFormat('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
const nfs = {};
const fmtN = (x, d) => (nfs[d] ||= nf(d)).format(x);
export const isNum = (x) => typeof x === 'number' && isFinite(x);

export const num = (x, d = 2) => (isNum(x) ? fmtN(x, d) : '—');
export const int = (x) => (isNum(x) ? fmtN(Math.round(x), 0) : '—');
export const pct = (x, d = 1, sign = true) => (isNum(x) ? `${sign && x > 0 ? '+' : ''}${fmtN(x * 100, d)}%` : '—');
export const pctP = (x, d = 1, sign = false) => (isNum(x) ? `${sign && x > 0 ? '+' : ''}${fmtN(x, d)}%` : '—');   // x already in percent units
export const usd = (x, d = 2) => (isNum(x) ? `${x < 0 ? '−' : ''}$${fmtN(Math.abs(x), d)}` : '—');
export function compact(x, d = 1) {
  if (!isNum(x)) return '—';
  const a = Math.abs(x);
  const s = x < 0 ? '−' : '';
  if (a >= 1e12) return `${s}${fmtN(a / 1e12, d)}T`;
  if (a >= 1e9) return `${s}${fmtN(a / 1e9, d)}B`;
  if (a >= 1e6) return `${s}${fmtN(a / 1e6, d)}M`;
  if (a >= 1e3) return `${s}${fmtN(a / 1e3, d)}K`;
  return `${s}${fmtN(a, a < 10 ? 2 : 0)}`;
}
export const usdc = (x, d = 1) => (isNum(x) ? `${x < 0 ? '−' : ''}$${compact(Math.abs(x), d)}` : '—');
export const signCls = (x) => (isNum(x) ? (x > 0 ? 'pos' : x < 0 ? 'neg' : '') : 'muted');
export const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

// ---------------------------------------------------------------- dates
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const MONTHS = MON;
function parts(s) { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s || ''); return m ? [+m[1], +m[2], +m[3]] : null; }
export function date(s) { const p = parts(s); return p ? `${MON[p[1] - 1]} ${p[2]}, ${p[0]}` : '—'; }
export function dateShort(s) { const p = parts(s); return p ? `${MON[p[1] - 1]} ${p[2]}` : '—'; }
export function dateMY(s) { const p = parts(s); return p ? `${MON[p[1] - 1]} ’${String(p[0]).slice(2)}` : '—'; }
export function daysUntil(s) {
  const p = parts(s); if (!p) return null;
  const t = Date.UTC(p[0], p[1] - 1, p[2]);
  const n = new Date(); const today = Date.UTC(n.getFullYear(), n.getMonth(), n.getDate());
  return Math.round((t - today) / 86400000);
}
export function ago(s) {
  if (!s) return '—';
  const d = new Date(s.replace(' ', 'T') + 'Z');
  const m = Math.round((Date.now() - d.getTime()) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  if (m < 1440) return `${Math.round(m / 60)} h ago`;
  return `${Math.round(m / 1440)} d ago`;
}
export function dtLocal(s) {
  if (!s) return '—';
  const d = new Date(s.replace(' ', 'T') + 'Z');
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}
export const logoDomain = {
  MSTR: 'strategy.com', COIN: 'coinbase.com', IBIT: 'ishares.com', CRCL: 'circle.com', ASST: 'strive.com', XYZ: 'block.xyz', MARA: 'mara.com',
  RIOT: 'riotplatforms.com', IREN: 'iren.com', CLSK: 'cleanspark.com', BTDR: 'bitdeer.com', GLXY: 'galaxy.com', XXI: 'xxi.money',
};
