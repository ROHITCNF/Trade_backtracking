// Live status and paper-trade routes. The DB-backed ones need TEST_DATABASE_URL (see test/db.js).

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildApp } = require('../api/server');
const { loadConfig } = require('../api/config');
const { signSession } = require('../api/auth/session');
const { createLiveStore } = require('../api/db/liveStore');
const { summarize } = require('../api/routes/live');
const { createTestDb, noDb } = require('./db');

const config = loadConfig({ DATABASE_URL: 'x', APP_PASSWORD_HASH: 'h', SESSION_SECRET: 'x'.repeat(32) });
const headers = { authorization: `Bearer ${signSession(config.sessionSecret).token}` };
const tokenStatus = async () => ({ connected: true, expiresAt: 1 });

async function withApi(fn, { live = null } = {}) {
  const db = await createTestDb();
  const app = buildApp({ pool: db.pool, config, live, tokenStatus });
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
      date: '2026-01-05', symbol: 'NSE:A-EQ', status: 'closed', side: 'long', quantity: 10, entryTime: '09:31',
      entry: 100, sl: 99, target: 101.5, exitTime: '10:02', exit: 101.5, reason: 'TARGET', pnl: 15, source: 'live',
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
