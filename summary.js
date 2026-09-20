// Backtests a whole watchlist and writes ONE page: a sortable table with a row
// per symbol, plus aggregates across all of them. No per-ticker pages, no day
// charts — use runAll.js when you want to inspect individual trades.
//
//   node summary.js all _ORB_BRERAKOUT_CORE.txt    (npm run core)
//   node summary.js 10 _final_list.txt
//
// Candles are stripped from the payload, so the page stays small no matter how
// many symbols you run. Anything already cached is reused.

const fs = require('fs');
const path = require('path');
const { loadEnv } = require('./src/env');
loadEnv();

const baseConfig = require('./config');
const { readTickers, DEFAULT_LIST } = require('./src/tickers');
const { getCandles } = require('./src/fetch');
const { runBacktest } = require('./src/engine');
const { computeMetrics } = require('./src/metrics');
const { getLastPrices } = require('./src/quotes');

const OUT = path.join(__dirname, 'out', 'summary.html');
const FETCH_DELAY_MS = 150;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const round = (n) => Math.round(n * 100) / 100;

function parseLimit() {
  const arg = process.argv[2];
  if (!arg) {
    throw new Error(
      'Pass how many symbols to run:\n' +
        '  node summary.js all _ORB_BRERAKOUT_CORE.txt\n' +
        '  node summary.js 10 _final_list.txt'
    );
  }
  if (arg === 'all') return Infinity;
  const n = Number(arg);
  if (!Number.isInteger(n) || n < 1) throw new Error(`Not a valid count: "${arg}"`);
  return n;
}

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
  const wins = allTrades.filter((t) => t.pnl > 0);
  const grossProfit = wins.reduce((p, t) => p + t.pnl, 0);
  const grossLoss = Math.abs(allTrades.filter((t) => t.pnl <= 0).reduce((p, t) => p + t.pnl, 0));
  const totalPnl = allTrades.reduce((p, t) => p + t.pnl, 0);

  const byPnl = [...rows].sort((a, b) => b.totalPnl - a.totalPnl);
  const sorted = rows.map((r) => r.totalPnl).sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  const short = (s) => s.replace(/^NSE:|-EQ$/g, '');

  return {
    trades: allTrades.length,
    winRate: allTrades.length ? (wins.length / allTrades.length) * 100 : 0,
    totalPnl: round(totalPnl),
    expectancy: allTrades.length ? round(totalPnl / allTrades.length) : 0,
    profitFactor: grossLoss > 0 ? round(grossProfit / grossLoss) : null,
    winners: rows.filter((r) => r.totalPnl > 0).length,
    medianPnl: round(median),
    // How concentrated the result is. A high share means one name is carrying it.
    topShare: totalPnl > 0 ? (byPnl[0].totalPnl / totalPnl) * 100 : 0,
    bestSymbol: short(byPnl[0].symbol),
    worstSymbol: short(byPnl[byPnl.length - 1].symbol),
  };
}

async function main() {
  const limit = parseLimit();
  const listFile = process.argv[3] || DEFAULT_LIST;
  const symbols = readTickers(listFile).slice(0, limit);

  console.log(`\n${symbols.length} symbols from ${listFile} · ${baseConfig.fromDate} -> ${baseConfig.toDate}\n`);

  const prices = baseConfig.sizing === 'ltp' ? await getLastPrices(symbols) : new Map();

  const rows = [];
  const allTrades = [];
  const skipped = [];

  for (const [i, symbol] of symbols.entries()) {
    const tag = `[${i + 1}/${symbols.length}] ${symbol}`;
    try {
      const config = { ...baseConfig, symbol, ltp: prices.get(symbol) };
      const trades = runBacktest(await getCandles(config), config);
      if (trades.length === 0) {
        skipped.push(`${symbol} (no trades)`);
        console.log(`${tag} — no trades`);
        continue;
      }
      const metrics = computeMetrics(trades);
      rows.push(rowFor(symbol, trades, metrics));
      allTrades.push(...trades);
      console.log(`${tag} — ${metrics.totalTrades} trades  P&L ${metrics.totalPnl}`);
    } catch (err) {
      skipped.push(`${symbol} (${err.message.split('\n')[0]})`);
      console.log(`${tag} — FAILED: ${err.message.split('\n')[0]}`);
    }
    await sleep(FETCH_DELAY_MS);
  }

  if (rows.length === 0) throw new Error('No symbol produced any trades.');

  const payload = { rows, totals: totalsFrom(allTrades, rows), config: baseConfig };
  const template = fs.readFileSync(path.join(__dirname, 'src', 'summaryTemplate.html'), 'utf8');
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, template.replace('__DATA__', JSON.stringify(payload).replace(/</g, '\\u003c')));

  const t = payload.totals;
  console.log(`\n${rows.length} symbols · ${t.trades} trades · P&L ${t.totalPnl} · ${t.winners} profitable`);
  console.log(`median symbol ${t.medianPnl} · top symbol is ${t.topShare.toFixed(0)}% of total`);
  if (skipped.length) console.log(`skipped ${skipped.length}: ${skipped.slice(0, 6).join(', ')}${skipped.length > 6 ? ' …' : ''}`);
  console.log(`\n${path.relative(process.cwd(), OUT)}  (${(fs.statSync(OUT).size / 1024).toFixed(0)} KB)\n`);
}

main().catch((err) => {
  console.error('\n' + err.message);
  process.exit(1);
});
