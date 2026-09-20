// Live last-traded prices from Fyers. Used to size positions the way you would
// size them today, which is not the same as how a historical trade should be
// sized — see config.sizing.

const QUOTES_URL = 'https://api-t1.fyers.in/indus/data/v1/quotes';

// Fyers accepts several symbols per call; keep batches modest to stay well
// inside URL length limits.
const BATCH = 20;

async function fetchBatch(symbols, authToken, tokenId) {
  const url = new URL(QUOTES_URL);
  url.searchParams.set('symbols', symbols.join(','));
  url.searchParams.set('dataReq', String(Math.floor(Date.now() / 1000)));
  url.searchParams.set('token_id', tokenId);

  const res = await fetch(url, {
    headers: {
      Authorization: authToken,
      Referer: 'https://trade.fyers.in/',
      'User-Agent': 'Mozilla/5.0',
    },
  });
  if (!res.ok) throw new Error(`Quotes HTTP ${res.status}: ${await res.text()}`);

  const body = await res.json();
  if (!Array.isArray(body.d)) {
    throw new Error(`Unexpected quotes response: ${JSON.stringify(body).slice(0, 300)}`);
  }

  const out = new Map();
  for (const row of body.d) {
    // 'lp' is the last traded price; entries can come back without one.
    if (row.s === 'ok' && row.v && typeof row.v.lp === 'number') out.set(row.n, row.v.lp);
  }
  return out;
}

// symbols -> Map<symbol, lastPrice>
async function getLastPrices(symbols) {
  const authToken = process.env.FYERS_AUTH_TOKEN;
  const tokenId = process.env.FYERS_TOKEN_ID;
  if (!authToken || !tokenId) {
    throw new Error('Missing FYERS_AUTH_TOKEN or FYERS_TOKEN_ID. Copy .env.example to .env and fill them in.');
  }

  const prices = new Map();
  for (let i = 0; i < symbols.length; i += BATCH) {
    const batch = symbols.slice(i, i + BATCH);
    for (const [symbol, price] of await fetchBatch(batch, authToken, tokenId)) {
      prices.set(symbol, price);
    }
  }
  return prices;
}

module.exports = { getLastPrices };
