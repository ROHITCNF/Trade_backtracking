// Backtests a watchlist and writes one report page per ticker, each carrying a
// dropdown that navigates to the others.
//
//   node runAll.js 5                      first 5 of _F&O.txt
//   node runAll.js all                    all of _F&O.txt
//   node runAll.js all _final_list.txt    a different list  (npm run final)
//
// Pages are written as each symbol finishes; the dropdown list is written last
// to out/tickers.js, which every page loads, so it only ever names pages that exist.

const fs = require('fs');
const path = require('path');
const { loadEnv } = require('./src/env');
loadEnv();

const baseConfig = require('./config');
const { toFileName } = require('./src/tickers');
const { runList, parseCountAndList, printSkipped } = require('./src/run');
const { writeReport, OUT_DIR } = require('./src/report');
const { writeTradeLog } = require('./src/tradeLog');

const USAGE =
  'Pass how many tickers to run:\n' +
  '  node runAll.js 5                     first 5 of _F&O.txt\n' +
  '  node runAll.js all                   all of _F&O.txt (~1,400 API calls for a year, ~8 min)\n' +
  '  node runAll.js all _final_list.txt   a different list  (npm run final)\n\n' +
  'For a single ticker use `npm start`, which reads config.symbol.';

async function main() {
  const { listFile, symbols } = parseCountAndList(USAGE);
  console.log(`\n${symbols.length} tickers from ${listFile} · ${baseConfig.fromDate} -> ${baseConfig.toDate}\n`);

  const tickers = [];
  const skipped = await runList(symbols, ({ config, trades, metrics }) => {
    const file = toFileName(config.symbol) + '.html';
    writeTradeLog(trades, metrics, config);
    writeReport(trades, metrics, config, { fileName: file, withTickerList: true });
    tickers.push({ symbol: config.symbol, file });
  });

  if (tickers.length === 0) throw new Error('No ticker produced any trades.');
  fs.writeFileSync(path.join(OUT_DIR, 'tickers.js'), `window.TICKERS = ${JSON.stringify(tickers)};\n`);

  console.log(`\nDone. ${tickers.length} reports in out/`);
  printSkipped(skipped);
  console.log(`Open: out/${tickers[0].file}\n`);
}

main().catch((err) => {
  console.error('\n' + err.message);
  process.exit(1);
});
