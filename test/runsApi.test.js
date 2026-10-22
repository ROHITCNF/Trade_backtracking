// Runs API routes against a real database, with a stubbed candle source behind
// the real worker. Needs TEST_DATABASE_URL (see test/db.js).

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const fyers = require('../src/fyers');
const { istToday } = require('../src/time');
const { buildApp } = require('../api/server');
const { loadConfig } = require('../api/config');
const { signSession } = require('../api/auth/session');
const { createPgStore } = require('../api/db/fyersStore');
const { createWorker } = require('../api/worker');
const { createSymbolMaster } = require('../api/symbols');
const { TARGET_VARIANTS } = require('../src/targets');
const { candle, openingRange } = require('./helpers');
const { createTestDb, noDb } = require('./db');

process.env.TOKEN_ENC_KEY = crypto.randomBytes(32).toString('base64');

const config = loadConfig({ DATABASE_URL: 'x', APP_PASSWORD_HASH: 'h', SESSION_SECRET: 'x'.repeat(32) });
const headers = { authorization: `Bearer ${signSession(config.sessionSecret).token}` };
const CSV = fs.readFileSync(path.join(__dirname, 'fixtures', 'NSE_CM.sample.csv'), 'utf8');

const today = istToday();
const daysAgo = (n) => new Date(Date.parse(today) - n * 86400000).toISOString().slice(0, 10);
const D = '2026-01-05';
const tradeDay = [...openingRange(D), candle(D, '09:31', 100.5, 101.2, 100.5, 101), candle(D, '09:32', 101, 102.5, 101, 102.2)];

const draft = (overrides = {}) => ({
  fromDate: daysAgo(30),
  toDate: daysAgo(1),
  symbols: ['SBIN', 'NSE:RELIANCE-EQ', 'sbin'],
  config: { slMode: 'pct', slPct: 1, targetMode: 'R', targetR: 1, sizing: 'fixed', quantity: 1 },
  ...overrides,
});

async function withApi({ connected = true, drain = true } = {}, fn) {
  const db = await createTestDb();
  fyers.setStore(createPgStore(db.pool));
  if (connected) await fyers.saveToken('tok');
  const symbols = createSymbolMaster({ fetch: async () => ({ ok: true, text: async () => CSV }), log: () => {} });
  await symbols.load();
  const fetched = [];
  const worker = drain
    ? createWorker({ pool: db.pool, getCandles: async ({ symbol }, { onCall }) => (fetched.push(symbol), onCall(), tradeDay), log: () => {} })
    : { wake: async () => {} };
  const app = buildApp({ pool: db.pool, config, worker, symbols });
  const call = (method, url, payload) => app.inject({ method, url, payload, headers });
  try {
    await fn({ app, call, pool: db.pool, worker, fetched });
  } finally {
    await app.close();
    await db.drop();
  }
}

test('defaults come from config.js, then from the latest run', { skip: noDb }, () =>
  withApi({}, async ({ call }) => {
    let res = (await call('GET', '/api/defaults')).json();
    assert.equal(res.source, 'config');
    assert.equal(res.config.orbStart, '09:15');
    assert.equal(res.config.fromDate, undefined, 'no dates');

    await call('POST', '/api/runs', draft({ config: { slMode: 'wider', slPct: 0.7 } }));
    res = (await call('GET', '/api/defaults')).json();
    assert.equal(res.source, 'run');
    assert.equal(res.config.slMode, 'wider');
    assert.equal(res.config.slPct, 0.7);
  }));

test('validation rejects bad drafts with a readable reason (FR-10)', { skip: noDb }, () =>
  withApi({}, async ({ call }) => {
    const cases = [
      [draft({ fromDate: daysAgo(1), toDate: daysAgo(5) }), /on or before/],
      [draft({ fromDate: daysAgo(400) }), /one year back/],
      [draft({ toDate: daysAgo(-2) }), /future/],
      [draft({ config: { orbStart: '09:30', orbEnd: '09:15' } }), /ORB start/],
      [draft({ config: { sessionEnd: '15:45' } }), /by 15:30/],
      [draft({ config: { slPct: 0 } }), /slPct/],
      [draft({ config: { direction: 'sideways' } }), /direction/],
      [draft({ symbols: [] }), /at least one symbol/],
      [draft({ symbols: ['SBIN', 'ZOMATO', 'NIFTY'] }), /Not NSE equities: ZOMATO, NIFTY/],
      [draft({ symbols: undefined, watchlistId: 99 }), /Watchlist not found/],
    ];
    for (const [body, message] of cases) {
      const res = await call('POST', '/api/runs', body);
      assert.equal(res.statusCode, 400, JSON.stringify(body));
      assert.match(res.json().error, message);
    }
    assert.equal((await call('GET', '/api/runs')).json().items.length, 0, 'nothing created');
  }));

test('estimate prices calls per 60-day chunk and checks the budget (FR-12)', { skip: noDb }, () =>
  withApi({ drain: false }, async ({ call }) => {
    // 120 days = 2 chunks; SBIN listed twice counts once.
    let est = (await call('POST', '/api/estimate', draft({ fromDate: daysAgo(120), toDate: daysAgo(1) }))).json();
    assert.equal(est.symbols, 2);
    assert.equal(est.calls, 4);
    assert.equal(est.seconds, Math.ceil((4 * fyers.MIN_GAP_MS) / 1000));
    assert.equal(est.canStart, true);
    assert.deepEqual(est.budget, { used: 0, cap: 4800, queued: 0, remaining: 4800 });

    // A queued run's calls are already promised.
    assert.equal((await call('POST', '/api/runs', draft({ fromDate: daysAgo(120), toDate: daysAgo(1) }))).statusCode, 201);
    est = (await call('POST', '/api/estimate', draft())).json();
    assert.equal(est.budget.queued, 4);
    assert.equal(est.budget.remaining, 4796);

    process.env.REST_DAILY_CAP = '5';
    try {
      est = (await call('POST', '/api/estimate', draft({ fromDate: daysAgo(120), toDate: daysAgo(1) }))).json();
      assert.equal(est.canStart, false);
      assert.match(est.blockers.join(' '), /Needs 4 calls; 1 left today/);
      const res = await call('POST', '/api/runs', draft({ fromDate: daysAgo(120), toDate: daysAgo(1) }));
      assert.equal(res.statusCode, 409);
    } finally {
      delete process.env.REST_DAILY_CAP;
    }
  }));

test('no start while Fyers is disconnected or paused', { skip: noDb }, async () => {
  await withApi({ connected: false }, async ({ call }) => {
    const res = await call('POST', '/api/runs', draft());
    assert.equal(res.statusCode, 409);
    assert.match(res.json().error, /not connected/);
  });
  await withApi({}, async ({ call }) => {
    await fyers.rest(async () => ({ s: 'error', code: 429 }));
    const est = (await call('POST', '/api/estimate', draft())).json();
    assert.match(est.blockers.join(' '), /paused after a 429/);
  });
});

test('create, run, list and get a run', { skip: noDb }, () =>
  withApi({}, async ({ call, worker }) => {
    const res = await call('POST', '/api/runs', draft({ name: '  Morning test ' }));
    assert.equal(res.statusCode, 201);
    const { id, ids, sweepId } = res.json();
    assert.deepEqual(ids, [id]);
    assert.equal(sweepId, null);
    await worker.wake();

    const got = (await call('GET', `/api/runs/${id}`)).json();
    assert.equal(got.run.status, 'done');
    assert.equal(got.run.name, 'Morning test');
    assert.equal(got.run.config.slMode, 'pct');
    assert.equal(got.run.config.orbEnd, '09:30', 'full snapshot (FR-13)');
    assert.deepEqual(got.symbols.map((s) => [s.symbol, s.status]), [['NSE:SBIN-EQ', 'done'], ['NSE:RELIANCE-EQ', 'done']]);
    assert.equal(got.run.metrics.totalTrades, 2);

    const list = (await call('GET', '/api/runs')).json().items;
    assert.equal(list.length, 1);
    assert.equal(list[0].type, 'run');
    assert.equal(list[0].run.id, id);
    assert.equal((await call('GET', '/api/runs/999')).statusCode, 404);
  }));

test('a sweep creates one run per target rule, grouped in the list', { skip: noDb }, () =>
  withApi({}, async ({ call, worker, fetched }) => {
    const res = (await call('POST', '/api/runs', draft({ sweep: true }))).json();
    assert.equal(res.ids.length, TARGET_VARIANTS.length);
    assert.equal(res.sweepId, res.ids[0]);
    assert.equal(res.estimate.calls, 2, 'a sweep costs one run');
    await worker.wake();
    assert.deepEqual(fetched, ['NSE:SBIN-EQ', 'NSE:RELIANCE-EQ']);

    const items = (await call('GET', '/api/runs')).json().items;
    assert.equal(items.length, 1);
    assert.equal(items[0].type, 'sweep');
    assert.deepEqual(items[0].runs.map((r) => r.id), res.ids);
    assert.ok(items[0].runs.every((r) => r.status === 'done'));
    const one = (await call('GET', `/api/runs/${res.ids[3]}`)).json();
    assert.deepEqual(one.sweepRunIds, res.ids);
  }));

test('rename, cancel, resume and delete follow the lifecycle', { skip: noDb }, () =>
  withApi({}, async ({ call, pool, worker }) => {
    const { id } = (await call('POST', '/api/runs', draft())).json();
    await worker.wake();

    let res = await call('PATCH', `/api/runs/${id}`, { name: 'Renamed' });
    assert.equal(res.json().run.name, 'Renamed');
    assert.equal((await call('PATCH', `/api/runs/${id}`, { cancel: true })).statusCode, 409, 'already done');
    assert.equal((await call('PATCH', `/api/runs/${id}`, { resume: true })).statusCode, 409, 'not failed');
    assert.equal((await call('PATCH', `/api/runs/${id}`, {})).statusCode, 400);

    // A failed run with a pending symbol resumes and finishes.
    await pool.query(`update runs set status = 'failed', error = 'budget', done = 1 where id = $1`, [id]);
    await pool.query(`update run_symbols set status = 'pending' where run_id = $1 and symbol = 'NSE:RELIANCE-EQ'`, [id]);
    await pool.query(`delete from trades where run_id = $1 and symbol = 'NSE:RELIANCE-EQ'`, [id]);
    res = await call('PATCH', `/api/runs/${id}`, { resume: true });
    assert.equal(res.statusCode, 200);
    await worker.wake();
    assert.equal((await call('GET', `/api/runs/${id}`)).json().run.status, 'done');

    await pool.query(`update runs set status = 'running' where id = $1`, [id]);
    assert.equal((await call('DELETE', `/api/runs/${id}`)).statusCode, 409);
    await pool.query(`update runs set status = 'done' where id = $1`, [id]);
    assert.equal((await call('DELETE', `/api/runs/${id}`)).statusCode, 204);
    assert.equal((await call('GET', `/api/runs/${id}`)).statusCode, 404);
    assert.equal((await pool.query('select count(*)::int as n from trades')).rows[0].n, 0, 'trades go with it');
  }));

test('cancel of a queued run is immediate', { skip: noDb }, () =>
  withApi({ drain: false }, async ({ call }) => {
    const { id } = (await call('POST', '/api/runs', draft())).json();
    const res = await call('PATCH', `/api/runs/${id}`, { cancel: true });
    assert.equal(res.json().run.status, 'cancelled');
  }));
