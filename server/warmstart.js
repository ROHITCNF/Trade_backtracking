// Pulls today's candles over REST. Needed at launch (the socket only sees ticks
// from the moment it connects) and after any reconnect.

const { istParts } = require('../src/time');

function istToday() {
  return new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
}

// Returns [[ts,o,h,l,c], ...] for today, oldest first.
async function fetchToday(fyers, symbol, resolution = '1') {
  const date = istToday();
  const res = await fyers.getHistory({
    symbol,
    resolution,
    date_format: '1',
    range_from: date,
    range_to: date,
    cont_flag: '1',
  });

  if (res.s !== 'ok' || !Array.isArray(res.candles)) {
    throw new Error(`history failed for ${symbol}: ${JSON.stringify(res).slice(0, 200)}`);
  }
  return res.candles
    .map((c) => [c[0], c[1], c[2], c[3], c[4]])
    .sort((a, b) => a[0] - b[0]);
}

// Sequential with a gap: 39 symbols at 10 req/sec would trip the rate limiter,
// and breaching the per-minute cap three times blocks the account for the day.
async function warmStart(fyers, symbols, onSymbol, delayMs = 250) {
  for (const symbol of symbols) {
    try {
      onSymbol(symbol, await fetchToday(fyers, symbol));
    } catch (err) {
      console.log(`  warm start failed for ${symbol}: ${err.message}`);
    }
    await new Promise((r) => setTimeout(r, delayMs));
  }
}

module.exports = { warmStart, fetchToday, istToday };
