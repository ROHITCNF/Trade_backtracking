// Turns a list of trades into the numbers you actually judge the strategy by.

const { round } = require('./util');
const sum = (nums) => nums.reduce((a, b) => a + b, 0);
const avg = (nums) => (nums.length ? sum(nums) / nums.length : 0);

function computeMetrics(trades) {
  const wins = trades.filter((t) => t.pnl > 0);
  const losses = trades.filter((t) => t.pnl <= 0);

  const grossProfit = sum(wins.map((t) => t.pnl));
  const grossLoss = Math.abs(sum(losses.map((t) => t.pnl)));

  // Equity curve, plus the deepest peak-to-trough dip along the way.
  let equity = 0;
  let peak = 0;
  let maxDrawdown = 0;
  const curve = [];
  for (const t of trades) {
    equity += t.pnl;
    peak = Math.max(peak, equity);
    maxDrawdown = Math.max(maxDrawdown, peak - equity);
    curve.push({ date: t.date, equity: round(equity) });
  }

  const byReason = {};
  for (const t of trades) byReason[t.reason] = (byReason[t.reason] || 0) + 1;

  return {
    totalTrades: trades.length,
    wins: wins.length,
    losses: losses.length,
    winRate: trades.length ? round((wins.length / trades.length) * 100) : 0,
    totalPnl: round(equity),
    avgWin: round(avg(wins.map((t) => t.pnl))),
    avgLoss: round(avg(losses.map((t) => t.pnl))),
    expectancy: round(avg(trades.map((t) => t.pnl))),
    profitFactor: grossLoss > 0 ? round(grossProfit / grossLoss) : null,
    avgR: round(avg(trades.map((t) => t.rMultiple))),
    maxDrawdown: round(maxDrawdown),
    bestTrade: trades.length ? round(Math.max(...trades.map((t) => t.pnl))) : 0,
    worstTrade: trades.length ? round(Math.min(...trades.map((t) => t.pnl))) : 0,
    byReason,
    curve,
  };
}

module.exports = { computeMetrics };
