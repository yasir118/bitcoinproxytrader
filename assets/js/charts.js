// Chart helpers: TradingView lightweight-charts (price/RSI/lines) and Chart.js (bars, scatter, heat), with disposal on navigation.
import { h } from './ui.js';

export const C = {
  ink: '#141414', ink2: '#3b413b', muted: '#777e75', grid: 'rgba(20,20,20,.07)', accent: '#f7931a', accentDeep: '#d97a05',
  pos: '#1e9a68', neg: '#d4453d', btc: '#141414', blue: '#4a6fa5', violet: '#7a5ea8', grey: '#9aa097',
  ma: { sma20: '#e8b03a', sma50: '#4a6fa5', sma100: '#7a5ea8', sma200: '#d4453d', ema21: '#1e9a68' },
};

const registry = [];
export function disposeAll() {
  while (registry.length) { try { registry.pop()(); } catch (e) { /* already gone */ } }
}
const reg = (fn) => registry.push(fn);

function sizeFrom(el) { return { w: Math.max(200, el.clientWidth), h: Math.max(120, el.clientHeight) }; }

export function lwChart(el, o = {}) {
  const LW = window.LightweightCharts;
  const { w, h: hh } = sizeFrom(el);
  const chart = LW.createChart(el, {
    width: w, height: hh,
    layout: { background: { type: 'solid', color: 'transparent' }, textColor: C.ink2, fontFamily: 'Inter Tight, Inter, Segoe UI, system-ui, sans-serif', fontSize: 11.5 },
    grid: { vertLines: { color: o.noVGrid ? 'transparent' : C.grid }, horzLines: { color: C.grid } },
    rightPriceScale: { borderVisible: false, minimumWidth: 66, scaleMargins: o.margins || { top: 0.08, bottom: 0.06 }, mode: o.log ? LW.PriceScaleMode.Logarithmic : LW.PriceScaleMode.Normal },
    leftPriceScale: { visible: !!o.left, borderVisible: false, minimumWidth: 52 },
    timeScale: { borderVisible: false, timeVisible: !!o.timeVisible, secondsVisible: false, rightOffset: 4, fixLeftEdge: false, tickMarkFormatter: o.tickFmt },
    crosshair: { mode: 0, vertLine: { color: 'rgba(20,20,20,.35)', labelBackgroundColor: C.ink }, horzLine: { color: 'rgba(20,20,20,.35)', labelBackgroundColor: C.ink } },
    localization: o.localization || {},
    handleScroll: o.static ? false : { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true },
    handleScale: o.static ? false : true,
  });
  const ro = new ResizeObserver(() => { const s = sizeFrom(el); chart.resize(s.w, s.h); });
  ro.observe(el);
  let dead = false;
  chart.dispose = () => { if (dead) return; dead = true; ro.disconnect(); chart.remove(); };
  reg(chart.dispose);
  return chart;
}

export function syncRanges(a, b) {
  let lock = false;
  const link = (src, dst) => src.timeScale().subscribeVisibleLogicalRangeChange((r) => {
    if (lock || !r) return;
    lock = true; dst.timeScale().setVisibleLogicalRange(r); lock = false;
  });
  link(a, b); link(b, a);
}

export const lineOpts = (color, w = 2, extra = {}) => ({ color, lineWidth: w, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false, ...extra });

export function legend(el, items) {
  const l = h('div', { class: 'chart-legend' }, items.map((i) => h('span', null, h('i', { style: { background: i.color } }), i.label)));
  el.append(l);
  return l;
}

// ---------------------------------------------------------------- Chart.js
export function cjs(el, config) {
  const box = h('div', { class: 'canvas-box', style: { height: (el.clientHeight || 280) + 'px' } });
  const canvas = h('canvas');
  box.append(canvas);
  el.append(box);
  const Ch = window.Chart;
  Ch.defaults.font.family = 'Inter Tight, Inter, Segoe UI, system-ui, sans-serif';
  Ch.defaults.font.size = 11.5;
  Ch.defaults.color = C.ink2;
  const cfg = { ...config, options: { responsive: true, maintainAspectRatio: false, animation: { duration: 350 }, ...(config.options || {}) } };
  const chart = new Ch(canvas, cfg);
  chart.dispose = () => { try { chart.destroy(); } catch (e) { /* gone */ } box.remove(); };
  reg(chart.dispose);
  return chart;
}
export const axis = (o = {}) => ({ grid: { color: C.grid, drawTicks: false }, border: { display: false }, ticks: { padding: 6, ...(o.ticks || {}) }, ...o });
export const tip = (extra = {}) => ({ backgroundColor: C.ink, titleColor: '#fff', bodyColor: '#fff', padding: 10, cornerRadius: 10, boxPadding: 4, ...extra });

/** Port of collector zigzag (absolute reversal) for RSI swing markers. */
export function zigzagAbs(vals, thresh) {
  const pts = []; vals.forEach((v, i) => { if (v != null) pts.push([i, v]); });
  if (pts.length < 3) return [];
  const out = []; let trend = 0; let hi = pts[0]; let lo = pts[0];
  for (let k = 1; k < pts.length; k++) {
    const [i, v] = pts[k];
    if (trend === 0) {
      if (v > hi[1]) hi = [i, v]; if (v < lo[1]) lo = [i, v];
      if (hi[0] > lo[0] && hi[1] - lo[1] >= thresh) { out.push([lo[0], lo[1], 'L']); trend = 1; lo = [i, v]; }
      else if (lo[0] > hi[0] && hi[1] - lo[1] >= thresh) { out.push([hi[0], hi[1], 'H']); trend = -1; hi = [i, v]; }
    } else if (trend === 1) {
      if (v > hi[1]) hi = [i, v]; else if (hi[1] - v >= thresh) { out.push([hi[0], hi[1], 'H']); trend = -1; lo = [i, v]; }
    } else {
      if (v < lo[1]) lo = [i, v]; else if (v - lo[1] >= thresh) { out.push([lo[0], lo[1], 'L']); trend = 1; hi = [i, v]; }
    }
  }
  return out;
}

/** Binary search: index of the last element with time <= t (times ascending, mixed 'YYYY-MM-DD' strings or numbers). */
export function lastIdxLE(times, t) {
  let lo = 0; let hi = times.length - 1; let ans = -1;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (times[m] <= t) { ans = m; lo = m + 1; } else hi = m - 1; }
  return ans;
}
