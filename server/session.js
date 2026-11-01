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

const { round } = require('../src/util');

// The engine decides the entry. From then on the position is managed here, on
// the prices the socket actually delivers (D24): the first tick at or through
// the stop or target closes it at that tick's price, and the first tick at
// sessionEnd closes it as EOD. The backtest can't see the order of prices
// inside a minute; live can, so live never re-asks the engine once it holds.
//
// While live is blind (before launch, during a disconnect, after a restart),
// no tick exists, so the REST candles for those minutes are checked the way the
// backtest checks them: stop wins a candle that touches both, fills at the level.

const hhmm = (minute) => `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;

function pnlOf(position, exit, config) {
  const sign = position.side === 'long' ? 1 : -1;
  const gross = (exit - position.entry) * sign * position.quantity;
  const cost = ((position.entry + exit) * position.quantity * (config.costBps || 0)) / 10000;
  return round(gross - cost);
}

// The exit a single tick triggers for an open position, or null.
function tickExit(position, price, minute, sessionEndMin) {
  const long = position.side === 'long';
  if (long ? price <= position.sl : price >= position.sl) return 'SL';
  if (position.target != null && (long ? price >= position.target : price <= position.target)) return 'TARGET';
  if (minute >= sessionEndMin) return 'EOD';
  return null;
}

// The exit a REST candle implies for a position live couldn't watch: the
// engine's rule (stop first on a candle touching both, fill at the level),
// then EOD at the close of the sessionEnd candle.
function candleExit(position, [, , h, l, c], minute, sessionEndMin) {
  const long = position.side === 'long';
  if (long ? l <= position.sl : h >= position.sl) return { reason: 'SL', price: position.sl };
  if (position.target != null && (long ? h >= position.target : l <= position.target)) return { reason: 'TARGET', price: position.target };
  if (minute >= sessionEndMin) return { reason: 'EOD', price: c };
  return null;
}

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
  const positions = new Map(); // symbol -> { side, entry, sl, target, quantity, entryTime } while OPEN
  const seen = new Map(); // symbol -> epoch s of the last tick acted on: live watched up to here
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

  // Persists a status change at once. A restart must never re-emit a position
  // it already took. The in-memory status changes first, synchronously, so a
  // tick arriving before the write lands cannot emit it twice either.
  function setStatus(symbol, next) {
    status.set(symbol, next);
    const p = positions.get(symbol);
    saved.symbols[symbol] = next === 'OPEN' && p ? { position: next, ...p } : { position: next };
    const snapshot = { date, symbols: { ...saved.symbols } };
    enqueue(() => store.save(snapshot));
  }

  function enter(symbol, position) {
    positions.set(symbol, position);
    broker.enter(symbol, { ...position, price: position.entry, time: position.entryTime });
    setStatus(symbol, 'OPEN');
  }

  function exit(symbol, price, reason, minute) {
    const p = positions.get(symbol);
    broker.exit(symbol, { side: p.side, price: round(price), quantity: p.quantity, reason, pnl: pnlOf(p, price, config), time: hhmm(minute) });
    positions.delete(symbol);
    setStatus(symbol, 'CLOSED');
  }

  // Blind minutes: check the REST candles from the last minute live watched
  // (or the entry minute) onwards. The forming candle is the socket's, so skip it.
  function scanCandles(symbol) {
    const p = positions.get(symbol);
    if (!p) return;
    const book = books.get(symbol);
    const from = Math.max(toMinutes(p.entryTime), seen.has(symbol) ? istParts(seen.get(symbol)).minute : 0);
    for (const c of book.completed) {
      const minute = istParts(c[0]).minute;
      if (minute < from) continue;
      const hit = candleExit(p, c, minute, sessionEndMin);
      if (hit) return exit(symbol, hit.price, hit.reason, minute);
    }
  }

  // FLAT: ask the engine whether a breakout has happened. A breakout on the
  // tick being handled fills at that tick's price; one found only in candles
  // (live was blind when it happened) fills where the backtest would, and its
  // blind minutes are then checked for an exit.
  function evaluate(symbol, tick = null) {
    const state = status.get(symbol);
    if (state === 'CLOSED') return;
    if (state === 'OPEN') {
      if (!positions.has(symbol)) adoptEngineTrade(symbol);
      return scanCandles(symbol);
    }
    const candles = books.get(symbol).candles();
    if (candles.length === 0) return;
    const trade = runBacktest(candles, { ...config, symbol })[0];
    if (!trade) return;
    const position = { side: trade.side, entry: trade.entry, sl: trade.sl, target: trade.target, quantity: trade.quantity, entryTime: trade.entryTime };
    const onThisTick = tick && toMinutes(trade.entryTime) === tick.minute;
    if (onThisTick) {
      enter(symbol, { ...position, entry: round(tick.price), entryTime: hhmm(tick.minute) });
      const why = tickExit(positions.get(symbol), tick.price, tick.minute, sessionEndMin);
      if (why === 'EOD') exit(symbol, tick.price, why, tick.minute);
      return;
    }
    enter(symbol, position);
    scanCandles(symbol);
  }

  // A position restored from a store that kept only "OPEN" (written before
  // D24): rebuild its levels from the engine, as the old runner had them.
  function adoptEngineTrade(symbol) {
    const trade = runBacktest(books.get(symbol).candles(), { ...config, symbol })[0];
    if (trade) positions.set(symbol, { side: trade.side, entry: trade.entry, sl: trade.sl, target: trade.target, quantity: trade.quantity, entryTime: trade.entryTime });
  }

  function onTick(symbol, ltp, ts) {
    const book = books.get(symbol);
    if (!book) return;
    // Ignore anything outside the session. Outside market hours the feed keeps
    // replaying the last snapshot, which must not build candles or trades.
    const { minute, date: tickDate } = istParts(ts);
    if (tickDate !== date || minute < orbStartMin || minute > sessionEndMin) return;
    lastTickAt = ts;
    const moved = book.addTick(ltp, ts);
    const state = status.get(symbol);
    if (state === 'OPEN' && positions.has(symbol)) {
      // Holding: every tick is checked against this position's own levels.
      seen.set(symbol, ts);
      const why = tickExit(positions.get(symbol), ltp, minute, sessionEndMin);
      if (why) exit(symbol, ltp, why, minute);
      return;
    }
    if (state === 'FLAT') seen.set(symbol, ts);
    // Flat: only a tick that moved the forming candle's high or low can be a
    // breakout, so only those ask the engine.
    if (moved) evaluate(symbol, { price: ltp, minute });
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
    for (const s of symbols) {
      const kept = saved.symbols[s] || {};
      status.set(s, kept.position || 'FLAT');
      if (kept.position === 'OPEN' && kept.side) {
        const { side, entry, sl, target, quantity, entryTime } = kept;
        positions.set(s, { side, entry: Number(entry), sl: Number(sl), target: target == null ? null : Number(target), quantity: Number(quantity), entryTime });
      }
    }

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

  // Re-pulls today's candles over REST and re-evaluates every symbol. A host
  // calls it just before stop() at the end of the day, so a held position gets
  // its EOD exit even if no tick arrived after sessionEnd.
  async function refresh() {
    await backfill();
    for (const symbol of symbols) evaluate(symbol);
  }

  function getStatus() {
    return { date, running, symbols: symbols.length, connects, lastTickAt, ...counts() };
  }

  return { start, stop, refresh, status: getStatus, onTick };
}

module.exports = { createLiveSession, tickExit, candleExit };
