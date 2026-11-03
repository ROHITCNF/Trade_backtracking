// Live status and paper-trade routes. The DB-backed ones need TEST_DATABASE_URL (see test/db.js).

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildApp } = require('../api/server');
const { loadConfig } = require('../api/config');
const { signSession } = require('../api/auth/session');
const { createLiveStore } = require('../api/db/liveStore');
const { summarize } = require('../api/routes/live');
const { createTestDb, noDb } = require('./db');
const { candle, openingRange } = require('./helpers');

const config = loadConfig({ DATABASE_URL: 'x', APP_PASSWORD_HASH: 'h', SESSION_SECRET: 'x'.repeat(32) });
const headers = { authorization: `Bearer ${signSession(config.sessionSecret).token}` };
const tokenStatus = async () => ({ connected: true, expiresAt: 1 });

async function withApi(fn, { live = null, getCandles } = {}) {
  const db = await createTestDb();
  const app = buildApp({ pool: db.pool, config, live, tokenStatus, getCandles });
  const call = (url, auth = headers) => app.inject({ method: 'GET', url, headers: auth });
  try {
    await fn({ call, pool: db.pool });
  } finally {
    await app.close();
    await db.drop();
  }
}

const ev = (kind, symbol, extra) => ({ kind, symbol, side: 'long', quantity: 10, time: '09:31', ...extra });

test('summarize counts closed trades only and groups P&L by day', () => {
  const { summary, days } = summarize([
    { date: '2026-01-06', status: 'open', pnl: null },
    { date: '2026-01-06', status: 'closed', pnl: 12.5 },
    { date: '2026-01-05', status: 'closed', pnl: -4.25 },
    { date: '2026-01-05', status: 'closed', pnl: 1 },
  ]);
  assert.deepEqual(summary, { trades: 4, open: 1, closed: 3, wins: 2, losses: 1, winRate: 66.67, netPnl: 9.25 });
  assert.deepEqual(days, [{ date: '2026-01-05', pnl: -3.25 }, { date: '2026-01-06', pnl: 12.5 }]);
  assert.equal(summarize([]).summary.winRate, null);
});

test('every live route needs a session', { skip: noDb }, () =>
  withApi(async ({ call }) => {
    for (const url of ['/api/live/status', '/api/paper-trades', '/api/paper-trades/2026-01-05/decisions']) {
      assert.equal((await call(url, {})).statusCode, 401, url);
    }
  }));

test('status reports the scheduler, or disabled when there is none', { skip: noDb }, async () => {
  await withApi(async ({ call }) => {
    const body = (await call('/api/live/status')).json();
    assert.equal(body.enabled, false);
    assert.equal(body.session, null);
    assert.equal(body.tokenConnected, true);
    assert.match(body.today, /^\d{4}-\d{2}-\d{2}$/);
  });

  const live = { status: () => ({ enabled: true, watchlist: 'core', lastError: null, session: { date: '2026-01-05', running: true, open: 2, closed: 1 } }) };
  await withApi(async ({ call }) => {
    const body = (await call('/api/live/status')).json();
    assert.equal(body.enabled, true);
    assert.equal(body.watchlist, 'core');
    assert.deepEqual(body.session, { date: '2026-01-05', running: true, open: 2, closed: 1 });
  }, { live });
});

test('paper trades come back by date range with totals, and decisions by day', { skip: noDb }, () =>
  withApi(async ({ call, pool }) => {
    const store = createLiveStore(pool);
    await store.logDecision('2026-01-05', ev('ENTRY', 'NSE:A-EQ', { price: 100, sl: 99, target: 101.5 }));
    await store.logDecision('2026-01-05', ev('EXIT', 'NSE:A-EQ', { price: 101.5, reason: 'TARGET', pnl: 15, time: '10:02' }));
    await store.logDecision('2026-01-06', ev('ENTRY', 'NSE:B-EQ', { price: 50, sl: 49.5, target: null }));
    await store.logDecision('2025-12-01', ev('ENTRY', 'NSE:OLD-EQ', { price: 1, sl: 0.99 }));

    const res = await call('/api/paper-trades?from=2026-01-01&to=2026-01-31');
    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.deepEqual(body.trades.map((t) => [t.date, t.symbol, t.status]), [
      ['2026-01-06', 'NSE:B-EQ', 'open'],
      ['2026-01-05', 'NSE:A-EQ', 'closed'],
    ]);
    assert.deepEqual(body.trades[1], {
      date: '2026-01-05', symbol: 'NSE:A-EQ', flow: 'fixed', status: 'closed', side: 'long', quantity: 10, entryTime: '09:31',
      entry: 100, sl: 99, target: 101.5, exitTime: '10:02', exit: 101.5, reason: 'TARGET', pnl: 15, source: 'live', initialSl: null, best: null,
    });
    assert.equal(body.trades[0].target, null);
    assert.deepEqual(body.summary, { trades: 2, open: 1, closed: 1, wins: 1, losses: 0, winRate: 100, netPnl: 15 });
    assert.deepEqual(body.days, [{ date: '2026-01-05', pnl: 15 }]);

    // Default window is the 30 days ending `to`.
    const dflt = (await call('/api/paper-trades?to=2026-01-05')).json();
    assert.equal(dflt.from, '2025-12-07');
    assert.deepEqual(dflt.trades.map((t) => t.symbol), ['NSE:A-EQ']);

    assert.equal((await call('/api/paper-trades?from=jan')).statusCode, 400);

    const dec = (await call('/api/paper-trades/2026-01-05/decisions')).json();
    assert.deepEqual(dec.decisions.map((d) => [d.kind, d.symbol]), [['ENTRY', 'NSE:A-EQ'], ['EXIT', 'NSE:A-EQ']]);
    assert.equal(dec.decisions[1].payload.reason, 'TARGET');
    assert.equal((await call('/api/paper-trades/2026-02-30x/decisions')).statusCode, 400);
  }));

test('paper trade candles come with its opening range and marker times', { skip: noDb }, async () => {
  const day = [...openingRange('2026-01-05'), candle('2026-01-05', '09:30', 100, 102, 100, 101.5)];
  const getCandles = async ({ symbol }) => {
    if (symbol === 'NSE:NOTOKEN-EQ') throw new Error('No Fyers token for today.');
    return day;
  };
  await withApi(async ({ call, pool }) => {
    const store = createLiveStore(pool);
    await store.logDecision('2026-01-05', ev('ENTRY', 'NSE:A-EQ', { price: 101, sl: 100, target: 102, time: '09:30' }));
    await store.logDecision('2026-01-05', ev('ENTRY', 'NSE:NOTOKEN-EQ', { price: 1, sl: 0.99 }));

    const res = await call('/api/paper-trades/2026-01-05/NSE:A-EQ/candles');
    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.candles.length, 16);
    assert.equal(body.candles[0].length, 5, 'volume stripped');
    assert.equal(body.orbEnd, '09:30');
    assert.equal(body.trade.orbHigh, 101);
    assert.equal(body.trade.orbLow, 99);
    assert.equal(body.trade.entryTs, day[15][0]);
    assert.equal(body.trade.exitTs, null, 'open trade has no exit marker');

    // The candle route picks a flow too: fixed by default, trail on request.
    await store.logDecision('2026-01-05', ev('ENTRY', 'NSE:A-EQ', { flow: 'trail', price: 101, sl: 100, target: null, time: '09:30' }));
    assert.equal((await call('/api/paper-trades/2026-01-05/NSE:A-EQ/candles')).json().trade.flow, 'fixed');
    const tr = (await call('/api/paper-trades/2026-01-05/NSE:A-EQ/candles?flow=trail')).json().trade;
    assert.deepEqual([tr.flow, tr.target, tr.best], ['trail', null, 101]);
    assert.equal((await call('/api/paper-trades/2026-01-05/NSE:NOTOKEN-EQ/candles?flow=trail')).statusCode, 404);

    assert.equal((await call('/api/paper-trades/2026-01-05/NSE:NONE-EQ/candles')).statusCode, 404);
    assert.equal((await call('/api/paper-trades/2026-01-05/NSE:NOTOKEN-EQ/candles')).statusCode, 409);
  }, { getCandles });
});

test('a watchlist narrows trades, totals and reconciliations, and reports what live misses', { skip: noDb }, () =>
  withApi(async ({ call, pool }) => {
    const mk = async (name, symbols) => {
      const { rows } = await pool.query(`insert into watchlists (name, source) values ($1, 'custom') returning id`, [name]);
      await pool.query(`insert into watchlist_symbols (watchlist_id, symbol) select $1, unnest($2::text[])`, [rows[0].id, symbols]);
      return Number(rows[0].id);
    };
    await mk('live', ['NSE:A-EQ', 'NSE:B-EQ', 'NSE:C-EQ']);
    const final = await mk('final', ['NSE:A-EQ', 'NSE:C-EQ', 'NSE:Z-EQ']);

    const store = createLiveStore(pool);
    await store.logDecision('2026-01-05', ev('ENTRY', 'NSE:A-EQ', { price: 100, sl: 99 }));
    await store.logDecision('2026-01-05', ev('EXIT', 'NSE:A-EQ', { price: 101, reason: 'TARGET', pnl: 10, time: '10:00' }));
    await store.logDecision('2026-01-05', ev('ENTRY', 'NSE:B-EQ', { price: 50, sl: 49 }));
    await store.logDecision('2026-01-05', ev('EXIT', 'NSE:B-EQ', { price: 49, reason: 'SL', pnl: -10, time: '10:05' }));
    await pool.query(
      `insert into paper_reconciliations (date, checked, matched, backfilled, mismatches) values ('2026-01-05', 3, 2, 0, $1)`,
      [JSON.stringify([{ symbol: 'NSE:C-EQ', problem: 'backtest traded, live did not' }, { symbol: 'NSE:B-EQ', problem: 'x' }])]
    );

    const all = (await call('/api/paper-trades?from=2026-01-05&to=2026-01-05')).json();
    assert.equal(all.trades.length, 2);
    assert.equal(all.coverage, undefined);

    const body = (await call(`/api/paper-trades?from=2026-01-05&to=2026-01-05&watchlist=${final}`)).json();
    assert.deepEqual(body.trades.map((t) => t.symbol), ['NSE:A-EQ']);
    assert.equal(body.summary.netPnl, 10);
    assert.deepEqual(body.coverage, { watchlist: { id: final, name: 'final' }, symbols: 3, live: 2, missing: ['NSE:Z-EQ'] });
    const [r] = body.reconciliations;
    assert.deepEqual([r.checked, r.matched, r.backfilled], [2, 1, 0]);
    assert.deepEqual(r.mismatches.map((m) => m.symbol), ['NSE:C-EQ']);

    assert.equal((await call('/api/paper-trades?watchlist=999999')).statusCode, 404);
    assert.equal((await call('/api/paper-trades?watchlist=abc')).statusCode, 400);

    const status = (await call('/api/live/status')).json();
    assert.equal(status.lastTradeDate, '2026-01-05');
  }));

test('paper trades filter by flow, fixed by default (M10)', { skip: noDb }, () =>
  withApi(async ({ call, pool }) => {
    const store = createLiveStore(pool);
    const D = '2026-01-05';
    await store.logDecision(D, ev('ENTRY', 'NSE:A-EQ', { price: 100, sl: 99, target: 101.5 }));
    await store.logDecision(D, ev('EXIT', 'NSE:A-EQ', { price: 99, reason: 'SL', pnl: -10, time: '09:40' }));
    await store.logDecision(D, ev('ENTRY', 'NSE:A-EQ', { flow: 'trail', price: 100, sl: 99, target: null }));
    await store.logDecision(D, ev('TRAIL', 'NSE:A-EQ', { flow: 'trail', sl: 99.5, best: 100.5, time: '09:35' }));
    await store.logDecision(D, ev('EXIT', 'NSE:A-EQ', { flow: 'trail', price: 99.5, reason: 'SL', pnl: -5, time: '09:41' }));

    const fixed = (await call(`/api/paper-trades?from=${D}&to=${D}`)).json();
    assert.equal(fixed.flow, 'fixed');
    assert.deepEqual(fixed.trades.map((t) => [t.flow, t.pnl, t.best]), [['fixed', -10, null]]);
    assert.equal(fixed.summary.netPnl, -10);

    const trail = (await call(`/api/paper-trades?from=${D}&to=${D}&flow=trail`)).json();
    assert.equal(trail.flow, 'trail');
    assert.deepEqual(trail.trades.map((t) => [t.flow, t.initialSl, t.sl, t.best, t.target, t.pnl]), [['trail', 99, 99.5, 100.5, null, -5]]);
    assert.equal(trail.summary.netPnl, -5);

    assert.equal((await call(`/api/paper-trades?flow=both`)).statusCode, 400);
  }));
