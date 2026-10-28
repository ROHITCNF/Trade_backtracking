const test = require('node:test');
const assert = require('node:assert/strict');
const { candle, openingRange, config } = require('./helpers');
const { createLiveSession, desiredState } = require('../server/session');

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

test('desiredState reads the engine result as a live position', () => {
  assert.deepEqual(desiredState(undefined, 600, 914), { position: 'FLAT' });
  assert.equal(desiredState({ reason: 'SL' }, 600, 914).position, 'CLOSED');
  assert.equal(desiredState({ reason: 'TARGET' }, 600, 914).position, 'CLOSED');
  assert.equal(desiredState({ reason: 'EOD' }, 600, 914).position, 'OPEN');
  assert.equal(desiredState({ reason: 'EOD' }, 914, 914).position, 'CLOSED');
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
