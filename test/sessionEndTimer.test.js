const test = require('node:test');
const assert = require('node:assert/strict');
const { candle, openingRange, config } = require('./helpers');
const { createLiveSession } = require('../server/session');
const { dateToEpoch, toMinutes } = require('../src/time');

const DATE = '2026-01-05';
const SYM = 'NSE:TEST-EQ';
const FLAT = 'NSE:FLAT-EQ';
const at = (time) => candle(DATE, time, 0, 0, 0, 0)[0];
const SESSION_END_MS = (dateToEpoch(DATE) + toMinutes('15:10') * 60) * 1000;
const ms = (time) => at(time) * 1000;

// Range 99-101: a long enters at 101, SL 99.99 (1%), fixed target 102.01 (1R).
const RANGE = openingRange(DATE);
const TRAIL = { enabled: true, stepPct: 0.5 };

function memoryStore(initial = null) {
  const store = {
    state: initial,
    decisions: [],
    load: async () => store.state,
    save: async (s) => { store.state = JSON.parse(JSON.stringify(s)); },
    logDecision: async (date, e) => { store.decisions.push({ date, ...e }); },
  };
  return store;
}

// Fake clock and timer: records every setTimer call, fires only when the test says so.
function harness({ candles = RANGE, symbols = [SYM], cfg = config(), nowMs = ms('09:12'), store = memoryStore() } = {}) {
  const feed = {};
  const clock = { ms: nowMs };
  const timers = [];
  const cleared = [];
  const session = createLiveSession({
    symbols,
    config: cfg,
    store,
    date: DATE,
    log: () => {},
    socketToken: async () => 'app:token',
    warmStart: async (syms, onSymbol) => { for (const s of syms) onSymbol(s, s === FLAT ? RANGE : candles); }, // FLAT never breaks out
    startFeed: (opts) => { Object.assign(feed, opts); return { close() {} }; },
    now: () => clock.ms,
    setTimer: (fn, delay) => { const handle = { id: timers.length + 1 }; timers.push({ fn, delay, handle }); return handle; },
    clearTimer: (h) => { cleared.push(h); },
  });
  // The timer fires at 15:10:00, so the clock moves there first.
  const fire = async (i = 0) => { clock.ms = SESSION_END_MS; await timers[i].fn(); await session.stop(); };
  return { session, store, feed, timers, cleared, fire, clock };
}

const exits = (store) => store.decisions.filter((d) => d.kind === 'EXIT');
const brief = (d) => [d.flow ?? 'fixed', d.reason, d.price, d.time];

test('start() schedules exactly one timer for 15:10:00 IST, delay = that instant minus now', async () => {
  const { session, timers } = harness();
  await session.start();
  assert.equal(timers.length, 1);
  assert.equal(timers[0].delay, SESSION_END_MS - ms('09:12'));
  assert.equal(timers[0].delay, (5 * 60 + 58) * 60 * 1000);
  await session.stop();
});

test('start() after 15:10 schedules the timer with delay 0', async () => {
  const { session, timers } = harness({ nowMs: ms('15:30') });
  await session.start();
  assert.equal(timers.length, 1);
  assert.equal(timers[0].delay, 0);
  await session.stop();
});

test('start() exactly at 15:10:00 schedules with delay 0', async () => {
  const { session, timers } = harness({ nowMs: SESSION_END_MS });
  await session.start();
  assert.equal(timers[0].delay, 0);
  await session.stop();
});

test('firing the timer closes a held fixed position as EOD at the last tick price, time 15:10', async () => {
  const { session, store, feed, fire } = harness();
  await session.start();
  feed.onOpen();
  feed.onTick(SYM, 101, at('09:31'));
  feed.onTick(SYM, 101.4, at('12:00'));
  feed.onTick(SYM, 101.6, at('15:09') + 50);
  await fire();
  assert.deepEqual(store.decisions.map((d) => d.kind), ['ENTRY', 'EXIT']);
  const x = exits(store)[0];
  assert.deepEqual([x.flow ?? 'fixed', x.side, x.reason, x.price, x.quantity, x.time, x.pnl], ['fixed', 'long', 'EOD', 101.6, 1, '15:10', 0.6]);
  assert.equal(x.date, DATE);
  assert.equal(store.state.symbols[SYM].position, 'CLOSED');
});

test('the timer close of a short mirrors: EOD at the last tick price', async () => {
  const candles = openingRange(DATE, { high: 102, low: 100 }); // short enters at 100, SL 101, target 99
  const { session, store, feed, fire } = harness({ candles });
  await session.start();
  feed.onOpen();
  feed.onTick(SYM, 100, at('09:31'));
  feed.onTick(SYM, 99.6, at('15:09') + 50);
  await fire();
  const x = exits(store)[0];
  assert.deepEqual([x.flow ?? 'fixed', x.side, x.reason, x.price, x.time, x.pnl], ['fixed', 'short', 'EOD', 99.6, '15:10', 0.4]);
  assert.equal(store.state.symbols[SYM].position, 'CLOSED');
});

test('with trail enabled the timer closes both fixed and trail at the same last price, time 15:10', async () => {
  const { session, store, feed, fire } = harness({ cfg: config({ trail: TRAIL }) });
  await session.start();
  feed.onOpen();
  feed.onTick(SYM, 101, at('09:31'));
  feed.onTick(SYM, 101.6, at('15:09') + 50);
  await fire();
  assert.deepEqual(exits(store).map(brief).sort(),
    [['fixed', 'EOD', 101.6, '15:10'], ['trail', 'EOD', 101.6, '15:10']]);
  assert.equal(store.state.symbols[SYM].position, 'CLOSED');
  assert.equal(store.state.symbols[SYM].trail, undefined);
});

test('a position with no tick after entry closes at the last completed candle close before sessionEnd', async () => {
  const candles = [...RANGE, candle(DATE, '09:30', 100, 102, 100, 101.5), candle(DATE, '14:58', 101.5, 101.7, 101.4, 101.6)];
  const { session, store, feed, fire } = harness({ candles, symbols: [SYM, FLAT], cfg: config({ trail: TRAIL }) });
  await session.start();
  feed.onOpen();
  feed.onTick(FLAT, 100, at('15:09') + 30); // the feed is live; SYM is just quiet
  await new Promise((r) => setImmediate(r)); // let the write queue drain
  assert.deepEqual(store.decisions.filter((d) => d.kind === 'ENTRY').map((d) => d.flow), ['fixed', 'trail']);
  assert.equal(exits(store).length, 0);
  await fire();
  assert.deepEqual(exits(store).map(brief).sort(),
    [['fixed', 'EOD', 101.6, '15:10'], ['trail', 'EOD', 101.6, '15:10']]);
  assert.equal(store.state.symbols[SYM].position, 'CLOSED');
});

test('a warm-started fixed position with a mid-day last candle closes at that candle close', async () => {
  const candles = [...RANGE, candle(DATE, '09:30', 100, 102, 100, 101.5), candle(DATE, '11:00', 101.5, 101.8, 101.2, 101.3)];
  const { session, store, feed, fire } = harness({ candles, symbols: [SYM, FLAT] });
  await session.start();
  feed.onOpen();
  feed.onTick(FLAT, 100, at('15:09') + 30);
  await fire();
  assert.deepEqual(exits(store).filter((d) => d.symbol === SYM).map(brief), [['fixed', 'EOD', 101.3, '15:10']]);
});

// Blind at 15:10: the books may be stale, so the timer books nothing and the
// end-of-day refresh decides from REST candles (#163 review).


test('feed never connected: the timer books nothing; refresh books the SL a later REST candle hit', async () => {
  let candles = [...RANGE, candle(DATE, '09:30', 100, 102, 100, 101.5)];
  const store = memoryStore();
  const timers = [];
  let nowMs = ms('09:12');
  const session = createLiveSession({
    symbols: [SYM], config: config(), store, date: DATE, log: () => {},
    socketToken: async () => 'app:token',
    warmStart: async (syms, onSymbol) => onSymbol(SYM, candles),
    startFeed: () => ({ close() {} }),
    now: () => nowMs,
    setTimer: (fn) => { timers.push(fn); return {}; },
    clearTimer: () => {},
  });
  await session.start();
  nowMs = SESSION_END_MS;
  await timers[0]();
  await new Promise((r) => setImmediate(r));
  assert.equal(exits(store).length, 0, 'blind: nothing booked on stale books');
  candles = [...candles, candle(DATE, '14:00', 101, 101, 98, 98.5), candle(DATE, '15:09', 98.5, 99, 98, 98.6), candle(DATE, '15:10', 98.6, 98.6, 98.6, 98.6)];
  await session.refresh();
  await session.stop();
  const [x] = exits(store);
  assert.equal(x.reason, 'SL');
  assert.equal(x.time, '14:00');
});

test('feed closed before 15:10: the timer books nothing', async () => {
  const { session, store, feed, fire } = harness({ candles: [...RANGE, candle(DATE, '09:30', 100, 102, 100, 101.5)] });
  await session.start();
  feed.onOpen();
  feed.onTick(SYM, 101.4, at('13:00'));
  feed.onClose();
  await fire();
  assert.equal(exits(store).length, 0);
});

test('a silent but connected feed (no tick for over a minute) is blind: the timer books nothing', async () => {
  const { session, store, feed, fire } = harness({ candles: [...RANGE, candle(DATE, '09:30', 100, 102, 100, 101.5)] });
  await session.start();
  feed.onOpen();
  feed.onTick(SYM, 101.4, at('13:00'));
  await fire();
  assert.equal(exits(store).length, 0);
});

test('a later tick price wins over an earlier candle close', async () => {
  const candles = [...RANGE, candle(DATE, '09:30', 100, 102, 100, 101.5)];
  const { session, store, feed, fire } = harness({ candles });
  await session.start();
  feed.onOpen();
  feed.onTick(SYM, 101.2, at('15:09') + 30);
  await fire();
  assert.deepEqual(exits(store).map(brief), [['fixed', 'EOD', 101.2, '15:10']]);
});

test('flat symbols get no EXIT when the timer fires', async () => {
  const { session, store, feed, fire } = harness({ symbols: [SYM, FLAT] });
  await session.start();
  feed.onOpen();
  feed.onTick(SYM, 101, at('09:31'));
  feed.onTick(FLAT, 100, at('09:31')); // inside the range: never enters
  feed.onTick(SYM, 101.6, at('15:09') + 50);
  await fire();
  assert.deepEqual(exits(store).map((d) => d.symbol), [SYM]);
  assert.notEqual(store.state.symbols[FLAT]?.position, 'OPEN');
});

test('a session with nothing open books no EXIT when the timer fires', async () => {
  const { session, store, fire } = harness();
  await session.start();
  await fire();
  assert.deepEqual(store.decisions, []);
});

test('firing the timer twice books exactly one EXIT per flow', async () => {
  const { session, store, feed, timers } = harness({ cfg: config({ trail: TRAIL }) });
  await session.start();
  feed.onOpen();
  feed.onTick(SYM, 101, at('09:31'));
  feed.onTick(SYM, 101.6, at('15:09') + 50);
  await timers[0].fn();
  await timers[0].fn();
  await session.stop();
  assert.deepEqual(exits(store).map(brief).sort(),
    [['fixed', 'EOD', 101.6, '15:10'], ['trail', 'EOD', 101.6, '15:10']]);
});

test('a tick at 15:10:01 that already closed the position leaves nothing for the timer: one EXIT per flow', async () => {
  const { session, store, feed, fire } = harness({ cfg: config({ trail: TRAIL }) });
  await session.start();
  feed.onOpen();
  feed.onTick(SYM, 101, at('09:31'));
  feed.onTick(SYM, 101.6, at('15:09') + 50);
  feed.onTick(SYM, 101.55, at('15:10') + 1);
  await fire();
  assert.deepEqual(exits(store).map(brief).sort(),
    [['fixed', 'EOD', 101.55, '15:10'], ['trail', 'EOD', 101.55, '15:10']]);
});

test('stop() clears the timer with the handle setTimer returned', async () => {
  const { session, timers, cleared } = harness();
  await session.start();
  assert.equal(cleared.length, 0);
  await session.stop();
  assert.equal(cleared.length, 1);
  assert.equal(cleared[0], timers[0].handle);
});

test('a timed close goes through the store: logged EXIT with reason EOD, price and time 15:10, state saved', async () => {
  const { session, store, feed, fire } = harness();
  await session.start();
  feed.onOpen();
  feed.onTick(SYM, 101, at('09:31'));
  feed.onTick(SYM, 101.6, at('15:09') + 50);
  await fire();
  const x = store.decisions[store.decisions.length - 1];
  assert.deepEqual([x.kind, x.symbol, x.reason, x.price, x.time], ['EXIT', SYM, 'EOD', 101.6, '15:10']);
  assert.equal(store.state.date, DATE);
  assert.equal(store.state.symbols[SYM].position, 'CLOSED');
});

test('a session whose date is not today by now() schedules no timer (later date)', async () => {
  const { session, timers } = harness({ nowMs: (dateToEpoch('2026-01-06') + toMinutes('09:12') * 60) * 1000 });
  await session.start();
  assert.equal(timers.length, 0);
  await session.stop();
});

test('a session whose date is not today by now() schedules no timer (earlier date)', async () => {
  const { session, timers } = harness({ nowMs: (dateToEpoch('2026-01-04') + toMinutes('09:12') * 60) * 1000 });
  await session.start();
  assert.equal(timers.length, 0);
  await session.stop();
});
