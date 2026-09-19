// Pulls 1-min candles from Fyers and caches them on disk.
// Cache exists so the backtest can be re-run offline — the auth token expires daily.

const fs = require('fs');
const path = require('path');
const { dateToEpoch } = require('./time');

const API_URL = 'https://api-t1.fyers.in/indus/history';
const CACHE_DIR = path.join(__dirname, '..', 'data', 'candles');

// Fyers caps how much intraday history one request can return.
const CHUNK_DAYS = 60;
const DAY_SECONDS = 86400;

function cachePath(symbol, resolution, fromDate, toDate) {
  const safeSymbol = symbol.replace(/[^A-Za-z0-9]/g, '_');
  return path.join(CACHE_DIR, `${safeSymbol}_${resolution}m_${fromDate}_${toDate}.json`);
}

async function fetchChunk({ symbol, resolution, from, to, authToken, tokenId }) {
  const url = new URL(API_URL);
  url.searchParams.set('symbol', symbol);
  url.searchParams.set('resolution', resolution);
  url.searchParams.set('from', String(from));
  url.searchParams.set('to', String(to));
  url.searchParams.set('token_id', tokenId);
  url.searchParams.set('dataReq', '1');
  url.searchParams.set('contFlag', '1');
  url.searchParams.set('currencyCode', 'INR');

  const res = await fetch(url, {
    headers: {
      Authorization: authToken,
      Referer: 'https://trade.fyers.in/',
      'User-Agent': 'Mozilla/5.0',
    },
  });

  if (!res.ok) throw new Error(`Fyers HTTP ${res.status}: ${await res.text()}`);

  const body = await res.json();
  if (!Array.isArray(body.candles)) {
    throw new Error(`Unexpected response shape: ${JSON.stringify(body).slice(0, 300)}`);
  }
  // Each candle is [epochSeconds, open, high, low, close, volume].
  return body.candles;
}

async function getCandles(config) {
  const { symbol, resolution, fromDate, toDate } = config;
  const file = cachePath(symbol, resolution, fromDate, toDate);

  if (fs.existsSync(file)) {
    console.log(`Using cached candles: ${path.relative(process.cwd(), file)}`);
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  }

  const authToken = process.env.FYERS_AUTH_TOKEN;
  const tokenId = process.env.FYERS_TOKEN_ID;
  if (!authToken || !tokenId) {
    throw new Error('Missing FYERS_AUTH_TOKEN or FYERS_TOKEN_ID. Copy .env.example to .env and fill them in.');
  }

  const start = dateToEpoch(fromDate);
  const end = dateToEpoch(toDate) + DAY_SECONDS;
  const all = [];

  for (let from = start; from < end; from += CHUNK_DAYS * DAY_SECONDS) {
    const to = Math.min(from + CHUNK_DAYS * DAY_SECONDS, end);
    console.log(`Fetching ${new Date(from * 1000).toISOString().slice(0, 10)} -> ${new Date(to * 1000).toISOString().slice(0, 10)}`);
    all.push(...(await fetchChunk({ symbol, resolution, from, to, authToken, tokenId })));
  }

  // Chunk boundaries can overlap; keep one candle per timestamp, sorted.
  const byTimestamp = new Map(all.map((c) => [c[0], c]));
  const candles = [...byTimestamp.values()].sort((a, b) => a[0] - b[0]);

  fs.mkdirSync(CACHE_DIR, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(candles));
  console.log(`Cached ${candles.length} candles -> ${path.relative(process.cwd(), file)}`);

  return candles;
}

module.exports = { getCandles };
