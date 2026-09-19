// Dumps every trade to data/trades/ so runs can be inspected without the HTML report.
// Day candles are stripped — they're 98% of the payload and useless for reading trades.

const fs = require('fs');
const path = require('path');
const { toFileName } = require('./tickers');

const TRADES_DIR = path.join(__dirname, '..', 'data', 'trades');

const COLUMNS = [
  'date', 'side', 'entryTime', 'entry', 'sl', 'target',
  'exitTime', 'exit', 'reason', 'pnl', 'pnlPct', 'rMultiple',
];

function toCsv(trades) {
  const rows = trades.map((t) => COLUMNS.map((c) => (t[c] === null ? '' : t[c])).join(','));
  return [COLUMNS.join(','), ...rows].join('\n') + '\n';
}

// Returns the paths written, newest run overwriting the previous one for that symbol.
function writeTradeLog(trades, metrics, config) {
  fs.mkdirSync(TRADES_DIR, { recursive: true });

  const base = path.join(TRADES_DIR, toFileName(config.symbol));
  const slim = trades.map(({ candles, ...rest }) => rest);

  const jsonFile = `${base}.json`;
  const csvFile = `${base}.csv`;

  fs.writeFileSync(
    jsonFile,
    JSON.stringify({ symbol: config.symbol, generatedAt: new Date().toISOString(), config, metrics, trades: slim }, null, 2)
  );
  fs.writeFileSync(csvFile, toCsv(slim));

  return { jsonFile, csvFile };
}

module.exports = { writeTradeLog };
