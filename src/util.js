// Small helpers used across the backtest and the live runner.

const round = (n) => Math.round(n * 100) / 100;

// 'NSE:RVNL-EQ' -> 'RVNL'
const shortSymbol = (s) => s.replace(/^NSE:|-EQ$/g, '');

module.exports = { round, shortSymbol };
