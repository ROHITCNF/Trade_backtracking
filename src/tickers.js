// Reads a comma-separated watchlist file from lists/.

const fs = require('fs');
const path = require('path');

const DEFAULT_LIST = 'fno.txt';

// 'NSE:RVNL-EQ' -> 'NSE_RVNL_EQ' (used for both cache and report filenames)
function toFileName(symbol) {
  return symbol.replace(/[^A-Za-z0-9]/g, '_');
}

function readTickers(listFile = DEFAULT_LIST) {
  const file = path.join(__dirname, '..', 'lists', listFile);
  if (!fs.existsSync(file)) throw new Error(`Watchlist not found: ${file}`);

  return [
    ...new Set(
      fs
        .readFileSync(file, 'utf8')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    ),
  ];
}

module.exports = { readTickers, toFileName, DEFAULT_LIST };
