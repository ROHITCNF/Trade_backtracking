// Live runner, data only. Watches prices, asks the backtest engine what it would
// do, records the answer. Places no orders.
//
//   npm run live
//
// A terminal host for server/session.js, with state on disk (server/state.js).
// See server/architecture.md for why it is shaped this way.

require('../src/env').loadEnv();

const baseConfig = require('../config');
const { readTickers } = require('../src/tickers');
const { istToday } = require('../src/time');
const { shortSymbol } = require('../src/util');
const { getClient } = require('../src/fyers');
const { createLiveSession } = require('./session');
const state = require('./state');

const LIST = process.env.LIVE_LIST || 'core.txt';

function printDecision(e) {
  console.log(
    `${e.time}  ${e.kind.padEnd(5)} ${shortSymbol(e.symbol).padEnd(12)}` +
      ` ${e.side ?? ''} ${e.price} x${e.quantity}` +
      (e.reason ? `  ${e.reason} pnl ${e.pnl.toFixed(2)}` : `  sl ${e.sl} tgt ${e.target ?? '-'}`)
  );
}

async function main() {
  const date = istToday();
  const symbols = readTickers(LIST);

  await getClient(); // fail fast if there is no live token

  console.log(`\n${symbols.length} symbols from ${LIST} · ${date}`);
  console.log(`target ${baseConfig.targetPct}% · SL ${baseConfig.slMode} ${baseConfig.slPct}% · ` +
    `range ${baseConfig.orbStart}-${baseConfig.orbEnd} · exit ${baseConfig.sessionEnd}\n`);

  const session = createLiveSession({ symbols, config: baseConfig, store: state, date, onDecision: printDecision });
  await session.start();

  const stop = async () => {
    await session.stop();
    console.log('\nStopped. State saved.');
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

main().catch((err) => { console.error('\n' + err.message + '\n'); process.exit(1); });
