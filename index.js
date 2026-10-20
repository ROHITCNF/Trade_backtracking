// Entry point: fetch (or reuse cached) candles -> backtest -> metrics -> HTML report.

const path = require('path');
const { loadEnv } = require('./src/env');
loadEnv();

const config = require('./config');
const { getCandles } = require('./src/fetch');
const { runBacktest } = require('./src/engine');
const { computeMetrics } = require('./src/metrics');
const { writeReport } = require('./src/report');
const { writeTradeLog } = require('./src/tradeLog');

async function main() {
  const candles = await getCandles(config);
  console.log(`Loaded ${candles.length} candles.`);

  const trades = runBacktest(candles, config);
  const metrics = computeMetrics(trades);

  console.log(
    `${metrics.totalTrades} trades · ${metrics.winRate}% win rate · ` +
      `P&L ${metrics.totalPnl} · max DD ${metrics.maxDrawdown}`
  );

  const { jsonFile, csvFile } = writeTradeLog(trades, metrics, config);
  console.log(`Trades: ${path.relative(process.cwd(), jsonFile)}`);
  console.log(`        ${path.relative(process.cwd(), csvFile)}`);

  const file = writeReport(trades, metrics, config);
  console.log(`Report: ${path.relative(process.cwd(), file)}  (open it in a browser)`);
}

main().catch((err) => {
  console.error('\n' + err.message);
  process.exit(1);
});
