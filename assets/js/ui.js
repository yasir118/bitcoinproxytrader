// Tiny DOM toolkit + the visual components of the design system (tiles, capsule meters, tables, pills).
import { num, pct, signCls, isNum, clamp, logoDomain } from './util.js';

export function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k === 'html') el.innerHTML = v;
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else el.setAttribute(k, v === true ? '' : v);
    }
  }
  append(el, kids);
  return el;
}
function append(el, kids) {
  for (const k of kids.flat(Infinity)) {
    if (k == null || k === false) continue;
    el.append(k instanceof Node ? k : document.createTextNode(String(k)));
  }
}
export const $ = (s, el = document) => el.querySelector(s);
export const $$ = (s, el = document) => [...el.querySelectorAll(s)];
export const clear = (el) => { while (el.firstChild) el.removeChild(el.firstChild); return el; };

// ---------------------------------------------------------------- icons (24px stroke set)
const P = {
  home: 'M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z',
  calendar: 'M8 2v4M16 2v4M3 9h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z',
  wave: 'M2 12c2.5-6 5-6 7.5 0s5 6 7.5 0 3-4 5-3',
  layers: 'm12 2 10 5-10 5L2 7zM2 12l10 5 10-5M2 17l10 5 10-5',
  activity: 'M22 12h-4l-3 9L9 3l-3 9H2',
  grid: 'M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z',
  flask: 'M9 3h6M10 3v6L4.5 19a2 2 0 0 0 1.8 3h11.4a2 2 0 0 0 1.8-3L14 9V3',
  refresh: 'M21 12a9 9 0 1 1-3-6.7L21 8M21 3v5h-5',
  sliders: 'M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6',
  arrow: 'M7 17 17 7M7 7h10v10',
  help: 'M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3M12 17h.01M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z',
  book: 'M4 19.5A2.5 2.5 0 0 1 6.5 17H20M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z',
  trend: 'm22 7-8.5 8.5-5-5L2 17M16 7h6v6',
  target: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 18a6 6 0 1 0 0-12 6 6 0 0 0 0 12zM12 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4z',
  bars: 'M4 21V10M10 21V4M16 21v-8M22 21V7',
  gauge: 'M12 14l4-4M3.3 17a10 10 0 1 1 17.4 0',
  dollar: 'M12 2v20M17 6H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6',
  bolt: 'M13 2 3 14h9l-1 8 10-12h-9z',
  users: 'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM23 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8',
  file: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M8 13h8M8 17h8',
  coins: 'M8 14a6 6 0 1 0 0-12 6 6 0 0 0 0 12zM18.1 10.4A6 6 0 1 1 10.4 18.1',
  shield: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z',
  link: 'M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7',
  sun: 'M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10zM12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4',
  trash: 'M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6',
  plus: 'M12 5v14M5 12h14',
  check: 'M20 6 9 17l-5-5',
  info: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 16v-4M12 8h.01',
  dots: 'M12 5h.01M12 12h.01M12 19h.01',
  spark: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z',
};
export function icon(name, size = 20, stroke = 1.8) {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('width', size); s.setAttribute('height', size);
  s.setAttribute('fill', 'none'); s.setAttribute('stroke', 'currentColor'); s.setAttribute('stroke-width', stroke);
  s.setAttribute('stroke-linecap', 'round'); s.setAttribute('stroke-linejoin', 'round');
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path'); p.setAttribute('d', P[name] || P.dots);
  s.append(p);
  return s;
}
export function btcLogo(size = 34) {
  const ns = 'http://www.w3.org/2000/svg';
  const s = document.createElementNS(ns, 'svg'); s.setAttribute('viewBox', '0 0 32 32'); s.setAttribute('width', size); s.setAttribute('height', size);
  const c = document.createElementNS(ns, 'circle'); c.setAttribute('cx', 16); c.setAttribute('cy', 16); c.setAttribute('r', 16); c.setAttribute('fill', '#f7931a');
  const p = document.createElementNS(ns, 'path');
  p.setAttribute('d', 'M12.2 8.5h6a3.2 3.2 0 0 1 0 6.4h-6M12.2 14.9h6.9a3.3 3.3 0 0 1 0 6.6h-6.9M12.2 8.5v13M14.4 5.6v2.9M14.4 21.5v2.9M18.2 5.6v2.9M18.2 21.5v2.9');
  p.setAttribute('fill', 'none'); p.setAttribute('stroke', '#fff'); p.setAttribute('stroke-width', 2.3); p.setAttribute('stroke-linecap', 'round'); p.setAttribute('stroke-linejoin', 'round');
  s.append(c, p);
  return s;
}
export function logoBadge(symbol, size = 62) {
  const b = h('div', { class: 'logo-badge', style: { width: size + 'px', height: size + 'px', borderRadius: size * 0.32 + 'px' } });
  const dom = logoDomain[symbol];
  const mono = () => { clear(b); b.textContent = symbol.slice(0, symbol.length > 3 ? 2 : 3); };
  if (symbol === 'BTC-USD') { b.style.background = 'transparent'; b.append(btcLogo(size)); return b; }
  if (!dom) { mono(); return b; }
  const img = h('img', { alt: symbol, src: `https://www.google.com/s2/favicons?domain=${dom}&sz=128` });
  img.addEventListener('error', mono);
  img.addEventListener('load', () => { if (img.naturalWidth < 24) mono(); });
  b.append(img);
  return b;
}

// ---------------------------------------------------------------- components
export function card(opts = {}, ...kids) {
  const el = h('div', { class: `card ${opts.cls || ''}`, id: opts.id });
  if (opts.title || opts.actions || opts.icon) {
    const head = h('div', { class: 'card-head' });
    if (opts.icon) head.append(h('div', { class: 'ico' }, icon(opts.icon, 20)));
    const t = h('div', null, h('h3', null, opts.title || ''), opts.sub ? h('div', { class: 'sub' }, opts.sub) : null);
    head.append(t, h('div', { class: 'grow' }));
    if (opts.actions) head.append(h('div', { class: 'actions' }, opts.actions));
    el.append(head);
  }
  append(el, kids);
  return el;
}
export function tile(o) {
  const t = h('div', { class: `tile ${o.cls || ''}` });
  t.append(h('div', { class: 'head' }, o.icon ? h('div', { class: 'ico' }, icon(o.icon, 18)) : null, h('div', { class: 'lbl' }, o.label), o.tag ? o.tag : null));
  if (o.big != null) t.append(h('div', { class: 'big' }, o.big, o.unit ? h('small', null, o.unit) : null));
  if (o.body) t.append(o.body);
  if (o.meter) t.append(o.meter);
  if (o.note) t.append(h('div', { class: 'note' }, o.note));
  return t;
}
export const tag = (text, cls = '') => h('span', { class: `tag ${cls}` }, text);
export const badge = (text, cls = '') => h('span', { class: `badge ${cls}` }, text);
export function delta(x, d = 2) {
  if (!isNum(x)) return h('span', { class: 'muted' }, '—');
  return h('span', { class: `delta ${x >= 0 ? 'pos' : 'neg'}` }, `${x >= 0 ? '▲' : '▼'} ${Math.abs(x * 100).toFixed(d)}%`);
}
export const pctSpan = (x, d = 1, cls = '') => h('span', { class: `${signCls(x)} ${cls}` }, pct(x, d));

/** Segmented capsule meter (reference look).  filled can be fractional. */
export function meter(filled, total = 10, o = {}) {
  const m = h('div', { class: `meter ${o.sm ? 'sm' : ''}` });
  for (let i = 0; i < total; i++) {
    const f = clamp(filled - i, 0, 1);
    const seg = h('i', { class: f >= 0.999 ? '' : f <= 0.001 ? 'off' : 'mid' });
    if (f > 0.001 && f < 0.999) seg.style.setProperty('--fill', `${Math.round(f * 100)}%`);
    m.append(seg);
  }
  return m;
}

export function segmented(options, active, onChange) {
  const wrap = h('div', { class: 'seg' });
  options.forEach((o) => {
    const val = typeof o === 'object' ? o.value : o;
    const lbl = typeof o === 'object' ? o.label : o;
    const b = h('button', { class: val === active ? 'active' : '', onclick: () => { $$('button', wrap).forEach((x) => x.classList.remove('active')); b.classList.add('active'); onChange(val); } }, lbl);
    wrap.append(b);
  });
  return wrap;
}
export function toggle(label, on, onChange, colorDot) {
  const b = h('button', { class: `toggle ${on ? 'on' : ''}` }, h('span', { class: 'sw', style: colorDot ? { background: colorDot } : null }), label);
  b.addEventListener('click', () => { b.classList.toggle('on'); onChange(b.classList.contains('on')); });
  return b;
}

/** Generic table.  cols: [{k,label,align,fmt(v,row)->string|Node,cls}] */
export function table(cols, rows, o = {}) {
  const t = h('table', { class: 'tbl' });
  t.append(h('thead', null, h('tr', null, cols.map((c) => h('th', { class: c.align === 'l' ? 'l' : '', title: c.title }, c.label)))));
  const tb = h('tbody');
  rows.forEach((r, i) => {
    const tr = h('tr', { class: `${o.onRow ? 'click' : ''} ${o.rowCls ? o.rowCls(r, i) || '' : ''}` });
    cols.forEach((c) => {
      const raw = typeof c.k === 'function' ? c.k(r, i) : r[c.k];
      const v = c.fmt ? c.fmt(raw, r, i) : raw;
      const td = h('td', { class: `${c.align === 'l' ? 'l' : ''} ${c.cls ? (typeof c.cls === 'function' ? c.cls(raw, r) : c.cls) : ''}` });
      if (v instanceof Node) td.append(v); else td.textContent = v == null ? '—' : v;
      tr.append(td);
    });
    if (o.onRow) tr.addEventListener('click', () => o.onRow(r));
    tb.append(tr);
  });
  t.append(tb);
  return h('div', { class: 'tbl-wrap' }, t);
}

export const empty = (msg) => h('div', { class: 'empty' }, msg);
export const skeleton = (hgt = 160) => h('div', { class: 'skeleton', style: { height: hgt + 'px' } });
export function errorBox(e) { return h('div', { class: 'callout warn' }, h('b', null, 'Could not load this section. '), String(e && e.message ? e.message : e)); }

export function toast(msg, ms = 3200) {
  const t = h('div', { class: 'toast' }, msg);
  document.body.append(t);
  setTimeout(() => t.remove(), ms);
}

/** Pill-capsule paired bars (reference "Statistics" look). items: [{label, a, b}] values in fractions. */
export function capsules(items, o = {}) {
  const max = Math.max(0.0001, ...items.flatMap((i) => [Math.abs(i.a ?? 0), Math.abs(i.b ?? 0)]));
  const wrap = h('div', { class: 'capsules' });
  items.forEach((it) => {
    const col = h('div', { class: 'cap-col' });
    const pair = h('div', { class: 'cap-pair' });
    const mk = (v, cls) => {
      if (!isNum(v)) return h('div', { class: 'cap', style: { height: '0px', visibility: 'hidden' } });
      const hgt = Math.max(24, (Math.abs(v) / max) * 100);
      const c = h('div', { class: `cap ${cls} ${v < 0 ? 'neg' : ''}`, style: { height: hgt + '%' }, title: `${it.label}: ${pct(v)}` }, h('span', { class: 'val' }, pct(v, 0, false)));
      return c;
    };
    pair.append(mk(it.a, 'a'));
    if ('b' in it) pair.append(mk(it.b, 'b'));
    col.append(pair, h('div', { class: 'cap-lbl' }, it.label));
    wrap.append(col);
  });
  return wrap;
}

export function heatColor(v, scale = 0.2) {
  if (!isNum(v)) return 'transparent';
  const a = clamp(Math.abs(v) / scale, 0, 1);
  const alpha = 0.12 + 0.62 * a;
  return v >= 0 ? `rgba(30,154,104,${alpha})` : `rgba(212,69,61,${alpha})`;
}
export const verdictClass = (v) => `v-${v}`;
export function verdictBadge(v) {
  return h('span', { class: `badge ${verdictClass(v)}`, style: { background: 'var(--vc)', color: v === 'HOLD' ? '#1c1f1b' : '#fff' } }, v);
}
