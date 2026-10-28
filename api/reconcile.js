// Checks one day's paper trades against a backtest of that day's candles (#76).
// Paper fills come from src/engine.js, so the two must agree exactly; a
// difference means the live plumbing (ticks, warm start, state) went wrong.
//
// On a day the live session never ran (no decisions at all: the instance slept,
// Fyers wasn't connected), the backtest's trades are written to paper_trades
// with source = 'backtest' instead, so the history has no holes.

const baseConfig = require('../config');
const { runBacktest } = require('../src/engine');
const { getCandles: fetchCandles } = require('../src/fetch');
const { withTransaction } = require('./db/pool');

const PRICE_TOLERANCE = 0.005; // half a paisa: numeric round-trips, nothing more

const close = (a, b) => (a === null || b === null ? a === b : Math.abs(a - b) < PRICE_TOLERANCE);
const num = (v) => (v === null || v === undefined ? null : Number(v));

// One symbol: what live recorded vs what the backtest says. Returns null when
// they agree, else the first difference worth reading.
function compare(live, bt) {
  if (!live && !bt) return null;
  if (!live) return 'backtest traded, live did not';
  if (!bt) return 'live traded, backtest did not';
  if (live.side !== bt.side) return 'side differs';
  if (!close(num(live.entry), bt.entry)) return 'entry price differs';
  if (live.status !== 'closed') return 'still open after the close';
  if (live.reason !== bt.reason) return 'exit reason differs';
  if (!close(num(live.exit), bt.exit)) return 'exit price differs';
  return null;
}

const brief = (t) => t && { side: t.side, entry: num(t.entry), exit: num(t.exit), reason: t.reason ?? null, entryTime: t.entryTime ?? t.entry_time ?? null };

async function reconcileDay({ pool, date, symbols, config = baseConfig, getCandles = fetchCandles, log = () => {} }) {
  const { rows: liveRows } = await pool.query(
    `select symbol, status, side, entry, exit, reason, entry_time from paper_trades where date = $1 and source = 'live'`,
    [date]
  );
  const live = new Map(liveRows.map((r) => [r.symbol, r]));
  const { rows: ran } = await pool.query('select 1 from live_decisions where date = $1 limit 1', [date]);
  const sessionRan = ran.length > 0 || liveRows.length > 0;

  const all = [...new Set([...symbols, ...live.keys()])].sort();
  const mismatches = [];
  const backfill = [];
  let matched = 0;

  for (const symbol of all) {
    let bt;
    try {
      const candles = await getCandles({ symbol, resolution: '1', fromDate: date, toDate: date });
      bt = runBacktest(candles, { ...config, symbol })[0] || null;
    } catch (err) {
      // A dead token or spent budget stops the whole check; it is retried later.
      if (/REST budget|429|token/i.test(err.message)) throw err;
      mismatches.push({ symbol, problem: `candles failed: ${err.message}`, live: brief(live.get(symbol)), backtest: null });
      continue;
    }

    if (!sessionRan) {
      if (bt) backfill.push({ symbol, trade: bt });
      continue;
    }
    const problem = compare(live.get(symbol), bt);
    if (problem) mismatches.push({ symbol, problem, live: brief(live.get(symbol)), backtest: brief(bt) });
    else matched++;
  }

  await withTransaction(pool, async (client) => {
    for (const { symbol, trade: t } of backfill) {
      await client.query(
        `insert into paper_trades (date, symbol, status, side, quantity, entry_time, entry, sl, target,
           exit_time, exit, reason, pnl, source)
         values ($1, $2, 'closed', $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'backtest')
         on conflict (date, symbol) do nothing`,
        [date, symbol, t.side, t.quantity, t.entryTime, t.entry, t.sl, t.target, t.exitTime, t.exit, t.reason, t.pnl]
      );
    }
    await client.query(
      `insert into paper_reconciliations (date, checked, matched, backfilled, mismatches)
       values ($1, $2, $3, $4, $5)
       on conflict (date) do update set reconciled_at = now(), checked = excluded.checked,
         matched = excluded.matched, backfilled = excluded.backfilled, mismatches = excluded.mismatches`,
      [date, all.length, matched, backfill.length, JSON.stringify(mismatches)]
    );
  });

  const result = { date, checked: all.length, matched, backfilled: backfill.length, mismatches };
  log(`reconciled ${date}: ${matched}/${all.length} matched, ${mismatches.length} mismatched, ${backfill.length} backfilled`);
  return result;
}

module.exports = { reconcileDay, compare };
