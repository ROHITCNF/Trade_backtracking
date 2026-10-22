// Pulls candles from Fyers' history API through the official SDK. Nothing is
// cached: every run fetches fresh, throttled by src/fyers.js.

const { getClient, rest, isRateLimited } = require('./fyers');
const { dateToEpoch } = require('./time');

// Fyers caps intraday history at 100 days per request; 60 leaves margin.
const CHUNK_DAYS = 60;
const DAY_SECONDS = 86400;

// Timeouts, dropped connections and 5xx get two more tries (D8). Anything else
// (bad symbol, dead token, 429, spent budget) would fail the same way again.
const RETRY_DELAYS_MS = [2000, 5000];
const NETWORK_CODES = new Set([
  'ETIMEDOUT', 'ECONNABORTED', 'ECONNRESET', 'ECONNREFUSED', 'ENOTFOUND',
  'EAI_AGAIN', 'EPIPE', 'ENETUNREACH', 'EHOSTUNREACH', 'ERR_NETWORK',
]);

// The SDK rejects with the response body for HTTP errors, and with
// { code, message: 'ECONNRESET' } for network ones.
function isTransient(r) {
  if (!r || typeof r !== 'object' || isRateLimited(r)) return false;
  if (NETWORK_CODES.has(r.code) || NETWORK_CODES.has(r.message)) return true;
  const status = Number(r.status ?? r.code);
  return status >= 500 && status < 600;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchChunk(symbol, resolution, from, to, opts) {
  const { client, onCall, retryDelays } = opts;
  for (let attempt = 0; ; attempt++) {
    let res, failure;
    try {
      res = await rest(async () => {
        onCall();
        return (client || (await getClient())).getHistory({
          symbol,
          resolution,
          date_format: '0',
          range_from: String(from),
          range_to: String(to),
          cont_flag: '1',
        });
      });
    } catch (err) {
      failure = err;
    }

    // 'no_data' is a range with no sessions in it (weekend, holiday, pre-open).
    if (!failure && res.s === 'no_data') return [];
    // Each candle is [epochSeconds, open, high, low, close, volume].
    if (!failure && res.s === 'ok' && Array.isArray(res.candles)) return res.candles;
    failure = failure || res;

    if (attempt < retryDelays.length && isTransient(failure)) {
      await sleep(retryDelays[attempt]);
      continue;
    }
    // rest()'s own refusals (budget, earlier 429) and token errors are Errors already.
    if (failure instanceof Error) throw failure;
    throw new Error(`Fyers history failed for ${symbol}: ${JSON.stringify(failure).slice(0, 300)}`);
  }
}

// onCall(), if given, fires once per Fyers request, retries included (D10).
// client replaces the logged-in SDK client; tests pass a stub.
async function getCandles({ symbol, resolution, fromDate, toDate }, { onCall = () => {}, client, retryDelays = RETRY_DELAYS_MS } = {}) {
  const start = dateToEpoch(fromDate);
  const end = dateToEpoch(toDate) + DAY_SECONDS;
  const all = [];

  for (let from = start; from < end; from += CHUNK_DAYS * DAY_SECONDS) {
    const to = Math.min(from + CHUNK_DAYS * DAY_SECONDS, end);
    all.push(...(await fetchChunk(symbol, resolution, from, to, { client, onCall, retryDelays })));
  }

  // Chunk boundaries can overlap; keep one candle per timestamp, sorted.
  const byTimestamp = new Map(all.map((c) => [c[0], c]));
  return [...byTimestamp.values()].sort((a, b) => a[0] - b[0]);
}

module.exports = { getCandles, isTransient, RETRY_DELAYS_MS };
