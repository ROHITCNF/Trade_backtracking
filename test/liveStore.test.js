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

test('an open position loads with its levels from paper_trades (D24)', { skip: noDb }, () =>
  withStore(async (store) => {
    await store.logDecision(DATE, { kind: 'ENTRY', symbol: 'NSE:A-EQ', side: 'short', price: 1658.2, quantity: 30, sl: 1674.78, target: 1633.33, time: '09:55' });
    await store.save({ date: DATE, symbols: { 'NSE:A-EQ': { position: 'OPEN' }, 'NSE:B-EQ': { position: 'CLOSED' } } });
    const { symbols } = await store.load(DATE);
    assert.deepEqual(
      { ...symbols['NSE:A-EQ'], entry: Number(symbols['NSE:A-EQ'].entry), sl: Number(symbols['NSE:A-EQ'].sl), target: Number(symbols['NSE:A-EQ'].target) },
      { position: 'OPEN', side: 'short', entry: 1658.2, sl: 1674.78, target: 1633.33, quantity: 30, entryTime: '09:55' }
    );
    assert.deepEqual(symbols['NSE:B-EQ'], { position: 'CLOSED' });
  }));

test('fixed and trail trades for one symbol and day live side by side (M10)', { skip: noDb }, () =>
  withStore(async (store, pool) => {
    const SYM = 'NSE:A-EQ';
    await store.logDecision(DATE, entry(SYM)); // no flow: fixed
    await store.logDecision(DATE, { ...entry(SYM), flow: 'trail', target: null });
    await store.logDecision(DATE, { ...entry(SYM), flow: 'trail', price: 999, target: null }); // repeat: no-op
    await store.logDecision(DATE, { kind: 'TRAIL', symbol: SYM, flow: 'trail', sl: 102, best: 103.02, time: '09:50' });
    await store.logDecision(DATE, exit(SYM)); // closes fixed only

    const q = () => pool.query('select flow, status, entry::float, sl::float, initial_sl::float, target::float, best::float, reason from paper_trades order by flow');
    assert.deepEqual((await q()).rows, [
      { flow: 'fixed', status: 'closed', entry: 102, sl: 100.98, initial_sl: null, target: 103.02, best: null, reason: 'SL' },
      { flow: 'trail', status: 'open', entry: 102, sl: 102, initial_sl: 100.98, target: null, best: 103.02, reason: null },
    ]);

    await store.save({ date: DATE, symbols: { [SYM]: { position: 'OPEN' } } });
    const { symbols } = await store.load(DATE);
    const { trail, ...rest } = symbols[SYM];
    assert.deepEqual(rest, { position: 'OPEN' }); // fixed is closed, so no fixed levels
    assert.deepEqual(
      { ...trail, entry: Number(trail.entry), sl: Number(trail.sl), initialSl: Number(trail.initialSl), best: Number(trail.best) },
      { side: 'long', entry: 102, sl: 102, target: null, quantity: 5, entryTime: '09:31', initialSl: 100.98, best: 103.02, slTime: '09:50' }
    );

    await store.logDecision(DATE, { ...exit(SYM), flow: 'trail', price: 102, reason: 'SL', pnl: 0, time: '10:05' });
    // A TRAIL without flow 'trail' must never move the fixed row's stop.
    await store.logDecision(DATE, { kind: 'TRAIL', symbol: SYM, sl: 1, best: 2, time: '09:55' });
    assert.equal((await q()).rows[0].sl, 100.98);
    // A TRAIL after the exit must not move a closed trade's stop.
    await store.logDecision(DATE, { kind: 'TRAIL', symbol: SYM, flow: 'trail', sl: 110, best: 111, time: '10:06' });
    assert.deepEqual((await q()).rows[1], { flow: 'trail', status: 'closed', entry: 102, sl: 102, initial_sl: 100.98, target: null, best: 103.02, reason: 'SL' });
    const log = await pool.query('select kind, payload->>\'flow\' as flow from live_decisions order by id');
    assert.deepEqual(log.rows.map((r) => `${r.kind}:${r.flow}`), ['ENTRY:null', 'ENTRY:trail', 'ENTRY:trail', 'TRAIL:trail', 'EXIT:null', 'EXIT:trail', 'TRAIL:null', 'TRAIL:trail']);
  }));

test('a restored open position carries both flows when both are open', { skip: noDb }, () =>
  withStore(async (store) => {
    await store.logDecision(DATE, entry('NSE:A-EQ'));
    await store.logDecision(DATE, { ...entry('NSE:A-EQ'), flow: 'trail', target: null });
    await store.save({ date: DATE, symbols: { 'NSE:A-EQ': { position: 'OPEN' } } });
    const s = (await store.load(DATE)).symbols['NSE:A-EQ'];
    assert.equal(Number(s.target), 103.02);
    assert.equal(s.trail.target, null);
    assert.equal(Number(s.trail.best), 102); // best starts at the entry price
    assert.equal(s.trail.slTime, null); // still the starting stop
  }));
