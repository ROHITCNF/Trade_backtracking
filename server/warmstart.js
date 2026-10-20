// Pulls today's candles over REST. Needed at launch (the socket only sees ticks
// from the moment it connects) and after any reconnect.

const { getCandles } = require('../src/fetch');

function istToday() {
  return new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
}

// Sequential: src/fyers.js spaces the calls so 39 symbols stay well under the
// per-minute cap, whose breach three times blocks the account for the day.
async function warmStart(symbols, onSymbol) {
  const date = istToday();
  for (const symbol of symbols) {
    try {
      onSymbol(symbol, await getCandles({ symbol, resolution: '1', fromDate: date, toDate: date }));
    } catch (err) {
      console.log(`  warm start failed for ${symbol}: ${err.message}`);
    }
  }
}

module.exports = { warmStart, istToday };
