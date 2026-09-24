// Live runner, data only. Watches prices, asks the backtest engine what it would
// do, records the answer. Places no orders.
//
//   npm run live
//
// See server/architecture.md for why it is shaped this way.

require('../src/env').loadEnv(require('path').join(__dirname, '.env'));

const baseConfig = require('../config');
const { readTickers } = require('../src/tickers');
const { runBacktest } = require('../src/engine');
const { toMinutes, istParts } = require('../src/time');
const { client, socketToken } = require('./auth');
const { CandleBuilder } = require('./candles');
const { warmStart, istToday } = require('./warmstart');
const { startFeed } = require('./feed');
const { createPaperBroker } = require('./broker/paper');
const state = require('./state');

const LIST = process.env.LIVE_LIST || '_ORB_BRERAKOUT_CORE.txt';

// The engine returns a finished trade or nothing; it has no idea a day is still
// running. Combining its exit reason with the clock tells us what is actually
// held right now. This table is the whole live/backtest translation layer.
function desiredState(trade, lastMinute, sessionEndMin) {
  if (!trade) return { position: 'FLAT' };
  if (trade.reason !== 'EOD') return { position: 'CLOSED', trade };
  if (lastMinute !== null && lastMinute < sessionEndMin) return { position: 'OPEN', trade };
  return { position: 'CLOSED', trade };
}

async function main() {
  const date = istToday();
  const symbols = readTickers(LIST);
  const sessionEndMin = toMinutes(baseConfig.sessionEnd);

  const fyers = client();
  const saved = state.load(date);

  const books = new Map(symbols.map((s) => [s, new CandleBuilder()]));
  const status = new Map(symbols.map((s) => [s, saved.symbols[s]?.position || 'FLAT']));

  const broker = createPaperBroker({
    onEvent: (e) => {
      console.log(
        `${e.time}  ${e.kind.padEnd(5)} ${e.symbol.replace(/^NSE:|-EQ$/g, '').padEnd(12)}` +
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

  await warmStart(fyers, symbols, (symbol, candles) => {
    books.get(symbol).setCompleted(candles);
  });

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

    if (want.position === 'OPEN' && have === 'FLAT') {
      status.set(symbol, 'OPEN');
      broker.enter(symbol, {
        side: want.trade.side, price: want.trade.entry, quantity: want.trade.quantity,
        sl: want.trade.sl, target: want.trade.target, time: want.trade.entryTime,
      });
    } else if (want.position === 'CLOSED' && have === 'OPEN') {
      status.set(symbol, 'CLOSED');
      broker.exit(symbol, {
        side: want.trade.side, price: want.trade.exit, quantity: want.trade.quantity,
        reason: want.trade.reason, pnl: want.trade.pnl, time: want.trade.exitTime,
      });
    } else if (want.position === 'CLOSED' && have === 'FLAT' && want.trade) {
      // Entry and exit landed inside the same evaluation — record both so the
      // day's log still reconciles against the backtest.
      status.set(symbol, 'CLOSED');
      broker.enter(symbol, {
        side: want.trade.side, price: want.trade.entry, quantity: want.trade.quantity,
        sl: want.trade.sl, target: want.trade.target, time: want.trade.entryTime,
      });
      broker.exit(symbol, {
        side: want.trade.side, price: want.trade.exit, quantity: want.trade.quantity,
        reason: want.trade.reason, pnl: want.trade.pnl, time: want.trade.exitTime,
      });
    }

    // Persist immediately on a change, not on a timer. A restart must never
    // re-emit a position it already took — the 10s snapshot below is only a
    // backstop for the case where nothing changed.
    const now = status.get(symbol);
    if (saved.symbols[symbol]?.position !== now) {
      saved.symbols[symbol] = { position: now };
      state.save(saved);
    }
  }

  // Evaluate once on the warm-started candles so a restart mid-session reports
  // what is already held, instead of looking flat until the next tick.
  for (const symbol of symbols) evaluate(symbol);
  console.log(`Evaluated warm-start candles. Open: ` +
    `${[...status.values()].filter((s) => s === 'OPEN').length}, ` +
    `closed today: ${[...status.values()].filter((s) => s === 'CLOSED').length}.\n`);

  startFeed({
    token: socketToken(),
    symbols,
    onOpen: () => console.log('Feed connected. Watching.\n'),
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

  // Snapshot on a timer rather than per tick, so a crash costs at most 10s.
  setInterval(() => state.save(saved), 10000);

  const stop = () => { state.save(saved); console.log('\nStopped. State saved.'); process.exit(0); };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

main().catch((err) => { console.error('\n' + err.message + '\n'); process.exit(1); });
