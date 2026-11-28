// Shared option charts (Chart.js): strike bars with spot / flip markers, expiry table.
import { num, pct, pctP, usd, usdc, compact, int, dateShort, date, signCls, isNum } from '../util.js';
import { h, table, badge } from '../ui.js';
import { cjs, axis, tip, C } from '../charts.js';

/** vertical marker lines on a category axis whose labels are strikes */
export const markerLines = (labels, lines) => ({
  id: 'markerLines',
  afterDatasetsDraw(chart) {
    const x = chart.scales.x; if (!x) return;
    const ks = labels.map(Number); const { ctx, chartArea } = chart;
    lines.filter((l) => isNum(l.value)).forEach((l) => {
      let i = ks.findIndex((k) => k >= l.value);
      let idx;
      if (i === -1) idx = ks.length - 1; else if (i === 0) idx = 0; else idx = i - 1 + (l.value - ks[i - 1]) / (ks[i] - ks[i - 1]);
      const px = x.getPixelForValue(idx);
      ctx.save(); ctx.setLineDash(l.dash || [5, 4]); ctx.strokeStyle = l.color; ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.moveTo(px, chartArea.top); ctx.lineTo(px, chartArea.bottom); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = l.color; ctx.font = '600 11px Inter Tight, sans-serif'; ctx.textAlign = 'center';
      ctx.fillText(l.label, Math.min(Math.max(px, chartArea.left + 28), chartArea.right - 28), chartArea.top - 5 - (l.row || 0) * 12);
      ctx.restore();
    });
  },
});

export function trimStrikes(strikes, spot, lo = 0.55, hi = 1.6) {
  return strikes.filter((s) => s.k >= spot * lo && s.k <= spot * hi);
}

/** Calls up / puts down bars of OI (or volume) per strike. mode: 'oi' | 'vol' | 'chg' | 'gex' */
export function strikeChart(el, strikes, spot, mode, extraLines = []) {
  const labels = strikes.map((s) => String(s.k));
  const lines = [{ value: spot, color: C.ink, label: `Spot ${spot.toFixed(2)}` }, ...extraLines];
  let datasets;
  if (mode === 'gex') {
    datasets = [{ label: 'Net GEX ($ per 1% move)', data: strikes.map((s) => s.gex), backgroundColor: strikes.map((s) => (s.gex >= 0 ? C.accent : C.ink)), borderRadius: 4, maxBarThickness: 18 }];
  } else {
    const [cc, pc] = mode === 'vol' ? ['cv', 'pv'] : mode === 'chg' ? ['dcoi', 'dpoi'] : ['coi', 'poi'];
    datasets = [
      { label: mode === 'vol' ? 'Call volume' : mode === 'chg' ? 'Call OI change' : 'Call OI', data: strikes.map((s) => s[cc]), backgroundColor: C.accent, borderRadius: 4, stack: 's', maxBarThickness: 18 },
      { label: mode === 'vol' ? 'Put volume' : mode === 'chg' ? 'Put OI change' : 'Put OI', data: strikes.map((s) => (s[pc] == null ? null : -s[pc])), backgroundColor: C.ink, borderRadius: 4, stack: 's', maxBarThickness: 18 },
    ];
  }
  return cjs(el, { type: 'bar', data: { labels, datasets }, plugins: [markerLines(labels, lines)],
    options: { layout: { padding: { top: 14 + 12 * Math.max(0, ...lines.map((l) => l.row || 0)) } }, plugins: { legend: { display: mode !== 'gex', position: 'bottom', labels: { boxWidth: 10, usePointStyle: true } },
      tooltip: tip({ callbacks: { title: (it) => `Strike ${it[0].label}`, label: (c) => `${c.dataset.label}: ${compact(Math.abs(c.parsed.y), 1)}${mode === 'gex' && c.parsed.y < 0 ? ' (short gamma)' : ''}` } }) },
      scales: { x: axis({ grid: { display: false }, ticks: { maxTicksLimit: 14, autoSkip: true, callback(v) { return labels[v]; } } }),
        y: axis({ stacked: true, ticks: { callback: (v) => (mode === 'gex' ? usdc(v, 0) : compact(Math.abs(v), 0)) } }) } } });
}

export function expiryTable(expiries, spot, onPick, selected) {
  const rows = expiries.map((e) => ({ ...e, pc: e.call_oi ? e.put_oi / e.call_oi : null }));
  return table([
    { k: 'expiry', label: 'Expiry', fmt: (v) => h('b', null, dateShort(v) + ' ’' + v.slice(2, 4)) },
    { k: 'dte', label: 'DTE' },
    { k: 'call_oi', label: 'Call OI', fmt: (v) => compact(v, 1) }, { k: 'put_oi', label: 'Put OI', fmt: (v) => compact(v, 1) },
    { k: 'pc', label: 'P/C OI', fmt: (v) => (isNum(v) ? v.toFixed(2) : '—'), cls: (v) => (isNum(v) ? (v > 1.2 ? 'neg' : v < 0.8 ? 'pos' : '') : '') },
    { k: 'call_vol', label: 'Call vol', fmt: (v) => compact(v, 1) }, { k: 'put_vol', label: 'Put vol', fmt: (v) => compact(v, 1) },
    { k: 'atm_iv', label: 'ATM IV', fmt: (v) => (isNum(v) ? `${(v * 100).toFixed(1)}%` : '—') },
    { k: 'exp_move', label: '±1σ move', fmt: (v, r) => (isNum(v) ? `${v.toFixed(1)}% · ±${usd(spot * v / 100, 0)}` : '—') },
    { k: 'max_pain', label: 'Max pain', fmt: (v, r) => (isNum(v) ? h('span', null, usd(v, v % 1 ? 2 : 0), ' ', h('span', { class: `small ${signCls(v - spot)}` }, pct(v / spot - 1, 0))) : '—') },
    { k: 'skew25', label: '25Δ skew', fmt: (v) => (isNum(v) ? `${(v * 100).toFixed(1)}` : '—') },
    { k: 'gex', label: 'Net GEX', fmt: (v) => (isNum(v) ? h('span', { class: signCls(v) }, usdc(v, 1)) : '—') },
  ], rows, { onRow: onPick, rowCls: (r) => (r.expiry === selected ? 'cur' : '') });
}
