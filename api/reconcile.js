// Checks one day's paper trades against a backtest of that day's candles (#76).
// Live takes its entry from src/engine.js but then manages the position on the
// socket's ticks and fills at tick prices (D24), so each traded symbol gets a
// verdict:
//   match    same side, entry minute, exit reason and exit minute; prices may
//            differ by slippage, which is recorded
//   tick     the backtest had to guess the order inside a candle (one that broke
//            both edges of the range, or touched both stop and target) and live
//            saw the real order: expected, not a problem
//   mismatch anything else, e.g. live missed a breakout or never saw a stop:
//            the plumbing (ticks, warm start, state) is worth a look
//
// On a day the live session never ran (no decisions at all: the instance slept,
// Fyers wasn't connected), the backtest's trades are written to paper_trades
// with source = 'backtest' instead, so the history has no holes.
//
// Only the 'fixed' flow is checked or backfilled. The 'trail' flow (M10) is
// live only: the backtest has no trailing stop to compare it with.

const baseConfig = require('../config');
const { runBacktest } = require('../src/engine');
const { getCandles: fetchCandles } = require('../src/fetch');
const { withTransaction } = require('./db/pool');
const { istParts, toMinutes } = require('../src/time');

const num = (v) => (v === null || v === undefined ? null : Number(v));
const minuteOf = (hhmm) => (hhmm ? Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5)) : null);

// The day's candles as { minute: [ts, o, h, l, c] } and its opening range.
function dayView(candles, config) {
  const at = new Map(candles.map((c) => [istParts(c[0]).minute, c]));
  const from = toMinutes(config.orbStart);
  const to = toMinutes(config.orbEnd);
  const orb = candles.filter((c) => { const m = istParts(c[0]).minute; return m >= from && m < to; });
  return { at, high: orb.length ? Math.max(...orb.map((c) => c[2])) : null, low: orb.length ? Math.min(...orb.map((c) => c[3])) : null };
}

// A candle the backtest can't read: it broke both edges of the range, or it
// touched both the stop and the target of the trade.
const brokeBoth = (c, day) => Boolean(c && day.high !== null && c[2] > day.high && c[3] < day.low);
function touchedBoth(c, t) {
  if (!c || t.target == null) return false;
  return t.side === 'long' ? c[3] <= t.sl && c[2] >= t.target : c[2] >= t.sl && c[3] <= t.target;
}

// One symbol: what live recorded vs what the backtest says, as
// null (neither traded) or { kind: 'match' | 'tick' | 'mismatch', problem }.
function compare(live, bt, day = { at: new Map(), high: null, low: null }) {
  if (!live && !bt) return null;
  if (!live) return { kind: 'mismatch', problem: 'backtest traded, live did not' };
  const liveEntry = minuteOf(live.entry_time ?? live.entryTime);
  const ambiguousEntry = brokeBoth(day.at.get(liveEntry), day);
  const tick = (problem) => ({ kind: 'tick', problem });
  if (!bt) return ambiguousEntry ? tick('the breakout candle broke both edges; the backtest skipped it, live saw which came first') : { kind: 'mismatch', problem: 'live traded, backtest did not' };
  if (live.side !== bt.side) return ambiguousEntry ? tick('the breakout candle broke both edges; live saw which came first') : { kind: 'mismatch', problem: 'side differs' };
  if (liveEntry !== minuteOf(bt.entryTime)) return ambiguousEntry ? tick('the breakout candle broke both edges; live saw which came first') : { kind: 'mismatch', problem: 'entry time differs' };
  if (live.status !== 'closed') return { kind: 'mismatch', problem: 'still open after the close' };
  const liveExit = minuteOf(live.exit_time ?? live.exitTime);
  const btExit = minuteOf(bt.exitTime);
  if (live.reason === bt.reason && liveExit === btExit) return { kind: 'match' };
  const levels = { side: bt.side, sl: bt.sl, target: bt.target };
  if (touchedBoth(day.at.get(btExit), levels) || touchedBoth(day.at.get(liveExit), levels)) {
    return tick('one candle touched both stop and target; the backtest assumes the stop, live saw which came first');
  }
  return { kind: 'mismatch', problem: live.reason !== bt.reason ? 'exit reason differs' : 'exit time differs' };
}

const brief = (t) => t && {
  side: t.side, entry: num(t.entry), exit: num(t.exit), reason: t.reason ?? null,
  entryTime: t.entryTime ?? t.entry_time ?? null, exitTime: t.exitTime ?? t.exit_time ?? null, pnl: num(t.pnl),
};

async function reconcileDay({ pool, date, symbols, config = baseConfig, getCandles = fetchCandles, log = () => {} }) {
  const { rows: liveRows } = await pool.query(
    `select symbol, status, side, entry, exit, reason, pnl, entry_time, exit_time from paper_trades where date = $1 and source = 'live' and flow = 'fixed'`,
    [date]
  );
  const live = new Map(liveRows.map((r) => [r.symbol, r]));
  const { rows: ran } = await pool.query('select 1 from live_decisions where date = $1 limit 1', [date]);
  const sessionRan = ran.length > 0 || liveRows.length > 0;

  const all = [...new Set([...symbols, ...live.keys()])].sort();
  const mismatches = [];
  const notes = [];
  const backfill = [];
  let matched = 0;

  for (const symbol of all) {
    let bt;
    let day;
    try {
      const candles = await getCandles({ symbol, resolution: '1', fromDate: date, toDate: date });
      bt = runBacktest(candles, { ...config, symbol })[0] || null;
      day = dayView(candles, config);
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
    const lv = live.get(symbol);
    const verdict = compare(lv, bt, day);
    if (!verdict) {
      matched++; // neither traded
      continue;
    }
    const entry = { symbol, live: brief(lv), backtest: brief(bt) };
    if (verdict.kind === 'mismatch') {
      mismatches.push({ ...entry, problem: verdict.problem });
      continue;
    }
    // Live P&L minus the backtest's: the cost of tick fills (or the gain of
    // seeing the real order inside a candle).
    const slippage = lv && bt && lv.pnl != null ? Math.round((Number(lv.pnl) - bt.pnl) * 100) / 100 : null;
    if (verdict.kind === 'match') matched++;
    notes.push({ ...entry, kind: verdict.kind, ...(verdict.problem && { problem: verdict.problem }), slippage });
  }

  await withTransaction(pool, async (client) => {
    for (const { symbol, trade: t } of backfill) {
      await client.query(
        `insert into paper_trades (date, symbol, status, side, quantity, entry_time, entry, sl, target,
           exit_time, exit, reason, pnl, source)
         values ($1, $2, 'closed', $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'backtest')
         on conflict (date, symbol, flow) do nothing`,
        [date, symbol, t.side, t.quantity, t.entryTime, t.entry, t.sl, t.target, t.exitTime, t.exit, t.reason, t.pnl]
      );
    }
    await client.query(
      `insert into paper_reconciliations (date, checked, matched, backfilled, mismatches, notes)
       values ($1, $2, $3, $4, $5, $6)
       on conflict (date) do update set reconciled_at = now(), checked = excluded.checked,
         matched = excluded.matched, backfilled = excluded.backfilled, mismatches = excluded.mismatches,
         notes = excluded.notes`,
      [date, all.length, matched, backfill.length, JSON.stringify(mismatches), JSON.stringify(notes)]
    );
  });

  const expected = notes.filter((n) => n.kind === 'tick').length;
  const result = { date, checked: all.length, matched, expected, backfilled: backfill.length, mismatches, notes };
  log(`reconciled ${date}: ${matched}/${all.length} matched, ${expected} tick-order, ${mismatches.length} mismatched, ${backfill.length} backfilled`);
  return result;
}

module.exports = { reconcileDay, compare };
