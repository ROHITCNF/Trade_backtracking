// Pulls candles from Fyers' history API through the official SDK. Nothing is
// cached: every run fetches fresh, throttled by src/fyers.js.

const { client, rest } = require('./fyers');
const { dateToEpoch } = require('./time');

// Fyers caps intraday history at 100 days per request; 60 leaves margin.
const CHUNK_DAYS = 60;
const DAY_SECONDS = 86400;

async function fetchChunk(symbol, resolution, from, to) {
  let res;
  try {
    res = await rest(() =>
      client().getHistory({
        symbol,
        resolution,
        date_format: '0',
        range_from: String(from),
        range_to: String(to),
        cont_flag: '1',
      })
    );
  } catch (err) {
    throw new Error(`Fyers history failed for ${symbol}: ${JSON.stringify(err).slice(0, 300)}`);
  }

  // 'no_data' is a range with no sessions in it (weekend, holiday, pre-open).
  if (res.s === 'no_data') return [];
  if (res.s !== 'ok' || !Array.isArray(res.candles)) {
    throw new Error(`Fyers history failed for ${symbol}: ${JSON.stringify(res).slice(0, 300)}`);
  }
  // Each candle is [epochSeconds, open, high, low, close, volume].
  return res.candles;
}

async function getCandles({ symbol, resolution, fromDate, toDate }) {
  const start = dateToEpoch(fromDate);
  const end = dateToEpoch(toDate) + DAY_SECONDS;
  const all = [];

  for (let from = start; from < end; from += CHUNK_DAYS * DAY_SECONDS) {
    const to = Math.min(from + CHUNK_DAYS * DAY_SECONDS, end);
    all.push(...(await fetchChunk(symbol, resolution, from, to)));
  }

  // Chunk boundaries can overlap; keep one candle per timestamp, sorted.
  const byTimestamp = new Map(all.map((c) => [c[0], c]));
  return [...byTimestamp.values()].sort((a, b) => a[0] - b[0]);
}

module.exports = { getCandles };
