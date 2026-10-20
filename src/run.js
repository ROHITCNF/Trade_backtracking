// Plumbing shared by the entry scripts: one symbol in, trades + metrics out,
// and the loop that runs a whole watchlist.

const baseConfig = require('../config');
const { getCandles } = require('./fetch');
const { runBacktest } = require('./engine');
const { computeMetrics } = require('./metrics');
const { readTickers, DEFAULT_LIST } = require('./tickers');

async function backtestSymbol(symbol, overrides = {}) {
  const config = { ...baseConfig, symbol, ...overrides };
  const trades = runBacktest(await getCandles(config), config);
  return { config, trades, metrics: computeMetrics(trades) };
}

// Backtests each symbol in order and hands the ones with trades to onResult.
// Symbols with no trades or a failed fetch are skipped; returns why, per symbol.
async function runList(symbols, onResult) {
  const skipped = [];
  for (const [i, symbol] of symbols.entries()) {
    const tag = `[${i + 1}/${symbols.length}] ${symbol}`;
    try {
      const result = await backtestSymbol(symbol);
      if (result.trades.length === 0) {
        skipped.push(`${symbol} (no trades)`);
        console.log(`${tag} — no trades, skipped`);
        continue;
      }
      onResult(result);
      console.log(`${tag} — ${result.metrics.totalTrades} trades, P&L ${result.metrics.totalPnl}`);
    } catch (err) {
      const reason = err.message.split('\n')[0];
      skipped.push(`${symbol} (${reason})`);
      console.log(`${tag} — FAILED: ${reason}`);
    }
  }
  return skipped;
}

// argv: <count|all> [listFile]. The count is required so a 207-symbol run is
// never something you start by accident.
function parseCountAndList(usage) {
  const [arg, listFile = DEFAULT_LIST] = process.argv.slice(2);
  if (!arg) throw new Error(usage);

  const limit = arg === 'all' ? Infinity : Number(arg);
  if (limit !== Infinity && (!Number.isInteger(limit) || limit < 1)) {
    throw new Error(`Not a valid count: "${arg}"`);
  }
  return { listFile, symbols: readTickers(listFile).slice(0, limit) };
}

function printSkipped(skipped) {
  if (!skipped.length) return;
  console.log(`Skipped ${skipped.length}: ${skipped.slice(0, 10).join(', ')}${skipped.length > 10 ? ' …' : ''}`);
}

module.exports = { backtestSymbol, runList, parseCountAndList, printSkipped };
