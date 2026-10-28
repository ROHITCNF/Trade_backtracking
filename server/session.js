// One trading day of the live runner, as an object a host can start and stop.
// `npm run live` hosts it from the terminal; the API hosts it on a schedule.
// Nothing here exits the process, handles signals or touches disk directly:
// state goes through `store`, decisions through `broker`.
//
// See server/architecture.md for why it is shaped this way.

const { runBacktest } = require('../src/engine');
const { toMinutes, istParts, istToday } = require('../src/time');
const { CandleBuilder } = require('./candles');
const { createPaperBroker } = require('./broker/paper');

// The engine returns a finished trade or nothing; it has no idea a day is still
// running. Combining its exit reason with the clock tells us what is actually
// held right now. This table is the whole live/backtest translation layer.
function desiredState(trade, lastMinute, sessionEndMin) {
  if (!trade) return { position: 'FLAT' };
  if (trade.reason !== 'EOD') return { position: 'CLOSED', trade };
  if (lastMinute !== null && lastMinute < sessionEndMin) return { position: 'OPEN', trade };
  return { position: 'CLOSED', trade };
}

const entryOf = (t) => ({ side: t.side, price: t.entry, quantity: t.quantity, sl: t.sl, target: t.target, time: t.entryTime });
const exitOf = (t) => ({ side: t.side, price: t.exit, quantity: t.quantity, reason: t.reason, pnl: t.pnl, time: t.exitTime });

// store: { load(date), save(state), logDecision(date, event) }, each may return a promise.
// Every broker event is written to store.logDecision and handed to onDecision.
// Feed and REST are injected so tests can drive a session without Fyers.
function createLiveSession({
  symbols,
  config,
  store,
  onDecision = () => {},
  warmStart = require('./warmstart').warmStart,
  startFeed = require('./feed').startFeed,
  socketToken = require('../src/fyers').socketToken,
  date = istToday(),
  log = console.log,
}) {
  const sessionEndMin = toMinutes(config.sessionEnd);
  const orbStartMin = toMinutes(config.orbStart);
  const books = new Map(symbols.map((s) => [s, new CandleBuilder()]));
  const status = new Map(symbols.map((s) => [s, 'FLAT']));
  let saved = { date, symbols: {} };
  let socket = null;
  let connects = 0;
  let lastTickAt = null;
  let running = false;

  // Writes run one after another, so a slow store can never land an older
  // state on top of a newer one. Decisions are already final in memory by the
  // time they are queued; a failed write is logged, not retried.
  let writes = Promise.resolve();
  const enqueue = (fn) => {
    writes = writes.then(fn).catch((err) => log(`  state write failed: ${err.message}`));
    return writes;
  };

  const broker = createPaperBroker({
    onEvent: (event) => {
      onDecision(event);
      enqueue(() => store.logDecision(date, event));
    },
  });

  const backfill = () => warmStart(symbols, (symbol, candles) => books.get(symbol).setCompleted(candles));

  function evaluate(symbol) {
    const book = books.get(symbol);
    const candles = book.candles();
    if (candles.length === 0) return;

    const trade = runBacktest(candles, { ...config, symbol })[0];
    const want = desiredState(trade, book.lastMinute(), sessionEndMin);
    const have = status.get(symbol);

    let next = have;
    if (want.position === 'OPEN' && have === 'FLAT') {
      broker.enter(symbol, entryOf(want.trade));
      next = 'OPEN';
    } else if (want.position === 'CLOSED' && have !== 'CLOSED') {
      // From FLAT, entry and exit landed inside the same evaluation — record both
      // so the day's log still reconciles against the backtest.
      if (have === 'FLAT') broker.enter(symbol, entryOf(want.trade));
      broker.exit(symbol, exitOf(want.trade));
      next = 'CLOSED';
    }

    // Persist immediately on a change. A restart must never re-emit a position
    // it already took. The in-memory status changes first, synchronously, so a
    // tick arriving before the write lands cannot emit it twice either.
    if (next !== have) {
      status.set(symbol, next);
      saved.symbols[symbol] = { position: next };
      const snapshot = { date, symbols: { ...saved.symbols } };
      enqueue(() => store.save(snapshot));
    }
  }

  function onTick(symbol, ltp, ts) {
    const book = books.get(symbol);
    if (!book) return;
    // Ignore anything outside the session. Outside market hours the feed keeps
    // replaying the last snapshot, which must not build candles or trades.
    const { minute, date: tickDate } = istParts(ts);
    if (tickDate !== date || minute < orbStartMin || minute > sessionEndMin) return;
    lastTickAt = ts;
    // Only re-evaluate when the forming candle's range actually moved; a tick
    // that cannot change the outcome must not trigger a decision.
    if (book.addTick(ltp, ts)) evaluate(symbol);
  }

  const counts = () => {
    const values = [...status.values()];
    return { open: values.filter((s) => s === 'OPEN').length, closed: values.filter((s) => s === 'CLOSED').length };
  };

  async function start() {
    if (running) return;
    running = true;
    let token;
    try {
      token = await socketToken(); // fail fast if there is no live token
    } catch (err) {
      running = false; // so a host can retry once the token arrives
      throw err;
    }

    saved = (await store.load(date)) || { date, symbols: {} };
    saved.symbols = saved.symbols || {};
    for (const s of symbols) status.set(s, saved.symbols[s]?.position || 'FLAT');

    log("Warm start: pulling today's candles...");
    await backfill();
    const filled = [...books.values()].filter((b) => b.completed.length > 0).length;
    log(`Warm start done — ${filled}/${symbols.length} symbols have candles.`);

    // Evaluate once on the warm-started candles so a restart mid-session reports
    // what is already held, instead of looking flat until the next tick.
    for (const symbol of symbols) evaluate(symbol);
    const { open, closed } = counts();
    log(`Evaluated warm-start candles. Open: ${open}, closed today: ${closed}.`);
    if (!running) return; // stopped during warm start

    socket = startFeed({
      token,
      symbols,
      onOpen: async () => {
        if (++connects === 1) return log('Feed connected. Watching.');
        // Ticks missed while disconnected never arrive, so refill today's
        // completed candles from REST before trusting the books again.
        log('Feed reconnected — backfilling missed candles...');
        await backfill();
        for (const symbol of symbols) evaluate(symbol);
        log('Backfill done. Watching.');
      },
      onClose: () => log('Feed closed.'),
      onError: (e) => log(`Feed error: ${e?.message ?? e}`),
      onTick,
    });
  }

  // Closes the feed and waits for pending state writes. Safe to call twice.
  async function stop() {
    running = false;
    if (socket) {
      try { socket.close(); } catch (err) { log(`  feed close failed: ${err.message}`); }
      socket = null;
    }
    await enqueue(() => store.save({ date, symbols: { ...saved.symbols } }));
  }

  function getStatus() {
    return { date, running, symbols: symbols.length, connects, lastTickAt, ...counts() };
  }

  return { start, stop, status: getStatus, onTick };
}

module.exports = { createLiveSession, desiredState };
