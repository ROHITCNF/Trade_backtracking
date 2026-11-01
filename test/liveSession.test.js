const test = require('node:test');
const assert = require('node:assert/strict');
const { candle, openingRange, config } = require('./helpers');
const { createLiveSession, tickExit, candleExit } = require('../server/session');

const DATE = '2026-01-05';
const SYM = 'NSE:TEST-EQ';
const at = (time) => candle(DATE, time, 0, 0, 0, 0)[0];

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

// A session wired to fakes: warm start hands back `candles`, the feed captures
// its handlers so the test can push ticks and reconnects by hand.
function harness({ candles = openingRange(DATE), store = memoryStore() } = {}) {
  const feed = { closed: 0 };
  const session = createLiveSession({
    symbols: [SYM],
    config: config(),
    store,
    date: DATE,
    log: () => {},
    socketToken: async () => 'app:token',
    warmStart: async (symbols, onSymbol) => { for (const s of symbols) onSymbol(s, candles); },
    startFeed: (opts) => {
      Object.assign(feed, opts);
      return { close: () => { feed.closed++; } };
    },
  });
  const settle = () => session.stop(); // flushes the write queue
  return { session, store, feed, settle };
}

const kinds = (store) => store.decisions.map((d) => d.kind);

test('tickExit: stop, target, then EOD at sessionEnd', () => {
  const long = { side: 'long', sl: 99, target: 102 };
  assert.equal(tickExit(long, 100, 600, 914), null);
  assert.equal(tickExit(long, 99, 600, 914), 'SL');
  assert.equal(tickExit(long, 98.5, 600, 914), 'SL');
  assert.equal(tickExit(long, 102.1, 600, 914), 'TARGET');
  assert.equal(tickExit(long, 100, 914, 914), 'EOD');
  const short = { side: 'short', sl: 101, target: null };
  assert.equal(tickExit(short, 101.2, 600, 914), 'SL');
  assert.equal(tickExit(short, 90, 600, 914), null, 'no target');
});

test('candleExit: stop wins a candle touching both, fills at the level', () => {
  const long = { side: 'long', sl: 99, target: 102 };
  assert.deepEqual(candleExit(long, [0, 100, 103, 98, 100], 600, 914), { reason: 'SL', price: 99 });
  assert.deepEqual(candleExit(long, [0, 100, 103, 99.5, 102.5], 600, 914), { reason: 'TARGET', price: 102 });
  assert.deepEqual(candleExit(long, [0, 100, 101, 99.5, 100.4], 914, 914), { reason: 'EOD', price: 100.4 });
  assert.equal(candleExit(long, [0, 100, 101, 99.5, 100.4], 600, 914), null);
});

test('a breakout tick enters once, a stop tick exits, and state follows', async () => {
  const { session, store, feed, settle } = harness();
  await session.start();
  feed.onOpen();

  feed.onTick(SYM, 102, at('09:31'));
  feed.onTick(SYM, 102.5, at('09:31')); // range moves again; still the same position
  assert.deepEqual(kinds(store), []); // writes are queued, not yet flushed
  await settle();
  assert.deepEqual(kinds(store), ['ENTRY']);
  assert.equal(store.decisions[0].side, 'long');
  assert.equal(store.state.symbols[SYM].position, 'OPEN');

  feed.onTick(SYM, 100, at('09:32'));
  await settle();
  assert.deepEqual(kinds(store), ['ENTRY', 'EXIT']);
  assert.equal(store.decisions[1].reason, 'SL');
  assert.equal(store.state.symbols[SYM].position, 'CLOSED');
});

test('a restart with the position saved does not enter again', async () => {
  const candles = [...openingRange(DATE), candle(DATE, '09:30', 100, 102, 100, 101.5)];
  const store = memoryStore({ date: DATE, symbols: { [SYM]: { position: 'OPEN' } } });
  const { session, feed, settle } = harness({ candles, store });
  await session.start();
  feed.onOpen();
  feed.onTick(SYM, 101.8, at('09:31'));
  await settle();
  assert.deepEqual(kinds(store), []);
  assert.equal(session.status().open, 1);
});

test('warm start alone records a breakout that happened before launch', async () => {
  const candles = [...openingRange(DATE), candle(DATE, '09:30', 100, 102, 100, 101.5)];
  const { session, store, settle } = harness({ candles });
  await session.start();
  await settle();
  assert.deepEqual(kinds(store), ['ENTRY']);
  assert.equal(store.state.symbols[SYM].position, 'OPEN');
});

test('ticks from another day or outside the session are ignored', async () => {
  const { session, store, feed, settle } = harness();
  await session.start();
  feed.onTick(SYM, 102, at('09:31') + 86400); // next day
  feed.onTick(SYM, 102, at('15:20')); // after sessionEnd
  feed.onTick('NSE:OTHER-EQ', 102, at('09:31')); // not subscribed
  await settle();
  assert.deepEqual(kinds(store), []);
  assert.equal(session.status().lastTickAt, null);
});

test('a reconnect backfills from REST before evaluating', async () => {
  let pulls = 0;
  const store = memoryStore();
  const feed = {};
  const session = createLiveSession({
    symbols: [SYM],
    config: config(),
    store,
    date: DATE,
    log: () => {},
    socketToken: async () => 'app:token',
    warmStart: async (symbols, onSymbol) => {
      pulls++;
      // The second pull (after the reconnect) carries a breakout the socket missed.
      const extra = pulls > 1 ? [candle(DATE, '09:30', 100, 102, 100, 101.5)] : [];
      onSymbol(SYM, [...openingRange(DATE), ...extra]);
    },
    startFeed: (opts) => { Object.assign(feed, opts); return { close() {} }; },
  });
  await session.start();
  feed.onOpen();
  await feed.onOpen();
  await session.stop();
  assert.equal(pulls, 2);
  assert.deepEqual(kinds(store), ['ENTRY']);
});

test('stop closes the feed once and can be called twice', async () => {
  const { session, feed } = harness();
  await session.start();
  await session.stop();
  await session.stop();
  assert.equal(feed.closed, 1);
  assert.equal(session.status().running, false);
});

test('start fails without a token and opens no feed', async () => {
  let fed = false;
  const session = createLiveSession({
    symbols: [SYM],
    config: config(),
    store: memoryStore(),
    date: DATE,
    log: () => {},
    socketToken: async () => { throw new Error('No Fyers token for today'); },
    warmStart: async () => {},
    startFeed: () => { fed = true; },
  });
  await assert.rejects(session.start(), /No Fyers token/);
  await assert.rejects(session.start(), /No Fyers token/); // retryable, not stuck "running"
  assert.equal(fed, false);
  assert.equal(session.status().running, false);
});

test('refresh books the EOD exit of a position held into sessionEnd', async () => {
  let candles = [...openingRange(DATE), candle(DATE, '09:30', 100, 102, 100, 101.5)];
  const store = memoryStore();
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
  // No tick ever arrives after sessionEnd; the end-of-day REST pull carries it.
  candles = [...candles, candle(DATE, '15:14', 101.6, 101.7, 101.5, 101.6)];
  await session.refresh();
  await session.stop();
  assert.deepEqual(kinds(store), ['ENTRY', 'EXIT']);
  assert.equal(store.decisions[1].reason, 'EOD');
  assert.equal(store.state.symbols[SYM].position, 'CLOSED');
});

// D24: once in, live follows the socket's prices, not the engine.

test('entry fills at the breakout tick, exit at the tick through the stop (slippage kept)', async () => {
  const { session, store, feed, settle } = harness();
  await session.start();
  feed.onOpen();
  feed.onTick(SYM, 100.5, at('09:30'));
  feed.onTick(SYM, 101.07, at('09:30') + 20); // first tick over the 101 range high
  feed.onTick(SYM, 99.5, at('09:31') + 5); // straight through the 99.99 stop
  await settle();
  const [entry, exit] = store.decisions;
  assert.deepEqual([entry.kind, entry.price, entry.time, entry.sl], ['ENTRY', 101.07, '09:30', 99.99]);
  assert.deepEqual([exit.kind, exit.reason, exit.price, exit.time], ['EXIT', 'SL', 99.5, '09:31']);
  assert.equal(exit.pnl, Math.round((99.5 - 101.07) * entry.quantity * 100) / 100);
});

test('whipsaw in the breakout minute: the long is stopped out, never swapped for a short', async () => {
  const { session, store, feed, settle } = harness();
  await session.start();
  feed.onOpen();
  feed.onTick(SYM, 100.5, at('09:35'));
  feed.onTick(SYM, 101.2, at('09:35') + 10); // breaks up: long
  feed.onTick(SYM, 98.8, at('09:35') + 40); // same minute, through the bottom of the range
  feed.onTick(SYM, 97.5, at('09:36') + 30); // the engine would now see a short; live is done
  await settle();
  assert.deepEqual(store.decisions.map((d) => [d.kind, d.side, d.reason ?? null]), [['ENTRY', 'long', null], ['EXIT', 'long', 'SL']]);
  assert.equal(store.decisions[1].price, 98.8);
  assert.equal(store.state.symbols[SYM].position, 'CLOSED');
});

test('target first, then stop, in one minute: live keeps the target the backtest would deny', async () => {
  const { session, store, feed, settle } = harness();
  await session.start();
  feed.onOpen();
  feed.onTick(SYM, 101.0, at('09:31'));
  feed.onTick(SYM, 101.5, at('09:40'));
  feed.onTick(SYM, 102.05, at('09:40') + 10); // target 102.01
  feed.onTick(SYM, 99.8, at('09:40') + 50); // then the stop's price, same minute
  await settle();
  assert.deepEqual(kinds(store), ['ENTRY', 'EXIT']);
  assert.deepEqual([store.decisions[1].reason, store.decisions[1].price], ['TARGET', 102.05]);
});

test('the first tick at sessionEnd closes the position as EOD', async () => {
  const { session, store, feed, settle } = harness();
  await session.start();
  feed.onOpen();
  feed.onTick(SYM, 101.2, at('09:31'));
  feed.onTick(SYM, 101.6, at('15:13') + 50);
  feed.onTick(SYM, 101.55, at('15:14') + 2);
  await settle();
  assert.deepEqual([store.decisions[1].reason, store.decisions[1].price, store.decisions[1].time], ['EOD', 101.55, '15:14']);
});

test('a restart mid-trade keeps the saved levels and checks the blind minutes on REST candles', async () => {
  const kept = { position: 'OPEN', side: 'long', entry: 101.07, sl: 99.99, target: 102.01, quantity: 49, entryTime: '09:30' };
  const candles = [...openingRange(DATE), candle(DATE, '09:30', 100, 101.3, 100.5, 101.1), candle(DATE, '09:45', 101, 101.2, 99.7, 100)];
  const store = memoryStore({ date: DATE, symbols: { [SYM]: kept } });
  const { session, settle } = harness({ candles, store });
  await session.start();
  await settle();
  // While the server was down, 09:45 went through the stop: exit there, at the level.
  assert.deepEqual(store.decisions.map((d) => [d.kind, d.reason, d.price, d.time]), [['EXIT', 'SL', 99.99, '09:45']]);
  assert.equal(store.decisions[0].pnl, Math.round((99.99 - 101.07) * 49 * 100) / 100);
});

test('a restart mid-trade with nothing missed keeps holding and watches ticks', async () => {
  const kept = { position: 'OPEN', side: 'long', entry: 101.07, sl: 99.99, target: 102.01, quantity: 49, entryTime: '09:30' };
  const candles = [...openingRange(DATE), candle(DATE, '09:30', 100, 101.3, 100.5, 101.1)];
  const store = memoryStore({ date: DATE, symbols: { [SYM]: kept } });
  const { session, feed, settle } = harness({ candles, store });
  await session.start();
  feed.onOpen();
  feed.onTick(SYM, 102.3, at('10:00'));
  await settle();
  assert.deepEqual(store.decisions.map((d) => [d.kind, d.reason, d.price]), [['EXIT', 'TARGET', 102.3]]);
});
