// Everything the run dashboard shows, computed in Node from the run's trades
// with the CLI's own computeMetrics / rowFor / totalsFrom, so every number has
// one definition (NFR-1, hld § Dashboard data). Pure: trades in, numbers out.

const { computeMetrics } = require('../src/metrics');
const { rowFor, totalsFrom } = require('../src/portfolio');
const { toMinutes } = require('../src/time');
const { round } = require('../src/util');

const HIST_STEP = 0.2; // P&L % per histogram bucket, as the design shows
const SPARK_POINTS = 40;
const SMALL_SAMPLE = 30; // FR-27
const CONCENTRATED = 50; // FR-27: top symbol's % of total P&L
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const REASONS = ['TARGET', 'SL', 'EOD'];

// filters: { side, reasons: [], from, to, symbols: [] }; each optional (FR-24).
function filterTrades(trades, { side, reasons, from, to, symbols } = {}) {
  const reasonSet = reasons?.length ? new Set(reasons) : null;
  const symbolSet = symbols?.length ? new Set(symbols) : null;
  return trades.filter(
    (t) =>
      (!side || t.side === side) &&
      (!reasonSet || reasonSet.has(t.reason)) &&
      (!from || t.date >= from) &&
      (!to || t.date <= to) &&
      (!symbolSet || symbolSet.has(t.symbol))
  );
}

// The stats one breakdown row carries: computeMetrics minus the curve.
function stats(trades) {
  const m = computeMetrics(trades);
  return {
    trades: m.totalTrades,
    wins: m.wins,
    winRate: m.winRate,
    pnl: m.totalPnl,
    expectancy: m.expectancy,
    profitFactor: m.profitFactor,
    avgR: m.avgR,
  };
}

function groupBy(trades, keyOf) {
  const groups = new Map();
  for (const t of trades) {
    const k = keyOf(t);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(t);
  }
  return groups;
}

const hhmm = (minutes) => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

function breakdowns(trades, config) {
  const months = groupBy(trades, (t) => t.date.slice(0, 7));
  const month = [...months.keys()].sort().map((key) => ({ key, ...stats(months.get(key)) }));

  const days = groupBy(trades, (t) => new Date(`${t.date}T00:00:00Z`).getUTCDay());
  const weekday = [1, 2, 3, 4, 5].map((d) => ({ key: WEEKDAYS[d], ...stats(days.get(d) || []) }));

  // Hourly by entry candle; the first bucket starts at ORB end (entries can't be earlier).
  const firstEntry = toMinutes(config.orbEnd);
  const lastHour = Math.floor((toMinutes(config.sessionEnd) - 1) / 60);
  const hours = groupBy(trades, (t) => Math.floor(toMinutes(t.entryTime) / 60));
  const entryTime = [];
  for (let h = Math.floor(firstEntry / 60); h <= lastHour; h++) {
    const start = Math.max(h * 60, firstEntry);
    entryTime.push({ key: `${hhmm(start)}–${hhmm((h + 1) * 60)}`, ...stats(hours.get(h) || []) });
  }

  const reasons = groupBy(trades, (t) => t.reason);
  const reason = REASONS.map((key) => {
    const s = stats(reasons.get(key) || []);
    return { key, share: trades.length ? round((s.trades / trades.length) * 100) : 0, ...s };
  });

  const sides = groupBy(trades, (t) => t.side);
  const side = ['long', 'short'].map((key) => ({ key, ...stats(sides.get(key) || []) }));

  // P&L % histogram: contiguous buckets from the lowest to the highest trade.
  const histogram = [];
  if (trades.length) {
    const bucketOf = (t) => Math.floor(t.pnlPct / HIST_STEP + 1e-9);
    const counts = groupBy(trades, bucketOf);
    const keys = [...counts.keys()];
    for (let b = Math.min(...keys); b <= Math.max(...keys); b++) {
      histogram.push({ from: round(b * HIST_STEP), to: round((b + 1) * HIST_STEP), count: (counts.get(b) || []).length });
    }
  }

  return { month, weekday, entryTime, reason, side, histogram };
}

// Cumulative P&L after each trade, thinned to at most SPARK_POINTS values.
function sparkline(trades) {
  let equity = 0;
  const all = trades.map((t) => (equity += t.pnl));
  if (all.length <= SPARK_POINTS) return all.map(round);
  const step = (all.length - 1) / (SPARK_POINTS - 1);
  return Array.from({ length: SPARK_POINTS }, (_, i) => round(all[Math.round(i * step)]));
}

// trades: the run's trades in entry order, each with its symbol.
// symbolStatus: counts of run_symbols by status, for "22 / 39 · 1 skipped".
// nameOf(symbol): company name, or null.
function analyse(trades, { config, filters = {}, symbolStatus = {}, nameOf = () => null }) {
  const view = filterTrades(trades, filters);
  const bySymbol = groupBy(view, (t) => t.symbol);
  const rows = [...bySymbol].map(([symbol, ts]) => ({
    ...rowFor(symbol, ts, computeMetrics(ts)),
    name: nameOf(symbol),
    curve: sparkline(ts),
  }));
  rows.sort((a, b) => b.totalPnl - a.totalPnl);

  const portfolio = rows.length ? totalsFrom(view, rows) : null;
  return {
    filters,
    count: view.length,
    totalCount: trades.length,
    metrics: computeMetrics(view),
    portfolio: portfolio && { ...portfolio, symbolsTraded: rows.length, symbols: symbolStatus },
    breakdowns: breakdowns(view, config),
    symbols: rows,
    warnings: {
      smallSample: view.length < SMALL_SAMPLE,
      concentrated: Boolean(portfolio && portfolio.topShare > CONCENTRATED),
    },
  };
}

module.exports = { analyse, filterTrades, breakdowns, sparkline, stats };
