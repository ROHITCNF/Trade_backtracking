// Reads the comma-separated watchlist in _F&O.txt.

const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', '_F&O.txt');

// 'NSE:RVNL-EQ' -> 'NSE_RVNL_EQ' (used for both cache and report filenames)
function toFileName(symbol) {
  return symbol.replace(/[^A-Za-z0-9]/g, '_');
}

function readTickers() {
  if (!fs.existsSync(FILE)) throw new Error(`Watchlist not found: ${FILE}`);

  return [
    ...new Set(
      fs
        .readFileSync(FILE, 'utf8')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    ),
  ];
}

module.exports = { readTickers, toFileName };
