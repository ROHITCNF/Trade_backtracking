// Small helpers used across the backtest and the live runner.

// `|| 0` folds -0 into 0: Math.round(-0.4) is -0, which JSON and Postgres store
// as 0, so a stored trade would never deep-equal the engine's (test/parity.test.js).
const round = (n) => Math.round(n * 100) / 100 || 0;

// 'NSE:RVNL-EQ' -> 'RVNL'
const shortSymbol = (s) => s.replace(/^NSE:|-EQ$/g, '');

module.exports = { round, shortSymbol };
