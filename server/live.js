// Live runner, data only. Watches prices, asks the backtest engine what it would
// do, records the answer. Places no orders.
//
//   npm run live
//
// See server/architecture.md for why it is shaped this way.

require('../src/env').loadEnv();

const baseConfig = require('../config');
const { readTickers } = require('../src/tickers');
const { runBacktest } = require('../src/engine');
const { toMinutes, istParts, istToday } = require('../src/time');
const { shortSymbol } = require('../src/util');
const { client, socketToken } = require('../src/fyers');
const { CandleBuilder } = require('./candles');
const { warmStart } = require('./warmstart');
const { startFeed } = require('./feed');
const { createPaperBroker } = require('./broker/paper');
const state = require('./state');

const LIST = process.env.LIVE_LIST || 'core.txt';

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

async function main() {
  const date = istToday();
  const symbols = readTickers(LIST);
  const sessionEndMin = toMinutes(baseConfig.sessionEnd);

  client(); // fail fast if there is no token for today
  const saved = state.load(date);

  const books = new Map(symbols.map((s) => [s, new CandleBuilder()]));
  const status = new Map(symbols.map((s) => [s, saved.symbols[s]?.position || 'FLAT']));

  const broker = createPaperBroker({
    onEvent: (e) => {
      console.log(
        `${e.time}  ${e.kind.padEnd(5)} ${shortSymbol(e.symbol).padEnd(12)}` +
          ` ${e.side ?? ''} ${e.price} x${e.quantity}` +
          (e.reason ? `  ${e.reason} pnl ${e.pnl.toFixed(2)}` : `  sl ${e.sl} tgt ${e.target ?? '-'}`)
      );
      state.logDecision(date, e);
    },
  });

  console.log(`\n${symbols.length} symbols from ${LIST} · ${date}`);
  console.log(`target ${baseConfig.targetPct}% · SL ${baseConfig.slMode} ${baseConfig.slPct}% · ` +
    `range ${baseConfig.orbStart}-${baseConfig.orbEnd} · exit ${baseConfig.sessionEnd}`);
  console.log('\nWarm start: pulling today\'s candles...');

  const backfill = () => warmStart(symbols, (symbol, candles) => books.get(symbol).setCompleted(candles));
  await backfill();

  const filled = [...books.values()].filter((b) => b.completed.length > 0).length;
  console.log(`Warm start done — ${filled}/${symbols.length} symbols have candles.\n`);

  function evaluate(symbol) {
    const book = books.get(symbol);
    const candles = book.candles();
    if (candles.length === 0) return;

    const config = { ...baseConfig, symbol };
    const trade = runBacktest(candles, config)[0];
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
    // it already took.
    if (next !== have) {
      status.set(symbol, next);
      saved.symbols[symbol] = { position: next };
      state.save(saved);
    }
  }

  // Evaluate once on the warm-started candles so a restart mid-session reports
  // what is already held, instead of looking flat until the next tick.
  for (const symbol of symbols) evaluate(symbol);
  console.log(`Evaluated warm-start candles. Open: ` +
    `${[...status.values()].filter((s) => s === 'OPEN').length}, ` +
    `closed today: ${[...status.values()].filter((s) => s === 'CLOSED').length}.\n`);

  let connects = 0;
  startFeed({
    token: socketToken(),
    symbols,
    onOpen: async () => {
      if (++connects === 1) return console.log('Feed connected. Watching.\n');
      // Ticks missed while disconnected never arrive, so refill today's
      // completed candles from REST before trusting the books again.
      console.log('Feed reconnected — backfilling missed candles...');
      await backfill();
      for (const symbol of symbols) evaluate(symbol);
      console.log('Backfill done. Watching.\n');
    },
    onClose: () => console.log('Feed closed.'),
    onError: (e) => console.log('Feed error:', e?.message ?? e),
    onTick: (symbol, ltp, ts) => {
      const book = books.get(symbol);
      if (!book) return;
      // Ignore anything outside the session. Outside market hours the feed keeps
      // replaying the last snapshot, which must not build candles or trades.
      const { minute, date: tickDate } = istParts(ts);
      if (tickDate !== date || minute < toMinutes(baseConfig.orbStart) || minute > sessionEndMin) return;
      // Only re-evaluate when the forming candle's range actually moved; a tick
      // that cannot change the outcome must not trigger a decision.
      if (book.addTick(ltp, ts)) evaluate(symbol);
    },
  });

  const stop = () => { state.save(saved); console.log('\nStopped. State saved.'); process.exit(0); };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

main().catch((err) => { console.error('\n' + err.message + '\n'); process.exit(1); });
