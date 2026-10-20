// Runs the same candles through several profit-target rules and prints a comparison.
// Point is to let the data pick the target instead of guessing one.
//
//   npm run sweep

const { loadEnv } = require('./src/env');
loadEnv();

const baseConfig = require('./config');
const { getCandles } = require('./src/fetch');
const { runBacktest } = require('./src/engine');
const { computeMetrics } = require('./src/metrics');

// R here means "multiples of the stop distance", whatever config.slMode makes that.
const VARIANTS = [
  { label: 'no target (EOD)', targetMode: 'none' },
  { label: '0.5R', targetMode: 'R', targetR: 0.5 },
  { label: '1R', targetMode: 'R', targetR: 1 },
  { label: '1.5R', targetMode: 'R', targetR: 1.5 },
  { label: '2R', targetMode: 'R', targetR: 2 },
  { label: '3R', targetMode: 'R', targetR: 3 },
  { label: 'fixed 1%', targetMode: 'pct', targetPct: 1 },
  { label: 'fixed 2%', targetMode: 'pct', targetPct: 2 },
  { label: 'fixed 2.5%', targetMode: 'pct', targetPct: 2.5 },
];

async function main() {
  const candles = await getCandles(baseConfig);
  const pct = `${baseConfig.slPct}% of entry`;
  const stopRule = {
    pct,
    range: 'opposite range edge',
    tighter: `tighter of ${pct} / range edge`,
    wider: `wider of ${pct} / range edge`,
  }[baseConfig.slMode];
  console.log(`\n${baseConfig.symbol}  ${baseConfig.fromDate} -> ${baseConfig.toDate}  (${candles.length} candles)`);
  console.log(`direction: ${baseConfig.direction}   stop: ${stopRule}   (only the target varies below)\n`);

  const rows = VARIANTS.map(({ label, ...overrides }) => {
    const metrics = computeMetrics(runBacktest(candles, { ...baseConfig, ...overrides }));
    return {
      target: label,
      trades: metrics.totalTrades,
      'win%': metrics.winRate,
      'P&L': metrics.totalPnl,
      'exp/trade': metrics.expectancy,
      avgR: metrics.avgR,
      PF: metrics.profitFactor ?? '—',
      maxDD: metrics.maxDrawdown,
      exits: Object.entries(metrics.byReason).map(([k, v]) => `${k[0]}${v}`).join(' '),
    };
  });

  console.table(rows);

  const best = rows.reduce((a, b) => (b['exp/trade'] > a['exp/trade'] ? b : a));
  console.log(`Best expectancy: ${best.target} (${best['exp/trade']} per trade)`);
  console.log('Small samples move this ranking around — widen the date range before trusting it.\n');
}

main().catch((err) => {
  console.error('\n' + err.message);
  process.exit(1);
});
