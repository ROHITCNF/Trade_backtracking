// Catch-up close (#161): paper trades left open after their day ended are closed at the last
// 1-minute close before sessionEnd, as an EOD exit. DB-backed; needs TEST_DATABASE_URL (see test/db.js).

const test = require('node:test');
const assert = require('node:assert/strict');
const { closeStaleTrades } = require('../api/catchup');
const { createLiveStore } = require('../api/db/liveStore');
const { candle, config } = require('./helpers');
const { createTestDb, noDb } = require('./db');

const TODAY = '2026-03-10';
const YESTERDAY = '2026-03-09';
const cfg = config();
// IST wall clock -> epoch ms (IST = UTC + 5:30).
const ist = (date, hhmm) => Date.parse(`${date}T${hhmm}:00+05:30`);

async function withDb(fn) {
  const db = await createTestDb();
  try {
    await fn(db.pool, createLiveStore(db.pool));
  } finally {
    await db.drop();
  }
}

async function open(store, date, symbol, side, price, quantity, flow = 'fixed') {
  await store.logDecision(date, { kind: 'ENTRY', symbol, side, price, quantity, sl: side === 'long' ? price - 1 : price + 1, target: flow === 'fixed' ? (side === 'long' ? price + 2 : price - 2) : undefined, time: '09:30', flow });
  await store.save({ date, symbols: { [symbol]: { position: 'OPEN' } } });
}

// A fake candle source that records its calls.
function fakeCandles(byKey) {
  const calls = [];
  const getCandles = async (q) => {
    calls.push(q);
    const v = byKey[`${q.symbol}|${q.fromDate}`];
    if (v instanceof Error) throw v;
    return v || [];
  };
  return { getCandles, calls };
}

const trades = async (pool) =>
  (await pool.query(`select to_char(date,'YYYY-MM-DD') as date, symbol, flow, status, reason, exit_time, exit::float8 as exit, pnl::float8 as pnl from paper_trades order by date, symbol, flow`)).rows;
const states = async (pool) =>
  Object.fromEntries((await pool.query(`select to_char(date,'YYYY-MM-DD') || '|' || symbol as k, position from live_state`)).rows.map((r) => [r.k, r.position]));
const exits = async (pool) => (await pool.query(`select symbol, payload from live_decisions where kind = 'EXIT' order by id`)).rows;

const run = (pool, getCandles, now, extra = {}) => closeStaleTrades({ pool, config: cfg, getCandles, now: () => now, log: () => {}, ...extra });

test('a long left open yesterday closes EOD at the 15:09 close, gross pnl exact', { skip: noDb }, () =>
  withDb(async (pool, store) => {
    await open(store, YESTERDAY, 'NSE:A-EQ', 'long', 100, 10);
    const { getCandles } = fakeCandles({
      'NSE:A-EQ|2026-03-09': [candle(YESTERDAY, '12:00', 100, 100, 90, 95), candle(YESTERDAY, '15:08', 101, 102, 101, 101.5), candle(YESTERDAY, '15:09', 101.5, 103, 101, 102.25)],
    });
    const r = await run(pool, getCandles, ist(TODAY, '09:00'));
    assert.deepEqual(r, { closed: 1, left: 0 });
    assert.deepEqual(await trades(pool), [
      { date: YESTERDAY, symbol: 'NSE:A-EQ', flow: 'fixed', status: 'closed', reason: 'EOD', exit_time: '15:09', exit: 102.25, pnl: 22.5 },
    ]);
  }));

test('a short closes with the sign flipped', { skip: noDb }, () =>
  withDb(async (pool, store) => {
    await open(store, YESTERDAY, 'NSE:S-EQ', 'short', 100, 10);
    const { getCandles } = fakeCandles({ 'NSE:S-EQ|2026-03-09': [candle(YESTERDAY, '15:09', 99, 99, 97, 98.5)] });
    await run(pool, getCandles, ist(TODAY, '09:00'));
    const [t] = await trades(pool);
    assert.deepEqual([t.status, t.reason, t.exit, t.pnl], ['closed', 'EOD', 98.5, 15]);
  }));

test('a short that closed above its entry books a loss', { skip: noDb }, () =>
  withDb(async (pool, store) => {
    await open(store, YESTERDAY, 'NSE:S-EQ', 'short', 100, 10);
    const { getCandles } = fakeCandles({ 'NSE:S-EQ|2026-03-09': [candle(YESTERDAY, '15:09', 100, 102, 100, 101.25)] });
    await run(pool, getCandles, ist(TODAY, '09:00'));
    assert.equal((await trades(pool))[0].pnl, -12.5);
  }));

test('candles at or after sessionEnd are ignored even when last in the response', { skip: noDb }, () =>
  withDb(async (pool, store) => {
    await open(store, YESTERDAY, 'NSE:A-EQ', 'long', 100, 10);
    const { getCandles } = fakeCandles({
      'NSE:A-EQ|2026-03-09': [candle(YESTERDAY, '15:09', 100, 101, 100, 101), candle(YESTERDAY, '15:10', 101, 150, 101, 150), candle(YESTERDAY, '15:29', 150, 150, 150, 150)],
    });
    await run(pool, getCandles, ist(TODAY, '09:00'));
    const [t] = await trades(pool);
    assert.deepEqual([t.exit, t.exit_time, t.pnl], [101, '15:09', 10]);
  }));

test('the exit is the last candle before sessionEnd, not necessarily 15:09', { skip: noDb }, () =>
  withDb(async (pool, store) => {
    await open(store, YESTERDAY, 'NSE:A-EQ', 'long', 100, 1);
    const { getCandles } = fakeCandles({ 'NSE:A-EQ|2026-03-09': [candle(YESTERDAY, '14:55', 100, 100, 100, 99), candle(YESTERDAY, '15:10', 1, 1, 1, 1)] });
    await run(pool, getCandles, ist(TODAY, '09:00'));
    const [t] = await trades(pool);
    assert.deepEqual([t.exit, t.exit_time, t.pnl], [99, '14:55', -1]);
  }));

test('no stop or target replay: a 12:00 candle through the stop does not change the outcome', { skip: noDb }, () =>
  withDb(async (pool, store) => {
    await open(store, YESTERDAY, 'NSE:A-EQ', 'long', 100, 10); // sl 99, target 102
    const { getCandles } = fakeCandles({
      'NSE:A-EQ|2026-03-09': [candle(YESTERDAY, '12:00', 100, 100, 80, 85), candle(YESTERDAY, '12:01', 85, 120, 85, 110), candle(YESTERDAY, '15:09', 100, 100, 100, 100.5)],
    });
    await run(pool, getCandles, ist(TODAY, '09:00'));
    const [t] = await trades(pool);
    assert.deepEqual([t.reason, t.exit, t.pnl], ['EOD', 100.5, 5]);
  }));

test('both flows close, with one getCandles call per symbol and date', { skip: noDb }, () =>
  withDb(async (pool, store) => {
    await open(store, YESTERDAY, 'NSE:A-EQ', 'long', 100, 10, 'fixed');
    await open(store, YESTERDAY, 'NSE:A-EQ', 'long', 100, 10, 'trail');
    await open(store, YESTERDAY, 'NSE:B-EQ', 'short', 50, 2, 'fixed');
    const { getCandles, calls } = fakeCandles({
      'NSE:A-EQ|2026-03-09': [candle(YESTERDAY, '15:09', 100, 101, 100, 101)],
      'NSE:B-EQ|2026-03-09': [candle(YESTERDAY, '15:09', 50, 50, 49, 49)],
    });
    const r = await run(pool, getCandles, ist(TODAY, '09:00'));
    assert.deepEqual(r, { closed: 3, left: 0 });
    assert.equal(calls.length, 2);
    assert.deepEqual(calls.map((c) => c.symbol).sort(), ['NSE:A-EQ', 'NSE:B-EQ']);
    assert.ok(calls.every((c) => c.resolution === '1' && c.fromDate === YESTERDAY));
    assert.deepEqual((await trades(pool)).map((t) => [t.symbol, t.flow, t.status, t.exit, t.pnl]), [
      ['NSE:A-EQ', 'fixed', 'closed', 101, 10],
      ['NSE:A-EQ', 'trail', 'closed', 101, 10],
      ['NSE:B-EQ', 'fixed', 'closed', 49, 2],
    ]);
  }));

test('live_state becomes CLOSED and one catch-up EXIT decision is written per closed row', { skip: noDb }, () =>
  withDb(async (pool, store) => {
    await open(store, YESTERDAY, 'NSE:A-EQ', 'long', 100, 10, 'fixed');
    await open(store, YESTERDAY, 'NSE:A-EQ', 'long', 100, 10, 'trail');
    const { getCandles } = fakeCandles({ 'NSE:A-EQ|2026-03-09': [candle(YESTERDAY, '15:09', 100, 101, 100, 101)] });
    await run(pool, getCandles, ist(TODAY, '09:00'));
    assert.deepEqual(await states(pool), { [`${YESTERDAY}|NSE:A-EQ`]: 'CLOSED' });
    const ex = await exits(pool);
    assert.equal(ex.length, 2);
    assert.deepEqual(ex.map((e) => e.payload.flow).sort(), ['fixed', 'trail']);
    for (const e of ex) {
      assert.equal(e.symbol, 'NSE:A-EQ');
      assert.equal(e.payload.kind, 'EXIT');
      assert.equal(e.payload.reason, 'EOD');
      assert.equal(e.payload.price, 101);
      assert.equal(e.payload.time, '15:09');
      assert.equal(e.payload.catchUp, true);
    }
  }));

test('a closed row with no live_state row still closes', { skip: noDb }, () =>
  withDb(async (pool, store) => {
    await store.logDecision(YESTERDAY, { kind: 'ENTRY', symbol: 'NSE:A-EQ', side: 'long', price: 100, quantity: 1, sl: 99, target: 102, time: '09:30' });
    const { getCandles } = fakeCandles({ 'NSE:A-EQ|2026-03-09': [candle(YESTERDAY, '15:09', 100, 101, 100, 101)] });
    assert.deepEqual(await run(pool, getCandles, ist(TODAY, '09:00')), { closed: 1, left: 0 });
    assert.deepEqual(await states(pool), {});
  }));

test('today at 15:10 counts as over; today at 15:09 does not', { skip: noDb }, () =>
  withDb(async (pool, store) => {
    await open(store, TODAY, 'NSE:A-EQ', 'long', 100, 10);
    const { getCandles, calls } = fakeCandles({ 'NSE:A-EQ|2026-03-10': [candle(TODAY, '15:09', 100, 101, 100, 101)] });
    assert.deepEqual(await run(pool, getCandles, ist(TODAY, '15:09')), { closed: 0, left: 0 });
    assert.equal(calls.length, 0);
    assert.deepEqual(await run(pool, getCandles, ist(TODAY, '15:10')), { closed: 1, left: 0 });
    assert.equal((await trades(pool))[0].exit, 101);
  }));

test('the IST date decides today, not the UTC date', { skip: noDb }, () =>
  withDb(async (pool, store) => {
    // 2026-03-10 00:30 IST is still 2026-03-09 in UTC: YESTERDAY is over, TODAY (IST) is not.
    await open(store, YESTERDAY, 'NSE:A-EQ', 'long', 100, 1);
    await open(store, TODAY, 'NSE:B-EQ', 'long', 100, 1);
    const { getCandles, calls } = fakeCandles({ 'NSE:A-EQ|2026-03-09': [candle(YESTERDAY, '15:09', 100, 100, 100, 100)] });
    assert.deepEqual(await run(pool, getCandles, ist(TODAY, '00:30')), { closed: 1, left: 0 });
    assert.deepEqual(calls.map((c) => c.symbol), ['NSE:A-EQ']);
  }));

test("today's open row before sessionEnd is untouched and its candles are not fetched", { skip: noDb }, () =>
  withDb(async (pool, store) => {
    await open(store, TODAY, 'NSE:A-EQ', 'long', 100, 10);
    const { getCandles, calls } = fakeCandles({});
    const r = await run(pool, getCandles, ist(TODAY, '14:00'));
    assert.deepEqual(r, { closed: 0, left: 0 });
    assert.equal(calls.length, 0);
    assert.equal((await trades(pool))[0].status, 'open');
    assert.deepEqual(await states(pool), { [`${TODAY}|NSE:A-EQ`]: 'OPEN' });
    assert.equal((await exits(pool)).length, 0);
  }));

test('running twice closes nothing the second time, writes no decisions, fetches nothing', { skip: noDb }, () =>
  withDb(async (pool, store) => {
    await open(store, YESTERDAY, 'NSE:A-EQ', 'long', 100, 10);
    const f = fakeCandles({ 'NSE:A-EQ|2026-03-09': [candle(YESTERDAY, '15:09', 100, 101, 100, 101)] });
    assert.deepEqual(await run(pool, f.getCandles, ist(TODAY, '09:00')), { closed: 1, left: 0 });
    const before = await trades(pool);
    const calls = f.calls.length;
    assert.deepEqual(await run(pool, f.getCandles, ist(TODAY, '09:05')), { closed: 0, left: 0 });
    assert.equal(f.calls.length, calls);
    assert.equal((await exits(pool)).length, 1);
    assert.deepEqual(await trades(pool), before);
  }));

test('a getCandles failure leaves that symbol open, logs, and still closes the others', { skip: noDb }, () =>
  withDb(async (pool, store) => {
    await open(store, YESTERDAY, 'NSE:A-EQ', 'long', 100, 10, 'fixed');
    await open(store, YESTERDAY, 'NSE:A-EQ', 'long', 100, 10, 'trail');
    await open(store, YESTERDAY, 'NSE:B-EQ', 'long', 100, 10);
    const { getCandles } = fakeCandles({
      'NSE:A-EQ|2026-03-09': new Error('REST budget spent'),
      'NSE:B-EQ|2026-03-09': [candle(YESTERDAY, '15:09', 100, 101, 100, 101)],
    });
    const logs = [];
    const r = await run(pool, getCandles, ist(TODAY, '09:00'), { log: (...a) => logs.push(a.join(' ')) });
    assert.deepEqual(r, { closed: 1, left: 2 });
    assert.ok(logs.length >= 1);
    assert.ok(logs.some((l) => /REST budget spent|NSE:A-EQ/.test(l)));
    assert.deepEqual((await trades(pool)).map((t) => [t.symbol, t.flow, t.status]), [
      ['NSE:A-EQ', 'fixed', 'open'],
      ['NSE:A-EQ', 'trail', 'open'],
      ['NSE:B-EQ', 'fixed', 'closed'],
    ]);
    assert.deepEqual(await states(pool), { [`${YESTERDAY}|NSE:A-EQ`]: 'OPEN', [`${YESTERDAY}|NSE:B-EQ`]: 'CLOSED' });
  }));

test('a symbol with no candles before sessionEnd stays open', { skip: noDb }, () =>
  withDb(async (pool, store) => {
    await open(store, YESTERDAY, 'NSE:A-EQ', 'long', 100, 10);
    await open(store, YESTERDAY, 'NSE:E-EQ', 'long', 100, 10);
    const { getCandles } = fakeCandles({
      'NSE:A-EQ|2026-03-09': [candle(YESTERDAY, '15:10', 100, 100, 100, 100), candle(YESTERDAY, '15:11', 100, 100, 100, 100)],
      'NSE:E-EQ|2026-03-09': [],
    });
    assert.deepEqual(await run(pool, getCandles, ist(TODAY, '09:00')), { closed: 0, left: 2 });
    assert.deepEqual((await trades(pool)).map((t) => t.status), ['open', 'open']);
    assert.equal((await exits(pool)).length, 0);
  }));

test('an already closed row is never touched', { skip: noDb }, () =>
  withDb(async (pool, store) => {
    await open(store, YESTERDAY, 'NSE:A-EQ', 'long', 100, 10);
    await store.logDecision(YESTERDAY, { kind: 'EXIT', symbol: 'NSE:A-EQ', price: 50, quantity: 10, reason: 'SL', pnl: -500, time: '10:00' });
    const f = fakeCandles({ 'NSE:A-EQ|2026-03-09': [candle(YESTERDAY, '15:09', 100, 101, 100, 101)] });
    assert.deepEqual(await run(pool, f.getCandles, ist(TODAY, '09:00')), { closed: 0, left: 0 });
    assert.equal(f.calls.length, 0);
    const [t] = await trades(pool);
    assert.deepEqual([t.exit, t.reason, t.exit_time, t.pnl], [50, 'SL', '10:00', -500]);
  }));

test('open rows on several days each fetch their own date', { skip: noDb }, () =>
  withDb(async (pool, store) => {
    await open(store, '2026-03-06', 'NSE:A-EQ', 'long', 100, 1);
    await open(store, YESTERDAY, 'NSE:A-EQ', 'long', 100, 1);
    const { getCandles, calls } = fakeCandles({
      'NSE:A-EQ|2026-03-06': [candle('2026-03-06', '15:09', 100, 100, 100, 103)],
      'NSE:A-EQ|2026-03-09': [candle(YESTERDAY, '15:09', 100, 100, 100, 98)],
    });
    assert.deepEqual(await run(pool, getCandles, ist(TODAY, '09:00')), { closed: 2, left: 0 });
    assert.equal(calls.length, 2);
    assert.deepEqual((await trades(pool)).map((t) => [t.date, t.exit, t.pnl]), [['2026-03-06', 103, 3], [YESTERDAY, 98, -2]]);
  }));
