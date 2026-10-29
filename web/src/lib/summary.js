// How a set of trades is summed up in words and simple bars, shared by the
// Research results and the Journal day (v2 references). Pure: analysis in,
// display rows out.

import { pnl } from './format.js';

// "Made ₹75,632 on 4,738 trades. Shorts +₹45,127, longs +₹30,505. 38% hit the
// stop, 25% the target." as parts, so the amounts can be coloured. Each part is
// { text } or { text, tone }.
export function narrative({ metrics, breakdowns }) {
  const m = metrics;
  if (!m.totalTrades) return [{ text: 'No trades.' }];
  const amount = pnl(m.totalPnl).replace(/^[+−]/, '');
  const verb = m.totalPnl > 0 ? 'Made' : m.totalPnl < 0 ? 'Lost' : 'Broke even';
  const parts = [
    { text: verb === 'Broke even' ? 'Broke even' : `${verb} ` },
    ...(verb === 'Broke even' ? [] : [{ text: amount, tone: m.totalPnl > 0 ? 'profit' : 'loss' }]),
    { text: ` on ${m.totalTrades.toLocaleString('en-IN')} trade${m.totalTrades === 1 ? '' : 's'}.` },
  ];

  const sides = breakdowns.side.filter((s) => s.trades > 0).sort((a, b) => b.pnl - a.pnl);
  if (sides.length === 2) {
    const name = (s, first) => `${first ? (s.key === 'long' ? 'Longs' : 'Shorts') : s.key === 'long' ? 'longs' : 'shorts'} `;
    parts.push({ text: ` ${name(sides[0], true)}` }, { text: pnl(sides[0].pnl), tone: tone(sides[0].pnl) },
      { text: `, ${name(sides[1], false)}` }, { text: pnl(sides[1].pnl), tone: tone(sides[1].pnl) }, { text: '.' });
  } else if (sides.length === 1) {
    parts.push({ text: ` All ${sides[0].key === 'long' ? 'longs' : 'shorts'}.` });
  }

  const share = Object.fromEntries(breakdowns.reason.map((r) => [r.key, Math.round(r.share)]));
  parts.push({ text: ` ${share.SL ?? 0}% hit the stop, ${share.TARGET ?? 0}% the target.` });
  return parts;
}

const tone = (n) => (n > 0 ? 'profit' : n < 0 ? 'loss' : 'flat');

// The per-trade equity curve collapsed to one point per day (its last), so a
// chart steps once a day however many trades the day had.
export function dailyCurve(curve) {
  const out = [];
  for (const p of curve) {
    if (out.length && out.at(-1).date === p.date) out[out.length - 1] = p;
    else out.push(p);
  }
  return out;
}

// Days with at least one trade.
export const tradingDays = (curve) => new Set(curve.map((p) => p.date)).size;

// Long vs short rows with a bar that grows from the middle: right for profit,
// left for loss, scaled to the larger side. width is 0–50 (% of the track).
export function sideBars(sides) {
  const max = Math.max(...sides.map((s) => Math.abs(s.pnl)), 0) || 1;
  return sides.map((s) => ({ ...s, width: Math.round((Math.abs(s.pnl) / max) * 500) / 10, dir: s.pnl < 0 ? 'left' : 'right' }));
}
