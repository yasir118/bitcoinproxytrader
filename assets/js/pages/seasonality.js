import { render as renderSeason } from '../sections/season.js';

export async function render(root, ctx) {
  await renderSeason(root, ctx);
  const { h } = await import('../ui.js');
  root.append(h('p', { class: 'disclaimer' }, 'Seasonality describes the past, not the future. With ~6 years of bitcoin-era history, differences between months are mostly noise; treat anything not extreme as inconclusive.'));
}
