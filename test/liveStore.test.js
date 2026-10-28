// The Postgres state store behind the live session. Needs TEST_DATABASE_URL (see test/db.js).

const test = require('node:test');
const assert = require('node:assert/strict');
const { createLiveStore } = require('../api/db/liveStore');
const { createLiveSession } = require('../server/session');
const { candle, openingRange, config } = require('./helpers');
const { createTestDb, noDb } = require('./db');

const DATE = '2026-01-05';

async function withStore(fn) {
  const db = await createTestDb();
  try {
    await fn(createLiveStore(db.pool), db.pool);
  } finally {
    await db.drop();
  }
}

const entry = (symbol) => ({ kind: 'ENTRY', symbol, side: 'long', price: 102, quantity: 5, sl: 100.98, target: 103.02, time: '09:31' });
const exit = (symbol) => ({ kind: 'EXIT', symbol, side: 'long', price: 100.98, quantity: 5, reason: 'SL', pnl: -5.1, time: '09:40' });

test('state round-trips per date and re-saving is idempotent', { skip: noDb }, () =>
  withStore(async (store, pool) => {
    assert.deepEqual(await store.load(DATE), { date: DATE, symbols: {} });

    const state = { date: DATE, symbols: { 'NSE:A-EQ': { position: 'OPEN' }, 'NSE:B-EQ': { position: 'FLAT' } } };
    await store.save(state);
    await store.save(state);
    await store.save({ date: DATE, symbols: {} }); // empty snapshot changes nothing
    assert.deepEqual(await store.load(DATE), state);
    assert.deepEqual(await store.load('2026-01-06'), { date: '2026-01-06', symbols: {} });

    await store.save({ date: DATE, symbols: { 'NSE:A-EQ': { position: 'CLOSED' } } });
    assert.equal((await store.load(DATE)).symbols['NSE:A-EQ'].position, 'CLOSED');
    assert.equal((await pool.query('select count(*)::int as n from live_state')).rows[0].n, 2);
  }));

test('ENTRY opens one paper trade and EXIT closes the same row', { skip: noDb }, () =>
  withStore(async (store, pool) => {
    await store.logDecision(DATE, entry('NSE:A-EQ'));
    await store.logDecision(DATE, { ...entry('NSE:A-EQ'), price: 999 }); // repeat must not overwrite

    let { rows } = await pool.query('select status, side, quantity, entry::float, sl::float, target::float, entry_time from paper_trades');
    assert.deepEqual(rows, [{ status: 'open', side: 'long', quantity: 5, entry: 102, sl: 100.98, target: 103.02, entry_time: '09:31' }]);

    await store.logDecision(DATE, exit('NSE:A-EQ'));
    ({ rows } = await pool.query('select status, exit::float, exit_time, reason, pnl::float, source from paper_trades'));
    assert.deepEqual(rows, [{ status: 'closed', exit: 100.98, exit_time: '09:40', reason: 'SL', pnl: -5.1, source: 'live' }]);

    const log = await pool.query('select kind, payload from live_decisions order by id');
    assert.deepEqual(log.rows.map((r) => r.kind), ['ENTRY', 'ENTRY', 'EXIT']);
    assert.equal(log.rows[2].payload.reason, 'SL');
  }));

test('a session restarted on the Postgres store does not enter twice', { skip: noDb }, () =>
  withStore(async (store, pool) => {
    const SYM = 'NSE:TEST-EQ';
    const candles = [...openingRange(DATE), candle(DATE, '09:30', 100, 102, 100, 101.5)];
    const run = async () => {
      const session = createLiveSession({
        symbols: [SYM],
        config: config(),
        store,
        date: DATE,
        log: () => {},
        socketToken: async () => 'app:token',
        warmStart: async (symbols, onSymbol) => onSymbol(SYM, candles),
        startFeed: () => ({ close() {} }),
      });
      await session.start();
      await session.stop();
    };

    await run();
    await run(); // as after a Render restart: same day, state restored from Postgres

    const trades = await pool.query('select symbol, status, side from paper_trades');
    assert.deepEqual(trades.rows, [{ symbol: SYM, status: 'open', side: 'long' }]);
    const decisions = await pool.query('select count(*)::int as n from live_decisions');
    assert.equal(decisions.rows[0].n, 1);
  }));

test('loadWatchlist reads the named watchlist from Postgres', { skip: noDb }, () =>
  withStore(async (store, pool) => {
    const { loadWatchlist } = require('../api/live');
    const { rows } = await pool.query(`insert into watchlists (name, source) values ('core', 'custom') returning id`);
    await pool.query(`insert into watchlist_symbols (watchlist_id, symbol) values ($1, 'NSE:B-EQ'), ($1, 'NSE:A-EQ')`, [rows[0].id]);
    assert.deepEqual(await loadWatchlist(pool, 'core'), ['NSE:A-EQ', 'NSE:B-EQ']);
    assert.deepEqual(await loadWatchlist(pool, 'missing'), []);
  }));
