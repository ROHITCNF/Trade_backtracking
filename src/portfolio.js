// Per-symbol rows and pooled totals across a watchlist. Shared by summary.js and
// the web worker, so a run's portfolio stats mean the same thing in both.

const { computeMetrics } = require('./metrics');
const { round, shortSymbol: short } = require('./util');

function rowFor(symbol, trades, metrics) {
  const qtys = trades.map((t) => t.quantity);
  const lo = Math.min(...qtys);
  const hi = Math.max(...qtys);
  return {
    symbol,
    trades: metrics.totalTrades,
    winRate: metrics.winRate,
    totalPnl: metrics.totalPnl,
    expectancy: metrics.expectancy,
    profitFactor: metrics.profitFactor,
    avgR: metrics.avgR,
    avgWin: metrics.avgWin,
    avgLoss: metrics.avgLoss,
    maxDrawdown: metrics.maxDrawdown,
    bestTrade: metrics.bestTrade,
    worstTrade: metrics.worstTrade,
    qtyRange: lo === hi ? String(lo) : `${lo}–${hi}`,
    avgNotional: round(trades.reduce((s, t) => s + t.notional, 0) / trades.length),
    exits: Object.entries(metrics.byReason).map(([k, v]) => `${k} ${v}`).join(' · ') || '—',
  };
}

// Pool every trade rather than averaging per-symbol averages, which would let a
// 5-trade symbol count as much as a 175-trade one.
function totalsFrom(allTrades, rows) {
  const m = computeMetrics(allTrades);
  const rawTotal = allTrades.reduce((p, t) => p + t.pnl, 0);

  const byPnl = [...rows].sort((a, b) => b.totalPnl - a.totalPnl);
  const sorted = rows.map((r) => r.totalPnl).sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;

  return {
    trades: m.totalTrades,
    winRate: m.totalTrades ? (m.wins / m.totalTrades) * 100 : 0,
    totalPnl: m.totalPnl,
    expectancy: m.expectancy,
    profitFactor: m.profitFactor,
    winners: rows.filter((r) => r.totalPnl > 0).length,
    medianPnl: round(median),
    // How concentrated the result is. A high share means one name is carrying it.
    topShare: rawTotal > 0 ? (byPnl[0].totalPnl / rawTotal) * 100 : 0,
    bestSymbol: short(byPnl[0].symbol),
    worstSymbol: short(byPnl[byPnl.length - 1].symbol),
  };
}

module.exports = { rowFor, totalsFrom };
