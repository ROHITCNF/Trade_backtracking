// Symbol master parsing, search and classification, from a sample of the real
// NSE_CM.csv (test/fixtures). No network, no Postgres.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { createSymbolMaster } = require('../api/symbols');
const { buildApp } = require('../api/server');
const { loadConfig } = require('../api/config');
const { signSession } = require('../api/auth/session');

const CSV = fs.readFileSync(path.join(__dirname, 'fixtures', 'NSE_CM.sample.csv'), 'utf8');
const okFetch = async () => ({ ok: true, status: 200, text: async () => CSV });

async function loaded() {
  const m = createSymbolMaster({ fetch: okFetch, log: () => {} });
  await m.load();
  return m;
}

test('search returns ticker and company name, best match first', async () => {
  const m = await loaded();
  assert.deepEqual(m.search('sbin')[0], { symbol: 'NSE:SBIN-EQ', ticker: 'SBIN', name: 'STATE BANK OF INDIA', kind: 'equity' });
  assert.deepEqual(m.search('SBI').map((e) => e.ticker), ['SBIN', 'SBICARD', 'SBILIFE']);
  assert.deepEqual(m.search('reliance ind').map((e) => e.ticker), ['RELIANCE'], 'company name');
  assert.deepEqual(m.search('NSE:TMPV-EQ').map((e) => e.ticker), ['TMPV']);
  assert.equal(m.search('NIFTY').length, 0, 'indices are not offered as tradable symbols');
  assert.equal(m.search('ABAN').length, 0, 'only the EQ series');
  assert.equal(m.search('SBI', 2).length, 2);
});

test('classify recognises equities in any spelling, indices, and unknowns', async () => {
  const m = await loaded();
  for (const input of ['sbin', 'SBIN-EQ', 'NSE:SBIN', ' NSE:SBIN-EQ ']) assert.equal(m.classify(input).symbol, 'NSE:SBIN-EQ', input);
  for (const input of ['NIFTY', 'nifty50', 'NSE:NIFTYBANK-INDEX', 'BANKNIFTY', 'FINNIFTY']) assert.equal(m.classify(input).kind, 'index', input);
  assert.equal(m.classify('BANKNIFTY').symbol, 'NSE:NIFTYBANK-INDEX');
  assert.deepEqual(m.classify('ZOMATO'), { kind: null }, 'renamed to ETERNAL; no hints (D3)');
  assert.deepEqual(m.classify('ABAN'), { kind: null }, 'BE series only');
  assert.equal(m.lookup('NSE:ETERNAL-EQ').name, 'ETERNAL LIMITED');
});

test('a failed download keeps the old list; start() never throws', async () => {
  const m = await loaded();
  let fail = true;
  const flaky = createSymbolMaster({ fetch: async () => (fail ? { ok: false, status: 502 } : okFetch()), log: () => {} });
  await assert.rejects(flaky.load(), /HTTP 502/);
  assert.equal(flaky.ready(), false);
  await flaky.start();
  flaky.stop();
  assert.equal(flaky.ready(), false);
  assert.throws(() => flaky.search('SBIN'), /not loaded/);
  fail = false;
  await flaky.load();
  assert.equal(flaky.ready(), true);
  assert.equal(m.ready(), true);
});

test('GET /api/symbols needs a session, 503 until loaded', async () => {
  const config = loadConfig({ DATABASE_URL: 'x', APP_PASSWORD_HASH: 'h', SESSION_SECRET: 'x'.repeat(32) });
  const headers = { authorization: `Bearer ${signSession(config.sessionSecret).token}` };
  const pool = { query: async () => ({ rows: [] }) };

  const symbols = createSymbolMaster({ fetch: okFetch, log: () => {} });
  const app = buildApp({ pool, config, symbols });
  assert.equal((await app.inject('/api/symbols?q=SBI')).statusCode, 401);
  assert.equal((await app.inject({ url: '/api/symbols?q=SBI', headers })).statusCode, 503);
  await symbols.load();
  const res = await app.inject({ url: '/api/symbols?q=SBI', headers });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().results[0].symbol, 'NSE:SBIN-EQ');
  assert.equal((await app.inject({ url: '/api/symbols', headers })).statusCode, 400);
});

test('the real master parses (network; skipped offline)', { skip: !process.env.TEST_NETWORK && 'set TEST_NETWORK=1' }, async () => {
  const m = createSymbolMaster({ log: () => {} });
  await m.load();
  assert.equal(m.classify('RELIANCE').symbol, 'NSE:RELIANCE-EQ');
  assert.equal(m.classify('NIFTY').kind, 'index');
});
