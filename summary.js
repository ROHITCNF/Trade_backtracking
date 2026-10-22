// Backtests a whole watchlist and writes ONE page: a sortable table with a row
// per symbol, plus aggregates across all of them. No per-ticker pages, no day
// charts — use runAll.js when you want to inspect individual trades.
//
//   node summary.js all core.txt   (npm run core)
//   node summary.js 10 final.txt
//
// Candles are stripped from the payload, so the page stays small no matter how
// many symbols you run.

const fs = require('fs');
const path = require('path');
const { loadEnv } = require('./src/env');
loadEnv();

const baseConfig = require('./config');
const { runList, parseCountAndList, printSkipped } = require('./src/run');
const { renderTemplate } = require('./src/report');
const { rowFor, totalsFrom } = require('./src/portfolio');

const USAGE =
  'Pass how many symbols to run:\n' +
  '  node summary.js all core.txt\n' +
  '  node summary.js 10 final.txt';

async function main() {
  const { listFile, symbols } = parseCountAndList(USAGE);
  console.log(`\n${symbols.length} symbols from ${listFile} · ${baseConfig.fromDate} -> ${baseConfig.toDate}\n`);

  const rows = [];
  const allTrades = [];
  const skipped = await runList(symbols, ({ config, trades, metrics }) => {
    rows.push(rowFor(config.symbol, trades, metrics));
    allTrades.push(...trades);
  });

  if (rows.length === 0) throw new Error('No symbol produced any trades.');

  const payload = { rows, totals: totalsFrom(allTrades, rows), config: baseConfig };
  const out = renderTemplate('summaryTemplate.html', payload, 'summary.html');

  const t = payload.totals;
  console.log(`\n${rows.length} symbols · ${t.trades} trades · P&L ${t.totalPnl} · ${t.winners} profitable`);
  console.log(`median symbol ${t.medianPnl} · top symbol is ${t.topShare.toFixed(0)}% of total`);
  printSkipped(skipped);
  console.log(`\n${path.relative(process.cwd(), out)}  (${(fs.statSync(out).size / 1024).toFixed(0)} KB)\n`);
}

main().catch((err) => {
  console.error('\n' + err.message);
  process.exit(1);
});
