// The run worker against a real database with stubbed candles. Needs
// TEST_DATABASE_URL (see test/db.js).

const test = require('node:test');
const assert = require('node:assert/strict');
const { createWorker } = require('../api/worker');
const { createRun, createSweep, requestCancel, requestResume } = require('../api/db/runs');
const { runBacktest } = require('../src/engine');
const { candle, openingRange, config } = require('./helpers');
const { createTestDb, noDb } = require('./db');

// A breakout day that hits a 1R target, and a day that never leaves the range.
const winDay = (d) => [...openingRange(d), candle(d, '09:31', 100.5, 101.2, 100.5, 101), candle(d, '09:32', 101, 102.5, 101, 102.2)];
const flatDay = (d) => [...openingRange(d), candle(d, '10:00', 100, 100.5, 99.5, 100)];
const CANDLES = {
  'NSE:AAA-EQ': [...winDay('2026-01-05'), ...winDay('2026-01-06')],
  'NSE:BBB-EQ': flatDay('2026-01-05'),
  'NSE:CCC-EQ': winDay('2026-01-07'),
};
const SYMBOLS = Object.keys(CANDLES);
const spec = (overrides = {}) => ({ config: config(), fromDate: '2026-01-05', toDate: '2026-01-07', symbols: SYMBOLS, ...overrides });

// getCandles stand-in: plays CANDLES back, one call per fetch, unless
// fail[symbol] says to throw (or to hang, standing in for a crash mid-symbol).
function stubCandles(fail = {}) {
  const fetched = [];
  async function getCandles({ symbol }, { onCall }) {
    fetched.push(symbol);
    onCall();
    const f = fail[symbol];
    if (f === 'hang') return new Promise(() => {});
    if (typeof f === 'function') await f();
    else if (f) throw new Error(f);
    return CANDLES[symbol];
  }
  return { getCandles, fetched };
}

const quiet = () => {};

async function withDb(fn) {
  const db = await createTestDb();
  try {
    await fn(db.pool);
  } finally {
    await db.drop();
  }
}

const runRow = async (pool, id) => (await pool.query('select * from runs where id = $1', [id])).rows[0];
const statuses = async (pool, id) =>
  Object.fromEntries((await pool.query('select symbol, status from run_symbols where run_id = $1', [id])).rows.map((r) => [r.symbol, r.status]));
const tradeCount = async (pool, id) => (await pool.query('select count(*)::int as n from trades where run_id = $1', [id])).rows[0].n;

test('a normal run stores trades per symbol, skips, fails and pools metrics', { skip: noDb }, () =>
  withDb(async (pool) => {
    const id = await createRun(pool, spec());
    const stub = stubCandles({ 'NSE:CCC-EQ': 'Fyers history failed for NSE:CCC-EQ: {"code":500,"message":"ETIMEDOUT"}' });
    await createWorker({ pool, getCandles: stub.getCandles, log: quiet }).wake();

    assert.deepEqual(await statuses(pool, id), { 'NSE:AAA-EQ': 'done', 'NSE:BBB-EQ': 'skipped', 'NSE:CCC-EQ': 'failed' });
    const run = await runRow(pool, id);
    assert.equal(run.status, 'done');
    assert.equal(run.done, 3);
    assert.equal(run.calls_used, 3);
    assert.ok(run.finished_at);

    // Stored trades are exactly what the engine produced.
    const expected = runBacktest(CANDLES['NSE:AAA-EQ'], { ...config(), symbol: 'NSE:AAA-EQ' });
    assert.equal(await tradeCount(pool, id), expected.length);
    assert.equal(run.metrics.totalTrades, 2);
    assert.equal(run.metrics.totalPnl, expected.reduce((s, t) => s + t.pnl, 0));
    assert.equal(run.metrics.portfolio.bestSymbol, 'AAA');
    assert.equal(run.metrics.curve, undefined);

    const { rows } = await pool.query(`select reason from run_symbols where run_id = $1 and symbol = 'NSE:CCC-EQ'`, [id]);
    assert.match(rows[0].reason, /ETIMEDOUT/);
  }));

test('a sweep fetches each symbol once for every variant', { skip: noDb }, () =>
  withDb(async (pool) => {
    const variants = [
      { label: 'no target', targetMode: 'none' },
      { label: '1R', targetMode: 'R', targetR: 1 },
      { label: '3R', targetMode: 'R', targetR: 3 },
    ];
    const ids = await createSweep(pool, spec({ name: 'S' }), variants);
    const stub = stubCandles();
    await createWorker({ pool, getCandles: stub.getCandles, log: quiet }).wake();

    assert.deepEqual(stub.fetched, SYMBOLS, 'one fetch per symbol, not per variant');
    const runs = await Promise.all(ids.map((id) => runRow(pool, id)));
    assert.ok(runs.every((r) => r.status === 'done' && Number(r.sweep_id) === ids[0]));
    assert.deepEqual(runs.map((r) => r.name), ['S · no target', 'S · 1R', 'S · 3R']);
    // Same entries, different exits: 1R hits its target, the others ride to EOD.
    assert.deepEqual(runs.map((r) => r.metrics.byReason), [{ EOD: 3 }, { TARGET: 3 }, { EOD: 3 }]);
  }));

test('cancel stops the run after the current symbol and keeps finished ones', { skip: noDb }, () =>
  withDb(async (pool) => {
    const id = await createRun(pool, spec());
    const stub = stubCandles({ 'NSE:AAA-EQ': () => requestCancel(pool, id) });
    await createWorker({ pool, getCandles: stub.getCandles, log: quiet }).wake();

    assert.equal((await runRow(pool, id)).status, 'cancelled');
    assert.deepEqual(await statuses(pool, id), { 'NSE:AAA-EQ': 'done', 'NSE:BBB-EQ': 'pending', 'NSE:CCC-EQ': 'pending' });
    assert.deepEqual(stub.fetched, ['NSE:AAA-EQ']);
    assert.equal(await tradeCount(pool, id), 2);

    const queued = await createRun(pool, spec());
    assert.equal(await requestCancel(pool, queued), true);
    assert.equal((await runRow(pool, queued)).status, 'cancelled', 'a queued run cancels on the spot');
    assert.equal(await requestCancel(pool, queued), false);
  }));

test('a restart resumes from the first unfinished symbol', { skip: noDb }, () =>
  withDb(async (pool) => {
    const id = await createRun(pool, spec());
    // First worker "dies" while fetching the second symbol: it never returns.
    createWorker({ pool, getCandles: stubCandles({ 'NSE:BBB-EQ': 'hang' }).getCandles, log: quiet }).wake();
    for (let i = 0; i < 200 && (await statuses(pool, id))['NSE:AAA-EQ'] !== 'done'; i++) await new Promise((r) => setTimeout(r, 10));
    assert.equal((await runRow(pool, id)).status, 'running');

    const stub = stubCandles();
    await createWorker({ pool, getCandles: stub.getCandles, log: quiet }).wake();
    assert.deepEqual(stub.fetched, ['NSE:BBB-EQ', 'NSE:CCC-EQ'], 'finished symbols are not refetched');
    const run = await runRow(pool, id);
    assert.equal(run.status, 'done');
    assert.equal(run.done, 3);
    assert.equal(await tradeCount(pool, id), 3, 'no duplicate trades');
  }));

test('a budget error fails the run, leaves symbols pending, and resume finishes it', { skip: noDb }, () =>
  withDb(async (pool) => {
    const id = await createRun(pool, spec());
    const budget = 'Fyers daily REST budget used (4800/4800). Try again tomorrow.';
    await createWorker({ pool, getCandles: stubCandles({ 'NSE:BBB-EQ': budget }).getCandles, log: quiet }).wake();

    let run = await runRow(pool, id);
    assert.equal(run.status, 'failed');
    assert.equal(run.error, budget);
    assert.equal(run.calls_used, 2, 'the failed fetch still spent a call');
    assert.deepEqual(await statuses(pool, id), { 'NSE:AAA-EQ': 'done', 'NSE:BBB-EQ': 'pending', 'NSE:CCC-EQ': 'pending' });

    assert.equal(await requestResume(pool, id), true);
    const stub = stubCandles();
    await createWorker({ pool, getCandles: stub.getCandles, log: quiet }).wake();
    run = await runRow(pool, id);
    assert.equal(run.status, 'done');
    assert.equal(run.error, null);
    assert.deepEqual(stub.fetched, ['NSE:BBB-EQ', 'NSE:CCC-EQ']);
    assert.equal(await tradeCount(pool, id), 3);
  }));
