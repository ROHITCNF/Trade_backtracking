// Injects results into an HTML template and writes a standalone file to out/.

const fs = require('fs');
const path = require('path');

const OUT_DIR = path.join(__dirname, '..', 'out');

function renderTemplate(templateName, data, fileName, html = (t) => t) {
  const template = html(fs.readFileSync(path.join(__dirname, templateName), 'utf8'));

  // </script> inside the JSON would close the tag early and break the page.
  const json = JSON.stringify(data).replace(/</g, '\\u003c');

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const file = path.join(OUT_DIR, fileName);
  fs.writeFileSync(file, template.replace('__DATA__', json));
  return file;
}

// withTickerList loads out/tickers.js (written by runAll.js) for the dropdown.
function writeReport(trades, metrics, config, { fileName = 'report.html', withTickerList = false } = {}) {
  const tickerScript = withTickerList ? '<script src="tickers.js"></script>' : '';
  return renderTemplate('template.html', { trades, metrics, config }, fileName, (t) =>
    t.replace('<!--TICKERS-->', tickerScript)
  );
}

module.exports = { writeReport, renderTemplate, OUT_DIR };
