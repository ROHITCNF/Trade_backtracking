// The Fyers NSE capital-market symbol master (hld § Symbol master), held in
// memory: search for the launcher (FR-11) and validation for watchlists (D3).
// It is a public file, so downloading it costs nothing from the data budget.

const MASTER_URL = 'https://public.fyers.in/sym_details/NSE_CM.csv';
const DAY_MS = 24 * 3600 * 1000;
const RETRY_MS = 10 * 60 * 1000;

// NSE_CM.csv has no header and no quoting: 21 plain comma-separated columns.
const COL = { name: 1, ticker: 9, underlying: 13 };

// 'sbin', 'SBIN-EQ', 'NSE:SBIN', 'NSE:SBIN-EQ' -> 'SBIN'
const baseOf = (input) => String(input).trim().toUpperCase().replace(/^NSE:/, '').replace(/-(EQ|INDEX)$/, '');

function parseMaster(csv) {
  const equities = new Map(); // 'NSE:SBIN-EQ' -> { symbol, ticker, name, kind }
  const indices = new Map(); // 'NIFTY50', 'NIFTY' (underlying) -> { … kind: 'index' }
  for (const line of csv.split('\n')) {
    const cols = line.split(',');
    const symbol = cols[COL.ticker];
    if (!symbol || !symbol.startsWith('NSE:')) continue;
    const entry = { symbol, ticker: baseOf(symbol), name: cols[COL.name].trim() };
    if (symbol.endsWith('-EQ')) equities.set(symbol, { ...entry, kind: 'equity' });
    else if (symbol.endsWith('-INDEX')) {
      const idx = { ...entry, kind: 'index' };
      indices.set(entry.ticker, idx);
      if (cols[COL.underlying]) indices.set(cols[COL.underlying].trim().toUpperCase(), idx);
    }
  }
  return { equities, indices };
}

function createSymbolMaster({ url = MASTER_URL, fetch = globalThis.fetch, log = console.log } = {}) {
  let master = null;
  let loadedAt = null;
  let timer = null;

  async function load() {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Symbol master download failed: HTTP ${res.status}`);
    const parsed = parseMaster(await res.text());
    if (parsed.equities.size === 0) throw new Error('Symbol master download had no NSE equities');
    master = parsed;
    loadedAt = Date.now();
    log(`symbol master: ${parsed.equities.size} equities, ${new Set(parsed.indices.values()).size} indices`);
  }

  // Loads now, then daily; after a failure, retries sooner. Never throws, so a
  // Fyers outage at boot does not stop the API (search answers 503 meanwhile).
  function start() {
    const tick = async () => {
      let next = DAY_MS;
      try {
        await load();
      } catch (err) {
        log(`symbol master: ${err.message}`);
        next = RETRY_MS;
      }
      timer = setTimeout(tick, next);
      timer.unref();
    };
    return tick();
  }

  function stop() {
    clearTimeout(timer);
  }

  // Equities whose ticker or company name matches q, best first: exact ticker,
  // ticker prefix, ticker substring, then name substring.
  function loaded() {
    if (!master) throw new Error('Symbol master not loaded yet');
    return master;
  }

  function search(q, limit = 20) {
    const { equities } = loaded();
    const needle = baseOf(q);
    if (!needle) return [];
    const words = String(q).trim().toUpperCase();
    const rank = (e) =>
      e.ticker === needle ? 0 : e.ticker.startsWith(needle) ? 1 : e.ticker.includes(needle) ? 2 : e.name.toUpperCase().includes(words) ? 3 : -1;
    const hits = [];
    for (const e of equities.values()) {
      const r = rank(e);
      if (r >= 0) hits.push([r, e]);
    }
    hits.sort((a, b) => a[0] - b[0] || a[1].ticker.length - b[1].ticker.length || a[1].ticker.localeCompare(b[1].ticker));
    return hits.slice(0, limit).map(([, e]) => e);
  }

  // What a watchlist line is: { kind: 'equity', symbol: 'NSE:X-EQ', name }
  // | { kind: 'index', symbol, name } | { kind: null } when not recognised.
  function classify(input) {
    const { equities, indices } = loaded();
    const base = baseOf(input);
    const eq = equities.get(`NSE:${base}-EQ`);
    if (eq && !/-INDEX$/i.test(String(input).trim())) return eq;
    return indices.get(base) || { kind: null };
  }

  const ready = () => master !== null;
  const lookup = (symbol) => (master && master.equities.get(symbol)) || null;

  return { load, start, stop, search, classify, lookup, ready, loadedAt: () => loadedAt };
}

module.exports = { createSymbolMaster, parseMaster, MASTER_URL };
