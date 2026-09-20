// Backtests a watchlist and writes one report page per ticker, each carrying a
// dropdown that navigates to the others.
//
//   node runAll.js 5                      first 5 of _F&O.txt
//   node runAll.js all                    all of _F&O.txt
//   node runAll.js all _final_list.txt    a different list  (npm run final)
//
// Requires config.singleTickerOnly to be false, and requires the count to be
// spelled out — _F&O.txt is 207 symbols, ~1,000 API calls and ~600 MB of cache,
// so it should never be something you kick off by accident.
//
// Candles are cached per symbol, so a run that dies partway resumes for free.

const { loadEnv } = require('./src/env');
loadEnv();

const baseConfig = require('./config');
const { readTickers, toFileName, DEFAULT_LIST } = require('./src/tickers');
const { getCandles } = require('./src/fetch');
const { runBacktest } = require('./src/engine');
const { computeMetrics } = require('./src/metrics');
const { writeReport } = require('./src/report');
const { writeTradeLog } = require('./src/tradeLog');
const { getLastPrices } = require('./src/quotes');

const FETCH_DELAY_MS = 150;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function backtestOne(symbol, ltp) {
  const config = { ...baseConfig, symbol, ltp };
  const candles = await getCandles(config);
  const trades = runBacktest(candles, config);
  return { config, trades, metrics: computeMetrics(trades) };
}

function parseLimit() {
  const arg = process.argv[2];
  if (!arg) {
    throw new Error(
      'Pass how many tickers to run:\n' +
        '  node runAll.js 5                     first 5 of _F&O.txt\n' +
        '  node runAll.js all                   all of _F&O.txt (~1,000 API calls, ~600 MB)\n' +
        '  node runAll.js all _final_list.txt   a different list  (npm run final)\n\n' +
        'For a single ticker use `npm start`, which reads config.symbol.'
    );
  }
  if (arg === 'all') return Infinity;

  const n = Number(arg);
  if (!Number.isInteger(n) || n < 1) throw new Error(`Not a valid ticker count: "${arg}"`);
  return n;
}

async function main() {
  if (baseConfig.singleTickerOnly) {
    throw new Error(
      'config.singleTickerOnly is true, so multi-ticker runs are blocked.\n' +
        `Use \`npm start\` to test ${baseConfig.symbol} on its own,\n` +
        'or set singleTickerOnly: false in config.js to run the watchlist.'
    );
  }

  const limit = parseLimit();
  const listFile = process.argv[3] || DEFAULT_LIST;
  const symbols = readTickers(listFile).slice(0, limit);
  console.log(`\n${symbols.length} tickers from ${listFile} · ${baseConfig.fromDate} -> ${baseConfig.toDate}\n`);

  // One quotes call up front rather than one per symbol.
  const prices = baseConfig.sizing === 'ltp' ? await getLastPrices(symbols) : new Map();
  if (prices.size) console.log(`Fetched ${prices.size} live prices for sizing.\n`);

  // Pass 1: fetch and backtest to find out which symbols actually have usable data.
  const ok = [];
  const failed = [];

  for (const [i, symbol] of symbols.entries()) {
    const tag = `[${i + 1}/${symbols.length}] ${symbol}`;
    try {
      const { metrics } = await backtestOne(symbol, prices.get(symbol));
      if (metrics.totalTrades === 0) {
        failed.push({ symbol, reason: 'no trades' });
        console.log(`${tag} — no trades, skipped`);
      } else {
        ok.push(symbol);
        console.log(`${tag} — ${metrics.totalTrades} trades, P&L ${metrics.totalPnl}`);
      }
    } catch (err) {
      failed.push({ symbol, reason: err.message });
      console.log(`${tag} — FAILED: ${err.message}`);
    }
    await sleep(FETCH_DELAY_MS);
  }

  if (ok.length === 0) throw new Error('No ticker produced any trades.');

  // Pass 2: now that the dropdown list is known, write the pages. Candles are all
  // cached by this point, so this pass does no network work.
  const tickers = ok.map((symbol) => ({ symbol, file: toFileName(symbol) + '.html' }));

  console.log(`\nWriting ${tickers.length} pages...`);
  for (const { symbol, file } of tickers) {
    const { config, trades, metrics } = await backtestOne(symbol, prices.get(symbol));
    writeTradeLog(trades, metrics, config);
    writeReport(trades, metrics, config, { tickers, fileName: file });
  }

  console.log(`\nDone. ${ok.length} reports in out/`);
  if (failed.length) {
    console.log(`Skipped ${failed.length}: ${failed.map((f) => `${f.symbol} (${f.reason})`).join(', ')}`);
  }
  console.log(`Open: out/${tickers[0].file}\n`);
}

main().catch((err) => {
  console.error('\n' + err.message);
  process.exit(1);
});
