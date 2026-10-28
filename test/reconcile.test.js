// Paper trades vs a backtest of the same day (#76). The DB-backed ones need TEST_DATABASE_URL (see test/db.js).

const test = require('node:test');
const assert = require('node:assert/strict');
const { reconcileDay, compare } = require('../api/reconcile');
const { createLiveStore } = require('../api/db/liveStore');
const { runBacktest } = require('../src/engine');
const { buildApp } = require('../api/server');
const { loadConfig } = require('../api/config');
const { signSession } = require('../api/auth/session');
const { candle, openingRange, config } = require('./helpers');
const { createTestDb, noDb } = require('./db');

const DATE = '2026-01-05';
const cfg = config();
// A: long breakout at 09:30 that hits its 1R target at 09:31. B: no breakout.
const DAYS = {
  'NSE:A-EQ': [...openingRange(DATE), candle(DATE, '09:30', 101, 102, 101, 101.8), candle(DATE, '09:31', 101.8, 103.5, 101.8, 103)],
  'NSE:B-EQ': [...openingRange(DATE), candle(DATE, '09:30', 100, 100.5, 99.5, 100)],
};
const getCandles = async ({ symbol }) => DAYS[symbol] || [];
const btA = runBacktest(DAYS['NSE:A-EQ'], { ...cfg, symbol: 'NSE:A-EQ' })[0];

// Records A's trade through the live store, as the session would have.
async function recordLive(store, t, overrides = {}) {
  const tr = { ...t, ...overrides };
  await store.logDecision(DATE, { kind: 'ENTRY', symbol: 'NSE:A-EQ', side: tr.side, price: tr.entry, quantity: tr.quantity, sl: tr.sl, target: tr.target, time: tr.entryTime });
  await store.logDecision(DATE, { kind: 'EXIT', symbol: 'NSE:A-EQ', side: tr.side, price: tr.exit, quantity: tr.quantity, reason: tr.reason, pnl: tr.pnl, time: tr.exitTime });
}

async function withDb(fn) {
  const db = await createTestDb();
  try {
    await fn(db.pool, createLiveStore(db.pool));
  } finally {
    await db.drop();
  }
}

test('compare names the first difference', () => {
  const bt = { side: 'long', entry: 101, exit: 102, reason: 'TARGET' };
  const live = { side: 'long', entry: '101.000', exit: '102.00', reason: 'TARGET', status: 'closed' };
  assert.equal(compare(null, null), null);
  assert.equal(compare(live, bt), null);
  assert.equal(compare(null, bt), 'backtest traded, live did not');
  assert.equal(compare(live, null), 'live traded, backtest did not');
  assert.equal(compare({ ...live, side: 'short' }, bt), 'side differs');
  assert.equal(compare({ ...live, entry: '101.10' }, bt), 'entry price differs');
  assert.equal(compare({ ...live, status: 'open' }, bt), 'still open after the close');
  assert.equal(compare({ ...live, reason: 'SL' }, bt), 'exit reason differs');
  assert.equal(compare({ ...live, exit: '101.5' }, bt), 'exit price differs');
});

test('a day where live matches the backtest reconciles clean', { skip: noDb }, () =>
  withDb(async (pool, store) => {
    await recordLive(store, btA);
    const r = await reconcileDay({ pool, date: DATE, symbols: ['NSE:A-EQ', 'NSE:B-EQ'], config: cfg, getCandles });
    assert.deepEqual(r, { date: DATE, checked: 2, matched: 2, backfilled: 0, mismatches: [] });
    const { rows } = await pool.query('select checked, matched, mismatches from paper_reconciliations');
    assert.deepEqual(rows, [{ checked: 2, matched: 2, mismatches: [] }]);
  }));

test('a mismatching day records what differs, per symbol', { skip: noDb }, () =>
  withDb(async (pool, store) => {
    await recordLive(store, btA, { exit: btA.sl, reason: 'SL' });
    // B: live took a trade the backtest never would.
    await store.logDecision(DATE, { kind: 'ENTRY', symbol: 'NSE:B-EQ', side: 'short', price: 99, quantity: 1, sl: 100, target: 98, time: '09:40' });
    const r = await reconcileDay({ pool, date: DATE, symbols: ['NSE:A-EQ', 'NSE:B-EQ'], config: cfg, getCandles });
    assert.equal(r.matched, 0);
    assert.deepEqual(r.mismatches.map((m) => [m.symbol, m.problem]), [
      ['NSE:A-EQ', 'exit reason differs'],
      ['NSE:B-EQ', 'live traded, backtest did not'],
    ]);
    assert.equal(r.mismatches[0].backtest.reason, 'TARGET');
    assert.equal(r.mismatches[0].live.reason, 'SL');

    // Re-running overwrites the day's result rather than adding a row.
    await reconcileDay({ pool, date: DATE, symbols: ['NSE:A-EQ'], config: cfg, getCandles });
    const { rows } = await pool.query('select count(*)::int as n from paper_reconciliations');
    assert.equal(rows[0].n, 1);
  }));

test('a day the session never ran is backfilled from the backtest', { skip: noDb }, () =>
  withDb(async (pool) => {
    const r = await reconcileDay({ pool, date: DATE, symbols: ['NSE:A-EQ', 'NSE:B-EQ'], config: cfg, getCandles });
    assert.deepEqual([r.checked, r.matched, r.backfilled, r.mismatches.length], [2, 0, 1, 0]);
    const { rows } = await pool.query('select symbol, status, source, side, reason, pnl::float from paper_trades');
    assert.deepEqual(rows, [{ symbol: 'NSE:A-EQ', status: 'closed', source: 'backtest', side: 'long', reason: 'TARGET', pnl: btA.pnl }]);
  }));

test('a dead token stops the check instead of recording every symbol as failed', { skip: noDb }, () =>
  withDb(async (pool) => {
    const noToken = async () => { throw new Error('No Fyers token for today.'); };
    await assert.rejects(reconcileDay({ pool, date: DATE, symbols: ['NSE:A-EQ'], config: cfg, getCandles: noToken }), /token/);
    const { rows } = await pool.query('select count(*)::int as n from paper_reconciliations');
    assert.equal(rows[0].n, 0);
  }));

test('reconcile endpoint runs a past day and the list returns its result', { skip: noDb }, () =>
  withDb(async (pool, store) => {
    const apiConfig = loadConfig({ DATABASE_URL: 'x', APP_PASSWORD_HASH: 'h', SESSION_SECRET: 'x'.repeat(32) });
    const headers = { authorization: `Bearer ${signSession(apiConfig.sessionSecret).token}` };
    const { rows } = await pool.query(`insert into watchlists (name, source) values ('core', 'custom') returning id`);
    await pool.query(`insert into watchlist_symbols (watchlist_id, symbol) values ($1, 'NSE:A-EQ'), ($1, 'NSE:B-EQ')`, [rows[0].id]);
    // The route reconciles with the real strategy config, so live must have used it too.
    await recordLive(store, runBacktest(DAYS['NSE:A-EQ'], { ...require('../config'), symbol: 'NSE:A-EQ' })[0]);

    const app = buildApp({ pool, config: apiConfig, getCandles, tokenStatus: async () => ({ connected: true }) });
    try {
      const res = await app.inject({ method: 'POST', url: `/api/paper-trades/${DATE}/reconcile`, headers });
      assert.equal(res.statusCode, 200);
      assert.equal(res.json().matched, 2);

      const future = await app.inject({ method: 'POST', url: '/api/paper-trades/2099-01-01/reconcile', headers });
      assert.equal(future.statusCode, 409);

      const list = (await app.inject({ method: 'GET', url: `/api/paper-trades?from=${DATE}&to=${DATE}`, headers })).json();
      assert.deepEqual(list.reconciliations.map((r) => [r.date, r.checked, r.matched]), [[DATE, 2, 2]]);
    } finally {
      await app.close();
    }
  }));
