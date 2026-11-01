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

test('compare: match, tick order, or mismatch', () => {
  const bt = { side: 'long', entry: 101, exit: 102, reason: 'TARGET', entryTime: '09:30', exitTime: '09:40', sl: 99.99, target: 102.01 };
  const live = { side: 'long', entry: '101.07', exit: '102.05', reason: 'TARGET', status: 'closed', entry_time: '09:30', exit_time: '09:40' };
  const kind = (l, b, day) => compare(l, b, day)?.kind ?? null;
  assert.equal(compare(null, null), null);
  assert.equal(kind(live, bt), 'match', 'prices differ by slippage only');
  assert.deepEqual(compare(null, bt), { kind: 'mismatch', problem: 'backtest traded, live did not' });
  assert.deepEqual(compare(live, null), { kind: 'mismatch', problem: 'live traded, backtest did not' });
  assert.equal(compare({ ...live, side: 'short' }, bt).problem, 'side differs');
  assert.equal(compare({ ...live, entry_time: '09:31' }, bt).problem, 'entry time differs');
  assert.equal(compare({ ...live, status: 'open' }, bt).problem, 'still open after the close');
  assert.equal(compare({ ...live, reason: 'SL' }, bt).problem, 'exit reason differs');
  assert.equal(compare({ ...live, exit_time: '09:41' }, bt).problem, 'exit time differs');

  // The 09:40 candle touched both stop and target: the backtest says SL, live saw the target first.
  const t = (m) => Date.UTC(2026, 0, 5, 0, 0) / 1000 - 19800 + m * 60;
  const day = { at: new Map([[580, [t(580), 101.5, 102.5, 99.5, 100]]]), high: 101, low: 99 };
  assert.equal(kind(live, { ...bt, reason: 'SL', exit: 99.99 }, day), 'tick');
  // The 09:30 candle broke both edges: the backtest skipped it, live went long on the first break.
  const both = { at: new Map([[570, [t(570), 100, 101.5, 98.5, 99]]]), high: 101, low: 99 };
  assert.equal(kind(live, null, both), 'tick');
  assert.equal(kind(live, { ...bt, side: 'short', entryTime: '09:31' }, both), 'tick');
});

test('a day where live matches the backtest reconciles clean', { skip: noDb }, () =>
  withDb(async (pool, store) => {
    await recordLive(store, btA);
    const r = await reconcileDay({ pool, date: DATE, symbols: ['NSE:A-EQ', 'NSE:B-EQ'], config: cfg, getCandles });
    assert.deepEqual([r.checked, r.matched, r.expected, r.backfilled, r.mismatches], [2, 2, 0, 0, []]);
    assert.deepEqual(r.notes.map((n) => [n.symbol, n.kind, n.slippage]), [['NSE:A-EQ', 'match', 0]]);
    const { rows } = await pool.query('select checked, matched, mismatches, notes from paper_reconciliations');
    assert.equal(rows[0].matched, 2);
    assert.deepEqual(rows[0].mismatches, []);
    assert.equal(rows[0].notes[0].kind, 'match');
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

test('tick fills are a match with slippage; a both-touched exit candle is tick order', { skip: noDb }, () =>
  withDb(async (pool, store) => {
    const days = {
      ...DAYS,
      // C: long at 09:30; 09:31 touches the 102.01 target and the 99.99 stop.
      'NSE:C-EQ': [...openingRange(DATE), candle(DATE, '09:30', 101, 101.4, 100.9, 101.2), candle(DATE, '09:31', 101.2, 102.5, 99.5, 100)],
    };
    const get = async ({ symbol }) => days[symbol] || [];
    await recordLive(store, btA, { entry: 101.05, exit: 102.1, pnl: btA.pnl - 2 });
    const btC = runBacktest(days['NSE:C-EQ'], { ...cfg, symbol: 'NSE:C-EQ' })[0];
    assert.equal(btC.reason, 'SL');
    await store.logDecision(DATE, { kind: 'ENTRY', symbol: 'NSE:C-EQ', side: 'long', price: 101.02, quantity: btC.quantity, sl: btC.sl, target: btC.target, time: '09:30' });
    await store.logDecision(DATE, { kind: 'EXIT', symbol: 'NSE:C-EQ', side: 'long', price: 102.02, quantity: btC.quantity, reason: 'TARGET', pnl: 40, time: '09:31' });

    const r = await reconcileDay({ pool, date: DATE, symbols: ['NSE:A-EQ', 'NSE:C-EQ'], config: cfg, getCandles: get });
    assert.deepEqual(r.mismatches, []);
    assert.equal(r.matched, 1);
    assert.equal(r.expected, 1);
    const byS = Object.fromEntries(r.notes.map((n) => [n.symbol, n]));
    assert.deepEqual([byS['NSE:A-EQ'].kind, byS['NSE:A-EQ'].slippage], ['match', -2]);
    assert.equal(byS['NSE:C-EQ'].kind, 'tick');
    assert.match(byS['NSE:C-EQ'].problem, /touched both stop and target/);
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
    const { rows } = await pool.query(`insert into watchlists (name, source) values ('live', 'custom') returning id`);
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
