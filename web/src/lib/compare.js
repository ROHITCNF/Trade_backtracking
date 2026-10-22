// Comparison logic for the Compare and Sweep screens, kept pure for tests.

import { dateShort, pnl, profitFactor, qty, rate, rMultiple, rupees } from './format.js';
import { stopLabel, targetLabel } from './runs.js';

const DIRECTION = { long: 'Long', short: 'Short', both: 'Both' };
const cap = (s) => s.replace(/^\w/, (x) => x.toUpperCase());

// Settings as the owner reads them; rows where every run agrees are "identical".
export function settingRows(runs) {
  const fields = [
    ['Dates', (r) => `${dateShort(r.fromDate)} → ${dateShort(r.toDate)}`],
    ['Symbols', (r) => (r.watchlistName ? `${r.watchlistName} – ${r.total}` : `${r.total} picked`)],
    ['Direction', (r) => DIRECTION[r.config.direction]],
    ['Opening range', (r) => `${r.config.orbStart}–${r.config.orbEnd}`],
    ['Session end', (r) => r.config.sessionEnd],
    ['Stop', (r) => cap(stopLabel(r.config).replace(/^SL /, ''))],
    ['Target', (r) => cap(targetLabel(r.config).replace(/^TGT /, ''))],
    ['Sizing', (r) => (r.config.sizing === 'fixed' ? `${r.config.quantity} shares` : `${rupees(r.config.capitalPerTrade)} × ${r.config.leverage}x`)],
    ['Costs', (r) => `${r.config.costBps} bps`],
  ];
  return fields.map(([label, get]) => {
    const values = runs.map(get);
    return { label, values, same: values.every((v) => v === values[0]) };
  });
}

// Metric rows: [label, get, format, better] — better is 'max', 'min' or null.
// Profit factor null means no losers (∞), which beats any number.
export const METRIC_ROWS = [
  ['Trades', (m) => m.totalTrades, qty, null],
  ['Win rate', (m) => m.winRate, rate, 'max'],
  ['Total P&L', (m) => m.totalPnl, pnl, 'max', true],
  ['Expectancy / trade', (m) => m.expectancy, pnl, 'max', true],
  ['Profit factor', (m) => (m.profitFactor === null ? Infinity : m.profitFactor), (v) => profitFactor(v === Infinity ? null : v), 'max'],
  ['Avg R', (m) => m.avgR, rMultiple, 'max', true],
  ['Avg win', (m) => m.avgWin, pnl, 'max', true],
  ['Avg loss', (m) => m.avgLoss, pnl, 'max', true],
  ['Max drawdown', (m) => -m.maxDrawdown, pnl, 'max', true],
  ['Best trade', (m) => m.bestTrade, pnl, null, true],
  ['Worst trade', (m) => m.worstTrade, pnl, null, true],
];

// Index of the best value, or -1 when there is nothing to pick (one run, a
// tie for first, or a row without a "better").
export function bestIndex(values, better) {
  if (!better || values.length < 2) return -1;
  const target = better === 'max' ? Math.max(...values) : Math.min(...values);
  const hits = values.filter((v) => v === target).length;
  return hits === 1 ? values.indexOf(target) : -1;
}

// A sweep variant's rule: "1.5R", "2%", "None".
export function ruleLabel(config) {
  if (config.targetMode === 'none') return 'None';
  return config.targetMode === 'R' ? `${config.targetR}R` : `${config.targetPct}%`;
}

// Per-ticker rows across runs: { symbol, cells: [{pnl, trades} | null], spread },
// sorted by the first run's P&L (symbols it lacks go last).
export function tickerRows(runs) {
  const symbols = new Set(runs.flatMap((r) => Object.keys(r.bySymbol)));
  const rows = [...symbols].map((symbol) => {
    const cells = runs.map((r) => r.bySymbol[symbol] || null);
    const present = cells.filter(Boolean).map((c) => c.pnl);
    return { symbol, cells, spread: present.length > 1 ? Math.max(...present) - Math.min(...present) : null };
  });
  const key = (r) => (r.cells[0] ? r.cells[0].pnl : -Infinity);
  return rows.sort((a, b) => key(b) - key(a) || a.symbol.localeCompare(b.symbol));
}
