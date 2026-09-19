// Injects the backtest results into template.html and writes a standalone file.

const fs = require('fs');
const path = require('path');

const OUT_DIR = path.join(__dirname, '..', 'out');

// `tickers` is the dropdown list: [{ symbol, file }]. Empty list hides the dropdown.
function writeReport(trades, metrics, config, { tickers = [], fileName = 'report.html' } = {}) {
  const template = fs.readFileSync(path.join(__dirname, 'template.html'), 'utf8');

  // </script> inside the JSON would close the tag early and break the page.
  const json = JSON.stringify({ trades, metrics, config, tickers }).replace(/</g, '\\u003c');

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const file = path.join(OUT_DIR, fileName);
  fs.writeFileSync(file, template.replace('__DATA__', json));
  return file;
}

module.exports = { writeReport };
