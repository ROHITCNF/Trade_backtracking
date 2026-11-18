// Issue #159: sessionEnd is exclusive and a position still open books EOD at the
// close of the last candle before it.
const test = require('node:test');
const assert = require('node:assert/strict');
const { runBacktest } = require('../src/engine');
const { candle, openingRange, config, walk } = require('./helpers');
const { createLiveSession, tickExit, candleExit } = require('../server/session');

const D = '2026-01-05';
const SE = '15:10';
const cfg = (o = {}) => config({ sessionEnd: SE, ...o });
const mm = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
// Quiet candles (inside stop and target of an entry at 101) from..to inclusive minutes.
function quiet(from, to, c = 101) {
  const out = [];
  for (let m = from; m <= to; m++) out.push(candle(D, mm(m), c, c + 0.2, c - 0.2, c));
  return out;
}
const M = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
const entryCandle = candle(D, '09:30', 100, 101.2, 100.5, 101); // long, entry 101, sl 99.99, target 102.01

// ---------- engine ----------

test('a breakout first seen on the sessionEnd candle makes no trade', () => {
  const candles = [...openingRange(D), ...quiet(M('09:30'), M('15:09'), 100), candle(D, '15:10', 100, 102, 99.9, 101.5), ...quiet(M('15:11'), M('15:29'), 100)];
  assert.deepEqual(runBacktest(candles, cfg({ targetMode: 'none' })), []);
});

test('a breakout after sessionEnd makes no trade', () => {
  const candles = [...openingRange(D), ...quiet(M('09:30'), M('15:11'), 100), candle(D, '15:12', 100, 103, 99.9, 102)];
  assert.deepEqual(runBacktest(candles, cfg({ targetMode: 'none' })), []);
});

test('a breakout on the last candle before sessionEnd still trades and exits EOD at its close', () => {
  const candles = [...openingRange(D), ...quiet(M('09:30'), M('15:08'), 100), candle(D, '15:09', 100, 101.5, 100, 101.2), ...quiet(M('15:10'), M('15:29'), 100)];
  const [t] = runBacktest(candles, cfg({ targetMode: 'none' }));
  assert.equal(t.entryTime, '15:09');
  assert.equal(t.exitReason ?? t.reason, 'EOD');
  assert.equal(t.exit, 101.2);
  assert.equal(t.exitTime, '15:09');
});

test('an open position books EOD at the 15:09 close, exitTime 15:09', () => {
  const candles = [...openingRange(D), entryCandle, ...quiet(M('09:31'), M('15:08')), candle(D, '15:09', 101, 101.3, 100.8, 100.9), ...quiet(M('15:10'), M('15:29'), 50)];
  const [t] = runBacktest(candles, cfg());
  assert.equal(t.entry, 101);
  assert.equal(t.exit, 100.9);
  assert.equal(t.exitTime, '15:09');
  assert.equal(t.exitReason ?? t.reason, 'EOD');
  assert.equal(t.pnl, -0.1);
});

test('a 15:10 candle that would hit the stop is ignored', () => {
  const candles = [...openingRange(D), entryCandle, ...quiet(M('09:31'), M('15:09')), candle(D, '15:10', 101, 101, 90, 90), ...quiet(M('15:11'), M('15:29'), 90)];
  const [t] = runBacktest(candles, cfg());
  assert.equal(t.exitTime, '15:09');
  assert.equal(t.exit, 101);
  assert.equal(t.exitReason ?? t.reason, 'EOD');
});

test('a 15:10 candle that would hit the target is ignored', () => {
  const candles = [...openingRange(D), entryCandle, ...quiet(M('09:31'), M('15:09')), candle(D, '15:10', 101, 120, 101, 120)];
  const [t] = runBacktest(candles, cfg());
  assert.equal(t.exitTime, '15:09');
  assert.equal(t.exit, 101);
});

test('a stop hit on the 15:09 candle is a stop, not EOD', () => {
  const candles = [...openingRange(D), entryCandle, ...quiet(M('09:31'), M('15:08')), candle(D, '15:09', 101, 101, 99, 99.5)];
  const [t] = runBacktest(candles, cfg());
  assert.equal(t.exitReason ?? t.reason, 'SL');
  assert.equal(t.exit, 99.99);
  assert.equal(t.exitTime, '15:09');
});

test('short mirror: EOD at the 15:09 close, 15:10 ignored', () => {
  const short = candle(D, '09:30', 99.5, 99.5, 98.5, 98.8); // entry 99
  const candles = [...openingRange(D), short, ...quiet(M('09:31'), M('15:08'), 99), candle(D, '15:09', 99, 99.2, 98.9, 98.95), candle(D, '15:10', 99, 120, 99, 120)];
  const [t] = runBacktest(candles, cfg());
  assert.equal(t.side, 'short');
  assert.equal(t.exit, 98.95);
  assert.equal(t.exitTime, '15:09');
  assert.equal(t.exitReason ?? t.reason, 'EOD');
});

test('a missing last candle: EOD at the last candle that exists before sessionEnd', () => {
  const candles = [...openingRange(D), entryCandle, ...quiet(M('09:31'), M('15:04')), candle(D, '15:05', 101, 101.2, 100.7, 100.8), ...quiet(M('15:12'), M('15:29'), 50)];
  const [t] = runBacktest(candles, cfg());
  assert.equal(t.exit, 100.8);
  assert.equal(t.exitTime, '15:05');
  assert.equal(t.exitReason ?? t.reason, 'EOD');
});

test('1R equals 1% with sessionEnd 15:10 over a random walk', () => {
  const candles = walk(7, 500, 40);
  const a = runBacktest(candles, cfg({ slMode: 'pct', slPct: 1, targetMode: 'R', targetR: 1 }));
  const b = runBacktest(candles, cfg({ slMode: 'pct', slPct: 1, targetMode: 'pct', targetPct: 1 }));
  assert.ok(a.length > 5);
  assert.deepEqual(a, b);
  assert.ok(a.every((t) => t.exitTime <= '15:09'), 'no exit at or after sessionEnd');
});

// ---------- live exits ----------

const SEM = M(SE); // 910

test('tickExit: EOD for a tick at sessionEnd, none a minute earlier', () => {
  const long = { side: 'long', sl: 99, target: 102 };
  assert.equal(tickExit(long, 100, M('15:09'), SEM), null);
  assert.equal(tickExit(long, 100, M('15:10'), SEM), 'EOD');
  assert.equal(tickExit(long, 100, M('15:11'), SEM), 'EOD');
  assert.equal(tickExit(long, 98, M('15:10'), SEM), 'SL', 'stop still wins at sessionEnd');
});

test('candleExit: EOD at the close of the sessionEnd-1 candle', () => {
  const long = { side: 'long', sl: 99, target: 102 };
  assert.deepEqual(candleExit(long, [0, 100, 101, 99.5, 100.4], M('15:09'), SEM), { reason: 'EOD', price: 100.4 });
  assert.equal(candleExit(long, [0, 100, 101, 99.5, 100.4], M('15:08'), SEM), null);
});

test('candleExit: stop beats target and EOD on the 15:09 candle', () => {
  const long = { side: 'long', sl: 99, target: 102 };
  assert.deepEqual(candleExit(long, [0, 100, 103, 98, 100], M('15:09'), SEM), { reason: 'SL', price: 99 });
  assert.deepEqual(candleExit(long, [0, 100, 103, 99.5, 102.5], M('15:09'), SEM), { reason: 'TARGET', price: 102 });
  const short = { side: 'short', sl: 101, target: 98 };
  assert.deepEqual(candleExit(short, [0, 100, 102, 97, 100], M('15:09'), SEM), { reason: 'SL', price: 101 });
  assert.deepEqual(candleExit(short, [0, 100, 100.5, 99.5, 99.7], M('15:09'), SEM), { reason: 'EOD', price: 99.7 });
});

// ---------- live session ----------

const SYM = 'NSE:TEST-EQ';
const at = (time) => candle(D, time, 0, 0, 0, 0)[0];

function memoryStore() {
  const store = {
    state: null,
    decisions: [],
    load: async () => store.state,
    save: async (s) => { store.state = JSON.parse(JSON.stringify(s)); },
    logDecision: async (date, e) => { store.decisions.push({ date, ...e }); },
  };
  return store;
}

function harness(pulls) {
  let n = 0;
  const store = memoryStore();
  const feed = {};
  const session = createLiveSession({
    symbols: [SYM],
    config: cfg(),
    store,
    date: D,
    log: () => {},
    socketToken: async () => 'app:token',
    warmStart: async (symbols, onSymbol) => { onSymbol(SYM, pulls[Math.min(n++, pulls.length - 1)]); },
    startFeed: (opts) => { Object.assign(feed, opts); return { close() {} }; },
  });
  return { session, store, feed };
}
const exits = (store) => store.decisions.filter((d) => d.kind === 'EXIT' && (d.flow ?? 'fixed') === 'fixed');
const entries = (store) => store.decisions.filter((d) => d.kind === 'ENTRY');

test('refresh books EOD at the 15:09 close even when REST also returns 15:10+ candles', async () => {
  const early = [...openingRange(D), entryCandle, ...quiet(M('09:31'), M('15:00'))];
  const full = [...openingRange(D), entryCandle, ...quiet(M('09:31'), M('15:08')), candle(D, '15:09', 101, 101.3, 100.8, 100.9), candle(D, '15:10', 101, 101, 90, 90), ...quiet(M('15:11'), M('15:29'), 90)];
  const { session, store } = harness([early, full]);
  await session.start();
  await session.refresh();
  await session.stop();
  assert.equal(entries(store).length, 1);
  const [x] = exits(store);
  assert.ok(x, 'an exit was recorded');
  assert.equal(x.reason, 'EOD');
  assert.equal(x.price, 100.9);
  assert.equal(x.time, '15:09');
  assert.equal(exits(store).length, 1);
});

test('a tick at 15:10:02 closes the open position as EOD at the tick price', async () => {
  const early = [...openingRange(D), entryCandle, ...quiet(M('09:31'), M('15:05'))];
  const { session, store, feed } = harness([early]);
  await session.start();
  feed.onOpen();
  feed.onTick(SYM, 100.7, at('15:10') + 2);
  await session.stop();
  const [x] = exits(store);
  assert.ok(x, 'an exit was recorded');
  assert.equal(x.reason, 'EOD');
  assert.equal(x.price, 100.7);
  assert.equal(x.time, '15:10');
});

test('a breakout tick at 15:10 does not open a position', async () => {
  const early = [...openingRange(D), ...quiet(M('09:30'), M('15:08'), 100)];
  const { session, store, feed } = harness([early]);
  await session.start();
  feed.onOpen();
  feed.onTick(SYM, 103, at('15:10') + 2);
  feed.onTick(SYM, 104, at('15:11'));
  await session.stop();
  assert.equal(entries(store).length, 0);
  assert.equal(session.status().open, 0);
});
