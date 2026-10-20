// Backtests a whole watchlist and writes ONE page: a sortable table with a row
// per symbol, plus aggregates across all of them. No per-ticker pages, no day
// charts — use runAll.js when you want to inspect individual trades.
//
//   node summary.js all _ORB_BRERAKOUT_CORE.txt    (npm run core)
//   node summary.js 10 _final_list.txt
//
// Candles are stripped from the payload, so the page stays small no matter how
// many symbols you run.

const fs = require('fs');
const path = require('path');
const { loadEnv } = require('./src/env');
loadEnv();

const baseConfig = require('./config');
const { computeMetrics } = require('./src/metrics');
const { runList, parseCountAndList, printSkipped } = require('./src/run');
const { renderTemplate } = require('./src/report');

const round = (n) => Math.round(n * 100) / 100;

const USAGE =
  'Pass how many symbols to run:\n' +
  '  node summary.js all _ORB_BRERAKOUT_CORE.txt\n' +
  '  node summary.js 10 _final_list.txt';

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
  const short = (s) => s.replace(/^NSE:|-EQ$/g, '');

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
