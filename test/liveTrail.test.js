const test = require('node:test');
const assert = require('node:assert/strict');
const { candle, openingRange, config } = require('./helpers');
const { createLiveSession } = require('../server/session');

const DATE = '2026-01-05';
const SYM = 'NSE:TEST-EQ';
const at = (time) => candle(DATE, time, 0, 0, 0, 0)[0];

// Range 98-100: a long enters at 100 with SL 99 (1%), fixed target 103 (3R), step 0.5 -> 0.5 points.
const LONG_RANGE = openingRange(DATE, { high: 100, low: 98 });
// Range 100-102: a short enters at 100 with SL 101, fixed target 97.
const SHORT_RANGE = openingRange(DATE, { high: 102, low: 100 });
const cfg = () => config({ targetR: 3, trail: { enabled: true, stepPct: 0.5 } });

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

function harness({ candles = LONG_RANGE, store = memoryStore() } = {}) {
  const feed = {};
  const session = createLiveSession({
    symbols: [SYM],
    config: cfg(),
    store,
    date: DATE,
    log: () => {},
    socketToken: async () => 'app:token',
    warmStart: async (symbols, onSymbol) => { for (const s of symbols) onSymbol(s, candles); },
    startFeed: (opts) => { Object.assign(feed, opts); return { close() {} }; },
  });
  return { session, store, feed, settle: () => session.stop() };
}

const flow = (store, f) => store.decisions.filter((d) => d.flow === f);
const pick = (d, ...keys) => Object.fromEntries(keys.map((k) => [k, d[k]]));
const savedTrail = (over = {}) => ({
  side: 'long', entry: 100, sl: 99.5, initialSl: 99, best: 100.5, target: null, quantity: 1, entryTime: '09:31', ...over,
});
const savedStore = (trail) => memoryStore({ date: DATE, symbols: { [SYM]: { position: 'OPEN', trail } } });
const trailCandle = (time, o, h, l, c) => candle(DATE, time, o, h, l, c);
const entryCandle = trailCandle('09:31', 100, 100.4, 100.1, 100.3);

test('a breakout tick opens a fixed then a trail entry with the same levels', async () => {
  const { session, store, feed, settle } = harness();
  await session.start();
  feed.onOpen();
  feed.onTick(SYM, 100, at('09:31'));
  await settle();
  assert.equal(store.decisions.length, 2);
  const [f, t] = store.decisions;
  assert.deepEqual(pick(f, 'kind', 'flow', 'side', 'price', 'quantity', 'sl', 'target', 'time'),
    { kind: 'ENTRY', flow: 'fixed', side: 'long', price: 100, quantity: 1, sl: 99, target: 103, time: '09:31' });
  assert.deepEqual(pick(t, 'kind', 'flow', 'side', 'price', 'quantity', 'sl', 'target', 'time', 'best'),
    { kind: 'ENTRY', flow: 'trail', side: 'long', price: 100, quantity: 1, sl: 99, target: null, time: '09:31', best: 100 });
  const saved = store.state.symbols[SYM];
  assert.equal(saved.position, 'OPEN');
  assert.equal(saved.sl, 99);
  assert.equal(saved.target, 103);
  assert.deepEqual(pick(saved.trail, 'side', 'entry', 'sl', 'initialSl', 'best', 'target', 'quantity', 'entryTime'),
    { side: 'long', entry: 100, sl: 99, initialSl: 99, best: 100, target: null, quantity: 1, entryTime: '09:31' });
});

test('ticks +0.5% and +1% step the trail SL, one TRAIL each; a best-only tick emits nothing', async () => {
  const { session, store, feed, settle } = harness();
  await session.start();
  feed.onOpen();
  feed.onTick(SYM, 100, at('09:31'));
  feed.onTick(SYM, 100.2, at('09:32')); // best up, no full step
  feed.onTick(SYM, 100.5, at('09:33')); // step 1
  feed.onTick(SYM, 100.8, at('09:34')); // best up, no new step
  feed.onTick(SYM, 101, at('09:35')); // step 2
  await settle();
  const trails = store.decisions.filter((d) => d.kind === 'TRAIL');
  assert.deepEqual(trails.map((d) => pick(d, 'flow', 'symbol', 'side', 'sl', 'best', 'time')), [
    { flow: 'trail', symbol: SYM, side: 'long', sl: 99.5, best: 100.5, time: '09:33' },
    { flow: 'trail', symbol: SYM, side: 'long', sl: 100, best: 101, time: '09:35' },
  ]);
  assert.equal(store.state.symbols[SYM].trail.sl, 100);
  assert.equal(store.state.symbols[SYM].trail.best, 101);
  assert.equal(store.state.symbols[SYM].trail.initialSl, 99);
});

test('a pullback under the stepped SL exits the trail at the tick price; fixed stays open', async () => {
  const { session, store, feed, settle } = harness();
  await session.start();
  feed.onOpen();
  feed.onTick(SYM, 100, at('09:31'));
  feed.onTick(SYM, 101, at('09:32')); // SL -> 100
  feed.onTick(SYM, 101.3, at('09:33'));
  feed.onTick(SYM, 99.9, at('09:34') + 5); // through the stepped SL, above fixed SL 99
  await settle();
  const exits = store.decisions.filter((d) => d.kind === 'EXIT');
  assert.equal(exits.length, 1);
  assert.deepEqual(pick(exits[0], 'flow', 'side', 'price', 'quantity', 'reason', 'pnl', 'time'),
    { flow: 'trail', side: 'long', price: 99.9, quantity: 1, reason: 'SL', pnl: -0.1, time: '09:34' });
  assert.equal(store.state.symbols[SYM].position, 'OPEN');
  assert.equal(store.state.symbols[SYM].trail, undefined, 'trail closed');
  assert.equal(store.state.symbols[SYM].sl, 99, 'fixed levels remain');
});

test('trail does not move back after a pullback that stays above the SL, and exits at the stepped level, not the start', async () => {
  const { session, store, feed, settle } = harness();
  await session.start();
  feed.onOpen();
  feed.onTick(SYM, 100, at('09:31'));
  feed.onTick(SYM, 101, at('09:32')); // SL -> 100
  feed.onTick(SYM, 100.3, at('09:33')); // pullback, still above 100: no event
  feed.onTick(SYM, 99.95, at('09:34')); // below stepped SL 100 though above the start 99
  await settle();
  assert.deepEqual(store.decisions.filter((d) => d.kind === 'TRAIL').length, 1);
  const x = flow(store, 'trail').find((d) => d.kind === 'EXIT');
  assert.deepEqual([x.reason, x.price], ['SL', 99.95]);
});

test('a tick exactly at the current SL exits SL with no TRAIL', async () => {
  const { session, store, feed, settle } = harness();
  await session.start();
  feed.onOpen();
  feed.onTick(SYM, 100, at('09:31'));
  feed.onTick(SYM, 100.5, at('09:32')); // SL -> 99.5
  feed.onTick(SYM, 99.5, at('09:33'));
  await settle();
  assert.deepEqual(flow(store, 'trail').map((d) => d.kind), ['ENTRY', 'TRAIL', 'EXIT']);
  assert.deepEqual(pick(flow(store, 'trail')[2], 'reason', 'price'), { reason: 'SL', price: 99.5 });
});

test('fixed exits on its own target while the trail keeps running; CLOSED only after both', async () => {
  const { session, store, feed, settle } = harness();
  await session.start();
  feed.onOpen();
  feed.onTick(SYM, 100, at('09:31'));
  feed.onTick(SYM, 103.2, at('09:40')); // fixed target 103; trail best 103.2 (SL steps first? tick checks SL then steps)
  await settle();
  const fx = flow(store, 'fixed').find((d) => d.kind === 'EXIT');
  assert.deepEqual(pick(fx, 'reason', 'price'), { reason: 'TARGET', price: 103.2 });
  assert.equal(flow(store, 'trail').some((d) => d.kind === 'EXIT'), false);
  assert.equal(store.state.symbols[SYM].position, 'OPEN');
  assert.ok(store.state.symbols[SYM].trail);
  // Trail SL after best 103.2: k = 6 -> 99 + 3 = 102.
  assert.equal(store.state.symbols[SYM].trail.sl, 102);

  feed.onTick(SYM, 101.9, at('09:41'));
  await settle();
  const tx = flow(store, 'trail').find((d) => d.kind === 'EXIT');
  assert.deepEqual(pick(tx, 'reason', 'price', 'pnl'), { reason: 'SL', price: 101.9, pnl: 1.9 });
  assert.equal(store.state.symbols[SYM].position, 'CLOSED');
});

test('both flows stopped by a tick through the starting SL: two exits, then CLOSED', async () => {
  const { session, store, feed, settle } = harness();
  await session.start();
  feed.onOpen();
  feed.onTick(SYM, 100, at('09:31'));
  feed.onTick(SYM, 98.8, at('09:32'));
  await settle();
  const exits = store.decisions.filter((d) => d.kind === 'EXIT');
  assert.deepEqual(exits.map((d) => [d.flow, d.reason, d.price]).sort(), [['fixed', 'SL', 98.8], ['trail', 'SL', 98.8]]);
  assert.equal(store.state.symbols[SYM].position, 'CLOSED');
});

test('short mirror: SL steps down with best, a bounce through it exits, fixed independent', async () => {
  const { session, store, feed, settle } = harness({ candles: SHORT_RANGE });
  await session.start();
  feed.onOpen();
  feed.onTick(SYM, 100, at('09:31'));
  feed.onTick(SYM, 99.7, at('09:32')); // best only
  feed.onTick(SYM, 99.5, at('09:33')); // step 1: SL 100.5
  feed.onTick(SYM, 99, at('09:34')); // step 2: SL 100
  feed.onTick(SYM, 100.2, at('09:35')); // through SL 100, below fixed SL 101
  await settle();
  const entry = flow(store, 'trail')[0];
  assert.deepEqual(pick(entry, 'kind', 'side', 'price', 'sl', 'target', 'best'),
    { kind: 'ENTRY', side: 'short', price: 100, sl: 101, target: null, best: 100 });
  assert.deepEqual(store.decisions.filter((d) => d.kind === 'TRAIL').map((d) => pick(d, 'side', 'sl', 'best', 'time')), [
    { side: 'short', sl: 100.5, best: 99.5, time: '09:33' },
    { side: 'short', sl: 100, best: 99, time: '09:34' },
  ]);
  const tx = flow(store, 'trail').find((d) => d.kind === 'EXIT');
  assert.deepEqual(pick(tx, 'reason', 'price', 'pnl'), { reason: 'SL', price: 100.2, pnl: -0.2 });
  assert.equal(flow(store, 'fixed').some((d) => d.kind === 'EXIT'), false);
  assert.equal(store.state.symbols[SYM].position, 'OPEN');
});

test('the first tick at sessionEnd closes the trail as EOD, as it does the fixed', async () => {
  const { session, store, feed, settle } = harness();
  await session.start();
  feed.onOpen();
  feed.onTick(SYM, 100, at('09:31'));
  feed.onTick(SYM, 100.3, at('15:13') + 50);
  feed.onTick(SYM, 100.25, at('15:14') + 2);
  await settle();
  const exits = store.decisions.filter((d) => d.kind === 'EXIT');
  assert.deepEqual(exits.map((d) => [d.flow, d.reason, d.price, d.time]).sort(),
    [['fixed', 'EOD', 100.25, '15:14'], ['trail', 'EOD', 100.25, '15:14']]);
  assert.equal(store.state.symbols[SYM].position, 'CLOSED');
});

test('warm start from candles opens both flows; refresh books EOD for both at the sessionEnd close', async () => {
  let candles = [...LONG_RANGE, trailCandle('09:30', 99.9, 100, 99.8, 99.95)];
  const store = memoryStore();
  const session = createLiveSession({
    symbols: [SYM], config: cfg(), store, date: DATE, log: () => {},
    socketToken: async () => 'app:token',
    warmStart: async (symbols, onSymbol) => onSymbol(SYM, candles),
    startFeed: () => ({ close() {} }),
  });
  await session.start();
  candles = [...candles, trailCandle('15:14', 100.1, 100.4, 100, 100.3)];
  await session.refresh();
  await session.stop();
  assert.deepEqual(store.decisions.slice(0, 2).map((d) => [d.kind, d.flow]), [['ENTRY', 'fixed'], ['ENTRY', 'trail']]);
  const trailEntry = flow(store, 'trail')[0];
  assert.deepEqual(pick(trailEntry, 'price', 'sl', 'target', 'best'), { price: 100, sl: 99, target: null, best: 100 });
  const exits = store.decisions.filter((d) => d.kind === 'EXIT');
  assert.deepEqual(exits.map((d) => [d.flow, d.reason, d.price]).sort(), [['fixed', 'EOD', 100.3], ['trail', 'EOD', 100.3]]);
  assert.equal(store.state.symbols[SYM].position, 'CLOSED');
});

// Blind minutes through completed candles.

test('blind candle that breaches the SL and would step: SL exit at the SL level, no TRAIL', async () => {
  const store = savedStore(savedTrail());
  const candles = [...LONG_RANGE, entryCandle, trailCandle('09:40', 100.2, 101.2, 99.4, 100)];
  const { session, settle } = harness({ candles, store });
  await session.start();
  await settle();
  assert.deepEqual(store.decisions.map((d) => [d.kind, d.flow, d.reason, d.price, d.time]), [['EXIT', 'trail', 'SL', 99.5, '09:40']]);
  assert.equal(store.decisions[0].pnl, -0.5);
  assert.equal(store.state.symbols[SYM].position, 'CLOSED');
});

test('blind candle that only rises steps the SL and stamps the candle minute', async () => {
  const store = savedStore(savedTrail());
  const candles = [...LONG_RANGE, entryCandle, trailCandle('09:40', 100.4, 101.2, 100.2, 101)];
  const { session, settle } = harness({ candles, store });
  await session.start();
  await settle();
  assert.deepEqual(store.decisions.map((d) => pick(d, 'kind', 'flow', 'sl', 'best', 'time')),
    [{ kind: 'TRAIL', flow: 'trail', sl: 100, best: 101.2, time: '09:40' }]);
  assert.equal(store.state.symbols[SYM].position, 'OPEN');
  assert.equal(store.state.symbols[SYM].trail.sl, 100);
});

test('blind short candle: high checked against the SL first, fills at the SL level', async () => {
  const store = savedStore(savedTrail({ side: 'short', sl: 100.5, initialSl: 101, best: 99.5 }));
  const candles = [...SHORT_RANGE, trailCandle('09:31', 100, 100.2, 99.6, 99.8), trailCandle('09:40', 99.8, 100.6, 98.8, 99)];
  const { session, settle } = harness({ candles, store });
  await session.start();
  await settle();
  assert.deepEqual(store.decisions.map((d) => [d.kind, d.flow, d.reason, d.price, d.time]), [['EXIT', 'trail', 'SL', 100.5, '09:40']]);
  assert.equal(store.decisions[0].pnl, -0.5);
});

test('a missed candle at sessionEnd books the trail EOD at that candle close', async () => {
  const store = savedStore(savedTrail());
  const candles = [...LONG_RANGE, entryCandle, trailCandle('15:14', 100.4, 100.45, 100.2, 100.3)];
  const { session, settle } = harness({ candles, store });
  await session.start();
  await settle();
  assert.deepEqual(store.decisions.map((d) => [d.kind, d.flow, d.reason, d.price]), [['EXIT', 'trail', 'EOD', 100.3]]);
});

// Restart.

test('restart with only a saved trail: keeps the stepped SL, never re-enters or re-opens fixed', async () => {
  const store = savedStore(savedTrail({ best: 100.6 }));
  const { session, feed, settle } = harness({ candles: [...LONG_RANGE, trailCandle('09:31', 100, 100.6, 100.1, 100.4)], store });
  await session.start();
  feed.onOpen();
  feed.onTick(SYM, 100.9, at('09:40')); // best up, still one step
  feed.onTick(SYM, 100.7, at('09:41'));
  await settle();
  assert.deepEqual(store.decisions, [], 'no ENTRY, no fixed events, no TRAIL');
  const saved = store.state.symbols[SYM];
  assert.equal(saved.position, 'OPEN');
  // Whether a best-only tick is persisted is left open; it must never fall below the restored best.
  assert.deepEqual(pick(saved.trail, 'sl', 'initialSl'), { sl: 99.5, initialSl: 99 });
  assert.ok(saved.trail.best >= 100.6);
});

test('restart resumes stepping from the saved best: 99.5 holds, then 100 at best 101', async () => {
  const store = savedStore(savedTrail({ best: 100.6 }));
  const { session, feed, settle } = harness({ candles: [...LONG_RANGE, trailCandle('09:31', 100, 100.6, 100.1, 100.4)], store });
  await session.start();
  feed.onOpen();
  feed.onTick(SYM, 100.9, at('09:40'));
  feed.onTick(SYM, 101, at('09:41'));
  await settle();
  assert.deepEqual(store.decisions.map((d) => pick(d, 'kind', 'flow', 'sl', 'best', 'time')),
    [{ kind: 'TRAIL', flow: 'trail', sl: 100, best: 101, time: '09:41' }]);
  assert.equal(store.state.symbols[SYM].trail.sl, 100);
});

test('restart never resets to the starting SL: a tick between 99 and the saved 99.5 exits', async () => {
  const store = savedStore(savedTrail({ best: 100.6 }));
  const { session, feed, settle } = harness({ candles: [...LONG_RANGE, trailCandle('09:31', 100, 100.6, 100.1, 100.4)], store });
  await session.start();
  feed.onOpen();
  feed.onTick(SYM, 99.3, at('09:40'));
  await settle();
  assert.deepEqual(store.decisions.map((d) => [d.kind, d.flow, d.reason, d.price]), [['EXIT', 'trail', 'SL', 99.3]]);
  assert.equal(store.state.symbols[SYM].position, 'CLOSED');
});

test('restart with fixed and trail both saved keeps both independent', async () => {
  const store = memoryStore({ date: DATE, symbols: { [SYM]: {
    position: 'OPEN', side: 'long', entry: 100, sl: 99, target: 103, quantity: 1, entryTime: '09:31', trail: savedTrail(),
  } } });
  const { session, feed, settle } = harness({ candles: [...LONG_RANGE, entryCandle], store });
  await session.start();
  feed.onOpen();
  feed.onTick(SYM, 99.4, at('09:40')); // under trail SL 99.5, above fixed SL 99
  await settle();
  assert.deepEqual(store.decisions.map((d) => [d.kind, d.flow, d.reason, d.price]), [['EXIT', 'trail', 'SL', 99.4]]);
  assert.equal(store.state.symbols[SYM].position, 'OPEN');
});

// A restart re-checks only the minutes after the trail's stop was set (slTime).
// 09:40's low of 99.3 was safe under the 99 stop of the time; it sits under
// today's 99.5 stop, set at 10:00, and must not become a stop at 09:40.
test('restart: minutes before the stop was set are not re-checked against it', async () => {
  const store = savedStore(savedTrail({ slTime: '10:00' }));
  const candles = [
    ...LONG_RANGE,
    entryCandle,
    trailCandle('09:40', 100, 100.2, 99.3, 99.6),
    trailCandle('10:00', 100.2, 100.6, 99.4, 100.5), // the step's own minute: low may predate it
    trailCandle('10:01', 100.5, 101.1, 100.3, 101),
  ];
  const { session, settle } = harness({ candles, store });
  await session.start();
  await settle();
  assert.deepEqual(store.decisions.map((d) => pick(d, 'kind', 'sl', 'time')), [{ kind: 'TRAIL', sl: 100, time: '10:01' }]);
  assert.equal(store.state.symbols[SYM].trail.slTime, '10:01');
});

test('restart: a minute after slTime under the stop still exits at the stop', async () => {
  const store = savedStore(savedTrail({ slTime: '10:00' }));
  const candles = [...LONG_RANGE, entryCandle, trailCandle('10:00', 100.2, 100.6, 99.8, 100.5), trailCandle('10:02', 100, 100.1, 99.4, 99.6)];
  const { session, settle } = harness({ candles, store });
  await session.start();
  await settle();
  assert.deepEqual(store.decisions.map((d) => pick(d, 'kind', 'flow', 'reason', 'price', 'time')),
    [{ kind: 'EXIT', flow: 'trail', reason: 'SL', price: 99.5, time: '10:02' }]);
  assert.equal(store.state.symbols[SYM].position, 'CLOSED');
});
